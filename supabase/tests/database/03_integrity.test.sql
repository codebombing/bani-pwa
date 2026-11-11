-- Этап 2: целостность — составные FK не дают сослаться на объект другого заведения,
-- EXCLUDE отбивает пересечение занятости одного зала, CHECK-и брони.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into public.tenants (id, slug, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-a', 'Тест А', 'live'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'test-b', 'Тест Б', 'live');

insert into public.halls (id, tenant_id, key, name, capacity_included, capacity_max,
  min_duration_min, slot_step_min, buffer_min) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'small', 'Малый', 4, 6, 120, 60, 60),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'big', 'Большой', 8, 14, 180, 60, 60),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'main', 'Зал Б', 4, 8, 120, 30, 30);

insert into public.tariff_versions (id, tenant_id, hall_id, effective_from) values
  ('bbbbbbbb-0000-0000-0000-0000000000e1', 'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-0000000000b1', '2026-01-01');

insert into public.extras (id, tenant_id, key, name, price, unit, max_qty) values
  ('bbbbbbbb-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-000000000001',
   'karaoke', 'Караоке', 100000, 'per_booking', 1);

insert into public.bookings (id, tenant_id, hall_id, start_at, end_at, guests, source,
  customer_name, total_amount) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-10 10:00+03', '2027-01-10 12:00+03', 4,
   'phone', 'Иван', 500000),
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-10 10:00+03', '2027-01-10 12:00+03', 2,
   'phone', 'Пётр', 360000);

-- ---------- Составные FK: чужое заведение ----------
select throws_ok(
  $$insert into public.bookings (tenant_id, hall_id, start_at, end_at, guests, source, customer_name, total_amount)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000b1',
            '2027-02-01 10:00+03', '2027-02-01 12:00+03', 2, 'phone', 'X', 0)$$,
  '23503', null, 'бронь заведения A не может ссылаться на зал B'
);
select throws_ok(
  $$insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time, price_per_hour)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000e1',
            'weekday', '00:00', '24:00', 100000)$$,
  '23503', null, 'правило тарифа A не может ссылаться на версию тарифа B'
);
select throws_ok(
  $$insert into public.booking_extras (tenant_id, booking_id, extra_id, name, unit, unit_price, qty, amount)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f1',
            'bbbbbbbb-0000-0000-0000-0000000000d1', 'Караоке', 'per_booking', 100000, 1, 100000)$$,
  '23503', null, 'доп брони A не может быть допом заведения B'
);
select throws_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, booking_id, occupied)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'booking',
            'bbbbbbbb-0000-0000-0000-0000000000f1', tstzrange('2027-03-01 10:00+03', '2027-03-01 13:00+03'))$$,
  '23503', null, 'занятость A не может ссылаться на бронь B'
);
select throws_ok(
  $$insert into public.payments (tenant_id, booking_id, kind, amount, method)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000f1', 'deposit', 1000, 'cash')$$,
  '23503', null, 'платёж A не может ссылаться на бронь B'
);

-- ---------- EXCLUDE: занятость одного зала ----------
insert into public.resource_occupancies (tenant_id, hall_id, kind, booking_id, occupied) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'booking',
   'aaaaaaaa-0000-0000-0000-0000000000f1', tstzrange('2027-01-10 10:00+03', '2027-01-10 13:00+03'));

select throws_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'block',
            tstzrange('2027-01-10 12:00+03', '2027-01-10 14:00+03'))$$,
  '23P01', null, 'пересечение с активной занятостью (включая буфер) отклоняется'
);
select lives_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'block',
            tstzrange('2027-01-10 13:00+03', '2027-01-10 15:00+03'))$$,
  'стык [10,13) и [13,15) допускается'
);
select lives_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a2', 'block',
            tstzrange('2027-01-10 10:00+03', '2027-01-10 13:00+03'))$$,
  'два зала независимы: то же время в другом зале допускается'
);
select lives_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied, active, deactivated_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'block',
            tstzrange('2027-01-10 11:00+03', '2027-01-10 12:00+03'), false, now())$$,
  'неактивная занятость не участвует в EXCLUDE'
);
select throws_ok(
  $$update public.resource_occupancies set active = true, deactivated_at = null
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and not active$$,
  '23P01', null, 'повторная активация пересекающейся занятости отклоняется'
);
select throws_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, booking_id, occupied)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a2', 'booking',
            'aaaaaaaa-0000-0000-0000-0000000000f1', tstzrange('2027-05-01 10:00+03', '2027-05-01 13:00+03'))$$,
  '23505', null, 'у брони не может быть двух активных занятостей'
);

-- ---------- CHECK-и ----------
select throws_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'block',
            tstzrange('2027-06-01 10:00+03', '2027-06-01 10:00+03'))$$,
  '23514', null, 'пустой интервал занятости отклоняется'
);
select throws_ok(
  $$insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'booking',
            tstzrange('2027-06-01 10:00+03', '2027-06-01 12:00+03'))$$,
  '23514', null, 'занятость kind=booking без booking_id отклоняется'
);
select throws_ok(
  $$insert into public.bookings (tenant_id, hall_id, start_at, end_at, guests, source, customer_name, customer_phone, total_amount)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
            '2027-02-01 10:00+03', '2027-02-01 12:00+03', 2, 'online', 'Гость', '+79000000009', 0)$$,
  '23514', null, 'онлайн-бронь без согласия на обработку ПДн отклоняется'
);
select throws_ok(
  $$insert into public.bookings (tenant_id, hall_id, start_at, end_at, guests, source, customer_name, total_amount)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
            '2027-02-01 12:00+03', '2027-02-01 10:00+03', 2, 'phone', 'X', 0)$$,
  '23514', null, 'конец брони раньше начала отклоняется'
);
select throws_ok(
  $$insert into public.tenants (slug, name, timezone) values ('test-tz', 'TZ', 'Mars/Olympus')$$,
  '23514', null, 'несуществующая timezone отклоняется'
);
select throws_ok(
  $$insert into public.halls (tenant_id, key, name, capacity_included, capacity_max, min_duration_min, slot_step_min)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'odd', 'Нечётный', 4, 6, 90, 60)$$,
  '23514', null, 'минимальная длительность не кратная шагу отклоняется'
);

select * from finish();
rollback;
