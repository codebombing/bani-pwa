#!/usr/bin/env bash
# Выкладка на свой сервер в РФ: Supabase self-hosted + Caddy в /opt/supabase, сайт в /opt/site.
#   npm run deploy:ru                 — код, функции, миграции; заново публикуются бани, уже лежащие на сервере
#   npm run deploy:ru -- <slug>...    — то же + эти бани (первая выкладка)
# Одна новая баня без пересборки — npm run deploy:tenant -- <slug>.
# Ключи живут в .env.ru.local (gitignored) и в /opt/supabase/{.env,bani-functions.env} на сервере.
set -euo pipefail

HOST="${RU_HOST:-root@91.132.188.117}"
DOMAIN="${RU_DOMAIN:-rubanybook.duckdns.org}"
ENV_FILE=".env.ru.local"
SB=/opt/supabase
TUNNEL_PORT=54339
step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
remote() { ssh -o BatchMode=yes "$HOST" "$@"; }
remote_env() { remote "grep '^$1=' $SB/.env | cut -d= -f2-"; }

step "1/8 Ключи → $ENV_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
  read -r VAPID_PUBLIC VAPID_PRIVATE < <(npx -y web-push@3.6.7 generate-vapid-keys --json \
    | python3 -c 'import json,sys; k=json.load(sys.stdin); print(k["publicKey"], k["privateKey"])')
  umask 077
  cat > "$ENV_FILE" <<EOF
# Сервер в РФ ($HOST) — НЕ коммитить (gitignored).
VITE_SUPABASE_URL=https://$DOMAIN
VITE_SUPABASE_PUBLISHABLE_KEY=$(remote_env SUPABASE_PUBLISHABLE_KEY)
VITE_VAPID_PUBLIC_KEY=$VAPID_PUBLIC
SUPABASE_URL=https://$DOMAIN
SUPABASE_SECRET_KEY=$(remote_env SUPABASE_SECRET_KEY)
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
BOOKING_TOKEN_SECRET=$(openssl rand -base64 32)
SITE_URL=https://$DOMAIN
EOF
fi
val() { grep "^$1=" "$ENV_FILE" | cut -d= -f2-; }

step "2/8 Конфиги сервера и секреты функций"
scp -q scripts/deploy/ru/Caddyfile "$HOST:$SB/volumes/proxy/caddy/Caddyfile"
scp -q scripts/deploy/ru/docker-compose.bani.yml "$HOST:$SB/docker-compose.bani.yml"
printf 'BOOKING_TOKEN_SECRET=%s\nVAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\nVAPID_SUBJECT=mailto:admin@%s\n' \
  "$(val BOOKING_TOKEN_SECRET)" "$(val VITE_VAPID_PUBLIC_KEY)" "$(val VAPID_PRIVATE_KEY)" "$DOMAIN" \
  | remote "umask 077; mkdir -p /opt/site; cat > $SB/bani-functions.env"

step "3/8 Edge Functions"
rsync -az --delete --exclude .env --exclude '.env.*' supabase/functions/_shared supabase/functions/public-api \
  supabase/functions/notify-worker supabase/functions/ai-chat "$HOST:$SB/volumes/functions/"
# Edge runtime сервера берёт одну карту импортов на все функции — сливаем наши deno.json.
node -e '
  const fs = require("fs");
  const imports = { "@supabase/functions-js": "jsr:@supabase/functions-js@^2" };
  for (const f of ["public-api", "notify-worker", "ai-chat"])
    Object.assign(imports, JSON.parse(fs.readFileSync(`supabase/functions/${f}/deno.json`, "utf8")).imports);
  process.stdout.write(JSON.stringify({ imports }, null, 2) + "\n");
' | remote "cat > $SB/volumes/functions/deno.jsonc"

step "4/8 Стек Supabase + Caddy (первый запуск качает образы — несколько минут)"
remote "cd $SB && docker compose up -d --wait --remove-orphans >/dev/null && docker compose restart functions >/dev/null \
  && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"

step "5/8 Миграции, seed и cron уведомлений (через SSH-туннель)"
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -f -N -L "$TUNNEL_PORT:127.0.0.1:5432" "$HOST"
trap 'pkill -f "$TUNNEL_PORT:127.0.0.1:5432" || true' EXIT
DB_URL="$(python3 - "$(remote_env POSTGRES_PASSWORD)" "$TUNNEL_PORT" <<'PY'
import sys, urllib.parse as u
print(f"postgresql://postgres.bani:{u.quote(sys.argv[1], safe='')}@127.0.0.1:{sys.argv[2]}/postgres")
PY
)"
npx supabase db push --db-url "$DB_URL" --include-seed --yes
# pg_net в контейнере базы ходит к функции по внутренней сети docker.
SUPABASE_DB_URL="$DB_URL" SUPABASE_SECRET_KEY="$(val SUPABASE_SECRET_KEY)" \
  NOTIFY_WORKER_URL=http://api-gw:8000/functions/v1/notify-worker npm run -s notify:setup-local

step "6/8 Сборка с адресами сервера"
npx tsc -b
npx vite build --mode ru

step "7/8 Бани: БД, фото в Storage, оболочки dist/s/<slug>/"
SLUGS=($({ remote "ls /opt/site/s 2>/dev/null" || true; printf '%s\n' "$@"; } | sort -u))
[[ ${#SLUGS[@]} -gt 0 ]] || { echo "Нет бань: укажи slug — npm run deploy:ru -- <slug>..."; exit 1; }
ENV_FILE="$ENV_FILE" npm run -s tenant:publish -- "${SLUGS[@]}"

step "8/8 Сайт → $HOST:/opt/site и проверка"
rsync -az --delete dist/ "$HOST:/opt/site/"
ENV_FILE="$ENV_FILE" npm run -s tenant:verify -- "${SLUGS[@]}" --base-url "https://$DOMAIN"

printf '\n\033[1;32m✔ Готово\033[0m https://%s/s/%s/\n' "$DOMAIN" "${SLUGS[0]}"
