-- =============================================================================
-- JP Smoke · v0.18 pedidos.
-- D42: el admin anula un pedido en cualquier estado (también entregado) con motivo; no se borra.
--      "Pedido de prueba" marca is_test: no cuenta en ventas, cancelados ni exportación.
-- D43: los intentos frenados guardan datos mínimos para revisarlos (nombre, últimos 4 del celular,
--      zona, total intentado, número de productos) y se borran a los 30 días.
-- D47: un pedido web sin ningún plato se rechaza ('sin_plato').
-- =============================================================================

alter table public.orders
  add column is_test boolean not null default false,
  add column voided_from public.order_status;
comment on column public.orders.is_test is 'Anulado como pedido de prueba (D42): fuera de ventas y estadísticas.';
comment on column public.orders.voided_from is 'Estado desde el que se anuló (D42).';

alter table public.blocked_attempts
  add column customer_name text check (length(customer_name) <= 80),
  add column phone_last4 text check (phone_last4 ~ '^[0-9]{4}$'),
  add column zone_name text check (length(zone_name) <= 60),
  add column total_attempt integer check (total_attempt between 0 and 100000000),
  add column items_count smallint check (items_count between 0 and 100);

-- Total estimado de un intento frenado con precios del servidor (D43). Tolerante a datos malos.
create function private.items_estimate(rid uuid, items jsonb) returns integer
language sql stable security definer set search_path = ''
as $$
  select case when jsonb_typeof(items) = 'array' then (
    select sum(pr.price * least(greatest((x ->> 'qty')::integer, 1), 30))::integer
    from jsonb_array_elements(items) x
    join public.products pr on pr.restaurant_id = rid
      and coalesce(x ->> 'product_id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and pr.id = (x ->> 'product_id')::uuid
    where coalesce(x ->> 'qty', '') ~ '^[0-9]{1,2}$') end
$$;

-- Registro de un intento frenado con detalle tolerante a datos malos (nunca falla por el detalle).
drop function private.log_blocked(uuid, text);
create function private.log_blocked(rid uuid, why text, d jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ph text := regexp_replace(coalesce(d ->> 'phone', ''), '\D', '', 'g');
begin
  insert into public.blocked_attempts (restaurant_id, reason, customer_name, phone_last4, zone_name, total_attempt, items_count)
  values (rid, why,
    nullif(left(trim(coalesce(d ->> 'name', '')), 80), ''),
    case when length(ph) >= 4 then right(ph, 4) end,
    nullif(left(trim(coalesce(d ->> 'zone', '')), 60), ''),
    case when coalesce(d ->> 'total', '') ~ '^[0-9]{1,8}$' then (d ->> 'total')::integer end,
    case when coalesce(d ->> 'items', '') ~ '^[0-9]{1,2}$' then (d ->> 'items')::smallint end);
  return jsonb_build_object('ok', false, 'reason', why);
end;
$$;

-- Intentos frenados antes de la base (robot, IP repetida). Solo el servidor. El detalle llega de la
-- Edge Function; la zona se resuelve aquí.
drop function public.register_blocked(text, text);
create function public.register_blocked(p_restaurant text, p_reason text, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := (select r.id from public.restaurants r where r.slug = p_restaurant);
  d jsonb := coalesce(p_detail, '{}'::jsonb);
begin
  if rid is null or p_reason not in ('robot', 'repetido') then return; end if;
  if coalesce(d ->> 'zone_id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    d := d || jsonb_build_object('zone', (select z.name from public.delivery_zones z where z.id = (d ->> 'zone_id')::uuid and z.restaurant_id = rid));
  end if;
  if jsonb_typeof(d -> 'lines') = 'array' then
    d := d || jsonb_build_object('total', private.items_estimate(rid, d -> 'lines'));
  end if;
  perform private.log_blocked(rid, p_reason, d);
end;
$$;
revoke execute on function public.register_blocked(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.register_blocked(text, text, jsonb) to service_role;

-- Borrado de intentos frenados con más de 30 días (D43).
create function private.purge_blocked() returns void
language sql security definer set search_path = ''
as $$ delete from public.blocked_attempts where at < now() - interval '30 days' $$;
select cron.schedule('jps-purgar-frenados', '30 8 * * *', 'select private.purge_blocked()');

create or replace function private.place_order_core(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.restaurants;
  st public.restaurant_settings;
  z public.delivery_zones;
  pm public.payment_methods;
  cp public.coupons;
  c jsonb := p -> 'customer';
  ph text := regexp_replace(coalesce(p -> 'customer' ->> 'phone', ''), '\D', '', 'g');
  cust public.customers;
  it jsonb;
  pr public.products;
  q integer;
  is_combo boolean;
  sub integer := 0;
  disc integer := 0;
  fee integer;
  gift text;
  n integer;
  oid uuid;
  ocode text;
  lines jsonb := '[]'::jsonb;
  addon boolean;
  pos integer := 0;
  keys jsonb := '{}'::jsonb;
  ln jsonb;
  pk text;
  pickup boolean := coalesce(p ->> 'fulfillment', 'domicilio') = 'recoger';
  det jsonb;
  has_dish boolean := false;
  zone_label text;
  address_text text;
begin
  select * into r from public.restaurants where slug = p ->> 'restaurant' and active;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'restaurante'); end if;
  select * into st from public.restaurant_settings where restaurant_id = r.id;
  -- D43: datos mínimos para revisar un intento frenado (sin celular completo, sin IP).
  det := jsonb_build_object(
    'name', left(trim(coalesce(c ->> 'name', '')), 80),
    'phone', ph,
    'zone', case when pickup then 'Recoge en tienda'
                 when coalesce(c ->> 'zone_id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
                   (select dz.name from public.delivery_zones dz where dz.id = (c ->> 'zone_id')::uuid and dz.restaurant_id = r.id) end,
    'items', case when jsonb_typeof(p -> 'items') = 'array' then jsonb_array_length(p -> 'items') end,
    'total', private.items_estimate(r.id, p -> 'items'));
  if not st.accepting_orders then return private.log_blocked(r.id, 'cerrado', det); end if;

  if ph !~ '^3[0-9]{9}$' or length(trim(coalesce(c ->> 'name', ''))) < 2
     or (not pickup and (length(trim(coalesce(c ->> 'address', ''))) < 8 or coalesce(c ->> 'address', '') !~ '[0-9]'))
     or length(coalesce(p ->> 'token', '')) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'datos');
  end if;

  select * into cust from public.customers where restaurant_id = r.id and phone = ph;
  if cust.blocked then return private.log_blocked(r.id, 'bloqueado', det); end if;
  if (select count(*) from public.orders o where o.restaurant_id = r.id and o.phone = ph
        and o.created_at > now() - interval '1 hour') >= private.max_per_hour(st.protection) then
    return private.log_blocked(r.id, 'repetido', det);
  end if;
  -- Estricta: el primer pedido de un número nuevo queda para revisión (sigue entrando como 'nuevo').

  -- Recoger en tienda (D33): sin zona ni domicilio; solo si el local lo tiene encendido.
  if pickup then
    if not st.pickup_enabled then return jsonb_build_object('ok', false, 'reason', 'recoger'); end if;
    zone_label := 'Recoge en tienda';
    address_text := left('Recoge en: ' || st.store_address, 160);
  else
    select * into z from public.delivery_zones where id = (c ->> 'zone_id')::uuid and restaurant_id = r.id and active;
    if z.id is null then return private.log_blocked(r.id, 'fuera_de_zona', det); end if;
    zone_label := z.name;
    address_text := trim(c ->> 'address');
  end if;
  select * into pm from public.payment_methods where restaurant_id = r.id and code = p ->> 'payment_code' and active;
  if pm.id is null then return jsonb_build_object('ok', false, 'reason', 'pago'); end if;

  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') not between 1 and 30 then
    return jsonb_build_object('ok', false, 'reason', 'datos');
  end if;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    q := (it ->> 'qty')::integer;
    is_combo := coalesce((it ->> 'combo')::boolean, false);
    select * into pr from public.products where id = (it ->> 'product_id')::uuid and restaurant_id = r.id and visible;
    if pr.id is null or q is null or q not between 1 and 30 then return jsonb_build_object('ok', false, 'reason', 'datos'); end if;
    if not pr.available then return jsonb_build_object('ok', false, 'reason', 'agotado', 'product', pr.name); end if;
    if is_combo and pr.combo_price is null then is_combo := false; end if;
    sub := sub + q * case when is_combo then pr.combo_price else pr.price end;
    -- D40: adiciones ligadas a un plato del mismo pedido (key/parent opcionales; el sitio viejo manda ítems planos).
    select c.is_addons into addon from public.categories c where c.id = pr.category_id;
    if not coalesce(addon, false) then has_dish := true; end if;
    pos := pos + 1;
    if nullif(it ->> 'key', '') is not null then
      if (it ->> 'key') !~ '^[A-Za-z0-9-]{1,40}$' or keys ? (it ->> 'key') then return jsonb_build_object('ok', false, 'reason', 'datos'); end if;
      keys := keys || jsonb_build_object(it ->> 'key', jsonb_build_object('pos', pos, 'addon', coalesce(addon, false)));
    end if;
    lines := lines || jsonb_build_object('id', gen_random_uuid(), 'pos', pos, 'key', nullif(it ->> 'key', ''),
      'parent', nullif(it ->> 'parent', ''), 'addon', coalesce(addon, false),
      'product_id', pr.id, 'name', pr.name, 'qty', q, 'combo', is_combo,
      'unit', case when is_combo then pr.combo_price else pr.price end);
  end loop;
  -- El padre existe en este pedido, no es adición y no tiene padre; solo una adición puede tener padre.
  for ln in select * from jsonb_array_elements(lines) loop
    pk := ln ->> 'parent';
    if pk is not null then
      if not (ln ->> 'addon')::boolean or not keys ? pk or (keys -> pk ->> 'addon')::boolean then
        return jsonb_build_object('ok', false, 'reason', 'datos');
      end if;
      if exists (select 1 from jsonb_array_elements(lines) x where x ->> 'key' = pk and x ->> 'parent' is not null) then
        return jsonb_build_object('ok', false, 'reason', 'datos');
      end if;
    end if;
  end loop;
  -- D47: el pedido web lleva al menos un plato (una adición sola no es pedido).
  if not has_dish then return jsonb_build_object('ok', false, 'reason', 'sin_plato'); end if;
  if sub < st.delivery_min then return jsonb_build_object('ok', false, 'reason', 'minimo', 'min', st.delivery_min); end if;

  fee := case when pickup then 0 else z.fee end;
  if nullif(trim(coalesce(p ->> 'coupon', '')), '') is not null then
    select * into cp from public.coupons
      where restaurant_id = r.id and lower(code::text) = lower(trim(p ->> 'coupon')) and active
        and (starts_on is null or starts_on <= (now() at time zone 'America/Bogota')::date)
        and (ends_on is null or ends_on >= (now() at time zone 'America/Bogota')::date)
        and (max_uses is null or uses < max_uses)
      -- Bloqueo del cupón: dos pedidos simultáneos no pasan el cupo ni el "una vez por celular" (auditoría 2026-11-02).
      for update;
    if cp.id is null or sub < cp.min_total then return jsonb_build_object('ok', false, 'reason', 'cupon'); end if;
    if cp.once_per_phone and exists (select 1 from public.orders o where o.restaurant_id = r.id and o.phone = ph
        and o.coupon_code = cp.code::text and o.status <> 'cancelado') then
      return jsonb_build_object('ok', false, 'reason', 'cupon_usado');
    end if;
    case cp.kind
      when 'porcentaje' then disc := round(sub * cp.value / 100.0);
      when 'valor' then disc := least(cp.value, sub);
      when 'envio' then fee := 0;
      when 'regalo' then gift := cp.title;
    end case;
  end if;

  -- Consecutivo por restaurante sin choques: se bloquea la fila del restaurante.
  perform 1 from public.restaurants where id = r.id for update;
  select coalesce(max(number), 0) + 1 into n from public.orders where restaurant_id = r.id;
  ocode := r.order_prefix || '-' || lpad(n::text, 4, '0');

  insert into public.customers (restaurant_id, phone, name) values (r.id, ph, trim(c ->> 'name'))
  on conflict (restaurant_id, phone) do update set name = excluded.name
  returning * into cust;

  insert into public.orders (restaurant_id, number, code, track_hash, customer_id, channel, fulfillment, customer_name, phone,
    address, barrio, zone_name, notes, payment_label, cash_with, subtotal, discount, delivery_fee, total, coupon_code, gift)
  values (r.id, n, ocode, encode(extensions.digest(p ->> 'token', 'sha256'), 'hex'), cust.id, 'web', case when pickup then 'recoger' else 'domicilio' end, trim(c ->> 'name'), ph,
    address_text, left(trim(coalesce(c ->> 'barrio', '')), 60), zone_label, left(trim(coalesce(c ->> 'notes', '')), 200),
    pm.label, nullif(regexp_replace(coalesce(p ->> 'cash_with', ''), '\D', '', 'g'), '')::integer,
    sub, disc, fee, sub - disc + fee, cp.code::text, gift)
  returning id into oid;

  -- Primero los platos y luego las adiciones (la llave foránea al padre exige que exista).
  insert into public.order_items (id, order_id, restaurant_id, product_id, name, qty, combo, unit_price, position, parent_item_id)
  select (l ->> 'id')::uuid, oid, r.id, (l ->> 'product_id')::uuid, l ->> 'name', (l ->> 'qty')::smallint, (l ->> 'combo')::boolean,
    (l ->> 'unit')::integer, (l ->> 'pos')::smallint,
    (select (x ->> 'id')::uuid from jsonb_array_elements(lines) x where x ->> 'key' = l ->> 'parent')
  from jsonb_array_elements(lines) l
  order by (l ->> 'parent') is not null, (l ->> 'pos')::integer;
  insert into public.order_events (order_id, restaurant_id, status) values (oid, r.id, 'nuevo');
  if cp.id is not null then update public.coupons set uses = uses + 1 where id = cp.id; end if; -- fila ya bloqueada arriba

  insert into public.consents (restaurant_id, phone, kind, version, granted, source)
  values (r.id, ph, 'datos_pedido', coalesce(p ->> 'consent_version', 'v1'), true, 'pedido web');
  if coalesce((p ->> 'promos')::boolean, false) then
    insert into public.consents (restaurant_id, phone, kind, version, granted, source)
    values (r.id, ph, 'promociones', coalesce(p ->> 'consent_version', 'v1'), true, 'pedido web');
  end if;

  return jsonb_build_object('ok', true, 'code', ocode, 'total', sub - disc + fee);
end;
$function$;


-- Cambio de estado desde el panel. D42: el admin puede anular también un pedido entregado (con motivo);
-- un pedido cancelado ya no cambia. Anular devuelve insumos (disparador restore_supplies).
create or replace function public.set_order_status(p_order uuid, p_status public.order_status, p_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  test boolean;
begin
  -- Bloqueo de fila: dos dispositivos que mueven el mismo pedido a la vez no se pisan.
  select * into o from public.orders where id = p_order for update;
  -- Primero quién llama (no revelar si el pedido existe; lección de Pulso).
  if o.id is null or not public.is_staff_of(o.restaurant_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  -- Solo el admin marca un pedido como de prueba (sale de cancelados y exportación).
  test := coalesce(p_reason, '') ilike 'pedido de prueba%' and public.is_admin_of(o.restaurant_id);
  if o.status = 'cancelado' then
    raise exception 'El pedido ya está cancelado' using errcode = '22023';
  end if;
  if o.status = 'entregado' and p_status <> 'cancelado' then
    raise exception 'El pedido ya está cerrado' using errcode = '22023';
  end if;
  if o.status = 'entregado' and not public.is_admin_of(o.restaurant_id) then
    raise exception 'Solo el admin anula un pedido entregado' using errcode = '42501';
  end if;
  if p_status = 'cancelado' and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Cancelar exige un motivo' using errcode = '22023';
  end if;
  if p_status <> 'cancelado' and array_position(enum_range(null::public.order_status), p_status)
       <= array_position(enum_range(null::public.order_status), o.status) then
    raise exception 'Ese estado no sigue al actual' using errcode = '22023';
  end if;
  update public.orders set status = p_status,
    cancel_reason = case when p_status = 'cancelado' then left(trim(p_reason), 200) end,
    voided_from = case when p_status = 'cancelado' then o.status end,
    is_test = case when p_status = 'cancelado' then test else false end
  where id = o.id;
  insert into public.order_events (order_id, restaurant_id, status, by_user) values (o.id, o.restaurant_id, p_status, auth.uid());
  if p_status = 'cancelado' and p_reason ilike 'pedido falso%' then
    update public.customers set blocked = true where id = o.customer_id;
  end if;
  if p_status = 'entregado' or o.status = 'entregado' then
    update public.customers c set trusted = (select count(*) from public.orders x where x.customer_id = c.id and x.status = 'entregado') >= 2
    where c.id = o.customer_id;
  end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values (o.restaurant_id, auth.uid(), case when o.status = 'entregado' then 'anular' else 'estado' end, 'orders', o.code,
          jsonb_build_object('de', o.status, 'a', p_status, 'motivo', p_reason, 'prueba', test));
end;
$$;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

CREATE OR REPLACE FUNCTION public.board_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
  today timestamptz := date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
  money boolean := public.can('ventas');
begin
  if rid is null then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'orders_today', count(*) filter (where status <> 'cancelado'),
      'cancelled_today', count(*) filter (where status = 'cancelado' and not is_test),
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
    from public.orders where restaurant_id = rid and created_at >= today and not (is_test and status = 'cancelado')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_export(p_days integer DEFAULT 30)
 RETURNS TABLE(codigo text, fecha timestamp with time zone, canal text, estado text, pago text, subtotal integer, descuento integer, domicilio integer, total integer, cupon text, productos text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, detail)
  values (rid, auth.uid(), 'exportar', 'ventas', jsonb_build_object('dias', p_days));
  return query
    select o.code, o.created_at, o.channel::text, o.status::text, o.payment_label, o.subtotal, o.discount, o.delivery_fee, o.total, o.coupon_code,
      (select string_agg(i.qty || '× ' || i.name || case when i.combo then ' (combo)' else '' end, '; ') from public.order_items i where i.order_id = o.id)
    from public.orders o
    where o.restaurant_id = rid and not o.is_test and o.created_at >= private.bogota_day_start(greatest(1, least(coalesce(p_days, 30), 366)) - 1)
    order by o.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_summary(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
  days integer := greatest(1, least(coalesce(p_days, 30), 366));
  since timestamptz := private.bogota_day_start(days - 1);
  prev timestamptz := private.bogota_day_start(2 * days - 1);
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where restaurant_id = rid and created_at >= since and status <> 'cancelado'),
    p as (select * from public.orders where restaurant_id = rid and created_at >= prev and created_at < since and status <> 'cancelado'),
    days_list as (select (generate_series(since at time zone 'America/Bogota', now() at time zone 'America/Bogota', interval '1 day'))::date d)
    select jsonb_build_object(
      'days', days,
      'total', coalesce((select sum(total) from o), 0),
      'orders', (select count(*) from o),
      'ticket', coalesce((select round(avg(total)) from o), 0),
      'previous_total', coalesce((select sum(total) from p), 0),
      'previous_orders', (select count(*) from p),
      'cancelled', (select count(*) from public.orders where restaurant_id = rid and created_at >= since and status = 'cancelado' and not is_test),
      -- D42: entregados anulados después de cerrar la caja de su día (el cierre guardado no cambia).
      'voided_after_close', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'total', x.total, 'day', x.d, 'reason', x.cancel_reason) order by x.d), '[]')
        from (select o2.code, o2.total, o2.cancel_reason, (o2.created_at at time zone 'America/Bogota')::date d
              from public.orders o2
              join public.cash_closings cc on cc.restaurant_id = o2.restaurant_id and cc.day = (o2.created_at at time zone 'America/Bogota')::date
              where o2.restaurant_id = rid and o2.created_at >= since and o2.status = 'cancelado' and o2.voided_from = 'entregado' and not o2.is_test
                and cc.closed_at < (select max(e.at) from public.order_events e where e.order_id = o2.id and e.status = 'cancelado')) x),
      'discounts', coalesce((select sum(discount) from o), 0),
      'delivery_fees', coalesce((select sum(delivery_fee) from o), 0),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', dl.d, 'total', coalesce(x.t, 0), 'orders', coalesce(x.c, 0)) order by dl.d), '[]')
                 from days_list dl left join (select (created_at at time zone 'America/Bogota')::date d, sum(total) t, count(*) c from o group by 1) x on x.d = dl.d),
      'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('key', channel, 'total', t, 'orders', c) order by t desc), '[]')
                     from (select channel, sum(total) t, count(*) c from o group by 1) x),
      'by_payment', (select coalesce(jsonb_agg(jsonb_build_object('key', payment_label, 'total', t, 'orders', c) order by t desc), '[]')
                     from (select payment_label, sum(total) t, count(*) c from o group by 1) x),
      'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'orders', coalesce(c, 0)) order by h), '[]')
                  from generate_series(10, 23) h left join (select extract(hour from created_at at time zone 'America/Bogota')::int hr, count(*) c from o group by 1) x on x.hr = h),
      'top_products', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'total', t) order by t desc), '[]')
                       from (select i.name, sum(i.qty) q, sum(i.qty * i.unit_price) t from public.order_items i join o on o.id = i.order_id
                             group by 1 order by 3 desc limit 10) x),
      'customers', (select count(distinct customer_id) from o),
      'recurrent_pct', coalesce((select round(100.0 * count(*) filter (where n > 1) / nullif(count(*), 0)) from
                        (select o.customer_id, (select count(*) from public.orders y where y.customer_id = o.customer_id and y.status <> 'cancelado') n
                         from o where o.customer_id is not null group by o.customer_id) x), 0),
      'blocked', (select count(*) from public.blocked_attempts b where b.restaurant_id = rid and b.at >= since)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.weekly_report(p_restaurant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := coalesce(p_restaurant, public.my_restaurant());
  this_monday date := date_trunc('week', now() at time zone 'America/Bogota')::date;
  w_start timestamptz := (this_monday - 7)::timestamp at time zone 'America/Bogota';
  w_end timestamptz := this_monday::timestamp at time zone 'America/Bogota';
  p_start timestamptz := (this_monday - 14)::timestamp at time zone 'America/Bogota';
begin
  -- Desde el panel: solo admin. Sin sesión (cron del servidor, F9): solo con el id explícito y rol de servicio.
  if p_restaurant is null and (rid is null or not public.can('ventas')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_restaurant is not null and coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with w as (select * from public.orders where restaurant_id = rid and created_at >= w_start and created_at < w_end and status <> 'cancelado'),
    pw as (select * from public.orders where restaurant_id = rid and created_at >= p_start and created_at < w_start and status <> 'cancelado')
    select jsonb_build_object(
      'from', this_monday - 7, 'to', this_monday - 1,
      'total', coalesce((select sum(total) from w), 0), 'orders', (select count(*) from w),
      'previous_total', coalesce((select sum(total) from pw), 0), 'previous_orders', (select count(*) from pw),
      'ticket', coalesce((select round(avg(total)) from w), 0),
      'star', (select i.name from public.order_items i join w on w.id = i.order_id group by i.name order by sum(i.qty) desc limit 1),
      'peak_hour', (select extract(hour from created_at at time zone 'America/Bogota')::int from w group by 1 order by count(*) desc limit 1),
      'peak_day', (select to_char(created_at at time zone 'America/Bogota', 'ID')::int from w group by 1 order by count(*) desc limit 1),
      'blocked', (select count(*) from public.blocked_attempts b where b.restaurant_id = rid and b.at >= w_start and b.at < w_end),
      'cancelled', (select count(*) from public.orders where restaurant_id = rid and created_at >= w_start and created_at < w_end and status = 'cancelado' and not is_test)
    )
  );
end;
$function$;

-- Seguimiento público sin el motivo interno de cancelación (D42: puede llevar notas del admin).
create or replace function private.order_public(o public.orders) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'code', o.code, 'status', o.status, 'fulfillment', o.fulfillment, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'cancel_reason', null, -- D42: el motivo es interno; el cliente ve un texto genérico
    'address', regexp_replace(o.address, '(#\s*)[0-9\s-]+', '\1···'), 'barrio', o.barrio,
    'payment', o.payment_label, 'subtotal', o.subtotal, 'discount', o.discount, 'delivery_fee', o.delivery_fee,
    'total', o.total, 'coupon', o.coupon_code, 'gift', o.gift,
    'eta', (select s.delivery_eta from public.restaurant_settings s where s.restaurant_id = o.restaurant_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'parent', i.parent_item_id, 'name', i.name, 'qty', i.qty,
                'combo', i.combo, 'unit', i.unit_price) order by i.position, i.id), '[]')
              from public.order_items i where i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at) order by e.at), '[]')
               from public.order_events e where e.order_id = o.id)
  )
$$;

-- Cierre (regla del proyecto): ninguna función pública queda ejecutable por anon salvo las del sitio.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
