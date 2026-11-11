import { createHash, randomUUID } from 'node:crypto';

import pg from 'pg';
import { z } from 'zod';

/** Строка подключения к локальной БД Supabase (только локально/CI, не в браузере). */
export const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export async function connect(role?: 'service_role'): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  if (role) await client.query(`set role ${role}`);
  return client;
}

export const sha256 = (input: string) => createHash('sha256').update(input).digest();
export const sha256hex = (input: string) => createHash('sha256').update(input).digest('hex');

/** Ответ SQL-функций бронирования (граница БД → Zod). */
export const bookingResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    booking_id: z.uuid(),
    replay: z.boolean().optional(),
    total_amount: z.number().int(),
  }),
  z.object({ ok: z.literal(false), error: z.string(), message: z.string() }),
]);
export type BookingResult = z.infer<typeof bookingResultSchema>;

export interface Fixture {
  tenantId: string;
  slug: string;
  hallId: string;
}

/** Временное круглосуточное заведение с одним залом и тарифом. */
export async function createFixture(admin: pg.Client): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `it-${suffix}`;
  const { rows } = await admin.query<{ tenant_id: string; hall_id: string }>(
    `with t as (
       insert into public.tenants (slug, name, status, timezone, deposit_percent)
       values ($1, 'Integration', 'live', 'Europe/Moscow', 30) returning id
     ), wh as (
       insert into public.working_hours (tenant_id, weekday, start_from, start_to)
       select t.id, d, time '00:00', time '24:00' from t, generate_series(1, 7) d
     ), h as (
       insert into public.halls (tenant_id, key, name, capacity_included, capacity_max,
         min_duration_min, slot_step_min, buffer_min)
       select t.id, 'main', 'Зал', 4, 8, 120, 60, 30 from t returning id, tenant_id
     ), v as (
       insert into public.tariff_versions (tenant_id, hall_id, effective_from)
       select h.tenant_id, h.id, date '2026-01-01' from h returning id, tenant_id
     ), r as (
       insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time, price_per_hour)
       select v.tenant_id, v.id, dt::public.day_type, time '00:00', time '24:00', 200000
       from v, unnest(array['weekday', 'weekend']) dt
     )
     select h.tenant_id, h.id as hall_id from h`,
    [slug],
  );
  const row = rows[0];
  if (!row) throw new Error('fixture not created');
  return { tenantId: row.tenant_id, slug, hallId: row.hall_id };
}

export async function dropFixture(admin: pg.Client, fx: Fixture): Promise<void> {
  await admin.query('delete from public.bookings where tenant_id = $1', [fx.tenantId]);
  await admin.query('delete from public.tenants where id = $1', [fx.tenantId]);
}

export interface CreateArgs {
  slug: string;
  hallId: string;
  startAt: string;
  durationMin: number;
  idempotencyKey: string;
  phone: string;
  ip: string;
}

/** Вызов public_create_booking так же, как это делает Edge Function public-api. */
export async function publicCreateBooking(client: pg.Client, a: CreateArgs): Promise<BookingResult> {
  const requestHash = sha256hex(JSON.stringify([a.hallId, a.startAt, a.durationMin]));
  const { rows } = await client.query<{ result: unknown }>(
    `select public.public_create_booking($1, $2, $3, $4, $5, 2, '[]'::jsonb, 'Гость', $6, null, true,
       $7, $8, $9, $10) as result`,
    [
      a.slug,
      randomUUID(),
      a.hallId,
      a.startAt,
      a.durationMin,
      a.phone,
      a.idempotencyKey,
      requestHash,
      sha256(`${a.idempotencyKey}:token`),
      a.ip,
    ],
  );
  return bookingResultSchema.parse(rows[0]?.result);
}
