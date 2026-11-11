-- Этап 3: доступ по токену, перенос (успешный и неуспешный — исходная бронь цела), отмена
-- (идемпотентна), owner-функции (быстрая бронь, ручная цена, блокировка зала, платежи,
-- статусы), изоляция владельцев, owner_stats (получено / задатки / ожидается / визиты).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(60);

-- ---------- Фикстуры ----------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'owner-a@test.local', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'owner-b@test.local', '', now(), now());

insert into public.tenants (id, slug, name, status, timezone, max_end_after_close_min,
  deposit_percent, free_cancellation_hours) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-banya', 'Тест-баня', 'live', 'Europe/Moscow', 180, 30, 24),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'test-other', 'Другое', 'live', 'Europe/Moscow', 180, 30, 24),
  ('dddddddd-0000-0000-0000-000000000001', 'test-stats', 'Статистика', 'live', 'Europe/Moscow', 180, 30, 24);

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'owner');

insert into public.working_hours (tenant_id, weekday, start_from, start_to)
select t, d, time '10:00', time '23:00'
from unnest(array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
                  'dddddddd-0000-0000-0000-000000000001']::uuid[]) t,
     generate_series(1, 7) d;

insert into public.halls (id, tenant_id, key, name, capacity_included, capacity_max, extra_guest_price,
  min_duration_min, slot_step_min, buffer_min) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'small', 'Малый', 4, 6, 40000, 120, 60, 60),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'main', 'Зал', 4, 6, 40000, 120, 60, 60),
  ('dddddddd-0000-0000-0000-0000000000d1', 'dddddddd-0000-0000-0000-000000000001', 'main', 'Зал', 4, 6, 40000, 120, 60, 60);

insert into public.tariff_versions (id, tenant_id, hall_id, effective_from)
select gen_random_uuid(), h.tenant_id, h.id, '2026-01-01' from public.halls h
join public.tenants t on t.id = h.tenant_id where t.slug like 'test-%';

insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time, price_per_hour)
select v.tenant_id, v.id, r.day_type::public.day_type, r.f::time, r.t::time, r.p
from public.tariff_versions v
join public.tenants tt on tt.id = v.tenant_id and tt.slug like 'test-%'
cross join (values ('weekday', '02:00', '22:00', 250000), ('weekday', '22:00', '02:00', 350000),
                   ('weekend', '02:00', '22:00', 320000), ('weekend', '22:00', '02:00', 350000)) r(day_type, f, t, p);

create schema tests;
create table tests.ctx (k text primary key, v jsonb);
grant usage on schema tests to authenticated;
grant all on tests.ctx to authenticated;

create function tests.book(p_slug text, p_hall uuid, p_start timestamptz, p_dur integer, p_key text default null)
returns jsonb language plpgsql as $$
declare v_key text := coalesce(p_key, gen_random_uuid()::text);
begin
  return public.public_create_booking(
    p_slug, gen_random_uuid(), p_hall, p_start, p_dur, 2, '[]'::jsonb, 'Гость',
    '+7900' || lpad((floor(random() * 10000000))::int::text, 7, '0'), null, true, v_key,
    encode(extensions.digest(v_key || p_start::text || p_dur::text, 'sha256'), 'hex'),
    extensions.digest(v_key || ':token', 'sha256'), null);
end $$;

create function tests.id(p_key text) returns uuid language sql as $$
  select (v ->> 'booking_id')::uuid from tests.ctx where k = p_key
$$;
grant execute on function tests.id(text) to authenticated;

-- Бронь R1 с токеном digest('resch-key-1:token').
insert into tests.ctx values ('R1', tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-01 12:00+03', 120, 'resch-key-1'));
select is((select v ->> 'ok' from tests.ctx where k = 'R1'), 'true', 'бронь R1 создана');

-- ---------- Доступ по токену ----------
select is((public.get_booking_by_token_hash('test-banya', extensions.digest('resch-key-1:token', 'sha256')) ->> 'booking_id')::uuid,
  tests.id('R1'), 'бронь находится по хэшу своего токена');
select is(public.get_booking_by_token_hash('test-other', extensions.digest('resch-key-1:token', 'sha256')) ->> 'error',
  'NOT_FOUND', 'токен чужого заведения — NOT_FOUND');
select is(public.get_booking_by_token_hash('test-banya', extensions.digest('wrong:token', 'sha256')) ->> 'error',
  'NOT_FOUND', 'неверный токен — NOT_FOUND');

-- ---------- Перенос успешный ----------
select is(public.reschedule_booking_by_token('test-banya', extensions.digest('resch-key-1:token', 'sha256'),
  '2027-03-06 12:00+03') ->> 'version', '2', 'перенос на субботу: version = 2');
select is((select total_amount from public.bookings where id = tests.id('R1')), 640000::bigint,
  'цена пересчитана по тарифу нового дня (выходные 3 200 ₽/ч)');
select is((select count(*)::int from public.resource_occupancies where booking_id = tests.id('R1') and active), 1,
  'после переноса ровно одна активная занятость');
select is((select lower(occupied) from public.resource_occupancies where booking_id = tests.id('R1') and active),
  '2027-03-06 12:00+03'::timestamptz, 'активная занятость — на новом времени');
select is((select count(*)::int from public.resource_occupancies where booking_id = tests.id('R1') and not active), 1,
  'старая занятость деактивирована, а не удалена');
select is((select count(*)::int from public.notification_jobs where booking_id = tests.id('R1')
  and booking_version = 1 and status = 'pending'), 0, 'задачи outbox старой версии погашены');
select is((select count(*)::int from public.notification_jobs where booking_id = tests.id('R1')
  and booking_version = 2 and status = 'pending'), 4, 'задачи outbox новой версии поставлены');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-01 12:00+03', 120) ->> 'ok',
  'true', 'прежний слот освободился');

-- ---------- Перенос неуспешный: исходная бронь цела ----------
insert into tests.ctx values ('R2', tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-08 12:00+03', 120));
select is(public.reschedule_booking_by_token('test-banya', extensions.digest('resch-key-1:token', 'sha256'),
  '2027-03-08 13:00+03') ->> 'error', 'SLOT_TAKEN', 'перенос на занятое время отклонён');
select is((select start_at from public.bookings where id = tests.id('R1')), '2027-03-06 12:00+03'::timestamptz,
  'после неудачного переноса время брони прежнее');
select is((select version from public.bookings where id = tests.id('R1')), 2, 'версия не изменилась');
select is((select count(*)::int from public.resource_occupancies where booking_id = tests.id('R1') and active
  and lower(occupied) = '2027-03-06 12:00+03'), 1, 'исходная занятость активна (откат вложенного блока)');
select is(public.reschedule_booking_by_token('test-banya', extensions.digest('resch-key-1:token', 'sha256'),
  '2027-03-09 12:00+03', null, 1) ->> 'error', 'VERSION_CONFLICT', 'устаревшая версия — VERSION_CONFLICT');
select is(public.reschedule_booking_by_token('test-banya', extensions.digest('resch-key-1:token', 'sha256'),
  '2027-03-09 08:00+03') ->> 'error', 'OUTSIDE_HOURS', 'перенос вне часов работы отклонён');

-- ---------- Отмена (идемпотентна) ----------
select is(public.cancel_booking_by_token('test-banya', extensions.digest('resch-key-1:token', 'sha256')) ->> 'already_cancelled',
  'false', 'отмена по токену');
select is((select status::text from public.bookings where id = tests.id('R1')), 'cancelled', 'статус cancelled');
select is((select count(*)::int from public.resource_occupancies where booking_id = tests.id('R1') and active), 0,
  'занятость деактивирована');
select is((select count(*)::int from public.notification_jobs where booking_id = tests.id('R1')
  and status = 'pending' and kind <> 'booking_cancelled'), 0, 'напоминания погашены');
select is((select count(*)::int from public.notification_jobs where booking_id = tests.id('R1')
  and kind = 'booking_cancelled'), 2, 'уведомление об отмене владельцу и гостю');
select is(public.cancel_booking_by_token('test-banya', extensions.digest('resch-key-1:token', 'sha256')) ->> 'already_cancelled',
  'true', 'повторная отмена — идемпотентна');
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-06 12:00+03', 120) ->> 'ok',
  'true', 'после отмены слот снова свободен');
select is(public.reschedule_booking_by_token('test-banya', extensions.digest('resch-key-1:token', 'sha256'),
  '2027-03-10 12:00+03') ->> 'error', 'NOT_RESCHEDULABLE', 'отменённую бронь перенести нельзя');

-- Данные для статистики (до переключения роли): две будущие онлайн-брони заведения test-stats.
insert into tests.ctx values ('S1', tests.book('test-stats', 'dddddddd-0000-0000-0000-0000000000d1',
  (((now() at time zone 'Europe/Moscow')::date + 10) + time '12:00') at time zone 'Europe/Moscow', 120));
insert into tests.ctx values ('S3', tests.book('test-stats', 'dddddddd-0000-0000-0000-0000000000d1',
  (((now() at time zone 'Europe/Moscow')::date + 12) + time '12:00') at time zone 'Europe/Moscow', 120));

-- ---------- Владелец A ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- Прямой вызов (через tests.book PL/pgSQL закэшировал бы проверку прав от имени postgres).
select throws_ok(
  $$select public.public_create_booking('test-banya', gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-0000000000a1',
      '2027-03-15 12:00+03', 120, 2, '[]', 'X', '+79001234567', null, true, 'auth-key-0001',
      repeat('a', 64), extensions.digest('x', 'sha256'), null)$$,
  '42501', null, 'authenticated не вызывает public_create_booking напрямую');

insert into tests.ctx values ('Q1', public.owner_quick_booking('aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-02 12:00+03', 120, 3, 'Иван (по телефону)'));
select is((select v ->> 'source' from tests.ctx where k = 'Q1'), 'phone', 'быстрая бронь без телефона, источник «телефон»');
select is((select created_by from public.bookings where id = tests.id('Q1')),
  '11111111-1111-1111-1111-111111111111'::uuid, 'created_by — владелец');
select is(public.owner_quick_booking('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000b1',
  '2027-03-02 12:00+03', 120, 2, 'X') ->> 'error', 'FORBIDDEN', 'бронь в чужом заведении — FORBIDDEN');

select is(public.owner_quick_booking('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
  '2027-03-02 16:00+03', 120, 2, 'Свои', null, 'messenger', null, '[]', 100000) ->> 'total_amount',
  '100000', 'ручная цена владельца');
select is((select (price_snapshot ->> 'manual_price')::boolean from public.bookings
  where hall_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and start_at = '2027-03-02 16:00+03'),
  true, 'в снимке пометка manual_price');
select is(public.owner_quick_booking('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
  '2027-03-02 20:00+03', 120, 2, 'Повтор', null, 'phone', null, '[]', null, 'owner-key-0001') ->> 'replay',
  'false', 'быстрая бронь с ключом');
select is(public.owner_quick_booking('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
  '2027-03-02 20:00+03', 120, 2, 'Повтор', null, 'phone', null, '[]', null, 'owner-key-0001') ->> 'replay',
  'true', 'двойное нажатие владельца не создаёт дубль');

select is(public.owner_block_hall('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
  '2027-03-02 12:00+03', '2027-03-02 13:00+03', 'Уборка') ->> 'error', 'SLOT_TAKEN', 'блокировка поверх брони отклонена');
insert into tests.ctx values ('B1', public.owner_block_hall('aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-03 10:00+03', '2027-03-03 18:00+03', 'Ремонт парной'));
select is((select v ->> 'ok' from tests.ctx where k = 'B1'), 'true', 'блокировка свободного времени');

select is(public.owner_add_payment(tests.id('Q1'), 'deposit', 150000, 'transfer') ->> 'paid_amount',
  '150000', 'задаток внесён');
select is(public.owner_add_payment(tests.id('Q1'), 'refund', 200000, 'transfer') ->> 'error',
  'REFUND_EXCEEDS_PAID', 'возврат больше полученного отклонён');
select is(public.owner_add_payment(tests.id('Q1'), 'refund', 50000, 'cash') ->> 'paid_amount',
  '100000', 'частичный возврат');
select is(public.owner_set_booking_status(tests.id('Q1'), 'completed') ->> 'status', 'completed', '«гости пришли»');
select is(public.owner_cancel_booking(tests.id('Q1')) ->> 'error', 'NOT_CANCELLABLE', 'состоявшийся визит не отменяется');

-- ---------- Владелец B не трогает данные A ----------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.owner_add_payment(tests.id('Q1'), 'payment', 1000, 'cash') ->> 'error', 'NOT_FOUND',
  'owner B: платёж по брони A — NOT_FOUND');
select is(public.owner_cancel_booking(tests.id('R2')) ->> 'error', 'NOT_FOUND', 'owner B: отмена брони A — NOT_FOUND');
select is(public.owner_stats('aaaaaaaa-0000-0000-0000-000000000001', '2027-03-01', '2027-03-31') ->> 'error',
  'FORBIDDEN', 'owner B: статистика A — FORBIDDEN');
select is(public.owner_block_hall('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
  '2027-03-04 10:00+03', '2027-03-04 12:00+03', 'X') ->> 'error', 'FORBIDDEN', 'owner B: блокировка зала A — FORBIDDEN');

-- ---------- Блокировка против онлайн-брони ----------
reset role;
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-03 12:00+03', 120) ->> 'error',
  'SLOT_TAKEN', 'гость не бронирует заблокированное время');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.owner_unblock_hall((select (v ->> 'block_id')::uuid from tests.ctx where k = 'B1')) ->> 'ok',
  'true', 'снятие блокировки');
reset role;
select is(tests.book('test-banya', 'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-03-03 12:00+03', 120) ->> 'ok',
  'true', 'после снятия блокировки бронь проходит');

-- ---------- Статистика: получено = задаток, ожидается = остаток ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into tests.ctx values ('S1pay', public.owner_add_payment(tests.id('S1'), 'deposit',
  (select ((v ->> 'total_amount')::bigint * 30 / 100) from tests.ctx where k = 'S1'), 'transfer'));
insert into tests.ctx values ('S2', public.owner_quick_booking('dddddddd-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-0000000000d1',
  (((now() at time zone 'Europe/Moscow')::date - 1) + time '12:00') at time zone 'Europe/Moscow', 120, 2, 'Вчерашние'));
select is(public.owner_set_booking_status(tests.id('S2'), 'completed') ->> 'status', 'completed', 'вчерашний визит состоялся');
select is(public.owner_add_payment(tests.id('S2'), 'payment',
  (select (v ->> 'total_amount')::bigint from tests.ctx where k = 'S2'), 'cash') ->> 'ok', 'true', 'вчерашний визит оплачен');
select is(public.owner_cancel_booking(tests.id('S3'), 'Передумали') ->> 'ok', 'true', 'одна будущая бронь отменена');

-- Предусловия: без них сравнения ниже могли бы пройти вхолостую (NULL = NULL).
select ok((select bool_and((v ->> 'ok')::boolean) from tests.ctx where k in ('S1', 'S1pay', 'S2', 'S3')),
  'брони и платежи для статистики созданы');
select ok((select (v ->> 'paid_amount')::bigint > 0 and (v ->> 'total_amount')::bigint > (v ->> 'paid_amount')::bigint
  from tests.ctx where k = 'S1pay'), 'задаток меньше стоимости будущей брони');

insert into tests.ctx values ('ST', public.owner_stats('dddddddd-0000-0000-0000-000000000001',
  (now() at time zone 'Europe/Moscow')::date - 1, (now() at time zone 'Europe/Moscow')::date + 30));

select is((select (v ->> 'bookings_created')::int from tests.ctx where k = 'ST'), 3, 'брони созданы: 3');
select is((select (v ->> 'visits_completed')::int from tests.ctx where k = 'ST'), 1, 'визиты состоялись: 1');
select is((select (v ->> 'visits_amount')::bigint from tests.ctx where k = 'ST'),
  (select (v ->> 'total_amount')::bigint from tests.ctx where k = 'S2'), 'стоимость визитов — по снимку');
select is((select (v ->> 'deposits_received')::bigint from tests.ctx where k = 'ST'),
  (select (v ->> 'paid_amount')::bigint from tests.ctx where k = 'S1pay'), 'получено задатков = внесённый задаток');
select is((select (v ->> 'money_received')::bigint from tests.ctx where k = 'ST'),
  (select (v ->> 'paid_amount')::bigint from tests.ctx where k = 'S1pay')
    + (select (v ->> 'total_amount')::bigint from tests.ctx where k = 'S2'),
  'получено всего = задаток + оплата визита');
select is((select (v ->> 'expected_amount')::bigint from tests.ctx where k = 'ST'),
  (select (v ->> 'total_amount')::bigint - (v ->> 'paid_amount')::bigint from tests.ctx where k = 'S1pay'),
  'ожидается = стоимость будущей брони минус задаток');
select is((select (v ->> 'cancellations')::int from tests.ctx where k = 'ST'), 1, 'отмен: 1');

reset role;
select * from finish();
rollback;
