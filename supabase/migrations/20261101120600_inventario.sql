-- =============================================================================
-- JP Smoke · Inventario de insumos (F8b, D30). Insumos con unidad de uso y de compra,
-- recetas por producto (el combo suma sus extras), descuento atómico al crear el pedido
-- (bloqueo de filas: dos pedidos de la última gaseosa → solo uno pasa) y devolución al cancelar.
-- =============================================================================

create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 60),
  unit text not null check (length(trim(unit)) between 1 and 20),           -- unidad de uso: pan, hoja, g, porción
  purchase_unit text not null check (length(trim(purchase_unit)) between 1 and 20), -- unidad de compra: paquete, lechuga, kg
  per_purchase numeric(12, 2) not null default 1 check (per_purchase > 0),   -- 1 lechuga = 12 hojas
  stock numeric(12, 2) not null default 0 check (stock >= 0),
  min_stock numeric(12, 2) not null default 0 check (min_stock >= 0),
  active boolean not null default true,
  position smallint not null default 0,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table public.recipes (
  product_id uuid not null references public.products (id) on delete cascade,
  supply_id uuid not null references public.supplies (id) on delete restrict,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  qty numeric(12, 2) not null check (qty > 0),
  combo_only boolean not null default false, -- solo cuando se pide en combo (papas, gaseosa)
  primary key (product_id, supply_id, combo_only)
);

create type public.supply_move_kind as enum ('compra', 'venta', 'devolucion', 'merma', 'ajuste');
create table public.supply_moves (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  supply_id uuid not null references public.supplies (id) on delete cascade,
  kind public.supply_move_kind not null,
  qty numeric(12, 2) not null,              -- con signo: + entra, − sale
  order_id uuid references public.orders (id) on delete set null,
  note text check (length(note) <= 200),
  by_user uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index on public.supply_moves (restaurant_id, at desc);
create index on public.supply_moves (order_id) where order_id is not null;

-- Receta e insumo del mismo restaurante que el producto.
create function private.check_recipe() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.products p join public.supplies s on s.restaurant_id = p.restaurant_id
                 where p.id = new.product_id and s.id = new.supply_id and p.restaurant_id = new.restaurant_id) then
    raise exception 'Insumo o producto de otro restaurante' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger recipes_same_restaurant before insert or update on public.recipes for each row execute function private.check_recipe();

alter table public.supplies enable row level security;
alter table public.recipes enable row level security;
alter table public.supply_moves enable row level security;
create policy "admin gestiona insumos" on public.supplies for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
create policy "admin gestiona recetas" on public.recipes for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
create policy "admin ve movimientos" on public.supply_moves for select to authenticated using (public.is_admin_of(restaurant_id));
-- El stock solo cambia por pedidos y por las funciones de compra/ajuste (queda el movimiento).
revoke update on public.supplies from authenticated;
grant update (name, unit, purchase_unit, per_purchase, min_stock, active, position) on public.supplies to authenticated;
revoke insert, update, delete on public.supply_moves from anon, authenticated;
create trigger touch before update on public.supplies for each row execute function private.touch_updated_at();
create trigger audit after insert or update or delete on public.supplies for each row execute function private.audit_change();

-- Descuento al crear un pedido: una sola sentencia por pedido (todas sus líneas), insumos bloqueados en orden fijo
-- (sin bloqueos cruzados). Si no alcanza, error P0002 con el nombre del producto y nada se guarda.
create function private.consume_supplies() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  need record;
  short text;
begin
  for need in
    select r.supply_id, sum(r.qty * n.qty) as qty, min(p.name) as product, min(n.order_id::text)::uuid as order_id, min(n.restaurant_id::text)::uuid as rid
    from new_items n
    join public.recipes r on r.product_id = n.product_id and (not r.combo_only or n.combo)
    join public.products p on p.id = n.product_id
    group by r.supply_id
    order by r.supply_id
  loop
    perform 1 from public.supplies s where s.id = need.supply_id for update;
    if (select s.stock from public.supplies s where s.id = need.supply_id) < need.qty then
      short := need.product;
      raise exception '%', short using errcode = 'P0002';
    end if;
    update public.supplies set stock = stock - need.qty where id = need.supply_id;
    insert into public.supply_moves (restaurant_id, supply_id, kind, qty, order_id) values (need.rid, need.supply_id, 'venta', -need.qty, need.order_id);
  end loop;
  return null;
end;
$$;
create trigger consume after insert on public.order_items referencing new table as new_items
  for each statement execute function private.consume_supplies();

-- Cancelar devuelve lo descontado.
create function private.restore_supplies() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    with given as (
      select supply_id, -sum(qty) as qty from public.supply_moves where order_id = new.id and kind in ('venta', 'devolucion') group by supply_id
    ), upd as (
      update public.supplies s set stock = s.stock + g.qty from given g where s.id = g.supply_id and g.qty > 0 returning s.id, g.qty
    )
    insert into public.supply_moves (restaurant_id, supply_id, kind, qty, order_id) select new.restaurant_id, id, 'devolucion', qty, new.id from upd;
  end if;
  return new;
end;
$$;
create trigger restore after update of status on public.orders for each row execute function private.restore_supplies();

-- place_order devuelve "agotado" (no un error) cuando falta inventario.
alter function public.place_order(jsonb) set schema private;
alter function private.place_order(jsonb) rename to place_order_core;
create function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  return private.place_order_core(p);
exception when sqlstate 'P0002' then
  return jsonb_build_object('ok', false, 'reason', 'agotado', 'product', sqlerrm);
end;
$$;
revoke execute on function public.place_order(jsonb) from public, anon, authenticated;
grant execute on function public.place_order(jsonb) to service_role;

-- Compras y ajustes (solo admin): quedan como movimiento con quién y cuándo.
create function public.register_supply(p_supply uuid, p_kind public.supply_move_kind, p_qty numeric, p_note text default null) returns numeric
language plpgsql security definer set search_path = ''
as $$
declare
  s public.supplies;
  delta numeric;
begin
  select * into s from public.supplies where id = p_supply for update;
  if s.id is null or not public.is_admin_of(s.restaurant_id) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  -- Un conteo puede dejar el insumo en 0; una compra o merma de 0 no tiene sentido.
  if p_kind not in ('compra', 'merma', 'ajuste') or p_qty is null or p_qty < 0 or (p_kind <> 'ajuste' and p_qty = 0) then
    raise exception 'Movimiento inválido' using errcode = '22023';
  end if;
  -- Compra en unidades de compra (paquetes, lechugas); merma en unidades de uso; ajuste = conteo físico (nuevo stock).
  delta := case p_kind when 'compra' then abs(p_qty) * s.per_purchase when 'merma' then -abs(p_qty) else p_qty - s.stock end;
  if s.stock + delta < 0 then raise exception 'No hay tanto en inventario' using errcode = '22023'; end if;
  update public.supplies set stock = stock + delta where id = s.id;
  insert into public.supply_moves (restaurant_id, supply_id, kind, qty, note, by_user)
  values (s.restaurant_id, s.id, p_kind, delta, nullif(trim(p_note), ''), auth.uid());
  return s.stock + delta;
end;
$$;
grant execute on function public.register_supply(uuid, public.supply_move_kind, numeric, text) to authenticated;

-- Qué productos no se pueden vender ahora por falta de insumos (para la página: solo ids, nada de cantidades).
create function public.stock_status(p_restaurant text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with r as (select id from public.restaurants where slug = p_restaurant and active)
  select jsonb_build_object(
    'sold_out', coalesce((select jsonb_agg(distinct rc.product_id) from public.recipes rc join public.supplies s on s.id = rc.supply_id
                          where rc.restaurant_id = (select id from r) and not rc.combo_only and s.active and s.stock < rc.qty), '[]'),
    'combo_out', coalesce((select jsonb_agg(distinct rc.product_id) from public.recipes rc join public.supplies s on s.id = rc.supply_id
                           where rc.restaurant_id = (select id from r) and s.active and s.stock < rc.qty), '[]')
  )
$$;

-- Insumos por agotarse para el resumen (admin y operador: solo nombres).
create or replace function public.board_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  today timestamptz := date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
  money boolean := public.my_role() = 'admin';
begin
  if rid is null then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'orders_today', count(*) filter (where status <> 'cancelado'),
      'cancelled_today', count(*) filter (where status = 'cancelado'),
      'active', count(*) filter (where status in ('nuevo', 'confirmado', 'en_cocina', 'en_camino')),
      'waiting', count(*) filter (where status = 'nuevo'),
      'avg_minutes', (select round(avg(extract(epoch from (e.at - o2.created_at)) / 60)) from public.orders o2
                      join public.order_events e on e.order_id = o2.id and e.status = 'entregado'
                      where o2.restaurant_id = rid and o2.created_at >= today),
      'sales_today', case when money then coalesce(sum(total) filter (where status <> 'cancelado'), 0) end,
      'ticket_today', case when money then round(avg(total) filter (where status <> 'cancelado')) end,
      'blocked_week', case when money then (select count(*) from public.blocked_attempts b
                       where b.restaurant_id = rid and b.at > now() - interval '7 days') end,
      'low_supplies', (select coalesce(jsonb_agg(s.name order by s.stock / nullif(s.min_stock, 0)), '[]') from public.supplies s
                       where s.restaurant_id = rid and s.active and s.stock <= s.min_stock)
    )
    from public.orders where restaurant_id = rid and created_at >= today
  );
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
grant execute on function public.place_order(jsonb) to service_role;
