#!/usr/bin/env sh
# Бэкап SetFork: логический дамп Postgres (pg_dump -Fc) + tar тома git-данных.
# Оба стейта из docker-compose: сервис `db` (pgdata) и том `gitdata` (/data/git —
# источник правды bare-репозиториев). Медиа (MinIO/S3) не бэкапим здесь — оно в
# отдельном S3 с собственной репликацией; при своём MinIO добавьте том `miniodata`.
#
# Запуск на прод-хосте:  ./scripts/backup.sh
# Расписание (cron, 03:15 UTC ежедневно):
#   15 3 * * *  cd /opt/setfork && ./scripts/backup.sh >> /var/log/setfork-backup.log 2>&1
#
# Переменные (все опциональны):
#   COMPOSE_FILE   compose-файл (по умолч. docker-compose.yml; в проде dokploy-вариант)
#   BACKUP_DIR     куда класть (по умолч. ./backups)
#   RETENTION_DAYS сколько хранить локально (по умолч. 14)
#   PROJECT        имя compose-проекта для имени тома (по умолч. имя папки)
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PROJECT="${COMPOSE_PROJECT_NAME:-${PROJECT:-$(basename "$(pwd)")}}"
PGUSER="${POSTGRES_USER:-sethub}"
PGDB="${POSTGRES_DB:-sethub}"
TS="$(date -u +%Y%m%d-%H%M%SZ)"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

mkdir -p "$BACKUP_DIR"
echo "[backup] $TS → $BACKUP_DIR (project=$PROJECT)"

# 1) Postgres — логический дамп в custom-формате (сжат, восстановим на любой pg16+).
db_file="$BACKUP_DIR/db-$TS.dump"
echo "[backup] pg_dump → $db_file"
dc exec -T db pg_dump -U "$PGUSER" -d "$PGDB" -Fc > "$db_file"

# 2) git-данные — tar тома через одноразовый alpine (том смонтирован read-only).
git_file="$BACKUP_DIR/git-$TS.tar.gz"
echo "[backup] tar ${PROJECT}_gitdata → $git_file"
docker run --rm \
  -v "${PROJECT}_gitdata:/src:ro" \
  -v "$(cd "$BACKUP_DIR" && pwd):/out" \
  alpine sh -c "tar czf /out/git-$TS.tar.gz -C /src ."

# 3) Контрольные суммы (проверка целостности при восстановлении).
( cd "$BACKUP_DIR" && sha256sum "db-$TS.dump" "git-$TS.tar.gz" > "manifest-$TS.sha256" )

# 4) Ретеншн: удаляем локальные бэкапы старше RETENTION_DAYS дней.
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'db-*.dump' -o -name 'git-*.tar.gz' -o -name 'manifest-*.sha256' \) \
  -mtime "+$RETENTION_DAYS" -print -delete

# 5) Offsite (РЕКОМЕНДУЕТСЯ): раскомментируйте и настройте rclone remote.
#    Локальный бэкап на том же хосте не спасает от потери хоста.
# rclone copy "$BACKUP_DIR/db-$TS.dump"   "$RCLONE_REMOTE" --immutable
# rclone copy "$BACKUP_DIR/git-$TS.tar.gz" "$RCLONE_REMOTE" --immutable

echo "[backup] OK: $(ls -1 "$BACKUP_DIR"/db-"$TS".dump "$BACKUP_DIR"/git-"$TS".tar.gz)"
