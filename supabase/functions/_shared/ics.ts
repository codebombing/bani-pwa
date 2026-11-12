// iCalendar (RFC 5545) для брони гостя: «Добавить в календарь».
// Подтверждения от ОС нет — в интерфейсе честно пишем «проверьте приложение календаря».

export interface IcsBooking {
  booking_id: string;
  start_at: string;
  end_at: string;
  hall_name: string;
  status: string;
  version: number;
}

export interface IcsTenant {
  name: string;
  address?: string;
  phone?: string;
}

/** Экранирование TEXT-значений: \ ; , и переводы строк. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 2026-11-16T07:00:00+00:00 → 20261116T070000Z */
export function icsUtc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Перенос строк длиннее 75 октетов (UTF-8): продолжение начинается с пробела. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // у продолжения 1 октет занимает пробел
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function bookingIcs(b: IcsBooking, t: IcsTenant, now = new Date()): string {
  const cancelled = b.status === 'cancelled';
  const description = [
    `Бронь: ${b.hall_name}`,
    t.phone ? `Телефон заведения: ${t.phone}` : null,
    cancelled ? 'Бронь отменена.' : null,
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//bani-pwa//booking//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.booking_id}@bani-pwa`,
    // Перенос увеличивает version — календарь обновит событие при повторном импорте.
    `SEQUENCE:${b.version}`,
    `DTSTAMP:${icsUtc(now.toISOString())}`,
    `DTSTART:${icsUtc(b.start_at)}`,
    `DTEND:${icsUtc(b.end_at)}`,
    `SUMMARY:${icsText(`${t.name} — ${b.hall_name}`)}`,
    t.address ? `LOCATION:${icsText(t.address)}` : null,
    `DESCRIPTION:${icsText(description)}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(cancelled
      ? []
      : [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT2H',
          `DESCRIPTION:${icsText(`Через 2 часа: ${t.name}`)}`,
          'END:VALARM',
        ]),
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((l): l is string => l !== null);

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
