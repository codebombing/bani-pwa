/**
 * npm run tenant:publish -- <slug> [<slug>...] [--live] [--all] [--no-shell]
 *
 * 1. validate (ошибки — стоп; --live ещё и без заглушек);
 * 2. admin_publish_tenant: заведение, часы, залы, тарифы, допы, версия конфига — одной
 *    транзакцией в БД; брони, платежи, блокировки и члены не трогаются;
 * 3. картинки в Storage tenant-assets/<tenant_id>/config/... (owner/... не трогаются);
 * 4. оболочка PWA dist/s/<slug>/ (нужен npm run build).
 * Повторный запуск с тем же содержимым ничего не меняет в БД (версия та же).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  allTenantSlugs,
  bad,
  CliError,
  imagesDir,
  ok,
  parseArgs,
  runMain,
  warn,
} from './lib/common';
import { publishHash } from './lib/hash';
import { contentType, usedImages } from './lib/images';
import { buildShell } from './lib/shell';
import { adminClient, ASSETS_BUCKET, publishResultSchema } from './lib/supabase';
import { printFindings, validateTenant } from './lib/validate';

type Admin = ReturnType<typeof adminClient>;

async function listConfigObjects(admin: Admin, prefix: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    const { data, error } = await admin.storage.from(ASSETS_BUCKET).list(dir, { limit: 1000 });
    if (error) throw error;
    for (const item of data) {
      const full = `${dir}/${item.name}`;
      if (item.id === null)
        await walk(full); // папка
      else found.push(full);
    }
  };
  await walk(prefix);
  return found;
}

async function uploadImages(admin: Admin, slug: string, tenantId: string, files: string[]) {
  const prefix = `${tenantId}/config`;
  for (const rel of files) {
    const { error } = await admin.storage
      .from(ASSETS_BUCKET)
      .upload(`${prefix}/${rel}`, readFileSync(path.join(imagesDir(slug), rel)), {
        contentType: contentType(rel),
        cacheControl: '31536000',
        upsert: true,
      });
    if (error) throw new CliError(`Storage: ${rel}: ${error.message}`);
  }
  // Удаляем только устаревшие файлы конфига; загрузки владельца лежат в <tenant_id>/owner/.
  const keep = new Set(files.map((rel) => `${prefix}/${rel}`));
  const stale = (await listConfigObjects(admin, prefix)).filter((p) => !keep.has(p));
  if (stale.length) {
    const { error } = await admin.storage.from(ASSETS_BUCKET).remove(stale);
    if (error) throw new CliError(`Storage: удаление устаревших: ${error.message}`);
  }
  return stale.length;
}

async function publishOne(
  admin: Admin,
  slug: string,
  live: boolean,
  shell: boolean,
): Promise<boolean> {
  console.log(`\n— ${slug}`);
  const { business, findings } = await validateTenant(slug);
  const { errors } = printFindings(slug, findings);
  if (!business || errors > 0) {
    bad(`${slug}: не опубликовано — исправьте ошибки`);
    return false;
  }
  const blockers = findings.filter((f) => f.blocksLive);
  if (live && blockers.length) {
    bad(`${slug}: --live невозможен, пока есть заглушки (${blockers.length})`);
    return false;
  }

  const hash = publishHash(slug, business);
  const { data, error } = await admin.rpc('admin_publish_tenant', {
    p_config: business,
    p_config_hash: hash,
    p_live: live,
    p_published_by: `tenant:publish (${process.env.USER ?? 'unknown'})`,
  });
  if (error) {
    bad(`${slug}: БД отклонила публикацию: ${error.message}`);
    return false;
  }
  const result = publishResultSchema.parse(data);
  ok(
    `БД: ${result.created ? 'создано' : 'обновлено'}, статус ${result.status}, версия ${result.config_version}${
      result.changed ? '' : ' (без изменений)'
    }`,
  );
  for (const h of result.hidden_halls_with_bookings) {
    warn(
      `зал «${h.hall}» скрыт, но у него ${h.future_bookings} будущих броней — предупредите владельца`,
    );
  }

  const files = usedImages(slug, business);
  const removed = await uploadImages(admin, slug, result.tenant_id, files);
  ok(`Storage: картинок ${files.length}${removed ? `, удалено устаревших ${removed}` : ''}`);

  if (shell) {
    const written = await buildShell(slug, business, result.config_version);
    ok(`Оболочка: dist/s/${slug}/ (${written.length} файлов)`);
  } else {
    warn('оболочка не собиралась (--no-shell)');
  }
  return true;
}

runMain(async () => {
  const { slugs, flags } = parseArgs(process.argv.slice(2));
  const targets = flags.has('--all') ? allTenantSlugs() : slugs;
  if (targets.length === 0) {
    throw new CliError('Использование: npm run tenant:publish -- <slug> [--live] | --all');
  }
  if (flags.has('--all') && flags.has('--live'))
    throw new CliError('--live только для одного заведения');
  const admin = adminClient();
  let failed = 0;
  for (const slug of targets) {
    if (!(await publishOne(admin, slug, flags.has('--live'), !flags.has('--no-shell'))))
      failed += 1;
  }
  return failed ? 1 : 0;
});
