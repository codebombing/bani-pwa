import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './db.types';
import { readPublicEnv } from './env';

export type Db = SupabaseClient<Database>;

let client: Db | null = null;

/** Клиент с publishable-ключом. Без валидных VITE_* переменных бросает понятную ошибку. */
export function getSupabase(): Db {
  if (client) return client;
  const env = readPublicEnv();
  if (!env.success) {
    throw new Error(
      'Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — см. .env.example',
    );
  }
  client = createClient<Database>(env.data.VITE_SUPABASE_URL, env.data.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
