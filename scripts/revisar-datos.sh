#!/usr/bin/env bash
# Revisión de datos sensibles de JP Smoke antes de unir (docs/flujo-despliegue.md).
# Busca en los archivos que cambian frente a main: claves, tokens, cadenas de conexión con
# clave, llaves privadas, archivos .env y volcados de base de datos. No mira node_modules.
#   scripts/revisar-datos.sh            compara contra origin/main (o main)
#   scripts/revisar-datos.sh <ref>      compara contra otra rama o commit
# Sale con error si encuentra algo; cada hallazgo muestra archivo y línea, nunca el valor.
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-$(git rev-parse --verify -q origin/main >/dev/null && echo origin/main || echo main)}"
FILES=$(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD; git diff --name-only --diff-filter=ACMR; git ls-files --others --exclude-standard)
FILES=$(printf "%s\n" "$FILES" | sort -u | grep -v '^$' | grep -vE '^(pnpm-lock\.yaml|scripts/revisar-datos\.sh)$')
FOUND=0

flag() { echo "  ✗ $1"; FOUND=1; }

# Archivos que nunca deben entrar al repo.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .env|.env.local|*/.env|*.env.local|.env.*.local) flag "$f: archivo .env (solo .env.example y .env.production van al repo)";;
    *.dump|*.backup|*.sql.gz|*.pgdump|dump*.sql|backup*.sql) flag "$f: parece un volcado de base de datos";;
    *.pem|*.p12|*.key) flag "$f: llave o certificado";;
  esac
done <<< "$FILES"

# Patrones de secretos dentro de los archivos (nombre del patrón, expresión regular).
PATTERNS=(
  "token de Supabase|sbp_[A-Za-z0-9]{20,}"
  "clave secreta de Supabase|sb_secret_[A-Za-z0-9_-]{10,}"
  "JWT de service_role|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*(InJvbGUiOiJzZXJ2aWNl|Jyb2xlIjoic2VydmljZV|icm9sZSI6InNlcnZpY2V)"
  "cadena de conexión con clave|postgres(ql)?://[^:@/ ]+:[^@<> ]{6,}@[^ ]*(supabase|pooler|amazonaws|azure)"
  "llave privada|-----BEGIN [A-Z ]*PRIVATE KEY-----"
  "llave de GitHub|gh[pousr]_[A-Za-z0-9]{30,}"
  "llave de OpenAI o Anthropic|sk-(ant-)?[A-Za-z0-9_-]{24,}"
  "llave privada VAPID asignada|VAPID_PRIVATE_KEY *= *['\"]?[A-Za-z0-9_-]{30,}"
)
while IFS= read -r f; do
  [ -z "$f" ] || [ ! -f "$f" ] && continue
  for p in "${PATTERNS[@]}"; do
    name="${p%%|*}"; re="${p#*|}"
    lines=$(grep -nE "$re" "$f" 2>/dev/null | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
    [ -n "$lines" ] && flag "$f (línea $lines): $name"
  done
done <<< "$FILES"

if [ $FOUND -eq 0 ]; then
  echo "  ✓ sin datos sensibles en $(printf "%s\n" "$FILES" | grep -c .) archivos cambiados frente a $BASE"
else
  echo "Revisa los hallazgos: quita el valor del archivo y rota la clave si ya salió del equipo."
  exit 1
fi
