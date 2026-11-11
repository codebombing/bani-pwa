-- Этап 2. Заведения, история конфигов, члены (владельцы/персонал).

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null default 'Europe/Moscow' check (private.is_valid_timezone(timezone)),
  status public.tenant_status not null default 'preview',
  config_version integer not null default 0 check (config_version >= 0),
  -- Отображаемые настройки из business.json (публичные по природе).
  theme jsonb not null default '{}'::jsonb,
  texts jsonb not null default '{}'::jsonb,
  contacts jsonb not null default '{}'::jsonb,
  legal jsonb not null default '{}'::jsonb,
  pwa jsonb not null default '{}'::jsonb,
  -- Правила, которые использует SQL-логика бронирования.
  max_end_after_close_min integer not null default 0
    check (max_end_after_close_min between 0 and 1440),
  deposit_percent integer not null default 0 check (deposit_percent between 0 and 100),
  free_cancellation_hours integer not null default 24
    check (free_cancellation_hours between 0 and 720),
  reschedule_pricing text not null default 'current'
    check (reschedule_pricing in ('current', 'original')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function private.set_updated_at();

create table public.tenant_config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  version integer not null check (version > 0),
  config jsonb not null,
  config_hash text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  published_by text,
  unique (tenant_id, version)
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- RLS-хелпер ищет по user_id → индекс.
create index tenant_members_user_id_idx on public.tenant_members (user_id);

-- Членство текущего пользователя в заведении (любой ролью).
-- SECURITY DEFINER: читает tenant_members в обход его RLS, но только для auth.uid().
create function private.is_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
  );
$$;

create function private.has_role(p_tenant_id uuid, p_role public.member_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.role = p_role
  );
$$;

-- Заведение показывается публично (preview для демо и live; archived скрыто).
create function private.is_public_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id and t.status in ('preview', 'live')
  );
$$;

revoke execute on function private.is_member(uuid) from public, anon;
revoke execute on function private.has_role(uuid, public.member_role) from public, anon;
revoke execute on function private.is_public_tenant(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.has_role(uuid, public.member_role) to authenticated, service_role;
grant execute on function private.is_public_tenant(uuid) to anon, authenticated, service_role;
