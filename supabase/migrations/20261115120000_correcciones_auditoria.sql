-- =============================================================================
-- JP Smoke · Correcciones de la auditoría run-2 (D39, 2026-11-15).
-- 1. Ajustes del restaurante: lista explícita columna → apartado; el número del negocio es de WhatsApp;
--    lo no listado es solo del admin (falla cerrado).
-- 2. published_at solo lo escriben publish_site/unmark_published; tope por restaurante por hora.
-- 3. Un JWT de una sesión cerrada (reset de clave) deja de autorizar.
-- 4. Clave temporal: hay que cambiarla antes de entrar al panel.
-- 5. Seguimiento por 4 dígitos: tope acumulado de fallos por pedido.
-- =============================================================================

-- 4. Clave temporal pendiente (la marca la Edge Function `equipo`; solo el servidor la cambia).
alter table public.staff add column must_change_password boolean not null default false;
comment on column public.staff.must_change_password is 'Clave temporal sin cambiar (D39): sin acceso al panel hasta cambiarla.';

-- 3 y 4. Sesión viva y sin clave temporal pendiente. Los JWT de Supabase Auth traen session_id; los
-- claims simulados de las pruebas no lo traen y se tratan como sesión viva.
create or replace function public.my_restaurant() returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.restaurant_id from public.staff s
  join public.restaurants r on r.id = s.restaurant_id and r.active
  where s.user_id = (select auth.uid()) and s.active and not s.must_change_password
    and ((s.role = 'operador' and cardinality(s.permissions) = 0)
         or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
    and (nullif((select auth.jwt()) ->> 'session_id', '') is null
         or exists (select 1 from auth.sessions x
                    where x.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid))
$$;

create or replace function public.my_role() returns public.staff_role
language sql stable security definer set search_path = ''
as $$
  select s.role from public.staff s
  where s.user_id = (select auth.uid()) and s.active and not s.must_change_password
    and ((s.role = 'operador' and cardinality(s.permissions) = 0)
         or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
    and (nullif((select auth.jwt()) ->> 'session_id', '') is null
         or exists (select 1 from auth.sessions x
                    where x.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid))
$$;

create or replace function public.my_staff() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', s.full_name, 'role', s.role, 'restaurant', r.name, 'slug', r.slug,
    'restaurant_id', r.id, 'permissions', to_jsonb(s.permissions),
    'needs_totp', s.role = 'admin' or cardinality(s.permissions) > 0,
    'must_change_password', s.must_change_password,
    'aal_ok', (s.role = 'operador' and cardinality(s.permissions) = 0)
              or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
  from public.staff s join public.restaurants r on r.id = s.restaurant_id and r.active
  where s.user_id = (select auth.uid()) and s.active
$$;

-- 1 y 2. Ajustes: lista explícita; published_at solo dentro de las funciones de publicar.
create or replace function private.guard_settings() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old) - 'updated_at';
  n jsonb := to_jsonb(new) - 'updated_at';
  k text;
  area text;
begin
  if (select auth.uid()) is null then return new; end if; -- servidor y tareas programadas
  for k in select key from jsonb_each(n) where n -> key is distinct from o -> key loop
    if k = 'published_at' then
      if coalesce(current_setting('jps.publicando', true), '') = 'on' then continue; end if;
      raise exception 'La fecha de publicación solo la cambia Publicar' using errcode = '42501';
    end if;
    area := case
      when k in ('whatsapp', 'whatsapp_mode', 'site_url') then 'whatsapp'
      when k = 'intro_mode' then 'promos'
      when k in ('hero', 'sections', 'channels', 'blocks', 'instagram', 'tiktok', 'hours', 'delivery_min',
                 'delivery_eta', 'accepting_orders', 'store_open', 'store_address', 'store_maps_url',
                 'store_hours', 'pickup_enabled') then 'sitio'
      else 'equipo' end; -- brand, protection y toda columna nueva: solo admin hasta asignarla
    if area = 'promos' and public.can('eventos') then continue; end if;
    if not public.can(area) then
      raise exception 'Sin permiso para cambiar %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

create or replace function public.publish_site() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  last timestamptz;
begin
  if rid is null or not (public.can('carta') or public.can('sitio') or public.can('promos') or public.can('eventos')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select published_at into last from public.restaurant_settings where restaurant_id = rid for update;
  if last is not null and last > now() - interval '1 minute' then
    raise exception 'Espera un minuto entre publicaciones' using errcode = 'P0001', hint = 'muy_seguido';
  end if;
  -- Tope que no depende de published_at: 20 publicaciones por hora por restaurante.
  if not public.rate_hit('publicar:' || rid, 20, 3600) then
    raise exception 'Espera un minuto entre publicaciones' using errcode = 'P0001', hint = 'muy_seguido';
  end if;
  perform set_config('jps.publicando', 'on', true);
  update public.restaurant_settings set published_at = now() where restaurant_id = rid;
  perform set_config('jps.publicando', '', true);
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id) values (rid, auth.uid(), 'publicar', 'sitio', null);
  return jsonb_build_object('published_at', now(), 'slug', (select slug from public.restaurants where id = rid));
end;
$$;

-- Solo deshace la marca de una publicación recién hecha (la llama `publicar` si falla el deploy hook).
create or replace function public.unmark_published() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.my_restaurant() is null
     or not (public.can('carta') or public.can('sitio') or public.can('promos') or public.can('eventos')) then
    return;
  end if;
  perform set_config('jps.publicando', 'on', true);
  update public.restaurant_settings set published_at = null
  where restaurant_id = public.my_restaurant() and published_at > now() - interval '2 minutes';
  perform set_config('jps.publicando', '', true);
end $$;

-- 5. Seguimiento por 4 dígitos: además de 5 fallos por hora, máximo 15 fallos en la vida del pedido.
create table private.track_fails (
  order_id uuid primary key references public.orders (id) on delete cascade,
  fails integer not null default 0
);

create or replace function public.track_order_by_phone(p_restaurant text, p_code text, p_last4 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  k text;
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
begin
  if coalesce(p_last4, '') !~ '^[0-9]{4}$' then return null; end if;
  select ord.* into o from public.orders ord
  join public.restaurants r on r.id = ord.restaurant_id and r.slug = p_restaurant
  where ord.code = upper(p_code) and ord.created_at > now() - interval '7 days';
  if o.id is null then return null; end if;
  k := 'last4:' || o.id;
  perform pg_advisory_xact_lock(hashtext(k));
  if coalesce((select fails from private.track_fails where order_id = o.id), 0) >= 15 then return null; end if;
  if coalesce((select hits from private.rate_limits where key = k and window_start = w), 0) >= 5 then return null; end if;
  if right(o.phone, 4) = p_last4 then return private.order_public(o); end if;
  insert into private.rate_limits (key, window_start, hits) values (k, w, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1;
  insert into private.track_fails (order_id, fails) values (o.id, 1)
  on conflict (order_id) do update set fails = private.track_fails.fails + 1;
  return null;
end;
$$;

-- Defensa en profundidad (auditoría run-2): staff sin INSERT/DELETE para authenticated.
revoke insert, delete on public.staff from authenticated;

-- Cierre (D34): nada nuevo abierto para anon; el sitio sigue con track_order y stock_status.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
revoke execute on function public.revoke_sessions(uuid) from authenticated;
