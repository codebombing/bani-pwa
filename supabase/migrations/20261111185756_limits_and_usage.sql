-- Этап 2. Атомарные счётчики: rate limit публичных запросов и бюджет LLM.

create table public.rate_limit_buckets (
  key text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (key, window_start)
);

create index rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

-- Учитывает запрос и возвращает true, если он укладывается в лимит окна.
-- Одна инструкция INSERT … ON CONFLICT DO UPDATE … RETURNING — атомарно при конкуренции.
create function public.consume_rate_limit(p_key text, p_limit integer, p_window interval)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window is null
     or p_window <= interval '0' then
    raise exception 'consume_rate_limit: некорректные аргументы' using errcode = '22023';
  end if;

  v_window_start := pg_catalog.date_bin(p_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');

  insert into public.rate_limit_buckets as b (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start) do update set count = b.count + 1
  returning b.count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, interval) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, interval) to service_role;

-- Бюджет LLM: по заведению и глобально, сутки по UTC.
create table public.llm_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  requests integer not null default 0 check (requests >= 0),
  tokens bigint not null default 0 check (tokens >= 0),
  primary key (tenant_id, day)
);

create table public.llm_usage_global (
  day date primary key,
  requests integer not null default 0 check (requests >= 0),
  tokens bigint not null default 0 check (tokens >= 0)
);

-- Резервирует один запрос (и оценку токенов) в бюджете заведения и в глобальном.
-- Оба счётчика меняются атомарно: если любой лимит исчерпан — ничего не списывается.
create function public.consume_llm_budget(
  p_tenant_id uuid,
  p_tokens integer,
  p_tenant_daily_requests integer,
  p_global_daily_requests integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_ok boolean;
begin
  if p_tenant_id is null or coalesce(p_tokens, -1) < 0
     or coalesce(p_tenant_daily_requests, 0) < 1 or coalesce(p_global_daily_requests, 0) < 1 then
    raise exception 'consume_llm_budget: некорректные аргументы' using errcode = '22023';
  end if;

  begin
    insert into public.llm_usage_global as g (day, requests, tokens)
    values (v_day, 1, p_tokens)
    on conflict (day) do update
      set requests = g.requests + 1, tokens = g.tokens + excluded.tokens
      where g.requests < p_global_daily_requests
    returning true into v_ok;
    if v_ok is null then
      raise exception using errcode = 'P0001', message = 'llm_budget_exhausted';
    end if;
    v_ok := null;

    insert into public.llm_usage as u (tenant_id, day, requests, tokens)
    values (p_tenant_id, v_day, 1, p_tokens)
    on conflict (tenant_id, day) do update
      set requests = u.requests + 1, tokens = u.tokens + excluded.tokens
      where u.requests < p_tenant_daily_requests
    returning true into v_ok;
    if v_ok is null then
      -- Откатывает и глобальный инкремент этого блока.
      raise exception using errcode = 'P0001', message = 'llm_budget_exhausted';
    end if;
  exception
    when raise_exception then
      if sqlerrm = 'llm_budget_exhausted' then
        return false;
      end if;
      raise;
  end;

  return true;
end;
$$;

revoke execute on function public.consume_llm_budget(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_llm_budget(uuid, integer, integer, integer) to service_role;
