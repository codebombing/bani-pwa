-- Этап 3. Создание брони (одна транзакция), доступность, предварительный расчёт.
-- Клиент не передаёт цену, tenant_id и время окончания: только slug, зал, начало, длительность.

-- Сводка брони для ответа гостю/владельцу.
create function private.booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'booking_id', b.id,
    'tenant_id', b.tenant_id,
    'tenant_slug', t.slug,
    'timezone', t.timezone,
    'hall_id', b.hall_id,
    'hall_name', h.name,
    'start_at', b.start_at,
    'end_at', b.end_at,
    'duration_min', (extract(epoch from (b.end_at - b.start_at)) / 60)::integer,
    'guests', b.guests,
    'status', b.status,
    'source', b.source,
    'customer_name', b.customer_name,
    'customer_phone', b.customer_phone,
    'comment', b.comment,
    'total_amount', b.total_amount,
    'deposit_amount', coalesce((b.price_snapshot ->> 'deposit_amount')::bigint, 0),
    'paid_amount', coalesce(p.net, 0),
    'deposit_paid', coalesce(p.deposits, 0),
    'version', b.version,
    'is_demo', b.is_demo,
    'price_snapshot', b.price_snapshot,
    'extras', coalesce(x.items, '[]'::jsonb),
    'free_cancellation_until', b.start_at - make_interval(hours => t.free_cancellation_hours),
    'created_at', b.created_at
  )
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.halls h on h.id = b.hall_id
  left join lateral (
    select
      sum(case when pm.kind = 'refund' then -pm.amount else pm.amount end) as net,
      sum(pm.amount) filter (where pm.kind = 'deposit') as deposits
    from public.payments pm
    where pm.booking_id = b.id
  ) p on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'extra_id', e.extra_id, 'name', e.name, 'unit', e.unit,
      'unit_price', e.unit_price, 'qty', e.qty, 'amount', e.amount) order by e.name) as items
    from public.booking_extras e
    where e.booking_id = b.id
  ) x on true
  where b.id = p_booking_id;
$$;

-- Повтор по ключу идемпотентности: тот же request_hash → та же бронь; другой → конфликт.
-- null — ключ не встречался (или истёк TTL 24 ч).
create function private.idempotency_lookup(p_tenant_id uuid, p_key text, p_request_hash text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hash text;
  v_booking_id uuid;
begin
  select k.request_hash, k.booking_id into v_hash, v_booking_id
  from public.idempotency_keys k
  where k.tenant_id = p_tenant_id and k.key = p_key
    and k.created_at > now() - interval '24 hours';
  if not found then
    return null;
  end if;
  if v_hash is distinct from p_request_hash then
    return private.fail('IDEMPOTENCY_CONFLICT', 'Ключ повтора уже использован с другими данными');
  end if;
  if v_booking_id is null then
    return private.fail('IDEMPOTENCY_IN_PROGRESS', 'Запрос ещё обрабатывается');
  end if;
  return private.booking_json(v_booking_id) || jsonb_build_object('ok', true, 'replay', true);
end;
$$;

-- Outbox: событие брони (владельцу/гостю сразу) + напоминания гостю за 24 ч и 2 ч.
-- dedupe_key = <booking_id>:<version>:<kind>:<recipient> — повторная постановка не дублирует.
create function private.enqueue_notifications(
  p_booking_id uuid,
  p_event public.notification_kind,
  p_notify_owner boolean,
  p_notify_guest boolean
)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.notification_jobs
    (tenant_id, booking_id, booking_version, kind, recipient, run_at, dedupe_key)
  select b.tenant_id, b.id, b.version, j.kind, j.recipient, j.run_at,
         concat_ws(':', b.id, b.version, j.kind, j.recipient)
  from public.bookings b
  cross join lateral (
    values
      (p_event, 'owner'::public.notification_recipient, now(), p_notify_owner),
      (p_event, 'guest'::public.notification_recipient, now(), p_notify_guest),
      ('reminder_24h'::public.notification_kind, 'guest'::public.notification_recipient,
        b.start_at - interval '24 hours', p_notify_guest and p_event <> 'booking_cancelled'),
      ('reminder_2h'::public.notification_kind, 'guest'::public.notification_recipient,
        b.start_at - interval '2 hours', p_notify_guest and p_event <> 'booking_cancelled')
  ) as j(kind, recipient, run_at, enabled)
  where b.id = p_booking_id
    and j.enabled
    and (j.kind not in ('reminder_24h', 'reminder_2h') or j.run_at > now())
  on conflict (dedupe_key) do nothing;
$$;

-- Задачи outbox по брони, ещё не отправленные, гасятся (перенос/отмена).
create function private.skip_pending_jobs(p_booking_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.notification_jobs
  set status = 'skipped', lease_until = null
  where booking_id = p_booking_id and status in ('pending', 'leased');
$$;

create function private.audit(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.audit_log (tenant_id, booking_id, actor_type, actor_user_id, action, details)
  values (p_tenant_id, p_booking_id, p_actor_type, p_actor_user_id, p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- Ядро создания брони: проверка правил, расчёт цены, вставка брони + занятости + токена
-- + outbox. Гонку за слот отбивает EXCLUDE (→ SLOT_TAKEN). Вставки идут во вложенном блоке:
-- при ошибке откатываются целиком, а внешние эффекты (счётчики rate limit) сохраняются.
create function private.create_booking(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_hall_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_guests integer,
  p_extras jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_comment text,
  p_source public.booking_source,
  p_consent_at timestamptz,
  p_created_by uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_token_hash bytea,
  p_manual_total bigint,
  p_allow_past boolean,
  p_is_demo boolean,
  p_actor_type text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid := coalesce(p_booking_id, gen_random_uuid());
  v_hall public.halls%rowtype;
  v_tenant public.tenants%rowtype;
  v_replay jsonb;
  v_slot jsonb;
  v_quote jsonb;
  v_snapshot jsonb;
  v_total bigint;
  v_end_at timestamptz;
  v_notify_guest boolean := p_source = 'online';
begin
  if p_idempotency_key is not null then
    v_replay := private.idempotency_lookup(p_tenant_id, p_idempotency_key, p_request_hash);
    if v_replay is not null then
      return v_replay;
    end if;
  end if;

  select * into v_tenant from public.tenants t where t.id = p_tenant_id;
  select * into v_hall from public.halls h
  where h.id = p_hall_id and h.tenant_id = p_tenant_id and h.is_active;
  if not found then
    return private.fail('HALL_NOT_FOUND', 'Зал не найден');
  end if;

  if not p_allow_past and p_start_at <= now() then
    return private.fail('START_IN_PAST', 'Это время уже прошло');
  end if;

  v_slot := private.check_slot(p_hall_id, p_start_at, p_duration_min, p_guests);
  if not (v_slot ->> 'ok')::boolean then
    return v_slot;
  end if;
  v_end_at := (v_slot ->> 'end_at')::timestamptz;

  v_quote := private.compute_quote(p_hall_id, p_start_at, p_duration_min, p_guests, coalesce(p_extras, '[]'::jsonb));
  if not (v_quote ->> 'ok')::boolean then
    return v_quote;
  end if;
  v_snapshot := v_quote -> 'snapshot';
  v_total := (v_quote ->> 'total')::bigint;

  if p_manual_total is not null then
    if p_manual_total < 0 then
      return private.fail('INVALID_PRICE', 'Цена не может быть отрицательной');
    end if;
    v_snapshot := v_snapshot || jsonb_build_object(
      'manual_price', true,
      'calculated_total', v_total,
      'total', p_manual_total,
      'deposit_amount', round(p_manual_total * v_tenant.deposit_percent / 100.0)::bigint);
    v_total := p_manual_total;
  end if;

  begin
    if p_idempotency_key is not null then
      delete from public.idempotency_keys k
      where k.tenant_id = p_tenant_id and k.key = p_idempotency_key
        and k.created_at <= now() - interval '24 hours';
      insert into public.idempotency_keys (tenant_id, key, request_hash)
      values (p_tenant_id, p_idempotency_key, p_request_hash);
    end if;

    insert into public.bookings (
      id, tenant_id, hall_id, start_at, end_at, guests, status, source,
      customer_name, customer_phone, comment, price_snapshot, total_amount,
      tariff_version_id, is_demo, consent_at, created_by)
    values (
      v_id, p_tenant_id, p_hall_id, p_start_at, v_end_at, p_guests, 'confirmed', p_source,
      p_customer_name, p_customer_phone, nullif(btrim(coalesce(p_comment, '')), ''), v_snapshot, v_total,
      (v_quote ->> 'tariff_version_id')::uuid, p_is_demo, p_consent_at, p_created_by);

    insert into public.booking_extras (tenant_id, booking_id, extra_id, name, unit, unit_price, qty, amount)
    select p_tenant_id, v_id, (e ->> 'extra_id')::uuid, e ->> 'name', (e ->> 'unit')::public.extra_unit,
           (e ->> 'unit_price')::bigint, (e ->> 'qty')::integer, (e ->> 'amount')::bigint
    from jsonb_array_elements(v_snapshot -> 'extras') e;

    insert into public.resource_occupancies (tenant_id, hall_id, kind, booking_id, occupied)
    values (p_tenant_id, p_hall_id, 'booking', v_id,
            tstzrange(p_start_at, v_end_at + make_interval(mins => v_hall.buffer_min), '[)'));

    if p_token_hash is not null then
      insert into public.booking_access_tokens (tenant_id, booking_id, token_hash)
      values (p_tenant_id, v_id, p_token_hash);
    end if;

    if p_idempotency_key is not null then
      update public.idempotency_keys set booking_id = v_id
      where tenant_id = p_tenant_id and key = p_idempotency_key;
    end if;

    perform private.enqueue_notifications(v_id, 'booking_created', v_notify_guest, v_notify_guest);
    perform private.audit(p_tenant_id, v_id, p_actor_type, p_created_by, 'booking_created',
      jsonb_build_object('source', p_source, 'total', v_total, 'manual_price', p_manual_total is not null));
  exception
    when exclusion_violation then
      return private.fail('SLOT_TAKEN', 'Это время уже занято');
    when unique_violation then
      -- Параллельный запрос с тем же ключом успел первым: отдаём его результат.
      if p_idempotency_key is not null then
        v_replay := private.idempotency_lookup(p_tenant_id, p_idempotency_key, p_request_hash);
        if v_replay is not null then
          return v_replay;
        end if;
      end if;
      raise;
  end;

  return private.booking_json(v_id) || jsonb_build_object('ok', true, 'replay', false);
end;
$$;

-- Публичное создание брони гостем. Вызывает Edge Function public-api (service_role):
-- она генерирует p_booking_id, считает token = HMAC(secret, booking_id:idempotency_key)
-- и передаёт сюда только sha256(token). При повторе возвращается исходный booking_id,
-- и Edge Function заново вычисляет тот же токен.
create function public.public_create_booking(
  p_slug text,
  p_booking_id uuid,
  p_hall_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_guests integer,
  p_extras jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_comment text,
  p_consent boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_token_hash bytea,
  p_client_ip text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_replay jsonb;
  v_name text := btrim(coalesce(p_customer_name, ''));
begin
  select * into v_tenant from public.tenants t
  where t.slug = p_slug and t.status in ('preview', 'live');
  if not found then
    return private.fail('TENANT_NOT_FOUND', 'Заведение не найдено');
  end if;

  if p_booking_id is null or p_hall_id is null
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128
     or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash is null or octet_length(p_token_hash) <> 32 then
    return private.fail('INVALID_ARGUMENT', 'Некорректный запрос');
  end if;

  -- Повтор того же запроса не тратит лимиты.
  v_replay := private.idempotency_lookup(v_tenant.id, p_idempotency_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  -- Лимиты считаются и для неудачных попыток (функция не бросает исключений).
  if p_client_ip is not null
     and not public.consume_rate_limit('create:ip:' || p_client_ip, 10, interval '10 minutes') then
    return private.fail('RATE_LIMITED', 'Слишком много попыток, попробуйте позже');
  end if;
  if p_customer_phone is not null
     and not public.consume_rate_limit('create:phone:' || p_customer_phone, 5, interval '1 hour') then
    return private.fail('RATE_LIMITED', 'Слишком много попыток, попробуйте позже');
  end if;

  if p_consent is distinct from true then
    return private.fail('CONSENT_REQUIRED', 'Нужно согласие на обработку персональных данных');
  end if;
  if char_length(v_name) not between 1 and 120 then
    return private.fail('INVALID_NAME', 'Укажите имя');
  end if;
  if p_customer_phone is null or p_customer_phone !~ '^\+[0-9]{10,15}$' then
    return private.fail('INVALID_PHONE', 'Укажите телефон в формате +7XXXXXXXXXX');
  end if;
  if char_length(coalesce(p_comment, '')) > 1000 then
    return private.fail('INVALID_COMMENT', 'Комментарий слишком длинный');
  end if;

  return private.create_booking(
    v_tenant.id, p_booking_id, p_hall_id, p_start_at, p_duration_min, p_guests, p_extras,
    v_name, p_customer_phone, p_comment, 'online', now(), null,
    p_idempotency_key, p_request_hash, p_token_hash,
    null, false, v_tenant.status = 'preview', 'guest');
end;
$$;

-- Свободные моменты начала на локальную дату p_date для заданной длительности
-- (по умолчанию — минимальной), с ценой для включённого числа гостей без допов.
create function public.get_availability(
  p_slug text,
  p_hall_id uuid,
  p_date date,
  p_duration_min integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_hall public.halls%rowtype;
  v_duration integer;
  v_step interval;
  v_w record;
  v_last_start timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_quote jsonb;
  v_slots jsonb := '[]'::jsonb;
begin
  select * into v_tenant from public.tenants t
  where t.slug = p_slug and t.status in ('preview', 'live');
  if not found then
    return private.fail('TENANT_NOT_FOUND', 'Заведение не найдено');
  end if;
  select * into v_hall from public.halls h
  where h.id = p_hall_id and h.tenant_id = v_tenant.id and h.is_active;
  if not found then
    return private.fail('HALL_NOT_FOUND', 'Зал не найден');
  end if;
  if p_date is null then
    return private.fail('INVALID_ARGUMENT', 'Нужна дата');
  end if;

  v_duration := coalesce(p_duration_min, v_hall.min_duration_min);
  if v_duration < v_hall.min_duration_min or v_duration % v_hall.slot_step_min <> 0
     or v_duration > 1440 then
    return private.fail('INVALID_DURATION',
      format('Длительность от %s мин, шаг %s мин', v_hall.min_duration_min, v_hall.slot_step_min));
  end if;

  select * into v_w from private.start_window(v_tenant.id, p_date);
  if v_w.window_start is null then
    return jsonb_build_object('ok', true, 'closed', true, 'date', p_date, 'timezone', v_tenant.timezone,
      'hall_id', v_hall.id, 'duration_min', v_duration, 'slots', '[]'::jsonb);
  end if;

  v_step := make_interval(mins => v_hall.slot_step_min);
  -- Круглосуточно: момент 24:00 принадлежит следующему дню.
  v_last_start := case when v_w.round_clock then v_w.window_end - v_step else v_w.window_end end;

  for v_start in select generate_series(v_w.window_start, v_last_start, v_step) loop
    v_end := v_start + make_interval(mins => v_duration);
    continue when v_start <= now();
    continue when not v_w.round_clock and v_end > v_w.last_end;
    continue when exists (
      select 1 from public.resource_occupancies o
      where o.tenant_id = v_tenant.id and o.hall_id = v_hall.id and o.active
        and o.occupied && tstzrange(v_start, v_end + make_interval(mins => v_hall.buffer_min), '[)')
    );
    v_quote := private.compute_quote(v_hall.id, v_start, v_duration, v_hall.capacity_included, '[]'::jsonb);
    continue when not (v_quote ->> 'ok')::boolean;
    v_slots := v_slots || jsonb_build_array(jsonb_build_object(
      'start_at', v_start,
      'end_at', v_end,
      'local_start', to_char(v_start at time zone v_tenant.timezone, 'HH24:MI'),
      'local_end', to_char(v_end at time zone v_tenant.timezone, 'HH24:MI'),
      'total', (v_quote ->> 'total')::bigint));
  end loop;

  return jsonb_build_object('ok', true, 'closed', false, 'date', p_date, 'timezone', v_tenant.timezone,
    'hall_id', v_hall.id, 'duration_min', v_duration, 'slots', v_slots);
end;
$$;

-- Предварительный расчёт без создания брони: те же правила и та же цена, что при создании.
create function public.quote_booking(
  p_slug text,
  p_hall_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_guests integer,
  p_extras jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_hall public.halls%rowtype;
  v_slot jsonb;
  v_quote jsonb;
  v_end_at timestamptz;
  v_available boolean;
begin
  select * into v_tenant from public.tenants t
  where t.slug = p_slug and t.status in ('preview', 'live');
  if not found then
    return private.fail('TENANT_NOT_FOUND', 'Заведение не найдено');
  end if;
  select * into v_hall from public.halls h
  where h.id = p_hall_id and h.tenant_id = v_tenant.id and h.is_active;
  if not found then
    return private.fail('HALL_NOT_FOUND', 'Зал не найден');
  end if;

  v_slot := private.check_slot(p_hall_id, p_start_at, p_duration_min, p_guests);
  if not (v_slot ->> 'ok')::boolean then
    return v_slot;
  end if;
  v_end_at := (v_slot ->> 'end_at')::timestamptz;

  v_quote := private.compute_quote(p_hall_id, p_start_at, p_duration_min, p_guests, coalesce(p_extras, '[]'::jsonb));
  if not (v_quote ->> 'ok')::boolean then
    return v_quote;
  end if;

  v_available := p_start_at > now() and not exists (
    select 1 from public.resource_occupancies o
    where o.tenant_id = v_tenant.id and o.hall_id = v_hall.id and o.active
      and o.occupied && tstzrange(p_start_at, v_end_at + make_interval(mins => v_hall.buffer_min), '[)')
  );

  return v_quote || jsonb_build_object('start_at', p_start_at, 'end_at', v_end_at, 'available', v_available);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.member_role) to authenticated;
grant execute on function private.is_public_tenant(uuid) to anon, authenticated;

revoke execute on function public.public_create_booking(text, uuid, uuid, timestamptz, integer, integer,
  jsonb, text, text, text, boolean, text, text, bytea, text) from public, anon, authenticated;
grant execute on function public.public_create_booking(text, uuid, uuid, timestamptz, integer, integer,
  jsonb, text, text, text, boolean, text, text, bytea, text) to service_role;

revoke execute on function public.get_availability(text, uuid, date, integer) from public, anon;
grant execute on function public.get_availability(text, uuid, date, integer) to authenticated, service_role;

revoke execute on function public.quote_booking(text, uuid, timestamptz, integer, integer, jsonb) from public, anon;
grant execute on function public.quote_booking(text, uuid, timestamptz, integer, integer, jsonb)
  to authenticated, service_role;
