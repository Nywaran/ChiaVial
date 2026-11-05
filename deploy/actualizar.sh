#!/usr/bin/env bash
# Publica la última versión de GitHub en el VPS (las migraciones de BD se aplican solas al arrancar).
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f >/dev/null
docker compose -f docker-compose.prod.yml ps
