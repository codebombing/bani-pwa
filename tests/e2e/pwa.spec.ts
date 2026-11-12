/// <reference lib="dom" />
/**
 * Этап 7: PWA-изоляция заведений на собранном приложении (npm run serve:dist).
 * У каждого заведения свой service worker со scope /s/<slug>/ и свои кэши bani-<slug>-*;
 * приватные ответы (бронь по токену) в кэш не попадают.
 */
import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:8788';

async function swState(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      scopes: regs.map((r) => new URL(r.scope).pathname).sort(),
      caches: await caches.keys(),
    };
  });
}

test('у каждого заведения свой service worker и свои кэши', async ({ page }) => {
  await page.goto(`${BASE}/s/demo-banya/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Берёзка');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    /^\/s\/demo-banya\/manifest\.webmanifest/,
  );
  const banya = await swState(page);
  expect(banya.scopes).toEqual(['/s/demo-banya/']);

  await page.goto(`${BASE}/s/demo-sauna24/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Круглосуточно');
  await page.reload(); // страница под контролем SW → публичный каталог попадает в кэш
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Круглосуточно');
  const both = await swState(page);
  expect(both.scopes).toEqual(['/s/demo-banya/', '/s/demo-sauna24/']);
  expect(both.caches.some((c) => c.startsWith('bani-demo-sauna24-'))).toBe(true);
  expect(both.caches.some((c) => c.startsWith('bani-demo-banya-'))).toBe(true);
  expect(both.caches.every((c) => /^bani-(demo-banya|demo-sauna24)-/.test(c))).toBe(true);

  // В кэшах заведения нет ничего приватного: ни броней по токену, ни REST/Auth.
  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    }
    return urls;
  });
  expect(cachedUrls.some((u) => u.includes('/public-api/t/demo-sauna24'))).toBe(true);
  expect(cachedUrls.filter((u) => /\/bookings\/|\/rest\/v1\/|\/auth\/v1\//.test(u))).toEqual([]);
});
