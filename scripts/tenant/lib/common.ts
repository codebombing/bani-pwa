/**
 * Общие части скриптов конвейера заведений (tenant:new/validate/publish/verify/seed).
 * Только Node: service role и строки подключения сюда приходят из .env, не из VITE_*.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { SLUG_RE } from '../../../src/shared/business-schema';

export const ROOT = process.cwd();
export const TENANTS_DIR = path.join(ROOT, 'tenants');
export const TEMPLATE_DIR = path.join(TENANTS_DIR, '_template');
export const DIST_DIR = path.join(ROOT, 'dist');
export const SEED_FILE = path.join(ROOT, 'supabase', 'seed.sql');

export const tenantDir = (slug: string) => path.join(TENANTS_DIR, slug);
export const imagesDir = (slug: string) => path.join(tenantDir(slug), 'images');
export const shellDir = (slug: string) => path.join(DIST_DIR, 's', slug);

// ENV_FILE=.env.cloud.local — работать с облачным проектом; по умолчанию локальный .env.
const ENV_FILE = path.join(ROOT, process.env.ENV_FILE ?? '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

/** Все папки заведений, кроме _template. */
export function allTenantSlugs(): string[] {
  return readdirSync(TENANTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

export class CliError extends Error {}

/** Позиционные аргументы (slug'и) и флаги вида --live / --base-url <v>. */
export function parseArgs(argv: string[], valueFlags: string[] = []) {
  const slugs: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (valueFlags.includes(arg)) {
      const value = argv[i + 1];
      if (!value) throw new CliError(`${arg}: нужно значение`);
      values.set(arg, value);
      i += 1;
    } else if (arg.startsWith('--')) {
      flags.add(arg);
    } else {
      if (!SLUG_RE.test(arg)) throw new CliError(`«${arg}» — не slug (латиница, цифры, дефисы)`);
      slugs.push(arg);
    }
  }
  return { slugs, flags, values };
}

export function requireSlugs(slugs: string[], usage: string): string[] {
  if (slugs.length === 0) throw new CliError(`Не указан slug. Использование: ${usage}`);
  return slugs;
}

export const ok = (msg: string) => console.log(`✔ ${msg}`);
export const warn = (msg: string) => console.log(`⚠ ${msg}`);
export const bad = (msg: string) => console.log(`✖ ${msg}`);

/** main возвращает код выхода (число) или ничего (= 0). */
export function runMain(main: () => Promise<unknown>) {
  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((e: unknown) => {
      bad(e instanceof Error ? e.message : String(e));
      if (!(e instanceof CliError) && e instanceof Error && e.stack) console.error(e.stack);
      process.exit(1);
    });
}
