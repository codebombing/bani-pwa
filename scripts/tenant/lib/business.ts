import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { type Business, parseBusiness } from '../../../src/shared/business-schema';
import { CliError, tenantDir } from './common';

export interface Finding {
  level: 'error' | 'warning';
  message: string;
  /** Предупреждение, которое не даёт перевести заведение в live (заглушки, example.com). */
  blocksLive?: boolean;
}

export const businessPath = (slug: string) => path.join(tenantDir(slug), 'business.json');

/** business.json → Zod. Ошибки формата возвращаются списком, а не исключением. */
export function loadBusiness(
  slug: string,
): { business: Business; findings: Finding[] } | { business: null; findings: Finding[] } {
  const file = businessPath(slug);
  if (!existsSync(file)) {
    throw new CliError(
      `Нет ${path.relative(process.cwd(), file)}. Создайте: npm run tenant:new -- ${slug}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return {
      business: null,
      findings: [{ level: 'error', message: `business.json — не JSON: ${(e as Error).message}` }],
    };
  }
  const parsed = parseBusiness(raw);
  if (!parsed.success) {
    return {
      business: null,
      findings: parsed.error.issues.map((i) => ({
        level: 'error' as const,
        message: `${i.path.join('.') || 'business.json'}: ${i.message}`,
      })),
    };
  }
  const findings: Finding[] = [];
  if (parsed.data.slug !== slug) {
    findings.push({
      level: 'error',
      message: `slug в business.json («${parsed.data.slug}») не совпадает с папкой «${slug}»`,
    });
  }
  return { business: parsed.data, findings };
}
