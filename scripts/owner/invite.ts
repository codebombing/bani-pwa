/**
 * npm run owner:invite -- <slug> <email> [--role owner|staff]
 *
 * Создаёт (или находит) пользователя Supabase Auth и добавляет его в члены заведения.
 * Публичной регистрации нет: это единственный путь стать владельцем. Нужен service role
 * (SUPABASE_SECRET_KEY) — только локально/CI, никогда во фронтенде.
 * Вход — по magic link на эту почту (локально письма видны в Mailpit: http://127.0.0.1:54324).
 */
import { existsSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const argsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug: латиница, цифры и дефисы'),
  email: z.email('Некорректная почта'),
  role: z.enum(['owner', 'staff']),
});

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(20),
});

function parseArgs(argv: string[]) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--role');
  const roleIdx = argv.indexOf('--role');
  return argsSchema.parse({
    slug: positional[0],
    email: positional[1]?.toLowerCase(),
    role: roleIdx >= 0 ? argv[roleIdx + 1] : 'owner',
  });
}

async function findUserId(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = envSchema.parse(process.env);
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, name, status')
    .eq('slug', args.slug)
    .maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) throw new Error(`Заведение «${args.slug}» не найдено. Сначала опубликуйте его.`);

  const created = await admin.auth.admin.createUser({ email: args.email, email_confirm: true });
  const userId = created.data.user?.id ?? (await findUserId(admin, args.email));
  if (!userId) throw created.error ?? new Error('Не удалось создать пользователя');

  const { error: memberError } = await admin
    .from('tenant_members')
    .upsert(
      { tenant_id: tenant.id, user_id: userId, role: args.role },
      { onConflict: 'tenant_id,user_id' },
    );
  if (memberError) throw memberError;

  console.log(`✔ ${args.email} — ${args.role} заведения «${tenant.name}» (${args.slug}).`);
  console.log(`  Вход: http://localhost:5173/s/${args.slug}/owner/ → «Получить ссылку для входа».`);
  console.log('  Локально письмо смотрите в Mailpit: http://127.0.0.1:54324');
}

main().catch((e: unknown) => {
  if (e instanceof z.ZodError) {
    console.error(`✖ ${e.issues.map((i) => `${i.path.join('.') || 'аргумент'}: ${i.message}`).join('; ')}`);
    console.error('  Использование: npm run owner:invite -- <slug> <email> [--role owner|staff]');
  } else {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exitCode = 1;
});
