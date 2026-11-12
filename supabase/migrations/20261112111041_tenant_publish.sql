-- Этап 4. Публикация business.json (tenant:publish и seed демо-заведений).
--
-- admin_publish_tenant применяет проверенный конфиг (Zod + бизнес-проверки делает
-- tenant:validate) одной транзакцией: заведение, часы, исключения, залы, тарифы, допы,
-- новая версия конфига. Брони, платежи, блокировки и членство НЕ трогаются.
-- Сопоставление по ключам (slug, hall.key, extra.key, tariff effective_from), поэтому
-- повторная публикация сохраняет id залов и допов, на которые ссылаются брони.

-- Картинки заведения: <tenant_id>/config/... — из business.json (конвейер),
-- <tenant_id>/owner/... — загрузки владельца (конвейер их не трогает).
-- Бакет публичный на чтение; запись только service role (политик для anon/authenticated нет).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-assets', 'tenant-assets', true, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- CHECK на tenants.timezone вызывает private.is_valid_timezone от имени пишущей роли;
-- миграции этапа 3 сняли EXECUTE у PUBLIC, поэтому даём его service role явно.
grant execute on function private.is_valid_timezone(text) to service_role;

create function public.admin_publish_tenant(
  p_config jsonb,
  p_config_hash text,
  p_live boolean default false,
  p_published_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slug text := p_config ->> 'slug';
  v_tenant uuid;
  v_status public.tenant_status;
  v_created boolean := false;
  v_version integer;
  v_last_hash text;
  v_changed boolean;
  v_hall jsonb;
  v_hall_ord bigint;
  v_hall_id uuid;
  v_tv jsonb;
  v_tv_id uuid;
  v_new_rules jsonb;
  v_old_rules jsonb;
  v_locked text;
  v_warnings jsonb := '[]'::jsonb;
begin
  if p_config_hash is null or p_config_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'config_hash: ожидается sha256 hex';
  end if;
  if coalesce(p_config ->> 'schema_version', '') <> '1' or v_slug is null then
    raise exception using errcode = '22023', message = 'business.json: нужна schema_version 1 и slug';
  end if;

  -- Две публикации одного slug не перемешиваются.
  perform pg_advisory_xact_lock(hashtextextended('tenant-publish:' || v_slug, 0));

  select t.id, t.status into v_tenant, v_status
  from public.tenants t where t.slug = v_slug for update;

  if v_tenant is null then
    insert into public.tenants (slug, name, timezone, status)
    values (v_slug, p_config ->> 'name', p_config ->> 'timezone', 'preview')
    returning id, status into v_tenant, v_status;
    v_created := true;
  end if;

  if p_live then
    if not exists (
      select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.role = 'owner'
    ) then
      raise exception using errcode = 'P0001', hint = 'NO_OWNER',
        message = format('«%s» нельзя перевести в live: нет владельца. Сначала npm run owner:invite -- %s <email>', v_slug, v_slug);
    end if;
    v_status := 'live';
  end if;

  update public.tenants set
    name = p_config ->> 'name',
    timezone = p_config ->> 'timezone',
    status = v_status,
    theme = coalesce(p_config -> 'theme', '{}'::jsonb),
    texts = coalesce(p_config -> 'texts', '{}'::jsonb),
    contacts = coalesce(p_config -> 'contacts', '{}'::jsonb),
    legal = coalesce(p_config -> 'legal', '{}'::jsonb),
    pwa = coalesce(p_config -> 'pwa', '{}'::jsonb),
    max_end_after_close_min = (p_config #>> '{working_hours,max_end_after_close_min}')::integer,
    deposit_percent = (p_config #>> '{policy,deposit_percent}')::integer,
    free_cancellation_hours = (p_config #>> '{policy,free_cancellation_hours}')::integer,
    reschedule_pricing = coalesce(p_config #>> '{policy,reschedule_pricing}', 'current')
  where id = v_tenant;

  -- Часы работы и исключения целиком из конфига (на них ничего не ссылается).
  delete from public.working_hours where tenant_id = v_tenant;
  insert into public.working_hours (tenant_id, weekday, start_from, start_to)
  select v_tenant, d.n, (x.w ->> 'start_from')::time, (x.w ->> 'start_to')::time
  from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) with ordinality as d(code, n)
  cross join lateral (select p_config #> array['working_hours', 'days', d.code] as w) x
  where jsonb_typeof(x.w) = 'object';

  delete from public.calendar_exceptions where tenant_id = v_tenant;
  insert into public.calendar_exceptions (tenant_id, date, kind, start_from, start_to, day_type, note)
  select v_tenant, (e ->> 'date')::date, (e ->> 'kind')::public.exception_kind,
         (e ->> 'start_from')::time, (e ->> 'start_to')::time,
         (e ->> 'day_type')::public.day_type, e ->> 'note'
  from jsonb_array_elements(coalesce(p_config -> 'exceptions', '[]'::jsonb)) e;

  -- Залы: upsert по key; порядок в конфиге = sort.
  for v_hall, v_hall_ord in
    select value, ordinality from jsonb_array_elements(p_config -> 'halls') with ordinality
  loop
    insert into public.halls (tenant_id, key, name, description, capacity_included, capacity_max,
      extra_guest_price, extra_guest_unit, min_duration_min, slot_step_min, buffer_min, photos,
      sort, is_active)
    values (v_tenant, v_hall ->> 'key', v_hall ->> 'name', coalesce(v_hall ->> 'description', ''),
      (v_hall ->> 'capacity_included')::integer, (v_hall ->> 'capacity_max')::integer,
      (v_hall ->> 'extra_guest_price_rub')::bigint * 100,
      coalesce(v_hall ->> 'extra_guest_unit', 'per_hour')::public.guest_price_unit,
      (v_hall ->> 'min_duration_min')::integer, (v_hall ->> 'slot_step_min')::integer,
      (v_hall ->> 'buffer_min')::integer, coalesce(v_hall -> 'photos', '[]'::jsonb),
      v_hall_ord::integer, true)
    on conflict (tenant_id, key) do update set
      name = excluded.name,
      description = excluded.description,
      capacity_included = excluded.capacity_included,
      capacity_max = excluded.capacity_max,
      extra_guest_price = excluded.extra_guest_price,
      extra_guest_unit = excluded.extra_guest_unit,
      min_duration_min = excluded.min_duration_min,
      slot_step_min = excluded.slot_step_min,
      buffer_min = excluded.buffer_min,
      photos = excluded.photos,
      sort = excluded.sort,
      is_active = true
    returning id into v_hall_id;

    -- Версии тарифа: по дате начала действия. Версию, по которой уже есть брони,
    -- менять и удалять нельзя — для новых цен добавляют новую версию с другой датой.
    for v_tv in select value from jsonb_array_elements(v_hall -> 'tariffs') loop
      select coalesce(jsonb_agg(jsonb_build_array(r ->> 'day_type', (r ->> 'from')::time,
               (r ->> 'to')::time, (r ->> 'price_per_hour_rub')::bigint * 100)
               order by r ->> 'day_type', (r ->> 'from')::time), '[]'::jsonb)
        into v_new_rules
      from jsonb_array_elements(v_tv -> 'rules') r;

      v_tv_id := null;
      select tv.id into v_tv_id
      from public.tariff_versions tv
      where tv.tenant_id = v_tenant and tv.hall_id = v_hall_id
        and tv.effective_from = (v_tv ->> 'effective_from')::date;

      if v_tv_id is null then
        insert into public.tariff_versions (tenant_id, hall_id, effective_from)
        values (v_tenant, v_hall_id, (v_tv ->> 'effective_from')::date)
        returning id into v_tv_id;
      else
        select coalesce(jsonb_agg(jsonb_build_array(tr.day_type::text, tr.from_time, tr.to_time,
                 tr.price_per_hour) order by tr.day_type::text, tr.from_time), '[]'::jsonb)
          into v_old_rules
        from public.tariff_rules tr
        where tr.tenant_id = v_tenant and tr.tariff_version_id = v_tv_id;

        if v_old_rules = v_new_rules then
          continue;
        end if;
        if exists (select 1 from public.bookings b
                   where b.tenant_id = v_tenant and b.tariff_version_id = v_tv_id) then
          raise exception using errcode = 'P0001', hint = 'TARIFF_VERSION_LOCKED',
            message = format('Зал «%s»: тариф от %s уже использован в бронях. Не меняйте его — добавьте новую версию с более поздней датой effective_from.',
                             v_hall ->> 'key', v_tv ->> 'effective_from');
        end if;
        delete from public.tariff_rules where tenant_id = v_tenant and tariff_version_id = v_tv_id;
      end if;

      insert into public.tariff_rules (tenant_id, tariff_version_id, day_type, from_time, to_time,
        price_per_hour)
      select v_tenant, v_tv_id, (r ->> 'day_type')::public.day_type, (r ->> 'from')::time,
             (r ->> 'to')::time, (r ->> 'price_per_hour_rub')::bigint * 100
      from jsonb_array_elements(v_tv -> 'rules') r;
    end loop;

    select string_agg(tv.effective_from::text, ', ' order by tv.effective_from) into v_locked
    from public.tariff_versions tv
    where tv.tenant_id = v_tenant and tv.hall_id = v_hall_id
      and not exists (select 1 from jsonb_array_elements(v_hall -> 'tariffs') t
                      where (t ->> 'effective_from')::date = tv.effective_from)
      and exists (select 1 from public.bookings b
                  where b.tenant_id = v_tenant and b.tariff_version_id = tv.id);
    if v_locked is not null then
      raise exception using errcode = 'P0001', hint = 'TARIFF_VERSION_LOCKED',
        message = format('Зал «%s»: тариф от %s уже использован в бронях — оставьте эту версию в business.json.',
                         v_hall ->> 'key', v_locked);
    end if;

    delete from public.tariff_versions tv
    where tv.tenant_id = v_tenant and tv.hall_id = v_hall_id
      and not exists (select 1 from jsonb_array_elements(v_hall -> 'tariffs') t
                      where (t ->> 'effective_from')::date = tv.effective_from);
  end loop;

  -- Зал, которого больше нет в конфиге, скрывается (брони и история остаются).
  select coalesce(jsonb_agg(jsonb_build_object('hall', s.key, 'future_bookings', s.cnt)), '[]'::jsonb)
    into v_warnings
  from (
    select h.key, count(b.id) as cnt
    from public.halls h
    join public.bookings b on b.tenant_id = h.tenant_id and b.hall_id = h.id
      and b.status in ('pending', 'confirmed') and b.start_at > now()
    where h.tenant_id = v_tenant and h.is_active
      and not exists (select 1 from jsonb_array_elements(p_config -> 'halls') x
                      where x ->> 'key' = h.key)
    group by h.key
  ) s;

  update public.halls h set is_active = false
  where h.tenant_id = v_tenant and h.is_active
    and not exists (select 1 from jsonb_array_elements(p_config -> 'halls') x
                    where x ->> 'key' = h.key);

  -- Допы: upsert по key, отсутствующие скрываются (в бронях хранится снимок цены).
  insert into public.extras (tenant_id, key, name, description, price, unit, max_qty, sort, is_active)
  select v_tenant, x.e ->> 'key', x.e ->> 'name', coalesce(x.e ->> 'description', ''),
         (x.e ->> 'price_rub')::bigint * 100, (x.e ->> 'unit')::public.extra_unit,
         (x.e ->> 'max_qty')::integer, x.ord::integer, true
  from jsonb_array_elements(coalesce(p_config -> 'extras', '[]'::jsonb)) with ordinality as x(e, ord)
  on conflict (tenant_id, key) do update set
    name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    unit = excluded.unit,
    max_qty = excluded.max_qty,
    sort = excluded.sort,
    is_active = true;

  update public.extras e set is_active = false
  where e.tenant_id = v_tenant and e.is_active
    and not exists (select 1 from jsonb_array_elements(coalesce(p_config -> 'extras', '[]'::jsonb)) x
                    where x ->> 'key' = e.key);

  -- Новая версия конфига — только если что-то изменилось (повторный publish идемпотентен).
  select cv.version, cv.config_hash into v_version, v_last_hash
  from public.tenant_config_versions cv
  where cv.tenant_id = v_tenant
  order by cv.version desc
  limit 1;

  v_changed := v_last_hash is distinct from p_config_hash;
  if v_changed then
    v_version := coalesce(v_version, 0) + 1;
    insert into public.tenant_config_versions (tenant_id, version, config, config_hash, published_by)
    values (v_tenant, v_version, p_config, p_config_hash, p_published_by);
    update public.tenants set config_version = v_version where id = v_tenant;
  end if;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant,
    'slug', v_slug,
    'status', v_status,
    'config_version', v_version,
    'changed', v_changed,
    'created', v_created,
    'hidden_halls_with_bookings', v_warnings
  );
end;
$$;

comment on function public.admin_publish_tenant(jsonb, text, boolean, text) is
  'Конвейер заведений: применить business.json. Только service role (tenant:publish, seed).';

revoke execute on function public.admin_publish_tenant(jsonb, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_publish_tenant(jsonb, text, boolean, text) to service_role;
