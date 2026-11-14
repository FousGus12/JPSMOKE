-- =============================================================================
-- JP Smoke · Pedidos (D9, D15, D20, D21): crear pedido con precios del servidor,
-- seguimiento por enlace único, cambio de estado, pedido manual, captación y ventas.
-- Las funciones públicas reciben solo lo mínimo y nunca confían en precios del navegador.
-- =============================================================================

-- Límite deslizante simple por clave (celular, IP, dispositivo). Solo el servidor.
create function public.rate_hit(p_key text, p_max integer, p_seconds integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
  n integer;
begin
  insert into private.rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into n;
  delete from private.rate_limits where window_start < now() - interval '1 day';
  return n <= p_max;
end;
$$;

create function private.log_blocked(rid uuid, why text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.blocked_attempts (restaurant_id, reason) values (rid, why);
  return jsonb_build_object('ok', false, 'reason', why);
end;
$$;

-- Contar un intento frenado antes de llegar a la base del pedido (robot, IP repetida). Solo el servidor.
create function public.register_blocked(p_restaurant text, p_reason text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.blocked_attempts (restaurant_id, reason)
  select r.id, p_reason from public.restaurants r where r.slug = p_restaurant and p_reason in ('robot', 'repetido')
$$;

create function private.max_per_hour(level public.protection_level) returns integer
language sql immutable set search_path = ''
as $$ select case level when 'basica' then 6 when 'estricta' then 2 else 3 end $$;

-- ---------------------------------------------------------------------------
-- Crear pedido web. La llama la Edge Function crear-pedido (después de Turnstile,
-- campo trampa y límite por IP). Devuelve {ok, code} o {ok:false, reason}.
-- p: {restaurant, token, customer:{name,phone,address,barrio,zone_id,notes},
--     payment_code, cash_with, coupon, items:[{product_id, qty, combo}], consent_version, promos}
-- ---------------------------------------------------------------------------
create function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
  pickup boolean := coalesce(p ->> 'fulfillment', 'domicilio') = 'recoger';
  zone_label text;
  address_text text;
begin
  select * into r from public.restaurants where slug = p ->> 'restaurant' and active;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'restaurante'); end if;
  select * into st from public.restaurant_settings where restaurant_id = r.id;
  if not st.accepting_orders then return private.log_blocked(r.id, 'cerrado'); end if;

  if ph !~ '^3[0-9]{9}$' or length(trim(coalesce(c ->> 'name', ''))) < 2
     or (not pickup and (length(trim(coalesce(c ->> 'address', ''))) < 8 or coalesce(c ->> 'address', '') !~ '[0-9]'))
     or length(coalesce(p ->> 'token', '')) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'datos');
  end if;

  select * into cust from public.customers where restaurant_id = r.id and phone = ph;
  if cust.blocked then return private.log_blocked(r.id, 'bloqueado'); end if;
  if (select count(*) from public.orders o where o.restaurant_id = r.id and o.phone = ph
        and o.created_at > now() - interval '1 hour') >= private.max_per_hour(st.protection) then
    return private.log_blocked(r.id, 'repetido');
  end if;
  -- Estricta: el primer pedido de un número nuevo queda para revisión (sigue entrando como 'nuevo').

  -- Recoger en tienda (D33): sin zona ni domicilio; solo si el local lo tiene encendido.
  if pickup then
    if not st.pickup_enabled then return jsonb_build_object('ok', false, 'reason', 'recoger'); end if;
    zone_label := 'Recoge en tienda';
    address_text := left('Recoge en: ' || st.store_address, 160);
  else
    select * into z from public.delivery_zones where id = (c ->> 'zone_id')::uuid and restaurant_id = r.id and active;
    if z.id is null then return private.log_blocked(r.id, 'fuera_de_zona'); end if;
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
    lines := lines || jsonb_build_object('product_id', pr.id, 'name', pr.name, 'qty', q, 'combo', is_combo,
      'unit', case when is_combo then pr.combo_price else pr.price end);
  end loop;
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

  insert into public.order_items (order_id, restaurant_id, product_id, name, qty, combo, unit_price)
  select oid, r.id, (l ->> 'product_id')::uuid, l ->> 'name', (l ->> 'qty')::smallint, (l ->> 'combo')::boolean, (l ->> 'unit')::integer
  from jsonb_array_elements(lines) l;
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
$$;

-- ---------------------------------------------------------------------------
-- Seguimiento (D21). Por enlace único (anon puede: el token tiene 72+ bits) o por
-- código + últimos 4 dígitos (solo el servidor, con límite de intentos).
-- Devuelve solo lo necesario: nunca el celular ni la dirección completa.
-- ---------------------------------------------------------------------------
create function private.order_public(o public.orders) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'code', o.code, 'status', o.status, 'fulfillment', o.fulfillment, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'cancel_reason', case when o.status = 'cancelado' then o.cancel_reason end,
    'address', regexp_replace(o.address, '(#\s*)[0-9\s-]+', '\1···'), 'barrio', o.barrio,
    'payment', o.payment_label, 'subtotal', o.subtotal, 'discount', o.discount, 'delivery_fee', o.delivery_fee,
    'total', o.total, 'coupon', o.coupon_code, 'gift', o.gift,
    'eta', (select s.delivery_eta from public.restaurant_settings s where s.restaurant_id = o.restaurant_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'combo', i.combo, 'unit', i.unit_price)), '[]')
              from public.order_items i where i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at) order by e.at), '[]')
               from public.order_events e where e.order_id = o.id)
  )
$$;

create function public.track_order(p_restaurant text, p_code text, p_token text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select private.order_public(o) from public.orders o
  join public.restaurants r on r.id = o.restaurant_id and r.slug = p_restaurant
  where o.code = upper(p_code) and length(coalesce(p_token, '')) >= 16
    and o.track_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;
grant execute on function public.track_order(text, text, text) to anon, authenticated;

-- Por código + 4 dígitos: además del límite por IP de la función, máximo 5 fallos por hora POR PEDIDO, contados
-- con un candado del pedido. No depende de la IP (X-Forwarded-For) ni de ráfagas simultáneas (auditoría 2026-11-02).
create function public.track_order_by_phone(p_restaurant text, p_code text, p_last4 text) returns jsonb
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
  if coalesce((select hits from private.rate_limits where key = k and window_start = w), 0) >= 5 then return null; end if;
  if right(o.phone, 4) = p_last4 then return private.order_public(o); end if;
  insert into private.rate_limits (key, window_start, hits) values (k, w, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cambio de estado desde el panel (admin y operador del restaurante).
-- ---------------------------------------------------------------------------
create function public.set_order_status(p_order uuid, p_status public.order_status, p_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order;
  -- Primero quién llama (no revelar si el pedido existe; lección de Pulso).
  if o.id is null or not public.is_staff_of(o.restaurant_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if o.status in ('entregado', 'cancelado') then
    raise exception 'El pedido ya está cerrado' using errcode = '22023';
  end if;
  if p_status = 'cancelado' and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Cancelar exige un motivo' using errcode = '22023';
  end if;
  if p_status <> 'cancelado' and array_position(enum_range(null::public.order_status), p_status)
       <= array_position(enum_range(null::public.order_status), o.status) then
    raise exception 'Ese estado no sigue al actual' using errcode = '22023';
  end if;
  update public.orders set status = p_status, cancel_reason = case when p_status = 'cancelado' then trim(p_reason) end
  where id = o.id;
  insert into public.order_events (order_id, restaurant_id, status, by_user) values (o.id, o.restaurant_id, p_status, auth.uid());
  if p_status = 'cancelado' and p_reason ilike 'pedido falso%' then
    update public.customers set blocked = true where id = o.customer_id;
  end if;
  if p_status = 'entregado' then
    update public.customers c set trusted = true where c.id = o.customer_id
      and (select count(*) from public.orders x where x.customer_id = c.id and x.status = 'entregado') >= 2;
  end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values (o.restaurant_id, auth.uid(), 'estado', 'orders', o.code, jsonb_build_object('de', o.status, 'a', p_status, 'motivo', p_reason));
end;
$$;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Pedido manual (WhatsApp directo, llamada, Rappi, DiDi) desde el panel.
-- p: {channel, customer:{name,phone,address,zone_id}, payment_code, items:[{product_id,qty,combo}]}
-- ---------------------------------------------------------------------------
create function public.create_manual_order(p jsonb) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  ph text := regexp_replace(coalesce(p -> 'customer' ->> 'phone', ''), '\D', '', 'g');
  z public.delivery_zones;
  pm public.payment_methods;
  pr public.products;
  it jsonb;
  sub integer := 0;
  n integer;
  oid uuid;
  ocode text;
  cid uuid;
  ch public.order_channel := coalesce(p ->> 'channel', 'manual')::public.order_channel;
begin
  if rid is null then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if ch = 'web' then raise exception 'Canal inválido' using errcode = '22023'; end if;
  if ph !~ '^3[0-9]{9}$' then raise exception 'Celular inválido' using errcode = '22023'; end if;
  select * into z from public.delivery_zones where id = (p -> 'customer' ->> 'zone_id')::uuid and restaurant_id = rid;
  select * into pm from public.payment_methods where restaurant_id = rid and code = p ->> 'payment_code';
  if z.id is null or pm.id is null then raise exception 'Zona o pago inválido' using errcode = '22023'; end if;

  perform 1 from public.restaurants where id = rid for update;
  select coalesce(max(number), 0) + 1 into n from public.orders where restaurant_id = rid;
  select r.order_prefix || '-' || lpad(n::text, 4, '0') into ocode from public.restaurants r where r.id = rid;

  insert into public.customers (restaurant_id, phone, name) values (rid, ph, trim(p -> 'customer' ->> 'name'))
  on conflict (restaurant_id, phone) do update set name = excluded.name returning id into cid;

  insert into public.orders (restaurant_id, number, code, track_hash, customer_id, channel, status, customer_name, phone,
    address, zone_name, payment_label, subtotal, delivery_fee, total)
  values (rid, n, ocode, encode(extensions.gen_random_bytes(32), 'hex'), cid, ch, 'confirmado', trim(p -> 'customer' ->> 'name'), ph,
    trim(p -> 'customer' ->> 'address'), z.name, pm.label, 0, z.fee, 0)
  returning id into oid;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into pr from public.products where id = (it ->> 'product_id')::uuid and restaurant_id = rid;
    if pr.id is null then raise exception 'Producto inválido' using errcode = '22023'; end if;
    insert into public.order_items (order_id, restaurant_id, product_id, name, qty, combo, unit_price)
    values (oid, rid, pr.id, pr.name, (it ->> 'qty')::smallint,
      coalesce((it ->> 'combo')::boolean, false) and pr.combo_price is not null,
      case when coalesce((it ->> 'combo')::boolean, false) and pr.combo_price is not null then pr.combo_price else pr.price end);
  end loop;
  select coalesce(sum(qty * unit_price), 0) into sub from public.order_items where order_id = oid;
  if sub = 0 then raise exception 'El pedido no tiene productos' using errcode = '22023'; end if;
  update public.orders set subtotal = sub, total = sub + delivery_fee where id = oid;
  insert into public.order_events (order_id, restaurant_id, status, by_user) values (oid, rid, 'confirmado', auth.uid());
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id) values (rid, auth.uid(), 'pedido manual', 'orders', ocode);
  return ocode;
end;
$$;
grant execute on function public.create_manual_order(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Captación con el aviso de bienvenida (D16, D22). La llama la Edge Function.
-- ---------------------------------------------------------------------------
create function public.capture_lead(p_restaurant text, p_event uuid, p_name text, p_phone text, p_consent_version text) returns jsonb
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
  select * into cp from public.coupons where id = ev.coupon_id and active;
  insert into public.leads (restaurant_id, name, phone, coupon_id, event_id) values (r.id, trim(p_name), ph, cp.id, ev.id)
  on conflict (restaurant_id, phone) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'ya_registrado'); end if;
  insert into public.consents (restaurant_id, phone, kind, version, granted, source)
  values (r.id, ph, 'cupon_bienvenida', coalesce(p_consent_version, 'v1'), true, 'aviso de bienvenida');
  return jsonb_build_object('ok', true, 'coupon', cp.code::text, 'title', cp.title);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ventas y estadísticas (solo admin, D19).
-- ---------------------------------------------------------------------------
create function public.sales_summary(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  since timestamptz := date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota' - make_interval(days => greatest(1, least(p_days, 366)) - 1);
begin
  if rid is null or public.my_role() <> 'admin' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where restaurant_id = rid and created_at >= since and status <> 'cancelado')
    select jsonb_build_object(
      'total', coalesce((select sum(total) from o), 0),
      'orders', (select count(*) from o),
      'cancelled', (select count(*) from public.orders where restaurant_id = rid and created_at >= since and status = 'cancelado'),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'total', t, 'orders', c) order by d), '[]') from
                 (select (created_at at time zone 'America/Bogota')::date d, sum(total) t, count(*) c from o group by 1) x),
      'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('key', channel, 'total', t, 'orders', c) order by t desc), '[]') from
                     (select channel, sum(total) t, count(*) c from o group by 1) x),
      'by_payment', (select coalesce(jsonb_agg(jsonb_build_object('key', payment_label, 'total', t, 'orders', c) order by t desc), '[]') from
                     (select payment_label, sum(total) t, count(*) c from o group by 1) x),
      'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'orders', c) order by h), '[]') from
                  (select extract(hour from created_at at time zone 'America/Bogota')::int h, count(*) c from o group by 1) x),
      'top_products', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'total', t) order by t desc), '[]') from
                       (select i.name, sum(i.qty) q, sum(i.qty * i.unit_price) t from public.order_items i join o on o.id = i.order_id
                        group by 1 order by 3 desc limit 10) x),
      'recurrent_pct', coalesce((select round(100.0 * count(*) filter (where n > 1) / nullif(count(*), 0)) from
                        (select o.customer_id, (select count(*) from public.orders y where y.customer_id = o.customer_id) n from o) x), 0),
      'blocked', (select count(*) from public.blocked_attempts b where b.restaurant_id = rid and b.at >= since)
    ) from (select 1) one
  );
end;
$$;
grant execute on function public.sales_summary(integer) to authenticated;

-- Funciones solo del servidor (service_role): ni anon ni authenticated.
revoke execute on function public.rate_hit(text, integer, integer), public.place_order(jsonb), public.register_blocked(text, text),
  public.track_order_by_phone(text, text, text), public.capture_lead(text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer), public.place_order(jsonb), public.register_blocked(text, text),
  public.track_order_by_phone(text, text, text), public.capture_lead(text, uuid, text, text, text) to service_role;

-- Tablero en vivo del panel (Realtime con RLS).
alter publication supabase_realtime add table public.orders;

-- Cierre de permisos: ninguna función de public queda ejecutable sin sesión salvo el seguimiento por enlace.
-- (Las funciones creadas por roles de la plataforma traen EXECUTE para anon por defecto.)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;

-- El hash del enlace único no se lee ni desde el panel.
revoke select on public.orders from authenticated;
grant select (id, restaurant_id, number, code, customer_id, channel, fulfillment, status, customer_name, phone, address, barrio,
  zone_name, notes, payment_label, cash_with, subtotal, discount, delivery_fee, total, coupon_code, gift, cancel_reason,
  created_at, updated_at) on public.orders to authenticated;
