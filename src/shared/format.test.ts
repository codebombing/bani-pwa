import {
  addDays,
  formatDuration,
  formatRangeInTz,
  formatRub,
  formatRuPhoneInput,
  normalizeRuPhone,
  todayInTz,
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
    expect(formatRangeInTz('2026-11-14T19:00:00Z', '2026-11-14T22:00:00Z', 'Europe/Moscow')).toMatch(
      /22:00–01:00 \(15 ноября\)$/,
    );
    expect(formatRangeInTz('2026-11-12T15:00:00Z', '2026-11-12T17:00:00Z', 'Europe/Moscow')).toMatch(
      /18:00–20:00$/,
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
