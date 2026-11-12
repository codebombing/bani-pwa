// Публичное API гостя. Вызывается фронтендом с publishable-ключом (заголовок apikey).
// Все изменения броней — только через SQL-функции; service role живёт только здесь.
//
//   GET  /public-api/t/:slug                                 заведение, залы, допы
//   GET  /public-api/t/:slug/availability?hall_id&date&duration_min
//   POST /public-api/t/:slug/quote                           предварительная цена
//   POST /public-api/t/:slug/bookings                        создать бронь → { booking, token }
//   GET  /public-api/t/:slug/bookings/:token                 бронь по токену
//   POST /public-api/t/:slug/bookings/:token/cancel          отмена
//   POST /public-api/t/:slug/bookings/:token/reschedule      перенос
//   POST /public-api/t/:slug/bookings/:token/push            подписка на уведомления по брони
//   GET  /public-api/t/:slug/bookings/:token.ics             событие для календаря (без apikey:
//                                                            обычная ссылка; пропуск — сам токен)
import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

import { clientIp, fail, fromRpc, HttpError, json, readJson } from '../_shared/http.ts';
import { bookingIcs } from '../_shared/ics.ts';
import {
  availabilityQuerySchema,
  createBookingBodySchema,
  pushBodySchema,
  quoteBodySchema,
  rescheduleBodySchema,
  slugSchema,
} from '../_shared/schemas.ts';
import { bookingToken, sha256Hex, TOKEN_RE, tokenHashBytea } from '../_shared/token.ts';

type Ctx = Parameters<Parameters<typeof withSupabase>[1]>[1];

type SafeParser<T> = {
  safeParse(
    v: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown[] } };
};

function parse<T>(schema: SafeParser<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new HttpError('VALIDATION_ERROR', 'Некорректные данные запроса', r.error.issues);
  return r.data;
}

/** Атомарный счётчик в БД; при превышении — 429. */
async function rateLimit(ctx: Ctx, key: string, limit: number, window: string) {
  const { data, error } = await ctx.supabaseAdmin.rpc('consume_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window: window,
  });
  if (error) throw error;
  if (data !== true)
    throw new HttpError('RATE_LIMITED', 'Слишком много запросов, попробуйте позже');
}

async function tenantInfo(ctx: Ctx, slug: string): Promise<Response> {
  const db = ctx.supabase; // anon: публичные представления под RLS
  const { data: tenant, error } = await db
    .from('public_tenants')
    .select(
      'id, slug, name, timezone, status, config_version, theme, texts, contacts, legal, pwa, deposit_percent, free_cancellation_hours',
    )
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!tenant) return fail('TENANT_NOT_FOUND', 'Заведение не найдено');

  const [halls, extras] = await Promise.all([
    db
      .from('public_halls')
      .select(
        'id, key, name, description, capacity_included, capacity_max, extra_guest_price, extra_guest_unit, min_duration_min, slot_step_min, photos, sort',
      )
      .eq('tenant_id', tenant.id)
      .order('sort'),
    db
      .from('public_extras')
      .select('id, key, name, description, price, unit, max_qty, sort')
      .eq('tenant_id', tenant.id)
      .order('sort'),
  ]);
  if (halls.error) throw halls.error;
  if (extras.error) throw extras.error;

  return json(
    { ok: true, tenant, halls: halls.data, extras: extras.data },
    200,
    // Публичный каталог можно кэшировать недолго.
    { 'cache-control': 'public, max-age=60' },
  );
}

async function createBooking(req: Request, ctx: Ctx, slug: string): Promise<Response> {
  const body = parse(createBookingBodySchema, await readJson(req));
  const bookingId = crypto.randomUUID();
  // Хэш тела без ключа: повтор с тем же ключом и другим телом → IDEMPOTENCY_CONFLICT.
  const requestHash = await sha256Hex(
    JSON.stringify([
      body.hall_id,
      body.start_at,
      body.duration_min,
      body.guests,
      [...body.extras].sort((a, b) => a.extra_id.localeCompare(b.extra_id)),
      body.customer_name,
      body.customer_phone,
      body.comment ?? null,
    ]),
  );
  const token = await bookingToken(bookingId, body.idempotency_key);

  const { data, error } = await ctx.supabaseAdmin.rpc('public_create_booking', {
    p_slug: slug,
    p_booking_id: bookingId,
    p_hall_id: body.hall_id,
    p_start_at: body.start_at,
    p_duration_min: body.duration_min,
    p_guests: body.guests,
    p_extras: body.extras,
    p_customer_name: body.customer_name,
    p_customer_phone: body.customer_phone,
    p_comment: body.comment ?? null,
    p_consent: body.consent,
    p_idempotency_key: body.idempotency_key,
    p_request_hash: requestHash,
    p_token_hash: await tokenHashBytea(token),
    p_client_ip: clientIp(req),
  });
  if (error) throw error;
  if (!data?.ok) return fromRpc(data);

  // При повторе бронь создана раньше с другим booking_id — токен вычисляется от него.
  const finalToken =
    data.booking_id === bookingId
      ? token
      : await bookingToken(data.booking_id, body.idempotency_key);
  return json(
    { ok: true, replay: data.replay === true, token: finalToken, booking: data },
    data.replay ? 200 : 201,
  );
}

const ICS_PATH_RE = /\/public-api\/t\/([a-z0-9-]+)\/bookings\/([A-Za-z0-9_-]{43})\.ics$/;

/** .ics по токену: ссылку открывает календарь/браузер без заголовков, поэтому без apikey. */
async function bookingIcsResponse(req: Request, ctx: Ctx): Promise<Response> {
  const m = ICS_PATH_RE.exec(new URL(req.url).pathname);
  if (!m?.[1] || !m[2]) return fail('ROUTE_NOT_FOUND', 'Неизвестный адрес');
  const slug = parse(slugSchema, m[1]);
  await rateLimit(ctx, `token:ip:${clientIp(req) ?? 'unknown'}`, 60, '1 minute');

  const { data, error } = await ctx.supabaseAdmin.rpc('get_booking_by_token_hash', {
    p_slug: slug,
    p_token_hash: await tokenHashBytea(m[2]),
  });
  if (error) throw error;
  if (!data?.ok) return fromRpc(data);

  const { data: tenant, error: tErr } = await ctx.supabaseAdmin
    .from('public_tenants')
    .select('name, contacts')
    .eq('slug', slug)
    .maybeSingle();
  if (tErr) throw tErr;
  const contacts = (tenant?.contacts ?? {}) as { address?: string; phone?: string };

  return new Response(
    bookingIcs(data, {
      name: tenant?.name ?? slug,
      address: contacts.address,
      phone: contacts.phone,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="booking.ics"',
        'cache-control': 'no-store',
      },
    },
  );
}

async function route(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const base = parts.indexOf('public-api');
  const [t, rawSlug, resource, token, action] = parts.slice(base + 1);

  if (t !== 't' || !rawSlug) return fail('ROUTE_NOT_FOUND', 'Неизвестный адрес');
  const slug = parse(slugSchema, rawSlug);
  const ip = clientIp(req) ?? 'unknown';

  if (!resource) {
    if (req.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Только GET');
    return await tenantInfo(ctx, slug);
  }

  if (resource === 'availability' && !token) {
    if (req.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Только GET');
    await rateLimit(ctx, `read:ip:${ip}`, 300, '1 minute');
    const q = parse(availabilityQuerySchema, Object.fromEntries(url.searchParams));
    const { data, error } = await ctx.supabaseAdmin.rpc('get_availability', {
      p_slug: slug,
      p_hall_id: q.hall_id,
      p_date: q.date,
      p_duration_min: q.duration_min ?? null,
    });
    if (error) throw error;
    return fromRpc(data);
  }

  if (resource === 'quote' && !token) {
    if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Только POST');
    await rateLimit(ctx, `read:ip:${ip}`, 300, '1 minute');
    const b = parse(quoteBodySchema, await readJson(req));
    const { data, error } = await ctx.supabaseAdmin.rpc('quote_booking', {
      p_slug: slug,
      p_hall_id: b.hall_id,
      p_start_at: b.start_at,
      p_duration_min: b.duration_min,
      p_guests: b.guests,
      p_extras: b.extras,
    });
    if (error) throw error;
    return fromRpc(data);
  }

  if (resource === 'bookings' && !token) {
    if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Только POST');
    return await createBooking(req, ctx, slug);
  }

  if (resource === 'bookings' && token) {
    if (!TOKEN_RE.test(token)) return fail('NOT_FOUND', 'Бронь не найдена');
    // Защита от перебора токенов.
    await rateLimit(ctx, `token:ip:${ip}`, 60, '1 minute');
    const p_token_hash = await tokenHashBytea(token);

    if (!action) {
      if (req.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Только GET');
      const { data, error } = await ctx.supabaseAdmin.rpc('get_booking_by_token_hash', {
        p_slug: slug,
        p_token_hash,
      });
      if (error) throw error;
      return fromRpc(data);
    }
    if (action === 'cancel' && req.method === 'POST') {
      const { data, error } = await ctx.supabaseAdmin.rpc('cancel_booking_by_token', {
        p_slug: slug,
        p_token_hash,
      });
      if (error) throw error;
      return fromRpc(data);
    }
    if (action === 'push' && req.method === 'POST') {
      const b = parse(pushBodySchema, await readJson(req));
      const { data, error } = await ctx.supabaseAdmin.rpc('public_push_subscribe', {
        p_slug: slug,
        p_token_hash,
        p_endpoint: b.endpoint,
        p_p256dh: b.keys.p256dh,
        p_auth: b.keys.auth,
      });
      if (error) throw error;
      return fromRpc(data);
    }
    if (action === 'reschedule' && req.method === 'POST') {
      const b = parse(rescheduleBodySchema, await readJson(req));
      const { data, error } = await ctx.supabaseAdmin.rpc('reschedule_booking_by_token', {
        p_slug: slug,
        p_token_hash,
        p_new_start_at: b.start_at,
        p_new_duration_min: b.duration_min ?? null,
        p_expected_version: b.expected_version ?? null,
      });
      if (error) throw error;
      return fromRpc(data);
    }
  }

  return fail('ROUTE_NOT_FOUND', 'Неизвестный адрес');
}

function guarded(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.code, e.message, e.details);
      console.error('public-api error', e);
      return fail('SERVER_ERROR', 'Ошибка сервера, попробуйте ещё раз');
    }
  };
}

const api = withSupabase({ auth: 'publishable' }, guarded(route));
const ics = withSupabase({ auth: 'none' }, guarded(bookingIcsResponse));

export default {
  fetch: (req: Request) =>
    req.method === 'GET' && ICS_PATH_RE.test(new URL(req.url).pathname) ? ics(req) : api(req),
};
