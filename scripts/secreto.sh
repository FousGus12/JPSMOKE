#!/usr/bin/env bash
# Lee un secreto de JP Smoke del Llavero de macOS (cifrado, por usuario; nunca en el repo ni en el chat).
#   scripts/secreto.sh jp-smoke-db-password       clave de la base remota
#   scripts/secreto.sh jp-smoke-pooler-host       host del pooler (p. ej. aws-0-us-east-1.pooler.supabase.com)
#   scripts/secreto.sh jp-smoke-supabase-token    token de acceso de Supabase (desplegar funciones)
# Guardar o cambiar uno (lo pide sin mostrarlo):
#   security add-generic-password -U -a jp-smoke -s <nombre> -w
set -euo pipefail
security find-generic-password -a jp-smoke -s "${1:?Falta el nombre del secreto}" -w 2>/dev/null \
  || { echo "No está el secreto '$1' en el Llavero (ver HANDOFF.md, sección Infraestructura)." >&2; exit 1; }
