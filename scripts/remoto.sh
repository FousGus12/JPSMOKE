#!/usr/bin/env bash
# Variables del Supabase remoto de JP Smoke. Se usa con `source`.
# El proyecto remoto aún no existe (D25: todo local hasta que Gustavo diga). Al crearlo, guardar su id:
#   security add-generic-password -U -a jp-smoke -s jp-smoke-project-ref -w
# Se niega a seguir con el id de otro proyecto (lección de GMDevz: scripts copiados con el id ajeno).
REF="${JPS_PROJECT_REF:-$(scripts/secreto.sh jp-smoke-project-ref 2>/dev/null || true)}"
case "$REF" in
  "") echo "ALTO: JP Smoke todavía no tiene proyecto remoto (guardar jp-smoke-project-ref en el Llavero)." >&2; exit 1 ;;
  oflckffxtrgndrubifgf|eqetrhpecxiixsmzrzqe|cswflictajaccsyayakv|ytziowwqdvvmgocfobme)
    echo "ALTO: $REF es el proyecto de Aura, Pulso, GMDevz o Rutami, no el de JP Smoke." >&2; exit 1 ;;
esac
POOLER="${JPS_POOLER_HOST:-$(scripts/secreto.sh jp-smoke-pooler-host)}"
export REF POOLER
