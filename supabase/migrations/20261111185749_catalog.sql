-- Этап 2. Каталог заведения: залы, часы, исключения, тарифы, допы.
-- Все зависимые таблицы несут tenant_id и ссылаются составным FK (tenant_id, X_id),
-- чтобы строка одного заведения не могла сослаться на объект другого.

create table public.halls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  capacity_included integer not null check (capacity_included > 0),
  capacity_max integer not null,
  extra_guest_price bigint not null default 0 check (extra_guest_price >= 0), -- копейки
  extra_guest_unit public.guest_price_unit not null default 'per_hour',
  min_duration_min integer not null check (min_duration_min > 0),
  slot_step_min integer not null check (slot_step_min > 0 and slot_step_min % 15 = 0),
  buffer_min integer not null default 0 check (buffer_min >= 0),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array'),
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key),
  check (capacity_max >= capacity_included),
  check (min_duration_min % slot_step_min = 0)
);

create trigger halls_set_updated_at
  before update on public.halls
  for each row execute function private.set_updated_at();

-- Окна МОМЕНТОВ НАЧАЛА брони по дням недели (ISO: 1 = пн … 7 = вс), локальное время заведения.
-- start_to < start_from — окно продолжается после полуночи и принадлежит дню начала окна.
-- 00:00–24:00 — круглосуточно. Нет строки — день закрыт.
create table public.working_hours (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_from time not null check (start_from < time '24:00'),
  start_to time not null,
  primary key (tenant_id, weekday),
  check (start_from <> start_to)
);

create table public.calendar_exceptions (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  date date not null,
  kind public.exception_kind not null,
  start_from time,
  start_to time,
  day_type public.day_type,
  note text,
  primary key (tenant_id, date),
  check (
    (kind = 'closed' and start_from is null and start_to is null and day_type is null)
    or (kind = 'special_hours' and start_from is not null and start_to is not null
        and start_from <> start_to and start_from < time '24:00' and day_type is null)
    or (kind = 'day_type' and day_type is not null and start_from is null and start_to is null)
  )
);

create table public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  hall_id uuid not null,
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, hall_id, effective_from),
  foreign key (tenant_id, hall_id) references public.halls (tenant_id, id) on delete cascade
);

create table public.tariff_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  tariff_version_id uuid not null,
  day_type public.day_type not null,
  from_time time not null check (from_time < time '24:00'),
  to_time time not null,
  price_per_hour bigint not null check (price_per_hour > 0), -- копейки
  check (from_time <> to_time),
  foreign key (tenant_id, tariff_version_id)
    references public.tariff_versions (tenant_id, id) on delete cascade
);

create index tariff_rules_version_idx on public.tariff_rules (tenant_id, tariff_version_id);

create table public.extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  price bigint not null check (price > 0), -- копейки
  unit public.extra_unit not null,
  max_qty integer not null check (max_qty between 1 and 99),
  sort integer not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, id),
  unique (tenant_id, key)
);
