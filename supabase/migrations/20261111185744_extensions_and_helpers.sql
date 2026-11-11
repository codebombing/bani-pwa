-- Этап 2. Расширения, приватная схема, базовые типы и служебные функции.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Приватная схема: не публикуется через Data API. Хелперы для RLS и внутренняя логика.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- По умолчанию новые объекты public НЕ доступны anon/authenticated: всё выдаётся явным GRANT.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- Типы
create type public.tenant_status as enum ('preview', 'live', 'archived');
create type public.member_role as enum ('owner', 'staff');
create type public.day_type as enum ('weekday', 'weekend', 'holiday');
create type public.extra_unit as enum ('per_booking', 'per_hour', 'per_guest');
create type public.guest_price_unit as enum ('per_hour', 'per_booking');
create type public.exception_kind as enum ('closed', 'special_hours', 'day_type');
create type public.booking_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.booking_source as enum ('online', 'phone', 'messenger', 'walk_in', 'owner');
create type public.occupancy_kind as enum ('booking', 'block');
create type public.payment_kind as enum ('deposit', 'payment', 'refund');
create type public.payment_method as enum ('cash', 'transfer', 'card', 'online');
create type public.push_scope as enum ('guest', 'owner');
create type public.notification_kind as enum (
  'booking_created',
  'reminder_24h',
  'reminder_2h',
  'booking_rescheduled',
  'booking_cancelled'
);
create type public.notification_recipient as enum ('guest', 'owner');
create type public.job_status as enum ('pending', 'leased', 'sent', 'skipped', 'failed', 'simulated');

-- IANA timezone существует? (для CHECK нужна immutable-функция)
create function private.is_valid_timezone(tz text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  perform pg_catalog.now() at time zone tz;
  return true;
exception
  when invalid_parameter_value then
    return false;
end;
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
