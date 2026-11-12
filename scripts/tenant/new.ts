/**
 * npm run tenant:new -- <slug> [--name "Название"]
 * Копирует tenants/_template в tenants/<slug>, подставляет slug и рисует заглушки картинок,
 * чтобы tenant:validate сразу проходил. Дальше: заполнить business.json, заменить картинки.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { businessPath, loadBusiness } from './lib/business';
import {
  CliError,
  ok,
  parseArgs,
  requireSlugs,
  runMain,
  TEMPLATE_DIR,
  tenantDir,
} from './lib/common';
import { writePlaceholders } from './lib/images';

runMain(async () => {
  const { slugs, values } = parseArgs(process.argv.slice(2), ['--name']);
  const [slug] = requireSlugs(slugs, 'npm run tenant:new -- <slug> [--name "Название"]');
  if (!slug) return 1;
  if (existsSync(tenantDir(slug))) throw new CliError(`tenants/${slug} уже существует`);

  const template = JSON.parse(
    readFileSync(path.join(TEMPLATE_DIR, 'business.json'), 'utf8'),
  ) as Record<string, unknown>;
  template.slug = slug;
  const name = values.get('--name');
  if (name) template.name = name;

  mkdirSync(path.join(tenantDir(slug), 'images'), { recursive: true });
  writeFileSync(businessPath(slug), `${JSON.stringify(template, null, 2)}\n`);

  const loaded = loadBusiness(slug);
  if (!loaded.business)
    throw new CliError('Шаблон business.json не проходит схему — исправьте tenants/_template');
  const images = await writePlaceholders(slug, loaded.business);

  ok(`Создано tenants/${slug}/ (business.json и ${images.length} картинок-заглушек)`);
  console.log(
    `  1. Заполните tenants/${slug}/business.json: название, контакты, залы, тарифы, часы.`,
  );
  console.log(
    `  2. Замените заглушки в tenants/${slug}/images/ (иконки 512×512 PNG, фото ≥ 800×450).`,
  );
  console.log(`  3. npm run tenant:validate -- ${slug}`);
  console.log(`  4. npm run build && npm run tenant:publish -- ${slug}`);
  console.log(
    `  5. npm run owner:invite -- ${slug} <почта владельца>, затем tenant:publish -- ${slug} --live`,
  );
});
