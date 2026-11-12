-- Этап 4: публикация business.json (admin_publish_tenant).
-- Создание каталога, идемпотентность, сохранение id залов, неприкосновенность броней,
-- запрет менять/удалять использованную версию тарифа, скрытие залов и допов, live только
-- с владельцем, доступ только service role. 2027-01-04 — понедельник.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

create temp table cfg (name text primary key, c jsonb not null);
insert into cfg values ('v1', $j${
  "schema_version": 1, "slug": "test-publish", "name": "Тест-публикация",
  "timezone": "Europe/Moscow", "locale": "ru-RU", "currency": "RUB",
  "theme": {"accent": "#112233"},
  "pwa": {"short_name": "Тест", "description": ""},
  "texts": {"tagline": "", "description": "", "booking_note": ""},
  "contacts": {"phone": "+7 900 111-11-11", "address": "Адрес"},
  "legal": {"operator_name": "ИП Тест", "privacy_policy_url": "https://t.test/p"},
  "policy": {"deposit_percent": 30, "free_cancellation_hours": 24, "reschedule_pricing": "current"},
  "working_hours": {"days": {
    "mon": {"start_from": "10:00", "start_to": "22:00"}, "tue": {"start_from": "10:00", "start_to": "22:00"},
    "wed": {"start_from": "10:00", "start_to": "22:00"}, "thu": {"start_from": "10:00", "start_to": "22:00"},
    "fri": {"start_from": "10:00", "start_to": "22:00"}, "sat": {"start_from": "00:00", "start_to": "24:00"},
    "sun": null}, "max_end_after_close_min": 120},
  "halls": [
    {"key": "a", "name": "Зал А", "description": "", "capacity_included": 4, "capacity_max": 6,
     "extra_guest_price_rub": 300, "extra_guest_unit": "per_hour", "min_duration_min": 120,
     "slot_step_min": 60, "buffer_min": 60, "photos": ["halls/a/1.jpg"],
     "tariffs": [{"effective_from": "2026-01-01", "rules": [
       {"day_type": "weekday", "from": "00:00", "to": "24:00", "price_per_hour_rub": 2000},
       {"day_type": "weekend", "from": "00:00", "to": "24:00", "price_per_hour_rub": 2500}]}]},
    {"key": "b", "name": "Зал Б", "description": "", "capacity_included": 8, "capacity_max": 10,
     "extra_guest_price_rub": 0, "extra_guest_unit": "per_booking", "min_duration_min": 180,
     "slot_step_min": 60, "buffer_min": 0, "photos": [],
     "tariffs": [{"effective_from": "2026-01-01", "rules": [
       {"day_type": "weekday", "from": "00:00", "to": "24:00", "price_per_hour_rub": 3000},
       {"day_type": "weekend", "from": "00:00", "to": "24:00", "price_per_hour_rub": 3500}]}]}
  ],
  "extras": [{"key": "towels", "name": "Полотенца", "description": "", "price_rub": 200,
              "unit": "per_guest", "max_qty": 10}],
  "exceptions": [{"kind": "closed", "date": "2027-01-02"},
                 {"kind": "day_type", "date": "2027-01-01", "day_type": "holiday"}]
}$j$);

create temp table ids (name text primary key, id uuid);

-- ---------- Первая публикация ----------
select lives_ok(
  $$ select public.admin_publish_tenant((select c from cfg where name = 'v1'), repeat('a', 64), false, 'test') $$,
  'первая публикация проходит');
insert into ids select 'tenant', id from public.tenants where slug = 'test-publish';
insert into ids select 'hall_a', h.id from public.halls h join ids t on t.name = 'tenant' and h.tenant_id = t.id where h.key = 'a';

select results_eq(
  $$ select status::text, config_version from public.tenants where slug = 'test-publish' $$,
  $$ values ('preview', 1) $$,
  'новое заведение — preview, версия 1');
select is((select count(*)::int from public.halls h join ids t on t.name = 'tenant' and h.tenant_id = t.id where h.is_active), 2,
  'два активных зала');
select results_eq(
  $$ select extra_guest_price, sort, photos from public.halls where id = (select id from ids where name = 'hall_a') $$,
  $$ values (30000::bigint, 1, '["halls/a/1.jpg"]'::jsonb) $$,
  'рубли → копейки, порядок и фото зала');
select is((select count(*)::int from public.tariff_rules r join public.tariff_versions v on v.id = r.tariff_version_id
           where v.hall_id = (select id from ids where name = 'hall_a')), 2, 'два правила тарифа зала А');
select is((select price_per_hour from public.tariff_rules r join public.tariff_versions v on v.id = r.tariff_version_id
           where v.hall_id = (select id from ids where name = 'hall_a') and r.day_type = 'weekday'), 200000::bigint,
  'цена тарифа в копейках');
select is((select count(*)::int from public.working_hours where tenant_id = (select id from ids where name = 'tenant')), 6,
  'часы: 6 дней (воскресенье закрыто)');
select results_eq(
  $$ select start_from, start_to from public.working_hours where tenant_id = (select id from ids where name = 'tenant') and weekday = 6 $$,
  $$ values (time '00:00', time '24:00') $$,
  'суббота круглосуточно');
select is((select count(*)::int from public.calendar_exceptions where tenant_id = (select id from ids where name = 'tenant')), 2,
  'исключения календаря');
select is((select price from public.extras where tenant_id = (select id from ids where name = 'tenant') and key = 'towels'),
  20000::bigint, 'доп в копейках');

-- ---------- Повтор с тем же хэшем ----------
select is(
  public.admin_publish_tenant((select c from cfg where name = 'v1'), repeat('a', 64), false, 'test') ->> 'changed',
  'false', 'повторная публикация без изменений');
select is((select count(*)::int from public.tenant_config_versions where tenant_id = (select id from ids where name = 'tenant')), 1,
  'новая версия конфига не создаётся');
select is((select h.id from public.halls h where h.tenant_id = (select id from ids where name = 'tenant') and h.key = 'a'),
  (select id from ids where name = 'hall_a'), 'id зала сохраняется');

-- ---------- Бронь по тарифу 2026-01-01 ----------
select is(
  private.create_booking((select id from ids where name = 'tenant'), null, (select id from ids where name = 'hall_a'),
    timestamptz '2027-01-04 12:00+03', 120, 4, '[]'::jsonb, 'Гость', '+79000000000', null, 'phone', null, null,
    null, null, null, null, true, true, 'system') ->> 'ok',
  'true', 'бронь создана');
insert into ids select 'booking', id from public.bookings where tenant_id = (select id from ids where name = 'tenant');

-- Поменять цены использованной версии нельзя.
update cfg set c = jsonb_set(c, '{halls,0,tariffs,0,rules,0,price_per_hour_rub}', '2200') where name = 'v1';
select throws_like(
  $$ select public.admin_publish_tenant((select c from cfg where name = 'v1'), repeat('b', 64), false, 'test') $$,
  '%тариф от 2026-01-01 уже использован%',
  'использованную версию тарифа менять нельзя');
-- Удалить использованную версию тоже нельзя.
update cfg set c = jsonb_set(c, '{halls,0,tariffs,0,effective_from}', '"2027-02-01"') where name = 'v1';
select throws_like(
  $$ select public.admin_publish_tenant((select c from cfg where name = 'v1'), repeat('b', 64), false, 'test') $$,
  '%оставьте эту версию%',
  'использованную версию тарифа удалить нельзя');
select is((select count(*)::int from public.tenant_config_versions where tenant_id = (select id from ids where name = 'tenant')), 1,
  'отклонённая публикация ничего не записала');

-- Новая версия с другой датой рядом со старой — можно.
insert into cfg select 'v2', jsonb_set(c, '{halls,0,tariffs}',
  (select jsonb_build_array(
     jsonb_build_object('effective_from', '2026-01-01', 'rules', jsonb_build_array(
       jsonb_build_object('day_type', 'weekday', 'from', '00:00', 'to', '24:00', 'price_per_hour_rub', 2000),
       jsonb_build_object('day_type', 'weekend', 'from', '00:00', 'to', '24:00', 'price_per_hour_rub', 2500))),
     jsonb_build_object('effective_from', '2027-02-01', 'rules', jsonb_build_array(
       jsonb_build_object('day_type', 'weekday', 'from', '00:00', 'to', '24:00', 'price_per_hour_rub', 2200),
       jsonb_build_object('day_type', 'weekend', 'from', '00:00', 'to', '24:00', 'price_per_hour_rub', 2700))))))
from cfg where name = 'v1';
-- Цену зала Б (без броней) в той же версии менять можно.
update cfg set c = jsonb_set(c, '{halls,1,tariffs,0,rules,0,price_per_hour_rub}', '3100') where name = 'v2';
select is(
  public.admin_publish_tenant((select c from cfg where name = 'v2'), repeat('c', 64), false, 'test') ->> 'config_version',
  '2', 'новая версия тарифа → версия конфига 2');
select is((select count(*)::int from public.tariff_versions where hall_id = (select id from ids where name = 'hall_a')), 2,
  'у зала А две версии тарифа');
select is((select r.price_per_hour from public.tariff_rules r join public.tariff_versions v on v.id = r.tariff_version_id
           join public.halls h on h.id = v.hall_id
           where h.tenant_id = (select id from ids where name = 'tenant') and h.key = 'b' and r.day_type = 'weekday'),
  310000::bigint, 'цена зала Б без броней обновилась');
select is((select total_amount from public.bookings where id = (select id from ids where name = 'booking')), 400000::bigint,
  'цена существующей брони не изменилась');

-- ---------- Зал и доп убраны из конфига ----------
update cfg set c = jsonb_set(jsonb_set(c, '{halls}', jsonb_build_array(c #> '{halls,0}')), '{extras}', '[]') where name = 'v2';
select lives_ok(
  $$ select public.admin_publish_tenant((select c from cfg where name = 'v2'), repeat('d', 64), false, 'test') $$,
  'публикация без зала Б и допов');
select results_eq(
  $$ select key, is_active from public.halls where tenant_id = (select id from ids where name = 'tenant') order by key $$,
  $$ values ('a', true), ('b', false) $$,
  'зал Б скрыт, не удалён');
select is((select is_active from public.extras where tenant_id = (select id from ids where name = 'tenant') and key = 'towels'),
  false, 'доп скрыт');
select is((select status::text from public.bookings where id = (select id from ids where name = 'booking')), 'confirmed',
  'бронь на месте');
select is((select count(*)::int from public.resource_occupancies where booking_id = (select id from ids where name = 'booking') and active),
  1, 'занятость брони на месте');

-- ---------- live только с владельцем ----------
select throws_like(
  $$ select public.admin_publish_tenant((select c from cfg where name = 'v2'), repeat('d', 64), true, 'test') $$,
  '%нет владельца%',
  'live без владельца запрещён');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
        'authenticated', 'authenticated', 'owner-publish@test.local', '', now(), now());
insert into public.tenant_members (tenant_id, user_id, role)
values ((select id from ids where name = 'tenant'), '77777777-7777-7777-7777-777777777777', 'owner');
select is(
  public.admin_publish_tenant((select c from cfg where name = 'v2'), repeat('d', 64), true, 'test') ->> 'status',
  'live', 'с владельцем — live');
select is(
  public.admin_publish_tenant((select c from cfg where name = 'v2'), repeat('d', 64), false, 'test') ->> 'status',
  'live', 'обычная публикация не снимает live');

-- ---------- Проверки входа и доступ ----------
select throws_ok(
  $$ select public.admin_publish_tenant((select c from cfg where name = 'v2'), 'not-a-hash', false, 'test') $$,
  '22023', null, 'хэш проверяется');

set local role anon;
select throws_ok(
  $$ select public.admin_publish_tenant('{}'::jsonb, repeat('a', 64), false, null) $$,
  '42501', null, 'anon не может публиковать');
reset role;
set local role authenticated;
select throws_ok(
  $$ select public.admin_publish_tenant('{}'::jsonb, repeat('a', 64), false, null) $$,
  '42501', null, 'authenticated не может публиковать');
reset role;

select * from finish();
rollback;
