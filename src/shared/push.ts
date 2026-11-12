import { useEffect } from 'react';

/**
 * Service worker заведения и Web Push.
 * SW регистрируется только в собранном приложении (dist/s/<slug>/sw.js кладёт tenant:publish),
 * его scope — /s/<slug>/, поэтому кэши и подписки разных заведений не смешиваются.
 * iPhone: push работает только в приложении, добавленном «На экран Домой» (iOS 16.4+).
 */

export const swScope = (slug: string) => `/s/${slug}/`;

export function useTenantServiceWorker(slug: string): void {
  useEffect(() => {
    if (!import.meta.env.PROD || !slug || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register(`${swScope(slug)}sw.js`, { scope: swScope(slug) })
      .catch(() => {
        // Нет оболочки заведения (не опубликовано) — приложение работает и без SW.
      });
  }, [slug]);
}

export type PushSupport = 'supported' | 'ios-install' | 'unsupported' | 'denied';

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function vapidPublicKey(): string | null {
  const key: unknown = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof key === 'string' && key.length > 20 ? key : null;
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'ios-install';
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported';
  }
  if (!vapidPublicKey() || !import.meta.env.PROD) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'supported';
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Разрешение + подписка в SW заведения. Бросает Error с понятным текстом. */
export async function subscribePush(slug: string): Promise<PushSubscriptionBody> {
  const key = vapidPublicKey();
  if (!key) throw new Error('Уведомления не настроены');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Уведомления запрещены в настройках браузера');
  const registration =
    (await navigator.serviceWorker.getRegistration(swScope(slug))) ??
    (await navigator.serviceWorker.register(`${swScope(slug)}sw.js`, { scope: swScope(slug) }));
  const sub =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(key),
    }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('Браузер вернул неполную подписку');
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

export const IOS_INSTALL_HINT =
  'На iPhone уведомления работают в установленном приложении: «Поделиться» → «На экран Домой», затем откройте его с экрана и включите уведомления.';
