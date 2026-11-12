/**
 * Этап 4: HTTP-тесты public-api и границы доступа владельца против локального стека.
 * Нужны `npx supabase start` и `npm run dev:functions` (supabase functions serve).
 */
import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect, createFixture, dropFixture, type Fixture } from './db';
import { adminClient, anonClient, API, api, assertFunctionsServed, randomIp } from './http';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Начало брони через 3 дня в 12:00 по Москве (шаг фикстуры — 60 мин). */
function startAt(daysAhead = 3, hour = 12): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(
    new Date(Date.now() + daysAhead * 86_400_000),
  );
  return `${day}T${String(hour).padStart(2, '0')}:00:00+03:00`;
}

const phone = () => `+7900${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

describe('public-api (HTTP)', () => {
  let db: pg.Client;
  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    await assertFunctionsServed();
    db = await connect();
    a = await createFixture(db);
    b = await createFixture(db);
  });

  afterAll(async () => {
    await dropFixture(db, a);
    await dropFixture(db, b);
    await db.end();
  });

  const bookingBody = (fx: Fixture, key: string, guests = 2, hour = 12) => ({
    hall_id: fx.hallId,
    start_at: startAt(3, hour),
    duration_min: 120,
    guests,
    extras: [],
    customer_name: 'Тест HTTP',
    customer_phone: phone(),
    consent: true,
    idempotency_key: key,
  });

  it('создание и повтор с тем же ключом → та же бронь и тот же токен', async () => {
    const key = `http-${randomUUID()}`;
    const body = bookingBody(a, key);
    const first = await api(`/t/${a.slug}/bookings`, { method: 'POST', body, ip: randomIp() });
    expect(first.status).toBe(201);
    expect(first.body.token).toMatch(TOKEN_RE);

    const retry = await api(`/t/${a.slug}/bookings`, { method: 'POST', body, ip: randomIp() });
    expect(retry.status).toBe(200);
    expect(retry.body.replay).toBe(true);
    expect(retry.body.token).toBe(first.body.token);
    expect((retry.body.booking as { booking_id: string }).booking_id).toBe(
      (first.body.booking as { booking_id: string }).booking_id,
    );

    // Тот же ключ, другое тело — конфликт, а не вторая бронь.
    const conflict = await api(`/t/${a.slug}/bookings`, {
      method: 'POST',
      body: { ...body, guests: 3 },
      ip: randomIp(),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('IDEMPOTENCY_CONFLICT');

    const { rows } = await db.query(
      'select count(*)::int as n from public.bookings where tenant_id = $1',
      [a.tenantId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('бронь по токену: свой → 200, чужой или выдуманный → 404', async () => {
    const created = await api(`/t/${a.slug}/bookings`, {
      method: 'POST',
      body: bookingBody(a, `http-${randomUUID()}`, 2, 16),
      ip: randomIp(),
    });
    expect(created.status).toBe(201);
    const token = String(created.body.token);

    const own = await api(`/t/${a.slug}/bookings/${token}`, { ip: randomIp() });
    expect(own.status).toBe(200);
    expect(own.body.ok).toBe(true);

    const madeUp = 'A'.repeat(43);
    const fake = await api(`/t/${a.slug}/bookings/${madeUp}`, { ip: randomIp() });
    expect(fake.status).toBe(404);
    expect(fake.body.error).toBe('NOT_FOUND');

    // Токен заведения A по адресу заведения B не находит бронь и не отменяет её.
    const foreign = await api(`/t/${b.slug}/bookings/${token}`, { ip: randomIp() });
    expect(foreign.status).toBe(404);
    const foreignCancel = await api(`/t/${b.slug}/bookings/${token}/cancel`, {
      method: 'POST',
      ip: randomIp(),
    });
    expect(foreignCancel.status).toBe(404);
    const still = await api(`/t/${a.slug}/bookings/${token}`, { ip: randomIp() });
    expect(still.body.status).toBe('confirmed');
  });

  it('ICS по токену открывается обычной ссылкой (без apikey)', async () => {
    const created = await api(`/t/${a.slug}/bookings`, {
      method: 'POST',
      body: bookingBody(a, `http-${randomUUID()}`, 2, 20),
      ip: randomIp(),
    });
    expect(created.status).toBe(201);
    const booking = created.body.booking as { booking_id: string; start_at: string };

    const res = await fetch(`${API}/t/${a.slug}/bookings/${String(created.body.token)}.ics`, {
      headers: { 'x-forwarded-for': randomIp() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const ics = await res.text();
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain(`UID:${booking.booking_id}@bani-pwa`);
    const utc = new Date(booking.start_at)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    expect(ics).toContain(`DTSTART:${utc}`);
    expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(
      true,
    );

    const fake = await fetch(`${API}/t/${a.slug}/bookings/${'C'.repeat(43)}.ics`, {
      headers: { 'x-forwarded-for': randomIp() },
    });
    expect(fake.status).toBe(404);
    // Остальное API без apikey по-прежнему закрыто.
    const noKey = await fetch(`${API}/t/${a.slug}`);
    expect(noKey.status).toBe(401);
  });

  it('частые запросы по токенам с одного IP → 429', async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 1) {
      const token = randomUUID().replace(/-/g, '').padEnd(43, 'x');
      statuses.push((await api(`/t/${a.slug}/bookings/${token}`, { ip })).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 404)).toBe(true);
    expect(statuses[60]).toBe(429);
    // Другой IP не задет.
    const other = await api(`/t/${a.slug}/bookings/${'B'.repeat(43)}`, { ip: randomIp() });
    expect(other.status).toBe(404);
  });
});

describe('владелец: доступ только к своему заведению', () => {
  let db: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let userId = '';
  let bookingB = '';
  const email = `owner-${randomUUID().slice(0, 8)}@it.test`;
  const password = `pw-${randomUUID()}`;
  const admin = adminClient();
  const owner = anonClient();

  beforeAll(async () => {
    db = await connect();
    a = await createFixture(db);
    b = await createFixture(db);
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error('user');
    userId = created.data.user.id;
    await db.query(
      `insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`,
      [a.tenantId, userId],
    );
    const signIn = await owner.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;

    const { rows } = await db.query<{ r: { booking_id: string } }>(
      `select private.create_booking($1, null, $2, $3::timestamptz, 120, 2, '[]'::jsonb, 'Гость Б',
         '+79000000999', null, 'phone', null, null, null, null, null, null, true, false, 'system') as r`,
      [b.tenantId, b.hallId, startAt(4)],
    );
    bookingB = rows[0]?.r.booking_id ?? '';
    expect(bookingB).not.toBe('');
  });

  afterAll(async () => {
    await owner.auth.signOut();
    await dropFixture(db, a);
    await dropFixture(db, b);
    await admin.auth.admin.deleteUser(userId);
    await db.end();
  });

  it('видит брони только своего заведения', async () => {
    const { data, error } = await owner.from('bookings').select('id').eq('tenant_id', b.tenantId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('owner-функции на чужом заведении отказывают, на своём работают', async () => {
    // Чужая бронь неотличима от несуществующей — её существование не раскрывается.
    const cancel = await owner.rpc('owner_cancel_booking', { p_booking_id: bookingB });
    expect(cancel.data).toMatchObject({ ok: false, error: 'NOT_FOUND' });

    const today = new Date().toISOString().slice(0, 10);
    const foreignStats = await owner.rpc('owner_stats', {
      p_tenant_id: b.tenantId,
      p_from: today,
      p_to: today,
    });
    expect(foreignStats.data).toMatchObject({ ok: false, error: 'FORBIDDEN' });

    const ownStats = await owner.rpc('owner_stats', {
      p_tenant_id: a.tenantId,
      p_from: today,
      p_to: today,
    });
    expect(ownStats.error).toBeNull();
    expect(ownStats.data).toHaveProperty('bookings_created');

    const { rows } = await db.query('select status from public.bookings where id = $1', [bookingB]);
    expect(rows[0]?.status).not.toBe('cancelled');
  });

  it('гость без входа не читает брони напрямую', async () => {
    const { data } = await anonClient().from('bookings').select('id').eq('tenant_id', b.tenantId);
    expect(data ?? []).toEqual([]);
  });
});
