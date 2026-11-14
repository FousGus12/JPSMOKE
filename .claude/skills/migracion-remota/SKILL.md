---
name: migracion-remota
description: Aplica migraciones de Supabase al proyecto remoto de JP Smoke (<ref-pendiente>) con simulación previa, aprobación de Gustavo y verificación. Úsala cuando haya migraciones nuevas listas o cuando pidan "aplica la migración".
---

1. Confirma que la migración pasó `pnpm verify:full` y la CI.
2. Simula: `scripts/migrar-remoto.sh` (clave y pooler del Llavero, cuenta `jp-smoke`; el script rechaza ids de Pulso, GMDevz o Rutami) y muestra la lista.
3. Pide aprobación explícita a Gustavo (AskUserQuestion) diciendo qué hace cada migración y si toca datos existentes. Cada migración necesita su propia aprobación.
4. Aplica: `scripts/migrar-remoto.sh --aplicar`.
5. Verifica en el remoto lo creado (tablas con RLS, funciones sin EXECUTE para `anon`, `search_path` fijo) con consultas cortas.
6. Edge Functions nuevas o cambiadas (con aprobación): `scripts/desplegar-funcion.sh <nombre>`. La clave y el token nunca se escriben en archivos ni en el chat.
7. Anota en HANDOFF.md lo aplicado.
