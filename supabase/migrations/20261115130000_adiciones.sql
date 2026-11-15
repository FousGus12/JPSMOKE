-- =============================================================================
-- JP Smoke · Adiciones ligadas a un plato (D40).
-- Una adición (producto de una categoría marcada is_addons) puede ir ligada a un plato del mismo pedido
-- (order_items.parent_item_id, un solo nivel). key/parent son opcionales: el sitio viejo sigue funcionando.
-- =============================================================================

alter table public.categories add column is_addons boolean not null default false;
comment on column public.categories.is_addons is 'Categoría de adiciones (D40): sus productos se ligan a un plato del pedido.';
update public.categories set is_addons = true where slug = 'adicionales';

alter table public.order_items
  add column position smallint not null default 0,
  add column parent_item_id uuid references public.order_items (id) on delete cascade;
create index on public.order_items (parent_item_id);
comment on column public.order_items.parent_item_id is 'Plato al que va esta adición (D40); null = plato o adición aparte.';

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
    -- D40: adiciones ligadas a un plato del mismo pedido (key/parent opcionales; el sitio viejo manda ítems planos).
    select c.is_addons into addon from public.categories c where c.id = pr.category_id;
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

-- Seguimiento: ítems en orden y con su plato (id y padre, sin datos privados).
create or replace function private.order_public(o public.orders) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'code', o.code, 'status', o.status, 'fulfillment', o.fulfillment, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'cancel_reason', case when o.status = 'cancelado' then o.cancel_reason end,
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

-- Cierre (D34): nada nuevo abierto para anon; el sitio sigue con track_order y stock_status.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
