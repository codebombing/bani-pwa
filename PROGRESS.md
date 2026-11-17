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

## Между этапами 3 и 4 — демо-данные (11.11.2026)
- По просьбе пользователя добавлен `supabase/seed.sql` (часть этапа 4 заранее): одно заведение `demo-banya` (preview) — 2 зала, тарифы будни/выходные/ночь, 3 допа, часы 10:00–23:00 (+3 ч), 4 демо-брони на даты относительно дня `db reset` (прошедшая оплаченная, ближайшая онлайн с задатком, большой зал с чаном, ночная), блокировка на уборку. Брони создаются `private.create_booking` — цена серверная. Всё `is_demo = true`.
- pgTAP-фикстуры `02` и `06` ограничены заведениями `test-%`, чтобы не зависеть от seed.
- Проверки: `npx supabase db reset` (seed применяется), `npx supabase test db` — 215 PASS, `npm run test:integration` — 2 passed; `/` показывает «Демо-баня «Берёзка»».
- Не сделано из этапа 4: `tenants/demo-banya/business.json` + картинки, скрипты конвейера, второе заведение demo-sauna24, Edge Functions, HTTP-тесты.

## Экраны гостя + public-api (11.11.2026) — часть этапов 4 и 5 по просьбе пользователя
Сделано:
- Edge Function `supabase/functions/public-api` (`withSupabase({auth:'publishable'})` из `@supabase/server@1.4.1`, CORS из коробки; service role только внутри функции) + `_shared/` (`http.ts` — JSON/ошибки/коды→HTTP, `token.ts` — HMAC-токен и sha256, `schemas.ts` — Zod аргументов). Маршруты: `GET /t/:slug`, `GET /t/:slug/availability`, `POST /t/:slug/quote`, `POST /t/:slug/bookings` (booking_id генерирует функция, токен = HMAC(booking_id:key), в БД — sha256; при повторе токен вычисляется от исходного booking_id), `GET /t/:slug/bookings/:token`, `POST …/cancel`, `POST …/reschedule`. Rate limit: чтение 300/мин, токены 60/мин на IP. Секрет `BOOKING_TOKEN_SECRET` — `supabase/functions/.env` (в .gitignore), шаблон `.env.example`.
- Дизайн-система `design-system/bani-pwa/MASTER.md`: генерация ui-ux-pro-max дважды не дала проверенного совпадения (светлая розовая палитра + «избегать dark mode») — записаны общие рекомендации на базе правил скила и темы Astryx neutral dark.
- Фронтенд `src/features/booking/`: `api.ts` (Zod на все ответы, ApiError с кодом), `queries.ts` (TanStack Query; приватная бронь gcTime 0), `TenantTheme.tsx` (акцент заведения через `defineTheme({extends})` + контрастный `--color-on-accent`), `VenuePage` (демо-баннер, залы, «Мои брони», контакты), `BookingFlow` + `steps.tsx` (6 шагов, каждый — свой Astryx `BottomSheet`; `useStepHistory` синхронизирует шаги с history — системный Back закрывает шаг), `PriceLines` (строки серверного снимка цены), `BookingPage` (статус, детали, цена, оплачено/остаток, срок бесплатной отмены, отмена через AlertDialog), `myBookings.ts` (на устройстве — только токен и подпись). `src/shared/format.ts` (+ тесты): рубли, даты/время в timezone заведения, маска и нормализация телефона +7. Astryx `InternationalizationProvider` с каталогом `ru-RU`.
- Состояния: loading — Skeleton, error — Banner + «Повторить», empty — EmptyState, success. Ключ идемпотентности создаётся на попытку; меняется после ответа 4xx, сохраняется при сетевой ошибке. SLOT_TAKEN на подтверждении → «Выбрать другое время» возвращает к шагу времени.

Проверки (фактический результат):
- curl: каталог 200 (без apikey 401), слоты 14, создание 201, повтор 200 с тем же токеном, бронь по токену, чужой slug 404, отмена, мусорное тело 400.
- Браузер (375×812, dark): заведение → зал → дата (календарь ru) → слоты с серверной ценой (смешанный тариф 21–23 = 6 000 ₽) → полотенца ×2 → итог 5 600 ₽ → ошибки у пустых полей, маска телефона → подтверждение (строки расчёта, задаток 1 680 ₽) → страница брони по токену → отмена через диалог → «Бронь отменена»; системный Back закрывает шаг, оставаясь на странице.
- `npm run typecheck && npm run lint && npm test && npm run build` — зелёные (15 unit-тестов); `npx supabase test db` — 215 PASS; `npm run test:integration` — 2 passed.

Не сделано / дальше:
- Запуск функций: `npm run dev:functions` (`supabase functions serve`) в отдельном терминале.
- Фото залов (нужен конвейер `tenant:publish` + Storage), перенос брони в UI (API готов), ICS, push — этапы 4/7.
- HTTP integration-тесты public-api и Playwright-сценарий гостя — этапы 4/5.
- Разбиение бандла по маршрутам (предупреждение > 500 kB).

## Кабинет владельца (12.11.2026) — этап 6 по просьбе пользователя
Сделано:
- `npm run owner:invite -- <slug> <email> [--role owner|staff]` (`scripts/owner/invite.ts`): Admin API (service role из `.env`), создаёт или находит пользователя, upsert в `tenant_members`; повтор безопасен; Zod на аргументы и env. Тестовый владелец демо-бани: `owner@demo-banya.test`. **После `npx supabase db reset` пользователи Auth стираются — повторите `owner:invite`.**
- Вход по magic link (`signInWithOtp`, `shouldCreateUser: false`, redirect на `/s/<slug>/owner/`); локально письма в Mailpit (http://127.0.0.1:54324). Ответ одинаковый для существующей и несуществующей почты.
- `src/features/owner/`: `ownerApi.ts` (чтение под RLS: public_tenants, tenant_members, halls, bookings + payments, resource_occupancies + hall_blocks; изменения только RPC `owner_*`; Zod на все ответы; разбор tstzrange), `auth.ts` (сессия, вход, выход с `queryClient.clear()` и очисткой owner-данных), `OwnerApp` (вход → проверка членства в БД → «Нет доступа» для не-члена), `OwnerShell` (Layout + нижняя навигация График/Брони/Отчёт/Ещё), `CalendarPage` (день по залам, ‹ › и «к сегодняшнему дню», брони и блокировки, свободные моменты начала), `QuickBookingSheet` (тап по времени → зал/время/мин. длительность подставлены → «Сохранить»: 2 нажатия; источник телефон/мессенджер/на месте, имя и телефон необязательны, серверная цена), `OwnerBookingSheet` (детали, строки цены, получено/осталось, задаток/оплата/возврат со способом, гости пришли / не пришли / вернуть, перенос через календарь и свободные слоты, отмена с подтверждением), `BookingsPage` (предстоящие/прошедшие/отменённые по дням), `StatsPage` (owner_stats: день/7 дней/месяц/30 дней вперёд; получено с задатками, ожидается с пояснением «не выручка», визиты, отмены/неявки, загрузка по залам), `MorePage` (закрыть зал на время, список закрытых периодов с «Открыть», профиль, ссылка для гостей, выход).
- `src/shared/format.ts`: `zonedTimeToUtc`, `zonedDayRange` (локальные сутки заведения → UTC, DST) + тест.
- Роутер: кабинет и гостевая часть — ленивые чанки (GuestApp 33 kB, OwnerApp 132 kB).
- После действий кнопка ждёт обновления броней/денег; свободное время (тяжёлый get_availability) обновляется в фоне.

Проверки (фактический результат):
- `owner:invite`: создание ✔, повтор ✔, неверная почта и неизвестный slug → понятная ошибка, exit 1.
- Браузер (375×812): вход по magic link из Mailpit → календарь «Сегодня» (бронь Бориса, свободное время обоих залов) → быстрая бронь 14:00 в 2 нажатия (в БД: phone, «Гость», 5 000 ₽; свободное время пересчитано с буфером) → карточка Бориса: доплата 4 130 ₽ → «Получено 5 900 ₽ · осталось 0 ₽» → «Гости пришли» (в БД completed + audit) → Отчёт за месяц: получено 11 500 ₽ (задатки 1 770), ожидается 33 500 ₽ по 3 броням, визитов 2 на 11 500 ₽, загрузка 12 из 960 ч → «Ещё» отрисован.
- `npm run typecheck && npm run lint && npm test && npm run build` — зелёные (16 unit); `npx supabase test db` — 215 PASS; `npm run test:integration` — 2 passed.

Не проверено в браузере: закрытие/открытие зала и выход (пользователь в этот момент сам работал на странице). SQL `owner_block_hall`/`owner_unblock_hall` покрыты pgTAP (06).
Не сделано: недельный вид календаря, свайп по дням (есть кнопки ‹ ›), Playwright-сценарий «гость бронирует → владелец видит → задаток → статистика», push владельцу.

## Этап 4. Конвейер и API (12.11.2026) — готово
Сделано:
- Миграция `tenant_publish`: `public.admin_publish_tenant(config, hash, live, by)` — только service role; одной транзакцией заведение, часы, исключения, залы (upsert по key, id сохраняются), версии тарифа (по effective_from), допы, новая версия конфига. Брони, платежи, блокировки и члены не трогаются. Использованную в бронях версию тарифа нельзя изменить или удалить (ошибка с подсказкой «добавьте новую версию»). Зал/доп, убранный из конфига, скрывается (is_active = false), предупреждение о его будущих бронях. `--live` только при наличии владельца. Одинаковый хэш → версия не растёт. Бакет Storage `tenant-assets` (публичное чтение, запись только service role).
- Скрипты `scripts/tenant/`: `tenant:new` (из `_template` + заглушки картинок), `tenant:validate` (Zod + бизнес-проверки + картинки: иконки 512 PNG, maskable без прозрачности, фото ≥ 800×450 jpg/webp ≤ 3 МБ, неиспользуемые файлы; заглушки example.com/«Демо»/000-00-00 мешают `--live`), `tenant:publish` (validate → БД → Storage `<tenant_id>/config/…` с удалением устаревших только в config/ → оболочка `dist/s/<slug>/`: index.html с названием/иконками/og, manifest id/start_url/scope = `/s/<slug>/`, иконки 192/512/maskable/apple-touch; `dist/_redirects`; `--all`, `--no-shell`), `tenant:verify` (БД и хэш, public-api, availability по каждому залу, фото в Storage, manifest и размеры иконок, глубокие ссылки → HTML с названием; соседние оболочки; без `--base-url` — локальный сервер над dist с правилами `_redirects`), `tenant:seed` (`--check`), `tenant:placeholders`. `npm run demo:publish`, `npm run check:all`.
- Демо: `tenants/demo-banya` и `tenants/demo-sauna24` (круглосуточно, шаг 30 мин, другой акцент) с картинками-заглушками. Каталог в `supabase/seed.sql` генерируется из их business.json вызовом той же функции; брони seed (6 шт., в т. ч. 2 у сауны) ищут залы по slug+key. Хэш seed = хэш publish, поэтому publish после reset не создаёт новую версию.
- public-api: `GET /t/:slug/bookings/:token.ics` (RFC 5545: экранирование, перенос строк по 75 октетов, SEQUENCE = version, напоминание за 2 ч, отмена → STATUS:CANCELLED). Открывается обычной ссылкой без apikey (`withSupabase({auth:'none'})` только для этого маршрута; пропуск — токен, rate limit как у токенов). Каталог отдаёт `config_version`.
- Гость: фото первого снимка зала (`AspectRatio` 16:10, lazy, `?v=<config_version>`), «Добавить в календарь» с честной подписью.
- Отступление от плана: отдельной `owner-api` нет — кабинет читает под RLS и меняет через RPC `owner_*` с проверкой членства в SQL; граница проверена HTTP-тестом. Чужая бронь для владельца отвечает NOT_FOUND (не раскрывает существование), чужая статистика — FORBIDDEN.

Проверки (фактический результат):
- `npm run check:all` — exit 0 (typecheck, lint, 16 unit, build, seed --check, validate обоих демо: 0 ошибок).
- `npm run demo:publish` → `npm run tenant:verify -- demo-banya demo-sauna24` — «всё в порядке» (БД = текущий хэш, API, availability, 6+4 фото, manifest, иконки 192/512/maskable, 4 глубокие ссылки на каждое заведение). Негатив: удалённый manifest соседа → verify demo-banya падает «проверок не прошло: 1».
- Полный путь нового заведения: `tenant:new test-pipeline` → validate (0 ошибок) → `publish --live` отклонён из-за заглушек → publish (preview, версия 1) → verify ✔. Тестовое заведение затем убрано.
- `npx supabase test db` — 247 PASS (+32 в `07_tenant_publish`).
- `npm run test:integration` — 9 passed: повтор создания → 200, replay, тот же токен и booking_id; тот же ключ с другим телом → 409; свой токен 200, выдуманный 404, токен A по адресу B → 404 и не отменяет; 61-й запрос по токенам с одного IP → 429, другой IP не задет; ICS без apikey 200 text/calendar, корректный DTSTART, строки ≤ 75 октетов, выдуманный токен 404, остальное API без apikey 401; владелец A не видит брони B, отмена чужой → NOT_FOUND, статистика чужого → FORBIDDEN, своя работает; anon не читает bookings.
- Браузер (375×812): у сауны свой акцент и фото зала; на странице брони ссылка .ics отдаёт событие 15:00 МСК (12:00Z).

Как работать с новым заведением: `npm run tenant:new -- <slug> --name "…"` → заполнить business.json и картинки → `tenant:validate` → `npm run build && npm run tenant:publish -- <slug>` → `owner:invite` → `tenant:publish -- <slug> --live`. После `npx supabase db reset` — `npm run build && npm run demo:publish` (Storage очищается вместе с БД).

Не сделано / дальше:
- Service worker со scope заведения, startup images, `_headers` — этап 7; проверка `_redirects` на настоящем Cloudflare Pages / wrangler — этап 7 (см. ACCEPTANCE.md).
- Картинки демо — заглушки; настоящие фото присылает заведение.

## Этапы 5–6 — закрыты (12.11.2026)
Сделано:
- Playwright (`npm run test:e2e`, `playwright.config.ts`, Pixel 7, ru-RU, Europe/Moscow; dev-сервер переиспользуется): `tests/e2e/guest-owner.spec.ts` — временное заведение публикуется `admin_publish_tenant` → гость проходит все шаги до «Бронь подтверждена» (+ ссылка «Добавить в календарь») → владелец входит по magic link (Admin API generateLink, без Mailpit) → находит бронь в «Бронях» → «Отметить задаток» → «осталось = итог − задаток» → «Отчёт / Вперёд»: получено = задаток, ожидается = остаток по 1 брони. Заведение и пользователь удаляются после теста.
- Перенос брони гостем: `RescheduleSheet` (новая дата → свободное время с ценой → «Перенести на ЧЧ:ММ»; `expected_version` защищает от гонок), `publicApi.reschedule`.

Проверки (фактический результат):
- `npm run test:e2e` — 1 passed (6.4 s).
- Браузер (375×812): бронь сауны 18 ноября 15:00 → «Перенести» → 19 ноября 18:00 → страница брони показывает новое время.
- typecheck, lint — зелёные.

Сознательно не делалось (низкий приоритет по договорённости с пользователем): недельный вид календаря владельца и свайп по дням (есть кнопки ‹ ›). Push гостю/владельцу — этап 7.

## Этап 7. PWA-изоляция, push, ICS (12.11.2026) — готово
Сделано:
- Service worker (`src/sw.ts`) один на сборку, `tenant:publish` кладёт его в `dist/s/<slug>/sw.js`; scope `/s/<slug>/`, slug берётся из адреса SW. Кэши `bani-<slug>-static-v1` (precache), `bani-<slug>-public-v1` (каталог `public-api/t/<slug>` и картинки, SWR), `bani-<slug>-pages-v1` (HTML гостя, NetworkFirst). Брони по токену, кабинет, REST и Auth не перехватываются — только сеть. При активации чистятся только свои старые кэши. Push: показ уведомления с иконкой заведения, клик открывает адрес внутри scope заведения.
- Регистрация SW — `useTenantServiceWorker` в GuestApp/OwnerApp (только в сборке). `dist/_headers`: `/s/*`, `/index.html`, `/sw.js` — no-cache, `/assets/*` — immutable.
- Outbox → push: миграция `notify_worker` — `worker_claim_jobs` (FOR UPDATE SKIP LOCKED, lease 2 мин, протухший lease захватывается снова; устаревшая версия/неактивная бронь → skipped, не live → simulated, нет подписок → skipped), `worker_complete_job` (sent; ошибка → backoff 1/2/4/8 мин, после 5 попыток failed; 404/410 удаляют подписку), `public_push_subscribe` (по токену), `owner_push_subscribe/unsubscribe` (членство, auth.uid()), `private.invoke_notify_worker` + `cron.schedule('notify-worker', '* * * * *')` через pg_net; адрес и ключ — в Vault (`npm run notify:setup-local` для локального стека), без них задание ничего не делает.
- Edge Function `notify-worker` (`withSupabase({auth:'secret'})`, `npm:web-push@3.6.7`, VAPID из `supabase/functions/.env`): тексты для гостя (подтверждение, перенос, отмена, напоминания за 24 ч и 2 ч) и владельца (новая бронь, перенос, отмена).
- public-api: `POST /t/:slug/bookings/:token/push` (Zod: https-endpoint, ключи).
- UI: `PushToggle` — «Напоминать о брони» на странице брони гостя и «Включить уведомления» в «Ещё» владельца. На iPhone в Safari вместо кнопки — инструкция «На экран Домой»; если уведомления запрещены — подсказка; без поддержки — ничего не обещаем.
- `npm run serve:dist` — локальный статический хостинг dist/ на :8788 с правилами `_redirects`.
- VAPID-ключи сгенерированы локально: приватный — в `supabase/functions/.env`, публичный — `VITE_VAPID_PUBLIC_KEY` в `.env` (оба gitignored); в `.env.example` добавлена переменная.

Проверки (фактический результат):
- `npm run check:all` — exit 0; `npm run demo:publish` → `tenant:verify` обоих — «всё в порядке» (включая `/s/<slug>/sw.js`).
- `npx supabase test db` — 270 PASS (+23 в `08_outbox`: dedupe, lease, повторный захват, sent/backoff/failed, удаление мёртвой подписки, перенос гасит старые и ставит новые задачи версии 2, устаревшая версия → STALE_BOOKING, отмена гасит напоминания, preview → simulated, чужой не подписывается, authenticated не захватывает).
- `npm run test:integration` — 11 passed: воркер без ключа → 401; гость подписывается по токену (200), http-endpoint → 400; воркер захватывает задачу, реально вызывает web-push (push-сервис .invalid) → failed ≥ 1, задача pending, attempts 1, ошибка записана.
- `npm run test:e2e` — 2 passed: сценарий гость → владелец и `pwa.spec.ts` на собранном dist: у demo-banya и demo-sauna24 отдельные SW со scope своего заведения, кэши только `bani-<slug>-*`, каталог закэширован, броней по токену/REST/Auth в кэше нет.
- Цепочка pg_cron: `npm run notify:setup-local` → `select private.invoke_notify_worker()` → pg_net → Kong → notify-worker → ответ 200, задача демо-заведения (preview) → `simulated`.

Не проверено / не сделано (см. ACCEPTANCE.md):
- Доставка настоящего push на телефон (нужен HTTPS-хост и реальный браузер/push-сервис); встроенный браузер приложения Claude не регистрирует SW — проверка SW сделана в Playwright Chromium.
- `npx wrangler pages dev dist` и Lighthouse PWA — не запускались (вместо wrangler — `serve:dist`/`tenant:verify` с теми же правилами).
- Startup images для iOS не генерируются (нужен набор точных размеров под устройства; низкая ценность сейчас).

## Этап 8. AI, финальная приёмка, документация (12.11.2026) — готово
Сделано:
- Роутер намерений `supabase/functions/_shared/ai/router.ts` (чистый TS, без сети): даты («завтра», «в субботу», «15 ноября», «20.11», «на выходных»), время, длительность, гости, зал по названию («в малом зале»), период статистики. Гость: check_availability / quote / get_my_booking (только при токене брони); владелец: day_schedule / stats / find_booking / check_availability. Тесты на 22 фразах (`router.test.ts`, входят в `npm test`).
- Edge Function `ai-chat` (`withSupabase({auth: ['user','publishable']})`): Zod на тело; rate limit 20/мин на IP; режим owner — только с JWT и членством (проверка под RLS вызывающего), иначе 403. Сервер сам выполняет инструмент по роутеру; инструменты гостя — публичные SQL-функции, владельца — клиент вызывающего (RLS + owner_*). Аргументы — Zod; tenant берётся из маршрута, модель не задаёт tenant_id и SQL. LLM (OpenAI-совместимый, `LLM_*` только в секретах функций): `consume_llm_budget` до вызова, tool loop ≤ 4, модель видит только инструменты своего режима; провайдер без tool calling → JSON `{intent, args}` + Zod; бюджет исчерпан / ошибка / LLM не настроен → ответ по данным инструмента без LLM. Ассистент только читает данные.
- UI `src/features/ai/`: `AssistantSheet` (Astryx Chat в BottomSheet, подсказки, «Смотрю…», ошибки, кнопка «Забронировать» для гостя), ленивая загрузка. Кнопки: «Спросить помощника» на странице заведения и брони (с токеном), «Помощник: брони и деньги» в «Ещё» владельца.
- Документы: `SETUP.md` (запуск, переменные, cron/Vault, публикация, проверки, перенос на сервер), `CLONE-IN-6-MINUTES.md`, `ACCEPTANCE.md` (таблица проверка → команда → результат → дата + «Не проверено и почему»). `npm run check:fast` и полный `npm run check:all` по плану.
- Исправлено: тест бюджета LLM (04) зависел от реального расхода за сегодня — обнуляет счётчик внутри своей транзакции.

Проверки (фактический результат):
- `npm run check:all` — **exit 0**: unit 38 passed; `supabase test db` 270 PASS; integration 16 passed (+5 ai: скоупы режимов, своя бронь только по токену, owner без входа/чужой → 403, AI недоступен → бронь работает); e2e 2 passed; `tenant:verify` обоих демо — всё в порядке.
- Путь с LLM — разово на фиктивном OpenAI-совместимом сервере (`LLM_BASE_URL=http://host.docker.internal:8799/v1`, потом возвращено): гостю переданы только [check_availability, quote, get_my_booking], модель вызвала check_availability → ответ `llm:true`; владельцу — только [day_schedule, stats, find_booking, check_availability], вызван stats.
- Браузер (375×812): «Спросить помощника» → «Что свободно завтра?» → список времени по залам с ценой «от …», кнопка «Забронировать».

Не проверено: настоящий LLM-провайдер и всё, что требует HTTPS-хоста — см. ACCEPTANCE.md.

## Оформление: тёплая тема, фото, шапка, кнопка помощника (12.11.2026)
Сделано:
- Фото пользователя тонированы в общую тёплую палитру (sharp: тёплый recomb, для холодных бассейнов сильнее). Общие фоны `public/bg/guest.jpg`, `owner.jpg` — заранее размыты и затемнены (телефон не размывает на лету). Фото заведений (меняются по запросу): `tenants/<slug>/images/hero.jpg`, `logo.png`, по 3 фото на зал (кадрированы из присланных). Фото 8, 9, 11 не использованы (подпись автора / чужой бренд / узнаваемое заведение). Логотип — свой знак (ковш, пар, камни), из него иконки приложения.
- `business.json`: `theme.hero`, `theme.logo` (необязательные, проверяются validate, публикуются в Storage). Сауне — тёплый акцент.
- Тема (`TenantTheme`): тёплая тёмная основа, полупрозрачные поверхности поверх фото-фона, акцент заведения. `global.css`: фон `body::before`, отдельный для кабинета (`html[data-area=owner]`).
- Шапка заведения: главное фото 4:5 с затемнением снизу, логотип, название, слоган, адрес · демо-режим, «Забронировать».
- Помощник: круглая кнопка справа внизу поверх всего (в кабинете — над навигацией), мягкое «дыхание» раз в 4 с (выключено при reduced motion); по нажатию страница размывается и затемняется, открывается чат (70 % высоты). Старые кнопки «Спросить помощника» убраны. «Забронировать» из чата → `/s/<slug>/?book=1` открывает бронь.

Проверки: typecheck, lint, 38 unit, validate обоих демо (0 ошибок), seed --check, build + demo:publish (версия 2), `npm run test:e2e` — 2 passed; браузер 375×812: шапка с фото, кнопка помощника → размытие → чат.
Не проверено в браузере: кабинет владельца с новым фоном (нужен вход), сауна — визуально.

## Правки по дизайну (12.11.2026, второй круг)
- Шторки, календарь, всплывающие — плотный фон (на стекле дни сливались с фоном); карточки остались «стеклом».
- Кнопка помощника круглая 56 px, всё время мягко «пульсирует» кольцом акцента (2,8 с; выключено при reduced motion).
- Помощник «Банщик»: аватар (своя SVG-иллюстрация: робот в банной шапке с веником), приветствие «Соберётесь попариться — подскажу…», подсказки-вопросы; шапка и поле ввода прилипают к краям шторки, лента прокручивается между ними, новое сообщение прокручивается в видимую зону. Исправлен баг: переписка уезжала под поле ввода и не листалась.
- «Записаться» из чата открывает бронь (через state навигации; раньше страница пересоздавалась и бронь не открывалась).
- Шапка заведения: продающий слоган и описание (business.json `texts`), фото выше (2:3), «Забронировать» в шапке спокойная; при прокрутке снизу появляется чёткая «Забронировать».
- Страница брони: сверху «← Заведение», снизу крупная «На главную» (после отмены — «Выбрать другое время»).
Проверки: check:fast (38 unit), build, demo:publish (версия 3), seed --check, test:e2e 2 passed; браузер 375×812: календарь читается, прокрутка → нижняя кнопка, чат «Банщик» с перепиской, «Записаться» → бронь.

## Правки по дизайну (13.11.2026, третий круг)
- Карточка зала: цена «от N ₽/ч» рядом с названием (public-api отдаёт `price_from` — минимум по действующей версии тарифа); фото во всю ширину карточки без отступа сверху.
- Убраны: нижняя «Забронировать» при прокрутке, логотип в главной карточке.
- Надпись-логотип в шапке (`Wordmark`): крыша с перекрещенными коньками, труба с паром, шрифт Ruslan Display (@fontsource, локально). Текст — `business.json → theme.wordmark { top, main, sub }`, без настройки берётся из названия.
- Кнопка помощника: значок — берёзовый веник, раз в ~3 с делает «взмах» (выключено при reduced motion).
- Кабинет: нижнее меню — иконки (график, брони, отчёт, ещё), подписи остались для экранных читалок.
Проверки: typecheck, lint, 38 unit, validate, seed (версия 4), build + demo:publish, test:e2e 2 passed (вкладки кабинета находятся по названию), test:integration 16 passed; браузер 375×812: шапка, цена, веник.

- 13.11.2026: шапка заведения — фото фоном блока по высоте содержимого (без пустой полосы сверху); кнопки выше: md 46 px, lg 52 px, остальные кликабельные ≥ 44 px (global.css). Проверки: 38 unit, build, e2e 2 passed, браузер 375×812.

## Тестовый деплой в облако (13.11.2026)
- Supabase Cloud: проект bani-pwa-test (hwppclalwmfzolsfsuwn, eu-north-1) — миграции + seed, функции public-api/notify-worker/ai-chat, секреты (токены броней, VAPID). Сайт: Vercel https://bani-pwa-test.vercel.app (`vercel.json` генерирует tenant:publish).
- `scripts/deploy/cloud.sh <ref>` (запускает пользователь: пароль БД). Подключение к БД через пул на порту 6543 — порт 5432 у провайдера обрывается.
- Auth: Site URL и redirect `https://bani-pwa-test.vercel.app/**`, регистрация выключена; владелец обеих демо — почта владельца аккаунта Supabase (встроенная почта Supabase шлёт только участникам организации).
- Проверка: `ENV_FILE=.env.cloud.local npm run tenant:verify -- demo-banya demo-sauna24 --base-url https://bani-pwa-test.vercel.app` — всё в порядке (после замены правила на `/s/:slug/(.*)`).
- Не проверено: адрес и ключ notify-worker в Vault облака (скрипт мог прерваться до шага 6), вход по ссылке из письма, push на телефоне.

- 15.11.2026: кабинет — исправлено: деньги (форма PaymentForm пересоздаётся после платежа, сумма = текущий остаток, нельзя больше остатка/полученного, после полной оплаты «Оплачено полностью» + «Оформить возврат»); смена статуса закрывает карточку после обновления; refreshOwnerData перезагружает и неактивные списки (refetchType all). Проверено в облаке на временной брони: задаток 1 500 + оплата 3 500 = 5 000, кнопка пропала, 2 платежа; «Не пришли»/«Вернуть в подтверждённые» — карточка закрывается, статус сразу в списке и в БД.

- 15.11.2026 (2): кабинет — нижнее меню из квадратных кнопок-иконок (Брони первыми, График, Отчёт, Настройки с шестерёнкой), красная точка на «Бронях» при непрочитанных онлайн-бронях (`bookings.seen_at`, `owner_mark_seen` при открытии). Брони одним списком (новые даты сверху), фильтр по статусу — кнопка-воронка, метка «новая». Задаток — переключатель «Задаток получен» (одна отметка, `owner_set_deposit`, снимается тем же переключателем); «Оформить возврат» убран. Корзина в карточке: `owner_delete_booking` с предупреждением — бронь и платежи удаляются, отчёт пересчитывается. Визит: «Ожидаем / Пришли / Не пришли»; pg_cron каждые 10 мин ставит «Пришли» прошедшим подтверждённым. Настройки → «Брать задаток» (`tenants.deposit_enabled`, только владелец): выключен — процент 0 у гостей, в карточках, у бота. Push владельцу уходит и для preview-заведения (гостям в preview — simulated). Миграция `20261115105242_owner_settings_seen_delete.sql`, тест `09_owner_settings`.
  Проверки: supabase test db 286 passed, test:integration 16, test:e2e 2, unit 38, lint, typecheck, astryx doctor (0 fail); браузер 375×812: меню, «новая» → «ожидаем» после открытия, задаток вкл/выкл без задвоения, удаление, выключение задатка скрывает его у гостей.
  Найдено в облаке: cron не будит notify-worker (диагностическая задача висела 2+ мин; ручной вызов воркера — 200), владелец не подписан на push. В облако новая версия ещё не выложена (нужен пароль БД — `bash scripts/deploy/cloud.sh <ref>`; скрипт теперь печатает последние запуски cron и ответы pg_net).
- 15.11.2026 (3): выложено в облако (миграция owner_settings_seen_delete, функции, сайт). Причина молчащих push: шаг 6 cloud.sh (`db query > /dev/null`) без `--yes` не выполнялся — Vault был пуст, cron работал вхолостую. Ключи записаны, диагностическая задача владельцу обработана cron'ом за ~1 мин (NO_SUBSCRIPTION — владелец ещё не подписан). Скрипт исправлен (--yes / --read-only, SITE_URL = https://bani-pwa-test.vercel.app). tenant:verify в облаке — всё в порядке.

- 15.11.2026 (4): кабинет урезан до бронирования. Убраны: вкладка «Отчёт» (StatsPage), «Деньги» в карточке (PaymentForm, строка «получено/осталось», «оплачено» в списках), «Визит» (Ожидаем/Пришли/Не пришли), фильтр броней, ручная бронь из графика (QuickBookingSheet, свободные слоты). Задаток выключен у всех: миграция `20261115160000_deposit_off.sql` (`deposit_enabled` = false и по умолчанию → `deposit_percent` = 0 у гостей, в цене, у бота); переключатель в Настройках убран. Список и график: новая (акцент) / предстоит (зелёная) / прошла (серая, только просмотр) — `bookingKind` в `labels.ts` + unit-тест; отменённые не показываются, красная точка не учитывает отменённые.
  Проверки: typecheck, lint, unit 41 passed, supabase test db 286 passed (05: задаток в снимке теперь 0), test:integration 16 passed, test:e2e 2 passed (новый сценарий: новая бронь → открыть → нет «Деньги»/«Пришли»/«Отчёт» → отменить → пропала); браузер 375×812 на demo-banya: цвета, прошедшая без кнопок, предстоящая — перенос/отмена/корзина, график без слотов.
  Не выложено в облако: нужна миграция (`bash scripts/deploy/cloud.sh <ref>`) и сайт.
- 15.11.2026 (5): убрана вкладка «График» (CalendarPage, иконка, маршрут; старый адрес /owner/calendar открывает «Брони»). В кабинете два раздела: Брони и Настройки. Проверки: typecheck, lint, unit 41, test:e2e 2 passed, build; браузер 375×812 — меню из двух кнопок.
- 15.11.2026 (6): демо-бани из bani-leads выложены в preview — `marfinskie-bani` (3 зала: russian, finnish, couple) и `hlebnikovskie-bani` (2 зала: small, big). Конфиги и hero — из `~/development/bani-leads/tenants/`; фото залов подставлены из demo-banya/demo-sauna24 (своих нет), иконки — `tenant:placeholders`. Надписи-логотипы — как в bani-leads.
  Проверки: tenant:validate — 0 ошибок (1 предупреждение: политика ПДн example.com, мешает --live); локально build + tenant:publish + tenant:verify — всё в порядке; облако: `vite build --mode cloud`, `ENV_FILE=.env.cloud.local tenant:publish -- --all` (демо — «без изменений»), `vercel deploy --prod`; `tenant:verify -- marfinskie-bani hlebnikovskie-bani --base-url https://bani-pwa-test.vercel.app` — всё в порядке; браузер 375×812: шапка с фото, все залы с ценами, бронь до шага «Контакты» у обеих.
  Не проверено: заглушка «ЗАГЛУШКА: оператор ПДн» у Марфинских видна гостю на шаге контактов; вместимости/тарифы — допущения (см. assumed в leads.json).
- 15.11.2026 (7): Wordmark — длинное название вылезало за ширину 320 (кегль считался по 0.62 кегля на букву, у Ruslan Display кириллица 0.70–0.77). Коэффициент 0.78 для обеих строк; названия до 7 букв по-прежнему кегль 54. Надписи Марфинских/Хлебниковских возвращены как в bani-leads (версия 3).
  Проверки: typecheck, lint, unit 41 passed; локально и в облаке tenant:publish --all (демо — без изменений) и tenant:verify всех 4 — всё в порядке; vercel deploy --prod. Браузер 375×812, границы текста в viewBox 0–320: «Марфинские» 14–306 (кегль 38), «Хлебниковские» 27–292 (29), «Берёзка» 31–289 (54, как было), «24 часа» 45–275 (54).
- 16.11.2026: 80 бань из ~/development/bani-leads-parcer/tenants скопированы в tenants/ (marfinskie/hlebnikovskie пропущены — уже есть), фото залов (145 залов) подставлены из демо, иконки — tenant:placeholders. Только локально: validate 80/80 без ошибок (⚠ политика ПДн), build, tenant:publish --all (84), tenant:verify новых — всё в порядке; serve:dist :8788 (добавлен в .claude/launch.json). В облако не выкладывались.
- 16.11.2026 (2): десктоп — все `main` по центру (global.css), на странице заведения залы в Grid в две колонки (maxWidth 1040), нижняя навигация кабинета не шире 480. Детализация брони владельца — без корзины «Удалить» (ownerApi.deleteBooking и TrashIcon удалены; SQL-функция owner_delete_booking осталась). Задаток убран из интерфейса гостя (PriceLines, итог брони, «Задаток N %» на странице, фраза в booking_note demo-banya); deposit_percent в конфигах и БД не трогали — на нём держатся pgTAP-тесты. Дефолтные фото halls/small/1.jpg и halls/big/1.jpg (demo-banya и 61 копия у лидов, 103 файла) заменены на новые, 960 px по ширине.
  Проверки: typecheck, lint, unit 41 passed, tenant:seed; tenant:publish 63 заведений локально; браузер 1440×900 (центр, 2 колонки, шторка брони узкая, детализация брони без корзины) и 375×812 (scrollWidth 375). supabase test db / e2e не гонялись.
- 16.11.2026 (3): выложено в облако: `vite build --mode cloud`, `ENV_FILE=.env.cloud.local tenant:publish -- demo-banya demo-sauna24 marfinskie-bani hlebnikovskie-bani` (без --all — 80 лидов в облако не попадают), `vercel deploy dist --prod` → https://bani-pwa-test.vercel.app. tenant:verify всех 4 на проде — всё в порядке; браузер 1440×900: страница по центру, залы в 2 колонки, новые фото 960×1280 и 960×720.
- 16.11.2026 (4): переезд на свой сервер в РФ (FirstVDS «Разгон», 2 CPU/4 ГБ, Ubuntu 24.04, 91.132.188.117) — Vercel и supabase.co без VPN недоступны. Домен https://rubanybook.duckdns.org (DuckDNS, сертификат Let's Encrypt через Caddy). На сервере: Docker, swap 4 ГБ, ufw 22/80/443, apt-зеркало хостера заменено на mirror.yandex.ru; официальный Supabase self-hosted в /opt/supabase (ключи сгенерированы на сервере, новые sb_publishable/sb_secret), сайт в /opt/site. Наши дополнения — `scripts/deploy/ru/` (Caddyfile: API Supabase по путям + статика с правилами как в vercel.json; compose: порты БД и Studio только на 127.0.0.1, секреты функций из bani-functions.env).
  Команды: `npm run deploy:ru [-- <slug>...]` — функции, миграции+seed, Vault для cron, сборка `--mode ru`, публикация бань, уже лежащих на сервере (+ перечисленных), rsync dist, verify; `npm run deploy:tenant -- <slug>` — одна баня без пересборки (~30 с: БД, Storage, только /opt/site/s/<slug>/; оболочка из серверных index.html/sw.js). Владельцы без почты: `ENV_FILE=.env.ru.local npm run owner:invite -- <slug> <email>`, затем `owner:link` (SMTP не настроен — письма не уходят). Studio — только через `ssh -L 3000:127.0.0.1:3000`.
  Исправлено по ходу: seed.sql — убраны демо-платежи «задаток» (после deposit_off сумма 0 нарушала payments_amount_check, падал бы и `db reset`).
  Проверки: deploy:ru 4 бань (demo-banya, demo-sauna24, marfinskie-bani, hlebnikovskie-bani) — 15 миграций и seed, tenant:verify всех 4 на https://rubanybook.duckdns.org — всё в порядке; deploy:tenant demo-sauna24 — всё в порядке; curl: /s/<slug>/hall/any и /owner/ → оболочка, /s/nope/x → 404; cron notify-worker каждую минуту → 200 {"ok":true}; браузер: страница бани с фото из Storage, шаг 3 брони со слотами и ценами, вход владельца по owner:link (тестовый demo-owner@example.com) — кабинет с демо-бронями.
  Не проверено: SMTP/письма, ai-chat (LLM не настроен, OpenAI/Anthropic из РФ не ответят), push на реальном телефоне, бэкапы БД.
- 17.11.2026: на сервер РФ выложены `taygapar` и `usachevskie-bani` (присланы в ~/Downloads/test bani — те же конфиги и hero, что уже в tenants/ из 80 лидов; в репозитории к ним уже добавлены фото залов по умолчанию и иконки, копировать не понадобилось). `npm run deploy:tenant -- taygapar usachevskie-bani` — БД, Storage (21 картинка у Усачёвских), оболочки; tenant:verify обеих + 4 ранее опубликованных — всё в порядке; браузер: обе страницы открываются, ошибок в консоли нет.
- 17.11.2026 (2): на сервер РФ выложены `bannyy-dom` и `ekspeditsiya` (из ~/Downloads/test bani — конфиги и hero совпадают с tenants/, там уже есть фото залов по умолчанию и иконки). `npm run deploy:tenant -- bannyy-dom ekspeditsiya` — БД создано, Storage 21 и 6 картинок; tenant:verify обеих + 6 ранее опубликованных — всё в порядке; браузер: обе страницы открываются, ошибок в консоли нет.
