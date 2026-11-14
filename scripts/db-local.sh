#!/usr/bin/env bash
# Deja la base local lista en un comando: reset (migraciones + seed), usuarios de desarrollo,
# .env.local con las claves locales y tipos de TypeScript. Contraseña local: JpSmokeDev-2026.
# Puertos 573xx para convivir con Pulso (543xx), GMDevz (553xx) y Aura (563xx).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="postgresql://postgres:postgres@127.0.0.1:57322/postgres"
supabase status >/dev/null 2>&1 || supabase start -x imgproxy,vector,logflare,supavisor >/dev/null 2>&1
supabase db reset >/dev/null 2>&1 || { echo "Falló supabase db reset"; supabase db reset 2>&1 | tail -5; exit 1; }
psql "$DB" -q -f supabase/dev-users.sql >/dev/null
ANON=$(supabase status -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["ANON_KEY"])')
{
  echo "PUBLIC_SUPABASE_URL=http://127.0.0.1:57321"
  echo "PUBLIC_SUPABASE_ANON_KEY=$ANON"
  echo "PUBLIC_RESTAURANT_SLUG=jp-smoke"
  echo "SITE_URL=http://127.0.0.1:4331"
} > .env.local
# WhatsApp (F9): el cron local llama la función por la red de Docker con un secreto solo local.
WA_SECRET=$(sed -n 's/^WHATSAPP_CRON_SECRET=//p' supabase/functions/.env 2>/dev/null || true)
[ -n "$WA_SECRET" ] || WA_SECRET="local-$(openssl rand -hex 16)"
printf 'TURNSTILE_SECRET=off-local\nIP_SALT=local\nMAX_PER_HOUR_IP=1000\nWHATSAPP_CRON_SECRET=%s\n' "$WA_SECRET" > supabase/functions/.env
psql "$DB" -q -c "select vault.create_secret('http://supabase_kong_jp-smoke:8000/functions/v1/whatsapp', 'jps_whatsapp_url'), vault.create_secret('$WA_SECRET', 'jps_whatsapp_secret');" >/dev/null
mkdir -p src/lib
supabase gen types typescript --local 2>/dev/null > src/lib/database.types.ts
echo "Base local lista: $(psql "$DB" -Atc 'select count(*) from supabase_migrations.schema_migrations') migraciones, $(psql "$DB" -Atc 'select count(*) from public.staff') cuentas dev, tipos generados."
# Los builds locales (verify:full, e2e) leen la base local.
cp .env.local .env.production.local
