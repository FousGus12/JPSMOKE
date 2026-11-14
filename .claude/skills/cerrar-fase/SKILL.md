---
name: cerrar-fase
description: Cierra una fase o bloque de trabajo de JP Smoke: verificación, decisiones en el roadmap, HANDOFF, commit, PR y enlace de la vista previa de Vercel. Úsala al terminar una fase o una ola de trabajo.
---

1. `pnpm verify:full` en verde (si se va a producción: `pnpm verify:release`).
2. ROADMAP.md: marca las casillas de §12; registra en §14 las decisiones nuevas (D siguiente); agrega una fila en §15 y sube la versión del encabezado.
3. HANDOFF.md: estado de la fase, pendientes, números de verificación y siguientes pasos.
4. Commit en español (termina con la línea Co-Authored-By de la sesión; autor con el correo noreply de FousGus, ya configurado en el repo). Push.
5. PR hacia `main` con resumen, "Antes de unir" (migraciones, funciones, prueba en dispositivos) y verificación. Revisa la CI con las herramientas ccd_pr (sin polling).
6. Al usuario: mensaje corto con lo hecho, el enlace de la vista previa de Vercel del PR y lo que necesita de él. Lección del manual §0: agrega al menos una línea de "qué haría distinto".
