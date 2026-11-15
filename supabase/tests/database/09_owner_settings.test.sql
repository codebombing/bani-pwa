-- Задаток: одна отметка на бронь (не складывается), снимается; выключатель задатка
-- обнуляет процент и возвращает его; «новые» брони; удаление брони вместе с платежами;
-- автоматическое «Пришли» после окончания визита.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'owner-a@test.local', '', now(), now());
insert into public.tenants (id, slug, name, status, timezone, max_end_after_close_min,
  deposit_percent, free_cancellation_hours) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-banya', 'Тест-баня', 'live', 'Europe/Moscow', 180, 30, 24);
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner');
insert into public.halls (id, tenant_id, key, name, capacity_included, capacity_max, extra_guest_price,
  min_duration_min, slot_step_min, buffer_min) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'small', 'Малый', 4, 6, 40000, 120, 60, 60);
insert into public.bookings (id, tenant_id, hall_id, start_at, end_at, guests, status, source,
  customer_name, customer_phone, consent_at, total_amount, price_snapshot) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000000a1', now() + interval '1 day', now() + interval '1 day 2 hours',
   2, 'confirmed', 'online', 'Гость', '+79001234567', now(), 500000, '{"deposit_amount":150000}'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000000a1', now() - interval '3 hours', now() - interval '1 hour',
   2, 'confirmed', 'phone', 'Прошлый', null, null, 300000, '{}');

select is((select count(*)::int from public.bookings
  where seen_at is null and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'онлайн-бронь новая, бронь по телефону — нет');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select ok((public.owner_set_deposit('cccccccc-0000-0000-0000-000000000001', 150000, 'cash') ->> 'ok')::boolean,
  'задаток отмечен');
select ok((public.owner_set_deposit('cccccccc-0000-0000-0000-000000000001', 150000, 'cash') ->> 'ok')::boolean,
  'повторная отметка проходит');
select is((select sum(amount)::bigint from public.payments where booking_id = 'cccccccc-0000-0000-0000-000000000001'),
  150000::bigint, 'задаток не складывается');
select is(public.owner_set_deposit('cccccccc-0000-0000-0000-000000000001', 600000) ->> 'error', 'INVALID_AMOUNT',
  'задаток больше стоимости — ошибка');
select ok((public.owner_set_deposit('cccccccc-0000-0000-0000-000000000001', 0) ->> 'ok')::boolean, 'отметка снята');
select is((select count(*)::int from public.payments where booking_id = 'cccccccc-0000-0000-0000-000000000001'),
  0, 'после снятия платежей нет');

select ok((public.owner_mark_seen('cccccccc-0000-0000-0000-000000000001') ->> 'ok')::boolean, 'прочитано');
select is((select count(*)::int from public.bookings
  where seen_at is null and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'новых нет');

select ok((public.owner_set_deposit_enabled('aaaaaaaa-0000-0000-0000-000000000001', false) ->> 'ok')::boolean,
  'задаток выключен');
select is((select deposit_percent from public.public_tenants where slug = 'test-banya'), 0,
  'при выключенном задатке процент 0');
-- Проверки отдельными запросами: подзапрос в том же операторе видит данные до вызова.
select ok((public.owner_set_deposit_enabled('aaaaaaaa-0000-0000-0000-000000000001', true) ->> 'ok')::boolean,
  'задаток включён');
select is((select deposit_percent from public.public_tenants where slug = 'test-banya'), 30,
  'включили — процент вернулся');

select public.owner_set_deposit('cccccccc-0000-0000-0000-000000000001', 100000);
select ok((public.owner_delete_booking('cccccccc-0000-0000-0000-000000000001') ->> 'ok')::boolean, 'бронь удалена');
select ok(not exists (select 1 from public.payments where booking_id = 'cccccccc-0000-0000-0000-000000000001'),
  'платежи удалённой брони тоже удалены');

reset role;
select private.complete_past_bookings();
select is((select status::text from public.bookings where id = 'cccccccc-0000-0000-0000-000000000002'),
  'completed', 'прошедшая подтверждённая бронь стала «Пришли»');

select * from finish();
rollback;
