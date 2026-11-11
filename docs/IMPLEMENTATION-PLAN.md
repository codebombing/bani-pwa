# IMPLEMENTATION-PLAN — PWA бронирования бань и саун

Версия 1 — **local-first**: всё работает на Маке через локальный Supabase в Docker (`supabase start`). Облачный Supabase, Cloudflare и реальный LLM-ключ подключаются позже отдельным этапом «Перенос на сервер» (в конце документа) без переписывания кода.

Агент читает этот документ целиком до начала работы. Решения, записанные здесь, не переспрашивает.

---

## 0. Продукт в двух абзацах

Гость открывает ссылку `/s/{slug}/` заведения, выбирает зал → дату → время начала и длительность → число гостей и допы → оставляет имя и телефон. Видит итоговую цену (посчитанную сервером) и получает ссылку на свою бронь (токен). Без регистрации.

Владелец открывает `/s/{slug}/owner/`, входит по e-mail (Supabase Auth, без публичной регистрации) и видит календарь залов на день/неделю. За 2 нажатия вносит бронь, принятую по телефону или в мессенджере, блокирует зал (уборка, ремонт, своё мероприятие), отмечает задаток/оплату, видит статистику. Приложение — его единственный календарь.

## 1. Стек и решения (не переспрашивать)

| Область | Решение |
|---|---|
| Frontend | React 19, TypeScript strict, Vite, React Router (data router), TanStack Query, Zod |
| UI | **Astryx** (`@astryxdesign/core`, StyleX-сборка уже скомпилирована) — основная библиотека: `BottomSheet`, `Calendar`, `MobileNav`, `SegmentedControl`, `Dialog`, `DateInput`. **shadcn/ui — только для компонентов, которых нет в Astryx**, через Tailwind v4 bridge из `npx astryx docs styling-libraries`. Обёртывать shadcn в стили Astryx нельзя (так говорит документация Astryx: `npx astryx docs migration/component-migration`). Один Drawer/BottomSheet на всё приложение — Astryx `BottomSheet`. |
| Тема | Тёмная. Стартовая тема `@astryxdesign/theme-gothic` или `neutral` в dark mode — выбрать по `npx astryx theme list`; акцентный цвет приходит из `business.json` → `defineTheme({extends, ...})` на рантайме через CSS-переменные |
| PWA | `vite-plugin-pwa` в режиме `injectManifest`, свой `src/sw.ts` (Workbox) |
| Backend | Supabase local: Postgres 15+, Auth, Storage, Edge Functions (Deno), pg_cron, pg_net. Отдельного Node-сервера нет |
| Тесты | Vitest (unit), pgTAP через `supabase test db` (SQL), Vitest/Deno integration против локального стека, Playwright (e2e) |
| Хостинг статики | Готовность к Cloudflare Pages: `dist/` + `_redirects` + `_headers`. Локально: `npx wrangler pages dev dist` (без аккаунта) |
| Пакетный менеджер | npm, lockfile в git |
| Локаль | UI на русском, валюта RUB, timezone по умолчанию `Europe/Moscow` (из `business.json`) |
| Платежи v1 | Онлайн-эквайринга нет. Владелец вносит задаток/оплату вручную (наличные, перевод, карта на месте). Модель `payments` готова к будущему провайдеру (ЮKassa/Т-Банк) через поле `provider` |
| Уведомления v1 | Web Push (VAPID, ключи генерируются локально `npx web-push generate-vapid-keys`) + ICS. Telegram-бот владельца — после v1 |
| AI v1 | Провайдер OpenAI-совместимый по `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`. Без ключа AI-раздел показывает «AI недоступен», бронь работает. В тестах — **скриптованный тестовый провайдер, помеченный как тестовый**, а не «интеграция». Опционально локальная модель (Ollama/LM Studio) по `http://host.docker.internal:<port>/v1` |

### Команды Astryx (проверены 11.11.2026, версия 0.7.13)

```bash
npm install @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral @astryxdesign/theme-gothic @astryxdesign/cli
npx astryx init --all            # допишет блок правил в CLAUDE.md и AGENTS.md
npx astryx theme list
npx astryx theme add gothic      # или neutral; генерирует модуль тем
npx astryx component <Name>      # ПЕРЕД использованием любого компонента с незнакомыми props
npx astryx search <запрос>
npx astryx docs styling-overview # точные CSS-импорты
npx astryx docs styling-libraries tailwind   # cascade layers и мост к Tailwind v4
```

Внимание: пакет `astryx` в npm — пустая заглушка 0.0.0. Команда `npx astryx` работает только после установки `@astryxdesign/cli` в проект.

Известные ловушки Astryx (из обзоров): `Table` принимает `data`/`columns`, а не дочерние строки; `Switch` — `value`/`onChange`; у кнопок вариант `chromeless`, а не `ghost`; у триггера меню `startIcon`, а не `icon`. Не угадывать — читать `component <Name>`.

---

## 2. Модель данных (обзор)

Все зависимые таблицы содержат `tenant_id` и составной FK `(tenant_id, X_id) → X(tenant_id, id)`, чтобы строка одного заведения не могла сослаться на объект другого.

- `tenants` — slug, name, timezone, status (`preview` | `live` | `archived`), config_version, theme (accent и пр.), contacts, policy.
- `tenant_config_versions` — история опубликованных `business.json` (jsonb + hash).
- `tenant_members` — user_id, tenant_id, role (`owner` | `staff`). Создаётся только скриптом/сервисной ролью. Публичного signup нет (в `config.toml` `enable_signup = false`, владельцы приглашаются).
- `halls` — зал: name, description, capacity_included (гостей входит в цену), capacity_max, extra_guest_price, min_duration_min, slot_step_min, buffer_min (уборка/протопка), sort, is_active, photos.
- `working_hours` — по дням недели окна **моментов начала** брони (`start_from`, `start_to`, может переходить через полночь; `00:00–24:00` = круглосуточно). Отдельно `max_end_after_close_min` — насколько бронь может заканчиваться после последнего момента начала.
- `calendar_exceptions` — дата: закрыто / особые часы / тип дня (праздник = выходной тариф).
- `tariff_versions` + `tariff_rules` — версия тарифа зала действует с даты; правила: `day_type` (`weekday` | `weekend` | `holiday`), интервал времени суток (`from`, `to`, через полночь допускается — «ночь 22:00–08:00»), `price_per_hour`. Правила версии покрывают сутки без дыр (проверяет `tenant:validate`).
- `extras` — допы (веник, полотенца, чан, аренда простыней): price, unit (`per_booking` | `per_hour` | `per_guest`), max_qty.
- `bookings` — hall_id, start_at, end_at (timestamptz), guests, status (`pending` | `confirmed` | `completed` | `cancelled` | `no_show`), source (`online` | `phone` | `messenger` | `walk_in` | `owner`), customer_name, customer_phone, comment, `price_snapshot` jsonb (строки расчёта), `total_amount`, `tariff_version_id`, `version` int (растёт при переносе), `is_demo` bool, consent_at.
- `booking_extras` — снимок выбранных допов с ценой на момент брони.
- `resource_occupancies` — **единая таблица занятости**: hall_id, kind (`booking` | `block`), booking_id nullable, `occupied tstzrange`, active bool.
  `EXCLUDE USING gist (tenant_id WITH =, hall_id WITH =, occupied WITH &&) WHERE (active)` (нужен `btree_gist`).
  Для брони `occupied = [start_at, end_at + buffer)`; для блокировки `occupied = [from, to)`.
- `hall_blocks` — причина блокировки, кто поставил (ссылается на occupancy).
- `booking_access_tokens` — booking_id, `token_hash` (sha256), created_at, revoked_at. Сам токен в БД не хранится.
- `idempotency_keys` — tenant_id, key, request_hash, booking_id, created_at (TTL 24 ч).
- `payments` — booking_id, kind (`deposit` | `payment` | `refund`), amount, method (`cash` | `transfer` | `card` | `online`), provider, received_at, created_by, is_demo.
- `push_subscriptions` — tenant_id, scope (`guest` booking_id | `owner` user_id), endpoint, keys.
- `notification_jobs` — outbox: kind, booking_id, booking_version, run_at, `dedupe_key unique`, status (`pending` | `leased` | `sent` | `skipped` | `failed` | `simulated`), lease_until, attempts, last_error.
- `rate_limit_buckets` — key, window_start, count. Функция `consume_rate_limit(key, limit, window)` атомарно (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`).
- `llm_usage` — tenant_id, day, requests, tokens; функция `consume_llm_budget` атомарно с лимитом на tenant и глобально.
- `audit_log` — кто/что изменил в броне.

### Доступ
- RLS включён на всех таблицах. `anon` — **никаких** прямых SELECT к персональным данным, платежам, токенам. Публичные данные (заведение, залы, тарифы, допы, фото) — через view/функции с минимальным набором полей.
- Все изменения броней — через `SECURITY DEFINER` функции с `SET search_path = ''`, вызываемые из Edge Functions. Клиент никогда не передаёт цену, tenant_id и end_at (только `duration_min`, валидируется по шагу и минимуму).
- `authenticated` видит строки только своих tenant через `tenant_members` (функция `is_member(tenant_id)`).
- `REVOKE ALL ... FROM anon, authenticated` по умолчанию, затем точечные `GRANT`.

---

## 3. Правила бронирования (проверяются тестами)

1. Длительность ≥ `min_duration_min` и кратна `slot_step_min`.
2. Момент начала попадает в окно `working_hours` своего дня (по локальному времени заведения) и не попадает в закрытую дату `calendar_exceptions`. Окно, начавшееся вечером, продолжается после полуночи и принадлежит **дню начала окна**.
3. Конец ≤ последний момент начала + `max_end_after_close_min` (для круглосуточного ограничения нет).
4. Занятость = `[start, end + buffer)`; пересечение с активной занятостью этого зала отклоняется constraint'ом (а не только проверкой в коде) — это даёт защиту от гонок.
5. Гостей ≤ `capacity_max`.
6. Цена: интервал режется на куски по `slot_step_min`; каждый кусок тарифицируется правилом, действующим в **локальный момент начала куска** (тип дня — по локальной дате куска, праздник из `calendar_exceptions` = `holiday`, если правила holiday нет — `weekend`). + `extra_guest_price × max(0, guests − capacity_included) × часы` (единица задаётся в зале: за час или за бронь) + допы. Результат и строки расчёта сохраняются в `price_snapshot`; изменение тарифа не меняет старые брони (историческая цена).
7. Все даты считаются через timezone заведения. Тест с `Europe/Berlin` (переход на летнее/зимнее время) обязателен, даже если реальные заведения в Москве.

### Создание брони (одна SQL-транзакция)
`public_create_booking(slug, hall_id, start_at, duration_min, guests, extras[], customer, consent, idempotency_key, request_hash)`:
1. `consume_rate_limit` по IP/телефону (IP передаёт Edge Function).
2. Если `idempotency_key` уже есть: тот же `request_hash` → вернуть тот же booking_id; другой → ошибка `IDEMPOTENCY_CONFLICT`.
3. Валидация правил 1–5, расчёт цены (правило 6) на сервере.
4. INSERT booking + occupancy (constraint отбивает гонку → ошибка `SLOT_TAKEN`) + токен-хэш + outbox-задачи.

**Токен и повторная выдача при retry:** Edge Function вычисляет `token = base64url(HMAC_SHA256(BOOKING_TOKEN_SECRET, booking_id + ':' + idempotency_key))`, в БД кладёт только `sha256(token)`. При повторе с тем же ключом функция получает тот же booking_id и вычисляет тот же токен — ничего секретного в БД не хранится.

### Перенос
`reschedule_booking(...)` — в одной транзакции: деактивировать старую occupancy, вставить новую, пересчитать цену **по исходной версии тарифа или новой — по флагу политики заведения** (по умолчанию: новая цена, если меняется день/время; задаток сохраняется), `version += 1`, перепланировать outbox. При конфликте — исключение, транзакция откатывается, исходная бронь цела (тест обязателен).

### Отмена
Деактивирует occupancy, `status = cancelled`, задачи outbox по этой брони → `skipped`, создаётся уведомление об отмене. Повторная отмена идемпотентна.

### Владелец
- `owner_quick_booking` — те же правила, но source `phone|messenger|walk_in`, можно без телефона (только имя/пометка), можно вручную задать цену **только владельцу** с пометкой `manual_price` в снимке.
- `owner_block_hall(hall_id, from, to, reason)` — occupancy kind `block`.
- `owner_add_payment(booking_id, kind, amount, method)`.

---

## 4. Статистика (только SQL)

Функция `owner_stats(tenant_id, from_date, to_date)` в timezone заведения; UI и AI вызывают одну и ту же функцию с одинаковым периодом.

- **Брони созданы** — count по `created_at` в периоде.
- **Визиты состоялись** — `completed` со `start_at` в периоде (+ сумма по снимку).
- **Получено денег** — сумма `payments` (deposit + payment − refund) по `received_at` в периоде; отдельно сколько из них задатки.
- **Ожидается** — сумма будущих активных броней минус уже полученное по ним. Подпись в UI: «ожидается», не «выручка».
- Загрузка залов, %: занятые часы / доступные часы окна.
- Отмены и no-show.

---

## 5. Конвейер заведений

```
tenants/
  _template/business.json
  <slug>/business.json
  <slug>/images/{logo.png, icon-512.png, icon-maskable-512.png, halls/<hall-key>/*.jpg, splash.jpg}
```

`business.json` — валидируется Zod-схемой `src/shared/business-schema.ts` (общая для скриптов и приложения). Содержит: slug, name, timezone, accent, contacts (телефон, Telegram, адрес, координаты), правила (политика отмены, задаток), halls с тарифами/допами/часами, исключения, тексты.

Скрипты (`package.json`, исполняются через `tsx`):

| Команда | Что делает |
|---|---|
| `npm run tenant:new -- <slug>` | копирует `_template` в `tenants/<slug>`, подставляет slug |
| `npm run tenant:validate -- <slug>` | Zod + бизнес-проверки: тарифы покрывают сутки, min кратна шагу, вместимость, размеры и форматы иконок (512, maskable с safe zone), наличие фото у залов |
| `npm run tenant:publish -- <slug> [--live]` | upsert заведения в БД (service role, только локально/CI), новая `tenant_config_version`, загрузка картинок в Storage `tenant-assets/<tenant_id>/config/...`, генерация статической оболочки `dist/s/<slug>/` (index.html с метаданными, manifest, иконки, startup images, sw). **Не трогает** брони, платежи и фото владельца (`tenant-assets/<tenant_id>/owner/...`). `--live` разрешён только если validate без ошибок и есть хотя бы один член с ролью owner; иначе остаётся `preview` |
| `npm run tenant:verify -- <slug>` | проверяет: строка в БД, публичная availability отвечает, manifest (id/start_url/scope = `/s/<slug>/`), иконки существуют, глубокая ссылка `/s/<slug>/hall/...` отдаёт HTML с title заведения, ранее опубликованные tenants по-прежнему отвечают |

Демо-данные (брони, платежи) — в `supabase/seed.sql` с `is_demo = true`. Бизнес-названия есть только в `tenants/*` и `seed.sql`, **не в `src/`**.

### Демо-заведения (seed)
1. `demo-banya` — банный комплекс, timezone Europe/Moscow, работает 10:00–02:00 (моменты начала 10:00–23:00, конец до 02:00). Залы:
   - «Малый зал»: русская парная на дровах, комната отдыха; включено 4 гостя, максимум 6; min 2 ч, шаг 1 ч, буфер 60 мин (протопка). Тариф: будни 2 500 ₽/ч, выходные 3 200 ₽/ч, ночь 22:00–02:00 — 3 500 ₽/ч. Сверх 4 гостей — 400 ₽/чел/ч.
   - «Большой зал»: парная, купель, бильярд; включено 8, максимум 14; min 3 ч, шаг 1 ч, буфер 60 мин. Будни 4 000, выходные 5 000, ночь 5 500 ₽/ч. Сверх 8 — 500 ₽/чел/ч.
   - Допы: веник дубовый 600 ₽/шт, комплект полотенец 300 ₽/гость, чан на дровах 3 000 ₽/бронь.
   - Задаток 30 %, отмена без потери задатка за 24 ч.
2. `demo-sauna24` — круглосуточная сауна, Europe/Moscow, 00:00–24:00 каждый день. Один зал «Сауна с бассейном»: включено 4, максимум 8, min 2 ч, шаг 30 мин, буфер 30 мин. Будни 1 800 ₽/ч, выходные 2 400 ₽/ч, ночь 00:00–08:00 — 2 000 ₽/ч. Сверх 4 — 300 ₽/чел/ч. Допы: караоке 1 000 ₽/бронь, простыни 150 ₽/гость. Другой акцент, другие иконки — для проверки изоляции и «переодевания».

Цифры демонстрационные.

---

## 6. PWA для каждого заведения

- Один билд `dist/` (общие JS/CSS с хэшами). `tenant:publish` генерирует для каждого slug: `dist/s/<slug>/index.html` (title, description, theme-color, `apple-touch-icon`, `apple-touch-startup-image`, og-теги, `<link rel=manifest>`), `manifest.webmanifest` (`id`, `start_url`, `scope` = `/s/<slug>/`, `display: standalone`, icons any + maskable), копию `sw.js` по пути `/s/<slug>/sw.js` (scope ограничен заведением).
- Service worker читает slug из `self.location`; имена кэшей `bani-<slug>-static-v<N>`, `bani-<slug>-public-v<N>`. Кэширует только статику и публичные данные. **Запросы владельца и токен-брони — NetworkOnly**, никогда не кэшируются. На logout владельца: `queryClient.clear()`, удаление owner-данных из IndexedDB/sessionStorage, сообщение SW не держит приватного.
- `_redirects` для Cloudflare Pages: `/s/:slug/*  /s/:slug/index.html  200`. Локально проверять через `npx wrangler pages dev dist`.
- iPhone: push работает только после «На экран Домой» (iOS 16.4+). В обычной вкладке Safari показываем инструкцию установки, а не кнопку «включить уведомления».

## 7. Уведомления

- Outbox `notification_jobs`: при создании брони — подтверждение владельцу и гостю, напоминание гостю за 24 ч и за 2 ч; при переносе — старые задачи `skipped`, новые с `dedupe_key = <booking_id>:<version>:<kind>`; при отмене — `skipped` + уведомление об отмене.
- Воркер — Edge Function `notify-worker`, вызывается pg_cron раз в минуту через pg_net. Захват: `UPDATE ... SET status='leased', lease_until=now()+'2 min' WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING *`. Перед отправкой проверяет, что бронь активна и `version` совпадает. Протухший lease подхватывается снова. Ретраи с backoff, после N попыток `failed`.
- Tenant в `preview` → статус `simulated`, реальная отправка не выполняется.
- ICS: ссылка `/functions/v1/public-api/booking/<token>.ics`; в UI честный статус «добавлено в календарь — проверьте приложение календаря» (подтверждения от ОС нет).

## 8. AI-ассистент

- Edge Function `ai-chat`, два режима: `guest` (по slug, опционально токен брони) и `owner` (JWT + членство).
- Инструменты гостя: `check_availability(hall, date, duration)`, `quote(...)`, `get_my_booking()` (только по токену из сессии). Инструменты владельца: `day_schedule(date)`, `stats(from, to)`, `find_booking(query)`. Набор инструментов выбирает сервер по режиму; модель не видит инструменты чужого режима.
- `tenant_id` и SQL модель не задаёт: аргументы проходят Zod, tenant берётся из маршрута/JWT.
- Роутер: если вопрос про брони/свободное время/цены/статистику — сервер **сначала** выполняет подходящий инструмент детерминированно и кладёт результат в контекст, затем модель формулирует ответ. Tool loop ограничен 4 итерациями. Если модель не поддерживает tool calling — fallback: модель возвращает JSON `{intent, args}`, валидируемый Zod.
- Бюджет: `consume_llm_budget` до вызова модели; при исчерпании или ошибке провайдера — вежливый отказ + кнопка «забронировать вручную».
- Роутер тестируется отдельно на наборе фраз (fixtures), без сети.

---

## Этапы

После каждого этапа: запустить проверки этапа, обновить `PROGRESS.md` (что сделано, какие команды запускались и с каким результатом, что осталось), сделать git commit. Не переходить к следующему этапу с красными проверками.

### Этап 1. Каркас
- `git init` (если нет), `.gitignore`, Vite + React 19 + TS strict (`noUncheckedIndexedAccess`), ESLint, Prettier, Vitest. `package.json` уже существует — дополнить, не перезаписывать.
- Установить Astryx (команды выше), `astryx init --all`, выбрать тёмную тему, подключить `Theme`, проверить CSS-импорты по `astryx docs styling-overview`.
- Tailwind v4 — только если понадобится shadcn; если подключается — порядок cascade layers по `astryx docs styling-libraries tailwind`, токены Tailwind = токены Astryx.
- React Router: `/s/:slug/*` (гость), `/s/:slug/owner/*` (владелец), `/` — служебная страница списка demo-ссылок только в dev.
- `supabase init`, `config.toml` (signup выключен, inbucket/mailpit для писем), `supabase start`.
- Zod-схема `business.json`, шаблон `tenants/_template`.
- `vite-plugin-pwa` injectManifest с пустым `src/sw.ts`.
- `.env.example`.
- **Проверка:** `npm run typecheck && npm run lint && npm test && npm run build`, `supabase status`.

### Этап 2. Схема и доступы
- Миграции: расширения (`btree_gist`, `pgcrypto`, `pg_cron`, `pg_net`), таблицы, составные FK, EXCLUDE, индексы, RLS, GRANT/REVOKE, функции `is_member`, `consume_rate_limit`, `consume_llm_budget`.
- pgTAP: anon не читает bookings/payments/tokens/push; owner tenant A не видит tenant B; составной FK не даёт сослаться на зал другого tenant; EXCLUDE ловит пересечение.
- **Проверка:** `supabase db reset && supabase test db`.

### Этап 3. Бронирование в SQL
- Функции: `get_availability`, `quote_booking`, `public_create_booking`, `get_booking_by_token_hash`, `reschedule_booking`, `cancel_booking`, `owner_quick_booking`, `owner_block_hall`, `owner_add_payment`, `owner_stats`.
- pgTAP-тесты: два зала независимы; бронь через полночь; минимальная длительность и шаг; буфер между гостями (стык допускается только после буфера); блокировка зала; круглосуточный режим; закрытая дата; тариф будни/выходные/ночь и смешанная бронь (вечер+ночь); доплата за гостей; допы; историческая цена после смены тарифа; перенос успешный и неуспешный (исходная бронь цела); отмена идемпотентна; идемпотентность создания (тот же ключ/другой body); платежи и задатки в `owner_stats`; DST на `Europe/Berlin`.
- Конкурентный тест: скрипт `tests/integration/concurrency.test.ts` — 20 параллельных подключений бронируют один слот, ровно 1 успех, 19 `SLOT_TAKEN`.
- **Проверка:** `supabase test db`, `npm run test:integration`.

### Этап 4. Конвейер и API
- Скрипты `tenant:new/validate/publish/verify`, seed с двумя demo-tenant (опубликовать оба через `tenant:publish`), `seed.sql` с demo-бронями.
- Edge Functions: `public-api` (tenant info, availability, quote, create, booking by token, cancel/reschedule by token, ICS), `owner-api` (JWT → membership на сервере), общая библиотека `_shared` (Zod, ошибки, rate limit, CORS, HMAC токена).
- Integration-тесты HTTP против `supabase functions serve`: создание + retry возвращает тот же токен; чужой токен → 404; owner tenant A → 403 на tenant B; rate limit срабатывает.
- **Проверка:** `npm run tenant:validate -- demo-banya && npm run tenant:verify -- demo-banya` (и для sauna24), `npm run test:integration`.

### Этап 5. Гостевой PWA
- Экраны: заведение (фото залов, кнопка «Забронировать»), шаги в одной последовательной `BottomSheet`: зал → дата (Calendar, недоступные дни серые) → время начала + длительность (чипы, видна цена) → гости и допы → контакты (имя, телефон с маской +7, согласие на обработку ПДн со ссылкой на политику заведения) → подтверждение. Страница брони по токену: статус, ICS, перенос, отмена, push (с честной логикой iOS).
- Каждый сетевой экран: loading (скелетоны), error (с повтором), empty, success. Back закрывает шаг, а не приложение; фокус переходит на заголовок шага; `prefers-reduced-motion`; safe-area insets; поле ввода не перекрывается клавиатурой (`visualViewport`).
- Playwright (Chromium + mobile emulation): установить `npx playwright install chromium`.
- **Проверка:** unit + Playwright сценарий гостя до экрана «Бронь подтверждена».

### Этап 6. Кабинет владельца
- Вход по magic link (локально письма в Mailpit/Inbucket `http://127.0.0.1:54324`). Скрипт `npm run owner:invite -- <slug> <email>` создаёт пользователя и членство.
- Нижняя навигация: Календарь / Брони / Статистика / Ещё. Календарь: день по залам (свайп по дням), неделя. Тап по пустому слоту → bottom sheet быстрой брони (предзаполнены зал, время, мин. длительность; имя/телефон необязательны, источник: телефон/мессенджер) — 2 нажатия до сохранения. Тап по брони → детали, перенос, отмена, «Отметить задаток/оплату», «Гости пришли» (completed), no-show. Блокировка зала. Статистика с выбором периода.
- Logout очищает кэш.
- **Проверка:** Playwright полный сценарий: гость бронирует → владелец входит → бронь видна в календаре → владелец отмечает задаток → статистика показывает «получено» = задаток, «ожидается» = остаток.

### Этап 7. PWA-изоляция, push, ICS
- Генерация оболочек tenant в `tenant:publish`, `_redirects`, `_headers` (no-cache для html/sw), отдельные scope и кэши.
- VAPID, подписка гостя и владельца, outbox + `notify-worker`, pg_cron job в миграции. Preview → `simulated`.
- Тесты outbox: дедупликация, lease и повторный захват, перенос перепланирует, отмена гасит, preview не шлёт.
- **Проверка:** `npm run build && npm run tenant:publish -- demo-banya && npm run tenant:publish -- demo-sauna24 && npx wrangler pages dev dist` + `tenant:verify` обоих; Lighthouse PWA/installability на обоих slug; тесты outbox.

### Этап 8. AI, финальная приёмка, документация
- `ai-chat`, роутер, инструменты, бюджет, fallback; тесты scopes (гость не может вызвать owner tool, owner A не видит B), тесты роутера на fixtures, тест «AI недоступен → бронь работает».
- Документы: `SETUP.md` (локальный запуск, переменные, cron, публикация), `CLONE-IN-6-MINUTES.md` (новое заведение: new → заполнить json и картинки → validate → publish → verify → invite owner → live), `ACCEPTANCE.md` (таблица: проверка → команда → результат → дата; отдельный список того, что не проверено и почему).
- **Проверка:** полный прогон: `npm run check:all` (typecheck, lint, unit, `supabase test db`, integration, e2e, tenant:verify для всех).

---

## Перенос на сервер (после v1, отдельной сессией)

Код не меняется — меняются только переменные и цели деплоя.

**Важно для РФ (152-ФЗ):** телефоны и имена гостей — персональные данные граждан РФ; первичный сбор и хранение должны быть в базах на территории России. Облачный Supabase (регионы AWS) этому не соответствует. Варианты:
- для продажи российским заведениям — self-hosted Supabase (Docker Compose) на российском VPS (Yandex Cloud, Selectel, Timeweb Cloud): те же миграции и функции;
- облачный Supabase — только для демо без реальных клиентов.

Шаги (облако или self-hosted):
1. `supabase link` / настройка self-hosted, `supabase db push`, `supabase functions deploy`, `supabase secrets set` (VAPID, BOOKING_TOKEN_SECRET, LLM_*, SERVICE_ROLE только на сервере).
2. pg_cron job указывает на боевой URL функций.
3. Статика: Cloudflare Pages (`dist/`) или nginx на том же VPS (повторить правила `_redirects`/`_headers`). Перед продажей проверить доступность выбранного хостинга из российских сетей.
4. `tenant:publish` против боевой БД, `tenant:verify`, ручная проверка установки на реальных iPhone и Android.
5. Реальный LLM-ключ (российский провайдер для клиентских данных — YandexGPT/GigaChat через OpenAI-совместимый шлюз, если нужно соблюсти локализацию).
