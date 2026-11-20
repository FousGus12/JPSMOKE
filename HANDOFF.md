# HANDOFF · JP Smoke

> **Última actualización:** 2026-11-20 (v0.19: D56–D67, oleada 4) · **Roadmap:** v0.19 · **Git:** v0.19 (`df06149`) en `main` y `produccion` (PR #7); **publicada 2026-11-20**
>
> **Para retomar en otro chat** (copiar tal cual):
>
> ```text
> Vas a continuar el proyecto JP Smoke en /Users/gustavo/Developer/jp-smoke.
> 1. Lee HANDOFF.md y CLAUDE.md (del ROADMAP.md solo §12 fases, §14 decisiones y §16 pendientes).
> 2. Levanta lo local: `colima start` si Docker no responde; `supabase start -x imgproxy,vector,logflare,supavisor`; `pnpm db:local`.
> 3. Corre `scripts/verify.sh` y resúmeme en 3 líneas dónde estamos y qué sigue.
> Sigue ~/Developer/_manual/MANUAL-PROYECTOS.md (y aliméntalo). Montaje aprobado (D36): sigue docs/montaje.md desde donde dice HANDOFF §3.
> Al cerrar cada bloque actualiza HANDOFF.md y ROADMAP.md.
> Modo de trabajo: subagentes con Fable 5.2 como planificador (CLAUDE.md). Plan v0.18 en docs/plan-v0.18.md; pendientes de Gustavo en docs/backlog-gustavo.md.
Lo que necesito ahora es:
> [pedido]
> ```

## 1. Qué es

Micro app de pedidos para restaurantes, empezando por **JP Smoke** (hamburguesas al barril, Bogotá, solo domicilio por ahora). Pensada para venderse a varios restaurantes con el mismo código (D23) y **base compartida** con `restaurant_id` en todo (D24).

- **Sitio público** (Astro): carta, carrito, pedido con un solo botón, seguimiento sin cuenta por enlace único, bienvenida (pantalla completa o aviso con cupón), promociones, eventos, cotización de eventos, legales, SEO.
- **Panel** (`/panel`, React): pedidos en vivo, ventas y estadísticas, inventario de insumos, WhatsApp automático, carta y precios, editar página, promociones y cupones, eventos y banners. Roles admin (con código de dos pasos exigido por la base) y operador (solo Resumen y Pedidos).

**Fuentes de verdad:** `ROADMAP.md` (alcance, fases §12, decisiones D1–D35 §14, pendientes §16, producto multi-restaurante §17) → `mockup/` (referencia visual aprobada) → `docs/diseno/DESIGN.md` (diseño Vino, D3, D18, D27) → `CLAUDE.md` (cómo trabajar).

## 2. Estado por fase

| Fase | Estado |
|---|---|
| F0 Definición · F1 Marca (inventada) · F2 Mockup | Cerradas. Carta, logo y fotos reales siguen pendientes de Gustavo |
| F3 Cimientos | Hecha en local. Falta crear GitHub, Supabase y Vercel (D25) |
| F4 Sitio público + SEO | Hecha en local |
| F5 Panel de pedidos | Hecha en local |
| F6 Editor de carta y página | Hecha en local |
| F7 Promociones, cupones, eventos, cotizaciones | Hecha en local |
| F8 Ventas y estadísticas, cierre de caja, informe semanal | Hecha en local |
| F8b Inventario de insumos (recetas, descuento al entrar el pedido, devolución al cancelar) | Hecha en local (D30) |
| F9 WhatsApp automático | Hecha en local en **modo prueba** (D32). Envíos reales: falta cuenta de Meta, token, plantillas aprobadas y aprobación del costo |
| F10 Punto físico y versión final | Hecha en local (D33, D34): punto físico y recoger en tienda, revisión de seguridad, respaldo probado, guía de montaje, `verify:release` en verde |
| Auditoría 2026-11-02 | Skill `security-audit` de Cloudflare, 6 fases, 51 agentes: 4 hallazgos confirmados en local y corregidos, 2 mitigados, 1 rechazado (`docs/seguridad/auditoria-2026-11-02.md`, D35) |
| **Montaje en producción** | **Siguiente, cuando Gustavo apruebe** (`docs/montaje.md`) |

## 2a. Bloque v0.19 (oleada 4, 2026-11-20) — publicado

**v0.19.1 (correcciones de la revisión final de Fable):** migración `20261120130000_correcciones_v0191.sql` (`revoke_promos`, `customers_promo_export` como un jsonb, `customers_list.promos`, `cancelled_today`, resumen de plataformas sin casadas anuladas); sitio: exprés solo registra promociones con casilla visible y un segundo pedido vuelve a pedir autorizaciones; Clientes con "Retirar autorización". `verify.sh release` en verde (286 unitarias, 360 pgTAP, 244 e2e).

**Despliegue 2026-11-20 (aprobado por Gustavo):** 4 migraciones aplicadas (21 en remoto; anon solo `ordering_status`, `stock_status`, `track_order`; RLS y `search_path` completos), 7 Edge Functions desplegadas, `main` y `produccion` en `df06149` (`/version.json` = `df061490563e`). Humo en producción OK (escritorio 1,3 s, WebKit 1,0 s, panel 0,5–1,1 s, sin errores salvo el `<select>` conocido).

Plan en `docs/plan-v0.19.md` (Fable 5.2). Decisiones D56–D67.
- **Base (4 migraciones `20261120120000…120300`)**: idempotencia por `request_id` (D58); `set_order_status` con motivo público, cupón devuelto y devolver insumos opcional desde En el barril (D59); pausa (`pause_orders`, `ordering_status` para anon) y hora estimada dinámica (D61); `capture_lead` rechaza bienvenida vencida (D62); `fill_ms`/`checkout_ms` (D63); `external_sales` + `import_batches` + RPC de importación con comisión (D64); `blocked_attempts.customer_id` y `customers_promo_export` con auditoría (D65); `events.lead_copy`, `reviews.source/review_date/position` (D56, D57). pgTAP `19_v019.sql`; `cancel_reason` hasta 200.
- **Sitio**: textos de secciones, cierre y botones editables con valores por defecto en `src/core/site-copy.ts`; reintento sin duplicar; repetir último pedido; pedido exprés con datos recordados; pausa con reapertura; caducidad por fecha de bienvenida, franja y eventos; motivo público en seguimiento; miniaturas pequeñas.
- **Panel**: Reseñas; Pausar pedidos en la barra; aviso de versión por `/version.json`; anular con mensaje al cliente, devolver insumos y WhatsApp prellenado; deshacer 10 s al entregar; Cancelados de hoy; Editar página con títulos, cierre, botones, imágenes de Promoción/Tour, hora dinámica y textos del cupón; Seguridad con acciones desde frenados; exportar clientes con autorización (auditado); Importar CSV de Rappi/DiDi con mapeo, vista previa, revertir y Plataformas en Ventas; comanda de cocina y logo común; lista de compras.
- **CSP**: WebKit reporta una violación `style-src-attr` por `<select>` (inocua; no se abre `unsafe-inline`, D67). Guardia `tests/e2e/csp.spec.ts`.
- **Verificación**: `verify.sh release` en verde (283 unitarias, 357 pgTAP, 244 e2e en 3 proyectos, 7 Deno).
- **Ojo**: el cupón HUMO20 del seed vence el 2026-11-30 y `sitio.spec` "pedido completo" lo usa.

## 2b. Bloque v0.18 (2026-11-19) — publicado en producción

Rama `mejoras-gustavo-2026-11` (desde `origin/main` = producción). Plan de Fable en `docs/plan-v0.18.md`; reportes en `docs/backlog-gustavo.md`.

- **Base (4 migraciones `20261119120000…120300`)**: enums (`inicial`, `stock_bajo`); pedidos (anular hasta entregado solo admin, `is_test` solo admin, `voided_from`, bloqueo de fila en `set_order_status`; frenados con nombre, últimos 4, zona, total estimado con precios del servidor, productos, borrado a 30 días; `sin_plato`; seguimiento público sin motivo interno); inventario (inicial, costo/base/fecha, margen objetivo, aviso `stock_bajo` a la cola de WhatsApp máx. 1 cada 6 h, política de ajustes incluye inventario); admin y cobertura (`customers_list`, `audit_list`, `locality_code` con disparador, `store_lat/lng`). pgTAP `18_v018.sql` (67).
- **Edge Functions**: `crear-pedido` (detalle de frenados con líneas, Turnstile antes del cupo por IP), `_shared/mensajes.ts` (sin zod, lo usa el sitio), plantilla `stock_bajo`.
- **Sitio**: inicio de una pantalla en celular (D50), barra inferior fija sin blur y oculta con teclado, `is-locked`, `.reveal` robusto; Turnstile esperado/renovado/reseteado en pedido, cupón y cotización (antes cupón y cotización siempre caían como robot) y `startedAt` desde la carga (el mínimo de 4 s bloqueaba a clientes con datos recordados); adiciones solo con plato (D47); mapa SVG de cobertura con localidades IDECA (`src/data/bogota-localidades.json`, CC BY 4.0) + verificador por ubicación o localidad, también en el pedido (D44); fotos AVIF/WebP por tamaño (`src/lib/images.ts`, `Photo.astro`), fotos de muestra recomprimidas; bienvenida con botón inmediato y una vez al día (D51); carga en vivo en una tanda; seguimiento animado SVG+CSS (D52, `seguimiento-arte.ts`, `seguimiento.css`).
- **Panel**: menú con grupos Contenido y Administración (D41) y vistas Bienvenida, Clientes, Ajustes (canales Rappi/DiDi, horario, redes), Seguridad (frenados, auditoría, dos pasos); anular con modal y entregados compactos (D42); tablero arrastrable con confirmación al saltar o entregar (D53); Recibo con logo, tirilla 58/80 mm, hoja e imagen (D54); inventario Inicial, costos, recetas con margen y precio sugerido (D46, D49); WhatsApp en lenguaje de dueño; arranque en paralelo y vistas con carga diferida (D51); aviso sonoro de insumo bajo.
- **Investigación**: Rappi tiene API solo para integradores aprobados; DiDi no publica API (D45: enlaces + registro manual + CSV cuando haya muestra). WhatsApp oficial no es "gratis": plantillas utility se cobran; respuestas de servicio con cupo mensual sin costo, cifra por confirmar en la cuenta de Meta (D48 abierta).
- **Verificación**: ver §2c (release en verde).

**Despliegue 2026-11-19 (aprobado por Gustavo):** 4 migraciones aplicadas al remoto (17 en total) y verificadas (anon solo `track_order` y `stock_status`, todas las tablas con RLS, funciones con `search_path`, 7 zonas con `locality_code`, cron `jps-purgar-frenados`); Edge Functions desplegadas: `whatsapp`, `crear-pedido`, `captar`, `cotizar`, `seguir-pedido`, `equipo`, `publicar`; `main` y `produccion` en `7b3eeee`; humo en producción OK (escritorio y WebKit: sin errores, inicio móvil de una pantalla, 28 fuentes AVIF, mapa, `geolocation=(self)`). Trampa: `git push origin main:produccion` usa el `main` LOCAL; empujar el commit exacto (`git push origin <sha>:refs/heads/produccion`).

## 2c. Verificación v0.18 (2026-11-19, local)

`scripts/verify.sh release` en verde: base limpia, tipos, lint, formato, 156 unitarias, sin datos sensibles (116 archivos), build, 266 pgTAP, simultáneos (1 de 2), **e2e 164 pasan / 10 saltados a propósito** (escritorio, Android e iPhone simulados), 7 Edge Functions.
**Turnstile probado en local con las claves de prueba oficiales de Cloudflare** (developers.cloudflare.com/turnstile/troubleshooting/testing; solo en archivos ignorados y restaurados): pedido con datos recordados confirmado en ~1 s pasa (antes caía como robot), el token viaja y el widget sobrevive Datos→Confirmar, cupón y cotización ya no caen como robot, y con la clave que bloquea sale el mensaje sin enviar. Escritorio y WebKit.
Revisión visual con capturas (iPhone, Pixel, 360×640, escritorio): 11 defectos corregidos (inicio 360×640, avisos sobre modales, tablero cortado, recibo, recetas, Mi cuenta, fecha del recibo, Canales, Inventario en celular, coma en seguimiento).
No probado aún: iPhone real (iOS 26), geolocalización y Permissions-Policy (solo en vista previa de Vercel), reto interactivo de Turnstile en Safari, impresión en tirilla, `navigator.share`. Pendiente menor: WebKit reporta violaciones CSP `style-src-attr` también en el build normal (Chromium no); investigar su origen. Detalle conocido: en 360×640 el inicio móvil mide ~20 px más que la pantalla.
Trampas nuevas: un e2e que crea pedidos debe reponer inventario (borrar `supply_moves` no devuelve stock); Playwright WebKit no reporta `maxTouchPoints`; `trusted::text` en Postgres es `'true'`; el `aria-live` del tablero duplica textos del toast (buscar dentro de `.toast`).

## 3. Infraestructura

| Pieza | Estado |
|---|---|
| Git | Repo **público** https://github.com/FousGus12/JPSMOKE (decisión de Gustavo). `main` = vista previa; `produccion` = producción en Vercel. Unir por fast-forward (`git push origin <rama>:main`, luego `main:produccion`). Autor: noreply de GitHub de FousGus12 |
| Supabase | Proyecto `vxtbjknqadmehgulejtl` (org FousGus1218, us-east-1, plan gratis). **Hecho 2026-11-14:** 10 migraciones aplicadas (24 tablas con RLS; anon solo ejecuta `track_order` y `stock_status`), 6 Edge Functions desplegadas, secretos `CORS_ALLOWED_ORIGINS` (`https://jpsmoke.vercel.app,https://jpsmoke-*-bejaranomanuel1409-1827.vercel.app`), `IP_SALT`, `MAX_PER_HOUR_IP=20`, `WHATSAPP_CRON_SECRET`; Vault `jps_whatsapp_url` y `jps_whatsapp_secret`; datos de `tenants/jp-smoke.sql` cargados (21 productos, 0 reseñas; WhatsApp `573001234567` y carta son de muestra). Integración GitHub con "Deploy to production" apagado. Llavero: `jp-smoke-project-ref`, `-pooler-host`, `-db-password`, `-supabase-token`, `-ip-salt`, `-whatsapp-cron-secret`. `TURNSTILE_SECRET` cargado. `VERCEL_DEPLOY_HOOKS` cargado (hook `publicar-panel` de la rama `produccion`, Llavero `jp-smoke-vercel-hook`); hashes de `TURNSTILE_SECRET` y del hook verificados contra el Llavero. CORS probado: acepta `jpsmoke.vercel.app` y rechaza otros orígenes. Auth: `site_url` = `https://jpsmoke.vercel.app` y redirecciones de vistas previas. Cuenta **admin** `valbuenagustavo7@gmail.com` creada (contraseña inicial en el Llavero `jp-smoke-cuenta-<correo>`; activa TOTP al primer ingreso). CLI enlazada al proyecto. Migración 11 (equipo, D38) y función `equipo` aplicadas el 2026-11-14. **Faltan:** cuenta de operador (Gustavo la crea desde Panel → Equipo y permisos), pedido real de prueba (docs/montaje.md §8) |
| Vercel | Proyecto `bejaranomanuel1409-1827/jpsmoke` (Hobby), conectado al repo. Producción: rama `produccion` → https://jpsmoke.vercel.app. Variables (Production y Preview): `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (publishable), `PUBLIC_RESTAURANT_SLUG`, `SITE_URL=https://jpsmoke.vercel.app`, `SITE_INDEXABLE=false`. `PUBLIC_TURNSTILE_SITE_KEY` va en `.env.production` del repo (pública); local y CI la anulan en `.env.production.local`. Turnstile (cuenta Cloudflare de Gustavo, widget "JP Smoke") solo valida en `jpsmoke.vercel.app`: en vistas previas los pedidos web no pasan |
| CI | El build se movió al job e2e (necesita base local). Todo en verde el 2026-11-14 (si e2e falla con `Rate exceeded` o puerto ocupado, es el registro de Docker: reintentar) |
| Supabase local | Puertos **573xx** (API 57321, DB 57322, Studio 57323). Proyecto `jp-smoke` |
| Docker | Colima (`colima start`, 4 GB). Copias locales de **Aura y Tareas apagadas** con `docker stop` + `--restart=no` (datos intactos; Aura: `docker start $(docker ps -aq --filter name=_aura)`). GMDevz local sigue encendido |
| Secretos | Ninguno real. Al publicar: Llavero cuenta `jp-smoke` (`jp-smoke-project-ref`, `jp-smoke-db-password`, `jp-smoke-pooler-host`, `jp-smoke-supabase-token`); secretos de funciones `TURNSTILE_SECRET`, `IP_SALT`, `CORS_ALLOWED_ORIGINS`, `VERCEL_DEPLOY_HOOKS` (`{"jp-smoke":"https://…"}`), `WHATSAPP_CRON_SECRET` (igual al de Vault `jps_whatsapp_secret`), y para envíos reales `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_ID`. En Vault: `jps_whatsapp_url` y `jps_whatsapp_secret` |

## 4. Entorno local

| Tarea | Cómo |
|---|---|
| Base lista (reset + cuentas dev + `.env.local` + tipos + `.env` de funciones) | `pnpm db:local` |
| Sitio compilado (lee la base local) | `pnpm exec astro build` y `preview_start` → `jp-smoke-sitio` (http://127.0.0.1:4331) |
| Mockup aprobado | `preview_start` → `jp-smoke-mockup` (http://127.0.0.1:5320) |
| Verificación | `scripts/verify.sh` (rápida) · `full` (+ datos, build, RLS, simultáneos, e2e escritorio, Deno) · `release` (base limpia + full + e2e Android e iPhone, ~5 min) |
| Respaldo | `scripts/respaldo.sh volcar` (o `volcar remoto`) → `respaldos/` · `scripts/respaldo.sh probar <archivo>` restaura en local y compara conteos; después `pnpm db:local` |
| Pruebas de permisos | `supabase test db` |
| Cuentas dev | `admin.dev@jpsmoke.test` (admin; la primera vez pide activar TOTP con QR) · `operador.dev@jpsmoke.test` (operador) · contraseña `JpSmokeDev-2026` |
| Funciones locales | `supabase/functions/.env`: `TURNSTILE_SECRET=off-local`, `IP_SALT=local`, `MAX_PER_HOUR_IP=1000`, `WHATSAPP_CRON_SECRET` (lo escribe `db:local`; la primera vez reiniciar Supabase para que la función lo lea) |
| WhatsApp local | Modo prueba: cada minuto el cron despacha y los mensajes quedan "simulados" (Panel → WhatsApp) |
| Datos del restaurante | `supabase/tenants/jp-smoke.sql` (idempotente; generado del mockup). Reseñas de muestra no van a remoto |

**Último resultado (2026-11-02):** `verify.sh release` en verde salvo `promos.spec.ts` (nombre de prueba con dígito, corregido y repetido: 9/9 en los 3 dispositivos) — 53 unitarias, **149 pgTAP**, pedidos e **inventario y cupón simultáneos**, **44 Deno**, e2e en escritorio, Android e iPhone. No probado en celular real.

## 5. Mapa del código

- `supabase/migrations/` — 13 migraciones (11.ª equipo y apartados, D38; 12.ª correcciones de la auditoría run-2, D39; 13.ª adiciones por plato, D40) (10.ª endurecimiento: `anon` solo SELECT de lo público, D34; 7.ª inventario: `register_supply`, `stock_status`, `place_order` envuelve a `private.place_order_core`; 8.ª WhatsApp: cola, `whatsapp_claim`, `whatsapp_mark`, cron; 9.ª `rate_count` para el seguimiento): núcleo (tablas, RLS), pedidos (`place_order`, `track_order`, `set_order_status`, `create_manual_order`, `capture_lead`), panel (aal2 exigido para admin, `board_summary`), editor (Storage `carta`, bloques, `publish_site`, auditoría), promos y eventos (cotizaciones, `set_intro_event`), ventas (`sales_summary`, `sales_export`, cierre de caja, `weekly_report`).
- `supabase/functions/` — `crear-pedido`, `seguir-pedido`, `captar`, `cotizar`, `publicar`, `whatsapp` (+ `_shared/`: CORS, Zod compartido con el sitio, Turnstile, token del enlace, plantillas de WhatsApp).
- `supabase/tests/` — 13 archivos pgTAP (permisos, aislamiento entre restaurantes, roles, pedidos, público, dos pasos, editor, promos, ventas, inventario, WhatsApp, punto físico, endurecimiento) + `scripts/prueba-simultaneos.sh`.
- `src/pages/` — `index`, `pedido`, `privacidad`, `terminos`, `devoluciones`, `pqrs`, `panel/`, `sitemap.xml`, `robots.txt`, `404`.
- `src/scripts/sitio.ts` (comportamiento del sitio), `src/scripts/seguimiento.ts`.
- `src/panel/` — `PanelApp` (ingreso, menú por rol), `Pedidos`, `ManualOrder`, `Resumen`, `Ventas` + `charts`, `Inventario`, `WhatsApp`, `Carta`, `EditarPagina`, `Promociones`, `Eventos`; datos en `data.ts`, `editor.ts`, `promos.ts`, `sales-data.ts`, `inventory-data.ts`, `whatsapp-data.ts`, `auth.ts`.
- `src/core/` — lógica pura con pruebas: carrito, pedidos, seguimiento, ventas/CSV/informe, fotos, dinero, celular, JSON-LD.
- `docs/` — `montaje.md` (paso a paso a producción y restaurante nuevo), `seguridad/README.md` y `seguridad/revision-2026-11-01.md`, `diseno/`.
- `scripts/` — `verify.sh`, `db-local.sh`, `respaldo.sh`, `prueba-simultaneos.sh`, `crear-cuenta.sh <slug> <correo> "<Nombre>" <admin|operador>`, `migrar-remoto.sh`, `desplegar-funcion.sh`, `remoto.sh` (se niega con refs de otros proyectos).
- `tests/e2e/` — sitio, panel, editor, promos, ventas, inventario, whatsapp, cimientos (+ `ayudas.ts`: base local, TOTP, ingreso admin).

## 6. Trampas conocidas

- **Después de `db reset` recompilar el sitio**: los ids de productos cambian y el sitio viejo no coincide con lo que consulta en vivo.
- **Nombre del cliente (D35)**: solo letras, espacios, punto, apóstrofo y guion (Zod y formulario). Las pruebas no pueden usar nombres con dígitos ("Prueba e2e" → "Prueba Playwright").
- **Operador (D35)**: la base solo le muestra pedidos de las últimas 36 h; si el tablero llega a necesitar más días, cambiar también la política de `orders`.
- **Seguimiento por 4 dígitos (D35)**: 5 fallos por hora por pedido bloquean esa vía una hora aunque luego pongan el número correcto (el enlace con token sigue funcionando).
- **Skill de auditoría**: `~/.agents/skills/security-audit` (global). Corridas en `~/security-audit-skill/<repo>/run-N`. Sin sandbox en el Mac, todo queda "por validar" y se valida a mano en local.
- **Privilegios de `anon` (D34)**: tabla nueva que el sitio deba leer necesita `grant select (…) on … to anon` explícito; la migración 10 cerró los privilegios por defecto. Nada de `select('*')` desde el sitio.
- **Recoger en tienda**: `pickup_enabled` exige `store_open` y dirección (restricción en la base); se aplica en vivo, la dirección y el horario del local se ven al publicar.
- **Respaldo**: `pg_dump` ignora `-n` si hay `-t` (por eso dos pasadas); restaurar con `session_replication_role = replica` o los triggers de inventario descuentan otra vez.
- **Permisos (D38)**: nunca volver a `is_admin_of`/`my_role() = 'admin'` en políticas o RPC nuevas: usar `can('apartado')` o `can_of(rid, 'apartado')`. Apartados: ventas, inventario, whatsapp, carta, sitio, promos, eventos; `equipo` es solo admin. Columnas nuevas de `restaurant_settings` caen en `sitio` salvo que se mapeen en `private.guard_settings` (hoy el número de WhatsApp y `channels` son de Sitio: quien tenga Sitio puede cambiarlos). Operador con apartados = exige TOTP. `staff` no se borra (guardias); se desactiva.
- **Reducir movimiento**: con el ajuste del celular activo, `sitio.css` pone `animation: none` (antes 1 ms infinito hacía parpadear la franja y el humo) y el inicio queda con las comidas ya separadas (`reduced` en `sitio.ts`). La animación del inicio usa suavizado cuadro a cuadro (`heroFrame`) y transform directo; nada de `backdrop-filter` en las tarjetas.
- **Vistas previas de Vercel**: tienen protección de Vercel (piden iniciar sesión); para probar en un celular sin sesión hay que publicar o crear un enlace para compartir en Vercel.
- **Adiciones (D40)**: categoría con `is_addons`; en el carrito cada línea tiene `key` y la adición `parent` (`src/core/cart.ts`); la base valida en `place_order_core` y guarda `order_items.parent_item_id`/`position`. `nestItems` (`src/core/orders.ts`) ordena para mostrar. El pedido manual del panel sigue plano.
- **Ajustes del restaurante (D39)**: `private.guard_settings` usa lista explícita columna → apartado; columna nueva = solo admin hasta agregarla a la lista. El número de WhatsApp del negocio es del apartado WhatsApp. `published_at` solo lo escriben `publish_site`/`unmark_published` (bandera `jps.publicando`); tope extra de 20 publicaciones/hora por restaurante.
- **Sesiones (D39)**: `my_restaurant()` exige que exista `auth.sessions` con el `session_id` del JWT (los claims de pgTAP sin `session_id` se tratan como sesión viva). Cambiar una contraseña por la API admin cierra TODAS las sesiones de esa cuenta: el panel vuelve a iniciar sesión con la clave nueva.
- **Clave temporal (D39)**: `staff.must_change_password` lo pone la función `equipo` al crear o restablecer; sin panel hasta cambiarla (acción `cambiar_clave` de `equipo`, que exige aal2 si la cuenta ya tiene TOTP). Solo el servidor quita la marca.
- **Seguimiento por 4 dígitos (D39)**: además de 5 fallos/hora, 15 fallos acumulados por pedido (`private.track_fails`); después solo sirve el enlace con token.
- **Respaldo (D39)**: el repo es público y el artefacto cifrado se puede descargar: `BACKUP_PASSPHRASE` de mínimo 32 caracteres aleatorios.
- **Equipo**: altas y claves temporales por la Edge Function `equipo` (la clave se muestra una vez y cierra sesiones con `revoke_sessions`, solo service_role). `scripts/crear-cuenta.sh` sigue sirviendo para el primer admin de un restaurante nuevo.
- **`place_order`** es un envoltorio: la lógica está en `private.place_order_core`; si se cambia, mantener el manejo de `P0002` (agotado por inventario).

- **Función Edge nueva** = reiniciar Supabase local (`supabase stop && supabase start -x …`); si no, 404.
- **Migración nueva con funciones**: cerrar al final con `revoke execute on all functions in schema public from public, anon;` y reabrir solo `track_order` (Supabase da EXECUTE a anon por defecto). Lo vigila `01_funciones_y_esquemas.sql`.
- **Políticas para anon** no pueden llamar `is_staff_of`/`is_admin_of`: una política para anon y otra para authenticated (si no, el sitio no compila).
- **citext** dentro de funciones con `search_path = ''` compara como texto: usar `lower()`.
- **Safari (iPhone)** no genera WebP desde canvas: el panel sube JPG.
- **Borrar Storage por SQL** en pruebas: `set local storage.allow_delete_query = 'true'`.
- **CSP**: nada de atributos `style` (ni `style={}` en React): clases y atributos SVG.
- **Mayúsculas en nombres de archivo** (macOS no distingue): `ventas.ts` chocó con `Ventas.tsx` → `sales-data.ts`.
- **e2e**: abrir el menú del panel solo después de ver `.topbar`; en iPhone no hay rueda del mouse; usar `?intro=ninguna` para que la bienvenida no tape la página.
- **Revisión visual**: `scrollBehavior = 'auto'` antes de mover la página; el servidor de Python del mockup cachea JS/CSS.

## 7. Decisiones recientes (detalle en ROADMAP §14)

**v0.18:** D41 menú y Administración · D42 anular hasta el final · D43 frenados con detalle · D44 cobertura con mapa · D45 Rappi/DiDi · D46 inventario Inicial y alerta · D47 adiciones solo con plato · D48 WhatsApp real (abierta) · D49 costos y margen · D50 inicio de una pantalla en celular · D51 carga más rápida · D52 seguimiento animado · D53 tablero arrastrable · D54 recibo.


D24 base compartida · D25 todo local · D26 pedido del cliente en F4 · D27 rojo de texto aparte (`--accent-text`) · ambiente más suave (tokens `--glow` 13 %, `--smoke` 0,22, `--grain` 0,025; antes 22 %, 0,35 y 0,04) · D28 qué se ve en vivo y qué al publicar · D29 ventas y caja · **D30 inventario** (se descuenta al entrar el pedido, vuelve al cancelar) · **D31 Better Auth descartado** · **D32 WhatsApp** (modos, cola sin datos personales, JP Smoke en prueba) · **D33 punto físico y recoger en tienda** · **D34 mínimo privilegio para anon** · **D35 correcciones de la auditoría** · **D36 montaje** · **D38 equipo gestionable** · **D39 correcciones auditoría run-2** (informe en `~/security-audit-skill/jp-smoke/run-2/`; pendientes por validar: XFF del gateway de Supabase). Ambiente del vino bajado (tokens `--glow`, `--smoke`, `--grain`). Descartado: cupón de cumpleaños (D22), verificación del celular por código (D13).

## 8. Siguientes pasos

1. **Gustavo aprueba commit y PR** de `mejoras-gustavo-2026-11`.
2. **Despliegue en orden obligatorio** (el build lee columnas nuevas): migraciones `20261119120000…120300` al remoto con simulación (skill `migracion-remota`; confirmar en remoto los nombres `whatsapp_messages_check`, la política "equipo con apartado edita ajustes" y las firmas viejas de `register_blocked`, `register_supply`, `private.log_blocked`) → Edge Functions públicas (`crear-pedido`, `whatsapp`, `captar`, `cotizar`, `seguir-pedido`) → vista previa de Vercel → producción (skill `desplegar`).
3. **Pruebas manuales de Gustavo en su celular (sin Xcode; lista al cierre de cada despliegue)** (Turnstile solo valida en `jpsmoke.vercel.app`: en vista previa los pedidos no pasan salvo que Gustavo agregue ese hostname al widget; confirmarlo en producción, y la fila del frenado del 19-nov en Seguridad mostrará el motivo real): Turnstile en pedido, cupón y cotización; "Usar mi ubicación" (Permissions-Policy `geolocation=(self)`); inicio, barra inferior con teclado; bienvenida una vez al día; seguimiento animado; arrastre con pulsación larga; recibo impreso 58/80 mm y compartir.
4. **Tras publicar**: Panel → Editar página → Punto físico (coordenadas) y localidad de cada zona; Ajustes → Canales (Rappi visible); Inventario → costos e Inicial; apagar o cambiar la bienvenida vencida (dice 15 de noviembre).
5. **Dominio** `jpsmoke.co` (Gustavo lo compra en mi.com.co; trasladar a Cloudflare Registrar antes de renovar) con `panel.jpsmoke.co` para el panel: Vercel, CORS, Auth redirects, `site_url`, Turnstile (hostnames). D4 (Vercel Pro) sigue abierta.
6. **Propuestas de la revisión de Fable** (no construidas): idempotencia en `crear-pedido`, reversar cupón al anular, repetir pedido, importar CSV Rappi/DiDi, aviso al cliente al anular, elegir devolver insumos al anular entregado, caducidad automática de bienvenida, deshacer al mover a Entregado, cancelados de hoy, pausar pedidos X minutos, lista de compras desde insumos bajos, acciones desde un frenado, exportar clientes con consentimiento, comanda de cocina sin precios, hora estimada dinámica, pedido en un solo paso (medir primero).
7. **Contenido editable (backlog #8, pendiente de aprobación)**: títulos de sección, imágenes de Promoción y Tour, cierre, botones del inicio ("punto físico muy pronto" debería depender de `store_open`), textos del cupón y pantalla de reseñas.
8. **Limpieza**: reglas viejas de seguimiento en `sitio.css` (~2780), duplicado del logo en `Recibo.tsx`, optimización de políticas RLS (`(select …)`) cuando crezca el volumen, miniaturas del carrito con versión pequeña.

## 9. Pendientes de Gustavo

- Logo, carta real con precios y fotos, zonas, horario, WhatsApp del negocio, razón social y NIT (privacidad).
- Aprobar envíos reales de WhatsApp (costo por mensaje) y elegir propuestas de ROADMAP §11.
- Avisar cuando haya cupo para crear GitHub, Supabase y Vercel.

## 10. Cómo trabajar con Gustavo

Español de Colombia, directo y corto. La empresa es **CLOUP.CO**. Aprobación explícita para crear infraestructura, migraciones remotas, publicar, commits y cualquier costo. Explicar lo técnico en lenguaje de dueño de negocio. **Mantener este archivo al día al cerrar cada bloque** (lo pidió expresamente).
