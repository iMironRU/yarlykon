#!/usr/bin/env bash
# Ярлыкон bootstrap — CLI обёртка.
#
# Использование:
#   bash scripts/bootstrap.sh
#   bash scripts/bootstrap.sh --stage=4         # запустить только стадию 4
#   bash scripts/bootstrap.sh --force --stage=4 # повторить стадию 4
#
# Конфиг можно передать через ENV или ответить интерактивно.

set -euo pipefail

cd "$(dirname "$0")/.."

# Проверка node
if ! command -v node >/dev/null 2>&1; then
  echo "✗ node не найден. Установи Node 20+."; exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "✗ нужен Node 20+, у тебя $(node -v)"; exit 1
fi

# Проверка wrangler
if ! command -v wrangler >/dev/null 2>&1; then
  echo "⚠ wrangler не установлен глобально. Поставлю локально в worker/."
  (cd worker && npm install --silent)
fi

# Передаём всё дальше движку
node scripts/bootstrap.mjs "$@"
