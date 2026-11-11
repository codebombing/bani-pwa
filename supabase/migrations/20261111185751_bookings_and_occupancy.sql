-- Этап 2. Брони, единая занятость залов (EXCLUDE), блокировки, токены, идемпотентность,
-- платежи, аудит. Изменения броней — только через SECURITY DEFINER функции (этап 3).

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  hall_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  guests integer not null check (guests > 0),
  status public.booking_status not null default 'confirmed',
  source public.booking_source not null,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_phone text check (customer_phone ~ '^\+[0-9]{10,15}$'),
  comment text check (char_length(comment) <= 1000),
  price_snapshot jsonb not null default '{}'::jsonb,
  total_amount bigint not null check (total_amount >= 0), -- копейки
  tariff_version_id uuid,
  version integer not null default 1 check (version > 0),
  is_demo boolean not null default false,
  consent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (end_at > start_at),
  -- Онлайн-бронь гостя: обязательны телефон и согласие на обработку ПДн.
  check (source <> 'online' or (customer_phone is not null and consent_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  foreign key (tenant_id, hall_id) references public.halls (tenant_id, id),
  foreign key (tenant_id, tariff_version_id) references public.tariff_versions (tenant_id, id)
);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function private.set_updated_at();

create index bookings_hall_start_idx on public.bookings (tenant_id, hall_id, start_at);
create index bookings_tenant_start_idx on public.bookings (tenant_id, start_at);
create index bookings_tenant_created_idx on public.bookings (tenant_id, created_at);
create index bookings_tariff_version_idx on public.bookings (tenant_id, tariff_version_id);
create index bookings_created_by_idx on public.bookings (created_by);

create table public.booking_extras (
  tenant_id uuid not null,
  booking_id uuid not null,
  extra_id uuid not null,
  -- Снимок на момент брони: смена цены допа не меняет старые брони.
  name text not null,
  unit public.extra_unit not null,
  unit_price bigint not null check (unit_price >= 0),
  qty integer not null check (qty > 0),
  amount bigint not null check (amount >= 0),
  primary key (booking_id, extra_id),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  foreign key (tenant_id, extra_id) references public.extras (tenant_id, id)
);

create index booking_extras_tenant_booking_idx on public.booking_extras (tenant_id, booking_id);
create index booking_extras_extra_idx on public.booking_extras (tenant_id, extra_id);

-- Единая таблица занятости. Бронь: [start_at, end_at + buffer). Блокировка: [from, to).
-- Пересечение активных интервалов одного зала отбивает constraint — защита от гонок.
create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  hall_id uuid not null,
  kind public.occupancy_kind not null,
  booking_id uuid,
  occupied tstzrange not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  unique (tenant_id, id),
  check ((kind = 'booking') = (booking_id is not null)),
  check (not isempty(occupied) and lower_inc(occupied) and not upper_inc(occupied)
         and not lower_inf(occupied) and not upper_inf(occupied)),
  check (active = (deactivated_at is null)),
  foreign key (tenant_id, hall_id) references public.halls (tenant_id, id),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  constraint resource_occupancies_no_overlap
    exclude using gist (tenant_id with =, hall_id with =, occupied with &&) where (active)
);

-- Одна активная занятость на бронь.
create unique index resource_occupancies_one_active_per_booking
  on public.resource_occupancies (booking_id) where active and booking_id is not null;
create index resource_occupancies_booking_idx on public.resource_occupancies (tenant_id, booking_id);

create table public.hall_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  hall_id uuid not null,
  occupancy_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (occupancy_id),
  foreign key (tenant_id, hall_id) references public.halls (tenant_id, id),
  foreign key (tenant_id, occupancy_id)
    references public.resource_occupancies (tenant_id, id) on delete cascade
);

create index hall_blocks_hall_idx on public.hall_blocks (tenant_id, hall_id);
create index hall_blocks_occupancy_idx on public.hall_blocks (tenant_id, occupancy_id);
create index hall_blocks_created_by_idx on public.hall_blocks (created_by);

-- Токен гостя: в БД только sha256(token). Сам токен = HMAC(secret, booking_id:idempotency_key)
-- вычисляет Edge Function, поэтому при retry выдаётся тот же токен.
create table public.booking_access_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index booking_access_tokens_booking_idx on public.booking_access_tokens (tenant_id, booking_id);

create table public.idempotency_keys (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (char_length(key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  booking_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

-- Очистка по TTL 24 ч.
create index idempotency_keys_created_idx on public.idempotency_keys (created_at);
create index idempotency_keys_booking_idx on public.idempotency_keys (tenant_id, booking_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind public.payment_kind not null,
  amount bigint not null check (amount > 0), -- копейки, знак задаёт kind (refund вычитается)
  method public.payment_method not null,
  provider text,             -- для будущего онлайн-провайдера (yookassa, tbank…)
  provider_payment_id text,
  received_at timestamptz not null default now(),
  note text check (char_length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (method <> 'online' or provider is not null),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index payments_booking_idx on public.payments (tenant_id, booking_id);
create index payments_tenant_received_idx on public.payments (tenant_id, received_at);
create index payments_created_by_idx on public.payments (created_by);
create unique index payments_provider_unique
  on public.payments (provider, provider_payment_id) where provider_payment_id is not null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  booking_id uuid,
  actor_type text not null check (actor_type in ('guest', 'owner', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at);
create index audit_log_booking_idx on public.audit_log (tenant_id, booking_id);
create index audit_log_actor_idx on public.audit_log (actor_user_id);
