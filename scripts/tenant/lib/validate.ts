import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { type Business, WEEKDAYS } from '../../../src/shared/business-schema';
import { type Finding, loadBusiness } from './business';
import { imagesDir } from './common';
import { checkImages, usedImages } from './images';

/** Бизнес-проверки поверх Zod-схемы (схема уже проверила тарифы, кратность шага, вместимость). */
function businessChecks(b: Business, today: string): Finding[] {
  const out: Finding[] = [];
  if (WEEKDAYS.every((d) => b.working_hours.days[d] === null)) {
    out.push({ level: 'error', message: 'working_hours: все дни закрыты' });
  }
  for (const [i, hall] of b.halls.entries()) {
    const where = `halls.${i} («${hall.name}»)`;
    if (!hall.tariffs.some((t) => t.effective_from <= today)) {
      const first = [...hall.tariffs].sort((a, c) =>
        a.effective_from.localeCompare(c.effective_from),
      )[0];
      out.push({
        level: 'warning',
        message: `${where}: тариф начинает действовать ${first?.effective_from} — до этой даты бронь невозможна`,
      });
    }
    if (hall.capacity_max > hall.capacity_included && hall.extra_guest_price_rub === 0) {
      out.push({
        level: 'warning',
        message: `${where}: доплата за гостей сверх ${hall.capacity_included} — 0 ₽`,
      });
    }
  }

  // Заглушки из шаблона: публиковать в preview можно, в live — нет.
  const placeholder = (message: string): Finding => ({
    level: 'warning',
    message,
    blocksLive: true,
  });
  if (/(^|\.)example\.(com|ru|org)$/i.test(new URL(b.legal.privacy_policy_url).hostname)) {
    out.push(
      placeholder('legal.privacy_policy_url — заглушка example.com, нужна политика ПДн заведения'),
    );
  }
  if (/Фамилия|Демо/i.test(b.legal.operator_name)) {
    out.push(placeholder(`legal.operator_name — заглушка («${b.legal.operator_name}»)`));
  }
  if (/000-00-00/.test(b.contacts.phone)) {
    out.push(placeholder(`contacts.phone — заглушка (${b.contacts.phone})`));
  }
  return out;
}

function listFiles(dir: string, base = dir): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

export async function validateTenant(slug: string, today = new Date().toISOString().slice(0, 10)) {
  const loaded = loadBusiness(slug);
  if (!loaded.business) return { business: null, findings: loaded.findings };
  const business = loaded.business;
  const findings = [
    ...loaded.findings,
    ...businessChecks(business, today),
    ...(await checkImages(slug, business)),
  ];
  const used = new Set(usedImages(slug, business));
  for (const file of listFiles(imagesDir(slug))) {
    if (!used.has(file)) {
      findings.push({ level: 'warning', message: `images/${file} нигде не используется` });
    }
  }
  return { business, findings };
}

export function printFindings(
  slug: string,
  findings: Finding[],
): { errors: number; warnings: number } {
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');
  for (const f of errors) console.log(`  ✖ ${f.message}`);
  for (const f of warnings)
    console.log(`  ⚠ ${f.message}${f.blocksLive ? ' [мешает --live]' : ''}`);
  const summary = `${slug}: ошибок ${errors.length}, предупреждений ${warnings.length}`;
  console.log(errors.length ? `✖ ${summary}` : `✔ ${summary}`);
  return { errors: errors.length, warnings: warnings.length };
}
