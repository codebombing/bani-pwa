// Детерминированный роутер вопросов к ассистенту (без сети и без LLM).
// Если вопрос про свободное время, цену, свою бронь или статистику — сервер сам вызывает
// подходящий инструмент и только потом (если LLM доступен) просит модель сформулировать ответ.
// Набор намерений зависит от режима: гостю недоступны инструменты владельца и наоборот.

export type Mode = 'guest' | 'owner';

export interface HallRef {
  id: string;
  key: string;
  name: string;
}

export type Intent =
  | { tool: 'check_availability'; args: { date: string; hall_id?: string; duration_min?: number } }
  | {
      tool: 'quote';
      args: {
        date: string;
        time: string;
        hall_id?: string;
        duration_min?: number;
        guests?: number;
      };
    }
  | { tool: 'get_my_booking'; args: Record<string, never> }
  | { tool: 'day_schedule'; args: { date: string } }
  | { tool: 'stats'; args: { from: string; to: string; label: string } }
  | { tool: 'find_booking'; args: { query: string } }
  | { tool: null; args: Record<string, never> };

export const GUEST_TOOLS = ['check_availability', 'quote', 'get_my_booking'] as const;
export const OWNER_TOOLS = ['day_schedule', 'stats', 'find_booking', 'check_availability'] as const;

export function toolsFor(mode: Mode): readonly string[] {
  return mode === 'guest' ? GUEST_TOOLS : OWNER_TOOLS;
}

// ---------- даты ----------

export function todayIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isoWeekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

const WEEKDAYS: Array<[RegExp, number]> = [
  [/понедельник/, 1],
  [/вторник/, 2],
  [/сред[ау]/, 3],
  [/четверг/, 4],
  [/пятниц/, 5],
  [/суббот/, 6],
  [/воскресень/, 7],
];

const MONTHS: Array<[RegExp, number]> = [
  [/^январ/, 1],
  [/^феврал/, 2],
  [/^март/, 3],
  [/^апрел/, 4],
  [/^ма[йя]/, 5],
  [/^июн/, 6],
  [/^июл/, 7],
  [/^август/, 8],
  [/^сентябр/, 9],
  [/^октябр/, 10],
  [/^ноябр/, 11],
  [/^декабр/, 12],
];

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Дата из текста (нижний регистр) относительно today; null — дата не упомянута. */
export function parseDate(text: string, today: string): string | null {
  if (/послезавтра/.test(text)) return addDays(today, 2);
  if (/завтра/.test(text)) return addDays(today, 1);
  if (/вчера/.test(text)) return addDays(today, -1);
  if (/сегодня|сейчас|вечером|на вечер/.test(text)) return today;
  if (/выходн/.test(text)) {
    const wd = isoWeekday(today);
    return wd >= 6 ? today : addDays(today, 6 - wd);
  }
  const year = Number(today.slice(0, 4));
  const numeric = /(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s|$|[,.?!])/.exec(text);
  if (numeric) {
    const explicitYear = numeric[3];
    const y = explicitYear
      ? Number(explicitYear.length === 2 ? `20${explicitYear}` : explicitYear)
      : year;
    let d = validDate(y, Number(numeric[2]), Number(numeric[1]));
    if (d && !explicitYear && d < today)
      d = validDate(y + 1, Number(numeric[2]), Number(numeric[1]));
    if (d) return d;
  }
  const worded = /(?:^|\s)(\d{1,2})\s+([а-яё]+)/.exec(text);
  if (worded) {
    const month = MONTHS.find(([re]) => re.test(worded[2] ?? ''))?.[1];
    if (month) {
      let d = validDate(year, month, Number(worded[1]));
      if (d && d < today) d = validDate(year + 1, month, Number(worded[1]));
      if (d) return d;
    }
  }
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(text)) return addDays(today, (wd - isoWeekday(today) + 7) % 7);
  }
  return null;
}

// ---------- время, длительность, гости ----------

const NUMBER_WORDS: Record<string, number> = {
  один: 1,
  одного: 1,
  два: 2,
  двух: 2,
  три: 3,
  трех: 3,
  четыре: 4,
  четырех: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
};

const num = (token: string | undefined): number | null => {
  if (!token) return null;
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
};

const NOT_TIME =
  /^\s*(?:час|ч(?:\s|$)|человек|чел|гост|персон|ноябр|декабр|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр)/;

/** Время начала: «в 18:00», «в 18», «к 19», «с 20.30» (текст в нижнем регистре, ё→е). */
export function parseTime(text: string): string | null {
  const re = /(?:^|\s)(?:в|к|с|от)\s+(\d{1,2})(?:[:.](\d{2}))?/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (NOT_TIME.test(text.slice(m.index + m[0].length))) continue;
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h <= 23 && min <= 59) return `${pad(h)}:${pad(min)}`;
  }
  return null;
}

/** Длительность: «на 3 часа», «на два часа», «на 4 ч», «на час». */
export function parseDuration(text: string): number | null {
  const m = /(?:^|\s)(\d+|[а-я]+)\s*(?:час|ч(?:\s|$))/.exec(text);
  const n = num(m?.[1]);
  if (n && n > 0 && n <= 24) return n * 60;
  if (/на\s+час/.test(text)) return 60;
  return null;
}

const COLLECTIVE: Record<string, number> = {
  вдвоем: 2,
  втроем: 3,
  вчетвером: 4,
  впятером: 5,
  вшестером: 6,
  всемером: 7,
  ввосьмером: 8,
  двое: 2,
  трое: 3,
  четверо: 4,
  пятеро: 5,
  шестеро: 6,
  семеро: 7,
  восьмеро: 8,
};

/** Гости: «6 человек», «нас пятеро», «на 4 гостей», «компания из 8». */
export function parseGuests(text: string): number | null {
  const m =
    /(?:^|\s)(\d+|[а-я]+)\s*(?:человек|чел(?:\s|$)|гост|персон)/.exec(text) ??
    /(?:нас|из)\s+(\d+)/.exec(text);
  const n = num(m?.[1]);
  if (n && n > 0 && n <= 100) return n;
  for (const [word, value] of Object.entries(COLLECTIVE)) if (text.includes(word)) return value;
  return null;
}

export function parseHall(text: string, halls: HallRef[]): string | undefined {
  for (const h of halls) {
    const name = h.name.toLowerCase().replace(/ё/g, 'е');
    // «в малом зале» ~ «Малый зал»: основы значимых слов (без «зал»).
    const stems = name
      .split(/[\s«»"-]+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, Math.max(3, w.length - 3)));
    if (
      text.includes(name) ||
      new RegExp(`(?:^|\\s)${h.key}(?:\\s|$)`).test(text) ||
      (stems.length > 0 && stems.every((s) => text.includes(s)))
    ) {
      return h.id;
    }
  }
  return undefined;
}

// ---------- период для статистики ----------

export function parsePeriod(
  text: string,
  today: string,
): { from: string; to: string; label: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  if (/прошл\S*\s+месяц/.test(text)) {
    const prevEnd = addDays(monthStart, -1);
    return { from: `${prevEnd.slice(0, 8)}01`, to: prevEnd, label: 'прошлый месяц' };
  }
  if (/вперед|ожида|будущ|предстоящ/.test(text)) {
    return { from: today, to: addDays(today, 30), label: '30 дней вперёд' };
  }
  if (/недел|7 дней/.test(text)) {
    return { from: addDays(today, -6), to: today, label: 'последние 7 дней' };
  }
  if (/вчера/.test(text))
    return { from: addDays(today, -1), to: addDays(today, -1), label: 'вчера' };
  if (/сегодня|за день/.test(text)) return { from: today, to: today, label: 'сегодня' };
  if (/(?:^|\s)(?:за\s+)?(?:этот\s+)?год/.test(text)) {
    return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'этот год' };
  }
  const nextMonth = `${addDays(monthStart, 32).slice(0, 8)}01`;
  return { from: monthStart, to: addDays(nextMonth, -1), label: 'этот месяц' };
}

// ---------- роутер ----------

const STATS_RE =
  /заработ|выручк|доход|ден[еь]г|оплат|ожида|задат|статистик|загрузк|отчет|получил|сколько\s+(?:было\s+)?(?:брон|визит|гост|отмен)/;
const SCHEDULE_RE =
  /расписан|график|кто\s+(?:сегодня|завтра|придет)|брони\s+на|что\s+(?:у\s+нас\s+)?(?:сегодня|завтра)|какие\s+брони/;
const FIND_RE = /найд|найти|поиск|бронь\s+(?:у|на\s+имя|по\s+телефону)|чья\s+бронь/;
const MY_BOOKING_RE =
  /мо[яеюй]\S*\s+брон|моя\s+запис|у\s+меня\s+брон|когда\s+у\s+меня|во\s+сколько\s+(?:у\s+)?меня/;
const PRICE_RE = /сколько\s+стоит|стоимост|цен[аыу]|почем|по\s+чем|сколько\s+будет|обойдет/;
const AVAIL_RE =
  /свобод|есть\s+(?:ли\s+)?(?:место|время|окн)|можно\s+(?:ли\s+)?(?:заброн|прийти|приехать)|заброн|когда\s+можно|окошк|занят/;

function findQuery(original: string): string | null {
  const phone = /(\+?\d[\d\s()-]{5,}\d)/.exec(original);
  if (phone?.[1]) return phone[1].replace(/[^\d+]/g, '');
  const quoted = /[«"]([^»"]{2,40})[»"]/.exec(original);
  if (quoted?.[1]) return quoted[1].trim();
  const named = /(?:имя|у|на|для|клиент\S*|гост\S*)\s+([А-ЯЁ][а-яё]{1,30})/.exec(original);
  if (named?.[1]) return named[1];
  return (
    original
      .split(/\s+/)
      .slice(1)
      .find((w) => /^[А-ЯЁ][а-яё]{2,}$/.test(w)) ?? null
  );
}

export interface RouteContext {
  mode: Mode;
  timezone: string;
  now: Date;
  halls: HallRef[];
  hasBookingToken: boolean;
}

export function route(message: string, ctx: RouteContext): Intent {
  const original = message.trim().slice(0, 500);
  const text = original.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const today = todayIn(ctx.timezone, ctx.now);
  const date = parseDate(text, today);
  const hall_id = parseHall(text, ctx.halls);
  const duration_min = parseDuration(text) ?? undefined;
  const none: Intent = { tool: null, args: {} };

  if (ctx.mode === 'owner') {
    if (FIND_RE.test(text)) {
      const query = findQuery(original);
      return query ? { tool: 'find_booking', args: { query } } : none;
    }
    if (STATS_RE.test(text)) return { tool: 'stats', args: parsePeriod(text, today) };
    if (SCHEDULE_RE.test(text) || (date && /брон|гост|кто/.test(text))) {
      return { tool: 'day_schedule', args: { date: date ?? today } };
    }
    if (AVAIL_RE.test(text)) {
      return { tool: 'check_availability', args: { date: date ?? today, hall_id, duration_min } };
    }
    return none;
  }

  if (MY_BOOKING_RE.test(text)) {
    return ctx.hasBookingToken ? { tool: 'get_my_booking', args: {} } : none;
  }
  const time = parseTime(text);
  if (PRICE_RE.test(text) && date && time) {
    return {
      tool: 'quote',
      args: { date, time, hall_id, duration_min, guests: parseGuests(text) ?? undefined },
    };
  }
  if (AVAIL_RE.test(text) || PRICE_RE.test(text) || date) {
    return { tool: 'check_availability', args: { date: date ?? today, hall_id, duration_min } };
  }
  return none;
}
