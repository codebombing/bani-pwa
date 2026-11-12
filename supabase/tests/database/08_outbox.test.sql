-- Этап 7: outbox уведомлений и воркер.
-- Дедупликация, захват и lease, повторный захват протухшего, результат и backoff, failed,
-- перенос перепланирует, отмена гасит, устаревшая версия → skipped, preview → simulated,
-- подписки владельца только для своего заведения, воркер — только service role.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

-- ---------- Фикстуры: круглосуточное live-заведение ----------
insert into public.tenants (id, slug, name, status, timezone, deposit_percent)
values ('0b0b0b0b-0000-0000-0000-000000000001', 'test-outbox', 'Тест-уведомления', 'live', 'Europe/Moscow', 30);
insert into public.working_hours (tenant_id, weekday, start_from, start_to)
select '0b0b0b0b-0000-0000-0000-000000000001'::uuid, d, time '00:00', time '24:00' from generate_series(1, 7) d;
insert into public.halls (id, tenant_id, key, name, capacity_included, capacity_max,
  min_duration_min, slot_step_min, buffer_min)
values ('0b0b0b0b-0000-0000-0000-0000000000a1', '0b0b0b0b-0000-0000-0000-000000000001', 'main', 'Зал',
  4, 6, 120, 60, 0);
insert into public.tariff_versions (id, tenant_id, hall_id, effective_from)
values ('0b0b0b0b-0000-0000-0000-0000000001a1', '0b0b0b0b-0000-0000-0000-000000000001',
  '0b0b0b0b-0000-0000-0000-0000000000a1', '2026-01-01');
insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time, price_per_hour)
select '0b0b0b0b-0000-0000-0000-000000000001'::uuid, '0b0b0b0b-0000-0000-0000-0000000001a1'::uuid,
       dt::public.day_type, time '00:00', time '24:00', 200000
from unnest(array['weekday', 'weekend']) dt;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '0b0b0b0b-1111-1111-1111-111111111111',
        'authenticated', 'authenticated', 'owner-outbox@test.local', '', now(), now()),
       ('00000000-0000-0000-0000-000000000000', '0b0b0b0b-2222-2222-2222-222222222222',
        'authenticated', 'authenticated', 'stranger-outbox@test.local', '', now(), now());
insert into public.tenant_members (tenant_id, user_id, role)
values ('0b0b0b0b-0000-0000-0000-000000000001', '0b0b0b0b-1111-1111-1111-111111111111', 'owner');

create temp table ids (name text primary key, id uuid);
create temp table claim (n integer primary key, result jsonb);

-- Онлайн-бронь через 3 дня: событие владельцу и гостю + напоминания за 24 ч и 2 ч.
insert into ids select 'booking', (private.create_booking('0b0b0b0b-0000-0000-0000-000000000001', null,
  '0b0b0b0b-0000-0000-0000-0000000000a1', date_trunc('hour', now()) + interval '3 days', 120, 2,
  '[]'::jsonb, 'Гость', '+79000000777', null, 'online', now(), null, null, null, null, null,
  false, false, 'guest') ->> 'booking_id')::uuid;

create temp view jobs as
  select j.* from public.notification_jobs j join ids on ids.name = 'booking' and j.booking_id = ids.id;

select is((select count(*)::int from jobs), 4, 'создание брони ставит 4 задачи');
select lives_ok(
  $$ select private.enqueue_notifications((select id from ids where name = 'booking'), 'booking_created', true, true) $$,
  'повторная постановка не падает');
select is((select count(*)::int from jobs), 4, 'и не дублирует задачи (dedupe_key)');

-- Подписки: гостя на эту бронь и владельца заведения.
insert into public.push_subscriptions (tenant_id, scope, booking_id, endpoint, p256dh, auth)
values ('0b0b0b0b-0000-0000-0000-000000000001', 'guest', (select id from ids where name = 'booking'),
        'https://push.test/guest', 'k', 'a');
insert into public.push_subscriptions (tenant_id, scope, user_id, endpoint, p256dh, auth)
values ('0b0b0b0b-0000-0000-0000-000000000001', 'owner', '0b0b0b0b-1111-1111-1111-111111111111',
        'https://push.test/owner', 'k', 'a');

-- ---------- Захват ----------
insert into claim values (1, public.worker_claim_jobs(50, '2 minutes'));
select is(jsonb_array_length((select result from claim where n = 1)), 2,
  'захвачены 2 задачи «бронь создана» (напоминания ещё не наступили)');
select is((select jsonb_array_length(result -> 0 -> 'subscriptions') from claim where n = 1), 1,
  'с подпиской получателя');
select is((select count(*)::int from jobs where status = 'leased'), 2, 'обе в статусе leased');
select is(jsonb_array_length(public.worker_claim_jobs(50, '2 minutes')), 0,
  'занятые задачи не захватываются повторно');

-- Протухший lease подхватывается снова.
update public.notification_jobs set lease_until = now() - interval '1 second'
where id = (select id from jobs where recipient = 'owner' and kind = 'booking_created');
insert into claim values (2, public.worker_claim_jobs(50, '2 minutes'));
select is(jsonb_array_length((select result from claim where n = 2)), 1, 'протухший lease захвачен снова');
select is(((select result from claim where n = 2) -> 0 ->> 'attempts')::int, 2, 'попытка №2');

-- ---------- Результат ----------
do $$ begin
  perform public.worker_complete_job(((select result from claim where n = 2) -> 0 ->> 'id')::uuid, true);
  perform public.worker_complete_job(
    (select id from jobs where recipient = 'guest' and kind = 'booking_created'),
    false, 'push 500', array['https://push.test/guest']);
end $$;
select is((select status::text from jobs where recipient = 'owner' and kind = 'booking_created'),
  'sent', 'успех → sent');
select results_eq(
  $$ select status::text, run_at > now(), last_error from jobs where recipient = 'guest' and kind = 'booking_created' $$,
  $$ values ('pending', true, 'push 500') $$,
  'ошибка → pending с отложенным повтором');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://push.test/guest'), 0,
  'недействительная подписка удалена');

update public.notification_jobs set status = 'leased', attempts = 5, lease_until = now() + interval '1 minute'
where id = (select id from jobs where recipient = 'guest' and kind = 'booking_created');
do $$ begin
  perform public.worker_complete_job((select id from jobs where recipient = 'guest' and kind = 'booking_created'),
    false, 'push 500');
end $$;
select is((select status::text from jobs where recipient = 'guest' and kind = 'booking_created'), 'failed',
  'после 5 попыток → failed');

-- ---------- Перенос и отмена ----------
select is(private.reschedule_booking((select id from ids where name = 'booking'),
  date_trunc('hour', now()) + interval '4 days', 120, 1, 'guest', null) ->> 'ok', 'true', 'перенос');
select is((select count(*)::int from jobs where booking_version = 1 and kind in ('reminder_24h', 'reminder_2h')
           and status = 'skipped'), 2, 'старые напоминания погашены');
select is((select count(*)::int from jobs where booking_version = 2 and status = 'pending'), 4,
  'новые задачи версии 2: перенос владельцу и гостю + 2 напоминания');

-- Задача старой версии, вернувшаяся в очередь, не отправляется.
update public.notification_jobs set status = 'pending', run_at = now() - interval '1 minute'
where id = (select id from jobs where booking_version = 1 and kind = 'reminder_24h');
insert into claim values (3, public.worker_claim_jobs(50, '2 minutes'));
select is((select last_error from jobs where booking_version = 1 and kind = 'reminder_24h'), 'STALE_BOOKING',
  'устаревшая версия → skipped');

select is(private.cancel_booking((select id from ids where name = 'booking'), 'guest', null) ->> 'ok', 'true', 'отмена');
select is((select count(*)::int from jobs where kind in ('reminder_24h', 'reminder_2h') and status = 'pending'), 0,
  'после отмены напоминаний нет');

-- ---------- preview → simulated ----------
update public.tenants set status = 'preview' where id = '0b0b0b0b-0000-0000-0000-000000000001';
select is(jsonb_array_length(public.worker_claim_jobs(50, '2 minutes')), 0, 'preview: воркеру нечего отправлять');
select is((select count(*)::int from jobs where kind = 'booking_cancelled' and status = 'simulated'), 2,
  'preview: уведомления об отмене (владельцу и гостю) помечены simulated');

-- ---------- Доступ ----------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"0b0b0b0b-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.owner_push_subscribe('0b0b0b0b-0000-0000-0000-000000000001', 'https://push.test/x', 'k', 'a') ->> 'error',
  'FORBIDDEN', 'чужой не подписывается на уведомления заведения');
select throws_ok($$ select public.worker_claim_jobs(1, '1 minute') $$, '42501', null,
  'authenticated не может захватывать задачи');
reset role;

select * from finish();
rollback;
