-- Кабинет: выключатель задатка, «новые» брони, удаление брони, один задаток на бронь,
-- автоматическое «Пришли» после окончания визита.

-- 1. Задаток можно выключить в настройках. deposit_percent остаётся действующим процентом
--    (его читают расчёт цены, витрина и бот), исходный процент из business.json хранится
--    в deposit_percent_setting.
alter table public.tenants
  add column deposit_enabled boolean not null default true,
  add column deposit_percent_setting integer not null default 0
    check (deposit_percent_setting between 0 and 100);
update public.tenants set deposit_percent_setting = deposit_percent;

create function private.tenants_effective_deposit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- tenant:publish пишет deposit_percent из business.json — запоминаем как настройку.
  -- shortcut: при выключенном задатке publish с процентом 0 не обновит настройку;
  -- станет важно, если процент начнут менять при выключенном задатке.
  if tg_op = 'INSERT' or new.deposit_percent is distinct from old.deposit_percent then
    new.deposit_percent_setting := new.deposit_percent;
  end if;
  new.deposit_percent := case when new.deposit_enabled then new.deposit_percent_setting else 0 end;
  return new;
end;
$$;

create trigger tenants_effective_deposit
  before insert or update of deposit_percent, deposit_enabled on public.tenants
  for each row execute function private.tenants_effective_deposit();

create or replace view public.public_tenants
with (security_invoker = true) as
select
  t.id,
  t.slug,
  t.name,
  t.timezone,
  t.status,
  t.config_version,
  t.theme,
  t.texts,
  t.contacts,
  t.legal,
  t.pwa,
  t.deposit_percent,
  t.free_cancellation_hours,
  t.deposit_enabled
from public.tenants t
where t.status in ('preview', 'live');

create function public.owner_set_deposit_enabled(p_tenant_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_role(p_tenant_id, 'owner') then
    return private.fail('FORBIDDEN', 'Настройки меняет только владелец');
  end if;
  update public.tenants set deposit_enabled = coalesce(p_enabled, true) where id = p_tenant_id;
  perform private.audit(p_tenant_id, null, 'owner', (select auth.uid()), 'deposit_toggled',
    jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('ok', true, 'deposit_enabled', coalesce(p_enabled, true));
end;
$$;

-- 2. «Новая» бронь — онлайн-бронь, которую ещё не открыли в кабинете.
alter table public.bookings add column seen_at timestamptz;
update public.bookings set seen_at = now();

create function private.bookings_seen_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source <> 'online' then
    new.seen_at := coalesce(new.seen_at, now());
  end if;
  return new;
end;
$$;

create trigger bookings_seen_on_insert
  before insert on public.bookings
  for each row execute function private.bookings_seen_on_insert();

create index bookings_unseen_idx on public.bookings (tenant_id) where seen_at is null;

create function public.owner_mark_seen(p_booking_id uuid)
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
  update public.bookings set seen_at = now() where id = p_booking_id and seen_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- 3. Удаление брони навсегда: вместе с платежами, занятостью и уведомлениями (cascade),
--    поэтому отчёт и статистика пересчитываются сами.
create function public.owner_delete_booking(p_booking_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.member_booking_tenant(p_booking_id);
  v_b public.bookings%rowtype;
begin
  if v_tenant is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  select * into v_b from public.bookings b where b.id = p_booking_id for update;
  delete from public.bookings where id = p_booking_id;
  -- Журнал брони удаляется каскадом — след об удалении пишем без ссылки на бронь.
  perform private.audit(v_tenant, null, 'owner', (select auth.uid()), 'booking_deleted',
    jsonb_build_object('booking_id', p_booking_id, 'customer_name', v_b.customer_name,
      'start_at', v_b.start_at, 'total', v_b.total_amount));
  return jsonb_build_object('ok', true);
end;
$$;

-- 4. Задаток — одна отметка на бронь: сумма > 0 ставит/меняет её, null или 0 снимает.
create function public.owner_set_deposit(
  p_booking_id uuid,
  p_amount bigint,
  p_method public.payment_method default 'transfer'
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
  v_b public.bookings%rowtype;
begin
  if v_tenant is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  if p_amount is not null and p_amount < 0 then
    return private.fail('INVALID_AMOUNT', 'Сумма не может быть отрицательной');
  end if;
  if p_method = 'online' then
    return private.fail('INVALID_METHOD', 'Онлайн-оплата подключается отдельно');
  end if;
  select * into v_b from public.bookings b where b.id = p_booking_id for update;
  if coalesce(p_amount, 0) > v_b.total_amount then
    return private.fail('INVALID_AMOUNT', 'Задаток больше стоимости брони');
  end if;

  delete from public.payments where booking_id = p_booking_id and kind = 'deposit';
  if coalesce(p_amount, 0) > 0 then
    insert into public.payments (tenant_id, booking_id, kind, amount, method, received_at, created_by, is_demo)
    values (v_tenant, p_booking_id, 'deposit', p_amount, coalesce(p_method, 'transfer'), now(), v_uid, v_b.is_demo);
  end if;
  perform private.audit(v_tenant, p_booking_id, 'owner', v_uid, 'deposit_set',
    jsonb_build_object('amount', coalesce(p_amount, 0)));
  return private.booking_json(p_booking_id) || jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.owner_set_deposit_enabled(uuid, boolean) from public, anon;
revoke execute on function public.owner_mark_seen(uuid) from public, anon;
revoke execute on function public.owner_delete_booking(uuid) from public, anon;
revoke execute on function public.owner_set_deposit(uuid, bigint, public.payment_method) from public, anon;
grant execute on function public.owner_set_deposit_enabled(uuid, boolean) to authenticated;
grant execute on function public.owner_mark_seen(uuid) to authenticated;
grant execute on function public.owner_delete_booking(uuid) to authenticated;
grant execute on function public.owner_set_deposit(uuid, bigint, public.payment_method) to authenticated;

-- 5. После окончания визита подтверждённая бронь сама становится «Пришли».
--    «Не пришли» ставит только владелец.
create function private.complete_past_bookings()
returns void
language sql
set search_path = ''
as $$
  update public.bookings set status = 'completed'
  where status = 'confirmed' and end_at < now();
$$;

select cron.schedule('complete-past-bookings', '*/10 * * * *', 'select private.complete_past_bookings()');
select private.complete_past_bookings();

-- 6. Push владельцу уходит и в preview: это его собственные устройства, без этого
--    кабинет на тестовом заведении не получает уведомлений. Гостям в preview — по-прежнему simulated.
create or replace function public.worker_claim_jobs(p_limit integer default 50, p_lease interval default '2 minutes')
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_result jsonb;
begin
  with due as (
    select j.id
    from public.notification_jobs j
    where (j.status = 'pending' and j.run_at <= now())
       or (j.status = 'leased' and j.lease_until < now())
    order by j.run_at
    for update skip locked
    limit greatest(1, least(p_limit, 200))
  ), claimed as (
    update public.notification_jobs j
    set status = 'leased', lease_until = now() + p_lease, attempts = j.attempts + 1
    from due
    where j.id = due.id
    returning j.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from claimed;

  -- Бронь перенесена (другая версия) или уже не активна (кроме уведомления об отмене) → skipped.
  update public.notification_jobs j
  set status = 'skipped', lease_until = null, last_error = 'STALE_BOOKING'
  from public.bookings b
  where j.id = any(v_ids) and b.id = j.booking_id
    and (b.version <> j.booking_version
         or (b.status in ('cancelled', 'no_show', 'completed') and j.kind <> 'booking_cancelled'));

  -- Заведение не live: гостям ничего не отправляем, но отмечаем, что отправили бы.
  update public.notification_jobs j
  set status = 'simulated', lease_until = null, sent_at = now()
  from public.tenants t
  where j.id = any(v_ids) and j.status = 'leased' and j.recipient = 'guest'
    and t.id = j.tenant_id and t.status <> 'live';

  -- Нет подписок получателя → skipped.
  update public.notification_jobs j
  set status = 'skipped', lease_until = null, last_error = 'NO_SUBSCRIPTION'
  where j.id = any(v_ids) and j.status = 'leased'
    and not exists (
      select 1 from public.push_subscriptions s
      where s.tenant_id = j.tenant_id
        and ((j.recipient = 'guest' and s.scope = 'guest' and s.booking_id = j.booking_id)
          or (j.recipient = 'owner' and s.scope = 'owner'))
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'kind', j.kind,
    'recipient', j.recipient,
    'attempts', j.attempts,
    'tenant_slug', t.slug,
    'tenant_name', t.name,
    'timezone', t.timezone,
    'hall_name', h.name,
    'start_at', b.start_at,
    'customer_name', b.customer_name,
    'guests', b.guests,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      from public.push_subscriptions s
      where s.tenant_id = j.tenant_id
        and ((j.recipient = 'guest' and s.scope = 'guest' and s.booking_id = j.booking_id)
          or (j.recipient = 'owner' and s.scope = 'owner'))
    )
  ) order by j.run_at), '[]'::jsonb)
  into v_result
  from public.notification_jobs j
  join public.bookings b on b.id = j.booking_id
  join public.tenants t on t.id = j.tenant_id
  join public.halls h on h.id = b.hall_id
  where j.id = any(v_ids) and j.status = 'leased';

  return v_result;
end;
$$;
