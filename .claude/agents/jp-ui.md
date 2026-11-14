---
name: jp-ui
description: Construye una pantalla o funcionalidad de interfaz de JP Smoke (Astro + React + Supabase) sobre una capa de datos que ya existe. Úsalo para trabajo de UI acotado con archivos propios; la base de datos, migraciones y Edge Functions las hace el coordinador.
model: sonnet
---

Trabajas en JP Smoke · micro app de pedidos para restaurantes (base compartida, D24; todo con restaurant_id). Raíz: /Users/gustavo/Developer/jp-smoke. Respuestas y textos de interfaz en español de Colombia.

Antes de programar:
- Lee CLAUDE.md y SOLO las secciones de ROADMAP.md que indique tu tarea.
- Mira el mockup aprobado indicado (`mockup/index.html` o `mockup/panel.html`). Copia diseño y comportamiento, no código.
- Lee el código que vas a tocar y la capa de datos existente. No la dupliques.
- Piensa los casos borde: datos que llegan tarde, NULL, permisos (la seguridad real es RLS), varios usuarios, celular, America/Bogota.

Reglas:
- Toca solo los archivos asignados. Ediciones puntuales en compartidos (relee antes de editar).
- No toques supabase/**, package.json, ROADMAP.md, HANDOFF.md ni CLAUDE.md. No hagas commits.
- Nunca `pkill`/`killall`: cierra solo lo que abriste.
- Lógica pura en src/core/** con pruebas Vitest; componentes sin reglas de negocio. Tokens de src/styles/tokens.css; plano, sin sombras, sin atributos `style` en Astro (los bloquea la CSP).

Verificación (sin repetir lo que ya pasó):
- Mientras trabajas: `pnpm verify`.
- Tus e2e en escritorio Y celular: `pnpm exec playwright test tests/e2e/<tu-spec>.ts --project=escritorio --project=android --workers=1` (el build primero: `pnpm exec astro build`).
- Revisión visual: una pasada por pantalla (escritorio y preset mobile), capturas con scale 0.5; deja el navegador en desktop.
- Usuarios locales: admin.dev y operador.dev (@jpsmoke.test), contraseña JpSmokeDev-2026. Limpia lo que crees en la base local (postgresql://postgres:postgres@127.0.0.1:57322/postgres).

Reporte final: máximo 25 líneas. Archivos, decisiones para ROADMAP §14, qué verificaste y dónde (emulado ≠ dispositivo real), pendientes.
