/**
 * npm run tenant:placeholders -- <slug> [--force]
 * Дорисовывает недостающие иконки и фото-заглушки (цвет акцента + буква / название зала).
 * Нужен, пока заведение не прислало настоящие фото. --force перерисовывает всё.
 */
import { loadBusiness } from './lib/business';
import { CliError, ok, parseArgs, requireSlugs, runMain } from './lib/common';
import { writePlaceholders } from './lib/images';

runMain(async () => {
  const { slugs, flags } = parseArgs(process.argv.slice(2));
  for (const slug of requireSlugs(slugs, 'npm run tenant:placeholders -- <slug> [--force]')) {
    const { business, findings } = loadBusiness(slug);
    if (!business)
      throw new CliError(`${slug}: business.json с ошибками — ${findings[0]?.message}`);
    const written = await writePlaceholders(slug, business, flags.has('--force'));
    ok(`${slug}: нарисовано ${written.length}${written.length ? ` — ${written.join(', ')}` : ''}`);
  }
});
