-- Этап 2. Подписки Web Push и outbox уведомлений (воркер — этап 7).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  scope public.push_scope not null,
  booking_id uuid,
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, endpoint),
  check (
    (scope = 'guest' and booking_id is not null and user_id is null)
    or (scope = 'owner' and user_id is not null and booking_id is null)
  ),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index push_subscriptions_booking_idx on public.push_subscriptions (tenant_id, booking_id);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  booking_version integer not null check (booking_version > 0),
  kind public.notification_kind not null,
  recipient public.notification_recipient not null,
  run_at timestamptz not null,
  -- <booking_id>:<version>:<kind>:<recipient> — повторная постановка не дублирует задачу.
  dedupe_key text not null unique,
  status public.job_status not null default 'pending',
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'leased' or lease_until is not null),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create trigger notification_jobs_set_updated_at
  before update on public.notification_jobs
  for each row execute function private.set_updated_at();

-- Захват воркером: pending с наступившим run_at и протухшие leased.
create index notification_jobs_due_idx
  on public.notification_jobs (run_at) where status in ('pending', 'leased');
create index notification_jobs_booking_idx on public.notification_jobs (tenant_id, booking_id);
