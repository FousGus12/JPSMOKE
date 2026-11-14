#!/usr/bin/env bash
# Crea una cuenta del equipo de un restaurante en el Supabase REMOTO de JP Smoke. Solo con aprobación de Gustavo.
#   scripts/crear-cuenta.sh <slug-restaurante> <correo> "<Nombre Apellido>" <admin|operador>
# - La clave secreta del proyecto se lee con la CLI (requiere `supabase login`) y nunca se imprime.
# - Genera una contraseña inicial aleatoria y la guarda en el Llavero como jp-smoke-cuenta-<correo>;
#   se lee con: security find-generic-password -a jp-smoke -s jp-smoke-cuenta-<correo> -w
# - El admin inscribe su código de dos pasos (TOTP) al entrar por primera vez; el operador no lo necesita (D19).
set -euo pipefail
cd "$(dirname "$0")/.."
SLUG="${1:?Falta el slug del restaurante}"; EMAIL="${2:?Falta el correo}"; NAME="${3:?Falta el nombre}"; ROLE="${4:?Falta el rol}"
case "$ROLE" in admin|operador) ;; *) echo "Rol inválido: $ROLE (admin u operador)" >&2; exit 1 ;; esac
[[ "$SLUG" =~ ^[a-z0-9-]+$ ]] || { echo "Slug inválido: $SLUG" >&2; exit 1; }
JPS_POOLER_HOST=unused source scripts/remoto.sh
SECRET=$(supabase projects api-keys --project-ref "$REF" --reveal -o json 2>/dev/null | python3 -c '
import json, sys
text = sys.stdin.read(); keys = json.loads(text[text.index("["):])
key = next((k for k in keys if k.get("type") == "secret"), None) or next(k for k in keys if k.get("name") == "service_role")
print(key["api_key"])')
PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
BODY=$(EMAIL="$EMAIL" NAME="$NAME" PASSWORD="$PASSWORD" python3 -c '
import json, os
print(json.dumps({"email": os.environ["EMAIL"], "password": os.environ["PASSWORD"], "email_confirm": True,
  "user_metadata": {"full_name": os.environ["NAME"]}}))')
STATUS=$(curl -s -o "$TMP/r.json" -w '%{http_code}' -X POST "https://$REF.supabase.co/auth/v1/admin/users" \
  -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d "$BODY")
if [ "$STATUS" != "200" ] && [ "$STATUS" != "201" ]; then
  echo "No se creó la cuenta (HTTP $STATUS): $(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("msg", "error"))' "$TMP/r.json" 2>/dev/null)" >&2
  exit 1
fi
USER_ID=$(python3 -c 'import json, sys, uuid; print(uuid.UUID(json.load(open(sys.argv[1]))["id"]))' "$TMP/r.json")
# Auth escribe app_metadata después del INSERT, así que el disparador no alcanza a ver el restaurante:
# la ficha del equipo se crea aquí (id validado como uuid, slug y rol por lista blanca, nombre escapado).
NAME_SQL=$(NAME="$NAME" python3 -c 'import os; print(os.environ["NAME"].replace("'"'"'", "'"''"'"))')
cat > "$TMP/staff.sql" <<SQL
insert into public.staff (user_id, restaurant_id, full_name, role)
select '$USER_ID', r.id, '$NAME_SQL', '$ROLE' from public.restaurants r where r.slug = '$SLUG'
on conflict (user_id) do update set restaurant_id = excluded.restaurant_id, role = excluded.role, active = true;
select count(*) from public.staff where user_id = '$USER_ID';
SQL
supabase db query --linked -f "$TMP/staff.sql" | grep -q 1 || { echo "ALTO: no existe el restaurante $SLUG; la cuenta quedó sin panel." >&2; exit 1; }
security add-generic-password -U -a jp-smoke -s "jp-smoke-cuenta-$EMAIL" -w "$PASSWORD"
echo "Cuenta creada: $EMAIL ($ROLE de $SLUG). Contraseña inicial en el Llavero: jp-smoke-cuenta-$EMAIL"
