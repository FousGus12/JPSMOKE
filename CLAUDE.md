# CLAUDE.md — JP Smoke · hamburguesas al barril

Seguir `~/Developer/_manual/MANUAL-PROYECTOS.md` y alimentarlo (sección 0). Mantener `HANDOFF.md` al día (§1b).

## Qué es

Micro app de una hamburguesería al barril en Bogotá (por ahora solo domicilio): **sitio público** que lleva a **pedir** (web o WhatsApp) y **panel privado** con pedidos en vivo, ventas, editor de carta y sitio, promociones, cupones y eventos. Proyecto independiente de Aura y Pulso.

## Fuentes de verdad (en este orden)

1. **`ROADMAP.md`** — alcance, fases (§12), decisiones (§14) y cambios (§15).
2. **`mockup/`** — referencia visual (al aprobarse en F2). Se copia diseño y comportamiento, no el código.
3. **`docs/diseno/DESIGN.md`** — guía visual.
4. **Este archivo** — cómo trabajar.

## Cómo trabajar

- Al iniciar: leer `HANDOFF.md`, luego `ROADMAP.md` §12; resumir en 3 líneas qué sigue.
- **Al cerrar cada bloque o fase: actualizar `HANDOFF.md` completo** (estado, verificación, trampas, siguientes pasos y el texto para retomar en otro chat). Gustavo lo pidió expresamente.
- Una fase a la vez. No construir propuestas (P1…Pn) no aprobadas.
- Decisión nueva o cambiada: registrarla en §14 y §15 **antes** de programarla.
- Antes de dar algo por terminado: tipos, lint, unitarias, pgTAP, e2e, celular y escritorio.
- Español de Colombia, directo y corto. La empresa se escribe **CLOUP.CO**.

## Modo de trabajo con subagentes (desde 2026-11-19, pedido de Gustavo)

- Bloques de varios ítems: primero un planificador con `model: fable` (Fable 5.2) que hace inventario, tabla por ítem (estado, archivos, migración, modelo, dependencias, oleada) y revisión final.
- Reparto: Haiku para tareas mecánicas y búsquedas; Sonnet para UI acotada y pruebas; Opus para lógica delicada, datos y revisión.
- El coordinador hace migraciones, Edge Functions, tipos y `pnpm db:local` (base local única: ningún subagente la reinicia). Un solo escritor por archivo.
- Ante fallas o bloqueos (pruebas en rojo sin causa obvia, segundo intento fallido, cambio de enfoque): consultar al advisor antes de insistir (pedido de Gustavo).
- Oleadas: 0 errores reproducidos · 1 datos · 2 interfaz en paralelo · 3 revisión general (propuestas nuevas solo como lista, sin construir).

## Aprobaciones de Gustavo (obligatorias)

- Crear repo de GitHub, proyecto de Supabase o de Vercel.
- Migraciones al remoto (simular primero), desplegar Edge Functions, publicar.
- Cualquier costo (Vercel Pro, dominio, WhatsApp API, SMS, pasarela).

## Prohibido

- Inserciones públicas directas con `anon`: los pedidos pasan por la Edge Function `crear-pedido`.
- Políticas para `anon` que llamen funciones del equipo (`is_staff_of`…): `anon` no las puede ejecutar y el sitio deja de compilar. Una política para `anon` y otra para `authenticated`.
- Tablas sin `restaurant_id` o sin RLS (D24).
- Migraciones que crean funciones sin cerrar al final: `revoke execute on all functions in schema public from public, anon;` (Supabase da EXECUTE a anon por defecto) y volver a abrir solo `track_order`.
- Confiar en precios, totales o cupones que manda el navegador.
- Claves (`service_role`, tokens) en frontend, repo o chat. Llavero, cuenta `jp-smoke`.
- Fuentes, scripts o librerías desde CDN (excepción documentada: Cloudflare Turnstile).
- Reseñas, cifras o sellos inventados en producción.
- Escribir en `~/Developer/pulso`, `aura`, `Empresa` o `Pagina`: solo consulta.

## Stack (D2)

Astro 7 estático + React 19 (islas y `/panel`) + TypeScript 6 · TanStack Query · Tailwind 4 con tokens · Zod · `Intl` en `America/Bogota` · Supabase (Postgres, RLS, Auth con TOTP, Storage, Edge Functions, Realtime, Cron) · Vitest · Playwright · pnpm.

## Comandos

| Tarea | Comando |
|---|---|
| Vista previa del mockup | `preview_start` → `jp-smoke-mockup` (http://127.0.0.1:5320) |
| App local | `pnpm dev` (http://127.0.0.1:4331; panel en `/panel`) · vista previa del build: `preview_start` → `jp-smoke-sitio` |
| Base local lista (reset + cuentas dev + `.env.local` + tipos) | `pnpm db:local` (Supabase en puertos 573xx) |
| Verificación | `pnpm verify` · `verify:full` · `verify:release` |
| Pruebas de permisos | `supabase test db` |
| Datos de un restaurante | `supabase/tenants/<slug>.sql` (idempotente; local por seed, remoto a mano con aprobación) |

## Código

- TypeScript estricto. Identificadores en inglés; textos de interfaz y commits en español.
- Lógica de negocio (precios, cupones, horario, cobertura, mensajes) en `src/core` con pruebas.
- Una rama por funcionalidad; nunca trabajar en `main`.

Usuarios de desarrollo (solo local): `admin.dev@jpsmoke.test` (admin) y `operador.dev@jpsmoke.test` (operador), contraseña `JpSmokeDev-2026`. Turnstile apagado en local con `TURNSTILE_SECRET=off-local` (`supabase/functions/.env`, ignorado).
