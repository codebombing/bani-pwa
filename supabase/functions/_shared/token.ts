// Токен доступа гостя к брони.
// token = base64url(HMAC_SHA256(BOOKING_TOKEN_SECRET, booking_id + ':' + idempotency_key)).
// В БД хранится только sha256(token). При повторе запроса с тем же ключом функция получает
// тот же booking_id и вычисляет тот же токен — ничего секретного в БД нет.

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenSecret(): string {
  const secret = Deno.env.get('BOOKING_TOKEN_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('BOOKING_TOKEN_SECRET не задан (≥ 32 символов) — см. supabase/functions/.env.example');
  }
  return secret;
}

export async function bookingToken(bookingId: string, idempotencyKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(tokenSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${bookingId}:${idempotencyKey}`));
  return base64url(new Uint8Array(sig));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return hex(new Uint8Array(digest));
}

/** sha256(token) в формате bytea для PostgREST ('\x' + hex). */
export async function tokenHashBytea(token: string): Promise<string> {
  return `\\x${await sha256Hex(token)}`;
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
