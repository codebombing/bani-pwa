// Zod-схемы аргументов публичного API. Клиент не передаёт цену, tenant_id и время окончания.
import { z } from 'zod';

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .min(3)
  .max(40);

const extrasSchema = z
  .array(z.object({ extra_id: z.uuid(), qty: z.number().int().min(1).max(99) }))
  .max(20)
  .default([]);

const startAt = z.iso.datetime({ offset: true });

export const availabilityQuerySchema = z.object({
  hall_id: z.uuid(),
  date: z.iso.date(),
  duration_min: z.coerce.number().int().min(15).max(1440).optional(),
});

export const quoteBodySchema = z.object({
  hall_id: z.uuid(),
  start_at: startAt,
  duration_min: z.number().int().min(15).max(1440),
  guests: z.number().int().min(1).max(100),
  extras: extrasSchema,
});

export const createBookingBodySchema = quoteBodySchema.extend({
  customer_name: z.string().trim().min(1).max(120),
  customer_phone: z.string().regex(/^\+[0-9]{10,15}$/, 'Телефон в формате +7XXXXXXXXXX'),
  comment: z.string().max(1000).optional(),
  consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
  idempotency_key: z.string().min(8).max(128),
});

export const rescheduleBodySchema = z.object({
  start_at: startAt,
  duration_min: z.number().int().min(15).max(1440).optional(),
  expected_version: z.number().int().min(1).optional(),
});

/** PushSubscription.toJSON() из браузера. */
export const pushBodySchema = z.object({
  endpoint: z
    .string()
    .max(1000)
    .regex(/^https:\/\/[^\s]+$/),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export type CreateBookingBody = z.infer<typeof createBookingBodySchema>;
