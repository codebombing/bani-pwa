-- Демо-данные для локальной разработки (`npx supabase db reset` применяет автоматически).
-- Одно демо-заведение «demo-banya» из плана (раздел 5). Цифры демонстрационные.
-- Заведение в статусе preview: брони и платежи помечены is_demo = true.
-- Брони создаются той же функцией, что и настоящие (цена считается сервером), на даты
-- относительно дня запуска seed, чтобы всегда были ближайшие брони.

insert into public.tenants (id, slug, name, status, timezone, config_version, theme, texts, contacts,
  legal, pwa, max_end_after_close_min, deposit_percent, free_cancellation_hours, reschedule_pricing)
values (
  'd0000000-0000-4000-8000-000000000001',
  'demo-banya',
  'Демо-баня «Берёзка»',
  'preview',
  'Europe/Moscow',
  1,
  '{"accent": "#D9822B"}',
  '{"tagline": "Русская баня на дровах в двух залах",
    "description": "Парные на дровах, купель, комната отдыха. Веники и полотенца — на месте.",
    "booking_note": "Возьмите сменную обувь. Задаток 30 % — после подтверждения."}',
  '{"phone": "+7 900 000-00-00", "telegram": "demo_banya", "address": "Москва, Банный переулок, 1",
    "coords": {"lat": 55.7558, "lng": 37.6173}}',
  '{"operator_name": "ИП Демо Демо Демович", "privacy_policy_url": "https://example.com/privacy"}',
  '{"short_name": "Берёзка", "description": "Бронирование бани"}',
  180, 30, 24, 'current'
);

-- Моменты начала 10:00–23:00 каждый день, бронь может длиться до 02:00.
insert into public.working_hours (tenant_id, weekday, start_from, start_to)
select 'd0000000-0000-4000-8000-000000000001'::uuid, d, time '10:00', time '23:00'
from generate_series(1, 7) d;

insert into public.halls (id, tenant_id, key, name, description, capacity_included, capacity_max,
  extra_guest_price, extra_guest_unit, min_duration_min, slot_step_min, buffer_min, sort) values
  ('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000001', 'small', 'Малый зал',
   'Русская парная на дровах, комната отдыха.', 4, 6, 40000, 'per_hour', 120, 60, 60, 1),
  ('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000001', 'big', 'Большой зал',
   'Парная, купель, бильярд.', 8, 14, 50000, 'per_hour', 180, 60, 60, 2);

insert into public.tariff_versions (id, tenant_id, hall_id, effective_from) values
  ('d0000000-0000-4000-8000-0000000001a1', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000a1', '2026-01-01'),
  ('d0000000-0000-4000-8000-0000000001a2', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000a2', '2026-01-01');

-- Цены в копейках: будни / выходные днём, ночь 22:00–02:00.
insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time, price_per_hour)
select 'd0000000-0000-4000-8000-000000000001'::uuid, v, r.day_type::public.day_type, r.f::time, r.t::time, r.p
from (values
  ('d0000000-0000-4000-8000-0000000001a1'::uuid, 'weekday', '02:00', '22:00', 250000),
  ('d0000000-0000-4000-8000-0000000001a1'::uuid, 'weekday', '22:00', '02:00', 350000),
  ('d0000000-0000-4000-8000-0000000001a1'::uuid, 'weekend', '02:00', '22:00', 320000),
  ('d0000000-0000-4000-8000-0000000001a1'::uuid, 'weekend', '22:00', '02:00', 350000),
  ('d0000000-0000-4000-8000-0000000001a2'::uuid, 'weekday', '02:00', '22:00', 400000),
  ('d0000000-0000-4000-8000-0000000001a2'::uuid, 'weekday', '22:00', '02:00', 550000),
  ('d0000000-0000-4000-8000-0000000001a2'::uuid, 'weekend', '02:00', '22:00', 500000),
  ('d0000000-0000-4000-8000-0000000001a2'::uuid, 'weekend', '22:00', '02:00', 550000)
) as r(v, day_type, f, t, p);

insert into public.extras (id, tenant_id, key, name, description, price, unit, max_qty, sort) values
  ('d0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-000000000001', 'venik', 'Веник дубовый', '', 60000, 'per_booking', 5, 1),
  ('d0000000-0000-4000-8000-0000000000e2', 'd0000000-0000-4000-8000-000000000001', 'towels', 'Комплект полотенец', 'На одного гостя', 30000, 'per_guest', 14, 2),
  ('d0000000-0000-4000-8000-0000000000e3', 'd0000000-0000-4000-8000-000000000001', 'chan', 'Чан на дровах', '', 300000, 'per_booking', 1, 3);

-- Демо-брони (через ядро создания брони — цена и занятость как у настоящих).
do $$
declare
  v_tenant uuid := 'd0000000-0000-4000-8000-000000000001';
  v_small uuid := 'd0000000-0000-4000-8000-0000000000a1';
  v_big uuid := 'd0000000-0000-4000-8000-0000000000a2';
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_past jsonb;
  v_soon jsonb;
  b record;
  v_r jsonb;
begin
  for b in
    select * from (values
      ('past',  v_small, v_today - 2, time '14:00', 120, 4, 'Анна',   '+79000000101', 'phone'::public.booking_source,
        '[{"extra_id":"d0000000-0000-4000-8000-0000000000e1","qty":1}]'::jsonb),
      ('soon',  v_small, v_today + 1, time '18:00', 120, 3, 'Борис',  '+79000000102', 'online',
        '[{"extra_id":"d0000000-0000-4000-8000-0000000000e2","qty":3}]'::jsonb),
      ('later', v_big,   v_today + 2, time '19:00', 180, 10, 'Виктор', '+79000000103', 'messenger',
        '[{"extra_id":"d0000000-0000-4000-8000-0000000000e3","qty":1}]'::jsonb),
      ('night', v_small, v_today + 3, time '22:00', 180, 2, 'Галина', null, 'walk_in', '[]'::jsonb)
    ) as t(tag, hall, day, at, dur, guests, name, phone, source, extras)
  loop
    v_r := private.create_booking(
      v_tenant, null, b.hall, (b.day + b.at) at time zone 'Europe/Moscow', b.dur, b.guests, b.extras,
      b.name, b.phone, null, b.source, case when b.source = 'online' then now() end, null,
      null, null, null, null, true, true, 'system');
    if not (v_r ->> 'ok')::boolean then
      raise exception 'seed: демо-бронь % не создана: %', b.tag, v_r;
    end if;
    if b.tag = 'past' then v_past := v_r; end if;
    if b.tag = 'soon' then v_soon := v_r; end if;
  end loop;

  -- Прошедший визит: состоялся и оплачен полностью.
  update public.bookings set status = 'completed' where id = (v_past ->> 'booking_id')::uuid;
  insert into public.payments (tenant_id, booking_id, kind, amount, method, received_at, is_demo)
  values (v_tenant, (v_past ->> 'booking_id')::uuid, 'payment', (v_past ->> 'total_amount')::bigint,
          'cash', ((v_today - 2) + time '16:00') at time zone 'Europe/Moscow', true);

  -- Ближайшая онлайн-бронь: внесён задаток 30 %.
  insert into public.payments (tenant_id, booking_id, kind, amount, method, is_demo)
  values (v_tenant, (v_soon ->> 'booking_id')::uuid, 'deposit', (v_soon ->> 'deposit_amount')::bigint,
          'transfer', true);

  -- Блокировка малого зала на уборку через 4 дня.
  with o as (
    insert into public.resource_occupancies (tenant_id, hall_id, kind, occupied)
    values (v_tenant, v_small, 'block',
            tstzrange(((v_today + 4) + time '10:00') at time zone 'Europe/Moscow',
                      ((v_today + 4) + time '14:00') at time zone 'Europe/Moscow', '[)'))
    returning id
  )
  insert into public.hall_blocks (tenant_id, hall_id, occupancy_id, reason)
  select v_tenant, v_small, o.id, 'Генеральная уборка' from o;
end $$;
