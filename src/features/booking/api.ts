import { z } from 'zod';

import { readPublicEnv } from '../../shared/env';
import type { PushSubscriptionBody } from '../../shared/push';

/** Клиент Edge Function public-api. Все ответы проходят Zod; цену считает только сервер. */

export const hallSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  capacity_included: z.number().int(),
  capacity_max: z.number().int(),
  extra_guest_price: z.number().int(),
  extra_guest_unit: z.enum(['per_hour', 'per_booking']),
  min_duration_min: z.number().int(),
  slot_step_min: z.number().int(),
  photos: z.array(z.string()),
});

export const extraSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.number().int(),
  unit: z.enum(['per_booking', 'per_hour', 'per_guest']),
  max_qty: z.number().int(),
});

export const tenantSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  status: z.enum(['preview', 'live', 'archived']),
  theme: z.object({
    accent: z.string().optional(),
    hero: z.string().optional(),
    logo: z.string().optional(),
  }),
  texts: z.object({
    tagline: z.string().optional(),
    description: z.string().optional(),
    booking_note: z.string().optional(),
  }),
  contacts: z.object({
    phone: z.string().optional(),
    telegram: z.string().optional(),
    address: z.string().optional(),
  }),
  legal: z.object({
    operator_name: z.string().optional(),
    privacy_policy_url: z.string().optional(),
  }),
  deposit_percent: z.number().int(),
  free_cancellation_hours: z.number().int(),
  /** Версия опубликованного конфига: ?v= у картинок обходит кэш после tenant:publish. */
  config_version: z.number().int().default(0),
});

export const catalogSchema = z.object({
  tenant: tenantSchema,
  halls: z.array(hallSchema),
  extras: z.array(extraSchema),
});

export const slotSchema = z.object({
  start_at: z.string(),
  end_at: z.string(),
  local_start: z.string(),
  local_end: z.string(),
  total: z.number().int(),
});

export const availabilitySchema = z.object({
  closed: z.boolean(),
  date: z.string(),
  duration_min: z.number().int(),
  slots: z.array(slotSchema),
});

const rentLineSchema = z.object({
  from: z.string(),
  to: z.string(),
  day_type: z.enum(['weekday', 'weekend', 'holiday']),
  price_per_hour: z.number().int(),
  minutes: z.number().int(),
  amount: z.number().int(),
});

export const snapshotSchema = z.object({
  rent: z.array(rentLineSchema).default([]),
  extra_guests: z
    .object({ count: z.number().int(), unit_price: z.number().int(), amount: z.number().int() })
    .optional(),
  extras: z
    .array(
      z.object({
        name: z.string(),
        qty: z.number().int(),
        unit: z.string(),
        unit_price: z.number().int(),
        amount: z.number().int(),
      }),
    )
    .default([]),
  total: z.number().int(),
  deposit_amount: z.number().int().optional(),
  manual_price: z.boolean().optional(),
});

export const quoteSchema = z.object({
  total: z.number().int(),
  deposit_amount: z.number().int(),
  snapshot: snapshotSchema,
  start_at: z.string(),
  end_at: z.string(),
  available: z.boolean(),
});

export const bookingSchema = z.object({
  booking_id: z.uuid(),
  tenant_slug: z.string(),
  timezone: z.string(),
  hall_id: z.uuid(),
  hall_name: z.string(),
  start_at: z.string(),
  end_at: z.string(),
  duration_min: z.number().int(),
  guests: z.number().int(),
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']),
  customer_name: z.string(),
  customer_phone: z.string().nullable(),
  comment: z.string().nullable(),
  total_amount: z.number().int(),
  deposit_amount: z.number().int(),
  paid_amount: z.number().int(),
  version: z.number().int(),
  is_demo: z.boolean(),
  price_snapshot: snapshotSchema,
  free_cancellation_until: z.string(),
  deposit_refundable: z.boolean().optional(),
});

export const createdSchema = z.object({
  replay: z.boolean(),
  token: z.string(),
  booking: bookingSchema,
});

export type Catalog = z.infer<typeof catalogSchema>;
export type Hall = z.infer<typeof hallSchema>;
export type Extra = z.infer<typeof extraSchema>;
export type Tenant = z.infer<typeof tenantSchema>;
export type Slot = z.infer<typeof slotSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export interface ExtraChoice {
  extra_id: string;
  qty: number;
}

export interface QuoteInput {
  hall_id: string;
  start_at: string;
  duration_min: number;
  guests: number;
  extras: ExtraChoice[];
}

export interface CreateInput extends QuoteInput {
  customer_name: string;
  customer_phone: string;
  comment?: string;
  consent: true;
  idempotency_key: string;
}

const errorSchema = z.object({ error: z.string(), message: z.string() });

/** Текст ошибки для UI (TanStack Query отдаёт error как unknown). */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Что-то пошло не так, попробуйте ещё раз';
}

/** Ошибка API с кодом бизнес-правила (SLOT_TAKEN, RATE_LIMITED, …). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Публичная картинка заведения из Storage (tenant-assets/<tenant_id>/config/<path>). */
export function assetUrl(
  tenant: { id: string; config_version: number },
  path: string,
): string | null {
  const env = readPublicEnv();
  if (!env.success) return null;
  const clean = path.split('/').map(encodeURIComponent).join('/');
  return `${env.data.VITE_SUPABASE_URL}/storage/v1/object/public/tenant-assets/${tenant.id}/config/${clean}?v=${tenant.config_version}`;
}

/** Ссылка на .ics брони: открывается без заголовков, пропуск — сам токен. */
export function bookingIcsUrl(slug: string, token: string): string | null {
  const env = readPublicEnv();
  if (!env.success) return null;
  return `${env.data.VITE_SUPABASE_URL}/functions/v1/public-api/t/${encodeURIComponent(slug)}/bookings/${encodeURIComponent(token)}.ics`;
}

function baseUrl(slug: string): { url: string; key: string } {
  const env = readPublicEnv();
  if (!env.success) throw new ApiError('CONFIG', 'Приложение не настроено (VITE_SUPABASE_*)', 0);
  return {
    url: `${env.data.VITE_SUPABASE_URL}/functions/v1/public-api/t/${encodeURIComponent(slug)}`,
    key: env.data.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

async function request<T>(
  slug: string,
  path: string,
  schema: z.ZodType<T>,
  init?: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const { url, key } = baseUrl(slug);
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: init?.method ?? 'GET',
      headers: { apikey: key, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', 'Нет связи с сервером. Проверьте интернет и повторите.', 0);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = errorSchema.safeParse(data);
    throw err.success
      ? new ApiError(err.data.error, err.data.message, res.status)
      : new ApiError('SERVER_ERROR', 'Ошибка сервера, попробуйте ещё раз', res.status);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'Неожиданный ответ сервера', res.status);
  return parsed.data;
}

export const publicApi = {
  catalog: (slug: string, signal?: AbortSignal) => request(slug, '', catalogSchema, { signal }),
  availability: (
    slug: string,
    q: { hall_id: string; date: string; duration_min: number },
    signal?: AbortSignal,
  ) =>
    request(
      slug,
      `/availability?${new URLSearchParams({
        hall_id: q.hall_id,
        date: q.date,
        duration_min: String(q.duration_min),
      }).toString()}`,
      availabilitySchema,
      { signal },
    ),
  quote: (slug: string, body: QuoteInput, signal?: AbortSignal) =>
    request(slug, '/quote', quoteSchema, { method: 'POST', body, signal }),
  create: (slug: string, body: CreateInput) =>
    request(slug, '/bookings', createdSchema, { method: 'POST', body }),
  booking: (slug: string, token: string, signal?: AbortSignal) =>
    request(slug, `/bookings/${encodeURIComponent(token)}`, bookingSchema, { signal }),
  cancel: (slug: string, token: string) =>
    request(slug, `/bookings/${encodeURIComponent(token)}/cancel`, bookingSchema, {
      method: 'POST',
    }),
  pushSubscribe: (slug: string, token: string, body: PushSubscriptionBody) =>
    request(
      slug,
      `/bookings/${encodeURIComponent(token)}/push`,
      z.object({ ok: z.literal(true) }),
      {
        method: 'POST',
        body,
      },
    ),
  reschedule: (
    slug: string,
    token: string,
    body: { start_at: string; duration_min: number; expected_version: number },
  ) =>
    request(slug, `/bookings/${encodeURIComponent(token)}/reschedule`, bookingSchema, {
      method: 'POST',
      body,
    }),
};
