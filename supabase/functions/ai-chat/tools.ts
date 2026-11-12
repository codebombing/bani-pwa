// Инструменты ассистента. Набор выбирает сервер по режиму (гость/владелец) — модель не видит
// и не может вызвать инструменты чужого режима. tenant_id и SQL модель не задаёт:
// аргументы проходят Zod, заведение берётся из маршрута/членства.
// Гостевые инструменты — публичные SQL-функции; инструменты владельца — клиент вызывающего
// пользователя (RLS + проверка членства в owner_*), поэтому владелец A не видит данных B.
import type { withSupabase } from '@supabase/server';
import { z } from 'zod';

import type { Mode } from '../_shared/ai/router.ts';

type Ctx = Parameters<Parameters<typeof withSupabase>[1]>[1];
type Db = Ctx['supabase'];

export interface HallInfo {
  id: string;
  key: string;
  name: string;
  min_duration_min: number;
}

export interface ToolContext {
  mode: Mode;
  tenant: { id: string; slug: string; name: string; timezone: string };
  halls: HallInfo[];
  /** Публичные функции (get_availability и т. п.) — через service role, как в public-api. */
  admin: Db;
  /** Клиент вызывающего (для владельца — его JWT, RLS). */
  caller: Db;
  /** sha256 токена брони гостя (bytea hex) — только если токен пришёл в запросе. */
  tokenHash: string | null;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const toolArgs = {
  check_availability: z.object({
    date,
    hall_id: z.uuid().optional(),
    duration_min: z.number().int().min(30).max(1440).optional(),
  }),
  quote: z.object({
    date,
    time,
    hall_id: z.uuid().optional(),
    duration_min: z.number().int().min(30).max(1440).optional(),
    guests: z.number().int().min(1).max(100).optional(),
  }),
  get_my_booking: z.object({}),
  day_schedule: z.object({ date }),
  stats: z.object({ from: date, to: date, label: z.string().max(40).optional() }),
  find_booking: z.object({ query: z.string().trim().min(2).max(60) }),
} as const;

export type ToolName = keyof typeof toolArgs;

const MODE_TOOLS: Record<Mode, ToolName[]> = {
  guest: ['check_availability', 'quote', 'get_my_booking'],
  owner: ['day_schedule', 'stats', 'find_booking', 'check_availability'],
};

export const allowedTools = (mode: Mode): ToolName[] => MODE_TOOLS[mode];

/** Описания для LLM (OpenAI function calling) — только инструменты своего режима. */
export function toolSpecs(mode: Mode) {
  const specs: Record<ToolName, { description: string; parameters: unknown }> = {
    check_availability: {
      description: 'Свободные моменты начала брони по залам на дату (с ценой).',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ГГГГ-ММ-ДД' },
          hall_id: { type: 'string', description: 'id зала из списка; без него — все залы' },
          duration_min: { type: 'integer' },
        },
        required: ['date'],
      },
    },
    quote: {
      description: 'Точная цена брони зала на дату и время.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          time: { type: 'string', description: 'ЧЧ:ММ' },
          hall_id: { type: 'string' },
          duration_min: { type: 'integer' },
          guests: { type: 'integer' },
        },
        required: ['date', 'time'],
      },
    },
    get_my_booking: {
      description: 'Бронь гостя из текущей сессии (по её ссылке).',
      parameters: { type: 'object', properties: {} },
    },
    day_schedule: {
      description: 'Брони заведения на дату.',
      parameters: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] },
    },
    stats: {
      description: 'Статистика заведения за период: деньги, визиты, отмены, загрузка.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
    find_booking: {
      description: 'Поиск брони по имени гостя или телефону.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  };
  return allowedTools(mode).map((name) => ({
    type: 'function' as const,
    function: { name, ...specs[name] },
  }));
}

// ---------- время в timezone заведения ----------

function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function zonedToUtc(isoDate: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const first = naive - tzOffsetMinutes(new Date(naive), timeZone) * 60_000;
  return new Date(naive - tzOffsetMinutes(new Date(first), timeZone) * 60_000);
}

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// ---------- исполнение ----------

export class ToolError extends Error {}

function pickHalls(ctx: ToolContext, hallId?: string): HallInfo[] {
  if (!hallId) return ctx.halls;
  const hall = ctx.halls.find((h) => h.id === hallId);
  if (!hall) throw new ToolError('Такого зала нет');
  return [hall];
}

async function rpc(db: Db, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new ToolError(error.message);
  const failed = data as { ok?: boolean; error?: string; message?: string } | null;
  if (failed && failed.ok === false)
    throw new ToolError(failed.message ?? failed.error ?? 'Ошибка');
  return data;
}

export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<unknown> {
  if (!allowedTools(ctx.mode).includes(name as ToolName)) {
    throw new ToolError(`Инструмент «${name}» недоступен в этом режиме`);
  }
  const tool = name as ToolName;
  const parsed = toolArgs[tool].safeParse(rawArgs ?? {});
  if (!parsed.success) throw new ToolError('Некорректные аргументы инструмента');
  const { tenant } = ctx;

  switch (tool) {
    case 'check_availability': {
      const a = toolArgs.check_availability.parse(parsed.data);
      const halls = [];
      for (const hall of pickHalls(ctx, a.hall_id)) {
        const r = (await rpc(ctx.admin, 'get_availability', {
          p_slug: tenant.slug,
          p_hall_id: hall.id,
          p_date: a.date,
          p_duration_min: a.duration_min ?? hall.min_duration_min,
        })) as {
          closed: boolean;
          duration_min: number;
          slots: Array<{ local_start: string; total: number }>;
        };
        halls.push({
          hall: hall.name,
          closed: r.closed,
          duration_min: r.duration_min,
          slots: r.slots.slice(0, 12).map((s) => ({ start: s.local_start, total: s.total })),
          more: Math.max(0, r.slots.length - 12),
        });
      }
      return { date: a.date, halls };
    }
    case 'quote': {
      const a = toolArgs.quote.parse(parsed.data);
      const hall = pickHalls(ctx, a.hall_id)[0];
      if (!hall) throw new ToolError('Нет залов');
      const r = (await rpc(ctx.admin, 'quote_booking', {
        p_slug: tenant.slug,
        p_hall_id: hall.id,
        p_start_at: zonedToUtc(a.date, a.time, tenant.timezone).toISOString(),
        p_duration_min: a.duration_min ?? hall.min_duration_min,
        p_guests: a.guests ?? 2,
        p_extras: [],
      })) as { total: number; deposit_amount: number; available: boolean };
      return {
        hall: hall.name,
        date: a.date,
        time: a.time,
        duration_min: a.duration_min ?? hall.min_duration_min,
        guests: a.guests ?? 2,
        total: r.total,
        deposit: r.deposit_amount,
        available: r.available,
      };
    }
    case 'get_my_booking': {
      if (!ctx.tokenHash) throw new ToolError('Откройте ассистента со страницы своей брони');
      const r = (await rpc(ctx.admin, 'get_booking_by_token_hash', {
        p_slug: tenant.slug,
        p_token_hash: ctx.tokenHash,
      })) as {
        hall_name: string;
        start_at: string;
        end_at: string;
        status: string;
        guests: number;
        total_amount: number;
        paid_amount: number;
        free_cancellation_until: string;
      };
      return {
        hall: r.hall_name,
        start_at: r.start_at,
        end_at: r.end_at,
        status: r.status,
        guests: r.guests,
        total: r.total_amount,
        paid: r.paid_amount,
        free_cancellation_until: r.free_cancellation_until,
      };
    }
    case 'day_schedule': {
      const a = toolArgs.day_schedule.parse(parsed.data);
      const { data, error } = await ctx.caller
        .from('bookings')
        .select('start_at, end_at, customer_name, guests, status, hall_id, total_amount')
        .eq('tenant_id', tenant.id)
        .gte('start_at', zonedToUtc(a.date, '00:00', tenant.timezone).toISOString())
        .lt('start_at', zonedToUtc(nextDay(a.date), '00:00', tenant.timezone).toISOString())
        .neq('status', 'cancelled')
        .order('start_at')
        .limit(50);
      if (error) throw new ToolError(error.message);
      return {
        date: a.date,
        bookings: (data ?? []).map((b) => ({
          hall: ctx.halls.find((h) => h.id === b.hall_id)?.name ?? 'Зал',
          start_at: b.start_at,
          end_at: b.end_at,
          name: b.customer_name,
          guests: b.guests,
          status: b.status,
          total: b.total_amount,
        })),
      };
    }
    case 'stats': {
      const a = toolArgs.stats.parse(parsed.data);
      const r = await rpc(ctx.caller, 'owner_stats', {
        p_tenant_id: tenant.id,
        p_from: a.from,
        p_to: a.to,
      });
      return { from: a.from, to: a.to, label: a.label ?? null, stats: r };
    }
    case 'find_booking': {
      const a = toolArgs.find_booking.parse(parsed.data);
      const digits = a.query.replace(/\D/g, '');
      let q = ctx.caller
        .from('bookings')
        .select('start_at, customer_name, customer_phone, guests, status, hall_id, total_amount')
        .eq('tenant_id', tenant.id)
        .order('start_at', { ascending: false })
        .limit(10);
      if (digits.length >= 4) {
        q = q.ilike('customer_phone', `%${digits.slice(-10)}%`);
      } else {
        // «Бориса» → «Бори%»: грубая основа имени для падежей.
        const stem = a.query.replace(/[%_]/g, '').slice(0, Math.max(3, a.query.length - 2));
        q = q.ilike('customer_name', `${stem}%`);
      }
      const { data, error } = await q;
      if (error) throw new ToolError(error.message);
      return {
        query: a.query,
        bookings: (data ?? []).map((b) => ({
          hall: ctx.halls.find((h) => h.id === b.hall_id)?.name ?? 'Зал',
          start_at: b.start_at,
          name: b.customer_name,
          phone: b.customer_phone,
          guests: b.guests,
          status: b.status,
          total: b.total_amount,
        })),
      };
    }
  }
}
