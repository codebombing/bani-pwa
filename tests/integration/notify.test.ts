/**
 * Этап 7: подписка гостя через public-api и воркер уведомлений по HTTP.
 * Push-сервис в подписке намеренно недоступен (.invalid): проверяем, что воркер захватил
 * задачу, попытался отправить и записал ошибку с отложенным повтором.
 */
import { createECDH, randomBytes, randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect, createFixture, dropFixture, type Fixture } from './db';
import { api, assertFunctionsServed, randomIp, SUPABASE_URL } from './http';

const SECRET = process.env.SUPABASE_SECRET_KEY ?? '';
const WORKER = `${SUPABASE_URL}/functions/v1/notify-worker`;

function fakeSubscription() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://push.invalid/send/${randomUUID()}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

describe('уведомления (HTTP)', () => {
  let db: pg.Client;
  let fx: Fixture;

  beforeAll(async () => {
    await assertFunctionsServed();
    db = await connect();
    fx = await createFixture(db); // live-заведение
  });

  afterAll(async () => {
    await dropFixture(db, fx);
    await db.end();
  });

  it('воркер без секретного ключа недоступен', async () => {
    const res = await fetch(WORKER, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('гость подписывается по токену, воркер пытается доставить и откладывает повтор', async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(
      new Date(Date.now() + 5 * 86_400_000),
    );
    const created = await api(`/t/${fx.slug}/bookings`, {
      method: 'POST',
      ip: randomIp(),
      body: {
        hall_id: fx.hallId,
        start_at: `${day}T15:00:00+03:00`,
        duration_min: 120,
        guests: 2,
        extras: [],
        customer_name: 'Push',
        customer_phone: '+79005554433',
        consent: true,
        idempotency_key: `push-${randomUUID()}`,
      },
    });
    expect(created.status).toBe(201);
    const token = String(created.body.token);
    const bookingId = (created.body.booking as { booking_id: string }).booking_id;

    const sub = await api(`/t/${fx.slug}/bookings/${token}/push`, {
      method: 'POST',
      ip: randomIp(),
      body: fakeSubscription(),
    });
    expect(sub.status).toBe(200);
    const bad = await api(`/t/${fx.slug}/bookings/${token}/push`, {
      method: 'POST',
      ip: randomIp(),
      body: { endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } },
    });
    expect(bad.status).toBe(400);

    // Задачи других тестов не мешают: оставляем «к отправке» только задачи этой брони.
    await db.query(
      `update public.notification_jobs set run_at = now() + interval '1 day'
       where status = 'pending' and booking_id <> $1 and run_at <= now()`,
      [bookingId],
    );

    const res = await fetch(WORKER, { method: 'POST', headers: { apikey: SECRET } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sent: number; failed: number };
    expect(body.ok).toBe(true);
    expect(body.failed).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query<{
      status: string;
      attempts: number;
      last_error: string | null;
    }>(
      `select status, attempts, last_error from public.notification_jobs
       where booking_id = $1 and recipient = 'guest' and kind = 'booking_created'`,
      [bookingId],
    );
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.last_error).toBeTruthy();
  });
});
