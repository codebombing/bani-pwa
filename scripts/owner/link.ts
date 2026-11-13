/**
 * npm run owner:link -- <slug> <email>
 * ENV_FILE=.env.cloud.local npm run owner:link -- <slug> <email>   (облако)
 *
 * Одноразовая ссылка входа в кабинет без письма (обход лимита писем Supabase).
 * Выдаётся только члену заведения (owner/staff). Ссылка действует ~1 час, новая
 * отменяет предыдущую. Передавайте её владельцу лично: по ней входят в кабинет.
 */
import { existsSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const ENV_FILE = process.env.ENV_FILE ?? '.env';
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const args = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug: латиница, цифры и дефисы'),
    email: z.email('Некорректная почта'),
  })
  .parse({ slug: process.argv[2], email: process.argv[3]?.toLowerCase() });

const env = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(20),
    SITE_URL: z.url().default('http://localhost:5173'),
  })
  .parse(process.env);

async function main() {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .select('id, name')
    .eq('slug', args.slug)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) throw new Error(`Заведение «${args.slug}» не найдено`);

  const { data: users, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (uErr) throw uErr;
  const user = users.users.find((u) => u.email?.toLowerCase() === args.email);
  const { data: member } = user
    ? await admin
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', tenant.id)
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null };
  if (!member) {
    throw new Error(
      `${args.email} не член «${tenant.name}». Сначала: npm run owner:invite -- ${args.slug} ${args.email}`,
    );
  }

  const redirectTo = `${env.SITE_URL.replace(/\/$/, '')}/s/${args.slug}/owner/`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: args.email,
    options: { redirectTo },
  });
  if (error) throw error;

  console.log(
    `✔ Ссылка входа для ${args.email} (${member.role}, «${tenant.name}»), ~1 час, одноразовая:`,
  );
  // Ссылка ведёт на сам сайт, токен — в #hash: превью мессенджеров его не «потратят»,
  // вход выполняет страница в браузере (verifyOtp).
  const siteLink = `${redirectTo}#token_hash=${data.properties.hashed_token}&type=magiclink`;
  console.log(`\n${siteLink}\n`);
  console.log('  Новая ссылка отменяет предыдущую. Не публикуйте её — по ней входят в кабинет.');
}

main().catch((e: unknown) => {
  const msg =
    e instanceof z.ZodError
      ? e.issues.map((i) => i.message).join('; ')
      : e instanceof Error
        ? e.message
        : String(e);
  console.error(`✖ ${msg}`);
  console.error('  Использование: npm run owner:link -- <slug> <email>');
  process.exit(1);
});
