# PROGRESS

## Этап 0 — подготовка (11.11.2026)
- Установлены скилы в `.claude/skills/`: ui-ux-pro-max (+ banner-design, brand, design, design-system, slides, ui-styling), supabase, supabase-postgres-best-practices, shadcn, playwright-cli. Источники и хэши — `skills-lock.json`.
- MCP Astryx: добавляется пользователем командой из SETUP-MAC.md (создаст `.mcp.json`).
- Написаны `docs/IMPLEMENTATION-PLAN.md`, `AGENTS.md`, `CLAUDE.md`, `PROMPT.md`, `SETUP-MAC.md`.
- `package.json` — заготовка, приложение ещё не создано.
- Следующее: этап 1.

## Окружение машины (11.11.2026)
- Mac на Apple Silicon, но Homebrew — Intel-версия в `/usr/local` (Rosetta, Tier 3, без bottles). Поэтому через brew ничего не ставим.
- Node 22.23.5 — официальный архив arm64 в `~/.local/node-22` (SHA256 сверен), PATH через `~/.zprofile`. Системный Node 20 (`/usr/local/bin/node`) не тронут.
- Docker — OrbStack 2.2.5 arm64 (Intel-сборка из brew cask удалена: под Rosetta движок не стартует).
- Supabase CLI 3.1.0 — npm devDependency проекта, запуск `npx supabase ...` (в package.json-скриптах просто `supabase`, npm подставляет node_modules/.bin).

## Этап 1 — каркас (11.11.2026) ✅
Сделано:
- `git init`, Vite 8 + React 19 + TypeScript 6 strict (`noUncheckedIndexedAccess`), project references: `tsconfig.app.json` (src), `tsconfig.sw.json` (WebWorker, `src/sw.ts`), `tsconfig.node.json` (конфиги, scripts, tests).
- ESLint 10 (typescript-eslint strict, react-hooks, `no-explicit-any: error`), Prettier, Vitest 5 + jsdom + Testing Library.
- Astryx 0.7.13: `@astryxdesign/core`, `@stylexjs/stylex`, `@astryxdesign/theme-neutral`, CLI — devDependency. `npx astryx init --all` дописал блок в CLAUDE.md/AGENTS.md (и создал GEMINI.md, theme.template.ts). Тема — **neutral** (тёплые серые, maintained) в `mode="dark"`; gothic отвергнута — холодные сине-серые. `npx astryx theme add neutral` → `src/astryx-themes.ts`. CSS-импорты по `astryx docs styling-overview` (plain path): reset.css, astryx.css, theme.css (через модуль тем). Tailwind/shadcn не подключались — пока не нужны.
- React Router 8 data router: `/` (служебная страница), `/s/:slug/*` (гость), `/s/:slug/owner/*` (владелец), 404, errorElement. `LinkProvider` с Link роутера.
- TanStack Query, клиент Supabase (`src/shared/supabase.ts`, env через Zod `src/shared/env.ts`; только `VITE_SUPABASE_URL` + publishable key).
- Zod-схема `src/shared/business-schema.ts` (slug, timezone IANA, тема, контакты, legal/политика ПДн, policy, окна моментов начала по дням недели, max_end_after_close, залы с версиями тарифов, допы, исключения календаря) + проверка покрытия суток тарифом (`checkTariffCoverage`). Шаблон `tenants/_template/business.json`.
- `vite-plugin-pwa` 2.0 injectManifest, `manifest: false` (манифесты по заведениям — tenant:publish), минимальный `src/sw.ts` с precache.
- `supabase init`, `config.toml`: `enable_signup = false`, site_url/redirects на localhost:5173/4173/8788, Mailpit на 54324. `supabase start` поднят.
- `.env.example` (без секретов), `.env` локально (в .gitignore).

Проверки (фактический результат):
- `npm run typecheck` — ок, 0 ошибок.
- `npm run lint` — ок, 0 предупреждений.
- `npm test` — 1 файл, 9 тестов, все зелёные.
- `npm run build` — ок, `dist/index.html`, `dist/sw.js` (precache 3 записи). Предупреждение о размере чанка >500 kB (Astryx целиком) — разбиение по маршрутам на этапе 5.
- `npx supabase status` — стек запущен (API 54321, DB 54322, Studio 54323, Mailpit 54324).
- Ручная проверка: `npm run dev`, `/s/demo-banya/owner/` рендерит тёмную тему Astryx, ошибок в консоли нет.
- `npm audit --omit=dev` — 0 уязвимостей; 15 moderate/low только в dev-инструментах (eslint/minimatch, workbox-build/glob), исправление только `--force` с понижением мажоров — не применяли.

## Этап 2 — схема и доступы (11.11.2026) ✅
Сделано (`supabase/migrations/`, 7 файлов):
- `extensions_and_helpers` — btree_gist, pgcrypto, pg_net (schema extensions), pg_cron; схема `private` (не публикуется); enum-типы; `private.is_valid_timezone`, `private.set_updated_at`; `alter default privileges` — новые объекты public закрыты для anon/authenticated.
- `tenants_and_members` — `tenants` (slug, timezone с CHECK, status preview/live/archived, theme/texts/contacts/legal/pwa jsonb, правила: max_end_after_close_min, deposit_percent, free_cancellation_hours, reschedule_pricing), `tenant_config_versions` (jsonb + sha256), `tenant_members` (FK на auth.users). RLS-хелперы `private.is_member`, `private.has_role`, `private.is_public_tenant` (SECURITY DEFINER, `search_path = ''`, проверка через `auth.uid()`).
- `catalog` — `halls` (деньги — копейки bigint, CHECK min кратна шагу, шаг кратен 15), `working_hours` (окна моментов начала, ISO weekday, через полночь), `calendar_exceptions`, `tariff_versions` + `tariff_rules`, `extras`. Везде `unique (tenant_id, id)` и составные FK `(tenant_id, X_id)`.
- `bookings_and_occupancy` — `bookings` (CHECK: онлайн-бронь требует телефон и consent_at; end > start), `booking_extras` (снимок цены), `resource_occupancies` с `EXCLUDE USING gist (tenant_id =, hall_id =, occupied &&) WHERE (active)` + уникальная активная занятость на бронь, `hall_blocks`, `booking_access_tokens` (только sha256, 32 байта), `idempotency_keys`, `payments` (provider для будущего эквайринга), `audit_log`. Индексы на все FK.
- `notifications` — `push_subscriptions` (guest по брони / owner по user_id), `notification_jobs` (outbox: dedupe_key unique, lease_until, attempts, partial-индекс для захвата).
- `limits_and_usage` — `rate_limit_buckets` + `consume_rate_limit(key, limit, window)` (один `INSERT … ON CONFLICT DO UPDATE … RETURNING`, окна `date_bin`); `llm_usage` + `llm_usage_global` + `consume_llm_budget(tenant, tokens, tenant_limit, global_limit)` — оба счётчика атомарно, при отказе ничего не списывается. EXECUTE только у service_role.
- `access_rls_grants` — RLS на всех 22 таблицах; `REVOKE ALL` у anon/authenticated; anon — SELECT публичного каталога только для preview/live; authenticated — каталог + SELECT данных своих заведений через `private.is_member`; прямой записи нет ни у кого, кроме service_role. Без единого GRANT: booking_access_tokens, idempotency_keys, rate_limit_buckets, llm_usage_global. Представления `public_tenants`, `public_halls`, `public_extras` (`security_invoker = true`, минимум полей).
- Фронт: dev-страница `/` читает `public_tenants` (loading/error с повтором/empty/success); `src/shared/db.types.ts` сгенерирован (`npm run db:types`).

pgTAP (`supabase/tests/database/`, 86 тестов):
- `01_schema_security` (29) — расширения, RLS везде, нет прав anon на приватные таблицы, authenticated не пишет напрямую и не создаёт членство, функции лимитов только service_role, EXCLUDE существует, представления security_invoker, у SECURITY DEFINER задан search_path.
- `02_tenant_isolation` (26) — anon получает 42501 на bookings/payments/tokens/push/members/occupancies; anon видит каталог preview/live, архив скрыт; owner A не видит данные B (даже с явным фильтром), не вставляет бронь напрямую, не добавляет себя в B; owner B — только своё; не-член не видит ничего приватного.
- `03_integrity` (17) — составные FK отбивают ссылки на зал/версию тарифа/доп/бронь чужого заведения (23503); EXCLUDE: пересечение 23P01, стык [10,13)+[13,15) допускается, другой зал допускается, неактивная занятость не мешает, повторная активация пересечения 23P01, вторая активная занятость брони 23505; CHECK: пустой интервал, booking без booking_id, онлайн без согласия, конец раньше начала, неизвестная timezone, min не кратна шагу.
- `04_limits` (14) — rate limit 3/окно (4-й false, другой ключ отдельно), бюджет LLM по заведению и глобально без частичного списания, anon не вызывает функции.

Проверки (фактический результат):
- `npx supabase db reset && npx supabase test db` — 7 миграций применены; Files=4, Tests=86, Result: PASS.
- `npx supabase db advisors --level warn` — No issues found. На уровне info: «unused index» (БД пустая) и «RLS enabled, no policy» для 4 служебных таблиц (намеренно); единственный unindexed FK (`hall_blocks (tenant_id, occupancy_id)`) исправлен индексом.
- REST под publishable-ключом: `public_tenants` → 200 `[]`; `bookings`, `payments`, `booking_access_tokens` → 42501.
- `npm run typecheck && npm run lint && npm test && npm run build` — всё зелёное (9 unit-тестов).

Следующее: этап 3 — SQL-функции бронирования (`get_availability`, `quote_booking`, `public_create_booking`, перенос/отмена, owner-функции, `owner_stats`) и их pgTAP + конкурентный integration-тест.

## Этап 3 — бронирование в SQL (11.11.2026) ✅
Сделано (`supabase/migrations/`, 4 файла):
- `booking_rules` — `private.start_window` (окно моментов начала дня, через полночь принадлежит дню начала, `last_end` = окно + max_end_after_close, круглосуточно — без ограничения), `private.check_slot` (правила 1–5: min/шаг/≤ 24 ч, гости, окно сегодня или вчерашнее ночное, сетка шага от начала окна, конец до закрытия), `private.day_type_for` (исключение day_type → сб/вс → будни), `private.tariff_version_for` (версия на локальную дату начала), `private.compute_quote` (куски по slot_step_min, тариф по ЛОКАЛЬНОМУ началу куска, holiday без правил → weekend, доплата за гостей per_hour/per_booking, допы per_booking/per_hour/per_guest с проверками, задаток %, снимок со строками). Ошибки — `{ok:false, error, message}`, не исключения.
- `booking_create` — `private.create_booking` (ядро: идемпотентность, проверки, цена, вложенный блок: idempotency_key → booking → booking_extras → occupancy `[start, end+buffer)` → token_hash → outbox → audit; `exclusion_violation` → `SLOT_TAKEN`, параллельный тот же ключ → replay), `public.public_create_booking` (service_role; Edge Function передаёт свой booking_id и sha256 токена HMAC(booking_id:key); advisory-lock по ключу, replay без трат лимита, rate limit IP 10/10 мин и телефон 5/ч считается и для отказов, согласие ПДн, формат телефона; брони preview-заведения помечаются is_demo), `public.get_availability` (свободные моменты дня с ценой), `public.quote_booking` (те же правила + `available`), outbox `private.enqueue_notifications` (dedupe `<id>:<version>:<kind>:<recipient>`, напоминания за 24 ч и 2 ч только в будущем), `private.skip_pending_jobs`, `private.audit`, `private.booking_json`.
- `booking_manage` — по токену (service_role, slug + sha256): `get_booking_by_token_hash`, `cancel_booking_by_token`, `reschedule_booking_by_token`; владелец (authenticated, членство через `auth.uid()` внутри): `owner_quick_booking` (телефон необязателен, источник phone/messenger/walk_in/owner, ручная цена с `manual_price`, прошлое время допускается, идемпотентность по ключу), `owner_cancel_booking`, `owner_reschedule_booking`, `owner_set_booking_status` (completed/no_show/confirmed), `owner_block_hall`/`owner_unblock_hall` (та же occupancy и EXCLUDE), `owner_add_payment` (deposit/payment/refund, возврат ≤ полученного). Перенос: деактивация старой занятости + новая + пересчёт цены (политика `reschedule_pricing`: current/original; ручная цена сохраняется) + version+1 + перепланирование outbox во вложенном блоке — конфликт откатывает блок целиком. Отмена идемпотентна, гасит outbox, ставит уведомление об отмене.
- `owner_stats` — один SQL на период локальных дат: брони созданы / визиты состоялись (+ сумма по снимку) / получено (задатки + оплаты − возвраты, отдельно задатки и возвраты) / ожидается (будущие активные минус полученное) / отмены / no-show / загрузка залов (занятые часы без буфера / часы окна, по залам).
- Integration: `pg` + `tests/integration/db.ts` (подключение, фикстура, вызов как у Edge Function, Zod-разбор ответа), `vitest.integration.config.ts`, скрипт `npm run test:integration`.

Найдено и исправлено по ходу:
- Одновременные повторы с одним ключом тратили rate limit и получали RATE_LIMITED → добавлен `pg_advisory_xact_lock` по (tenant, ключ) до проверки лимитов; integration-тест покрывает.
- Ловушка тестов: `is(NULL, NULL)` проходит — в pgTAP добавлены явные предусловия «бронь/платёж созданы». PL/pgSQL кэширует проверку EXECUTE в «простых выражениях» после смены роли — проверка прав вызывается напрямую, а не через хелпер.

Тесты:
- `05_booking_rules` (69): два зала независимы; min/шаг/сетка/до открытия/00:00 вне окна/конец после закрытия; через полночь (3 ч ночи = 10 500 ₽, конец 02:00); смешанная бронь день+ночь (2 строки снимка); суббота день+ночь; буфер (встык нельзя, 10–12 нельзя из-за собственного буфера, после буфера можно, upper(occupied) = конец + буфер); 24/7 (ночь, вс→пн через смену типа дня, шаг 30 мин, 2,5 ч); закрытая дата (DAY_CLOSED) при валидной ночи накануне; праздник → тариф выходных; доплата за гостей; допы (сумма, снимок, задаток 30 %, лимиты qty, чужой доп); историческая цена после новой версии тарифа; идемпотентность (replay, тот же booking_id, без дубля, конфликт тела); согласие ПДн, формат телефона, прошлое, чужой slug/зал; rate limit по IP (10 отказов + 11-я RATE_LIMITED, другой IP проходит); доступность (9 слотов после брони с буфером, первый 15:00, ночной слот по ночному тарифу, closed, 48 слотов 24/7, неверная длительность, quote available=false); DST Europe/Berlin весной и осенью (цена 3 ч, местное время конца, 23 и 25 моментов в сутках, 180 минут в снимке); outbox 4 задачи, хэш токена, is_demo=false для live.
- `06_booking_manage` (60): токен (своя бронь / чужой slug / неверный токен → NOT_FOUND); перенос успешный (version 2, цена выходного дня, одна активная занятость на новом времени, старая деактивирована, outbox v1 погашен, v2 поставлен, слот освободился); перенос неуспешный (SLOT_TAKEN, время/версия/занятость прежние), VERSION_CONFLICT, вне часов; отмена (статус, занятость, outbox, 2 уведомления, повтор идемпотентен, слот свободен, отменённую не перенести); authenticated не вызывает public_create_booking (42501); владелец: быстрая бронь без телефона, created_by, чужое заведение FORBIDDEN, ручная цена + manual_price, двойное нажатие → replay, блокировка поверх брони SLOT_TAKEN, блокировка свободного времени, задаток, возврат больше полученного отклонён, частичный возврат, completed, состоявшийся визит не отменяется; владелец B не трогает A (платёж/отмена NOT_FOUND, статистика/блокировка FORBIDDEN); гость не бронирует заблокированное время, после снятия — бронирует; статистика: создано 3, визитов 1 и их сумма, задатков получено = задаток, получено всего = задаток + оплата визита, ожидается = стоимость − задаток, отмен 1.
- `tests/integration/concurrency.test.ts` (2): 20 отдельных подключений service_role бронируют один слот → ровно 1 успех и 19 `SLOT_TAKEN`, в БД 1 бронь и 1 активная занятость; 20 параллельных повторов с одним ключом → все ok, один booking_id, одна бронь (replay=false ровно у одного).

Проверки (фактический результат):
- `npx supabase db reset && npx supabase test db` — 11 миграций; Files=6, Tests=215, Result: PASS.
- `npm run test:integration` — 2 passed (3 прогона подряд стабильно).
- `npx supabase db advisors --level warn` — без замечаний.
- `npm run typecheck && npm run lint && npm test && npm run build` — зелёные (типы БД перегенерированы `npm run db:types`).

Следующее: этап 4 — конвейер `tenant:new/validate/publish/verify`, два demo-заведения + `seed.sql`, Edge Functions `public-api`/`owner-api` с `_shared`, HTTP integration-тесты.
