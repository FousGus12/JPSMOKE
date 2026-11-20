-- =============================================================================
-- JP Smoke · v0.19 contenido.
-- D56: textos del cupón de bienvenida por evento (events.lead_copy). Campos vacíos = textos actuales del sitio.
-- D57: reseñas transcritas con fuente obligatoria, fecha y orden.
-- Ojo: anon lee events y reviews completas (D34): ninguna columna nueva puede ser interna.
-- =============================================================================

alter table public.events
  add column lead_copy jsonb check (
    lead_copy is null or (
      jsonb_typeof(lead_copy) = 'object'
      and length(lead_copy::text) <= 600
      and lead_copy - 'kicker' - 'title' - 'text' - 'button' = '{}'::jsonb
      and not (lead_copy @? '$.* ? (@.type() != "string")')));
comment on column public.events.lead_copy is 'Textos del aviso de bienvenida (D56): kicker, title, text, button. Vacío = textos por defecto.';

alter table public.reviews
  add column source text not null default 'En persona' check (source in ('Google', 'Instagram', 'WhatsApp', 'En persona')),
  add column review_date date,
  add column position smallint not null default 0;
update public.reviews set review_date = (created_at at time zone 'America/Bogota')::date where review_date is null;
alter table public.reviews alter column review_date set not null,
  alter column review_date set default ((now() at time zone 'America/Bogota')::date);
comment on column public.reviews.source is 'Dónde se dejó la reseña real (D57).';
comment on column public.reviews.review_date is 'Fecha de la reseña original (D57).';
create index on public.reviews (restaurant_id, position);
