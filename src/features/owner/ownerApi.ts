import { z } from 'zod';

import { getSupabase } from '../../shared/supabase';
import { availabilitySchema, bookingSchema, quoteSchema, snapshotSchema } from '../booking/api';

/**
 * Данные кабинета владельца. Чтение — напрямую из БД под RLS (видны только свои заведения),
 * изменения — только SQL-функциями owner_* (членство проверяется в БД по auth.uid()).
 */

export class OwnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function ownerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Что-то пошло не так, попробуйте ещё раз';
}

const rpcFailSchema = z.object({ ok: z.literal(false), error: z.string(), message: z.string() });

function unwrap<T>(schema: z.ZodType<T>, data: unknown, error: { message: string } | null): T {
  if (error) throw new OwnerError('DB', error.message);
  const fail = rpcFailSchema.safeParse(data);
  if (fail.success) throw new OwnerError(fail.data.error, fail.data.message);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new OwnerError('BAD_RESPONSE', 'Неожиданный ответ сервера');
  return parsed.data;
}

/** PostgREST отдаёт границы tstzrange как «2026-11-16 07:00:00+00» — приводим к ISO. */
export function pgTimestampToIso(value: string): string {
  const iso = value.trim().replace(' ', 'T');
  return /[+-]\d{2}$/.test(iso) ? `${iso}:00` : iso;
}

export function parseTstzRange(range: string): { from: string; to: string } | null {
  const m = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(range.trim());
  if (!m?.[1] || !m[2]) return null;
  return { from: pgTimestampToIso(m[1]), to: pgTimestampToIso(m[2]) };
}

export const ownerTenantSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  status: z.enum(['preview', 'live', 'archived']),
  theme: z.object({ accent: z.string().optional() }),
  deposit_percent: z.number().int(),
});

export const ownerHallSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  min_duration_min: z.number().int(),
  slot_step_min: z.number().int(),
  capacity_included: z.number().int(),
  capacity_max: z.number().int(),
  sort: z.number().int(),
});

const paymentSchema = z.object({
  kind: z.enum(['deposit', 'payment', 'refund']),
  amount: z.number().int(),
  method: z.enum(['cash', 'transfer', 'card', 'online']),
  received_at: z.string(),
});

export const ownerBookingSchema = z.object({
  id: z.uuid(),
  hall_id: z.uuid(),
  start_at: z.string(),
  end_at: z.string(),
  guests: z.number().int(),
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']),
  source: z.enum(['online', 'phone', 'messenger', 'walk_in', 'owner']),
  customer_name: z.string(),
  customer_phone: z.string().nullable(),
  comment: z.string().nullable(),
  total_amount: z.number().int(),
  price_snapshot: snapshotSchema,
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: z.string(),
  payments: z.array(paymentSchema),
});

const blockRefSchema = z.object({ id: z.uuid(), reason: z.string() });
const blockRowSchema = z.object({
  id: z.uuid(),
  hall_id: z.uuid(),
  occupied: z.string(),
  hall_blocks: z.union([blockRefSchema, z.array(blockRefSchema), z.null()]),
});

export const statsSchema = z.object({
  bookings_created: z.number().int(),
  visits_completed: z.number().int(),
  visits_amount: z.number().int(),
  money_received: z.number().int(),
  deposits_received: z.number().int(),
  refunds: z.number().int(),
  expected_amount: z.number().int(),
  expected_bookings: z.number().int(),
  cancellations: z.number().int(),
  no_shows: z.number().int(),
  occupancy_pct: z.number(),
  occupied_hours: z.number(),
  available_hours: z.number(),
  by_hall: z.array(
    z.object({
      hall_id: z.uuid(),
      hall_name: z.string(),
      occupancy_pct: z.number(),
      occupied_hours: z.number(),
    }),
  ),
});

export type OwnerTenant = z.infer<typeof ownerTenantSchema>;
export type OwnerHall = z.infer<typeof ownerHallSchema>;
export type OwnerBooking = z.infer<typeof ownerBookingSchema>;
export type Stats = z.infer<typeof statsSchema>;
export interface HallBlock {
  occupancyId: string;
  blockId: string;
  hallId: string;
  reason: string;
  from: string;
  to: string;
}

const BOOKING_COLUMNS =
  'id, hall_id, start_at, end_at, guests, status, source, customer_name, customer_phone, comment, total_amount, price_snapshot, version, is_demo, created_at, payments(kind, amount, method, received_at)';

export const ownerApi = {
  async tenant(slug: string): Promise<OwnerTenant | null> {
    const { data, error } = await getSupabase()
      .from('public_tenants')
      .select('id, slug, name, timezone, status, theme, deposit_percent')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw new OwnerError('DB', error.message);
    return data ? ownerTenantSchema.parse(data) : null;
  },

  async role(tenantId: string, userId: string): Promise<'owner' | 'staff' | null> {
    const { data, error } = await getSupabase()
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new OwnerError('DB', error.message);
    return data?.role ?? null;
  },

  async halls(tenantId: string): Promise<OwnerHall[]> {
    const { data, error } = await getSupabase()
      .from('halls')
      .select('id, name, min_duration_min, slot_step_min, capacity_included, capacity_max, sort')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sort');
    if (error) throw new OwnerError('DB', error.message);
    return z.array(ownerHallSchema).parse(data);
  },

  /** Брони с началом в [from, to). */
  async bookings(
    tenantId: string,
    from: Date,
    to: Date,
    opts: { includeCancelled?: boolean; ascending?: boolean } = {},
  ): Promise<OwnerBooking[]> {
    let q = getSupabase()
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .eq('tenant_id', tenantId)
      .gte('start_at', from.toISOString())
      .lt('start_at', to.toISOString())
      .order('start_at', { ascending: opts.ascending ?? true })
      .limit(500);
    if (!opts.includeCancelled) q = q.neq('status', 'cancelled');
    const { data, error } = await q;
    if (error) throw new OwnerError('DB', error.message);
    return z.array(ownerBookingSchema).parse(data);
  },

  /** Активные блокировки залов, пересекающие [from, to). */
  async blocks(tenantId: string, from: Date, to: Date): Promise<HallBlock[]> {
    const { data, error } = await getSupabase()
      .from('resource_occupancies')
      .select('id, hall_id, occupied, hall_blocks(id, reason)')
      .eq('tenant_id', tenantId)
      .eq('kind', 'block')
      .eq('active', true)
      .overlaps('occupied', `[${from.toISOString()},${to.toISOString()})`);
    if (error) throw new OwnerError('DB', error.message);
    return z
      .array(blockRowSchema)
      .parse(data)
      .flatMap((row) => {
        const block = Array.isArray(row.hall_blocks) ? row.hall_blocks[0] : row.hall_blocks;
        const range = parseTstzRange(row.occupied);
        if (!block || !range) return [];
        return [
          {
            occupancyId: row.id,
            blockId: block.id,
            hallId: row.hall_id,
            reason: block.reason,
            ...range,
          },
        ];
      });
  },

  async availability(slug: string, hallId: string, date: string, durationMin: number) {
    const { data, error } = await getSupabase().rpc('get_availability', {
      p_slug: slug,
      p_hall_id: hallId,
      p_date: date,
      p_duration_min: durationMin,
    });
    return unwrap(availabilitySchema, data, error);
  },

  async quote(slug: string, hallId: string, startAt: string, durationMin: number, guests: number) {
    const { data, error } = await getSupabase().rpc('quote_booking', {
      p_slug: slug,
      p_hall_id: hallId,
      p_start_at: startAt,
      p_duration_min: durationMin,
      p_guests: guests,
      p_extras: [],
    });
    return unwrap(quoteSchema, data, error);
  },

  async quickBooking(args: {
    tenantId: string;
    hallId: string;
    startAt: string;
    durationMin: number;
    guests: number;
    name: string;
    phone: string | null;
    source: 'phone' | 'messenger' | 'walk_in';
    comment: string | null;
    idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('owner_quick_booking', {
      p_tenant_id: args.tenantId,
      p_hall_id: args.hallId,
      p_start_at: args.startAt,
      p_duration_min: args.durationMin,
      p_guests: args.guests,
      p_customer_name: args.name,
      p_customer_phone: args.phone ?? undefined,
      p_source: args.source,
      p_comment: args.comment ?? undefined,
      p_extras: [],
      p_idempotency_key: args.idempotencyKey,
    });
    return unwrap(bookingSchema, data, error);
  },

  async cancel(bookingId: string) {
    const { data, error } = await getSupabase().rpc('owner_cancel_booking', {
      p_booking_id: bookingId,
    });
    return unwrap(bookingSchema, data, error);
  },

  async reschedule(bookingId: string, startAt: string, durationMin: number, expectedVersion: number) {
    const { data, error } = await getSupabase().rpc('owner_reschedule_booking', {
      p_booking_id: bookingId,
      p_new_start_at: startAt,
      p_new_duration_min: durationMin,
      p_expected_version: expectedVersion,
    });
    return unwrap(bookingSchema, data, error);
  },

  async setStatus(bookingId: string, status: 'confirmed' | 'completed' | 'no_show') {
    const { data, error } = await getSupabase().rpc('owner_set_booking_status', {
      p_booking_id: bookingId,
      p_status: status,
    });
    return unwrap(bookingSchema, data, error);
  },

  async addPayment(
    bookingId: string,
    kind: 'deposit' | 'payment' | 'refund',
    amountKopecks: number,
    method: 'cash' | 'transfer' | 'card',
  ) {
    const { data, error } = await getSupabase().rpc('owner_add_payment', {
      p_booking_id: bookingId,
      p_kind: kind,
      p_amount: amountKopecks,
      p_method: method,
    });
    return unwrap(bookingSchema, data, error);
  },

  async blockHall(tenantId: string, hallId: string, from: Date, to: Date, reason: string) {
    const { data, error } = await getSupabase().rpc('owner_block_hall', {
      p_tenant_id: tenantId,
      p_hall_id: hallId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_reason: reason,
    });
    return unwrap(z.object({ ok: z.literal(true), block_id: z.uuid() }), data, error);
  },

  async unblock(blockId: string) {
    const { data, error } = await getSupabase().rpc('owner_unblock_hall', { p_block_id: blockId });
    return unwrap(z.object({ ok: z.literal(true) }), data, error);
  },

  async stats(tenantId: string, from: string, to: string) {
    const { data, error } = await getSupabase().rpc('owner_stats', {
      p_tenant_id: tenantId,
      p_from: from,
      p_to: to,
    });
    return unwrap(statsSchema, data, error);
  },
};

export function paidAmount(b: OwnerBooking): number {
  return b.payments.reduce((sum, p) => sum + (p.kind === 'refund' ? -p.amount : p.amount), 0);
}
