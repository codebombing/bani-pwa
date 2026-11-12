-- Этап 2: атомарные счётчики — consume_rate_limit и consume_llm_budget.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into public.tenants (id, slug, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-a', 'Тест А'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'test-b', 'Тест Б');

-- ---------- rate limit: 3 запроса на окно ----------
select is(public.consume_rate_limit('test:ip:1', 3, interval '1 minute'), true, 'запрос 1 из 3');
select is(public.consume_rate_limit('test:ip:1', 3, interval '1 minute'), true, 'запрос 2 из 3');
select is(public.consume_rate_limit('test:ip:1', 3, interval '1 minute'), true, 'запрос 3 из 3');
select is(public.consume_rate_limit('test:ip:1', 3, interval '1 minute'), false, 'запрос 4 — лимит исчерпан');
select is(public.consume_rate_limit('test:ip:2', 3, interval '1 minute'), true, 'другой ключ считается отдельно');
select throws_ok(
  $$select public.consume_rate_limit('x', 0, interval '1 minute')$$,
  '22023', null, 'лимит < 1 — ошибка аргументов'
);

-- ---------- бюджет LLM: заведение 2/сутки, глобально 3/сутки ----------
-- Тест не зависит от реального расхода за сегодня (откатывается вместе с транзакцией).
delete from public.llm_usage_global where day = (now() at time zone 'UTC')::date;
select is(public.consume_llm_budget('aaaaaaaa-0000-0000-0000-000000000001', 100, 2, 3), true, 'A: 1-й запрос');
select is(public.consume_llm_budget('aaaaaaaa-0000-0000-0000-000000000001', 100, 2, 3), true, 'A: 2-й запрос');
select is(public.consume_llm_budget('aaaaaaaa-0000-0000-0000-000000000001', 100, 2, 3), false,
  'A: 3-й — исчерпан лимит заведения');
select is(
  (select requests from public.llm_usage_global where day = (now() at time zone 'UTC')::date),
  2,
  'отказ по лимиту заведения не списал глобальный бюджет'
);
select is(public.consume_llm_budget('bbbbbbbb-0000-0000-0000-000000000001', 50, 2, 3), true,
  'B: 1-й запрос (глобально 3 из 3)');
select is(public.consume_llm_budget('bbbbbbbb-0000-0000-0000-000000000001', 50, 2, 3), false,
  'B: 2-й — исчерпан глобальный лимит');
select is(
  (select requests from public.llm_usage
   where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001' and day = (now() at time zone 'UTC')::date),
  1,
  'отказ по глобальному лимиту не списал бюджет заведения'
);

-- ---------- права ----------
set local role anon;
select throws_ok(
  $$select public.consume_rate_limit('anon', 100, interval '1 minute')$$,
  '42501', null, 'anon не вызывает consume_rate_limit напрямую'
);
reset role;

select * from finish();
rollback;
