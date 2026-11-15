-- Этап 3: правила бронирования и цена.
-- Два зала, бронь через полночь, минимальная длительность и шаг, буфер, круглосуточный режим,
-- закрытая дата, тарифы будни/выходные/ночь и смешанная бронь, праздник, доплата за гостей,
-- допы, историческая цена, идемпотентность, валидация, rate limit, доступность, DST Berlin.
-- 2027-01-01 — пятница; Москва UTC+3.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(69);

-- ---------- Фикстуры ----------
insert into public.tenants (id, slug, name, status, timezone, max_end_after_close_min,
  deposit_percent, free_cancellation_hours) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-banya', 'Тест-баня', 'live', 'Europe/Moscow', 180, 30, 24),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'test-sauna24', 'Тест-сауна', 'live', 'Europe/Moscow', 0, 30, 24),
  ('cccccccc-0000-0000-0000-000000000001', 'test-berlin', 'Test Berlin', 'live', 'Europe/Berlin', 0, 0, 24);

insert into public.working_hours (tenant_id, weekday, start_from, start_to)
select 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, d, time '10:00', time '23:00' from generate_series(1, 7) d
union all
select 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, d, time '00:00', time '24:00' from generate_series(1, 7) d
union all
select 'cccccccc-0000-0000-0000-000000000001'::uuid, d, time '00:00', time '24:00' from generate_series(1, 7) d;

insert into public.halls (id, tenant_id, key, name, capacity_included, capacity_max, extra_guest_price,
  extra_guest_unit, min_duration_min, slot_step_min, buffer_min) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'small', 'Малый', 4, 6, 40000, 'per_hour', 120, 60, 60),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'big', 'Большой', 8, 14, 50000, 'per_hour', 180, 60, 60),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'sauna', 'Сауна', 4, 8, 30000, 'per_hour', 120, 30, 30),
  ('cccccccc-0000-0000-0000-0000000000c1', 'cccccccc-0000-0000-0000-000000000001', 'main', 'Main', 2, 4, 0, 'per_hour', 60, 60, 0);

insert into public.tariff_versions (id, tenant_id, hall_id, effective_from) values
  ('aaaaaaaa-0000-0000-0000-0000000001a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2026-01-01'),
  ('aaaaaaaa-0000-0000-0000-0000000001a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a2', '2026-01-01'),
  ('bbbbbbbb-0000-0000-0000-0000000001b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000b1', '2026-01-01'),
  ('cccccccc-0000-0000-0000-0000000001c1', 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-0000000000c1', '2026-01-01');

insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time, price_per_hour) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a1', 'weekday', '02:00', '22:00', 250000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a1', 'weekday', '22:00', '02:00', 350000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a1', 'weekend', '02:00', '22:00', 320000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a1', 'weekend', '22:00', '02:00', 350000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a2', 'weekday', '02:00', '22:00', 400000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a2', 'weekday', '22:00', '02:00', 550000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a2', 'weekend', '02:00', '22:00', 500000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000001a2', 'weekend', '22:00', '02:00', 550000),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000001b1', 'weekday', '08:00', '24:00', 180000),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000001b1', 'weekday', '00:00', '08:00', 200000),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000001b1', 'weekend', '08:00', '24:00', 240000),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000001b1', 'weekend', '00:00', '08:00', 200000),
  ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-0000000001c1', 'weekday', '00:00', '24:00', 100000),
  ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-0000000001c1', 'weekend', '00:00', '24:00', 100000);

insert into public.extras (id, tenant_id, key, name, price, unit, max_qty) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'venik', 'Веник', 60000, 'per_booking', 5),
  ('aaaaaaaa-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000001', 'towels', 'Полотенца', 30000, 'per_guest', 14),
  ('aaaaaaaa-0000-0000-0000-0000000000e3', 'aaaaaaaa-0000-0000-0000-000000000001', 'chan', 'Чан', 300000, 'per_booking', 1);

-- Хелпер: публичная бронь как от Edge Function. Ключ/хэш детерминированы при заданном p_key.
create schema tests;
create function tests.book(
  p_slug text, p_hall uuid, p_start timestamptz, p_dur integer,
  p_guests integer default 2, p_extras jsonb default '[]'::jsonb, p_key text default null,
  p_consent boolean default true, p_phone text default null, p_ip text default null
) returns jsonb language plpgsql as $$
declare
  v_key text := coalesce(p_key, gen_random_uuid()::text);
begin
  return public.public_create_booking(
    p_slug, gen_random_uuid(), p_hall, p_start, p_dur, p_guests, p_extras, 'Тест',
    coalesce(p_phone, '+7900' || lpad((floor(random() * 10000000))::int::text, 7, '0')),
    null, p_consent, v_key,
    encode(extensions.digest(v_key || p_hall::text || p_start::text || p_dur::text || p_guests::text || p_extras::text, 'sha256'), 'hex'),
    extensions.digest(v_key || ':token', 'sha256'), p_ip);
end $$;

-- ---------- Два зала независимы ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 12:00+03', 120) ->> 'total_amount',
  '500000', 'малый зал, будни днём: 2 ч × 2 500 ₽');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a2', '2027-01-11 12:00+03', 180) ->> 'ok',
  'true', 'большой зал в то же время — свободен (залы независимы)');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 12:00+03', 120) ->> 'error',
  'SLOT_TAKEN', 'малый зал в то же время — занят');

-- ---------- Длительность, шаг, окно ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 16:00+03', 60) ->> 'error',
  'DURATION_TOO_SHORT', 'меньше минимальной длительности');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 16:00+03', 150) ->> 'error',
  'DURATION_STEP', 'длительность не кратна шагу');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 16:30+03', 120) ->> 'error',
  'START_NOT_ON_GRID', 'начало не на шаге');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 09:00+03', 120) ->> 'error',
  'OUTSIDE_HOURS', 'начало до открытия');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-12 00:00+03', 120) ->> 'error',
  'OUTSIDE_HOURS', 'начало в 00:00 — вне окна моментов начала (10:00–23:00)');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 23:00+03', 240) ->> 'error',
  'ENDS_AFTER_CLOSE', '23:00 + 4 ч — позже 02:00');

-- ---------- Через полночь, ночной и смешанный тариф ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-12 23:00+03', 180) ->> 'total_amount',
  '1050000', 'бронь через полночь: 3 ч ночного тарифа × 3 500 ₽');
select is(
  (select end_at from public.bookings where hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     and start_at = '2027-01-12 23:00+03'),
  '2027-01-13 02:00+03'::timestamptz,
  'конец брони через полночь — 02:00 следующего дня'
);
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a2', '2027-01-15 20:00+03', 180) ->> 'total_amount',
  '1350000', 'смешанная бронь пт 20:00–23:00: 2 ч × 4 000 + 1 ч ночь × 5 500');
select is(
  (select jsonb_array_length(price_snapshot -> 'rent') from public.bookings
   where hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a2' and start_at = '2027-01-15 20:00+03'),
  2, 'в снимке две строки тарифа (день и ночь)');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-16 21:00+03', 180) ->> 'total_amount',
  '1020000', 'суббота 21:00–00:00: 1 ч × 3 200 (выходные) + 2 ч × 3 500 (ночь)');

-- ---------- Буфер между гостями ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-18 12:00+03', 120) ->> 'ok',
  'true', 'бронь 12:00–14:00 (занятость с буфером до 15:00)');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-18 14:00+03', 120) ->> 'error',
  'SLOT_TAKEN', 'встык в 14:00 нельзя — идёт протопка/уборка');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-18 10:00+03', 120) ->> 'error',
  'SLOT_TAKEN', '10:00–12:00 нельзя: её буфер до 13:00 пересекает следующую бронь');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-18 15:00+03', 120) ->> 'ok',
  'true', 'после буфера в 15:00 — можно');
select is(
  (select upper(occupied) from public.resource_occupancies o join public.bookings b on b.id = o.booking_id
   where b.hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and b.start_at = '2027-01-18 12:00+03' and o.active),
  '2027-01-18 15:00+03'::timestamptz,
  'занятость = [начало, конец + буфер)'
);

-- ---------- Круглосуточный режим ----------
select is(tests.book('test-sauna24', 'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-11 03:00+03', 120) ->> 'total_amount',
  '400000', 'сауна 24/7: 03:00 ночью можно, 2 ч × 2 000 ₽');
select is(tests.book('test-sauna24', 'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-17 23:30+03', 120) ->> 'total_amount',
  '420000', 'вс 23:30 → пн 01:30: 30 мин выходного дня + 1,5 ч ночи будней');
select is(tests.book('test-sauna24', 'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-11 10:45+03', 120) ->> 'error',
  'START_NOT_ON_GRID', 'сауна: шаг 30 мин');
select is(tests.book('test-sauna24', 'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-11 10:30+03', 150) ->> 'ok',
  'true', 'сауна: 2,5 ч с шагом 30 мин');

-- ---------- Закрытая дата и праздник ----------
insert into public.calendar_exceptions (tenant_id, date, kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '2027-01-14', 'closed');
insert into public.calendar_exceptions (tenant_id, date, kind, day_type) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '2027-01-13', 'day_type', 'holiday');

select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-14 12:00+03', 120) ->> 'error',
  'DAY_CLOSED', 'закрытая дата');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-13 23:00+03', 180) ->> 'ok',
  'true', 'ночное окно среды (до 02:00 закрытого четверга) принадлежит среде');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-13 12:00+03', 120) ->> 'total_amount',
  '640000', 'праздник в среду без правил holiday → тариф выходных 3 200 ₽/ч');

-- ---------- Гости и допы ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-19 12:00+03', 120, 6) ->> 'total_amount',
  '660000', '6 гостей при 4 включённых: + 2 × 400 ₽ × 2 ч');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-19 16:00+03', 120, 7) ->> 'error',
  'TOO_MANY_GUESTS', 'больше максимума гостей');

select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-20 12:00+03', 120, 4,
  '[{"extra_id":"aaaaaaaa-0000-0000-0000-0000000000e1","qty":2},
    {"extra_id":"aaaaaaaa-0000-0000-0000-0000000000e2","qty":4},
    {"extra_id":"aaaaaaaa-0000-0000-0000-0000000000e3","qty":1}]') ->> 'total_amount',
  '1040000', 'допы: 2 веника + 4 комплекта полотенец + чан = 5 400 ₽ к аренде 5 000 ₽');
select is(
  (select count(*)::int from public.booking_extras be join public.bookings b on b.id = be.booking_id
   where b.hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and b.start_at = '2027-01-20 12:00+03'),
  3, 'снимок допов сохранён в booking_extras');
select is(
  (select (price_snapshot ->> 'deposit_amount')::bigint from public.bookings
   where hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and start_at = '2027-01-20 12:00+03'),
  0::bigint, 'задаток выключен — в снимке 0');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-20 16:00+03', 120, 4,
  '[{"extra_id":"aaaaaaaa-0000-0000-0000-0000000000e2","qty":5}]') ->> 'error',
  'INVALID_EXTRA_QTY', 'полотенец «за гостя» не больше числа гостей');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-20 16:00+03', 120, 4,
  '[{"extra_id":"aaaaaaaa-0000-0000-0000-0000000000e3","qty":2}]') ->> 'error',
  'INVALID_EXTRA_QTY', 'чан — не больше max_qty');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-20 16:00+03', 120, 4,
  jsonb_build_array(jsonb_build_object('extra_id', gen_random_uuid(), 'qty', 1))) ->> 'error',
  'UNKNOWN_EXTRA', 'чужой/несуществующий доп');

-- ---------- Историческая цена ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-02-01 12:00+03', 120) ->> 'total_amount',
  '500000', 'бронь на 1 февраля по текущему тарифу');

insert into public.tariff_versions (id, tenant_id, hall_id, effective_from) values
  ('aaaaaaaa-0000-0000-0000-0000000002a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-25');
insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time, price_per_hour) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000002a1', 'weekday', '02:00', '22:00', 300000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000002a1', 'weekday', '22:00', '02:00', 400000),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000002a1', 'weekend', '00:00', '24:00', 400000);

select is(
  (select total_amount from public.bookings
   where hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and start_at = '2027-02-01 12:00+03'),
  500000::bigint, 'смена тарифа не меняет цену уже созданной брони');
select is(public.quote_booking('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-02-02 12:00+03', 120, 2) ->> 'total',
  '600000', 'новая бронь после даты действия — по новому тарифу 3 000 ₽/ч');
select is(public.quote_booking('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-21 12:00+03', 120, 2) ->> 'total',
  '500000', 'дата до начала новой версии — по старому тарифу');

-- ---------- Идемпотентность создания ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-22 12:00+03', 120, 2, '[]', 'idem-key-0001') ->> 'replay',
  'false', 'первый запрос с ключом создаёт бронь');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-22 12:00+03', 120, 2, '[]', 'idem-key-0001') ->> 'replay',
  'true', 'повтор с тем же ключом и телом — та же бронь (replay)');
select is(
  (select count(*)::int from public.bookings
   where hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and start_at = '2027-01-22 12:00+03'),
  1, 'повтор не создал вторую бронь');
select is(
  (tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-22 12:00+03', 120, 2, '[]', 'idem-key-0001') ->> 'booking_id')::uuid,
  (select booking_id from public.idempotency_keys where key = 'idem-key-0001'),
  'повтор возвращает исходный booking_id'
);
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-22 12:00+03', 180, 2, '[]', 'idem-key-0001') ->> 'error',
  'IDEMPOTENCY_CONFLICT', 'тот же ключ с другим телом — конфликт');

-- ---------- Валидация ----------
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-25 12:00+03', 120, 2, '[]', null, false) ->> 'error',
  'CONSENT_REQUIRED', 'без согласия на обработку ПДн бронь не создаётся');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-25 12:00+03', 120, 2, '[]', null, true, '89001234567') ->> 'error',
  'INVALID_PHONE', 'телефон не в формате +7…');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2026-01-05 12:00+03', 120) ->> 'error',
  'START_IN_PAST', 'прошедшее время');
select is(tests.book('no-such-venue', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-25 12:00+03', 120) ->> 'error',
  'TENANT_NOT_FOUND', 'неизвестное заведение');
select is(tests.book('test-banya', 'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-25 12:00+03', 120) ->> 'error',
  'HALL_NOT_FOUND', 'зал другого заведения по slug этого — не найден');

-- ---------- Rate limit (неудачные попытки тоже считаются) ----------
select is(
  (select count(*)::int from generate_series(1, 10) i
   where tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-26 12:00+03', 120, 2, '[]', null, false, null, '10.0.0.1') ->> 'error' = 'CONSENT_REQUIRED'),
  10, '10 попыток с одного IP проходят до валидации');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-26 12:00+03', 120, 2, '[]', null, true, null, '10.0.0.1') ->> 'error',
  'RATE_LIMITED', '11-я попытка с того же IP — RATE_LIMITED, даже корректная');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-26 12:00+03', 120, 2, '[]', null, true, null, '10.0.0.2') ->> 'ok',
  'true', 'другой IP — без ограничения');

-- ---------- Доступность ----------
select is(
  jsonb_array_length(public.get_availability('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11', 120) -> 'slots'),
  9, 'пн 11.01, 2 ч: бронь 12–14 (+буфер) убирает 10:00–14:00, свободны 15:00…23:00');
select is(
  public.get_availability('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11', 120) -> 'slots' -> 0 ->> 'local_start',
  '15:00', 'первый свободный момент — 15:00');
select is(
  public.get_availability('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11', 120) -> 'slots' -> -1 ->> 'total',
  '700000', 'слот 23:00–01:00 — по ночному тарифу');
select is(
  public.get_availability('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-14', 120) ->> 'closed',
  'true', 'закрытый день — closed');
select is(
  jsonb_array_length(public.get_availability('test-sauna24', 'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-20', 120) -> 'slots'),
  48, 'круглосуточно, шаг 30 мин: 48 моментов начала');
select is(
  public.get_availability('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11', 90) ->> 'error',
  'INVALID_DURATION', 'доступность с недопустимой длительностью');
select is(
  public.quote_booking('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-11 12:00+03', 120, 2) ->> 'available',
  'false', 'quote показывает, что слот занят');

-- ---------- DST: Europe/Berlin ----------
-- 28.03.2027 02:00 → 03:00 (час пропадает). 01:00 CET + 3 ч = 05:00 CEST.
select is(tests.book('test-berlin', 'cccccccc-0000-0000-0000-0000000000c1', '2027-03-28 01:00+01', 180) ->> 'total_amount',
  '300000', 'весенний переход: 3 реальных часа = 3 часа тарифа');
select is(
  (select end_at from public.bookings where hall_id = 'cccccccc-0000-0000-0000-0000000000c1'
   and start_at = '2027-03-28 01:00+01'),
  '2027-03-28 05:00+02'::timestamptz, 'весной бронь 01:00 + 3 ч заканчивается в 05:00 по местному');
select is(
  jsonb_array_length(public.get_availability('test-berlin', 'cccccccc-0000-0000-0000-0000000000c1', '2027-03-28', 60) -> 'slots'),
  20, 'в сутках перехода 23 часа: 23 момента начала минус 3 занятых');
-- 31.10.2027 03:00 → 02:00 (час повторяется). 01:00 CEST + 3 ч = 03:00 CET.
select is(tests.book('test-berlin', 'cccccccc-0000-0000-0000-0000000000c1', '2027-10-31 01:00+02', 180) ->> 'total_amount',
  '300000', 'осенний переход: 3 реальных часа = 3 часа тарифа');
select is(
  (select end_at from public.bookings where hall_id = 'cccccccc-0000-0000-0000-0000000000c1'
   and start_at = '2027-10-31 01:00+02'),
  '2027-10-31 03:00+01'::timestamptz, 'осенью бронь 01:00 + 3 ч заканчивается в 03:00 по местному');
select is(
  jsonb_array_length(public.get_availability('test-berlin', 'cccccccc-0000-0000-0000-0000000000c1', '2027-10-31', 60) -> 'slots'),
  22, 'в сутках перехода 25 часов: 25 моментов начала минус 3 занятых');
select is(
  (select sum((l ->> 'minutes')::int) from public.bookings b, jsonb_array_elements(b.price_snapshot -> 'rent') l
   where b.hall_id = 'cccccccc-0000-0000-0000-0000000000c1' and b.start_at = '2027-10-31 01:00+02'),
  180::bigint, 'в снимке ровно 180 тарифицированных минут');

-- ---------- Outbox и токен при создании ----------
select is(
  (select count(*)::int from public.notification_jobs j join public.bookings b on b.id = j.booking_id
   where b.hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and b.start_at = '2027-01-11 12:00+03'),
  4, 'outbox: подтверждение владельцу и гостю + напоминания за 24 ч и 2 ч');
select is(
  (select count(*)::int from public.booking_access_tokens k join public.bookings b on b.id = k.booking_id
   where b.hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and b.start_at = '2027-01-11 12:00+03'),
  1, 'у онлайн-брони есть хэш токена');
select is(
  (select is_demo from public.bookings where hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
   and start_at = '2027-01-11 12:00+03'),
  false, 'бронь live-заведения не помечена demo');
select is(
  (select count(*)::int from public.bookings where customer_phone is null and source = 'online'),
  0, 'у всех онлайн-броней есть телефон');

select * from finish();
rollback;
