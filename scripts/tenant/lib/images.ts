/**
 * Картинки заведения: tenants/<slug>/images/{icon-512.png, icon-maskable-512.png, logo.png?,
 * halls/<hall-key>/*.jpg|webp}. Проверка размеров/форматов и генерация заглушек.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import type { Business } from '../../../src/shared/business-schema';
import type { Finding } from './business';
import { imagesDir } from './common';

export const ICON = 'icon-512.png';
export const ICON_MASKABLE = 'icon-maskable-512.png';
export const LOGO = 'logo.png';

const PHOTO_EXT = /\.(jpe?g|webp)$/i;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** Все картинки, которые публикуются (пути относительно images/), без повторов, по алфавиту. */
export function usedImages(slug: string, business: Business): string[] {
  const list = new Set<string>([ICON, ICON_MASKABLE]);
  if (existsSync(path.join(imagesDir(slug), LOGO))) list.add(LOGO);
  for (const hall of business.halls) for (const p of hall.photos) list.add(p);
  return [...list].sort();
}

export const contentType = (file: string) =>
  file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

function safeRelative(p: string): boolean {
  return !p.startsWith('/') && !p.split('/').includes('..') && !p.includes('\\');
}

async function checkIcon(file: string, name: string, maskable: boolean): Promise<Finding[]> {
  if (!existsSync(file)) return [{ level: 'error', message: `Нет images/${name}` }];
  const meta = await sharp(file).metadata();
  const out: Finding[] = [];
  if (meta.format !== 'png') out.push({ level: 'error', message: `images/${name}: нужен PNG` });
  if (meta.width !== 512 || meta.height !== 512) {
    out.push({
      level: 'error',
      message: `images/${name}: нужен размер 512×512, сейчас ${meta.width}×${meta.height}`,
    });
  }
  if (maskable) {
    // Maskable-иконку ОС обрезает кругом/скруглением: фон должен идти до краёв, без прозрачности.
    const { isOpaque } = await sharp(file).stats();
    if (!isOpaque) {
      out.push({
        level: 'error',
        message: `images/${name}: у maskable-иконки не должно быть прозрачности — фон до краёв, логотип в центральных 80 %`,
      });
    }
  }
  return out;
}

export async function checkImages(slug: string, business: Business): Promise<Finding[]> {
  const dir = imagesDir(slug);
  const findings: Finding[] = [
    ...(await checkIcon(path.join(dir, ICON), ICON, false)),
    ...(await checkIcon(path.join(dir, ICON_MASKABLE), ICON_MASKABLE, true)),
  ];

  for (const [i, hall] of business.halls.entries()) {
    const where = `halls.${i} («${hall.name}»)`;
    if (hall.photos.length === 0) {
      findings.push({ level: 'error', message: `${where}: нет ни одного фото` });
    }
    for (const photo of hall.photos) {
      if (!safeRelative(photo)) {
        findings.push({ level: 'error', message: `${where}: недопустимый путь фото «${photo}»` });
        continue;
      }
      if (!PHOTO_EXT.test(photo)) {
        findings.push({ level: 'error', message: `${where}: «${photo}» — нужен .jpg или .webp` });
        continue;
      }
      const file = path.join(dir, photo);
      if (!existsSync(file)) {
        findings.push({ level: 'error', message: `${where}: нет файла images/${photo}` });
        continue;
      }
      const size = statSync(file).size;
      if (size > MAX_PHOTO_BYTES) {
        findings.push({
          level: 'error',
          message: `images/${photo}: ${(size / 1024 / 1024).toFixed(1)} МБ — сожмите до 3 МБ`,
        });
      }
      const meta = await sharp(file).metadata();
      if ((meta.width ?? 0) < 800 || (meta.height ?? 0) < 450) {
        findings.push({
          level: 'error',
          message: `images/${photo}: ${meta.width}×${meta.height} — нужно не меньше 800×450`,
        });
      }
      if (!photo.startsWith(`halls/${hall.key}/`)) {
        findings.push({
          level: 'warning',
          message: `images/${photo}: принято класть фото зала в halls/${hall.key}/`,
        });
      }
    }
  }
  return findings;
}

// ---------- Заглушки (tenant:new и демо-заведения) ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONT = 'Helvetica, Arial, sans-serif';

function iconSvg(letter: string, accent: string, maskable: boolean): string {
  // Обычная иконка — скруглённый квадрат на прозрачном фоне; maskable — фон до краёв,
  // буква в безопасной зоне (центральные 80 %).
  const bg = maskable
    ? `<rect width="512" height="512" fill="${accent}"/>`
    : `<rect x="16" y="16" width="480" height="480" rx="108" fill="${accent}"/>`;
  const size = maskable ? 220 : 280;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${bg}
<text x="256" y="256" font-family="${FONT}" font-size="${size}" font-weight="700" fill="#fff"
 text-anchor="middle" dominant-baseline="central">${esc(letter)}</text></svg>`;
}

function photoSvg(title: string, subtitle: string, accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#1c1a19"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
<rect width="1280" height="800" fill="url(#g)"/>
<text x="80" y="640" font-family="${FONT}" font-size="72" font-weight="700" fill="#fff">${esc(title)}</text>
<text x="80" y="710" font-family="${FONT}" font-size="36" fill="#fff" fill-opacity="0.8">${esc(subtitle)}</text>
</svg>`;
}

/** Создаёт недостающие иконки и фото-заглушки. Существующие файлы не трогает (кроме force). */
export async function writePlaceholders(
  slug: string,
  business: Business,
  force = false,
): Promise<string[]> {
  const dir = imagesDir(slug);
  const written: string[] = [];
  const letter = (
    business.pwa.short_name.trim()[0] ??
    business.name.trim()[0] ??
    'Б'
  ).toUpperCase();
  const accent = business.theme.accent;

  const write = async (rel: string, svg: string, format: 'png' | 'jpeg') => {
    const file = path.join(dir, rel);
    if (existsSync(file) && !force) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const img = sharp(Buffer.from(svg));
    await (format === 'png' ? img.png() : img.jpeg({ quality: 82, mozjpeg: true })).toFile(file);
    written.push(rel);
  };

  await write(ICON, iconSvg(letter, accent, false), 'png');
  await write(ICON_MASKABLE, iconSvg(letter, accent, true), 'png');
  for (const hall of business.halls) {
    for (const [i, photo] of hall.photos.entries()) {
      if (!safeRelative(photo) || !PHOTO_EXT.test(photo)) continue;
      await write(
        photo,
        photoSvg(hall.name, `Фото-заглушка ${i + 1} · ${business.name}`, accent),
        'jpeg',
      );
    }
  }
  return written;
}
