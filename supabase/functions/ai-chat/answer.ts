// Ответ без LLM: короткий текст по результату инструмента. Используется, когда LLM не
// настроен, бюджет исчерпан или провайдер недоступен — ассистент всё равно полезен,
// а бронирование от AI не зависит вообще.
import type { Mode } from '../_shared/ai/router.ts';

const rub = (kopecks: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(kopecks / 100);

const day = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));

const at = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const hours = (min: number) => (min % 60 === 0 ? `${min / 60} ч` : `${(min / 60).toFixed(1)} ч`);

const STATUS: Record<string, string> = {
  pending: 'ожидает подтверждения',
  confirmed: 'подтверждена',
  completed: 'визит состоялся',
  cancelled: 'отменена',
  no_show: 'гости не пришли',
};

export const HELP: Record<Mode, string> = {
  guest:
    'С радостью помогу! Спросите, например: «Что свободно завтра вечером?» или «Сколько стоит в субботу в 18:00 на 3 часа на 6 человек?» — подскажу время и цену, а записаться можно кнопкой «Записаться».',
  owner:
    'Я отвечу по броням и деньгам. Например: «Кто сегодня придёт?», «Сколько заработали за неделю?», «Найди бронь у Анны».',
};

// deno-lint-ignore no-explicit-any
type Any = any;

export function answerFromTool(tool: string | null, result: Any, mode: Mode, tz: string): string {
  if (!tool || result == null) return HELP[mode];
  if (result.error) return `Не получилось: ${result.error}`;
  switch (tool) {
    case 'check_availability': {
      const parts = (result.halls as Any[]).map((h) => {
        if (h.closed) return `${h.hall}: в этот день закрыто`;
        if (h.slots.length === 0) return `${h.hall}: свободного времени нет`;
        const starts = h.slots.map((s: Any) => s.start).join(', ');
        const from = Math.min(...h.slots.map((s: Any) => s.total));
        return `${h.hall} (${hours(h.duration_min)}): ${starts}${h.more ? ` и ещё ${h.more}` : ''} — от ${rub(from)}`;
      });
      return `${day(result.date)}, свободное время начала:\n${parts.join('\n')}`;
    }
    case 'quote':
      return result.available
        ? `${result.hall}, ${day(result.date)} с ${result.time} на ${hours(result.duration_min)}, гостей ${result.guests}: ${rub(result.total)}, задаток ${rub(result.deposit)}.`
        : `${result.hall}, ${day(result.date)} с ${result.time}: это время занято или недоступно. Стоимость была бы ${rub(result.total)}.`;
    case 'get_my_booking':
      return `Ваша бронь: ${result.hall}, ${at(result.start_at, tz)}, гостей ${result.guests}. Статус: ${STATUS[result.status] ?? result.status}. Стоимость ${rub(result.total)}, оплачено ${rub(result.paid)}.`;
    case 'day_schedule': {
      const list = result.bookings as Any[];
      if (list.length === 0) return `${day(result.date)}: броней нет.`;
      const time = (iso: string) =>
        new Intl.DateTimeFormat('ru-RU', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(iso));
      return `${day(result.date)}, броней: ${list.length}\n${list
        .map(
          (b) =>
            `${time(b.start_at)}–${time(b.end_at)} ${b.hall}: ${b.name}, ${b.guests} гост., ${rub(b.total)}`,
        )
        .join('\n')}`;
    }
    case 'stats': {
      const s = result.stats;
      return [
        `${result.label ?? `${result.from} — ${result.to}`}:`,
        `получено ${rub(s.money_received)} (задатки ${rub(s.deposits_received)})`,
        `ожидается ${rub(s.expected_amount)} по ${s.expected_bookings} будущим броням`,
        `визитов ${s.visits_completed} на ${rub(s.visits_amount)}, отмен ${s.cancellations}, не пришли ${s.no_shows}`,
        `загрузка ${s.occupancy_pct} %`,
      ].join('\n');
    }
    case 'find_booking': {
      const list = result.bookings as Any[];
      if (list.length === 0) return `Броней по запросу «${result.query}» не нашлось.`;
      return list
        .map(
          (b) =>
            `${at(b.start_at, tz)} — ${b.name}${b.phone ? `, ${b.phone}` : ''}, ${b.hall}, ${STATUS[b.status] ?? b.status}`,
        )
        .join('\n');
    }
    default:
      return HELP[mode];
  }
}
