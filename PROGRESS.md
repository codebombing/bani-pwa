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
