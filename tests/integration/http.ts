import { existsSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// HTTP-тесты ходят в локальный стек: `npx supabase start` + `npx supabase functions serve`.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(20),
    VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  })
  .parse(process.env);

export const SUPABASE_URL = env.SUPABASE_URL;
export const PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const API = `${env.SUPABASE_URL}/functions/v1/public-api`;

export const adminClient = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const anonClient = () =>
  createClient(env.SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Запрос к public-api как из браузера (apikey = publishable), с IP клиента в заголовке. */
export async function api(
  path: string,
  init: { method?: string; body?: unknown; ip?: string } = {},
): Promise<ApiResponse> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.ip ? { 'x-forwarded-for': init.ip } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = z.record(z.string(), z.unknown()).parse(await res.json());
  return { status: res.status, body };
}

/** Доступна ли Edge Function (иначе тесты падают с понятным сообщением). */
export async function assertFunctionsServed(): Promise<void> {
  try {
    await fetch(`${API}/t/healthcheck`, { headers: { apikey: PUBLISHABLE_KEY } });
  } catch {
    throw new Error(`public-api недоступен (${API}). Запустите: npm run dev:functions`);
  }
}

export const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
