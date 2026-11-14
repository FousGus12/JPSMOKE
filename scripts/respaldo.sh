#!/usr/bin/env bash
# Respaldo de datos de JP Smoke (F10). El esquema vive en supabase/migrations; el respaldo guarda los DATOS
# (public + cuentas de auth) y un archivo de conteos para comprobar la restauración.
#   scripts/respaldo.sh volcar            # base local  → respaldos/local-AAAAMMDD-HHMM.sql.gz
#   scripts/respaldo.sh volcar remoto     # base remota → respaldos/remoto-…  (solo lectura)
#   scripts/respaldo.sh probar <archivo>  # SOLO LOCAL: base vacía con migraciones + datos + compara conteos
# Las fotos de la carta (bucket "carta") se respaldan aparte: ver docs/montaje.md §10.
# No vuelca auth.mfa_factors (semillas TOTP): al restaurar, cada admin vuelve a activar su código (auditoría 2026-11-02).
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
CONTAINER=supabase_db_jp-smoke
TABLES_SQL="select string_agg(format('select %L, count(*) from %I.%I', schemaname || '.' || relname, schemaname, relname), ' union all ' order by schemaname, relname)
  from pg_stat_user_tables where schemaname = 'public' or (schemaname = 'auth' and relname in ('users', 'identities'))"
# Dos pasadas: con -t, pg_dump ignora -n (solo volcaría auth).
DUMP_COMMON=(--data-only --no-owner --no-privileges)
DUMP_AUTH=(-t auth.users -t auth.identities)

counts() { # $@ = psql de destino
  local query; query=$("$@" -Atc "$TABLES_SQL")
  "$@" -AtF '|' -c "$query order by 1"
}

case "${1:-}" in
  volcar)
    mkdir -p respaldos
    stamp="$(date +%Y%m%d-%H%M)"
    if [ "${2:-local}" = "remoto" ]; then
      source scripts/remoto.sh
      # La clave va por PGPASSWORD (no en la URL: no queda en `ps` ni en el historial).
      export PGPASSWORD="${JPS_DB_PASSWORD:-$(scripts/secreto.sh jp-smoke-db-password)}"
      URL="postgresql://postgres.$REF@$POOLER:5432/postgres?sslmode=require"
      # pg_dump 17 desde imagen oficial: el de Homebrew (16) no lee servidores 17.
      out="respaldos/remoto-$stamp"
      { docker run --rm -e PGPASSWORD postgres:17 pg_dump "$URL" "${DUMP_COMMON[@]}" "${DUMP_AUTH[@]}"
        docker run --rm -e PGPASSWORD postgres:17 pg_dump "$URL" "${DUMP_COMMON[@]}" -n public; } | gzip > "$out.sql.gz"
      counts docker run --rm -i -e PGPASSWORD postgres:17 psql "$URL" > "$out.conteos"
    else
      out="respaldos/local-$stamp"
      { docker exec "$CONTAINER" pg_dump -U postgres -d postgres "${DUMP_COMMON[@]}" "${DUMP_AUTH[@]}"
        docker exec "$CONTAINER" pg_dump -U postgres -d postgres "${DUMP_COMMON[@]}" -n public; } | gzip > "$out.sql.gz"
      counts docker exec -i "$CONTAINER" psql -U postgres -d postgres > "$out.conteos"
    fi
    echo "Respaldo: $out.sql.gz ($(du -h "$out.sql.gz" | cut -f1)) · $(wc -l < "$out.conteos" | tr -d ' ') tablas · $(awk -F'|' '{s+=$2} END {print s}' "$out.conteos") filas"
    ;;
  probar)
    file="${2:?Uso: scripts/respaldo.sh probar respaldos/<archivo>.sql.gz}"
    expected="${file%.sql.gz}.conteos"
    [ -f "$expected" ] || { echo "Falta $expected" >&2; exit 1; }
    echo "1/3 Base local vacía con las migraciones del repo…"
    supabase db reset --local --no-seed >/dev/null 2>&1
    echo "2/3 Restaurando datos (sin disparar triggers: el inventario ya viene descontado)…"
    { echo "set session_replication_role = replica;"; gunzip -c "$file"; } |
      docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 >/dev/null
    echo "3/3 Comparando conteos…"
    if diff <(sort "$expected") <(counts docker exec -i "$CONTAINER" psql -U postgres -d postgres | sort); then
      echo "Restauración OK: $(wc -l < "$expected" | tr -d ' ') tablas idénticas."
    else
      echo "ALTO: los conteos no coinciden." >&2; exit 1
    fi
    echo "Nota: la base local quedó con los datos restaurados. Para volver al entorno de desarrollo: pnpm db:local"
    ;;
  *) sed -n 2,7p "$0"; exit 1 ;;
esac
