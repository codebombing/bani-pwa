import { z } from "zod";

import type { PushSubscriptionBody } from "../../shared/push";
import { getSupabase } from "../../shared/supabase";
import { availabilitySchema, bookingSchema, snapshotSchema } from "../booking/api";

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
  return error instanceof Error ? error.message : "Что-то пошло не так, попробуйте ещё раз";
}

const rpcFailSchema = z.object({ ok: z.literal(false), error: z.string(), message: z.string() });

function unwrap<T>(schema: z.ZodType<T>, data: unknown, error: { message: string } | null): T {
  if (error) throw new OwnerError("DB", error.message);
  const fail = rpcFailSchema.safeParse(data);
  if (fail.success) throw new OwnerError(fail.data.error, fail.data.message);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new OwnerError("BAD_RESPONSE", "Неожиданный ответ сервера");
  return parsed.data;
}

/** PostgREST отдаёт границы tstzrange как «2026-11-16 07:00:00+00» — приводим к ISO. */
export function pgTimestampToIso(value: string): string {
  const iso = value.trim().replace(" ", "T");
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
  status: z.enum(["preview", "live", "archived"]),
  theme: z.object({ accent: z.string().optional() }),
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

export const ownerBookingSchema = z.object({
  id: z.uuid(),
  hall_id: z.uuid(),
  start_at: z.string(),
  end_at: z.string(),
  guests: z.number().int(),
  status: z.enum(["pending", "confirmed", "completed", "cancelled", "no_show"]),
  source: z.enum(["online", "phone", "messenger", "walk_in", "owner"]),
  customer_name: z.string(),
  customer_phone: z.string().nullable(),
  comment: z.string().nullable(),
  total_amount: z.number().int(),
  price_snapshot: snapshotSchema,
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: z.string(),
  seen_at: z.string().nullable(),
});

const blockRefSchema = z.object({ id: z.uuid(), reason: z.string() });
const blockRowSchema = z.object({
  id: z.uuid(),
  hall_id: z.uuid(),
  occupied: z.string(),
  hall_blocks: z.union([blockRefSchema, z.array(blockRefSchema), z.null()]),
});

export type OwnerTenant = z.infer<typeof ownerTenantSchema>;
export type OwnerHall = z.infer<typeof ownerHallSchema>;
export type OwnerBooking = z.infer<typeof ownerBookingSchema>;
export interface HallBlock {
  occupancyId: string;
  blockId: string;
  hallId: string;
  reason: string;
  from: string;
  to: string;
}

const BOOKING_COLUMNS =
  "id, hall_id, start_at, end_at, guests, status, source, customer_name, customer_phone, comment, total_amount, price_snapshot, version, is_demo, created_at, seen_at";

export const ownerApi = {
  async tenant(slug: string): Promise<OwnerTenant | null> {
    const { data, error } = await getSupabase()
      .from("public_tenants")
      .select("id, slug, name, timezone, status, theme")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new OwnerError("DB", error.message);
    return data ? ownerTenantSchema.parse(data) : null;
  },

  async role(tenantId: string, userId: string): Promise<"owner" | "staff" | null> {
    const { data, error } = await getSupabase()
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new OwnerError("DB", error.message);
    return data?.role ?? null;
  },

  async halls(tenantId: string): Promise<OwnerHall[]> {
    const { data, error } = await getSupabase()
      .from("halls")
      .select("id, name, min_duration_min, slot_step_min, capacity_included, capacity_max, sort")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort");
    if (error) throw new OwnerError("DB", error.message);
    return z.array(ownerHallSchema).parse(data);
  },

  /** Неотменённые брони с началом в [from, to). */
  async bookings(
    tenantId: string,
    from: Date,
    to: Date,
    opts: { ascending?: boolean } = {},
  ): Promise<OwnerBooking[]> {
    const { data, error } = await getSupabase()
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("tenant_id", tenantId)
      .gte("start_at", from.toISOString())
      .lt("start_at", to.toISOString())
      .neq("status", "cancelled")
      .order("start_at", { ascending: opts.ascending ?? true })
      .limit(500);
    if (error) throw new OwnerError("DB", error.message);
    return z.array(ownerBookingSchema).parse(data);
  },

  /** Активные блокировки залов, пересекающие [from, to). */
  async blocks(tenantId: string, from: Date, to: Date): Promise<HallBlock[]> {
    const { data, error } = await getSupabase()
      .from("resource_occupancies")
      .select("id, hall_id, occupied, hall_blocks(id, reason)")
      .eq("tenant_id", tenantId)
      .eq("kind", "block")
      .eq("active", true)
      .overlaps("occupied", `[${from.toISOString()},${to.toISOString()})`);
    if (error) throw new OwnerError("DB", error.message);
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
    const { data, error } = await getSupabase().rpc("get_availability", {
      p_slug: slug,
      p_hall_id: hallId,
      p_date: date,
      p_duration_min: durationMin,
    });
    return unwrap(availabilitySchema, data, error);
  },

  async cancel(bookingId: string) {
    const { data, error } = await getSupabase().rpc("owner_cancel_booking", {
      p_booking_id: bookingId,
    });
    return unwrap(bookingSchema, data, error);
  },

  async reschedule(
    bookingId: string,
    startAt: string,
    durationMin: number,
    expectedVersion: number,
  ) {
    const { data, error } = await getSupabase().rpc("owner_reschedule_booking", {
      p_booking_id: bookingId,
      p_new_start_at: startAt,
      p_new_duration_min: durationMin,
      p_expected_version: expectedVersion,
    });
    return unwrap(bookingSchema, data, error);
  },

  async deleteBooking(bookingId: string) {
    const { data, error } = await getSupabase().rpc("owner_delete_booking", {
      p_booking_id: bookingId,
    });
    return unwrap(z.object({ ok: z.literal(true) }), data, error);
  },

  async markSeen(bookingId: string) {
    const { data, error } = await getSupabase().rpc("owner_mark_seen", { p_booking_id: bookingId });
    return unwrap(z.object({ ok: z.literal(true) }), data, error);
  },

  /** Сколько онлайн-броней ещё не открывали в кабинете. */
  async unseenCount(tenantId: string): Promise<number> {
    const { count, error } = await getSupabase()
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("seen_at", null)
      .neq("status", "cancelled");
    if (error) throw new OwnerError("DB", error.message);
    return count ?? 0;
  },

  async blockHall(tenantId: string, hallId: string, from: Date, to: Date, reason: string) {
    const { data, error } = await getSupabase().rpc("owner_block_hall", {
      p_tenant_id: tenantId,
      p_hall_id: hallId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_reason: reason,
    });
    return unwrap(z.object({ ok: z.literal(true), block_id: z.uuid() }), data, error);
  },

  async unblock(blockId: string) {
    const { data, error } = await getSupabase().rpc("owner_unblock_hall", { p_block_id: blockId });
    return unwrap(z.object({ ok: z.literal(true) }), data, error);
  },

  async pushSubscribe(tenantId: string, sub: PushSubscriptionBody) {
    const { data, error } = await getSupabase().rpc("owner_push_subscribe", {
      p_tenant_id: tenantId,
      p_endpoint: sub.endpoint,
      p_p256dh: sub.keys.p256dh,
      p_auth: sub.keys.auth,
    });
    return unwrap(z.object({ ok: z.literal(true) }), data, error);
  },
};
