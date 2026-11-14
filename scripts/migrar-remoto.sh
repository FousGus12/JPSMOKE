#!/usr/bin/env bash
# Migraciones al Supabase remoto de JP Smoke. SIEMPRE simula primero; aplicar requiere --aplicar y la
# aprobación explícita de Gustavo por cada migración (skill migracion-remota). Nunca envía el seed
# ni los usuarios de desarrollo.
#   scripts/migrar-remoto.sh            # solo muestra qué se aplicaría
#   scripts/migrar-remoto.sh --aplicar  # aplica y verifica
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/remoto.sh
# La clave va por PGPASSWORD (no en la URL: no queda en `ps` ni en el historial).
export PGPASSWORD="${JPS_DB_PASSWORD:-$(scripts/secreto.sh jp-smoke-db-password)}"
URL="postgresql://postgres.$REF@$POOLER:5432/postgres?sslmode=require"
echo "Proyecto: $REF"
echo "Pendientes en el remoto:"
supabase db push --dry-run --db-url "$URL" 2>&1 | grep "•" || echo "  (ninguna)"
if [ "${1:-}" = "--aplicar" ]; then
  supabase db push --yes --db-url "$URL" >/dev/null
  echo "Aplicadas. Total en el remoto: $(psql "host=$POOLER port=5432 user=postgres.$REF dbname=postgres sslmode=require" -Atc 'select count(*) from supabase_migrations.schema_migrations')"
fi
