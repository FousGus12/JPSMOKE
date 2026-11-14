---
name: desplegar
description: Lleva un cambio de JP Smoke por el flujo de despliegue (docs/flujo-despliegue.md) con revisión de código, de datos sensibles, CI, vista previa, migraciones y publicación, deteniéndose en cada aprobación de Gustavo. Úsala cuando pidan "despliega", "publica", "prepara el despliegue" o "pasa a producción".
---

Sigue `docs/flujo-despliegue.md` en orden. No te saltes pasos ni publiques sin aprobación.

1. **Alcance:** PR o ramas que entran; agrupar (pocas publicaciones al mes, D14).
2. **Verificación:** `pnpm verify:full` (skill `verificar`).
3. **Revisión de código:** `/code-review` sobre el diff; `/security-review` si cambian migraciones, RLS, RPC o Edge Functions.
4. **Revisión de datos:** `scripts/revisar-datos.sh` y revisión a mano de que ningún dato de clientes salga a terceros ni quede en pruebas o capturas.
5. **CI y vista previa:** PR en verde; pasa a Gustavo el enlace de la vista previa y espera su visto bueno.
6. **Migraciones y funciones:** skill `migracion-remota`, siempre antes de unir.
7. **Unir a `main`:** integra; publica solo como vista previa (D36). Unir por fast-forward: `git push origin <rama>:main` con la rama al día con `main` y la CI en verde (GitHub marca el PR como unido). Nunca con el botón ni `gh pr merge`: el commit de unión queda a nombre de FousGus12 y Vercel Hobby bloquea el despliegue (`--author-email` no sirve: GitHub solo acepta correos de quien une).
8. **Producción:** `pnpm verify:release` y, con un "sí" explícito de Gustavo para ese despliegue, llevar `main` a `produccion` (`git push origin main:produccion`).
9. **Verificar producción** (https://jp-smoke.vercel.app, nunca `jp-smoke-estudio.vercel.app`, que es de otra persona): HTTP 200, encabezados, CSP por hash en la página, consola sin errores.
10. **Cierre:** HANDOFF y ROADMAP §12 al día; cerrar el Issue.
