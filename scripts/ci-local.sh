#!/usr/bin/env bash
# Локальный CI — прогоняет ровно то, что .github/workflows/ci.yml (check +
# integration + coverage), но на этой машине и бесплатно. Эфемерные Postgres+
# Redis в docker, автоочистка. Запуск из корня setfork-frontend:
#   bash scripts/ci-local.sh          # всё
#   bash scripts/ci-local.sh --fast   # без build и без coverage (быстрая проверка)
#
# Audit / react-doctor / smoke — отдельные workflow, здесь не дублируются
# (npm audit и npx react-doctor гоняй точечно; smoke — из setfork-sim).
set -euo pipefail

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

PG=setfork-cilocal-pg
RD=setfork-cilocal-redis
PGPORT=55432
RDPORT=56379
export DATABASE_URL="postgresql://ci:ci@localhost:${PGPORT}/ci"
export AUTH_SECRET="ci-placeholder-secret-at-least-32-characters"
# REDIS_URL НЕ глобальный: unit-тест rate-limit должен идти in-memory (как в
# CI, где REDIS_URL живёт только на redis-шаге). Передаём инлайн ниже.
REDIS_URL_LOCAL="redis://localhost:${RDPORT}"

step() { echo ""; echo "▶ $*"; }
cleanup() { docker rm -f "$PG" "$RD" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step "Поднимаю эфемерные Postgres(pgvector)+Redis"
cleanup
docker run -d --name "$PG" -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=ci -p ${PGPORT}:5432 pgvector/pgvector:pg16 >/dev/null
docker run -d --name "$RD" -p ${RDPORT}:6379 redis:7-alpine >/dev/null
# pg_isready врёт «готов» во время recovery — ждём реальный SELECT + ставим
# extension с ретраем (первые секунды сервер ещё может отвергать соединения).
ok=0
for i in $(seq 1 40); do
  if docker exec "$PG" psql -U ci -d ci -tAc "SELECT 1" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || { echo "Postgres не поднялся за 40с"; docker logs "$PG" 2>&1 | tail -8; exit 1; }
for i in $(seq 1 10); do docker exec "$PG" psql -U ci -d ci -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null 2>&1 && break; sleep 1; done

step "npm ci (если lockfile новее node_modules)"
if [ package-lock.json -nt node_modules/.package-lock.json ] 2>/dev/null || [ ! -d node_modules ]; then npm ci; else echo "  node_modules свежие — пропуск"; fi

# ── check ──
step "lint";       npm run lint
step "typecheck";  npm run typecheck
step "test (unit)"; npm test
if [ "$FAST" = 0 ]; then step "build"; npm run build; fi

# ── integration ──
step "drizzle-kit push (эфемерная схема)"; npx drizzle-kit push --force
step "test:integration";                   npm run test:integration
step "redis rate-limit test";              REDIS_URL="$REDIS_URL_LOCAL" npx vitest run tests/shared/rate-limit-store.redis.test.ts

# ── coverage ──
if [ "$FAST" = 0 ]; then
  step "coverage:unit";        npm run coverage:unit
  step "coverage:integration"; npm run coverage:integration
  step "coverage:check";       npm run coverage:check
fi

echo ""
echo "✅ ЛОКАЛЬНЫЙ CI ЗЕЛЁНЫЙ$([ "$FAST" = 1 ] && echo ' (--fast: без build/coverage)')"
