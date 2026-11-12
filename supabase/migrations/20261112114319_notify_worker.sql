-- Этап 7. Воркер уведомлений (outbox → Web Push) и подписки.
--
-- Захват: pending с наступившим run_at и протухшие leased, FOR UPDATE SKIP LOCKED.
-- Перед отправкой — проверки в БД: бронь активна и версия совпадает (иначе skipped),
-- заведение не live (preview) → simulated, реальной отправки нет; нет подписок → skipped.
-- Воркер получает только то, что действительно надо отправить, и сообщает результат.

create function public.worker_claim_jobs(p_limit integer default 50, p_lease interval default '2 minutes')
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

  -- Заведение не live: ничего не отправляем, но отмечаем, что отправили бы.
  update public.notification_jobs j
  set status = 'simulated', lease_until = null, sent_at = now()
  from public.tenants t
  where j.id = any(v_ids) and j.status = 'leased' and t.id = j.tenant_id and t.status <> 'live';

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

-- Результат отправки. Ошибка → повтор с backoff (1, 2, 4, 8 мин), после 5 попыток failed.
-- Подписки, которые push-сервис назвал недействительными (404/410), удаляются.
create function public.worker_complete_job(
  p_job_id uuid,
  p_ok boolean,
  p_error text default null,
  p_gone_endpoints text[] default '{}'
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  delete from public.push_subscriptions s
  using public.notification_jobs j
  where j.id = p_job_id and s.tenant_id = j.tenant_id and s.endpoint = any(p_gone_endpoints);

  update public.notification_jobs j
  set status = case
        when p_ok then 'sent'::public.job_status
        when j.attempts >= 5 then 'failed'::public.job_status
        else 'pending'::public.job_status end,
      sent_at = case when p_ok then now() else null end,
      lease_until = null,
      run_at = case when p_ok or j.attempts >= 5 then j.run_at
                    else now() + make_interval(mins => power(2, j.attempts - 1)::integer) end,
      last_error = case when p_ok then null else left(p_error, 500) end
  where j.id = p_job_id and j.status = 'leased';
end;
$$;

-- Подписка гостя на уведомления по брони (вызывает public-api по токену).
create function public.public_push_subscribe(
  p_slug text,
  p_token_hash bytea,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.booking_by_token(p_slug, p_token_hash);
  v_tenant uuid;
begin
  if v_id is null then
    return private.fail('NOT_FOUND', 'Бронь не найдена');
  end if;
  select tenant_id into v_tenant from public.bookings where id = v_id;
  insert into public.push_subscriptions (tenant_id, scope, booking_id, endpoint, p256dh, auth)
  values (v_tenant, 'guest', v_id, p_endpoint, p_p256dh, p_auth)
  on conflict (tenant_id, endpoint) do update
    set scope = 'guest', booking_id = excluded.booking_id, user_id = null,
        p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
end;
$$;

-- Подписка владельца/персонала: только для своего заведения и от своего имени.
create function public.owner_push_subscribe(
  p_tenant_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_tenant_id) then
    return private.fail('FORBIDDEN', 'Нет доступа к заведению');
  end if;
  if p_endpoint !~ '^https://' then
    return private.fail('VALIDATION_ERROR', 'Некорректная подписка');
  end if;
  insert into public.push_subscriptions (tenant_id, scope, user_id, endpoint, p256dh, auth)
  values (p_tenant_id, 'owner', (select auth.uid()), p_endpoint, p_p256dh, p_auth)
  on conflict (tenant_id, endpoint) do update
    set scope = 'owner', user_id = excluded.user_id, booking_id = null,
        p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.owner_push_unsubscribe(p_tenant_id uuid, p_endpoint text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions
  where tenant_id = p_tenant_id and endpoint = p_endpoint and user_id = (select auth.uid());
  select jsonb_build_object('ok', true);
$$;

revoke execute on function public.worker_claim_jobs(integer, interval) from public, anon, authenticated;
revoke execute on function public.worker_complete_job(uuid, boolean, text, text[]) from public, anon, authenticated;
revoke execute on function public.public_push_subscribe(text, bytea, text, text, text) from public, anon, authenticated;
revoke execute on function public.owner_push_subscribe(uuid, text, text, text) from public, anon;
revoke execute on function public.owner_push_unsubscribe(uuid, text) from public, anon;
grant execute on function public.worker_claim_jobs(integer, interval) to service_role;
grant execute on function public.worker_complete_job(uuid, boolean, text, text[]) to service_role;
grant execute on function public.public_push_subscribe(text, bytea, text, text, text) to service_role;
grant execute on function public.owner_push_subscribe(uuid, text, text, text) to authenticated;
grant execute on function public.owner_push_unsubscribe(uuid, text) to authenticated;

-- Раз в минуту pg_cron будит notify-worker через pg_net. Адрес и секретный ключ — в Vault
-- (notify_worker_url, notify_worker_key); пока их нет, задание ничего не делает.
create function private.invoke_notify_worker()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_worker_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_worker_key';
  if v_url is null or v_key is null then
    return;
  end if;
  if not exists (
    select 1 from public.notification_jobs
    where (status = 'pending' and run_at <= now()) or (status = 'leased' and lease_until < now())
  ) then
    return; -- нечего отправлять — не будим функцию
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'apikey', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function private.invoke_notify_worker() from public, anon, authenticated;

select cron.schedule('notify-worker', '* * * * *', 'select private.invoke_notify_worker()');
