# AGENTS.md — правила для агента

Проект: PWA бронирования бань и саун, мультитенантный. Источник истины по архитектуре — `docs/IMPLEMENTATION-PLAN.md`. Прогресс — `PROGRESS.md`.

## Как работать
- Один этап плана за сессию. После этапа: проверки этапа → запись в PROGRESS.md (команды и фактический результат) → git commit.
- Работа может прерваться в любой момент (лимит токенов). Поэтому внутри этапа: после каждого законченного шага — короткий git commit (`wip(stage N): ...`) и строка в PROGRESS.md «В процессе: сделано X, следующий шаг Y». При старте сессии сначала `git status` и `git log -5`: незакоммиченные изменения доведи до рабочего состояния или откати, потом продолжай с шага из PROGRESS.md.
- Не удаляй и не перезаписывай существующие файлы без необходимости; `.claude/skills/*` и `skills-lock.json` не трогать.
- Перед незнакомым компонентом Astryx: `npx astryx component <Name>`. Перед новой областью Supabase — скил `supabase`; перед SQL-схемой и индексами — `supabase-postgres-best-practices`; перед экранами — `ui-ux-pro-max`; для браузерных проверок — `playwright-cli`.
- Ничего не помечай как «готово/интегрировано», если это не проверено командой. Внешнее, что нельзя проверить локально, — в раздел «Не проверено» в ACCEPTANCE.md.
- Только локальный Supabase (`supabase start`). Без `supabase link`, деплоя и облачных ключей, пока об этом прямо не попросят.

## Код
- TypeScript strict, без `any` (кроме генерируемых типов). Типы БД: `supabase gen types typescript --local > src/shared/db.types.ts`.
- Zod на каждой границе: business.json, ответы API, аргументы Edge Functions, аргументы AI-инструментов.
- Деньги — целые копейки (`bigint`/`integer`), время — `timestamptz` + timezone заведения.
- Бизнес-названия заведений — только в `tenants/*` и `supabase/seed.sql`, не в `src/`.
- Файлы небольшие, по фичам: `src/features/<booking|owner|stats|ai>/`, `src/shared/`, `supabase/migrations/`, `supabase/functions/<name>/`, `supabase/tests/`, `scripts/tenant/`, `tests/integration/`, `tests/e2e/`.

## Безопасность
- Service role key и LLM_API_KEY — только в Edge Functions/скриптах, никогда в `VITE_*`.
- Токен брони хранится только как sha256. Приватные ответы не кэшируются service worker'ом.
- Изменения броней — только через SQL-функции; клиент не передаёт цену, tenant_id и время окончания.

## Команды (заполнить по мере появления)
- `npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:integration` · `npm run test:e2e` · `npm run check:fast` · `npm run check:all` (полный, нужен стек)
- Документы: `SETUP.md` (запуск, переменные, cron), `CLONE-IN-6-MINUTES.md` (новое заведение), `ACCEPTANCE.md` (приёмка)
- `supabase start` · `supabase db reset` · `supabase test db` · `supabase functions serve`
- `npm run tenant:new|validate|publish|verify|seed|placeholders -- <slug>` · `npm run demo:publish` · `npm run owner:invite -- <slug> <email>`
- `npm run serve:dist` (dist/ на :8788 с `_redirects`) · `npm run notify:setup-local` (Vault для pg_cron → notify-worker)

<!-- ASTRYX:START -->
Astryx v0.7.13 · 174 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-*|--spacing-*|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
