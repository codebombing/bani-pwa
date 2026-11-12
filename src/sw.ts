/// <reference lib="webworker" />
import { setCacheNameDetails } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

// Один и тот же sw.js tenant:publish кладёт в /s/<slug>/sw.js; slug берётся из адреса,
// поэтому у каждого заведения свои кэши: bani-<slug>-static-v1, bani-<slug>-public-v1.
// Кэшируется только статика и публичные данные. Брони по токену, кабинет владельца,
// Auth и REST не перехватываются вообще — идут в сеть и никогда не попадают в кэш.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const VERSION = 'v1';
const slug = /\/s\/([a-z0-9-]+)\//.exec(self.location.pathname)?.[1] ?? 'root';
const PREFIX = `bani-${slug}`;
const PUBLIC = `${PREFIX}-public-${VERSION}`;
const PAGES = `${PREFIX}-pages-${VERSION}`;

// Имя precache-кэша: bani-<slug>-static-v1.
setCacheNameDetails({ prefix: PREFIX, precache: 'static', runtime: 'runtime', suffix: VERSION });
precacheAndRoute(self.__WB_MANIFEST);

// Публичный каталог заведения (ровно /public-api/t/<slug>) и его картинки.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    (url.pathname.endsWith(`/functions/v1/public-api/t/${slug}`) ||
      url.pathname.includes('/storage/v1/object/public/tenant-assets/')),
  new StaleWhileRevalidate({ cacheName: PUBLIC }),
);

// Публичная оболочка гостя: сеть, без сети — последняя копия. Кабинет не кэшируется.
registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' &&
    url.pathname.startsWith(`/s/${slug}/`) &&
    !url.pathname.startsWith(`/s/${slug}/owner`) &&
    !url.pathname.startsWith(`/s/${slug}/b/`),
  new NetworkFirst({ cacheName: PAGES, networkTimeoutSeconds: 4 }),
);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([`${PREFIX}-static-${VERSION}`, PUBLIC, PAGES]);
      for (const name of await caches.keys()) {
        // Чистим только свои старые версии; кэши других заведений не трогаем.
        if (name.startsWith(`${PREFIX}-`) && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload;
  try {
    data = (event.data?.json() ?? {}) as PushPayload;
  } catch {
    data = { body: event.data?.text() };
  }
  const url = data.url?.startsWith(`/s/${slug}/`) ? data.url : `/s/${slug}/`;
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Бронирование', {
      body: data.body ?? '',
      icon: `/s/${slug}/icons/icon-192.png`,
      badge: `/s/${slug}/icons/icon-192.png`,
      data: { url },
      lang: 'ru',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url ?? `/s/${slug}/`;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).pathname.startsWith(`/s/${slug}/`));
      if (existing) {
        await existing.focus();
        await existing.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
