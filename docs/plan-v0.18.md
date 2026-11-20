# Plan v0.18 · pedido de Gustavo (2026-11-19)

Planificador: Fable 5.2. Decisiones: ROADMAP §14 D41–D54 (D48 abierta: no se construye envío real de WhatsApp).
Rama: `mejoras-gustavo-2026-11`.

## Bloque común (va en cada brief)

Rama `mejoras-gustavo-2026-11`. No toques `supabase/`, `src/lib/database.types.ts`, `src/styles/panel.css`, ni reinicies la base. No corras `pnpm build`, `astro build` ni e2e (los corre el coordinador: `dist/` y el puerto son compartidos). Solo edita los archivos de tu lista; si necesitas otro, detente y avisa. CSP: ningún atributo `style` ni `style={}` en marcado (asignar `el.style.x` por JS sí se puede); usa clases y atributos SVG. Nada desde CDN (excepción: Turnstile). Fechas con `Intl` en `America/Bogota`. Textos en español de Colombia, cortos; la empresa se escribe CLOUP.CO. Identificadores en inglés. Nada de `select('*')` desde el sitio. Lógica de negocio en `src/core` con prueba. Verifica con `pnpm verify` y entrega la lista de archivos tocados y lo que no pudiste probar.

## Oleadas

| Oleada | Tarea | Modelo | Archivos |
|---|---|---|---|
| 0 | W0-A celular (D50) + Turnstile robusto | opus | `src/scripts/sitio.ts`, `src/styles/sitio.css`, `src/layouts/Site.astro`, `src/pages/index.astro` (hero) |
| 0 | W0-B error CSP en WebKit (solo lectura) | haiku | — |
| 0 | W0-R rendimiento: carga del sitio y tiempo hasta pedir (solo lectura) | fable | — |
| 1 | M1 enums · M2 pedidos (D42, D43, D47) · M3 inventario (D46, D49) · M4 admin y cobertura (D41, D44) | coordinador | `supabase/`, tipos |
| 2 | W2-S1 D47 cliente → W2-S2 D44 cobertura (en serie, mismo `sitio.ts`) | sonnet → opus | `src/core/cart.ts`, `src/core/coverage.ts`, `src/data/bogota-localidades.json`, `sitio.ts`, `index.astro`, `sitio.css`, `src/lib/content.ts`, `vercel.json` (`geolocation=(self)`) |
| 2 | W2-P pedidos y ventas (D42) | opus | `Pedidos.tsx`, `core/orders.ts`, `data.ts`, `Ventas.tsx`, `sales-data.ts`, `core/sales.ts`, `Resumen.tsx`, `styles/panel/pedidos.css` |
| 2 | W2-M menú y Administración (D41, D43) | sonnet | `PanelApp.tsx`, `Clientes.tsx`, `Seguridad.tsx`, `customers-data.ts`, `security-data.ts`, `styles/panel/admin.css` |
| 2 | W2-A Ajustes y Editar página (D41, D45) | sonnet | `Ajustes.tsx`, `EditarPagina.tsx`, `editor.ts`, `styles/panel/ajustes.css` |
| 2 | W2-I inventario (D46, D49) | opus | `Inventario.tsx`, `inventory-data.ts`, `core/inventory.ts`, `styles/panel/inventario.css` |
| 2 | W2-E Bienvenida en Contenido | sonnet | `Eventos.tsx`, `styles/panel/eventos.css` |
| 2 | W2-W WhatsApp en lenguaje de dueño (D48) | sonnet | `WhatsApp.tsx`, `whatsapp-data.ts`, `styles/panel/whatsapp.css` |
| 3 | e2e celular y escritorio (sin `?intro=ninguna`, con `hasTouch`, `reducedMotion`) | sonnet | `tests/e2e/` |
| 3 | Revisión general sitio + panel y lista de propuestas sin construir | fable | solo lectura |

## Hallazgos del planificador

- `vercel.json` manda `Permissions-Policy: geolocation=()`: hay que abrir `geolocation=(self)` para "Usar mi ubicación"; solo se prueba en una vista previa de Vercel.
- D45 ya existe (canales visibles por interruptor en `EditarPagina.tsx`); se mueve a Ajustes con un solo editor. Los canales se ven al publicar.
- `set_order_status` cierra en entregado/cancelado; `restore_supplies` ya devuelve insumos al pasar a cancelado.
- Funciones vigentes de ventas y `register_supply` están en `20261114120000_equipo.sql`.
- `whatsapp_messages` exige `order_id` salvo informe semanal: el aviso de insumo bajo necesita `supply_id` y check relajado.
- `alter type … add value` en migración propia, anterior a la que lo usa.
- D43 y D47 reescriben `private.place_order_core`: una sola reescritura, conservando `P0002`.
- Cambiar firmas de `register_supply`/`register_blocked`: borrar la vieja (si no, PostgREST falla por ambigüedad).
- Después de `pnpm db:local`, recompilar el sitio.

## Pedido real bloqueado en producción (2026-11-19)

Mensaje "No pudimos tomar tu pedido. Si ya pediste hace poco…" = motivo `robot`, `repetido` o `bloqueado`. Causa probable en código: `turnstileToken()` lee `getResponse` sin esperar a que el token exista, no renueva el token vencido (5 min) ni tras un intento fallido. Arreglo en W0-A: esperar el token (callback + promesa con tope), `expired-callback`/`refresh-expired: 'auto'`, `turnstile.reset` tras cada envío, estado "Verificando…", y mensaje distinto si Turnstile no cargó. D43 deja ver el motivo exacto en Seguridad.

## Verificación de salida

`pnpm verify:release`, vista previa de Vercel, iPhone real con iOS 26: Safari, dentro de WhatsApp/Instagram, teclado abierto en el buscador, girar pantalla, Reducir movimiento.

## Tandas posteriores (Fable 5.2)

- 2b rendimiento (D51): fotos recomprimidas (haiku), precarga (sonnet), arranque del panel en paralelo (opus), carga diferida (sonnet), imágenes AVIF/WebP + bienvenida + carga en vivo (opus).
- 2c (D52–D54): seguimiento animado (sonnet), tablero arrastrable (opus), recibo (sonnet).
- 3: revisión general de Fable → correcciones (búsqueda de clientes, cupo por IP tras Turnstile, total de frenados, prueba solo admin, bloqueo de fila, motivo interno fuera del seguimiento, confirmación al soltar, recargar panel tras despliegue) + pgTAP y e2e nuevos.
