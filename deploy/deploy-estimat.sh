#!/usr/bin/env bash
# Деплой/обновление портала EstiMat (build-on-VPS, §19). Portal-scoped: не трогает
# соседние порталы, nginx и Keycloak. Подключается симлинком в /usr/local/bin/deploy-estimat.
#
#   deploy-estimat            — git pull + сборка образов + перезапуск API/SPA
#   deploy-estimat --migrate  — то же + накат миграций (нужны DDL-права в estimat.env)
#
# Конфиг и секреты читаются из /etc/estimat/estimat.env (FHS, 640 root:docker).
set -euo pipefail

ENV_FILE=/etc/estimat/estimat.env
SCRIPT="$(readlink -f "$0")"
PORTAL_DIR="$(cd "$(dirname "$SCRIPT")/.." && pwd)"   # repo root (/opt/portals/estimat)
COMPOSE=(docker compose -f "$PORTAL_DIR/deploy/docker-compose.prod.yml" -p estimat)

[ -r "$ENV_FILE" ] || { echo "Нет доступа к $ENV_FILE (нужны права чтения; см. deploy/README.md)"; exit 1; }

# VITE_API_URL (origin API) — build-arg фронта; берём из того же конфига, что и рантайм.
VITE_API_URL="$(grep -E '^VITE_API_URL=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
[ -n "$VITE_API_URL" ] || { echo "VITE_API_URL не задан в $ENV_FILE"; exit 1; }
export VITE_API_URL

echo "==> git pull"
if git -C "$PORTAL_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git -C "$PORTAL_DIR" pull --ff-only
else
  echo "git upstream не настроен — пропускаю pull"
fi

echo "==> build"
"${COMPOSE[@]}" build

if [ "${1:-}" = "--migrate" ]; then
  echo "==> migrate"
  "${COMPOSE[@]}" run --rm migrate
fi

echo "==> up"
"${COMPOSE[@]}" up -d estimat-api estimat-web

echo "==> health"
# Некритично: при первом запуске nginx/TLS ещё не настроены — это нормально.
if curl -fsS "${VITE_API_URL%/}/health/ready" >/dev/null 2>&1; then
  echo "health: ok"
else
  echo "health: недоступен по ${VITE_API_URL%/}/health/ready — проверьте nginx/TLS (см. README, шаг ingress)"
fi
echo "Готово."
