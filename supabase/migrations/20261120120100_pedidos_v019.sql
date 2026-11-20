-- =============================================================================
-- JP Smoke · v0.19 pedidos.
-- D58: idempotencia por request_id (reintento < 15 min, mismo celular = el mismo pedido; el enlace pasa al token nuevo).
-- D59: anular devuelve el uso del cupón; motivo público (≤160) aparte del interno (≤200); conservar insumos
--      solo desde En el barril; aviso de WhatsApp al cliente con el motivo público.
-- D61: pausa de pedidos por el equipo (se reabre sola) y hora estimada dinámica; anon solo ve ordering_status.
-- D62: la bienvenida fuera de sus fechas no da cupón.
-- D63: tiempos de llenado y de confirmación del pedido web.
-- =============================================================================

alter table public.orders
  add column request_id uuid,
  add column cancel_public text check (length(cancel_public) <= 160),
  add column supplies_restored boolean,
  add column fill_ms integer check (fill_ms between 0 and 86400000),
  add column checkout_ms integer check (checkout_ms between 0 and 86400000);
create unique index orders_request_once on public.orders (restaurant_id, request_id) where request_id is not null;
comment on column public.orders.request_id is 'Id del intento que manda el sitio (D58): un reintento devuelve el mismo pedido.';
comment on column public.orders.cancel_public is 'Motivo de anulación que ve el cliente (D59). El interno es cancel_reason.';
comment on column public.orders.supplies_restored is 'Al anular: true si devolvió insumos al inventario (D59); null si no se anuló.';
comment on column public.orders.fill_ms is 'Tiempo del formulario del pedido web en ms (D63).';
comment on column public.orders.checkout_ms is 'Tiempo desde abrir Confirmar hasta enviar en ms (D63).';
-- D59: el motivo interno admite 200 caracteres (antes 120 y set_order_status cortaba a 200: reventaba).
alter table public.orders drop constraint orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check check (length(cancel_reason) <= 200);
-- El panel lee lo que necesita para anulaciones (Cancelados de hoy) y tiempos. request_id y track_hash no.
grant select (cancel_public, supplies_restored, voided_from, is_test, fill_ms, checkout_ms) on public.orders to authenticated;

alter table public.restaurant_settings
  add column orders_paused_until timestamptz,
  add column eta_dynamic boolean not null default false,
  add column eta_per_order_min smallint not null default 4 check (eta_per_order_min between 0 and 30),
  add column eta_max_extra_min smallint not null default 40 check (eta_max_extra_min between 0 and 180);
comment on column public.restaurant_settings.orders_paused_until is 'Pausa de pedidos hasta esta hora (D61). Solo la cambia pause_orders.';
comment on column public.restaurant_settings.eta_dynamic is 'Hora estimada = delivery_eta + minutos por pedido activo, con tope (D61).';

-- Milisegundos acotados (0 a 24 h) desde un texto; cualquier otra cosa = null (nunca falla).
create function private.bounded_ms(v text) returns integer
language sql immutable set search_path = ''
as $$ select case when coalesce(v, '') ~ '^[0-9]{1,8}$' and v::integer <= 86400000 then v::integer end $$;

-- Hora estimada (D61). Fija: delivery_eta tal cual. Dinámica: si delivery_eta es "35–50 min" (o "45 min"),
-- suma min(activos × eta_per_order_min, eta_max_extra_min) a cada extremo. Activos: nuevo a en camino,
-- creados en las últimas 12 h (un pedido olvidado sin cerrar no infla la hora para siempre).
-- Texto no reconocible: se devuelve tal cual.
create function private.eta_text(rid uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.restaurant_settings;
  m text[];
  extra integer;
begin
  select * into s from public.restaurant_settings where restaurant_id = rid;
  if s.restaurant_id is null then return null; end if;
  if not s.eta_dynamic then return s.delivery_eta; end if;
  m := regexp_match(s.delivery_eta, '^\s*([0-9]{1,3})\s*[–—-]\s*([0-9]{1,3})\s*min\.?\s*$');
  if m is null then
    m := regexp_match(s.delivery_eta, '^\s*([0-9]{1,3})\s*min\.?\s*$');
    if m is null then return s.delivery_eta; end if;
    m := array[m[1], m[1]];
  end if;
  extra := least((select count(*) from public.orders o where o.restaurant_id = rid
                    and o.status in ('nuevo', 'confirmado', 'en_cocina', 'en_camino')
                    and o.created_at > now() - interval '12 hours') * s.eta_per_order_min,
                 s.eta_max_extra_min);
  if m[1] = m[2] then return format('%s min', m[1]::integer + extra); end if;
  return format('%s–%s min', m[1]::integer + extra, m[2]::integer + extra);
end;
$$;

-- Ajustes: columna → apartado. Base: v0.18 (admin_cobertura). D61: eta_* son de Sitio y la pausa solo la
-- cambia pause_orders (bandera jps.pausando). D64: import_maps es de Ventas (la columna llega en admin_v019).
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
    if k = 'orders_paused_until' then
      if coalesce(current_setting('jps.pausando', true), '') = 'on' then continue; end if;
      raise exception 'La pausa solo se cambia con Pausar pedidos' using errcode = '42501';
    end if;
    area := case
      when k in ('whatsapp', 'whatsapp_mode', 'site_url') then 'whatsapp'
      when k = 'intro_mode' then 'promos'
      when k = 'target_margin' then 'inventario'
      when k = 'import_maps' then 'ventas'
      when k in ('hero', 'sections', 'channels', 'blocks', 'instagram', 'tiktok', 'hours', 'delivery_min',
                 'delivery_eta', 'accepting_orders', 'store_open', 'store_address', 'store_maps_url',
                 'store_hours', 'pickup_enabled', 'store_lat', 'store_lng',
                 'eta_dynamic', 'eta_per_order_min', 'eta_max_extra_min') then 'sitio'
      else 'equipo' end; -- brand, protection y toda columna nueva: solo admin hasta asignarla
    if area = 'promos' and public.can('eventos') then continue; end if;
    if not public.can(area) then
      raise exception 'Sin permiso para cambiar %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Pedido web (base: v0.18). D58 idempotencia primero; D61 pausa; D63 tiempos. Conserva P0002 (lo maneja place_order).
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
  rq uuid;
  prev public.orders;
begin
  select * into r from public.restaurants where slug = p ->> 'restaurant' and active;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'restaurante'); end if;
  select * into st from public.restaurant_settings where restaurant_id = r.id;
  -- D58: reintento del mismo intento (request_id) con el mismo celular en menos de 15 min = el mismo pedido.
  -- Va antes de cerrado, pausa y límite por celular: el pedido ya existe. El enlace pasa al token nuevo;
  -- no descuenta inventario, cupón ni cupo por celular. El candado evita dos pedidos con envíos simultáneos.
  if coalesce(p ->> 'request_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    rq := (p ->> 'request_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('pedido:' || r.id::text || ':' || rq::text, 0));
    select * into prev from public.orders where restaurant_id = r.id and request_id = rq;
    if prev.id is not null then
      if prev.phone = ph and prev.created_at > now() - interval '15 minutes' and length(coalesce(p ->> 'token', '')) >= 16 then
        update public.orders set track_hash = encode(extensions.digest(p ->> 'token', 'sha256'), 'hex') where id = prev.id;
        return jsonb_build_object('ok', true, 'code', prev.code, 'total', prev.total, 'repeated', true);
      end if;
      rq := null; -- id vencido o de otro celular: sigue como pedido nuevo, sin request_id
    end if;
  end if;
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
  -- D61: pausa vigente = no recibe, igual que cerrado, con la hora en que vuelve.
  if st.orders_paused_until > now() then
    return private.log_blocked(r.id, 'cerrado', det) || jsonb_build_object('resumes_at', st.orders_paused_until);
  end if;

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
    address, barrio, zone_name, notes, payment_label, cash_with, subtotal, discount, delivery_fee, total, coupon_code, gift,
    request_id, fill_ms, checkout_ms)
  values (r.id, n, ocode, encode(extensions.digest(p ->> 'token', 'sha256'), 'hex'), cust.id, 'web', case when pickup then 'recoger' else 'domicilio' end, trim(c ->> 'name'), ph,
    address_text, left(trim(coalesce(c ->> 'barrio', '')), 60), zone_label, left(trim(coalesce(c ->> 'notes', '')), 200),
    pm.label, nullif(regexp_replace(coalesce(p ->> 'cash_with', ''), '\D', '', 'g'), '')::integer,
    sub, disc, fee, sub - disc + fee, cp.code::text, gift,
    rq, private.bounded_ms(p ->> 'fill_ms'), private.bounded_ms(p ->> 'checkout_ms'))
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
-- Anular devuelve insumos salvo que set_order_status lo pida (bandera de transacción jps.no_restore, D59).
create or replace function private.restore_supplies() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado'
     and coalesce(current_setting('jps.no_restore', true), '') <> 'on' then
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

-- Cambio de estado desde el panel. Conserva D42 (bloqueo de fila, prueba solo admin, anular entregado solo admin,
-- confiable, auditoría) y suma D59: motivo público, cupón devuelto y conservar insumos desde En el barril.
drop function public.set_order_status(uuid, public.order_status, text);
create function public.set_order_status(p_order uuid, p_status public.order_status, p_reason text default null,
  p_public_reason text default null, p_restore boolean default true) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  test boolean;
  pub text := case when p_status = 'cancelado' then nullif(left(trim(coalesce(p_public_reason, '')), 160), '') end;
  restore boolean := coalesce(p_restore, true);
  coupon_back boolean := false;
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
  -- D59: conservar insumos solo si ya entró a cocina (antes no se ha usado nada).
  if p_status = 'cancelado' and not restore and o.status not in ('en_cocina', 'en_camino', 'entregado') then
    raise exception 'Los insumos se conservan solo desde En el barril' using errcode = '22023';
  end if;
  if p_status = 'cancelado' then
    perform set_config('jps.no_restore', case when restore then '' else 'on' end, true);
  end if;
  update public.orders set status = p_status,
    cancel_reason = case when p_status = 'cancelado' then left(trim(p_reason), 200) end,
    cancel_public = pub,
    supplies_restored = case when p_status = 'cancelado' then restore end,
    voided_from = case when p_status = 'cancelado' then o.status end,
    is_test = case when p_status = 'cancelado' then test else false end
  where id = o.id;
  perform set_config('jps.no_restore', '', true); -- no contamina otra anulación de la misma transacción
  insert into public.order_events (order_id, restaurant_id, status, by_user) values (o.id, o.restaurant_id, p_status, auth.uid());
  -- D59: el uso del cupón vuelve (sin bajar de 0). Un pedido se anula una sola vez.
  if p_status = 'cancelado' and o.coupon_code is not null then
    update public.coupons set uses = greatest(uses - 1, 0)
    where restaurant_id = o.restaurant_id and lower(code::text) = lower(o.coupon_code);
    coupon_back := found;
  end if;
  if p_status = 'cancelado' and p_reason ilike 'pedido falso%' then
    update public.customers set blocked = true where id = o.customer_id;
  end if;
  if p_status = 'entregado' or o.status = 'entregado' then
    update public.customers c set trusted = (select count(*) from public.orders x where x.customer_id = c.id and x.status = 'entregado') >= 2
    where c.id = o.customer_id;
  end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values (o.restaurant_id, auth.uid(), case when o.status = 'entregado' then 'anular' else 'estado' end, 'orders', o.code,
          jsonb_build_object('de', o.status, 'a', p_status, 'motivo', p_reason, 'prueba', test)
          || case when p_status = 'cancelado' then jsonb_build_object('motivo_publico', pub, 'devuelve_insumos', restore,
                                                                      'cupon_devuelto', coupon_back) else '{}'::jsonb end);
end;
$$;
grant execute on function public.set_order_status(uuid, public.order_status, text, text, boolean) to authenticated;

-- Encolar WhatsApp. D59: al anular con motivo público, aviso al cliente (único por pedido y tipo).
create or replace function private.queue_whatsapp() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select whatsapp_mode from public.restaurant_settings where restaurant_id = new.restaurant_id) = 'manual' then
    return null;
  end if;
  if tg_op = 'INSERT' and new.channel = 'web' then
    insert into public.whatsapp_messages (restaurant_id, kind, order_id) values
      (new.restaurant_id, 'pedido_recibido', new.id), (new.restaurant_id, 'aviso_negocio', new.id)
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and new.status = 'en_camino' and old.status is distinct from 'en_camino' and new.fulfillment = 'domicilio' then
    insert into public.whatsapp_messages (restaurant_id, kind, order_id) values (new.restaurant_id, 'en_camino', new.id)
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and new.status = 'cancelado' and old.status is distinct from 'cancelado' and new.cancel_public is not null then
    insert into public.whatsapp_messages (restaurant_id, kind, order_id) values (new.restaurant_id, 'pedido_cancelado', new.id)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

-- Despacho: el pedido lleva el motivo público (D59) y la hora estimada sale de eta_text (D61).
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
      'business_phone', st.whatsapp, 'eta', private.eta_text(m.restaurant_id),
      'order', case when o.id is null then null else jsonb_build_object(
        'code', o.code, 'status', o.status, 'name', split_part(o.customer_name, ' ', 1), 'phone', o.phone, 'total', o.total,
        'items', (select count(*) from public.order_items i where i.order_id = o.id), 'zone', o.zone_name, 'channel', o.channel,
        'cancel_note', o.cancel_public) end,
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

-- Seguimiento público: el motivo interno nunca sale (D42); el público sí (cancel_note, D59). Hora estimada de eta_text (D61).
create or replace function private.order_public(o public.orders) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'code', o.code, 'status', o.status, 'fulfillment', o.fulfillment, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'cancel_reason', null, -- D42: el motivo interno no sale
    'cancel_note', case when o.status = 'cancelado' then o.cancel_public end,
    'address', regexp_replace(o.address, '(#\s*)[0-9\s-]+', '\1···'), 'barrio', o.barrio,
    'payment', o.payment_label, 'subtotal', o.subtotal, 'discount', o.discount, 'delivery_fee', o.delivery_fee,
    'total', o.total, 'coupon', o.coupon_code, 'gift', o.gift,
    'eta', private.eta_text(o.restaurant_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'parent', i.parent_item_id, 'name', i.name, 'qty', i.qty,
                'combo', i.combo, 'unit', i.unit_price) order by i.position, i.id), '[]')
              from public.order_items i where i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at) order by e.at), '[]')
               from public.order_events e where e.order_id = o.id)
  )
$$;

-- Pausar pedidos (D61): cualquier miembro activo del equipo; 1 a 180 min; 0 reanuda. Queda en auditoría.
create function public.pause_orders(p_minutes integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  until timestamptz;
begin
  if rid is null or not public.is_staff_of(rid) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_minutes is null or p_minutes not between 0 and 180 then
    raise exception 'La pausa va de 1 a 180 minutos (0 reanuda)' using errcode = '22023';
  end if;
  perform set_config('jps.pausando', 'on', true);
  update public.restaurant_settings
    set orders_paused_until = case when p_minutes = 0 then null else now() + make_interval(mins => p_minutes) end
  where restaurant_id = rid
  returning orders_paused_until into until;
  perform set_config('jps.pausando', '', true);
  insert into public.audit_log (restaurant_id, actor, action, entity, detail)
  values (rid, auth.uid(), case when p_minutes = 0 then 'reanudar pedidos' else 'pausar pedidos' end, 'restaurant_settings',
          jsonb_build_object('minutos', p_minutes, 'hasta', until));
  return jsonb_build_object('paused_until', until);
end;
$$;
grant execute on function public.pause_orders(integer) to authenticated;

-- Estado de pedidos para el sitio (D61): solo si recibe, cuándo vuelve y la hora estimada en texto. Sin conteos.
create function public.ordering_status(p_restaurant text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'accepting', s.accepting_orders and not coalesce(s.orders_paused_until > now(), false),
    'resumes_at', case when s.accepting_orders and s.orders_paused_until > now() then s.orders_paused_until end,
    'eta', private.eta_text(r.id))
  from public.restaurants r
  join public.restaurant_settings s on s.restaurant_id = r.id
  where r.slug = p_restaurant and r.active
$$;

-- Captación (D62): la bienvenida fuera de starts_on–ends_on (día de Bogotá) no da cupón.
create or replace function public.capture_lead(p_restaurant text, p_event uuid, p_name text, p_phone text, p_consent_version text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.restaurants;
  ev public.events;
  cp public.coupons;
  ph text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into r from public.restaurants where slug = p_restaurant and active;
  select * into ev from public.events where id = p_event and restaurant_id = r.id and active and captures_leads;
  if ev.id is null or ph !~ '^3[0-9]{9}$' or length(trim(coalesce(p_name, ''))) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'datos');
  end if;
  if (now() at time zone 'America/Bogota')::date not between ev.starts_on and ev.ends_on then
    return jsonb_build_object('ok', false, 'reason', 'vencido');
  end if;
  select * into cp from public.coupons where id = ev.coupon_id and active;
  insert into public.leads (restaurant_id, name, phone, coupon_id, event_id) values (r.id, trim(p_name), ph, cp.id, ev.id)
  on conflict (restaurant_id, phone) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'ya_registrado'); end if;
  insert into public.consents (restaurant_id, phone, kind, version, granted, source)
  values (r.id, ph, 'cupon_bienvenida', coalesce(p_consent_version, 'v1'), true, 'aviso de bienvenida');
  return jsonb_build_object('ok', true, 'coupon', cp.code::text, 'title', cp.title);
end;
$$;

-- Cierre (regla del proyecto): anon solo ejecuta lo del sitio.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
grant execute on function public.ordering_status(text) to anon, authenticated;
