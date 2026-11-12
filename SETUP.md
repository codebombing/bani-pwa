# Запуск и эксплуатация

Что поставить на Мак — в [SETUP-MAC.md](SETUP-MAC.md). Здесь — как всё запустить, настроить и проверить.

## Локальный запуск (каждый раз)

```bash
npx supabase start          # БД, Auth, Storage, Mailpit (http://127.0.0.1:54324)
npm run dev:functions       # Edge Functions: public-api, notify-worker, ai-chat (отдельный терминал)
npm run dev                 # приложение: http://localhost:5173/s/demo-banya/
```

Первый раз (и после `npx supabase db reset`, который стирает БД, пользователей и Storage):

```bash
cp .env.example .env        # заполнить ключи из `npx supabase status`
npm run build
npm run demo:publish        # картинки демо-заведений в Storage + оболочки dist/s/<slug>/
npm run owner:invite -- demo-banya owner@demo-banya.test
npm run notify:setup-local  # pg_cron → notify-worker (адрес и ключ в Vault)
```

Кабинет владельца: http://localhost:5173/s/demo-banya/owner/ → почта → ссылка из Mailpit.
Собранное приложение с service worker и установкой: `npm run serve:dist` → http://localhost:8788/s/demo-banya/.

## Переменные

| Где | Переменная | Зачем |
|---|---|---|
| `.env` (публичные, попадают в бандл) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | клиент Supabase |
| | `VITE_VAPID_PUBLIC_KEY` | подписка на push в браузере |
| `.env` (только скрипты, НЕ `VITE_*`) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` | tenant:*, owner:invite, тесты |
| `supabase/functions/.env` (секреты функций) | `BOOKING_TOKEN_SECRET` | HMAC токенов брони (`openssl rand -base64 32`) |
| | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (`npx web-push generate-vapid-keys`) |
| | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | OpenAI-совместимый провайдер ассистента; пусто — ассистент отвечает по данным без LLM |
| | `LLM_TENANT_DAILY_REQUESTS`, `LLM_GLOBAL_DAILY_REQUESTS` | дневной бюджет запросов к LLM (по умолчанию 300 / 5000) |

Service role и LLM-ключ никогда не попадают в `VITE_*`.

## Уведомления (cron)

Миграция `notify_worker` ставит `cron.schedule('notify-worker', '* * * * *', …)`. Раз в минуту
`private.invoke_notify_worker()` проверяет очередь и через pg_net вызывает функцию `notify-worker`.
Адрес и ключ берутся из Vault (`notify_worker_url`, `notify_worker_key`); пока их нет — ничего не происходит.
Локально — `npm run notify:setup-local`. На сервере — один раз:

```sql
select vault.create_secret('https://<проект>/functions/v1/notify-worker', 'notify_worker_url');
select vault.create_secret('<секретный ключ>', 'notify_worker_key');
```

Заведения в статусе `preview` ничего не отправляют: задачи помечаются `simulated`.

## Публикация заведения

Пошагово — [CLONE-IN-6-MINUTES.md](CLONE-IN-6-MINUTES.md). Коротко:
`tenant:new` → `business.json` и картинки → `tenant:validate` → `npm run build && tenant:publish` → `tenant:verify` → `owner:invite` → `tenant:publish -- <slug> --live`.

Деплой статики: `dist/` целиком (общие `assets/`, `dist/s/<slug>/`, `_redirects`, `_headers`). После каждой
сборки (`npm run build` очищает dist) заново `npm run tenant:publish -- --all`.

## Проверки

```bash
npm run check:fast   # typecheck, lint, unit (без стека)
npm run check:all    # всё: + build, публикация демо, seed, validate, supabase test db,
                     #   integration, e2e (Playwright), tenant:verify. Нужны supabase start и dev:functions.
```

## Перенос на сервер

Раздел «Перенос на сервер» в [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md): для РФ — self-hosted
Supabase на российском VPS (152-ФЗ), `supabase db push`, `supabase functions deploy`, секреты функций,
Vault для cron, статика на HTTPS, `tenant:publish -- --all` против боевой БД, ручная проверка на iPhone и Android.
Что не проверено локально — в [ACCEPTANCE.md](ACCEPTANCE.md).
