/**
 * npm run notify:setup-local — связать pg_cron с notify-worker в ЛОКАЛЬНОМ стеке:
 * кладёт в Vault адрес функции (внутри docker-сети) и секретный ключ.
 * На сервере то же делается один раз вручную с адресом продакшена (см. PROGRESS.md, этап 7).
 */
import { existsSync } from 'node:fs';

import pg from 'pg';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = z
  .object({
    SUPABASE_SECRET_KEY: z.string().min(20),
    SUPABASE_DB_URL: z.string().default('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),
    NOTIFY_WORKER_URL: z
      .url()
      .default('http://supabase_kong_bani-pwa:8000/functions/v1/notify-worker'),
  })
  .parse(process.env);

async function upsertSecret(db: pg.Client, name: string, value: string) {
  const { rows } = await db.query<{ id: string }>('select id from vault.secrets where name = $1', [
    name,
  ]);
  if (rows[0]) await db.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
  else await db.query('select vault.create_secret($1, $2)', [value, name]);
}

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await db.connect();
try {
  await upsertSecret(db, 'notify_worker_url', env.NOTIFY_WORKER_URL);
  await upsertSecret(db, 'notify_worker_key', env.SUPABASE_SECRET_KEY);
  console.log(`✔ Vault: notify_worker_url = ${env.NOTIFY_WORKER_URL}, notify_worker_key задан`);
  console.log('  pg_cron будит воркер раз в минуту, если есть задачи к отправке.');
} finally {
  await db.end();
}
