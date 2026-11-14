#!/usr/bin/env bash
# Despliega una Edge Function de JP Smoke (con aprobación de Gustavo). Token en el Llavero.
#   scripts/desplegar-funcion.sh <nombre>
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?Falta el nombre de la función}"
[ -d "supabase/functions/$NAME" ] || { echo "No existe supabase/functions/$NAME" >&2; exit 1; }
JPS_POOLER_HOST=unused source scripts/remoto.sh
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-$(scripts/secreto.sh jp-smoke-supabase-token)}" \
  supabase functions deploy "$NAME" --project-ref "$REF"
