# Auditoría de seguridad con la skill de Cloudflare (2026-11-02)

**Skill:** `security-audit` de Cloudflare (instalada global en `~/.agents/skills/security-audit`, enlazada a Claude Code). **Perfil:** standard, auditoría completa de 6 fases, máximo 5 agentes al tiempo (pedido de Gustavo). **Agentes:** 51. **Artefactos de la corrida** (fuera del repo): `~/security-audit-skill/jp-smoke/run-1/` (`REPORT.md`, `NEEDS-VALIDATION.md`, `findings.json`, `coverage-ledger.json`).

## Cómo corrió
- 4 agentes de reconocimiento → 27 unidades de cobertura en 8 olas de cazadores → críticos de cobertura hasta que dos seguidos no pidieron más → verificador independiente por candidato → verificador final por registro → validadores de la skill en verde.
- **Solo fuente:** el Mac no tiene un sandbox de sistema operativo con límites de memoria, procesos y disco, así que la skill no ejecutó código y nada pudo quedar "confirmado" dentro de ella. Los 6 leads se validaron después **a mano en la base local** con datos ficticios.

## Resultado

| # | Hallazgo | Validación local | Corrección |
|---|---|---|---|
| 1 | Carrera en `place_order`: dos pedidos simultáneos pasaban un cupón de un solo uso | **Confirmado**: 2 descuentos con `max_uses = 1` | `select … for update` del cupón antes de validar; `CHECK (uses <= max_uses)`. Ahora 1 de 2 (prueba en `prueba-simultaneos.sh`) |
| 2 | Límites por IP toman el primer `X-Forwarded-For` (el cliente puede inventarlo si el proxy no lo reemplaza) | Depende de Supabase en producción | Límite **por pedido** dentro de la base (abajo), independiente de la IP. Verificar el encabezado en staging (`docs/montaje.md` §8) |
| 3 | Seguimiento por 4 dígitos: el límite de intentos era "leer y después contar" y admitía ráfagas | Lógica confirmada por código | `track_order_by_phone` cuenta fallos por pedido con candado: máximo 5 por hora, aunque cambie la IP o lleguen al tiempo |
| 4 | El operador leía montos históricos por la API aunque el panel se los oculta | **Confirmado**: veía el total de un pedido de hace 30 días | Política: el operador solo ve pedidos de las últimas 36 h (lo del tablero); el admin todo (D35) |
| 5 | El nombre del cliente iba sin limpiar a WhatsApp, a un celular no verificado, con la cuenta del negocio | Confirmado por código | Zod: solo letras, espacios, punto, apóstrofo y guion; `safeName()` limpia otra vez en las plantillas |
| 6 | `respaldo.sh` guardaba semillas TOTP y hashes sin cifrar, con permisos 644 | **Confirmado**: el volcado incluía `mfa_factors.secret` | Ya no vuelca `auth.mfa_factors` (el admin reactiva su código al restaurar); `umask 077`; respaldos existentes en 600 |
| — | Cupón de bienvenida compartible | — | **Rechazado** por el verificador: es el modelo de cupón por código, sin cruce de límites |

## Endurecimiento aplicado de paso
- `MAX_PER_HOUR_IP` inválido (no numérico) ya no abre los límites: `envLimit()` usa el valor seguro.
- CSV: también neutraliza celdas que empiezan por tabulador o retorno.
- Reseñas de muestra salieron de `supabase/tenants/jp-smoke.sql` (iban a remoto si no se ponía una variable) y quedaron en `supabase/dev-users.sql`, que nunca va a remoto.

## Notas de endurecimiento pendientes (no son hallazgos)
Listadas completas en `~/security-audit-skill/jp-smoke/run-1/REPORT.md` §5. Las más útiles antes de producción:
- `track_order` (enlace con token) no caduca: limitar a 7 días como el de 4 dígitos.
- Guardia del "último admin": un admin puede dejar el restaurante sin administradores.
- `IP_SALT` cae a un valor público si falta el secreto: fallar al arrancar en remoto.
- `TURNSTILE_SECRET=off-local` no comprueba que el entorno sea local.
- `restaurant_settings` sin grant de UPDATE por columnas.
- Token de seguimiento en la query: moverlo al fragmento (`#t=`) o limpiarlo con `history.replaceState`.
- `revisar-build.mjs`: buscar también token de Meta, deploy hooks y otros tipos de archivo.
- CI: fijar acciones por SHA y la versión de Deno.
