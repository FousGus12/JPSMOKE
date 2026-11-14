## Qué cambia
<!-- Una o dos líneas por cambio. Decisiones nuevas: D## en ROADMAP §23. -->

Cierra #

## Flujo de despliegue (docs/flujo-despliegue.md)
- [ ] Decisión registrada en ROADMAP §23 y §24 (si cambia alcance o algo cerrado)
- [ ] `pnpm verify:full` en verde (incluye `scripts/revisar-datos.sh`)
- [ ] Revisión de código (`/code-review`; `/security-review` si toca permisos, RLS o funciones)
- [ ] Revisión de datos: sin claves, tokens, `.env` ni volcados; ningún dato de cliente enviado a terceros
- [ ] Migraciones: simuladas con `--dry-run` y aplicadas al remoto con aprobación (o no hay)
- [ ] Probado en la vista previa de Vercel (celular y PC)
- [ ] `pnpm verify:release` antes de unir
- [ ] HANDOFF al día

## Cómo se probó
<!-- Qué se probó y dónde, con exactitud: "emulador móvil" no es "iPhone". -->

**No unir sin aviso de Gustavo** (unir a `main` publica en producción).
