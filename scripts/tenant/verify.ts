/**
 * npm run tenant:verify -- <slug> [<slug>...] [--base-url https://host]
 *
 * Проверяет опубликованное заведение «снаружи»:
 *  - строка в БД и совпадение опубликованной версии с текущими business.json + картинками;
 *  - public-api отдаёт заведение и залы, availability отвечает по каждому залу;
 *  - фото залов доступны в Storage;
 *  - оболочка: manifest (id/start_url/scope = /s/<slug>/), иконки нужных размеров,
 *    глубокие ссылки /s/<slug>/... отдают HTML с названием заведения;
 *  - остальные опубликованные заведения по-прежнему отвечают (публикация не сломала соседей).
 * Без --base-url поднимает локальный сервер над dist/ с правилами dist/_redirects.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { z } from 'zod';

import type { Business } from '../../src/shared/business-schema';
import { loadBusiness } from './lib/business';
import { bad, CliError, DIST_DIR, ok, parseArgs, requireSlugs, runMain, warn } from './lib/common';
import { publishHash } from './lib/hash';
import { scopeOf } from './lib/shell';
import { startStaticServer } from './lib/static-server';
import { adminClient, ASSETS_BUCKET, publicConfig } from './lib/supabase';

const tenantResponse = z.object({
  ok: z.literal(true),
  tenant: z.object({ id: z.uuid(), name: z.string(), timezone: z.string(), status: z.string() }),
  halls: z.array(
    z.object({
      id: z.uuid(),
      key: z.string(),
      min_duration_min: z.number(),
      photos: z.array(z.string()),
    }),
  ),
});
const availabilityResponse = z.object({ ok: z.literal(true) }).loose();
const manifestSchema = z.object({
  id: z.string(),
  start_url: z.string(),
  scope: z.string(),
  name: z.string(),
  icons: z.array(z.object({ src: z.string(), sizes: z.string(), purpose: z.string().optional() })),
});

class Check {
  failures = 0;
  pass(msg: string) {
    ok(msg);
  }
  fail(msg: string) {
    this.failures += 1;
    bad(msg);
  }
  expect(cond: boolean, passMsg: string, failMsg: string) {
    if (cond) this.pass(passMsg);
    else this.fail(failMsg);
  }
}

function tomorrowIn(tz: string): string {
  const d = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // ГГГГ-ММ-ДД
}

async function verifyApi(c: Check, slug: string, business: Business) {
  const { url, key } = publicConfig();
  const api = `${url}/functions/v1/public-api/t/${slug}`;
  let res: Response;
  try {
    res = await fetch(api, { headers: { apikey: key } });
  } catch {
    c.fail(`public-api недоступен (${url}) — запущен ли npx supabase functions serve?`);
    return null;
  }
  const parsed = tenantResponse.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success) {
    c.fail(`public-api GET /t/${slug}: HTTP ${res.status}`);
    return null;
  }
  const t = parsed.data;
  c.expect(
    t.tenant.name === business.name,
    `public-api: «${t.tenant.name}», статус ${t.tenant.status}`,
    `public-api: название «${t.tenant.name}» ≠ business.json «${business.name}» — опубликуйте заново`,
  );
  const keys = t.halls
    .map((h) => h.key)
    .sort()
    .join(',');
  const expected = business.halls
    .map((h) => h.key)
    .sort()
    .join(',');
  c.expect(
    keys === expected,
    `залы: ${keys}`,
    `залы в API (${keys}) ≠ business.json (${expected})`,
  );

  const date = tomorrowIn(t.tenant.timezone);
  for (const hall of t.halls) {
    const q = new URLSearchParams({
      hall_id: hall.id,
      date,
      duration_min: String(hall.min_duration_min),
    });
    const r = await fetch(`${api}/availability?${q}`, { headers: { apikey: key } });
    const body: unknown = await r.json().catch(() => null);
    c.expect(
      r.ok && availabilityResponse.safeParse(body).success,
      `availability ${hall.key} на ${date}: отвечает`,
      `availability ${hall.key}: HTTP ${r.status} ${JSON.stringify(body)}`,
    );
  }

  for (const hall of t.halls) {
    for (const photo of hall.photos) {
      const src = `${url}/storage/v1/object/public/${ASSETS_BUCKET}/${t.tenant.id}/config/${photo}`;
      const r = await fetch(src, { method: 'HEAD' });
      c.expect(
        r.ok && (r.headers.get('content-type') ?? '').startsWith('image/'),
        `фото ${photo}: есть в Storage`,
        `фото ${photo}: HTTP ${r.status} — запустите tenant:publish`,
      );
    }
  }
  return t;
}

async function verifyShell(c: Check, base: string, slug: string, name: string) {
  const scope = scopeOf(slug);
  const mRes = await fetch(`${base}${scope}manifest.webmanifest`);
  const manifest = manifestSchema.safeParse(await mRes.json().catch(() => null));
  if (!mRes.ok || !manifest.success) {
    c.fail(`${slug}: нет ${scope}manifest.webmanifest — npm run build && tenant:publish`);
    return;
  }
  const m = manifest.data;
  c.expect(
    m.id === scope && m.start_url === scope && m.scope === scope,
    `${slug}: manifest id/start_url/scope = ${scope}`,
    `${slug}: manifest id=${m.id} start_url=${m.start_url} scope=${m.scope}, ожидалось ${scope}`,
  );
  c.expect(
    m.name === name,
    `${slug}: manifest name «${m.name}»`,
    `${slug}: manifest name «${m.name}» ≠ «${name}»`,
  );
  c.expect(
    m.icons.some((i) => i.purpose === 'maskable') && m.icons.some((i) => i.sizes === '512x512'),
    `${slug}: иконки any + maskable 512`,
    `${slug}: в manifest нет maskable или 512×512 иконки`,
  );
  for (const icon of m.icons) {
    const r = await fetch(`${base}${icon.src}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const meta = r.ok
      ? await sharp(buf)
          .metadata()
          .catch(() => null)
      : null;
    c.expect(
      !!meta && `${meta.width}x${meta.height}` === icon.sizes,
      `${slug}: ${icon.src} ${icon.sizes}`,
      `${slug}: ${icon.src} — HTTP ${r.status}, размер ${meta ? `${meta.width}x${meta.height}` : '?'}`,
    );
  }
  for (const deep of [scope, `${scope}hall/any`, `${scope}owner/`, `${scope}b/some-token`]) {
    const r = await fetch(`${base}${deep}`);
    const html = await r.text();
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    const decoded = title.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    c.expect(
      r.ok && decoded === name && html.includes(`${scope}manifest.webmanifest`),
      `${slug}: ${deep} → HTML «${decoded}»`,
      `${slug}: ${deep} → HTTP ${r.status}, title «${decoded}» (ожидалось «${name}»)`,
    );
  }
}

async function verifyOne(c: Check, slug: string, base: string) {
  console.log(`\n— ${slug}`);
  const { business, findings } = loadBusiness(slug);
  if (!business) {
    c.fail(`business.json с ошибками: ${findings[0]?.message}`);
    return;
  }
  const admin = adminClient();
  const { data: row, error } = await admin
    .from('tenants')
    .select('id, status, config_version, tenant_config_versions(version, config_hash)')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new CliError(`БД: ${error.message}`);
  if (!row) {
    c.fail(`в БД нет заведения — npm run tenant:publish -- ${slug}`);
    return;
  }
  const latest = row.tenant_config_versions.find((v) => v.version === row.config_version);
  if (latest?.config_hash === publishHash(slug, business)) {
    c.pass(
      `БД: статус ${row.status}, версия ${row.config_version} = текущий business.json и картинки`,
    );
  } else {
    warn(
      `БД: опубликована версия ${row.config_version}, но business.json/картинки с тех пор менялись — tenant:publish`,
    );
  }

  await verifyApi(c, slug, business);
  await verifyShell(c, base, slug, business.name);
}

runMain(async () => {
  const { slugs, values } = parseArgs(process.argv.slice(2), ['--base-url']);
  requireSlugs(slugs, 'npm run tenant:verify -- <slug> [--base-url URL]');
  const c = new Check();

  let base = values.get('--base-url')?.replace(/\/$/, '');
  let stop = () => {};
  if (!base) {
    if (!existsSync(path.join(DIST_DIR, 'index.html')))
      throw new CliError('Нет dist/ — npm run build');
    const local = await startStaticServer(DIST_DIR);
    base = local.url;
    stop = () => local.server.close();
    console.log(`Оболочки: локальный сервер над dist/ (${base})`);
  }

  try {
    for (const slug of slugs) await verifyOne(c, slug, base);

    // Соседи: всё, что опубликовано в dist/s/, должно по-прежнему отвечать.
    const shells = existsSync(path.join(DIST_DIR, 's'))
      ? readdirSync(path.join(DIST_DIR, 's'))
      : [];
    const others = shells.filter((s) => !slugs.includes(s));
    if (others.length) console.log(`\n— остальные опубликованные: ${others.join(', ')}`);
    for (const other of others) {
      const { business } = loadBusiness(other);
      if (business) await verifyShell(c, base, other, business.name);
    }
  } finally {
    stop();
  }

  console.log(c.failures ? `\n✖ проверок не прошло: ${c.failures}` : '\n✔ всё в порядке');
  return c.failures ? 1 : 0;
});
