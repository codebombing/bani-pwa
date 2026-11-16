#!/usr/bin/env bash
# Новая или изменённая баня на сервере в РФ без пересборки приложения:
#   npm run deploy:tenant -- <slug> [<slug>...]
# Конфиг → БД, фото → Storage, на сервер докладывается только /opt/site/s/<slug>/.
# Оболочка собирается из index.html и sw.js, которые уже лежат на сервере, — ссылки на JS совпадут.
set -euo pipefail

HOST="${RU_HOST:-root@91.132.188.117}"
DOMAIN="${RU_DOMAIN:-rubanybook.duckdns.org}"
ENV_FILE=".env.ru.local"
[[ $# -gt 0 ]] || { echo "Использование: npm run deploy:tenant -- <slug> [<slug>...]"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Нет $ENV_FILE — сначала npm run deploy:ru"; exit 1; }

mkdir -p dist
rsync -az "$HOST:/opt/site/index.html" "$HOST:/opt/site/sw.js" dist/
ENV_FILE="$ENV_FILE" npm run -s tenant:publish -- "$@"
for slug in "$@"; do
  rsync -az --delete "dist/s/$slug/" "$HOST:/opt/site/s/$slug/"
done
ENV_FILE="$ENV_FILE" npm run -s tenant:verify -- "$@" --base-url "https://$DOMAIN"
