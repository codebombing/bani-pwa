/**
 * npm run tenant:validate -- <slug> [<slug>...]
 * Zod-схема business.json + бизнес-проверки + картинки. Код выхода 1, если есть ошибки.
 */
import { parseArgs, requireSlugs, runMain } from './lib/common';
import { printFindings, validateTenant } from './lib/validate';

runMain(async () => {
  const { slugs } = parseArgs(process.argv.slice(2));
  let failed = 0;
  for (const slug of requireSlugs(slugs, 'npm run tenant:validate -- <slug>')) {
    const { findings } = await validateTenant(slug);
    if (printFindings(slug, findings).errors > 0) failed += 1;
  }
  return failed ? 1 : 0;
});
