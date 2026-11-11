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
