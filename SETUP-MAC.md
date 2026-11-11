# Что поставить на Мак до старта

Скилы уже лежат в проекте (`.claude/skills/`). Осталось то, что ставится только на сам Мак — это я сделать не могу.

## Обязательно

| Что | Проверка | Установка |
|---|---|---|
| Node.js 22+ | `node -v` | `brew install node@22` |
| Docker-движок (для локального Supabase) | `docker info` | `brew install --cask orbstack` (легче Docker Desktop на M-чипах) — запустить приложение один раз |
| Supabase CLI | `supabase --version` | `brew install supabase/tap/supabase` |
| Git | `git --version` | уже есть в macOS (Xcode CLT) |
| Claude Code | `claude --version` | https://claude.com/claude-code |

Проверка, что всё готово:

```bash
cd ~/development/bani-pwa
node -v && docker info >/dev/null && echo docker-ok && supabase --version && claude --version
```

## Желательно
- `npm install -g @playwright/cli@latest` — для скила playwright-cli (агент справится и через `npx playwright`, но так быстрее).
- Телефон iPhone и Android под рукой — в конце этапа 7 проверить установку «На экран Домой» и push. Локально телефон открывает приложение по IP Мака в той же Wi-Fi сети.

## Первый запуск
1. Подключить MCP Astryx к проекту (один раз):
   `cd ~/development/bani-pwa && claude mcp add --transport http --scope project astryx https://astryx.atmeta.com/mcp`
2. `claude` — при запуске согласиться доверять серверу astryx из `.mcp.json`.
3. Проверить скилы: `/skills` — должны быть ui-ux-pro-max, supabase, supabase-postgres-best-practices, shadcn, playwright-cli.
4. Вставить «Промт старта» из `PROMPT.md`.

## Не нужно для версии 1
- Аккаунт Supabase, Cloudflare, домен — понадобятся при переносе на сервер.
- Ключ LLM (Clodex и т.п.) — AI будет работать в тестах на тестовом провайдере, в UI покажет «AI недоступен».
- Онлайн-оплата (ЮKassa) — в v1 задатки вносятся вручную.

## Обновление скилов
- ui-ux-pro-max: `npx ui-ux-pro-max-cli update` (или `uipro update`)
- остальные: `npx skills update` в папке проекта
