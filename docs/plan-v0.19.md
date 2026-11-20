# Plan v0.19 · oleada 4 (2026-11-19)

Planificador: Fable 5.2. Decisiones: ROADMAP §14 D56–D67. Fuera de alcance: dominio `jpsmoke.co`, Vercel Pro (D4), WhatsApp real (D48).
Rama: `oleada4-v019` (desde `7b3eeee`, que está en producción).

## Reglas (R) en cada brief

Sin atributo `style` ni `style={}` (asignar `el.style.x` por JS sí); nada desde CDN; sin claves; español de Colombia, CLOUP.CO; lógica en `src/core` con prueba; no tocar `supabase/`, `src/lib/database.types.ts` ni `src/styles/panel.css`; no correr build ni e2e salvo que el brief lo diga; solo tus archivos; cierra con `pnpm verify`. Ante fallas sin causa obvia, detente y repórtalo.

## Hallazgos que cambian el diseño

- `orders.cancel_reason` tiene `check (length <= 120)` y `set_order_status` corta a 200: un motivo de 121–200 caracteres revienta → M2 lo sube a 200.
- `capture_lead` no valida fechas del evento: una bienvenida vencida sigue dando cupón.
- `coupons.uses` nunca baja al anular.
- `crear-pedido` genera un token nuevo por petición: la idempotencia define que el enlace pasa al token nuevo.
- `order_public` no devuelve `product_id`: "repetir pedido" es solo del lado del cliente.
- El CSV de plataformas no cabe en `orders` (exige celular, zona, dirección): tabla `external_sales`.
- `blocked_attempts` solo guarda últimos 4: acciones desde un frenado necesitan `customer_id`.
- `guard_settings` corre dentro de RPC del operador: la pausa usa bandera `jps.pausando`.
- `events` y `reviews` tienen select de tabla completa para anon: ninguna columna nueva puede ser interna.
- CSP WebKit: sin `style=` en src ni dist; sospechosos `cloneNode` en `Pedidos.tsx:307` y `sitio.ts:562`.

## Migraciones (oleada 1, un solo escritor de `supabase/`)

- **M1** `20261120120000_enums_v019.sql`: valor `pedido_cancelado` en `wa_kind`.
- **M2** `20261120120100_pedidos_v019.sql`: `orders.request_id uuid` (único parcial con restaurant_id), `cancel_public text ≤160`, `supplies_restored boolean`, `fill_ms`, `checkout_ms`; `cancel_reason ≤200`. `restaurant_settings.orders_paused_until`, `eta_dynamic`, `eta_per_order_min (4)`, `eta_max_extra_min (40)`; `guard_settings`: `eta_*` → sitio, pausa solo con `jps.pausando`. `place_order_core` (una reescritura): idempotencia primero, pausa vigente = no recibe, guarda tiempos, conserva `P0002`. `set_order_status(p_order, p_status, p_reason, p_public_reason default null, p_restore default true)` (borrar firma vieja): baja `uses` del cupón sin pasar de 0, `p_restore=false` solo desde `en_cocina`, auditoría con ambos motivos. `restore_supplies` respeta bandera de transacción. `order_public`: `cancel_note` (público) y `eta` desde `private.eta_text(rid)`; `cancel_reason` sigue null. `pause_orders(p_minutes)` (equipo, 0 reanuda, máx. 180, auditoría). `ordering_status(p_restaurant text)` para anon `{accepting, resumes_at, eta}`. `capture_lead` valida fechas. Cierre: revoke y reabrir `track_order`, `stock_status`, `ordering_status`; actualizar `01_funciones_y_esquemas.sql`.
- **M3** `20261120120200_contenido_v019.sql`: `events.lead_copy jsonb` (≤600, llaves kicker/title/text/button); `reviews.source` (lista, default 'En persona'), `review_date`, `position`.
- **M4** `20261120120300_admin_v019.sql`: `blocked_attempts.customer_id` (FK set null) llenado en `log_blocked`; `customers_promo_export()` admin + auditoría; `import_batches`, `external_sales` (RLS `can('ventas')`, único `(restaurant_id, channel, external_id)`, `matched_order_id`); `restaurant_settings.import_maps` → ventas; RPC `import_external_sales(p_channel, p_file, p_rows)` (≤2.000 filas), `revert_import(p_batch)`, `external_sales_summary(p_days)`.
- **pgTAP** `19_v019.sql`; Edge: `_shared/pedido.ts` (`request_id`, `checkout_ms`, `fill_ms` opcionales), `crear-pedido` (+ prueba), `plantillas.ts` (`pedido_cancelado`), `mensajes.ts`; tipos; `astro.config.mjs` (id de build); `vercel.json` (`/version.json` sin caché).

## Oleada 2 (interfaz)

- **W0** CSP WebKit (sonnet): `tests/e2e/csp.spec.ts` como guardia; reporta el origen.
- **S1 → S2 en serie (opus)**: S1 contenido del sitio (`content.ts`, `images.ts`, `index.astro`, `src/core/site-copy.ts`); S2 comportamiento (`sitio.ts`, `seguimiento.ts`, `sitio.css`, `seguimiento.css`, `core/welcome|cart|tracking|checkout.ts`, `tests/e2e/v019-sitio.spec.ts`).
- **P1** Pedidos (opus): anular con motivo público, devolver insumos, WhatsApp prellenado; deshacer 10 s; Cancelados de hoy; una sola región aria-live.
- **P2** Armazón y Reseñas (sonnet): `PanelApp.tsx`, `Resenas.tsx`, `reviews-data.ts`, `ordering-data.ts`, `core/version.ts`, `pages/version.json.ts`; pausar pedidos; sondeo de versión.
- **P3** Contenido en el panel (sonnet): `EditarPagina.tsx`, `editor.ts`, `Eventos.tsx`; títulos, cierre, botones, imágenes Promoción/Tour, textos del cupón, hora dinámica.
- **P4** Recibo, comanda y logo común (sonnet): `Recibo.tsx`, `core/receipt.ts`, `src/lib/logo.ts`, `Logo.astro`.
- **P5** Lista de compras (sonnet): `Inventario.tsx`, `core/inventory.ts`.
- **P6** Seguridad y Clientes (opus): acciones desde frenados, exportar con auditoría.
- **P7** Importar CSV (opus): `Importar.tsx`, `import-data.ts`, `core/csv-import.ts`, `Ventas.tsx`, `sales-data.ts`.

## Oleadas 3 y 4

e2e completo y correcciones; `verify.sh release`; despliegue (migraciones → Edge → sitio); revisión general de Fable; lista de pruebas manuales para Gustavo (sin Xcode).
