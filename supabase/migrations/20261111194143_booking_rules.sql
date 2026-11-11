-- Этап 3. Правила бронирования: окно моментов начала, тип дня, версия тарифа, расчёт цены.
-- Всё время — в timezone заведения. Функции приватные (схема private), вызываются из
-- публичных/owner-функций. Ошибки бизнес-правил возвращаются как jsonb {ok:false, error},
-- а не исключением: тогда атомарные счётчики (rate limit) фиксируются и при отказе.

create function private.fail(p_code text, p_message text default null, p_details jsonb default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'ok', false,
    'error', p_code,
    'message', coalesce(p_message, p_code),
    'details', p_details
  ));
$$;

-- Окно моментов начала для локальной даты p_day (день, которому окно принадлежит).
-- Окно, начавшееся вечером, продолжается после полуночи и принадлежит дню начала.
-- window_end — последний допустимый момент начала (включительно).
-- last_end — крайний конец брони (window_end + max_end_after_close_min); null — круглосуточно.
create function private.start_window(p_tenant_id uuid, p_day date)
returns table (
  window_start timestamptz,
  window_end timestamptz,
  last_end timestamptz,
  round_clock boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_max_end integer;
  v_kind public.exception_kind;
  v_exc_from time;
  v_exc_to time;
  v_from time;
  v_to time;
  v_local_from timestamp;
  v_local_to timestamp;
begin
  select t.timezone, t.max_end_after_close_min into v_tz, v_max_end
  from public.tenants t where t.id = p_tenant_id;
  if v_tz is null then
    return;
  end if;

  select e.kind, e.start_from, e.start_to into v_kind, v_exc_from, v_exc_to
  from public.calendar_exceptions e
  where e.tenant_id = p_tenant_id and e.date = p_day;

  if v_kind = 'closed' then
    return;
  elsif v_kind = 'special_hours' then
    v_from := v_exc_from;
    v_to := v_exc_to;
  else
    select w.start_from, w.start_to into v_from, v_to
    from public.working_hours w
    where w.tenant_id = p_tenant_id
      and w.weekday = extract(isodow from p_day)::smallint;
    if v_from is null then
      return;
    end if;
  end if;

  v_local_from := p_day + v_from;
  v_local_to := case when v_to > v_from then p_day + v_to else (p_day + 1) + v_to end;

  round_clock := v_from = time '00:00' and v_to = time '24:00';
  window_start := v_local_from at time zone v_tz;
  window_end := v_local_to at time zone v_tz;
  last_end := case
    when round_clock then null
    else (v_local_to + make_interval(mins => v_max_end)) at time zone v_tz
  end;
  return next;
end;
$$;

-- Проверка слота по правилам 1–5: длительность, гости, окно, сетка шага, конец до закрытия.
-- Возвращает {ok:true, end_at, window_day} или {ok:false, error}.
create function private.check_slot(
  p_hall_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_guests integer
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hall public.halls%rowtype;
  v_tz text;
  v_local_day date;
  v_day date;
  v_w record;
  v_matched boolean := false;
  v_end_at timestamptz;
  v_offset_min numeric;
begin
  select * into v_hall from public.halls h where h.id = p_hall_id;
  if not found then
    return private.fail('HALL_NOT_FOUND', 'Зал не найден');
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = v_hall.tenant_id;

  if p_start_at is null or p_duration_min is null then
    return private.fail('INVALID_ARGUMENT', 'Нужны время начала и длительность');
  end if;
  if p_duration_min < v_hall.min_duration_min then
    return private.fail('DURATION_TOO_SHORT',
      format('Минимальная длительность — %s мин', v_hall.min_duration_min),
      jsonb_build_object('min_duration_min', v_hall.min_duration_min));
  end if;
  if p_duration_min % v_hall.slot_step_min <> 0 then
    return private.fail('DURATION_STEP',
      format('Длительность должна быть кратна %s мин', v_hall.slot_step_min),
      jsonb_build_object('slot_step_min', v_hall.slot_step_min));
  end if;
  if p_duration_min > 1440 then
    return private.fail('DURATION_TOO_LONG', 'Бронь не длиннее суток');
  end if;
  if p_guests is null or p_guests < 1 then
    return private.fail('INVALID_GUESTS', 'Укажите число гостей');
  end if;
  if p_guests > v_hall.capacity_max then
    return private.fail('TOO_MANY_GUESTS',
      format('В зале не больше %s гостей', v_hall.capacity_max),
      jsonb_build_object('capacity_max', v_hall.capacity_max));
  end if;

  v_local_day := (p_start_at at time zone v_tz)::date;

  -- Сначала окно своего дня, затем окно вчерашнего дня, перешедшее через полночь.
  foreach v_day in array array[v_local_day, v_local_day - 1] loop
    select * into v_w from private.start_window(v_hall.tenant_id, v_day);
    if v_w.window_start is not null
       and p_start_at >= v_w.window_start and p_start_at <= v_w.window_end then
      v_matched := true;
      exit;
    end if;
  end loop;

  if not v_matched then
    if exists (
      select 1 from public.calendar_exceptions e
      where e.tenant_id = v_hall.tenant_id and e.date = v_local_day and e.kind = 'closed'
    ) then
      return private.fail('DAY_CLOSED', 'В этот день заведение закрыто');
    end if;
    return private.fail('OUTSIDE_HOURS', 'Время начала вне часов работы');
  end if;

  v_offset_min := extract(epoch from (p_start_at - v_w.window_start)) / 60;
  if v_offset_min <> trunc(v_offset_min) or (v_offset_min::bigint % v_hall.slot_step_min) <> 0 then
    return private.fail('START_NOT_ON_GRID',
      format('Начало должно попадать на шаг %s мин', v_hall.slot_step_min));
  end if;

  v_end_at := p_start_at + make_interval(mins => p_duration_min);
  if not v_w.round_clock and v_end_at > v_w.last_end then
    return private.fail('ENDS_AFTER_CLOSE', 'Бронь заканчивается после закрытия',
      jsonb_build_object('last_end', v_w.last_end));
  end if;

  return jsonb_build_object('ok', true, 'end_at', v_end_at, 'window_day', v_day);
end;
$$;

-- Тип дня по локальной дате: исключение day_type → его тип; сб/вс → weekend; иначе weekday.
create function private.day_type_for(p_tenant_id uuid, p_day date)
returns public.day_type
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select e.day_type from public.calendar_exceptions e
     where e.tenant_id = p_tenant_id and e.date = p_day and e.kind = 'day_type'),
    case when extract(isodow from p_day) in (6, 7)
      then 'weekend'::public.day_type else 'weekday'::public.day_type end
  );
$$;

-- Версия тарифа зала, действующая на локальную дату начала брони.
create function private.tariff_version_for(p_hall_id uuid, p_day date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id
  from public.tariff_versions v
  where v.hall_id = p_hall_id and v.effective_from <= p_day
  order by v.effective_from desc
  limit 1;
$$;

-- Расчёт цены (правило 6). Интервал режется на куски по slot_step_min; кусок тарифицируется
-- правилом, действующим в ЛОКАЛЬНЫЙ момент начала куска (тип дня — по локальной дате куска;
-- holiday без правил holiday → weekend). + доплата за гостей сверх включённых + допы.
-- p_extras: [{"extra_id": uuid, "qty": int}]. Валидность слота НЕ проверяет (см. check_slot).
create function private.compute_quote(
  p_hall_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_guests integer,
  p_extras jsonb default '[]'::jsonb,
  p_tariff_version_id uuid default null,
  p_allow_inactive_extras boolean default false
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hall public.halls%rowtype;
  v_tenant public.tenants%rowtype;
  v_version uuid;
  v_has_holiday boolean;
  v_step interval;
  v_ts timestamptz;
  v_end timestamptz;
  v_local timestamp;
  v_dt public.day_type;
  v_price bigint;
  v_amount bigint;
  v_rent_total bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line_from timestamp;
  v_line_to timestamp;
  v_line_dt public.day_type;
  v_line_price bigint;
  v_line_min integer := 0;
  v_line_amount bigint := 0;
  v_extra_count integer;
  v_extra_guests_amount bigint := 0;
  v_item jsonb;
  v_extra public.extras%rowtype;
  v_qty integer;
  v_extras_lines jsonb := '[]'::jsonb;
  v_extras_total bigint := 0;
  v_seen uuid[] := '{}';
  v_extra_id uuid;
  v_total bigint;
  v_deposit bigint;
begin
  select * into v_hall from public.halls h where h.id = p_hall_id;
  if not found then
    return private.fail('HALL_NOT_FOUND', 'Зал не найден');
  end if;
  select * into v_tenant from public.tenants t where t.id = v_hall.tenant_id;

  v_version := coalesce(
    p_tariff_version_id,
    private.tariff_version_for(p_hall_id, (p_start_at at time zone v_tenant.timezone)::date)
  );
  if v_version is null then
    return private.fail('NO_TARIFF', 'Для этой даты нет тарифа');
  end if;

  select exists (
    select 1 from public.tariff_rules r
    where r.tariff_version_id = v_version and r.day_type = 'holiday'
  ) into v_has_holiday;

  v_step := make_interval(mins => v_hall.slot_step_min);
  v_ts := p_start_at;
  v_end := p_start_at + make_interval(mins => p_duration_min);

  while v_ts < v_end loop
    v_local := v_ts at time zone v_tenant.timezone;
    v_dt := private.day_type_for(v_hall.tenant_id, v_local::date);
    if v_dt = 'holiday' and not v_has_holiday then
      v_dt := 'weekend';
    end if;

    v_price := null;
    select r.price_per_hour into v_price
    from public.tariff_rules r
    where r.tariff_version_id = v_version
      and r.day_type = v_dt
      and (
        (r.from_time < r.to_time and v_local::time >= r.from_time and v_local::time < r.to_time)
        or (r.from_time > r.to_time and (v_local::time >= r.from_time or v_local::time < r.to_time))
      )
    limit 1;

    if v_price is null then
      return private.fail('NO_TARIFF_RULE',
        format('Нет правила тарифа на %s (%s)', to_char(v_local, 'YYYY-MM-DD HH24:MI'), v_dt));
    end if;

    v_amount := round(v_price * v_hall.slot_step_min / 60.0)::bigint;
    v_rent_total := v_rent_total + v_amount;

    if v_line_price is not null and v_line_dt = v_dt and v_line_price = v_price then
      v_line_min := v_line_min + v_hall.slot_step_min;
      v_line_amount := v_line_amount + v_amount;
      v_line_to := (v_ts + v_step) at time zone v_tenant.timezone;
    else
      if v_line_price is not null then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'from', to_char(v_line_from, 'YYYY-MM-DD"T"HH24:MI'),
          'to', to_char(v_line_to, 'YYYY-MM-DD"T"HH24:MI'),
          'day_type', v_line_dt,
          'price_per_hour', v_line_price,
          'minutes', v_line_min,
          'amount', v_line_amount));
      end if;
      v_line_from := v_local;
      v_line_to := (v_ts + v_step) at time zone v_tenant.timezone;
      v_line_dt := v_dt;
      v_line_price := v_price;
      v_line_min := v_hall.slot_step_min;
      v_line_amount := v_amount;
    end if;

    v_ts := v_ts + v_step;
  end loop;

  if v_line_price is not null then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'from', to_char(v_line_from, 'YYYY-MM-DD"T"HH24:MI'),
      'to', to_char(v_line_to, 'YYYY-MM-DD"T"HH24:MI'),
      'day_type', v_line_dt,
      'price_per_hour', v_line_price,
      'minutes', v_line_min,
      'amount', v_line_amount));
  end if;

  -- Доплата за гостей сверх включённых.
  v_extra_count := greatest(0, p_guests - v_hall.capacity_included);
  if v_extra_count > 0 and v_hall.extra_guest_price > 0 then
    v_extra_guests_amount := case v_hall.extra_guest_unit
      when 'per_hour' then round(v_hall.extra_guest_price * v_extra_count * p_duration_min / 60.0)::bigint
      else v_hall.extra_guest_price * v_extra_count
    end;
  end if;

  -- Допы.
  if p_extras is not null and jsonb_typeof(p_extras) <> 'array' then
    return private.fail('INVALID_EXTRAS', 'Допы — массив');
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) loop
    begin
      v_extra_id := (v_item ->> 'extra_id')::uuid;
      v_qty := (v_item ->> 'qty')::integer;
    exception when others then
      return private.fail('INVALID_EXTRAS', 'Некорректный доп');
    end;
    if v_extra_id = any (v_seen) then
      return private.fail('DUPLICATE_EXTRA', 'Доп указан дважды');
    end if;
    v_seen := v_seen || v_extra_id;

    select * into v_extra from public.extras e
    where e.id = v_extra_id and e.tenant_id = v_hall.tenant_id
      and (e.is_active or p_allow_inactive_extras);
    if not found then
      return private.fail('UNKNOWN_EXTRA', 'Доп не найден');
    end if;
    if v_qty is null or v_qty < 1 or v_qty > v_extra.max_qty then
      return private.fail('INVALID_EXTRA_QTY',
        format('«%s»: от 1 до %s', v_extra.name, v_extra.max_qty));
    end if;
    if v_extra.unit = 'per_guest' and v_qty > p_guests then
      return private.fail('INVALID_EXTRA_QTY',
        format('«%s»: не больше числа гостей', v_extra.name));
    end if;

    v_amount := case v_extra.unit
      when 'per_hour' then round(v_extra.price * v_qty * p_duration_min / 60.0)::bigint
      else v_extra.price * v_qty
    end;
    v_extras_total := v_extras_total + v_amount;
    v_extras_lines := v_extras_lines || jsonb_build_array(jsonb_build_object(
      'extra_id', v_extra.id,
      'key', v_extra.key,
      'name', v_extra.name,
      'unit', v_extra.unit,
      'unit_price', v_extra.price,
      'qty', v_qty,
      'amount', v_amount));
  end loop;

  v_total := v_rent_total + v_extra_guests_amount + v_extras_total;
  v_deposit := round(v_total * v_tenant.deposit_percent / 100.0)::bigint;

  return jsonb_build_object(
    'ok', true,
    'tariff_version_id', v_version,
    'total', v_total,
    'deposit_amount', v_deposit,
    'snapshot', jsonb_build_object(
      'version', 1,
      'tariff_version_id', v_version,
      'timezone', v_tenant.timezone,
      'slot_step_min', v_hall.slot_step_min,
      'duration_min', p_duration_min,
      'guests', p_guests,
      'rent', v_lines,
      'rent_total', v_rent_total,
      'extra_guests', jsonb_build_object(
        'count', v_extra_count,
        'unit', v_hall.extra_guest_unit,
        'unit_price', v_hall.extra_guest_price,
        'amount', v_extra_guests_amount),
      'extras', v_extras_lines,
      'extras_total', v_extras_total,
      'total', v_total,
      'deposit_percent', v_tenant.deposit_percent,
      'deposit_amount', v_deposit,
      'manual_price', false
    )
  );
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.member_role) to authenticated;
grant execute on function private.is_public_tenant(uuid) to anon, authenticated;
