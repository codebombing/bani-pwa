import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Business } from '../../../src/shared/business-schema';
import { imagesDir } from './common';
import { usedImages } from './images';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** JSON с отсортированными ключами — одинаковый конфиг даёт одинаковый хэш. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Хэш публикации: business.json (после Zod-нормализации) + содержимое всех картинок.
 * Поменялась только картинка — меняется версия конфига, и ссылки ?v=<версия> обходят кэш.
 */
export function publishHash(slug: string, business: Business): string {
  const images = usedImages(slug, business).map((rel) => [
    rel,
    sha256(readFileSync(path.join(imagesDir(slug), rel))),
  ]);
  return sha256(canonicalJson({ business, images }));
}
