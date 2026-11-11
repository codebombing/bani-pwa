-- Этап 3. Статистика владельца — только SQL. Период [p_from, p_to] — локальные даты
-- в timezone заведения; UI и AI вызывают одну и ту же функцию с одинаковым периодом.
-- Разделяются: брони созданы / визиты состоялись / деньги получены (в т.ч. задатки) /
-- ожидается (будущие активные брони минус уже полученное по ним — не выручка).

create function public.owner_stats(p_tenant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_created integer;
  v_visits integer;
  v_visits_amount bigint;
  v_received bigint;
  v_deposits bigint;
  v_refunds bigint;
  v_expected bigint;
  v_expected_count integer;
  v_cancelled integer;
  v_no_show integer;
  v_available_min numeric;
  v_occupied_min numeric;
  v_by_hall jsonb;
begin
  if (select auth.uid()) is null or not private.is_member(p_tenant_id) then
    return private.fail('FORBIDDEN', 'Нет доступа к заведению');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    return private.fail('INVALID_RANGE', 'Период — от 1 дня до года');
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  v_from_ts := p_from::timestamp at time zone v_tz;
  v_to_ts := (p_to + 1)::timestamp at time zone v_tz;

  -- Брони созданы (по моменту создания).
  select count(*) into v_created
  from public.bookings b
  where b.tenant_id = p_tenant_id and b.created_at >= v_from_ts and b.created_at < v_to_ts;

  -- Визиты состоялись (completed по началу визита) и их стоимость по снимку.
  select count(*), coalesce(sum(b.total_amount), 0) into v_visits, v_visits_amount
  from public.bookings b
  where b.tenant_id = p_tenant_id and b.status = 'completed'
    and b.start_at >= v_from_ts and b.start_at < v_to_ts;

  -- Получено денег (по моменту получения): задатки + оплаты − возвраты.
  select
    coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0),
    coalesce(sum(p.amount) filter (where p.kind = 'deposit'), 0),
    coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0)
  into v_received, v_deposits, v_refunds
  from public.payments p
  where p.tenant_id = p_tenant_id and p.received_at >= v_from_ts and p.received_at < v_to_ts;

  -- Ожидается: будущие активные брони периода минус уже полученное по ним.
  select count(*), coalesce(sum(greatest(0, b.total_amount - coalesce(paid.net, 0))), 0)
  into v_expected_count, v_expected
  from public.bookings b
  left join lateral (
    select sum(case when p.kind = 'refund' then -p.amount else p.amount end) as net
    from public.payments p where p.booking_id = b.id
  ) paid on true
  where b.tenant_id = p_tenant_id and b.status in ('pending', 'confirmed')
    and b.start_at >= greatest(now(), v_from_ts) and b.start_at < v_to_ts;

  select
    count(*) filter (where b.status = 'cancelled'),
    count(*) filter (where b.status = 'no_show')
  into v_cancelled, v_no_show
  from public.bookings b
  where b.tenant_id = p_tenant_id and b.start_at >= v_from_ts and b.start_at < v_to_ts;

  -- Загрузка: занятые минуты броней (без буфера) / доступные минуты окна работы.
  with halls as (
    select h.id, h.name, h.sort from public.halls h
    where h.tenant_id = p_tenant_id and h.is_active
  ),
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  windows as (
    select w.window_start, coalesce(w.last_end, w.window_end) as window_close
    from days
    cross join lateral private.start_window(p_tenant_id, days.day) w
  ),
  available as (
    select h.id as hall_id,
           coalesce(sum(extract(epoch from (w.window_close - w.window_start)) / 60), 0) as minutes
    from halls h cross join windows w
    group by h.id
  ),
  occupied as (
    select b.hall_id,
           sum(extract(epoch from (least(b.end_at, v_to_ts) - greatest(b.start_at, v_from_ts))) / 60) as minutes
    from public.bookings b
    where b.tenant_id = p_tenant_id
      and b.status in ('pending', 'confirmed', 'completed', 'no_show')
      and b.start_at < v_to_ts and b.end_at > v_from_ts
    group by b.hall_id
  )
  select
    coalesce(sum(a.minutes), 0),
    coalesce(sum(o.minutes), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'hall_id', h.id,
      'hall_name', h.name,
      'available_hours', round(coalesce(a.minutes, 0) / 60, 1),
      'occupied_hours', round(coalesce(o.minutes, 0) / 60, 1),
      'occupancy_pct', case when coalesce(a.minutes, 0) > 0
        then round(100 * coalesce(o.minutes, 0) / a.minutes, 1) else 0 end
    ) order by h.sort, h.name), '[]'::jsonb)
  into v_available_min, v_occupied_min, v_by_hall
  from halls h
  left join available a on a.hall_id = h.id
  left join occupied o on o.hall_id = h.id;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', p_tenant_id,
    'timezone', v_tz,
    'from', p_from,
    'to', p_to,
    'bookings_created', v_created,
    'visits_completed', v_visits,
    'visits_amount', v_visits_amount,
    'money_received', v_received,
    'deposits_received', v_deposits,
    'refunds', v_refunds,
    'expected_amount', v_expected,
    'expected_bookings', v_expected_count,
    'cancellations', v_cancelled,
    'no_shows', v_no_show,
    'occupancy_pct', case when v_available_min > 0
      then round(100 * v_occupied_min / v_available_min, 1) else 0 end,
    'occupied_hours', round(v_occupied_min / 60, 1),
    'available_hours', round(v_available_min / 60, 1),
    'by_hall', v_by_hall
  );
end;
$$;

revoke execute on function public.owner_stats(uuid, date, date) from public, anon;
grant execute on function public.owner_stats(uuid, date, date) to authenticated;
