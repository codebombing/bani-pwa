# Бани PWA — описание проекта (для передачи в новый чат)

## Что это
PWA для онлайн-бронирования бань и саун. Мультитенантность: одна сборка обслуживает много заведений, у каждого свой адрес `/s/<slug>/`, своё название, тема, иконки, service worker и манифест. Гость бронирует без регистрации. У владельца есть кабинет `/s/<slug>/owner/`, вход по одноразовой ссылке.

Стек: React 19 + Vite + TypeScript (strict), TanStack Query, Zod, UI-библиотека Astryx (`@astryxdesign/core`), Supabase (Postgres + RLS + SQL-функции, Auth, Storage, Edge Functions на Deno, pg_cron + pg_net + Vault), Web Push (VAPID). Хостинг сайта — Vercel (или Cloudflare Pages: генерируются `_redirects` и `_headers`).

Источники правды: `AGENTS.md` (правила для агента), `docs/IMPLEMENTATION-PLAN.md` (архитектура), `PROGRESS.md` (история и проверки), `SETUP.md` (запуск), `CLONE-IN-6-MINUTES.md` (новое заведение), `ACCEPTANCE.md` (приёмка).

## Структура
- `src/features/booking/` — сторона гостя: главная заведения (`VenuePage`), выбор зала → даты → времени → гостей → данных (`steps.tsx`, `BookingFlow`), страница брони по токену (`BookingPage`, `/s/<slug>/b/<token>`), перенос и отмена.
- `src/features/owner/` — кабинет: `BookingsPage` (список), `CalendarPage` (график), `SettingsPage`, `OwnerBookingSheet` (карточка брони), `labels.ts` (`bookingKind`: новая / предстоит / прошла), `ownerApi.ts`.
- `src/features/ai/` — помощник «Банщик» (круглая кнопка с веником, чат) для гостя и для владельца.
- `src/shared/` — схемы (`business-schema.ts`), форматирование денег и времени, Supabase-клиент, push, `db.types.ts` (генерируется).
- `src/sw.ts` — service worker: кэш статики, приватные ответы не кэшируются, приём push, по клику открывает URL.
- `supabase/migrations/` — схема, RLS, вся бизнес-логика в SQL-функциях. `supabase/tests/database/` — pgTAP-тесты (286).
- `supabase/functions/` — `public-api` (гостевой API, токены, rate limit), `notify-worker` (рассылка push), `ai-chat` (LLM и инструменты).
- `tenants/<slug>/` — данные заведения: `business.json` и `images/`. `tenants/_template/` — шаблон.
- `scripts/tenant/*` — создание, валидация, публикация и проверка заведения. `scripts/owner/*` — приглашение и ссылка входа. `scripts/deploy/cloud.sh` — облачный деплой.
- `tests/integration/` (16), `tests/e2e/` (Playwright, 2), unit (vitest, 38).

## Бизнес-логика
- **Деньги** — целые копейки, **время** — `timestamptz` плюс часовой пояс заведения.
- **Цена** считается только в БД (`private.compute_quote`): тариф по часам (будни, выходные, ночь), доплата за гостей сверх включённых, допуслуги. Клиент не передаёт цену, tenant_id и время окончания. В брони хранится снимок цены `price_snapshot`.
- **Занятость** — таблица `resource_occupancies` с EXCLUDE-ограничением. Пересечения броней и блокировок невозможны (`SLOT_TAKEN`). Между бронями есть буфер (`buffer_min`) на уборку.
- **Создание брони** (`public_create_booking` через public-api): идемпотентность по ключу, rate limit, согласие на ПДн. Токен брони хранится только как sha256. Бронь сразу получает статус «confirmed».
- **Задаток не используется** (с 15.11.2026): о предоплате владелец договаривается с гостем по телефону. Миграция `20261115160000_deposit_off.sql` выключила `tenants.deposit_enabled` у всех и по умолчанию, поэтому действующий `deposit_percent` = 0 — задатка нет у гостей, в цене и у бота. Таблица платежей и функции `owner_set_deposit`/`owner_add_payment` в БД остались, из кабинета не вызываются.
- **Оплата** — «Отметить оплату», не больше остатка (`owner_add_payment`). Возвратов в интерфейсе нет.
- **Статусы визита** в кабинете не показываются. Бронь различается цветом: новая (онлайн-бронь, которую не открывали) — акцент, предстоит — зелёная, прошла (закончилась) — серая, только просмотр. Отменённые в списке и графике не показываются. pg_cron по-прежнему переводит прошедшие confirmed в completed.
- **Удаление брони** — значок корзины у предстоящей брони и окно-предупреждение (`owner_delete_booking`). Бронь удаляется каскадом вместе с занятостью и уведомлениями. В журнал пишется только `booking_deleted`.
- **«Новые» брони** — онлайн-брони с `seen_at is null`. При открытии карточки срабатывает `owner_mark_seen`. Красная точка на иконке «Брони» видна, пока есть непрочитанные.
- **Блокировки зала** (уборка, ремонт) — в Настройках, `owner_block_hall`.
- **Уведомления.** При создании, переносе и отмене брони, а также для напоминаний гостю за 24 и 2 часа задачи пишутся в `notification_jobs`. pg_cron раз в минуту будит `notify-worker` через pg_net; адрес и ключ лежат в Vault (`notify_worker_url`, `notify_worker_key`). Гость подписывается на странице брони, владелец — в Настройках кабинета. Push владельцу открывает `/s/<slug>/owner/bookings`. Если заведение в статусе preview, гостям уведомления не отправляются (simulated), владельцу отправляются.
- **Статусы заведения** — `preview` (по умолчанию) и `live`. Перевести в live нельзя, пока в `business.json` остаются заглушки (юридические данные, политика ПДн — требование 152-ФЗ).
- **Доступ.** RLS: владелец видит только свои заведения, изменения идут только через SQL-функции `owner_*`. Service role key и LLM_API_KEY хранятся только в функциях и скриптах, никогда не попадают в `VITE_*`.

## Кабинет (интерфейс)
Нижнее меню — квадратные кнопки-иконки: Брони (по умолчанию), График, Настройки (шестерёнка). Брони идут одним списком по дням, новые даты сверху, без фильтров. График — брони и блокировки по залам за день; записывать гостя вручную из кабинета нельзя. В карточке брони: данные гостя и цена; у предстоящей — перенос, отмена, корзина; у прошедшей — только просмотр.

## Как добавить новую баню
1. `npm run tenant:new -- <slug>` (slug — латиница, цифры, дефисы). Создаст `tenants/<slug>/` из шаблона.
2. Заполнить `tenants/<slug>/business.json`, его проверяет Zod-схема `src/shared/business-schema.ts`:
   - `name`, `timezone`, `theme.accent` (цвет), `pwa.short_name` и `pwa.description`;
   - `texts` — продающие тексты главной;
   - `contacts` — телефон, Telegram, адрес;
   - `legal` — оператор ПДн, ссылка на политику;
   - `policy` — `deposit_percent`, `free_cancellation_hours`, `reschedule_pricing`;
   - `working_hours` (с `max_end_after_close_min`) и `exceptions` (праздники, закрытые дни);
   - `halls[]`: `key`, `name`, `description`, `capacity_included`/`capacity_max`, `extra_guest_price_rub`, `min_duration_min`, `slot_step_min`, `buffer_min`, `photos`, `tariffs`;
   - `extras[]` — допуслуги (простыни, веники и т. п.).
3. Картинки в `tenants/<slug>/images/`:
   - `hero.jpg` — фото на главной;
   - `logo.png`;
   - `icon-512.png` и `icon-maskable-512.png` — иконки приложения (из них генерируются 192 px и apple-touch);
   - `halls/<key>/…` — фото залов (имена файлов указываются в `photos`).

   Если чего-то нет, `npm run tenant:placeholders -- <slug>` нарисует заглушки. Общие фоны всех заведений лежат в `public/bg/guest.jpg` и `public/bg/owner.jpg`.
4. `npm run tenant:validate -- <slug>` — ошибки, предупреждения и отметки «мешает --live».
5. `npm run build`, затем `npm run tenant:publish -- <slug>`: пишет конфиг в БД (статус preview), картинки — в Storage, оболочку — в `dist/s/<slug>/`.
6. Владелец: `npm run owner:invite -- <slug> <email>`, затем `npm run owner:link -- <slug> <email>` выдаёт одноразовую ссылку входа без письма (~1 час, новая отменяет старую).
7. Когда заглушек не осталось: `npm run tenant:publish -- <slug> --live`.
8. Проверка: `npm run tenant:verify -- <slug> [--base-url <сайт>]`.

Для облака перед командой ставится `ENV_FILE=.env.cloud.local`. Изменения `business.json` применяются повторным `tenant:publish`. Названия заведений хранятся только в `tenants/*` и `supabase/seed.sql`, в `src/` их нет.

## Локальный запуск
Нужны OrbStack или Docker, Node 22, Supabase CLI (через npx).
```bash
npx supabase start
npx supabase db reset
npm run dev
npx supabase functions serve --env-file supabase/functions/.env
```
- `npx supabase db reset` — миграции и seed (демо: demo-banya, demo-sauna24).
- `npm run dev` — сайт на http://localhost:5173/s/demo-banya/.
- `npx supabase functions serve --env-file supabase/functions/.env` — нужен для public-api, бота и интеграционных тестов.
- Почта локально: Mailpit, http://127.0.0.1:54324.

Проверки:
- `npm run check:fast` — typecheck, lint, unit;
- `npx supabase test db`;
- `npm run test:integration` (нужны запущенные функции);
- `npm run test:e2e`;
- `npm run check:all` — всё сразу;
- перед выкладкой: `npx astryx doctor --built dist`.

После изменения схемы: `npm run db:types`.

## Облако (тестовый деплой)
- Supabase-проект `bani-pwa-test`, ref `hwppclalwmfzolsfsuwn` (eu-north-1). Сайт: https://bani-pwa-test.vercel.app (Vercel, проект bani-pwa-test).
- Деплой одной командой (идемпотентно):
  ```bash
  npx supabase login
  bash scripts/deploy/cloud.sh hwppclalwmfzolsfsuwn
  ```
  Пароль БД вводит пользователь. Скрипт делает по шагам:
  1. `supabase link`;
  2. `db push` с seed через пул на порту **6543** (порт 5432 у провайдера обрывается);
  3. ключи → `.env.cloud.local` (gitignored);
  4. секреты функций (BOOKING_TOKEN_SECRET, VAPID);
  5. деплой трёх функций;
  6. Vault для cron и вывод последних запусков cron;
  7. `vite build --mode cloud` и `tenant:publish --all`;
  8. `vercel deploy --prod`.
- Если пароля нет, а `supabase login` выполнен, SQL в облаке можно выполнять так: `npx supabase db query --remote --yes "<sql>"` (только чтение — `--read-only`). Шаги 7–8 можно повторить отдельно.
- Вход владельца в облаке: `ENV_FILE=.env.cloud.local npm run owner:link -- <slug> <email>`. Ссылка ведёт на сайт, токен передаётся в `#hash`, поэтому превью мессенджеров её не тратят. Встроенная почта Supabase отправляет не больше 2 писем в час, поэтому вход — по ссылке.
- Auth в облаке: Site URL и redirect — `https://bani-pwa-test.vercel.app/**`, регистрация выключена.

## Известные проблемы и что не проверено
- Push на реальном телефоне не проверен. Владелец должен включить уведомления в Настройках; на iPhone — только из приложения, добавленного на экран «Домой». Cron и обработчик уведомлений в облаке проверены: задачу подхватывает примерно за минуту.
- Был баг: шаг 6 скрипта без `--yes` не выполнялся, Vault оставался пуст и push молчали. Исправлено.
- В Vercel есть лишний проект «dist» (создан случайно), удалять его — пользователю.
- Для реальных клиентов нужны российский сервер (152-ФЗ), своя SMTP-почта и реальные юридические данные (иначе нельзя перевести в live).
- Кабинет на телефоне глазами проверялся только в эмуляции 375×812.

## Планы пользователя
Урезать функционал до необходимого минимума и добавлять возможности по ходу. Перед удалением фичи проверить связанные SQL-функции, тесты (pgTAP, integration, e2e) и `AGENTS.md`.
