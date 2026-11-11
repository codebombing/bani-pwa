// Общие HTTP-хелперы Edge Functions: JSON-ответы и единый формат ошибок.

export type ErrorBody = { ok: false; error: string; message: string; details?: unknown };

/** Коды ошибок SQL-функций → HTTP-статусы. */
const STATUS_BY_CODE: Record<string, number> = {
  TENANT_NOT_FOUND: 404,
  HALL_NOT_FOUND: 404,
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SLOT_TAKEN: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  VERSION_CONFLICT: 409,
  FORBIDDEN: 403,
  METHOD_NOT_ALLOWED: 405,
  INVALID_JSON: 400,
  VALIDATION_ERROR: 400,
  SERVER_ERROR: 500,
};

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Ответы с персональными данными и токенами не кэшируются нигде.
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function fail(code: string, message: string, details?: unknown): Response {
  const body: ErrorBody = { ok: false, error: code, message };
  if (details !== undefined) body.details = details;
  return json(body, STATUS_BY_CODE[code] ?? 422);
}

/** Результат SQL-функции {ok:false,...} → ответ с нужным статусом, иначе 200. */
export function fromRpc(result: unknown, okStatus = 200): Response {
  if (result && typeof result === 'object' && (result as { ok?: unknown }).ok === false) {
    const r = result as ErrorBody;
    return fail(r.error, r.message, r.details);
  }
  return json(result, okStatus);
}

export class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError('INVALID_JSON', 'Тело запроса — JSON');
  }
}

/** IP клиента (Edge Function стоит за прокси Supabase). */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip');
}
