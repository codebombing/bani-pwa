-- Этап 3. Управление бронью: просмотр/отмена/перенос по токену гостя и функции владельца.
-- Гостевые функции — для Edge Function public-api (service_role), токен приходит как sha256.
-- Owner-функции вызываются с JWT владельца (authenticated): членство проверяется внутри
-- через auth.uid(), tenant берётся из брони/аргумента и сверяется с tenant_members.

-- Бронь по хэшу токена в рамках заведения (чужой slug → NOT_FOUND).
create function private.booking_by_token(p_slug text, p_token_hash bytea)
returns uuid
language sql
stable
set search_path = ''
as $$
  select k.booking_id
  from public.booking_access_tokens k
  join public.tenants t on t.id = k.tenant_id
  where k.token_hash = p_token_hash and k.revoked_at is null and t.slug = p_slug;
$$;

-- Tenant брони, если текущий пользователь — член этого заведения; иначе null.
create function private.member_booking_tenant(p_booking_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select b.tenant_id
  from public.bookings b
  where b.id = p_booking_id
    and exists (
      select 1 from public.tenant_members m
      where m.tenant_id = b.tenant_id and m.user_id = (select auth.uid())
    );
$$;

-- Отмена: occupancy деактивируется, outbox гасится, ставится уведомление об отмене.
-- Повторная отмена идемпотентна.
create function private.cancel_booking(
  p_booking_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_b public.bookings%rowtype;
  v_free_hours integer;
  v_refundable boolean;
begin
  select * into v_b from public.bookings b where b.id = p_booking_id for update;
  if not found then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;

  if v_b.status = 'cancelled' then
    return private.booking_json(v_b.id) || jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;
  if v_b.status in ('completed', 'no_show') then
    return private.fail('NOT_CANCELLABLE', 'Визит уже состоялся — отменить нельзя');
  end if;
  if p_actor_type = 'guest' and v_b.start_at <= now() then
    return private.fail('TOO_LATE', 'Бронь уже началась — отменить онлайн нельзя');
  end if;

  select t.free_cancellation_hours into v_free_hours from public.tenants t where t.id = v_b.tenant_id;
  v_refundable := now() <= v_b.start_at - make_interval(hours => v_free_hours);

  update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_b.id;
  update public.resource_occupancies set active = false, deactivated_at = now()
  where booking_id = v_b.id and active;

  perform private.skip_pending_jobs(v_b.id);
  perform private.enqueue_notifications(v_b.id, 'booking_cancelled',
    v_b.source = 'online' and p_actor_type = 'guest', v_b.source = 'online');
  perform private.audit(v_b.tenant_id, v_b.id, p_actor_type, p_actor_user_id, 'booking_cancelled',
    jsonb_build_object('reason', p_reason, 'deposit_refundable', v_refundable));

  return private.booking_json(v_b.id)
    || jsonb_build_object('ok', true, 'already_cancelled', false, 'deposit_refundable', v_refundable);
end;
$$;

-- Перенос в одной транзакции: старая занятость деактивируется, вставляется новая,
-- цена пересчитывается (политика заведения: current — тариф на новую дату, original — исходная
-- версия), version += 1, outbox перепланируется. Конфликт → SLOT_TAKEN, вложенный блок
-- откатывается целиком — исходная бронь и её занятость остаются как были.
create function private.reschedule_booking(
  p_booking_id uuid,
  p_new_start_at timestamptz,
  p_new_duration_min integer,
  p_expected_version integer,
  p_actor_type text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_b public.bookings%rowtype;
  v_hall public.halls%rowtype;
  v_policy text;
  v_duration integer;
  v_slot jsonb;
  v_quote jsonb;
  v_extras jsonb;
  v_snapshot jsonb;
  v_total bigint;
  v_end_at timestamptz;
begin
  select * into v_b from public.bookings b where b.id = p_booking_id for update;
  if not found then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  if v_b.status not in ('pending', 'confirmed') then
    return private.fail('NOT_RESCHEDULABLE', 'Эту бронь нельзя перенести');
  end if;
  if p_expected_version is not null and p_expected_version <> v_b.version then
    return private.fail('VERSION_CONFLICT', 'Бронь уже изменилась — обновите страницу');
  end if;
  if p_actor_type = 'guest' and v_b.start_at <= now() then
    return private.fail('TOO_LATE', 'Бронь уже началась — перенести онлайн нельзя');
  end if;
  if p_actor_type = 'guest' and p_new_start_at <= now() then
    return private.fail('START_IN_PAST', 'Это время уже прошло');
  end if;

  select * into v_hall from public.halls h where h.id = v_b.hall_id;
  select t.reschedule_pricing into v_policy from public.tenants t where t.id = v_b.tenant_id;

  v_duration := coalesce(p_new_duration_min, (extract(epoch from (v_b.end_at - v_b.start_at)) / 60)::integer);
  v_slot := private.check_slot(v_b.hall_id, p_new_start_at, v_duration, v_b.guests);
  if not (v_slot ->> 'ok')::boolean then
    return v_slot;
  end if;
  v_end_at := (v_slot ->> 'end_at')::timestamptz;

  select coalesce(jsonb_agg(jsonb_build_object('extra_id', e.extra_id, 'qty', e.qty)), '[]'::jsonb)
  into v_extras from public.booking_extras e where e.booking_id = v_b.id;

  v_quote := private.compute_quote(
    v_b.hall_id, p_new_start_at, v_duration, v_b.guests, v_extras,
    case when v_policy = 'original' then v_b.tariff_version_id end,
    true);
  if not (v_quote ->> 'ok')::boolean then
    return v_quote;
  end if;
  v_snapshot := v_quote -> 'snapshot';
  v_total := (v_quote ->> 'total')::bigint;

  -- Цена, назначенная владельцем вручную, сохраняется.
  if coalesce((v_b.price_snapshot ->> 'manual_price')::boolean, false) then
    v_snapshot := v_snapshot || jsonb_build_object(
      'manual_price', true,
      'calculated_total', v_total,
      'total', v_b.total_amount,
      'deposit_amount', v_b.price_snapshot -> 'deposit_amount');
    v_total := v_b.total_amount;
  end if;

  begin
    update public.resource_occupancies set active = false, deactivated_at = now()
    where booking_id = v_b.id and active;

    insert into public.resource_occupancies (tenant_id, hall_id, kind, booking_id, occupied)
    values (v_b.tenant_id, v_b.hall_id, 'booking', v_b.id,
            tstzrange(p_new_start_at, v_end_at + make_interval(mins => v_hall.buffer_min), '[)'));

    update public.bookings
    set start_at = p_new_start_at,
        end_at = v_end_at,
        price_snapshot = v_snapshot || jsonb_build_object(
          'rescheduled_from', jsonb_build_object('start_at', v_b.start_at, 'end_at', v_b.end_at,
            'total', v_b.total_amount, 'version', v_b.version)),
        total_amount = v_total,
        tariff_version_id = (v_quote ->> 'tariff_version_id')::uuid,
        version = version + 1
    where id = v_b.id;

    delete from public.booking_extras where booking_id = v_b.id;
    insert into public.booking_extras (tenant_id, booking_id, extra_id, name, unit, unit_price, qty, amount)
    select v_b.tenant_id, v_b.id, (e ->> 'extra_id')::uuid, e ->> 'name', (e ->> 'unit')::public.extra_unit,
           (e ->> 'unit_price')::bigint, (e ->> 'qty')::integer, (e ->> 'amount')::bigint
    from jsonb_array_elements(v_snapshot -> 'extras') e;

    perform private.skip_pending_jobs(v_b.id);
    perform private.enqueue_notifications(v_b.id, 'booking_rescheduled',
      v_b.source = 'online' and p_actor_type = 'guest', v_b.source = 'online');
    perform private.audit(v_b.tenant_id, v_b.id, p_actor_type, p_actor_user_id, 'booking_rescheduled',
      jsonb_build_object('from', v_b.start_at, 'to', p_new_start_at,
        'old_total', v_b.total_amount, 'new_total', v_total));
  exception
    when exclusion_violation then
      return private.fail('SLOT_TAKEN', 'Это время уже занято — бронь осталась прежней');
  end;

  return private.booking_json(v_b.id) || jsonb_build_object('ok', true);
end;
$$;

-- ---------------- Гость (по токену, через Edge Function) ----------------

create function public.get_booking_by_token_hash(p_slug text, p_token_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.booking_by_token(p_slug, p_token_hash);
begin
  if v_id is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  return private.booking_json(v_id) || jsonb_build_object('ok', true);
end;
$$;

create function public.cancel_booking_by_token(p_slug text, p_token_hash bytea)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.booking_by_token(p_slug, p_token_hash);
begin
  if v_id is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  return private.cancel_booking(v_id, 'guest', null, null);
end;
$$;

create function public.reschedule_booking_by_token(
  p_slug text,
  p_token_hash bytea,
  p_new_start_at timestamptz,
  p_new_duration_min integer default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.booking_by_token(p_slug, p_token_hash);
begin
  if v_id is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  return private.reschedule_booking(v_id, p_new_start_at, p_new_duration_min, p_expected_version, 'guest', null);
end;
$$;

-- ---------------- Владелец (JWT, членство проверяется внутри) ----------------

-- Быстрая бронь, принятая по телефону/в мессенджере: те же правила, телефон необязателен,
-- цену можно задать вручную (пометка manual_price в снимке). Прошлое время допускается
-- (запись пришедших гостей задним числом).
create function public.owner_quick_booking(
  p_tenant_id uuid,
  p_hall_id uuid,
  p_start_at timestamptz,
  p_duration_min integer,
  p_guests integer,
  p_customer_name text,
  p_customer_phone text default null,
  p_source public.booking_source default 'phone',
  p_comment text default null,
  p_extras jsonb default '[]'::jsonb,
  p_manual_total bigint default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := coalesce(nullif(btrim(coalesce(p_customer_name, '')), ''), 'Гость');
  v_hash text;
  v_status public.tenant_status;
begin
  if v_uid is null or not private.is_member(p_tenant_id) then
    return private.fail('FORBIDDEN', 'Нет доступа к заведению');
  end if;
  if p_source = 'online' then
    return private.fail('INVALID_SOURCE', 'Источник брони владельца: телефон, мессенджер, на месте');
  end if;
  if p_customer_phone is not null and p_customer_phone !~ '^\+[0-9]{10,15}$' then
    return private.fail('INVALID_PHONE', 'Телефон в формате +7XXXXXXXXXX');
  end if;
  if char_length(v_name) > 120 or char_length(coalesce(p_comment, '')) > 1000 then
    return private.fail('INVALID_ARGUMENT', 'Слишком длинное имя или комментарий');
  end if;
  if p_idempotency_key is not null and char_length(p_idempotency_key) not between 8 and 128 then
    return private.fail('INVALID_ARGUMENT', 'Некорректный ключ повтора');
  end if;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'hall', p_hall_id, 'start', p_start_at, 'duration', p_duration_min, 'guests', p_guests,
    'name', v_name, 'phone', p_customer_phone, 'source', p_source, 'comment', p_comment,
    'extras', coalesce(p_extras, '[]'::jsonb), 'manual_total', p_manual_total)::text, 'sha256'), 'hex');

  select t.status into v_status from public.tenants t where t.id = p_tenant_id;

  return private.create_booking(
    p_tenant_id, null, p_hall_id, p_start_at, p_duration_min, p_guests, p_extras,
    v_name, p_customer_phone, p_comment, p_source, null, v_uid,
    p_idempotency_key, case when p_idempotency_key is not null then v_hash end, null,
    p_manual_total, true, v_status = 'preview', 'owner');
end;
$$;

create function public.owner_cancel_booking(p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.member_booking_tenant(p_booking_id) is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  return private.cancel_booking(p_booking_id, 'owner', (select auth.uid()), p_reason);
end;
$$;

create function public.owner_reschedule_booking(
  p_booking_id uuid,
  p_new_start_at timestamptz,
  p_new_duration_min integer default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.member_booking_tenant(p_booking_id) is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  return private.reschedule_booking(p_booking_id, p_new_start_at, p_new_duration_min,
    p_expected_version, 'owner', (select auth.uid()));
end;
$$;

-- «Гости пришли» (completed), неявка (no_show) или возврат в confirmed.
create function public.owner_set_booking_status(p_booking_id uuid, p_status public.booking_status)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.member_booking_tenant(p_booking_id);
  v_old public.booking_status;
begin
  if v_tenant is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  if p_status not in ('confirmed', 'completed', 'no_show') then
    return private.fail('INVALID_STATUS', 'Для отмены используйте отмену брони');
  end if;
  select b.status into v_old from public.bookings b where b.id = p_booking_id for update;
  if v_old = 'cancelled' then
    return private.fail('NOT_ALLOWED', 'Бронь отменена');
  end if;
  if v_old <> p_status then
    update public.bookings set status = p_status where id = p_booking_id;
    if p_status in ('completed', 'no_show') then
      perform private.skip_pending_jobs(p_booking_id);
    end if;
    perform private.audit(v_tenant, p_booking_id, 'owner', (select auth.uid()), 'status_changed',
      jsonb_build_object('from', v_old, 'to', p_status));
  end if;
  return private.booking_json(p_booking_id) || jsonb_build_object('ok', true);
end;
$$;

-- Блокировка зала (уборка, ремонт, своё мероприятие): occupancy kind=block — та же
-- таблица и тот же EXCLUDE, что у броней.
create function public.owner_block_hall(
  p_tenant_id uuid,
  p_hall_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_occ uuid;
  v_block uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null or not private.is_member(p_tenant_id) then
    return private.fail('FORBIDDEN', 'Нет доступа к заведению');
  end if;
  if not exists (select 1 from public.halls h where h.id = p_hall_id and h.tenant_id = p_tenant_id) then
    return private.fail('HALL_NOT_FOUND', 'Зал не найден');
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    return private.fail('INVALID_RANGE', 'Конец блокировки должен быть позже начала');
  end if;
  if p_to - p_from > interval '31 days' then
    return private.fail('INVALID_RANGE', 'Блокировка не длиннее 31 дня');
  end if;
  if char_length(v_reason) not between 1 and 200 then
    return private.fail('INVALID_REASON', 'Укажите причину');
  end if;

  begin
    insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied)
    values (p_tenant_id, p_hall_id, 'block', tstzrange(p_from, p_to, '[)'))
    returning id into v_occ;
    insert into public.hall_blocks (tenant_id, hall_id, occupancy_id, reason, created_by)
    values (p_tenant_id, p_hall_id, v_occ, v_reason, v_uid)
    returning id into v_block;
    perform private.audit(p_tenant_id, null, 'owner', v_uid, 'hall_blocked',
      jsonb_build_object('hall_id', p_hall_id, 'from', p_from, 'to', p_to, 'reason', v_reason));
  exception
    when exclusion_violation then
      return private.fail('SLOT_TAKEN', 'На это время в зале есть бронь или блокировка');
  end;

  return jsonb_build_object('ok', true, 'block_id', v_block, 'occupancy_id', v_occ,
    'hall_id', p_hall_id, 'from', p_from, 'to', p_to, 'reason', v_reason);
end;
$$;

create function public.owner_unblock_hall(p_block_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_block public.hall_blocks%rowtype;
begin
  select * into v_block from public.hall_blocks b where b.id = p_block_id;
  if not found or not private.is_member(v_block.tenant_id) then
    return private.fail('NOT_FOUND', 'Блокировка не найдена');
  end if;
  update public.resource_occupancies set active = false, deactivated_at = now()
  where id = v_block.occupancy_id and active;
  perform private.audit(v_block.tenant_id, null, 'owner', (select auth.uid()), 'hall_unblocked',
    jsonb_build_object('block_id', p_block_id));
  return jsonb_build_object('ok', true, 'block_id', p_block_id);
end;
$$;

-- Платёж вручную: задаток / оплата / возврат (не больше полученного).
create function public.owner_add_payment(
  p_booking_id uuid,
  p_kind public.payment_kind,
  p_amount bigint,
  p_method public.payment_method,
  p_note text default null,
  p_received_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.member_booking_tenant(p_booking_id);
  v_uid uuid := (select auth.uid());
  v_net bigint;
  v_id uuid;
  v_is_demo boolean;
begin
  if v_tenant is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  if p_amount is null or p_amount <= 0 then
    return private.fail('INVALID_AMOUNT', 'Сумма должна быть больше нуля');
  end if;
  if p_method = 'online' then
    return private.fail('INVALID_METHOD', 'Онлайн-оплата подключается отдельно');
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    return private.fail('INVALID_ARGUMENT', 'Слишком длинная заметка');
  end if;

  -- Сериализуем платежи по брони.
  select b.is_demo into v_is_demo from public.bookings b where b.id = p_booking_id for update;
  select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0)
  into v_net from public.payments p where p.booking_id = p_booking_id;
  if p_kind = 'refund' and p_amount > v_net then
    return private.fail('REFUND_EXCEEDS_PAID', 'Возврат больше полученной суммы',
      jsonb_build_object('paid', v_net));
  end if;

  insert into public.payments (tenant_id, booking_id, kind, amount, method, received_at, note, created_by, is_demo)
  values (v_tenant, p_booking_id, p_kind, p_amount, p_method, coalesce(p_received_at, now()),
          nullif(btrim(coalesce(p_note, '')), ''), v_uid, v_is_demo)
  returning id into v_id;

  perform private.audit(v_tenant, p_booking_id, 'owner', v_uid, 'payment_added',
    jsonb_build_object('payment_id', v_id, 'kind', p_kind, 'amount', p_amount, 'method', p_method));

  return private.booking_json(p_booking_id) || jsonb_build_object('ok', true, 'payment_id', v_id);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.member_role) to authenticated;
grant execute on function private.is_public_tenant(uuid) to anon, authenticated;

revoke execute on function public.get_booking_by_token_hash(text, bytea) from public, anon, authenticated;
revoke execute on function public.cancel_booking_by_token(text, bytea) from public, anon, authenticated;
revoke execute on function public.reschedule_booking_by_token(text, bytea, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_booking_by_token_hash(text, bytea) to service_role;
grant execute on function public.cancel_booking_by_token(text, bytea) to service_role;
grant execute on function public.reschedule_booking_by_token(text, bytea, timestamptz, integer, integer)
  to service_role;

revoke execute on function public.owner_quick_booking(uuid, uuid, timestamptz, integer, integer, text, text,
  public.booking_source, text, jsonb, bigint, text) from public, anon;
revoke execute on function public.owner_cancel_booking(uuid, text) from public, anon;
revoke execute on function public.owner_reschedule_booking(uuid, timestamptz, integer, integer) from public, anon;
revoke execute on function public.owner_set_booking_status(uuid, public.booking_status) from public, anon;
revoke execute on function public.owner_block_hall(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.owner_unblock_hall(uuid) from public, anon;
revoke execute on function public.owner_add_payment(uuid, public.payment_kind, bigint, public.payment_method,
  text, timestamptz) from public, anon;

grant execute on function public.owner_quick_booking(uuid, uuid, timestamptz, integer, integer, text, text,
  public.booking_source, text, jsonb, bigint, text) to authenticated;
grant execute on function public.owner_cancel_booking(uuid, text) to authenticated;
grant execute on function public.owner_reschedule_booking(uuid, timestamptz, integer, integer) to authenticated;
grant execute on function public.owner_set_booking_status(uuid, public.booking_status) to authenticated;
grant execute on function public.owner_block_hall(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.owner_unblock_hall(uuid) to authenticated;
grant execute on function public.owner_add_payment(uuid, public.payment_kind, bigint, public.payment_method,
  text, timestamptz) to authenticated;
