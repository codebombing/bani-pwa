import { z } from 'zod';

/**
 * Ссылки на свои брони на этом устройстве (гость без регистрации).
 * В localStorage — только токен доступа и краткая подпись, без телефона и имени.
 */
const itemSchema = z.object({
  token: z.string(),
  start_at: z.string(),
  hall_name: z.string(),
});
export type MyBooking = z.infer<typeof itemSchema>;

const key = (slug: string) => `bani:${slug}:my-bookings`;

export function readMyBookings(slug: string): MyBooking[] {
  try {
    const parsed = z.array(itemSchema).safeParse(JSON.parse(localStorage.getItem(key(slug)) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function rememberBooking(slug: string, item: MyBooking): void {
  try {
    const rest = readMyBookings(slug).filter((b) => b.token !== item.token);
    localStorage.setItem(key(slug), JSON.stringify([item, ...rest].slice(0, 20)));
  } catch {
    // Приватный режим/квота — ссылка всё равно в адресной строке.
  }
}
