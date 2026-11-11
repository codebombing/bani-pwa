-- Этап 2. Доступы: RLS на всех таблицах, REVOKE по умолчанию, точечные GRANT.
--
-- Модель:
--   anon          — только публичный каталог заведений в статусе preview/live
--                   (заведение, залы, часы, исключения, тарифы, допы). Никаких броней,
--                   персональных данных, платежей, токенов, подписок.
--   authenticated — каталог + SELECT данных СВОИХ заведений (членство в tenant_members).
--                   Прямых INSERT/UPDATE/DELETE нет: изменения только через
--                   SECURITY DEFINER функции (этап 3), вызываемые Edge Functions.
--   service_role  — конвейер и Edge Functions (обходит RLS).
--
-- Политики anon и authenticated разделены: у anon нет EXECUTE на private.is_member.

-- 1. Всё закрыть.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, interval) to service_role;
grant execute on function public.consume_llm_budget(uuid, integer, integer, integer) to service_role;

-- 2. RLS везде (таблицы без политик доступны только service_role).
alter table public.tenants enable row level security;
alter table public.tenant_config_versions enable row level security;
alter table public.tenant_members enable row level security;
alter table public.halls enable row level security;
alter table public.working_hours enable row level security;
alter table public.calendar_exceptions enable row level security;
alter table public.tariff_versions enable row level security;
alter table public.tariff_rules enable row level security;
alter table public.extras enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_extras enable row level security;
alter table public.resource_occupancies enable row level security;
alter table public.hall_blocks enable row level security;
alter table public.booking_access_tokens enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.payments enable row level security;
alter table public.audit_log enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.llm_usage enable row level security;
alter table public.llm_usage_global enable row level security;

-- 3. Публичный каталог.
grant select on public.tenants, public.halls, public.working_hours, public.calendar_exceptions,
  public.tariff_versions, public.tariff_rules, public.extras
  to anon, authenticated;

create policy tenants_public_read on public.tenants
  for select to anon
  using (status in ('preview', 'live'));
create policy tenants_member_or_public_read on public.tenants
  for select to authenticated
  using (status in ('preview', 'live') or (select private.is_member(id)));

create policy halls_public_read on public.halls
  for select to anon
  using (is_active and (select private.is_public_tenant(tenant_id)));
create policy halls_member_or_public_read on public.halls
  for select to authenticated
  using (
    (is_active and (select private.is_public_tenant(tenant_id)))
    or (select private.is_member(tenant_id))
  );

create policy extras_public_read on public.extras
  for select to anon
  using (is_active and (select private.is_public_tenant(tenant_id)));
create policy extras_member_or_public_read on public.extras
  for select to authenticated
  using (
    (is_active and (select private.is_public_tenant(tenant_id)))
    or (select private.is_member(tenant_id))
  );

create policy working_hours_public_read on public.working_hours
  for select to anon using ((select private.is_public_tenant(tenant_id)));
create policy working_hours_member_read on public.working_hours
  for select to authenticated
  using ((select private.is_public_tenant(tenant_id)) or (select private.is_member(tenant_id)));

create policy calendar_exceptions_public_read on public.calendar_exceptions
  for select to anon using ((select private.is_public_tenant(tenant_id)));
create policy calendar_exceptions_member_read on public.calendar_exceptions
  for select to authenticated
  using ((select private.is_public_tenant(tenant_id)) or (select private.is_member(tenant_id)));

create policy tariff_versions_public_read on public.tariff_versions
  for select to anon using ((select private.is_public_tenant(tenant_id)));
create policy tariff_versions_member_read on public.tariff_versions
  for select to authenticated
  using ((select private.is_public_tenant(tenant_id)) or (select private.is_member(tenant_id)));

create policy tariff_rules_public_read on public.tariff_rules
  for select to anon using ((select private.is_public_tenant(tenant_id)));
create policy tariff_rules_member_read on public.tariff_rules
  for select to authenticated
  using ((select private.is_public_tenant(tenant_id)) or (select private.is_member(tenant_id)));

-- 4. Данные заведения — только члены этого заведения, только чтение.
grant select on public.tenant_config_versions, public.tenant_members, public.bookings,
  public.booking_extras, public.resource_occupancies, public.hall_blocks, public.payments,
  public.audit_log, public.notification_jobs, public.llm_usage, public.push_subscriptions
  to authenticated;

create policy tenant_config_versions_member_read on public.tenant_config_versions
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy tenant_members_member_read on public.tenant_members
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy bookings_member_read on public.bookings
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy booking_extras_member_read on public.booking_extras
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy resource_occupancies_member_read on public.resource_occupancies
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy hall_blocks_member_read on public.hall_blocks
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy payments_member_read on public.payments
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy audit_log_member_read on public.audit_log
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy notification_jobs_member_read on public.notification_jobs
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy llm_usage_member_read on public.llm_usage
  for select to authenticated using ((select private.is_member(tenant_id)));

-- Подписки владельца — только свои; гостевые подписки (по токену) authenticated не видит.
create policy push_subscriptions_own_read on public.push_subscriptions
  for select to authenticated
  using (
    scope = 'owner'
    and user_id = (select auth.uid())
    and (select private.is_member(tenant_id))
  );

-- booking_access_tokens, idempotency_keys, rate_limit_buckets, llm_usage_global:
-- ни одного GRANT для anon/authenticated — только service_role и SECURITY DEFINER функции.

-- 5. Публичные представления с минимальным набором полей. security_invoker = true:
--    права и RLS проверяются от имени вызывающего, а не владельца представления.
create view public.public_tenants
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
  t.free_cancellation_hours
from public.tenants t
where t.status in ('preview', 'live');

create view public.public_halls
with (security_invoker = true) as
select
  h.id,
  h.tenant_id,
  h.key,
  h.name,
  h.description,
  h.capacity_included,
  h.capacity_max,
  h.extra_guest_price,
  h.extra_guest_unit,
  h.min_duration_min,
  h.slot_step_min,
  h.photos,
  h.sort
from public.halls h
where h.is_active and (select private.is_public_tenant(h.tenant_id));

create view public.public_extras
with (security_invoker = true) as
select e.id, e.tenant_id, e.key, e.name, e.description, e.price, e.unit, e.max_qty, e.sort
from public.extras e
where e.is_active and (select private.is_public_tenant(e.tenant_id));

grant select on public.public_tenants, public.public_halls, public.public_extras
  to anon, authenticated;
