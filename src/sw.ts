/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

// Этап 1: минимальный service worker. vite-plugin-pwa (injectManifest) подставляет
// сюда список хэшированной статики общего билда. Кэши по заведениям, NetworkOnly
// для owner/токен-запросов и push — этап 7.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => {
  void self.skipWaiting();
});
