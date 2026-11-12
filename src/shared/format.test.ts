import {
  addDays,
  formatDuration,
  formatRangeInTz,
  formatRub,
  formatRuPhoneInput,
  normalizeRuPhone,
  todayInTz,
  zonedDayRange,
  zonedTimeToUtc,
} from './format';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('format', () => {
  it('копейки → рубли', () => {
    expect(nbsp(formatRub(500000))).toBe('5 000 ₽');
    expect(nbsp(formatRub(177050))).toBe('1 770,5 ₽');
  });

  it('сегодня в timezone заведения, а не устройства', () => {
    // 2026-11-11 22:30 UTC — в Москве уже 12 ноября.
    const now = new Date('2026-11-11T22:30:00Z');
    expect(todayInTz('Europe/Moscow', now)).toBe('2026-11-12');
    expect(todayInTz('Europe/Berlin', now)).toBe('2026-11-11');
  });

  it('addDays через границу месяца и года', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('диапазон через полночь показывает дату конца', () => {
    expect(
      formatRangeInTz('2026-11-14T19:00:00Z', '2026-11-14T22:00:00Z', 'Europe/Moscow'),
    ).toMatch(/22:00–01:00 \(15 ноября\)$/);
    expect(
      formatRangeInTz('2026-11-12T15:00:00Z', '2026-11-12T17:00:00Z', 'Europe/Moscow'),
    ).toMatch(/18:00–20:00$/);
  });

  it('локальные сутки заведения → UTC, включая переход на летнее/зимнее время', () => {
    const moscow = zonedDayRange('2026-11-16', 'Europe/Moscow');
    expect(moscow.from.toISOString()).toBe('2026-11-15T21:00:00.000Z');
    expect(moscow.to.toISOString()).toBe('2026-11-16T21:00:00.000Z');
    // 28.03.2027 в Берлине — 23 часа, 31.10.2027 — 25 часов.
    const spring = zonedDayRange('2027-03-28', 'Europe/Berlin');
    expect((spring.to.getTime() - spring.from.getTime()) / 3_600_000).toBe(23);
    const autumn = zonedDayRange('2027-10-31', 'Europe/Berlin');
    expect((autumn.to.getTime() - autumn.from.getTime()) / 3_600_000).toBe(25);
    expect(zonedTimeToUtc('2027-03-28', '05:00', 'Europe/Berlin').toISOString()).toBe(
      '2027-03-28T03:00:00.000Z',
    );
  });

  it('длительность', () => {
    expect(formatDuration(120)).toBe('2 ч');
    expect(formatDuration(150)).toBe('2,5 ч');
    expect(formatDuration(30)).toBe('30 мин');
  });

  it('телефон: нормализация и маска', () => {
    expect(normalizeRuPhone('8 (900) 123-45-67')).toBe('+79001234567');
    expect(normalizeRuPhone('+7 900 123 45 67')).toBe('+79001234567');
    expect(normalizeRuPhone('9001234567')).toBe('+79001234567');
    expect(normalizeRuPhone('+7 900 123')).toBeNull();
    expect(formatRuPhoneInput('89001234567')).toBe('+7 900 123-45-67');
    expect(formatRuPhoneInput('900')).toBe('+7 900');
    expect(formatRuPhoneInput('')).toBe('');
  });
});
