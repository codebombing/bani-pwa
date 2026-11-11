-- Этап 2: структура и права — RLS везде, anon не имеет доступа к приватным таблицам,
-- EXCLUDE на занятости есть, расширения установлены.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

-- Расширения
select has_extension('btree_gist', 'btree_gist установлен');
select has_extension('pgcrypto', 'pgcrypto установлен');
select has_extension('pg_cron', 'pg_cron установлен');
select has_extension('pg_net', 'pg_net установлен');

-- RLS включён на всех таблицах public
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'RLS включён на всех таблицах public'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'),
  22,
  'в public 22 таблицы (новая таблица — проверь RLS и GRANT)'
);

-- anon: ни одного права на приватные таблицы
select ok(not has_table_privilege('anon', 'public.bookings', 'select'), 'anon не читает bookings');
select ok(not has_table_privilege('anon', 'public.booking_extras', 'select'), 'anon не читает booking_extras');
select ok(not has_table_privilege('anon', 'public.payments', 'select'), 'anon не читает payments');
select ok(not has_table_privilege('anon', 'public.booking_access_tokens', 'select'), 'anon не читает токены');
select ok(not has_table_privilege('anon', 'public.push_subscriptions', 'select'), 'anon не читает push');
select ok(not has_table_privilege('anon', 'public.resource_occupancies', 'select'), 'anon не читает занятость');
select ok(not has_table_privilege('anon', 'public.tenant_members', 'select'), 'anon не читает членство');
select ok(not has_table_privilege('anon', 'public.idempotency_keys', 'select'), 'anon не читает idempotency_keys');
select ok(not has_table_privilege('anon', 'public.audit_log', 'select'), 'anon не читает audit_log');
select ok(not has_table_privilege('anon', 'public.notification_jobs', 'select'), 'anon не читает outbox');

-- authenticated: токены и служебные счётчики недоступны вовсе; писать напрямую нельзя
select ok(not has_table_privilege('authenticated', 'public.booking_access_tokens', 'select'),
  'authenticated не читает токены');
select ok(not has_table_privilege('authenticated', 'public.idempotency_keys', 'select'),
  'authenticated не читает idempotency_keys');
select ok(not has_table_privilege('authenticated', 'public.rate_limit_buckets', 'select'),
  'authenticated не читает rate_limit_buckets');
select ok(
  not has_table_privilege('authenticated', 'public.bookings', 'insert')
  and not has_table_privilege('authenticated', 'public.bookings', 'update')
  and not has_table_privilege('authenticated', 'public.bookings', 'delete'),
  'authenticated не пишет в bookings напрямую'
);
select ok(not has_table_privilege('authenticated', 'public.payments', 'insert'),
  'authenticated не пишет в payments напрямую');
select ok(not has_table_privilege('authenticated', 'public.tenant_members', 'insert'),
  'authenticated не создаёт членство (нет публичного owner signup)');
select ok(not has_table_privilege('anon', 'public.tenants', 'insert'), 'anon не создаёт заведения');

-- Функции лимитов — только service_role
select ok(not has_function_privilege('anon', 'public.consume_rate_limit(text, integer, interval)', 'execute'),
  'anon не вызывает consume_rate_limit');
select ok(not has_function_privilege('authenticated', 'public.consume_llm_budget(uuid, integer, integer, integer)', 'execute'),
  'authenticated не вызывает consume_llm_budget');
select ok(has_function_privilege('service_role', 'public.consume_rate_limit(text, integer, interval)', 'execute'),
  'service_role вызывает consume_rate_limit');

-- EXCLUDE на занятости
select is(
  (select contype::text from pg_constraint where conname = 'resource_occupancies_no_overlap'),
  'x',
  'resource_occupancies_no_overlap — EXCLUDE constraint'
);

-- Публичные представления — security_invoker
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  0,
  'все представления public — security_invoker'
);

-- SECURITY DEFINER функции фиксируют search_path
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  0,
  'у всех SECURITY DEFINER функций задан search_path'
);

select * from finish();
rollback;
