# Seguridad · JP Smoke

Qué se aplica y de dónde viene. Base: manual §7 (OWASP Top 10:2025), revisión de Pulso (2026-10-20) y lo que ya funciona en Aura.

## 1. Lo que se trae de Pulso y Aura (ya probado)

| Viene de | Qué | Cómo se aplica aquí |
|---|---|---|
| Pulso · revisión 2026-10-20 | Funciones `security definer` con `search_path = ''`, esquema `private` sin uso para `anon`/`authenticated` | Igual. Prueba pgTAP que **falla si una función privilegiada nueva queda ejecutable por `anon`** |
| Pulso | Validar quién llama antes de validar el estado del registro | Las RPC del panel revisan rol primero (evita filtrar si un pedido existe) |
| Pulso | Realtime solo con tablas con RLS e identidad de réplica por clave primaria | El tablero de pedidos usa Realtime; `anon` no se suscribe a `orders` |
| Pulso | `revisar-datos.sh` (claves, `.env`, llaves, volcados) en `verify:full` y CI | Se copia **la versión corregida de Aura** (detecta `service_role` decodificando el JWT) |
| Pulso | 2FA en GitHub, Vercel y Supabase; SSL obligatorio; tokens viejos revocados; CI obligatoria en `main` | Lista de pendientes de Gustavo al crear la infraestructura |
| Pulso | MCP solo lectura, un proyecto por conector, nunca escritura contra producción | Igual |
| Aura | Formularios públicos solo por Edge Function con Zod, límites y campo trampa | `crear-pedido`, `verificar-celular`, `cotizar-evento` |
| Aura | CSP de Astro con hash por página + prueba del hash; `frame-ancestors 'none'`; sin sourcemaps | Igual |
| Aura | Registro público apagado con `[auth] enable_signup = false` (no `[auth.email]`) | Igual |
| Aura | Rama `produccion` en Vercel desde el día 1 | Igual |
| Aura | Hook PreToolUse de solo lectura para proyectos de referencia y bloqueo de commits con secretos | Igual, agregando `aura` a la lista |

## 2. Lo nuevo de este proyecto: pedidos públicos

Un sitio de pedidos es el blanco favorito de bots y bromas. Capas en `crear-pedido`:

1. Campo trampa + tiempo mínimo de llenado.
2. Cloudflare Turnstile validado en el servidor.
3. Límites por IP, celular y dispositivo (tabla `rate_limits`, ventana deslizante).
4. Celular colombiano válido (sin verificación por SMS: descartada en D13; el contador de falsos y la lista de bloqueo la reemplazan).
5. Precios, combos, adicionales, domicilio y cupones **recalculados en el servidor**; el total del navegador se ignora.
6. Zona de cobertura, monto mínimo y horario validados en el servidor.
7. Lista de bloqueo y marca de cliente confiable.
8. Respuesta genérica ante cualquier rechazo (no revela qué capa falló).

## 3. Datos personales

- `customers`, `orders`: solo `admin` y `operador` por RLS. `anon` ni siquiera tiene privilegio de tabla (F10).
- El seguimiento público (D21) usa el enlace único con token (hash sha256 en la base) o código + últimos 4 dígitos; los intentos fallidos tienen límite.
- Auditoría de cambios en pedidos y clientes (`audit_log`, `order_events`).
- Exportar CSV solo `admin` y queda registrado.
- Ley 1581: autorización sin marcar, prueba guardada, promociones con casilla aparte, política publicada.

## 4. Panel

`/panel` sin enlace, `noindex`, contraseña ≥ 12, TOTP obligatorio para admin, cierre por inactividad, cuentas creadas solo por el admin, roles por RLS (el frontend solo oculta).

## 5. Revisiones

- [2026-11-01 · cierre de F10](revision-2026-11-01.md): mínimo privilegio para `anon`, inventario de superficie y pendientes para producción.
- [2026-11-02 · skill security-audit de Cloudflare](auditoria-2026-11-02.md): auditoría completa de 6 fases; 4 hallazgos confirmados en local y corregidos, 2 mitigados.
