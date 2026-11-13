import { z } from 'zod';

/**
 * Схема business.json — вход конвейера заведений (tenant:new/validate/publish).
 * Общая для скриптов и приложения. Деньги в конфиге — целые рубли (поля *_rub),
 * в БД конвейер переводит их в копейки.
 */

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const DAY_TYPES = ['weekday', 'weekend', 'holiday'] as const;
export const EXTRA_UNITS = ['per_booking', 'per_hour', 'per_guest'] as const;

/** "ЧЧ:ММ" → минуты от начала суток (24:00 → 1440). */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const timeOfDay = z.string().regex(TIME_RE, 'Время в формате ЧЧ:ММ (00:00–24:00)');
const isoDate = z.string().refine(isValidIsoDate, 'Дата в формате ГГГГ-ММ-ДД');
const rub = z.number().int('Целое число рублей').nonnegative();
const key = z.string().regex(KEY_RE, 'Ключ: латиница в нижнем регистре, цифры, - или _');

export const dayTypeSchema = z.enum(DAY_TYPES);
export const extraUnitSchema = z.enum(EXTRA_UNITS);

/** Окно моментов начала брони. start_to < start_from — окно переходит через полночь. */
export const startWindowSchema = z
  .object({ start_from: timeOfDay, start_to: timeOfDay })
  .refine((w) => w.start_from !== '24:00', {
    message: 'Окно не может начинаться в 24:00',
    path: ['start_from'],
  });

export const tariffRuleSchema = z.object({
  day_type: dayTypeSchema,
  from: timeOfDay,
  to: timeOfDay,
  price_per_hour_rub: rub.positive(),
});

export const tariffVersionSchema = z.object({
  effective_from: isoDate,
  rules: z.array(tariffRuleSchema).min(1),
});

export const hallSchema = z.object({
  key,
  name: z.string().min(1).max(80),
  description: z.string().max(1000).default(''),
  capacity_included: z.number().int().positive(),
  capacity_max: z.number().int().positive(),
  extra_guest_price_rub: rub,
  extra_guest_unit: z.enum(['per_hour', 'per_booking']).default('per_hour'),
  min_duration_min: z.number().int().positive(),
  slot_step_min: z.number().int().positive(),
  buffer_min: z.number().int().nonnegative(),
  /** Пути относительно tenants/<slug>/images/, например "halls/small/1.jpg". */
  photos: z.array(z.string().min(1)).default([]),
  tariffs: z.array(tariffVersionSchema).min(1),
});

export const extraSchema = z.object({
  key,
  name: z.string().min(1).max(80),
  description: z.string().max(300).default(''),
  price_rub: rub.positive(),
  unit: extraUnitSchema,
  max_qty: z.number().int().positive().max(99),
});

export const calendarExceptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('closed'), date: isoDate, note: z.string().max(200).optional() }),
  z.object({
    kind: z.literal('special_hours'),
    date: isoDate,
    start_from: timeOfDay,
    start_to: timeOfDay,
    note: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('day_type'),
    date: isoDate,
    day_type: dayTypeSchema,
    note: z.string().max(200).optional(),
  }),
]);

const weekdayWindows = z.object({
  mon: startWindowSchema.nullable(),
  tue: startWindowSchema.nullable(),
  wed: startWindowSchema.nullable(),
  thu: startWindowSchema.nullable(),
  fri: startWindowSchema.nullable(),
  sat: startWindowSchema.nullable(),
  sun: startWindowSchema.nullable(),
});

export const businessSchema = z
  .object({
    schema_version: z.literal(1),
    slug: z.string().min(3).max(40).regex(SLUG_RE, 'slug: латиница, цифры и дефисы'),
    name: z.string().min(1).max(80),
    timezone: z.string().refine(isValidTimeZone, 'Неизвестная timezone (IANA)'),
    locale: z.literal('ru-RU').default('ru-RU'),
    currency: z.literal('RUB').default('RUB'),
    theme: z.object({
      accent: z.string().regex(HEX_RE, 'Цвет в формате #RRGGBB'),
      /** Главное фото первого экрана и логотип (пути относительно images/). */
      hero: z.string().min(1).optional(),
      logo: z.string().min(1).optional(),
      /** Надпись-логотип в шапке: верхняя строка, крупное название, подпись. */
      wordmark: z
        .object({
          top: z.string().max(24).optional(),
          main: z.string().min(1).max(20),
          sub: z.string().max(40).optional(),
        })
        .optional(),
    }),
    pwa: z.object({
      short_name: z.string().min(1).max(12),
      description: z.string().max(200).default(''),
    }),
    texts: z.object({
      tagline: z.string().max(120).default(''),
      description: z.string().max(2000).default(''),
      booking_note: z.string().max(500).default(''),
    }),
    contacts: z.object({
      phone: z.string().min(5).max(30),
      telegram: z.string().max(64).optional(),
      whatsapp: z.string().max(30).optional(),
      email: z.email().optional(),
      address: z.string().min(1).max(300),
      coords: z
        .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
        .optional(),
    }),
    legal: z.object({
      operator_name: z.string().min(1).max(200),
      privacy_policy_url: z.url(),
    }),
    policy: z.object({
      deposit_percent: z.number().int().min(0).max(100),
      free_cancellation_hours: z.number().int().min(0).max(720),
      /** Пересчёт цены при переносе: по текущему тарифу или по исходной версии. */
      reschedule_pricing: z.enum(['current', 'original']).default('current'),
    }),
    working_hours: z.object({
      /** null — день закрыт. */
      days: weekdayWindows,
      /** На сколько минут бронь может закончиться позже последнего момента начала. */
      max_end_after_close_min: z
        .number()
        .int()
        .min(0)
        .max(24 * 60),
    }),
    halls: z.array(hallSchema).min(1),
    extras: z.array(extraSchema).default([]),
    exceptions: z.array(calendarExceptionSchema).default([]),
  })
  .superRefine((biz, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    findDuplicates(biz.halls.map((h) => h.key)).forEach((k) =>
      issue(['halls'], `Повторяется ключ зала "${k}"`),
    );
    findDuplicates(biz.extras.map((e) => e.key)).forEach((k) =>
      issue(['extras'], `Повторяется ключ допа "${k}"`),
    );
    findDuplicates(biz.exceptions.map((e) => e.date)).forEach((d) =>
      issue(['exceptions'], `Повторяется дата исключения ${d}`),
    );

    biz.halls.forEach((hall, i) => {
      if (hall.capacity_included > hall.capacity_max) {
        issue(['halls', i, 'capacity_included'], 'Включённых гостей больше, чем максимум');
      }
      if (hall.slot_step_min % 15 !== 0) {
        issue(['halls', i, 'slot_step_min'], 'Шаг слота кратен 15 минутам');
      }
      if (hall.min_duration_min % hall.slot_step_min !== 0) {
        issue(['halls', i, 'min_duration_min'], 'Минимальная длительность кратна шагу слота');
      }
      findDuplicates(hall.tariffs.map((t) => t.effective_from)).forEach((d) =>
        issue(['halls', i, 'tariffs'], `Две версии тарифа с одной датой ${d}`),
      );
      hall.tariffs.forEach((version, v) => {
        for (const problem of checkTariffCoverage(version.rules)) {
          issue(['halls', i, 'tariffs', v, 'rules'], problem);
        }
      });
    });
  });

export type Business = z.infer<typeof businessSchema>;
export type BusinessInput = z.input<typeof businessSchema>;
export type Hall = z.infer<typeof hallSchema>;
export type TariffRule = z.infer<typeof tariffRuleSchema>;
export type DayType = z.infer<typeof dayTypeSchema>;

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

/** Интервалы правила в минутах суток [from, to); через полночь — два куска. */
function ruleSegments(rule: Pick<TariffRule, 'from' | 'to'>): Array<[number, number]> | null {
  const from = timeToMinutes(rule.from);
  const to = timeToMinutes(rule.to);
  if (from === 1440 || from === to) return null;
  if (from < to) return [[from, to]];
  const parts: Array<[number, number]> = [[from, 1440]];
  if (to > 0) parts.push([0, to]);
  return parts;
}

const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: 'будни',
  weekend: 'выходные',
  holiday: 'праздники',
};

/**
 * Правила версии тарифа должны покрывать сутки без дыр и наложений для будней
 * и выходных; праздники — опционально (без них берётся тариф выходных), но если
 * заданы, тоже целиком.
 */
export function checkTariffCoverage(rules: ReadonlyArray<TariffRule>): string[] {
  const problems: string[] = [];
  for (const dayType of DAY_TYPES) {
    const label = DAY_TYPE_LABEL[dayType];
    const ofType = rules.filter((r) => r.day_type === dayType);
    if (ofType.length === 0) {
      if (dayType !== 'holiday') problems.push(`Нет правил тарифа для типа дня «${label}»`);
      continue;
    }
    const segments: Array<[number, number]> = [];
    for (const rule of ofType) {
      const seg = ruleSegments(rule);
      if (!seg) {
        problems.push(`Пустой интервал ${rule.from}–${rule.to} (${label})`);
        continue;
      }
      segments.push(...seg);
    }
    segments.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [from, to] of segments) {
      if (from > cursor) {
        problems.push(`Дыра в тарифе (${label}): ${fmt(cursor)}–${fmt(from)} без цены`);
      } else if (from < cursor) {
        problems.push(`Наложение правил тарифа (${label}) около ${fmt(from)}`);
      }
      cursor = Math.max(cursor, to);
    }
    if (cursor < 1440) {
      problems.push(`Дыра в тарифе (${label}): ${fmt(cursor)}–24:00 без цены`);
    }
  }
  return problems;
}

function fmt(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function parseBusiness(input: unknown) {
  return businessSchema.safeParse(input);
}
