/**
 * npm run tenant:seed [-- --check]
 *
 * Переписывает в supabase/seed.sql блок между маркерами: для каждого демо-заведения
 * (tenants/demo-*) — вызов admin_publish_tenant с его business.json. Так `supabase db reset`
 * создаёт каталог той же функцией и из того же источника, что и tenant:publish, а хэш совпадает:
 * последующий publish не создаёт новую версию, только загружает картинки и оболочку.
 * --check: не писать, а упасть, если блок устарел (для CI / check:all).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { allTenantSlugs, bad, CliError, ok, parseArgs, runMain, SEED_FILE } from './lib/common';
import { publishHash } from './lib/hash';
import { validateTenant } from './lib/validate';

const BEGIN =
  '-- >>> demo-tenants: сгенерировано `npm run tenant:seed` из tenants/demo-*/business.json — не править вручную';
const END = '-- <<< demo-tenants';

async function block(): Promise<string> {
  const lines = [BEGIN];
  for (const slug of allTenantSlugs().filter((s) => s.startsWith('demo-'))) {
    const { business, findings } = await validateTenant(slug);
    const errors = findings.filter((f) => f.level === 'error');
    if (!business || errors.length) {
      throw new CliError(
        `${slug}: tenant:validate с ошибками — ${errors[0]?.message ?? 'business.json'}`,
      );
    }
    const json = JSON.stringify(business);
    if (json.includes('$cfg$')) throw new CliError(`${slug}: в business.json встречается $cfg$`);
    lines.push(
      `select public.admin_publish_tenant($cfg$${json}$cfg$::jsonb,\n  '${publishHash(slug, business)}', false, 'seed');`,
    );
  }
  lines.push(END);
  return lines.join('\n');
}

runMain(async () => {
  const { flags } = parseArgs(process.argv.slice(2));
  const seed = readFileSync(SEED_FILE, 'utf8');
  const start = seed.indexOf(BEGIN.slice(0, 20));
  const end = seed.indexOf(END);
  if (start < 0 || end < start) {
    throw new CliError(`В supabase/seed.sql нет маркеров «${BEGIN.slice(0, 20)}…» / «${END}»`);
  }
  const next = seed.slice(0, start) + (await block()) + seed.slice(end + END.length);
  if (flags.has('--check')) {
    if (next !== seed) {
      bad('supabase/seed.sql устарел относительно tenants/demo-* — запустите npm run tenant:seed');
      return 1;
    }
    ok('supabase/seed.sql соответствует tenants/demo-*');
    return 0;
  }
  writeFileSync(SEED_FILE, next);
  ok(next === seed ? 'supabase/seed.sql без изменений' : 'supabase/seed.sql обновлён');
});
