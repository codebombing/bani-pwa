-- Демо-данные для локальной разработки (`npx supabase db reset` применяет автоматически).
-- Каталог демо-заведений (раздел 5 плана) берётся из tenants/demo-*/business.json той же
-- функцией, что и в tenant:publish. Картинки и оболочку PWA заливает уже publish:
--   npm run build && npm run demo:publish
-- Заведения в статусе preview: брони и платежи помечены is_demo = true. Цифры демонстрационные.

-- >>> demo-tenants: сгенерировано `npm run tenant:seed` из tenants/demo-*/business.json — не править вручную
select public.admin_publish_tenant($cfg${"schema_version":1,"slug":"demo-banya","name":"Демо-баня «Берёзка»","timezone":"Europe/Moscow","locale":"ru-RU","currency":"RUB","theme":{"accent":"#D9822B","hero":"hero.jpg","logo":"logo.png","wordmark":{"top":"Демо-баня","main":"Берёзка","sub":"русская баня на дровах"}},"pwa":{"short_name":"Берёзка","description":"Бронирование бани"},"texts":{"tagline":"Настоящий русский пар на берёзовых дровах","description":"Два зала только для вашей компании: жаркая парная, ледяная купель и уютная комната отдыха. Веники, полотенца и чай уже ждут — приезжайте отдыхать, остальное на нас.","booking_note":"Возьмите сменную обувь."},"contacts":{"phone":"+7 900 000-00-00","telegram":"demo_banya","address":"Москва, Банный переулок, 1","coords":{"lat":55.7558,"lng":37.6173}},"legal":{"operator_name":"ИП Демо Демо Демович","privacy_policy_url":"https://example.com/privacy"},"policy":{"deposit_percent":30,"free_cancellation_hours":24,"reschedule_pricing":"current"},"working_hours":{"days":{"mon":{"start_from":"10:00","start_to":"23:00"},"tue":{"start_from":"10:00","start_to":"23:00"},"wed":{"start_from":"10:00","start_to":"23:00"},"thu":{"start_from":"10:00","start_to":"23:00"},"fri":{"start_from":"10:00","start_to":"23:00"},"sat":{"start_from":"10:00","start_to":"23:00"},"sun":{"start_from":"10:00","start_to":"23:00"}},"max_end_after_close_min":180},"halls":[{"key":"small","name":"Малый зал","description":"Русская парная на дровах, комната отдыха.","capacity_included":4,"capacity_max":6,"extra_guest_price_rub":400,"extra_guest_unit":"per_hour","min_duration_min":120,"slot_step_min":60,"buffer_min":60,"photos":["halls/small/1.jpg","halls/small/2.jpg","halls/small/3.jpg"],"tariffs":[{"effective_from":"2026-01-01","rules":[{"day_type":"weekday","from":"02:00","to":"22:00","price_per_hour_rub":2500},{"day_type":"weekday","from":"22:00","to":"02:00","price_per_hour_rub":3500},{"day_type":"weekend","from":"02:00","to":"22:00","price_per_hour_rub":3200},{"day_type":"weekend","from":"22:00","to":"02:00","price_per_hour_rub":3500}]}]},{"key":"big","name":"Большой зал","description":"Парная, купель, бильярд.","capacity_included":8,"capacity_max":14,"extra_guest_price_rub":500,"extra_guest_unit":"per_hour","min_duration_min":180,"slot_step_min":60,"buffer_min":60,"photos":["halls/big/1.jpg","halls/big/2.jpg","halls/big/3.jpg"],"tariffs":[{"effective_from":"2026-01-01","rules":[{"day_type":"weekday","from":"02:00","to":"22:00","price_per_hour_rub":4000},{"day_type":"weekday","from":"22:00","to":"02:00","price_per_hour_rub":5500},{"day_type":"weekend","from":"02:00","to":"22:00","price_per_hour_rub":5000},{"day_type":"weekend","from":"22:00","to":"02:00","price_per_hour_rub":5500}]}]}],"extras":[{"key":"venik","name":"Веник дубовый","description":"","price_rub":600,"unit":"per_booking","max_qty":5},{"key":"towels","name":"Комплект полотенец","description":"На одного гостя","price_rub":300,"unit":"per_guest","max_qty":14},{"key":"chan","name":"Чан на дровах","description":"","price_rub":3000,"unit":"per_booking","max_qty":1}],"exceptions":[{"kind":"day_type","date":"2027-01-01","day_type":"holiday","note":"Новый год"}]}$cfg$::jsonb,
  '72ad59e25320b6aa77cb8e3857e14f04d715aca09ac4369746f4dac8ea115906', false, 'seed');
select public.admin_publish_tenant($cfg${"schema_version":1,"slug":"demo-sauna24","name":"Демо-сауна «Круглосуточно»","timezone":"Europe/Moscow","locale":"ru-RU","currency":"RUB","theme":{"accent":"#D99A3E","hero":"hero.jpg","logo":"logo.png","wordmark":{"top":"Сауна","main":"24 часа","sub":"с бассейном и караоке"}},"pwa":{"short_name":"Сауна 24","description":"Круглосуточная сауна с бассейном"},"texts":{"tagline":"Сауна с бассейном — когда удобно, хоть в 3 ночи","description":"Финская сауна, бассейн с противотоком и комната отдыха с караоке. Работаем круглосуточно и без выходных: выберите время — мы всё подготовим к вашему приходу.","booking_note":"Простыни и тапочки можно взять у нас."},"contacts":{"phone":"+7 900 000-00-24","telegram":"demo_sauna24","address":"Москва, Ночная улица, 24","coords":{"lat":55.7601,"lng":37.6187}},"legal":{"operator_name":"ООО «Демо Сауна»","privacy_policy_url":"https://example.com/privacy-sauna"},"policy":{"deposit_percent":50,"free_cancellation_hours":12,"reschedule_pricing":"current"},"working_hours":{"days":{"mon":{"start_from":"00:00","start_to":"24:00"},"tue":{"start_from":"00:00","start_to":"24:00"},"wed":{"start_from":"00:00","start_to":"24:00"},"thu":{"start_from":"00:00","start_to":"24:00"},"fri":{"start_from":"00:00","start_to":"24:00"},"sat":{"start_from":"00:00","start_to":"24:00"},"sun":{"start_from":"00:00","start_to":"24:00"}},"max_end_after_close_min":0},"halls":[{"key":"pool","name":"Сауна с бассейном","description":"Финская сауна, бассейн 4×3 м, комната отдыха с караоке.","capacity_included":4,"capacity_max":8,"extra_guest_price_rub":300,"extra_guest_unit":"per_hour","min_duration_min":120,"slot_step_min":30,"buffer_min":30,"photos":["halls/pool/1.jpg","halls/pool/2.jpg","halls/pool/3.jpg"],"tariffs":[{"effective_from":"2026-01-01","rules":[{"day_type":"weekday","from":"08:00","to":"24:00","price_per_hour_rub":1800},{"day_type":"weekday","from":"00:00","to":"08:00","price_per_hour_rub":2000},{"day_type":"weekend","from":"08:00","to":"24:00","price_per_hour_rub":2400},{"day_type":"weekend","from":"00:00","to":"08:00","price_per_hour_rub":2000}]}]}],"extras":[{"key":"karaoke","name":"Караоке","description":"","price_rub":1000,"unit":"per_booking","max_qty":1},{"key":"sheets","name":"Простыня","description":"На одного гостя","price_rub":150,"unit":"per_guest","max_qty":8}],"exceptions":[]}$cfg$::jsonb,
  '8d5bcac27afea1b2dcf78a4783320d60e4cacc00b631b37a089d64330e43fafe', false, 'seed');
-- <<< demo-tenants

-- Демо-брони создаются ядром создания брони (цена и занятость как у настоящих) на даты
-- относительно дня запуска seed, чтобы всегда были ближайшие брони.
do $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_tenant uuid;
  v_small uuid;
  v_ids jsonb := '{}'::jsonb;
  b record;
  v_r jsonb;
begin
  for b in
    select * from (values
      ('past',  'demo-banya',   'small', v_today - 2, time '14:00', 120, 4,  'Анна',   '+79000000101', 'phone'::public.booking_source,     array['venik:1']),
      ('soon',  'demo-banya',   'small', v_today + 1, time '18:00', 120, 3,  'Борис',  '+79000000102', 'online'::public.booking_source,    array['towels:3']),
      ('later', 'demo-banya',   'big',   v_today + 2, time '19:00', 180, 10, 'Виктор', '+79000000103', 'messenger'::public.booking_source, array['chan:1']),
      ('night', 'demo-banya',   'small', v_today + 3, time '22:00', 180, 2,  'Галина', null,           'walk_in'::public.booking_source,   array[]::text[]),
      ('s-night', 'demo-sauna24', 'pool', v_today + 1, time '01:00', 180, 5, 'Дмитрий', '+79000000201', 'online'::public.booking_source,   array['sheets:5']),
      ('s-eve',   'demo-sauna24', 'pool', v_today + 4, time '20:00', 120, 4, 'Елена',   '+79000000202', 'phone'::public.booking_source,    array['karaoke:1'])
    ) as t(tag, slug, hall_key, day, at, dur, guests, name, phone, source, extras)
  loop
    select t.id into v_tenant from public.tenants t where t.slug = b.slug;
    v_r := private.create_booking(
      v_tenant, null,
      (select h.id from public.halls h where h.tenant_id = v_tenant and h.key = b.hall_key),
      (b.day + b.at) at time zone 'Europe/Moscow', b.dur, b.guests,
      coalesce((
        select jsonb_agg(jsonb_build_object('extra_id', e.id, 'qty', split_part(x, ':', 2)::int))
        from unnest(b.extras) x
        join public.extras e on e.tenant_id = v_tenant and e.key = split_part(x, ':', 1)
      ), '[]'::jsonb),
      b.name, b.phone, null, b.source, case when b.source = 'online' then now() end, null,
      null, null, null, null, true, true, 'system');
    if not (v_r ->> 'ok')::boolean then
      raise exception 'seed: демо-бронь % не создана: %', b.tag, v_r;
    end if;
    v_ids := v_ids || jsonb_build_object(b.tag, v_r);
  end loop;

  select t.id into v_tenant from public.tenants t where t.slug = 'demo-banya';
  select h.id into v_small from public.halls h where h.tenant_id = v_tenant and h.key = 'small';

  -- Прошедший визит: состоялся и оплачен полностью.
  update public.bookings set status = 'completed' where id = (v_ids #>> '{past,booking_id}')::uuid;
  insert into public.payments (tenant_id, booking_id, kind, amount, method, received_at, is_demo)
  values (v_tenant, (v_ids #>> '{past,booking_id}')::uuid, 'payment', (v_ids #>> '{past,total_amount}')::bigint,
          'cash', ((v_today - 2) + time '16:00') at time zone 'Europe/Moscow', true);

  -- Ближайшая онлайн-бронь: внесён задаток 30 %.
  insert into public.payments (tenant_id, booking_id, kind, amount, method, is_demo)
  values (v_tenant, (v_ids #>> '{soon,booking_id}')::uuid, 'deposit', (v_ids #>> '{soon,deposit_amount}')::bigint,
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

  -- Сауна: ночная онлайн-бронь с задатком 50 %.
  insert into public.payments (tenant_id, booking_id, kind, amount, method, is_demo)
  select t.id, (v_ids #>> '{s-night,booking_id}')::uuid, 'deposit',
         (v_ids #>> '{s-night,deposit_amount}')::bigint, 'card', true
  from public.tenants t where t.slug = 'demo-sauna24';
end $$;
