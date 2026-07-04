#!/usr/bin/env sh
# Восстановление SetFork из бэкапа (см. scripts/backup.sh). ДЕСТРУКТИВНО:
# перезаписывает БД и том git-данных. Требует явного подтверждения.
#
# Использование:
#   ./scripts/restore.sh <TIMESTAMP>            # напр. 20260704-031500Z
#   ./scripts/restore.sh <db-*.dump> <git-*.tar.gz>
#
# Порядок в проде: остановить app+core (чтобы никто не писал), восстановить, поднять.
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
PROJECT="${COMPOSE_PROJECT_NAME:-${PROJECT:-$(basename "$(pwd)")}}"
PGUSER="${POSTGRES_USER:-sethub}"
PGDB="${POSTGRES_DB:-sethub}"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

if [ "$#" -eq 1 ]; then
  db_file="$BACKUP_DIR/db-$1.dump"
  git_file="$BACKUP_DIR/git-$1.tar.gz"
elif [ "$#" -eq 2 ]; then
  db_file="$1"; git_file="$2"
else
  echo "usage: $0 <TIMESTAMP> | <db.dump> <git.tar.gz>" >&2; exit 2
fi

[ -f "$db_file" ]  || { echo "нет файла БД: $db_file" >&2; exit 1; }
[ -f "$git_file" ] || { echo "нет файла git: $git_file" >&2; exit 1; }

echo "ВНИМАНИЕ: перезапишу БД '$PGDB' и том ${PROJECT}_gitdata из:"
echo "  db : $db_file"
echo "  git: $git_file"
printf 'Продолжить? введите YES: '
read -r ans
[ "$ans" = "YES" ] || { echo "отменено."; exit 1; }

# Остановить пишущие сервисы, БД оставить поднятой.
echo "[restore] stop app/core"
dc stop app core 2>/dev/null || true
dc up -d db
# дождаться готовности БД
until dc exec -T db pg_isready -U "$PGUSER" -d "$PGDB" >/dev/null 2>&1; do sleep 1; done

# 1) БД: pg_restore --clean пересоздаёт объекты поверх текущей схемы.
echo "[restore] pg_restore"
dc exec -T db pg_restore -U "$PGUSER" -d "$PGDB" --clean --if-exists --no-owner < "$db_file"

# 2) git-том: очистить и распаковать заново (alpine-хелпер).
echo "[restore] расписать git-том"
docker run --rm \
  -v "${PROJECT}_gitdata:/dst" \
  -v "$(cd "$(dirname "$git_file")" && pwd):/in:ro" \
  alpine sh -c "rm -rf /dst/* /dst/..?* /dst/.[!.]* 2>/dev/null; tar xzf /in/$(basename "$git_file") -C /dst"

echo "[restore] поднять стек"
dc up -d
echo "[restore] готово. Проверьте /admin и git clone одного из списков."
