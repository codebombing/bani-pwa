import template from '../../tenants/_template/business.json';
import { businessSchema, checkTariffCoverage, type TariffRule } from './business-schema';

const clone = () => structuredClone(template);

function firstHall(biz: ReturnType<typeof clone>) {
  const hall = biz.halls[0];
  if (!hall) throw new Error('в шаблоне нет залов');
  return hall;
}

describe('businessSchema', () => {
  it('шаблон _template проходит схему', () => {
    const result = businessSchema.safeParse(template);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('отклоняет неизвестную timezone и плохой slug', () => {
    const biz = clone();
    biz.timezone = 'Mars/Olympus';
    biz.slug = 'Bad Slug';
    const result = businessSchema.safeParse(biz);
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('timezone');
    expect(paths).toContain('slug');
  });

  it('min_duration кратна шагу, включённые гости ≤ максимума', () => {
    const biz = clone();
    const hall = firstHall(biz);
    hall.min_duration_min = 90;
    hall.slot_step_min = 60;
    hall.capacity_included = 10;
    hall.capacity_max = 6;
    const result = businessSchema.safeParse(biz);
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/кратна шагу/);
    expect(messages).toMatch(/больше, чем максимум/);
  });

  it('повтор ключей залов отклоняется', () => {
    const biz = clone();
    biz.halls.push(structuredClone(firstHall(biz)));
    const result = businessSchema.safeParse(biz);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => /ключ зала/.test(i.message))).toBe(true);
  });

  it('исключения календаря различаются по kind и проверяют дату', () => {
    const ok = {
      ...clone(),
      exceptions: [
        { kind: 'closed', date: '2027-03-08' },
        { kind: 'special_hours', date: '2027-03-09', start_from: '12:00', start_to: '18:00' },
      ],
    };
    expect(businessSchema.safeParse(ok).success).toBe(true);
    const badDate = { ...clone(), exceptions: [{ kind: 'closed', date: '2027-02-30' }] };
    expect(businessSchema.safeParse(badDate).success).toBe(false);
    const badKind = { ...clone(), exceptions: [{ kind: 'vacation', date: '2027-03-08' }] };
    expect(businessSchema.safeParse(badKind).success).toBe(false);
  });
});

describe('checkTariffCoverage', () => {
  const rule = (day_type: TariffRule['day_type'], from: string, to: string): TariffRule => ({
    day_type,
    from,
    to,
    price_per_hour_rub: 1000,
  });

  it('ночь через полночь + день покрывают сутки', () => {
    expect(
      checkTariffCoverage([
        rule('weekday', '02:00', '22:00'),
        rule('weekday', '22:00', '02:00'),
        rule('weekend', '00:00', '24:00'),
      ]),
    ).toEqual([]);
  });

  it('находит дыры и наложение', () => {
    const problems = checkTariffCoverage([
      rule('weekday', '08:00', '22:00'),
      rule('weekend', '00:00', '12:00'),
      rule('weekend', '10:00', '24:00'),
    ]);
    expect(problems.some((p) => /Дыра.*будни.*00:00–08:00/.test(p))).toBe(true);
    expect(problems.some((p) => /Дыра.*будни.*22:00–24:00/.test(p))).toBe(true);
    expect(problems.some((p) => /Наложение.*выходные/.test(p))).toBe(true);
  });

  it('без правил выходных — ошибка, без праздников — допустимо', () => {
    expect(checkTariffCoverage([rule('weekday', '00:00', '24:00')])).toEqual([
      'Нет правил тарифа для типа дня «выходные»',
    ]);
  });

  it('пустой интервал from = to отклоняется', () => {
    const problems = checkTariffCoverage([
      rule('weekday', '00:00', '24:00'),
      rule('weekend', '00:00', '24:00'),
      rule('holiday', '10:00', '10:00'),
    ]);
    expect(problems.some((p) => /Пустой интервал/.test(p))).toBe(true);
  });
});
