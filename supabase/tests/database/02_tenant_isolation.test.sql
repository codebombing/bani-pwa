-- Этап 2: изоляция заведений и персональных данных.
-- anon не читает брони/платежи/токены/push; владелец A не видит данные B;
-- публичный каталог виден анониму только для preview/live.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

-- ---------- Фикстуры (от имени postgres, RLS не мешает) ----------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'owner-a@test.local', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'owner-b@test.local', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'stranger@test.local', '', now(), now());

insert into public.tenants (id, slug, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-a', 'Тест А', 'live'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'test-b', 'Тест Б', 'preview'),
  ('cccccccc-0000-0000-0000-000000000001', 'test-archived', 'Архив', 'archived');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'owner');

insert into public.halls (id, tenant_id, key, name, capacity_included, capacity_max,
  min_duration_min, slot_step_min, buffer_min) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'main', 'Зал А', 4, 6, 120, 60, 60),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'main', 'Зал Б', 4, 8, 120, 30, 30),
  ('cccccccc-0000-0000-0000-0000000000c1', 'cccccccc-0000-0000-0000-000000000001', 'main', 'Зал архива', 2, 2, 60, 60, 0);

insert into public.extras (tenant_id, key, name, price, unit, max_qty) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'towels', 'Полотенца', 30000, 'per_guest', 10),
  ('cccccccc-0000-0000-0000-000000000001', 'towels', 'Полотенца', 30000, 'per_guest', 10);

insert into public.bookings (id, tenant_id, hall_id, start_at, end_at, guests, source,
  customer_name, customer_phone, consent_at, total_amount) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000000a1', '2027-01-10 10:00+03', '2027-01-10 12:00+03', 4,
   'online', 'Иван', '+79000000001', now(), 500000),
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-0000000000b1', '2027-01-10 10:00+03', '2027-01-10 12:00+03', 2,
   'online', 'Пётр', '+79000000002', now(), 360000);

insert into public.payments (tenant_id, booking_id, kind, amount, method) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'deposit', 150000, 'transfer'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000f1', 'deposit', 100000, 'cash');

insert into public.booking_access_tokens (tenant_id, booking_id, token_hash) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   extensions.digest('token-a', 'sha256'));

insert into public.push_subscriptions (tenant_id, scope, booking_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'guest', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'https://push.example/guest-a', 'k', 'a');
insert into public.push_subscriptions (tenant_id, scope, user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner', '11111111-1111-1111-1111-111111111111',
   'https://push.example/owner-a', 'k', 'a');

-- ---------- anon ----------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok('select * from public.bookings', '42501', null, 'anon: bookings — permission denied');
select throws_ok('select * from public.payments', '42501', null, 'anon: payments — permission denied');
select throws_ok('select * from public.booking_access_tokens', '42501', null, 'anon: токены — permission denied');
select throws_ok('select * from public.push_subscriptions', '42501', null, 'anon: push — permission denied');
select throws_ok('select * from public.tenant_members', '42501', null, 'anon: членство — permission denied');
select throws_ok('select * from public.resource_occupancies', '42501', null, 'anon: занятость — permission denied');

select results_eq(
  'select slug from public.public_tenants order by slug',
  $$values ('test-a'), ('test-b')$$,
  'anon видит preview/live, архивное скрыто'
);
select is((select count(*)::int from public.tenants where slug = 'test-archived'), 0,
  'anon не видит архивное заведение и в таблице');
select is((select count(*)::int from public.public_halls), 2, 'anon видит залы только публичных заведений');
select is((select count(*)::int from public.public_extras), 1, 'допы архивного заведения скрыты');

-- ---------- владелец A ----------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select is((select count(*)::int from public.bookings), 1, 'owner A видит одну бронь');
select is((select tenant_id from public.bookings limit 1), 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'owner A видит только бронь своего заведения');
select is((select count(*)::int from public.bookings where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0, 'owner A не видит брони B даже с явным фильтром');
select is((select count(*)::int from public.payments), 1, 'owner A видит только свои платежи');
select is((select count(*)::int from public.tenant_members), 1, 'owner A видит только членство своего заведения');
select is((select count(*)::int from public.push_subscriptions), 1,
  'owner A видит только свою owner-подписку, не гостевую');
select throws_ok('select * from public.booking_access_tokens', '42501', null,
  'owner A: токены недоступны');
select throws_ok(
  $$insert into public.bookings (tenant_id, hall_id, start_at, end_at, guests, source, customer_name, total_amount)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1',
            '2027-02-01 10:00+03', '2027-02-01 12:00+03', 2, 'phone', 'X', 0)$$,
  '42501', null, 'owner A не вставляет бронь напрямую (только через функции)'
);
select throws_ok(
  $$insert into public.tenant_members (tenant_id, user_id) values
    ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'owner A не может добавить себя в заведение B'
);

-- ---------- владелец B ----------
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is((select count(*)::int from public.bookings), 1, 'owner B видит одну бронь');
select is((select customer_name from public.bookings limit 1), 'Пётр', 'owner B видит только свою бронь');
select is((select count(*)::int from public.push_subscriptions), 0, 'owner B не видит подписки A');

-- ---------- чужой пользователь без членства ----------
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select is((select count(*)::int from public.bookings), 0, 'не-член не видит брони');
select is((select count(*)::int from public.payments), 0, 'не-член не видит платежи');
select is((select count(*)::int from public.tenants where status = 'archived'), 0,
  'не-член не видит архивное заведение');
select is((select count(*)::int from public.public_tenants), 2, 'не-член видит публичный каталог');

reset role;
select * from finish();
rollback;
