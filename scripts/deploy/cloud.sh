#!/usr/bin/env bash
# Тестовый деплой в облако: Supabase Cloud (БД, функции) + Vercel (статика).
# Запуск:  bash scripts/deploy/cloud.sh <project-ref> [vercel-project-name]
# Пароль базы спросит `supabase link` — его вводишь ты. Ключи и секреты пишутся только
# в .env.cloud.local (gitignored) и в секреты функций Supabase.
# Повторный запуск безопасен: миграции идут по истории, функции и сайт перевыкладываются.
set -euo pipefail

REF="${1:?Укажи project ref: bash scripts/deploy/cloud.sh <ref>}"
VERCEL_NAME="${2:-bani-pwa-test}"
ENV_FILE=".env.cloud.local"
SB="npx supabase"
step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }

step "1/8 Привязка к проекту $REF (спросит пароль базы)"
$SB link --project-ref "$REF"

step "2/8 Миграции + демо-данные (seed)"
if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  # Пароль базы вводишь ты; он живёт только в этом процессе и никуда не записывается.
  read -rsp "Пароль базы Supabase (символы не видны): " SUPABASE_DB_PASSWORD
  echo
  export SUPABASE_DB_PASSWORD
fi
# Порт 5432 пула у некоторых провайдеров обрывается — подключаемся через 6543 (TLS).
POOLER_HOST="$(sed -E 's#^.*@([^:/]+).*$#\1#' supabase/.temp/pooler-url)"
DB_URL="$(python3 - "$REF" "$SUPABASE_DB_PASSWORD" "$POOLER_HOST" <<'PY'
import sys, urllib.parse as u
ref, pw, host = sys.argv[1:4]
print(f"postgresql://postgres.{ref}:{u.quote(pw, safe='')}@{host}:6543/postgres")
PY
)"
$SB db push --db-url "$DB_URL" --include-seed --yes

step "3/8 Ключи проекта → $ENV_FILE"
KEYS_JSON="$($SB projects api-keys --remote="$REF" --reveal --output json)"
read -r PUBLISHABLE SECRET < <(python3 - "$KEYS_JSON" <<'PY'
import json, sys
keys = json.loads(sys.argv[1])
if isinstance(keys, dict):
    keys = keys.get("keys") or keys.get("api_keys") or []
def pick(kind, legacy):
    for k in keys:
        if k.get("type") == kind and k.get("api_key"):
            return k["api_key"]
    for k in keys:
        if k.get("name") == legacy and k.get("api_key"):
            return k["api_key"]
    return ""
print(pick("publishable", "anon"), pick("secret", "service_role"))
PY
)
[[ -n "$PUBLISHABLE" && -n "$SECRET" ]] || { echo "Не удалось получить ключи API"; exit 1; }

if [[ -f "$ENV_FILE" ]] && grep -q '^VAPID_PRIVATE_KEY=' "$ENV_FILE"; then
  VAPID_PUBLIC="$(grep '^VITE_VAPID_PUBLIC_KEY=' "$ENV_FILE" | cut -d= -f2-)"
  VAPID_PRIVATE="$(grep '^VAPID_PRIVATE_KEY=' "$ENV_FILE" | cut -d= -f2-)"
  TOKEN_SECRET="$(grep '^BOOKING_TOKEN_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
else
  read -r VAPID_PUBLIC VAPID_PRIVATE < <(npx -y web-push@3.6.7 generate-vapid-keys --json \
    | python3 -c 'import json,sys; k=json.load(sys.stdin); print(k["publicKey"], k["privateKey"])')
  TOKEN_SECRET="$(openssl rand -base64 32)"
fi

umask 077
cat > "$ENV_FILE" <<EOF
# Облачный тестовый проект $REF — НЕ коммитить (gitignored).
VITE_SUPABASE_URL=https://$REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE
VITE_VAPID_PUBLIC_KEY=$VAPID_PUBLIC
SUPABASE_URL=https://$REF.supabase.co
SUPABASE_SECRET_KEY=$SECRET
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
BOOKING_TOKEN_SECRET=$TOKEN_SECRET
EOF

step "4/8 Секреты функций"
SECRETS_FILE="$(mktemp)"
trap 'rm -f "$SECRETS_FILE"' EXIT
cat > "$SECRETS_FILE" <<EOF
BOOKING_TOKEN_SECRET=$TOKEN_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
VAPID_SUBJECT=mailto:admin@bani.local
EOF
$SB secrets set --env-file "$SECRETS_FILE" --yes

step "5/8 Edge Functions"
$SB functions deploy public-api notify-worker ai-chat --use-api --yes

step "6/8 Cron уведомлений: адрес и ключ в Vault"
$SB db query --db-url "$DB_URL" "
  delete from vault.secrets where name in ('notify_worker_url', 'notify_worker_key');
  select vault.create_secret('https://$REF.supabase.co/functions/v1/notify-worker', 'notify_worker_url');
  select vault.create_secret('$SECRET', 'notify_worker_key');
" > /dev/null
# Проверка: cron будит воркер (последние запуски и ответы pg_net).
$SB db query --db-url "$DB_URL" "
  select status, left(return_message, 120) as message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'notify-worker')
  order by start_time desc limit 3;
  select status_code, left(coalesce(error_msg, content::text), 120) as answer, created
  from net._http_response order by created desc limit 3;
" || true

step "7/8 Сборка с облачными адресами и публикация демо-заведений"
npx tsc -b
npx vite build --mode cloud
ENV_FILE="$ENV_FILE" npm run -s tenant:publish -- --all

step "8/8 Выкладка на Vercel"
URL="$(npx -y vercel@65.15.0 deploy dist --prod --yes --name "$VERCEL_NAME" 2>/dev/null | tail -1)"
echo "SITE_URL=$URL" >> "$ENV_FILE"

printf '\n\033[1;32m✔ Готово\033[0m\n  Сайт: %s/s/demo-banya/\n  Кабинет: %s/s/demo-banya/owner/\n' "$URL" "$URL"
