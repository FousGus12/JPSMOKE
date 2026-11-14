---
name: verificar
description: Verifica JP Smoke con el nivel adecuado (rápida, completa o de release) y resume el resultado. Úsala antes de cada commit, PR o paso a producción, o cuando pidan "verifica", "corre las pruebas" o "¿todo pasa?".
---

1. Elige el nivel:
   - Cambio en curso → `pnpm verify` (tipos, lint, formato, unitarias).
   - Antes de commit o PR → `pnpm verify:full` (+ datos sensibles, build con revisión de CSP, RLS pgTAP, e2e escritorio). Requiere Supabase local (puertos 563xx); si no está listo o cambiaste migraciones: `pnpm db:local` primero.
   - Antes de llevar `main` a `produccion` → `pnpm verify:release` (base limpia + e2e en Android e iPhone simulados).
2. Encadena por el código de salida (`pnpm verify:full && git commit …`), nunca con `| grep` (lección del manual).
3. Reporta en una tabla corta el resultado de cada paso. Si algo falla, abre solo el log indicado y corrige antes de seguir.
4. No repitas una verificación que ya pasó si no cambió el código relacionado. La CI repite en limpio en cada PR; un PR en rojo no se une.
