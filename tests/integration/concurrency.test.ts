import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connect,
  createFixture,
  dropFixture,
  type BookingResult,
  type Fixture,
  publicCreateBooking,
} from './db';

const PARALLEL = 20;

// Счётчики rate limit живут в БД час: телефоны и IP уникальны для каждого прогона.
const runTag = Math.floor(Math.random() * 250) + 1;
const phone = (i: number) => `+79${String(runTag).padStart(3, '0')}${String(i).padStart(7, '0')}`;
const ip = (i: number) => `198.51.${runTag}.${i + 1}`;

describe('конкурентная бронь одного слота', () => {
  let admin: pg.Client;
  let fx: Fixture;
  let clients: pg.Client[] = [];

  beforeAll(async () => {
    admin = await connect();
    fx = await createFixture(admin);
    // 20 отдельных подключений с ролью service_role (как у Edge Function).
    clients = await Promise.all(Array.from({ length: PARALLEL }, () => connect('service_role')));
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end()));
    if (fx) await dropFixture(admin, fx);
    await admin?.end();
  });

  it(`${PARALLEL} параллельных запросов на один слот: ровно 1 успех, ${PARALLEL - 1} SLOT_TAKEN`, async () => {
    const startAt = '2028-06-15T12:00:00+03:00';
    const results: BookingResult[] = await Promise.all(
      clients.map((client, i) =>
        publicCreateBooking(client, {
          slug: fx.slug,
          hallId: fx.hallId,
          startAt,
          durationMin: 120,
          idempotencyKey: `conc-${randomUUID()}`,
          phone: phone(i),
          ip: ip(i),
        }),
      ),
    );

    const ok = results.filter((r) => r.ok);
    const errors = results.flatMap((r) => (r.ok ? [] : [r.error]));
    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(PARALLEL - 1);
    expect(new Set(errors)).toEqual(new Set(['SLOT_TAKEN']));

    const { rows } = await admin.query<{ bookings: number; active: number }>(
      `select (select count(*)::int from public.bookings where tenant_id = $1) as bookings,
              (select count(*)::int from public.resource_occupancies where tenant_id = $1 and active) as active`,
      [fx.tenantId],
    );
    expect(rows[0]).toEqual({ bookings: 1, active: 1 });
  });

  it(`${PARALLEL} параллельных повторов с одним ключом идемпотентности: одна бронь, один booking_id`, async () => {
    const key = `same-${randomUUID()}`;
    const results = await Promise.all(
      clients.map((client) =>
        publicCreateBooking(client, {
          slug: fx.slug,
          hallId: fx.hallId,
          startAt: '2028-06-16T12:00:00+03:00',
          durationMin: 120,
          idempotencyKey: key,
          phone: phone(9_999_999),
          ip: ip(250),
        }),
      ),
    );

    expect(results.filter((r) => !r.ok)).toEqual([]);
    const ids = new Set(results.map((r) => (r.ok ? r.booking_id : r.error)));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.ok && r.replay === false)).toHaveLength(1);

    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from public.bookings
       where tenant_id = $1 and start_at = '2028-06-16T12:00:00+03:00'`,
      [fx.tenantId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
