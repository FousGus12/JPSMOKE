# Montaje en producción · JP Smoke (y cada restaurante nuevo)

Guía para pasar de local a Supabase + Vercel **cuando Gustavo lo apruebe** (D25). Cada paso marcado 🔒 requiere su aprobación explícita (CLAUDE.md). Nada de esto se ha ejecutado todavía.

Orden: Supabase → secretos → migraciones → funciones → datos del restaurante → cuentas → Vercel → pruebas → lanzar.

## 0. Antes de empezar

- [ ] `pnpm verify:release` en verde en local (base limpia + todo + celular).
- [ ] 2FA activo en GitHub, Supabase y Vercel (cuenta de Gustavo).
- [ ] Logo, carta real (precios y fotos), zonas y medios de pago confirmados por el restaurante.
- [ ] Dominio decidido (opcional; sin dominio se usa `<slug>.vercel.app`).

## 1. Repositorio 🔒

1. Crear repo privado en GitHub (CLOUP.CO). Rama `main` protegida con CI obligatoria; rama `produccion` para Vercel.
2. Primer commit desde `jp-smoke/` (el hook bloquea secretos; `respaldos/` y `.env*` ya están ignorados).

## 2. Supabase 🔒 (costo: plan gratuito al inicio; Pro USD 25/mes para respaldo diario y sin pausa)

1. Crear proyecto en región **São Paulo (sa-east-1)**, contraseña de base generada y guardada en el Llavero:
   `security add-generic-password -U -a jp-smoke -s jp-smoke-db-password -w`
2. Guardar en el Llavero: `jp-smoke-project-ref`, `jp-smoke-pooler-host`, `jp-smoke-supabase-token` (token personal de la CLI).
3. `supabase link --project-ref <ref>`. `scripts/remoto.sh` se niega a seguir si el ref es de Aura, Pulso, GMDevz o Rutami.
4. Auth → URL del sitio y redirecciones: dominio final y `https://*.vercel.app` de vistas previas. SSL obligatorio en *Database settings*.

## 3. Secretos de las Edge Functions 🔒

`supabase secrets set --project-ref <ref> NOMBRE=valor` (nunca en el repo ni en el chat):

| Secreto | Valor |
|---|---|
| `CORS_ALLOWED_ORIGINS` | `https://<dominio>,https://<slug>-*.vercel.app` (sin `local`) |
| `TURNSTILE_SECRET` | Clave secreta de Cloudflare Turnstile (gratis) |
| `IP_SALT` | Aleatorio: `openssl rand -hex 32` |
| `MAX_PER_HOUR_IP` | `20` (local usa 1000 para las pruebas) |
| `WHATSAPP_CRON_SECRET` | Aleatorio: `openssl rand -hex 32` |
| `VERCEL_DEPLOY_HOOKS` | JSON `{"jp-smoke":"https://api.vercel.com/v1/integrations/deploy/…"}` (paso 7) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | Solo al activar WhatsApp real 🔒 (D32, costo por conversación de Meta) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase solo.

Vault (lo usa pg_cron para llamar a la función `whatsapp`), en el editor SQL del proyecto:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/whatsapp', 'jps_whatsapp_url');
select vault.create_secret('<mismo WHATSAPP_CRON_SECRET>', 'jps_whatsapp_secret');
```

## 4. Migraciones 🔒

```bash
scripts/migrar-remoto.sh            # simula: lista las 10 migraciones pendientes
scripts/migrar-remoto.sh --aplicar  # aplica (con aprobación por migración)
```

Después: *Advisors → Security* en el panel de Supabase sin alertas; correr `supabase test db --linked` **no**: las pruebas pgTAP crean datos; se corren solo en local.

## 5. Edge Functions 🔒

```bash
for f in crear-pedido seguir-pedido captar cotizar publicar whatsapp; do scripts/desplegar-funcion.sh $f; done
```

`verify_jwt` de cada una sale de `supabase/config.toml` (solo `publicar` exige sesión).

## 6. Datos del restaurante y cuentas 🔒

1. Revisar `supabase/tenants/<slug>.sql` con los datos reales (sin reseñas inventadas: `reviews` vacía hasta tener reales) y correrlo **una vez** en el editor SQL. Es idempotente.
2. Cuentas: `scripts/crear-cuenta.sh <slug> <correo> "<Nombre>" admin` y lo mismo con `operador`. La contraseña inicial queda en el Llavero; se entrega en persona. El admin activa su código de dos pasos al entrar.
3. **Nunca** correr `supabase/dev-users.sql` ni el seed local en remoto.

## 7. Vercel 🔒 (gratis para empezar; Pro USD 20/mes si se vende a terceros con uso comercial)

1. Proyecto desde el repo, rama de producción `produccion`, *framework* Astro, `pnpm build`.
2. Variables (Production y Preview):
   `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_RESTAURANT_SLUG`, `PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_MEDIA_BASE` (vacío = Storage de Supabase), `SITE_URL`, `SITE_INDEXABLE=false` hasta lanzar.
3. Crear *Deploy Hook* de la rama `produccion` y guardarlo en `VERCEL_DEPLOY_HOOKS` (paso 3). Es lo que dispara "Publicar" del panel.
4. Dominio: apuntar DNS y esperar HTTPS. `vercel.json` ya trae CSP, HSTS y demás cabeceras.

## 8. Pruebas en producción (antes de anunciar)

- [ ] Abrir el sitio en celular Android e iPhone: bienvenida, carta, carrito, cupón.
- [ ] Pedido real con el celular de Gustavo → aparece en el tablero en vivo → avanzar estados → el enlace de seguimiento cambia.
- [ ] Pedido "Recoger en tienda" (si el local abrió) y pedido con producto agotado.
- [ ] Cancelar un pedido y ver que el inventario vuelve.
- [ ] Panel: entrar como admin (con código) y como operador; Publicar un cambio y verlo en ~1 min.
- [ ] Turnstile visible y funcionando; 3 pedidos seguidos desde la misma IP sin bloquear a un cliente normal.
- [ ] `X-Forwarded-For`: con una función de prueba temporal que devuelva el encabezado, llamar con `X-Forwarded-For: 203.0.113.7`; si el primer valor llega intacto, ajustar `prelude` para tomar la IP que agrega el proxy (auditoría 2026-11-02, hallazgo 2).
- [ ] `scripts/respaldo.sh volcar remoto` y `scripts/respaldo.sh probar <archivo>` en local: conteos idénticos.

## 9. Lanzar

`SITE_INDEXABLE=true`, publicar, enviar `sitemap.xml` en Google Search Console y crear/actualizar el perfil de Google Business (la dirección del local solo cuando abra: pestaña *Punto físico* del panel).

## 10. Respaldo

- **Datos**: `scripts/respaldo.sh volcar remoto` (solo lectura) guarda datos de `public` y cuentas de `auth` + conteos en `respaldos/` (ignorado por git). Semanal mientras sea plan gratuito; con Pro, Supabase hace respaldo diario y este queda como copia propia.
- **Restaurar**: el esquema sale de `supabase/migrations`; los datos del volcado. `scripts/respaldo.sh probar <archivo>` lo ensaya en local y compara tabla por tabla (probado 2026-11-01: 27 tablas idénticas).
- **Fotos de la carta**: `supabase storage cp -r ss:///carta respaldos/carta --experimental --linked`.
- Guardar una copia fuera del Mac (disco externo o nube de CLOUP.CO).

## 11. Restaurante nuevo (mismo código, D23/D24)

1. Copiar `supabase/tenants/jp-smoke.sql` a `supabase/tenants/<slug>.sql`, cambiar datos y correrlo 🔒.
2. Crear cuentas con `scripts/crear-cuenta.sh <slug> …`.
3. Nuevo proyecto de Vercel desde el mismo repo con `PUBLIC_RESTAURANT_SLUG=<slug>` y su propio Deploy Hook; agregarlo al JSON de `VERCEL_DEPLOY_HOOKS` y su dominio a `CORS_ALLOWED_ORIGINS`.
4. Plan según ROADMAP §17 (89k / 149k / 249k COP).
