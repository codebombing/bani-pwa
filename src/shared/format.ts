/** Форматирование для UI: деньги (копейки → ₽), даты и время в timezone заведения, телефон. */

const rubFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatRub(kopecks: number): string {
  return rubFormatter.format(kopecks / 100);
}

/** Сегодняшняя дата (YYYY-MM-DD) в timezone заведения. */
export function todayInTz(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

/** YYYY-MM-DD + n дней (календарная арифметика без часовых поясов). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** «пятница, 13 ноября» для локальной даты YYYY-MM-DD. */
export function formatDateLong(isoDate: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** «13 ноября» для локальной даты YYYY-MM-DD. */
export function formatDayMonth(isoDate: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** Локальная дата YYYY-MM-DD момента в timezone заведения. */
export function dateInTz(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(isoDateTime));
}

/** «18:00» в timezone заведения. */
export function formatTimeInTz(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(isoDateTime));
}

/** «пт, 13 ноября, 18:00» в timezone заведения. */
export function formatDateTimeInTz(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(isoDateTime));
}

/** «пт, 13 ноября, 18:00–20:00»; если конец на следующий день — с его датой. */
export function formatRangeInTz(startIso: string, endIso: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(startIso));
  const endDay = dateInTz(endIso, timeZone);
  const end = formatTimeInTz(endIso, timeZone);
  const endLabel = dateInTz(startIso, timeZone) === endDay ? end : `${end} (${formatDayMonth(endDay)})`;
  return `${day}, ${formatTimeInTz(startIso, timeZone)}–${endLabel}`;
}

/** 120 → «2 ч», 150 → «2,5 ч», 45 → «45 мин». */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toLocaleString('ru-RU')} ч`;
}

/**
 * Нормализация российского номера к +7XXXXXXXXXX. 8XXXXXXXXXX и 9XXXXXXXXX тоже принимаются.
 * Возвращает null, если номер неполный.
 */
export function normalizeRuPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return null;
  return `+7${digits}`;
}

/** Маска ввода: «+7 900 123-45-67» по мере набора. */
export function formatRuPhoneInput(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('8') || digits.startsWith('7')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length === 0) return '';
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 8);
  const d = digits.slice(8, 10);
  let out = `+7 ${a}`;
  if (b) out += ` ${b}`;
  if (c) out += `-${c}`;
  if (d) out += `-${d}`;
  return out;
}
