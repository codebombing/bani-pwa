import { describe, expect, it } from 'vitest';

import { type Intent, type Mode, route } from './router.ts';

// «Сегодня» — четверг 12 ноября 2026, Москва.
const NOW = new Date('2026-11-12T09:00:00Z');
const HALLS = [
  { id: 'h-small', key: 'small', name: 'Малый зал' },
  { id: 'h-big', key: 'big', name: 'Большой зал' },
];

const r = (mode: Mode, text: string, hasBookingToken = false): Intent =>
  route(text, { mode, timezone: 'Europe/Moscow', now: NOW, halls: HALLS, hasBookingToken });

function stripUndefined(intent: Intent): Intent {
  return {
    ...intent,
    args: Object.fromEntries(Object.entries(intent.args).filter(([, v]) => v !== undefined)),
  } as Intent;
}

describe('роутер: гость', () => {
  it.each<[string, Intent]>([
    ['Есть свободное время завтра?', { tool: 'check_availability', args: { date: '2026-11-13' } }],
    [
      'Можно забронировать малый зал в субботу на 3 часа?',
      {
        tool: 'check_availability',
        args: { date: '2026-11-14', hall_id: 'h-small', duration_min: 180 },
      },
    ],
    [
      'Что свободно завтра в малом зале?',
      { tool: 'check_availability', args: { date: '2026-11-13', hall_id: 'h-small' } },
    ],
    ['20.11 свободно?', { tool: 'check_availability', args: { date: '2026-11-20' } }],
    ['Есть окошко на выходных?', { tool: 'check_availability', args: { date: '2026-11-14' } }],
    [
      'А 1 января работаете? Хотим забронировать',
      { tool: 'check_availability', args: { date: '2027-01-01' } },
    ],
    [
      'Сколько стоит большой зал 15 ноября в 18:00 на 4 часа, нас 10 человек',
      {
        tool: 'quote',
        args: {
          date: '2026-11-15',
          time: '18:00',
          hall_id: 'h-big',
          duration_min: 240,
          guests: 10,
        },
      },
    ],
    [
      'сколько будет в пятницу с 20 на два часа, придём вчетвером',
      { tool: 'quote', args: { date: '2026-11-13', time: '20:00', duration_min: 120, guests: 4 } },
    ],
    ['Привет! Как к вам проехать?', { tool: null, args: {} }],
  ])('%s', (text, expected) => {
    expect(stripUndefined(r('guest', text))).toEqual(expected);
  });

  it('своя бронь — только при токене брони в сессии', () => {
    expect(r('guest', 'Когда у меня бронь?', true)).toEqual({ tool: 'get_my_booking', args: {} });
    expect(r('guest', 'Когда у меня бронь?', false)).toEqual({ tool: null, args: {} });
  });

  it('гость не получает инструменты владельца', () => {
    for (const text of [
      'Сколько заработали в этом месяце?',
      'Найди бронь у Бориса',
      'Покажи статистику за неделю',
      'Кто сегодня придёт?',
    ]) {
      expect(['stats', 'find_booking', 'day_schedule']).not.toContain(r('guest', text).tool);
    }
  });
});

describe('роутер: владелец', () => {
  it.each<[string, Intent]>([
    [
      'Сколько заработали в этом месяце?',
      { tool: 'stats', args: { from: '2026-11-01', to: '2026-11-30', label: 'этот месяц' } },
    ],
    [
      'выручка за неделю',
      { tool: 'stats', args: { from: '2026-11-06', to: '2026-11-12', label: 'последние 7 дней' } },
    ],
    [
      'Отчёт за прошлый месяц',
      { tool: 'stats', args: { from: '2026-10-01', to: '2026-10-31', label: 'прошлый месяц' } },
    ],
    [
      'Сколько денег ожидается?',
      { tool: 'stats', args: { from: '2026-11-12', to: '2026-12-12', label: '30 дней вперёд' } },
    ],
    ['Кто сегодня придёт?', { tool: 'day_schedule', args: { date: '2026-11-12' } }],
    ['Брони на завтра', { tool: 'day_schedule', args: { date: '2026-11-13' } }],
    ['Найди бронь у Бориса', { tool: 'find_booking', args: { query: 'Бориса' } }],
    [
      'Найди бронь по телефону +7 900 000-01-02',
      { tool: 'find_booking', args: { query: '+79000000102' } },
    ],
    [
      'Свободно ли в большом зале в пятницу?',
      { tool: 'check_availability', args: { date: '2026-11-13', hall_id: 'h-big' } },
    ],
    ['Спасибо!', { tool: null, args: {} }],
  ])('%s', (text, expected) => {
    expect(stripUndefined(r('owner', text))).toEqual(expected);
  });

  it('у владельца «моя бронь» не вызывает инструмент гостя', () => {
    expect(r('owner', 'Когда у меня бронь?', true).tool).not.toBe('get_my_booking');
  });
});
