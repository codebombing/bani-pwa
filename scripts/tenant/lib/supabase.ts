import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { CliError } from './common';

const adminEnv = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(20),
});
const publicEnv = z.object({
  SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

function readEnv<T>(schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new CliError(
      `Не заданы ${keys} — скопируйте .env.example в .env и заполните из npx supabase status`,
    );
  }
  return parsed.data;
}

/** Клиент с service role: только скрипты конвейера, локально/CI. */
export function adminClient() {
  const env = readEnv(adminEnv);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function publicConfig() {
  const env = readEnv(publicEnv);
  return { url: env.SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY };
}

export const ASSETS_BUCKET = 'tenant-assets';

/** Ответ admin_publish_tenant (граница БД → Zod). */
export const publishResultSchema = z.object({
  ok: z.literal(true),
  tenant_id: z.uuid(),
  slug: z.string(),
  status: z.enum(['preview', 'live', 'archived']),
  config_version: z.number().int(),
  changed: z.boolean(),
  created: z.boolean(),
  hidden_halls_with_bookings: z.array(z.object({ hall: z.string(), future_bookings: z.number() })),
});
