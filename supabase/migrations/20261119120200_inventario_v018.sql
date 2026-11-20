-- =============================================================================
-- JP Smoke · v0.18 inventario.
-- D46: "Inicial" fija la existencia de partida (se guarda aparte); pedidos y merma restan de la actual.
--      Al cruzar el mínimo se encola un aviso de WhatsApp al negocio (máximo uno por insumo cada 6 h).
-- D49: costo por unidad de compra (paquete) o de uso, con fecha; margen objetivo del restaurante.
--      Costos solo para quien tiene Inventario (la tabla no tiene permisos para anon).
-- =============================================================================

alter table public.supplies
  add column initial_stock numeric(12, 2) check (initial_stock >= 0),
  add column initial_at timestamptz,
  add column cost numeric(12, 2) check (cost >= 0 and cost <= 100000000),
  add column cost_basis text not null default 'compra' check (cost_basis in ('compra', 'uso')),
  add column cost_at timestamptz;
comment on column public.supplies.cost is 'Costo en COP por unidad de compra (cost_basis compra) o de uso (uso). D49.';
grant update (cost, cost_basis) on public.supplies to authenticated;

-- Fecha del precio al editar el costo desde el panel.
create function private.touch_supply_cost() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.cost is distinct from old.cost or new.cost_basis is distinct from old.cost_basis then new.cost_at := now(); end if;
  return new;
end $$;
create trigger touch_cost before update of cost, cost_basis on public.supplies for each row execute function private.touch_supply_cost();

alter table public.restaurant_settings
  add column target_margin smallint not null default 65 check (target_margin between 1 and 95);
comment on column public.restaurant_settings.target_margin is 'Margen objetivo en % sobre el precio (D49) para sugerir precios.';
-- Quien tiene Inventario puede guardar el margen objetivo (guard_settings limita a esa columna).
drop policy "equipo con apartado edita ajustes" on public.restaurant_settings;
create policy "equipo con apartado edita ajustes" on public.restaurant_settings for update to authenticated
  using (public.can_of(restaurant_id, 'sitio') or public.can_of(restaurant_id, 'whatsapp') or public.can_of(restaurant_id, 'promos')
         or public.can_of(restaurant_id, 'eventos') or public.can_of(restaurant_id, 'carta') or public.can_of(restaurant_id, 'inventario'))
  with check (public.my_restaurant() = restaurant_id);

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
                 'store_hours', 'pickup_enabled') then 'sitio'
      else 'equipo' end; -- brand, protection y toda columna nueva: solo admin hasta asignarla
    if area = 'promos' and public.can('eventos') then continue; end if;
    if not public.can(area) then
      raise exception 'Sin permiso para cambiar %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Movimientos manuales. D46: 'inicial' fija la existencia de partida y la actual. D49: p_cost actualiza el costo.
drop function public.register_supply(uuid, public.supply_move_kind, numeric, text);
create function public.register_supply(p_supply uuid, p_kind public.supply_move_kind, p_qty numeric, p_note text default null,
  p_cost numeric default null) returns numeric
language plpgsql security definer set search_path = ''
as $$
declare
  s public.supplies;
  delta numeric;
begin
  select * into s from public.supplies where id = p_supply for update;
  if s.id is null or not public.can_of(s.restaurant_id, 'inventario') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  -- Inicial y conteo pueden dejar el insumo en 0; una compra o merma de 0 no tiene sentido.
  if p_kind not in ('compra', 'merma', 'ajuste', 'inicial') or p_qty is null or p_qty < 0
     or (p_kind in ('compra', 'merma') and p_qty = 0) then
    raise exception 'Movimiento inválido' using errcode = '22023';
  end if;
  if p_cost is not null and (p_cost < 0 or p_cost > 100000000) then raise exception 'Costo inválido' using errcode = '22023'; end if;
  -- Compra en unidades de compra; merma en unidades de uso (resta de la existencia actual);
  -- inicial y ajuste dejan la existencia en el valor contado.
  delta := case p_kind when 'compra' then abs(p_qty) * s.per_purchase when 'merma' then -abs(p_qty) else p_qty - s.stock end;
  if s.stock + delta < 0 then raise exception 'No hay tanto en inventario' using errcode = '22023'; end if;
  update public.supplies set stock = stock + delta,
    initial_stock = case when p_kind = 'inicial' then p_qty else initial_stock end,
    initial_at = case when p_kind = 'inicial' then now() else initial_at end,
    cost = coalesce(p_cost, cost)
  where id = s.id;
  insert into public.supply_moves (restaurant_id, supply_id, kind, qty, note, by_user)
  values (s.restaurant_id, s.id, p_kind, delta, nullif(trim(p_note), ''), auth.uid());
  return s.stock + delta;
end;
$$;
grant execute on function public.register_supply(uuid, public.supply_move_kind, numeric, text, numeric) to authenticated;

-- Aviso de insumo bajo (D46): la cola de WhatsApp acepta mensajes de insumo.
alter table public.whatsapp_messages add column supply_id uuid references public.supplies (id) on delete cascade;
alter table public.whatsapp_messages drop constraint whatsapp_messages_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_check
  check (kind = 'informe_semanal' or order_id is not null or (kind = 'stock_bajo' and supply_id is not null));
create index on public.whatsapp_messages (supply_id, created_at desc) where supply_id is not null;

create function private.queue_low_stock() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.active and new.min_stock > 0 and new.stock <= new.min_stock and old.stock > old.min_stock
     and (select whatsapp_mode from public.restaurant_settings where restaurant_id = new.restaurant_id) <> 'manual'
     and not exists (select 1 from public.whatsapp_messages m where m.supply_id = new.id and m.created_at > now() - interval '6 hours') then
    insert into public.whatsapp_messages (restaurant_id, kind, supply_id) values (new.restaurant_id, 'stock_bajo', new.id);
  end if;
  return null;
end $$;
create trigger queue_low_stock after update of stock on public.supplies for each row execute function private.queue_low_stock();

create or replace function public.whatsapp_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
begin
  select array_agg(id) into ids from (
    select m.id from public.whatsapp_messages m
    where m.status in ('pendiente', 'fallido') and m.attempts < 3
      and (m.claimed_at is null or m.claimed_at < now() - interval '5 minutes')
    order by m.created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ) x;
  if ids is null then return '[]'::jsonb; end if;
  update public.whatsapp_messages set claimed_at = now(), attempts = attempts + 1 where id = any (ids);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'kind', m.kind, 'mode', st.whatsapp_mode, 'restaurant', r.name, 'site_url', st.site_url,
      'business_phone', st.whatsapp, 'eta', st.delivery_eta,
      'order', case when o.id is null then null else jsonb_build_object(
        'code', o.code, 'status', o.status, 'name', split_part(o.customer_name, ' ', 1), 'phone', o.phone, 'total', o.total,
        'items', (select count(*) from public.order_items i where i.order_id = o.id), 'zone', o.zone_name, 'channel', o.channel) end,
      'report', case when m.kind = 'informe_semanal' then public.weekly_report(m.restaurant_id) end,
      'supply', case when sp.id is null then null else jsonb_build_object('name', sp.name, 'stock', sp.stock, 'min', sp.min_stock, 'unit', sp.unit) end
    ) order by m.created_at), '[]')
    from public.whatsapp_messages m
    join public.restaurants r on r.id = m.restaurant_id
    join public.restaurant_settings st on st.restaurant_id = m.restaurant_id
    left join public.orders o on o.id = m.order_id
    left join public.supplies sp on sp.id = m.supply_id
    where m.id = any (ids)
  );
end;
$$;
revoke execute on function public.whatsapp_claim(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_claim(integer) to service_role;

-- Cierre (regla del proyecto).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
