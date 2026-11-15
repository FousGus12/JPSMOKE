# HANDOFF · JP Smoke

> **Última actualización:** 2026-11-14 (montaje D36, equipo D38, correcciones de la auditoría run-2 D39) · **Roadmap:** v0.16 · **Git:** `main` y `produccion` en GitHub (PR #1 unido)
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
> Lo que necesito ahora es:
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

- `supabase/migrations/` — 12 migraciones (11.ª equipo y apartados, D38; 12.ª correcciones de la auditoría run-2, D39) (10.ª endurecimiento: `anon` solo SELECT de lo público, D34; 7.ª inventario: `register_supply`, `stock_status`, `place_order` envuelve a `private.place_order_core`; 8.ª WhatsApp: cola, `whatsapp_claim`, `whatsapp_mark`, cron; 9.ª `rate_count` para el seguimiento): núcleo (tablas, RLS), pedidos (`place_order`, `track_order`, `set_order_status`, `create_manual_order`, `capture_lead`), panel (aal2 exigido para admin, `board_summary`), editor (Storage `carta`, bloques, `publish_site`, auditoría), promos y eventos (cotizaciones, `set_intro_event`), ventas (`sales_summary`, `sales_export`, cierre de caja, `weekly_report`).
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

D24 base compartida · D25 todo local · D26 pedido del cliente en F4 · D27 rojo de texto aparte (`--accent-text`) · ambiente más suave (tokens `--glow` 13 %, `--smoke` 0,22, `--grain` 0,025; antes 22 %, 0,35 y 0,04) · D28 qué se ve en vivo y qué al publicar · D29 ventas y caja · **D30 inventario** (se descuenta al entrar el pedido, vuelve al cancelar) · **D31 Better Auth descartado** · **D32 WhatsApp** (modos, cola sin datos personales, JP Smoke en prueba) · **D33 punto físico y recoger en tienda** · **D34 mínimo privilegio para anon** · **D35 correcciones de la auditoría** · **D36 montaje** · **D38 equipo gestionable** · **D39 correcciones auditoría run-2** (informe en `~/security-audit-skill/jp-smoke/run-2/`; pendientes por validar: XFF del gateway de Supabase). Ambiente del vino bajado (tokens `--glow`, `--smoke`, `--grain`). Descartado: cupón de cumpleaños (D22), verificación del celular por código (D13).

## 8. Siguientes pasos

1. **Montaje cuando Gustavo diga**: seguir `docs/montaje.md` paso a paso (cada paso 🔒 con su aprobación).
2. **Antes de producción** (notas de la auditoría, no son hallazgos): caducidad del enlace con token (7 días), guardia de "último admin", fallar si falta `IP_SALT` en remoto, `off-local` solo en local, grant de UPDATE por columnas en `restaurant_settings`, verificar `X-Forwarded-For` en staging (`docs/montaje.md` §8).
3. **Al abrir el local**: Panel → Editar página → Punto físico (dirección, mapa, horario, recoger) y Publicar.
4. **Mejoras anotadas**: costo de insumos y margen por producto; reordenar productos arrastrando; logo y colores por restaurante (asistente de arranque §17.1); importar ventas de Rappi/DiDi por CSV.
5. **WhatsApp real** (cuando Gustavo apruebe el costo): cuenta de WhatsApp Business en Meta, número, token, registrar las 4 plantillas (texto en Panel → WhatsApp → "Así se ven") y pasar el modo a Activo.

## 9. Pendientes de Gustavo

- Logo, carta real con precios y fotos, zonas, horario, WhatsApp del negocio, razón social y NIT (privacidad).
- Aprobar envíos reales de WhatsApp (costo por mensaje) y elegir propuestas de ROADMAP §11.
- Avisar cuando haya cupo para crear GitHub, Supabase y Vercel.

## 10. Cómo trabajar con Gustavo

Español de Colombia, directo y corto. La empresa es **CLOUP.CO**. Aprobación explícita para crear infraestructura, migraciones remotas, publicar, commits y cualquier costo. Explicar lo técnico en lenguaje de dueño de negocio. **Mantener este archivo al día al cerrar cada bloque** (lo pidió expresamente).
