#!/usr/bin/env bash
# Respaldo diario de ChíaVial: base de datos (pg_dump) y fotos de reportes.
# aaPanel → Cron → Shell Script → diario 3:00 →  bash /www/wwwroot/chiavial/deploy/respaldo.sh
set -euo pipefail
CARPETA="${RESPALDOS:-/www/backup/chiavial}"
DIAS="${DIAS_RETENCION:-14}"
cd "$(dirname "$0")/.."
mkdir -p "$CARPETA"
FECHA=$(date +%Y%m%d-%H%M)
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U chiavial -d chiavial -Fc > "$CARPETA/chiavial-$FECHA.dump"
docker compose -f docker-compose.prod.yml exec -T app tar -czf - -C /app/api uploads > "$CARPETA/fotos-$FECHA.tar.gz"
find "$CARPETA" -type f \( -name 'chiavial-*.dump' -o -name 'fotos-*.tar.gz' \) -mtime +"$DIAS" -delete
echo "Respaldo listo: $CARPETA/chiavial-$FECHA.dump"
# Restaurar:  docker compose -f docker-compose.prod.yml exec -T db pg_restore -U chiavial -d chiavial --clean < archivo.dump
