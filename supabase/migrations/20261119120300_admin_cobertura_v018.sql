-- =============================================================================
-- JP Smoke · v0.18 administración y cobertura.
-- D41: Clientes (lista con pedidos y total) y Seguridad (auditoría con nombre de quien hizo el cambio): solo admin.
-- D44: cada zona puede ligarse a una localidad de Bogotá (código IDECA de 2 dígitos) para el mapa y el
--      verificador de cobertura; coordenadas del punto físico (rango de Bogotá) visibles para el sitio.
-- =============================================================================

alter table public.delivery_zones add column locality_code text check (locality_code ~ '^[0-9]{2}$');
comment on column public.delivery_zones.locality_code is 'Código de localidad de Bogotá (IDECA, 2 dígitos) para el mapa (D44).';
-- Código de localidad por nombre normalizado (las zonas de JP Smoke son localidades). Un disparador lo
-- calcula al crear o renombrar una zona sin código, para que sirva también con el seed y tenants nuevos.
create function private.locality_code_of(zone_name text) returns text
language sql immutable set search_path = ''
as $$
  select m.code from (values ('USAQUEN','01'),('CHAPINERO','02'),('SANTA FE','03'),('SAN CRISTOBAL','04'),('USME','05'),('TUNJUELITO','06'),
             ('BOSA','07'),('KENNEDY','08'),('FONTIBON','09'),('ENGATIVA','10'),('SUBA','11'),('BARRIOS UNIDOS','12'),
             ('TEUSAQUILLO','13'),('LOS MARTIRES','14'),('MARTIRES','14'),('ANTONIO NARINO','15'),('PUENTE ARANDA','16'),
             ('LA CANDELARIA','17'),('CANDELARIA','17'),('RAFAEL URIBE URIBE','18'),('RAFAEL URIBE','18'),('CIUDAD BOLIVAR','19'))
     as m(name, code)
  where m.name = upper(translate(trim(zone_name), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))
$$;
create function private.fill_locality_code() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.locality_code is null and (tg_op = 'INSERT' or new.name is distinct from old.name) then
    new.locality_code := private.locality_code_of(new.name);
  end if;
  return new;
end $$;
create trigger fill_locality before insert or update of name on public.delivery_zones
  for each row execute function private.fill_locality_code();
update public.delivery_zones set locality_code = private.locality_code_of(name) where locality_code is null;

alter table public.restaurant_settings
  add column store_lat numeric(9, 6) check (store_lat between 4.4 and 4.9),
  add column store_lng numeric(9, 6) check (store_lng between -74.3 and -73.9);
grant select (store_lat, store_lng) on public.restaurant_settings to anon;

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
      when k = 'target_margin' then 'inventario'
      when k in ('hero', 'sections', 'channels', 'blocks', 'instagram', 'tiktok', 'hours', 'delivery_min',
                 'delivery_eta', 'accepting_orders', 'store_open', 'store_address', 'store_maps_url',
                 'store_hours', 'pickup_enabled', 'store_lat', 'store_lng') then 'sitio'
      else 'equipo' end; -- brand, protection y toda columna nueva: solo admin hasta asignarla
    if area = 'promos' and public.can('eventos') then continue; end if;
    if not public.can(area) then
      raise exception 'Sin permiso para cambiar %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Clientes del restaurante con su historial resumido (solo admin).
create function public.customers_list(p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if rid is null or not public.is_admin_of(rid) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with base as (
      select c.id, c.name, c.phone, c.trusted, c.blocked, c.notes, c.created_at,
        (select count(*) from public.orders o where o.customer_id = c.id and o.status <> 'cancelado') orders,
        (select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = c.id and o.status = 'entregado') spent,
        (select max(o.created_at) from public.orders o where o.customer_id = c.id) last_order
      from public.customers c
      where c.restaurant_id = rid
        and (q is null or c.name ilike '%' || q || '%'
             or (regexp_replace(q, '\D', '', 'g') <> '' and c.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%'))
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', (select coalesce(jsonb_agg(to_jsonb(b) order by b.last_order desc nulls last), '[]') from (
        select * from base order by last_order desc nulls last
        limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) b))
  );
end;
$$;
grant execute on function public.customers_list(text, integer, integer) to authenticated;

-- Registro de auditoría con el nombre de quien hizo el cambio (solo admin), paginado por fecha.
create function public.audit_list(p_limit integer default 50, p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
begin
  if rid is null or not public.is_admin_of(rid) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'action', a.action, 'entity', a.entity,
        'entity_id', a.entity_id, 'detail', a.detail, 'actor', coalesce(s.full_name, case when a.actor is null then 'Sistema' else 'Cuenta eliminada' end))
        order by a.at desc), '[]')
    from (select * from public.audit_log l where l.restaurant_id = rid and (p_before is null or l.at < p_before)
          order by l.at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) a
    left join public.staff s on s.user_id = a.actor
  );
end;
$$;
grant execute on function public.audit_list(integer, timestamptz) to authenticated;

-- Cierre (regla del proyecto).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
