/**
 * npm run serve:dist — локально отдать dist/ как статический хостинг (файлы + dist/_redirects).
 * Нужен, чтобы проверить оболочки заведений и service worker: http://localhost:8788/s/<slug>/
 */
import { DIST_DIR, ok, runMain } from './lib/common';
import { startStaticServer } from './lib/static-server';

runMain(async () => {
  const { url } = await startStaticServer(DIST_DIR, 8788);
  ok(`dist/ на ${url.replace('127.0.0.1', 'localhost')} — Ctrl+C для остановки`);
  await new Promise(() => {});
});
