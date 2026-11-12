/**
 * Этап 8: AI-ассистент (ai-chat) — границы режимов и работа без LLM.
 * Локально LLM не настроен (LLM_* пусты): ассистент отвечает по результату инструмента,
 * а бронирование от него не зависит.
 */
import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect, createFixture, dropFixture, type Fixture } from './db';
import {
  adminClient,
  anonClient,
  api,
  assertFunctionsServed,
  PUBLISHABLE_KEY,
  randomIp,
  SUPABASE_URL,
} from './http';

const AI = `${SUPABASE_URL}/functions/v1/ai-chat`;

interface AiReply {
  ok: boolean;
  answer?: string;
  tool?: string | null;
  llm?: boolean;
  reason?: string | null;
  error?: string;
}

async function ask(
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<{ status: number; body: AiReply }> {
  const res = await fetch(AI, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'content-type': 'application/json',
      'x-forwarded-for': randomIp(),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as AiReply };
}

const user = (content: string) => [{ role: 'user', content }];

function moscowDay(daysAhead: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(
    new Date(Date.now() + daysAhead * 86_400_000),
  );
}

describe('ai-chat', () => {
  let db: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let userId = '';
  let accessToken = '';
  const admin = adminClient();

  beforeAll(async () => {
    await assertFunctionsServed();
    db = await connect();
    a = await createFixture(db);
    b = await createFixture(db);
    const email = `ai-owner-${randomUUID().slice(0, 8)}@it.test`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error('user');
    userId = created.data.user.id;
    await db.query(
      `insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`,
      [a.tenantId, userId],
    );
    const session = await anonClient().auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;
    accessToken = session.data.session.access_token;
  });

  afterAll(async () => {
    await dropFixture(db, a);
    await dropFixture(db, b);
    await admin.auth.admin.deleteUser(userId);
    await db.end();
  });

  it('гость: свободное время отвечает и без LLM', async () => {
    const r = await ask({ mode: 'guest', slug: a.slug, messages: user('Что свободно завтра?') });
    expect(r.status).toBe(200);
    expect(r.body.tool).toBe('check_availability');
    expect(r.body.llm).toBe(false);
    expect(r.body.reason).toBe('not_configured');
    expect(r.body.answer).toMatch(/Зал/);
  });

  it('гость не может вызвать инструменты владельца (даже передав их явно)', async () => {
    for (const q of ['Сколько заработали за месяц?', 'Найди бронь у Анны', 'Кто сегодня придёт?']) {
      const r = await ask({ mode: 'guest', slug: a.slug, tool: 'stats', messages: user(q) });
      expect(r.status).toBe(200);
      expect(['stats', 'find_booking', 'day_schedule']).not.toContain(r.body.tool);
      expect(r.body.answer ?? '').not.toMatch(/получено|ожидается/);
    }
  });

  it('гость видит свою бронь только по токену своей брони', async () => {
    const created = await api(`/t/${a.slug}/bookings`, {
      method: 'POST',
      ip: randomIp(),
      body: {
        hall_id: a.hallId,
        start_at: `${moscowDay(6)}T13:00:00+03:00`,
        duration_min: 120,
        guests: 3,
        extras: [],
        customer_name: 'AI Гость',
        customer_phone: '+79001110022',
        consent: true,
        idempotency_key: `ai-${randomUUID()}`,
      },
    });
    expect(created.status).toBe(201);
    const token = String(created.body.token);

    const mine = await ask({
      mode: 'guest',
      slug: a.slug,
      token,
      messages: user('Когда у меня бронь?'),
    });
    expect(mine.body.tool).toBe('get_my_booking');
    expect(mine.body.answer).toMatch(/гостей 3/);

    const noToken = await ask({
      mode: 'guest',
      slug: a.slug,
      messages: user('Когда у меня бронь?'),
    });
    expect(noToken.body.tool).toBeNull();

    // Токен заведения A по адресу B ничего не раскрывает.
    const foreign = await ask({
      mode: 'guest',
      slug: b.slug,
      token,
      messages: user('Когда у меня бронь?'),
    });
    expect(foreign.body.answer).not.toMatch(/гостей 3/);
  });

  it('владелец: без входа и в чужом заведении — 403, в своём — статистика и поиск', async () => {
    const anon = await ask({ mode: 'owner', slug: a.slug, messages: user('Сколько заработали?') });
    expect(anon.status).toBe(403);

    const foreign = await ask(
      { mode: 'owner', slug: b.slug, messages: user('Сколько заработали за месяц?') },
      accessToken,
    );
    expect(foreign.status).toBe(403);

    const own = await ask(
      { mode: 'owner', slug: a.slug, messages: user('Сколько заработали за месяц?') },
      accessToken,
    );
    expect(own.status).toBe(200);
    expect(own.body.tool).toBe('stats');
    expect(own.body.answer).toMatch(/получено/);

    const search = await ask(
      { mode: 'owner', slug: a.slug, messages: user('Найди бронь у Гостя') },
      accessToken,
    );
    expect(search.body.tool).toBe('find_booking');
  });

  it('AI недоступен → бронирование работает', async () => {
    const r = await ask({ mode: 'guest', slug: a.slug, messages: user('Привет') });
    expect(r.body.llm).toBe(false);
    const created = await api(`/t/${a.slug}/bookings`, {
      method: 'POST',
      ip: randomIp(),
      body: {
        hall_id: a.hallId,
        start_at: `${moscowDay(7)}T10:00:00+03:00`,
        duration_min: 120,
        guests: 2,
        extras: [],
        customer_name: 'Без AI',
        customer_phone: '+79001110033',
        consent: true,
        idempotency_key: `noai-${randomUUID()}`,
      },
    });
    expect(created.status).toBe(201);
  });
});
