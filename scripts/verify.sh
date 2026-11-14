#!/usr/bin/env bash
# Verificación de JP Smoke con salida resumida (una línea por paso; detalle solo si falla).
#   scripts/verify.sh          rápida: tipos, lint, formato, unitarias. Para cada cambio.
#   scripts/verify.sh full     + datos sensibles, build, RLS (pgTAP), e2e escritorio. Antes de commit/PR.
#   scripts/verify.sh release  base limpia + full + e2e en Android e iPhone simulados. Antes de producción.
# Requiere Supabase local corriendo para RLS (scripts/db-local.sh lo deja listo).
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-quick}"
LOG_DIR="${TMPDIR:-/tmp}/jp-smoke-verify"; mkdir -p "$LOG_DIR"
FAILED=0

step() { # nombre, comando, patrón de resumen
  local name="$1" cmd="$2" summary="${3:-}" log="$LOG_DIR/$1.log" start=$SECONDS
  if bash -c "$cmd" >"$log" 2>&1; then
    local info=""; [ -n "$summary" ] && info=$(grep -Eo "$summary" "$log" | tail -1)
    printf "  ✓ %-10s %3ss  %s\n" "$name" "$((SECONDS - start))" "$info"
  else
    FAILED=1
    printf "  ✗ %-10s %3ss  (log: %s)\n" "$name" "$((SECONDS - start))" "$log"
    grep -E "error|Error|✘|FAIL|not ok|failed|warn" "$log" | grep -v "^\s*$" | head -12 | sed 's/^/      /'
  fi
}

dups=$(find . -path ./node_modules -prune -o -name "* 2*" -print | grep -vc node_modules)
[ "$dups" != "0" ] && { echo "  ✗ hay $dups copias \"archivo 2\" (iCloud): revisar antes de seguir"; FAILED=1; }

echo "Verificación ($MODE)"
[ "$MODE" = "release" ] && step base "scripts/db-local.sh"
step tipos "pnpm -s typecheck" "[0-9]+ errors"
step lint "pnpm -s lint"
step formato "pnpm -s format:check"
step unitarias "pnpm -s test" "Tests +[0-9]+ passed"
if [ "$MODE" != "quick" ]; then
  step datos "scripts/revisar-datos.sh" "sin datos sensibles en [0-9]+ archivos"
  step build "pnpm -s exec astro build && node scripts/revisar-build.mjs" "[0-9]+ páginas revisadas"
  step rls "supabase test db" "Tests=[0-9]+"
  step simultaneos "scripts/prueba-simultaneos.sh" "1 de 2 pasó"
  E2E_PROJECTS="--project=escritorio"; [ "$MODE" = "release" ] && E2E_PROJECTS=""
  step e2e "pnpm -s exec playwright test $E2E_PROJECTS --workers=1 --reporter=line" "[0-9]+ passed"
  for fn in supabase/functions/*/deno.json; do
    d=$(dirname "$fn"); n=$(basename "$d")
    step "deno:$n" "cd $d && deno task check >/dev/null && deno task test" "[0-9]+ passed"
  done
fi
[ $FAILED -eq 0 ] && echo "Todo en verde." || { echo "Hay fallas."; exit 1; }
