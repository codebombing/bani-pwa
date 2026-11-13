/**
 * Статическая «оболочка» заведения в dist/s/<slug>/: index.html с его названием и иконками,
 * manifest.webmanifest (id/start_url/scope = /s/<slug>/), иконки. JS/CSS общие для всех
 * заведений (dist/assets). Service worker со scope заведения — этап 7.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import type { Business } from '../../../src/shared/business-schema';
import { CliError, DIST_DIR, imagesDir, shellDir } from './common';
import { ICON, ICON_MASKABLE } from './images';

/** Цвет фона приложения (тёмная тема) — им же заливаются iOS-иконка и splash. */
export const APP_BACKGROUND = '#1c1a19';

/** Cloudflare Pages: HTML, sw.js и манифесты заведений не кэшируются, хэшированная статика — навсегда. */
export const HEADERS = `# Сгенерировано tenant:publish.
/s/*
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

/** Те же правила для Vercel: сначала существующий файл, затем оболочка заведения. */
export const VERCEL = {
  cleanUrls: false,
  trailingSlash: true,
  rewrites: [{ source: '/s/:slug/(.*)', destination: '/s/:slug/index.html' }],
  headers: [
    { source: '/s/(.*)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    {
      source: '/assets/(.*)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};

export const REDIRECTS = `# Сгенерировано tenant:publish. Глубокие ссылки заведения → его оболочка.
/s/:slug/*  /s/:slug/index.html  200
`;

export const scopeOf = (slug: string) => `/s/${slug}/`;

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function manifestFor(slug: string, b: Business) {
  const scope = scopeOf(slug);
  return {
    id: scope,
    start_url: scope,
    scope,
    name: b.name,
    short_name: b.pwa.short_name,
    description: b.pwa.description || b.texts.tagline,
    lang: 'ru-RU',
    dir: 'ltr',
    display: 'standalone',
    orientation: 'portrait',
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    icons: [
      { src: `${scope}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${scope}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: `${scope}icons/icon-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

export function htmlFor(
  baseHtml: string,
  slug: string,
  b: Business,
  configVersion: number,
): string {
  const scope = scopeOf(slug);
  const description = b.pwa.description || b.texts.tagline || b.name;
  const v = `?v=${configVersion}`;
  const head = [
    `<meta name="description" content="${attr(description)}" />`,
    `<meta name="bani:tenant" content="${attr(slug)}" />`,
    `<meta name="application-name" content="${attr(b.pwa.short_name)}" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-title" content="${attr(b.pwa.short_name)}" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
    `<link rel="manifest" href="${scope}manifest.webmanifest${v}" />`,
    `<link rel="icon" type="image/png" sizes="192x192" href="${scope}icons/icon-192.png${v}" />`,
    `<link rel="apple-touch-icon" href="${scope}icons/apple-touch-icon.png${v}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${attr(b.name)}" />`,
    `<meta property="og:description" content="${attr(description)}" />`,
    `<meta property="og:image" content="${scope}icons/icon-512.png" />`,
  ].join('\n    ');

  if (!/<title>[^<]*<\/title>/.test(baseHtml) || !baseHtml.includes('</head>')) {
    throw new CliError('dist/index.html без <title> или </head> — пересоберите: npm run build');
  }
  return baseHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(b.name)}</title>`)
    .replace(
      /<meta name="theme-color" content="[^"]*"\s*\/?>/,
      `<meta name="theme-color" content="${APP_BACKGROUND}" />`,
    )
    .replace('</head>', `    ${head}\n  </head>`);
}

/** Пишет dist/s/<slug>/ и dist/_redirects. Требует собранный dist/index.html. */
export async function buildShell(
  slug: string,
  b: Business,
  configVersion: number,
): Promise<string[]> {
  const baseFile = path.join(DIST_DIR, 'index.html');
  if (!existsSync(baseFile)) {
    throw new CliError('Нет dist/index.html — сначала npm run build, затем повторите publish');
  }
  const out = shellDir(slug);
  const icons = path.join(out, 'icons');
  mkdirSync(icons, { recursive: true });

  const src = imagesDir(slug);
  const icon = path.join(src, ICON);
  await sharp(icon).toFile(path.join(icons, 'icon-512.png'));
  await sharp(icon).resize(192, 192).png().toFile(path.join(icons, 'icon-192.png'));
  await sharp(path.join(src, ICON_MASKABLE)).toFile(path.join(icons, 'icon-maskable-512.png'));
  // iOS не поддерживает прозрачность у apple-touch-icon: берём maskable (фон до краёв).
  await sharp(path.join(src, ICON_MASKABLE))
    .resize(180, 180)
    .flatten({ background: APP_BACKGROUND })
    .png()
    .toFile(path.join(icons, 'apple-touch-icon.png'));

  writeFileSync(
    path.join(out, 'manifest.webmanifest'),
    `${JSON.stringify(manifestFor(slug, b), null, 2)}\n`,
  );
  writeFileSync(
    path.join(out, 'index.html'),
    htmlFor(readFileSync(baseFile, 'utf8'), slug, b, configVersion),
  );
  writeFileSync(path.join(DIST_DIR, '_redirects'), REDIRECTS);
  writeFileSync(path.join(DIST_DIR, '_headers'), HEADERS);
  writeFileSync(path.join(DIST_DIR, 'vercel.json'), `${JSON.stringify(VERCEL, null, 2)}\n`);

  // Service worker заведения: тот же sw.js, но scope /s/<slug>/ — свои кэши и подписки.
  const sw = path.join(DIST_DIR, 'sw.js');
  if (!existsSync(sw)) throw new CliError('Нет dist/sw.js — пересоберите: npm run build');
  copyFileSync(sw, path.join(out, 'sw.js'));
  if (existsSync(`${sw}.map`)) copyFileSync(`${sw}.map`, path.join(out, 'sw.js.map'));

  return [
    'index.html',
    'sw.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
  ];
}
