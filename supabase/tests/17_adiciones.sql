-- JP Smoke · Adiciones ligadas a un plato (D40).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.restaurants (id, slug, name, order_prefix) values ('17000000-0000-4000-8000-000000000001', 'ad-a', 'Adiciones A', 'AD');
insert into public.restaurant_settings (restaurant_id, delivery_min) values ('17000000-0000-4000-8000-000000000001', 0);
insert into public.categories (id, restaurant_id, slug, name, is_addons) values
  ('37000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'burgers', 'Burgers', false),
  ('37000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000001', 'extras', 'Adicionales', true);
insert into public.products (id, restaurant_id, category_id, slug, name, price, available) values
  ('57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001', 'b1', 'Burger', 30000, true),
  ('57000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000002', 'huevo', 'Huevo', 2000, true);
insert into public.delivery_zones (id, restaurant_id, name, fee, active) values
  ('67000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'Engativá', 5000, true);
insert into public.payment_methods (restaurant_id, code, label, active) values ('17000000-0000-4000-8000-000000000001', 'nequi', 'Nequi', true);

create function pg_temp.pedido(phone text, items jsonb) returns jsonb language sql as $$
  select public.place_order(jsonb_build_object(
    'restaurant', 'ad-a', 'token', 'token-de-prueba-' || phone,
    'customer', jsonb_build_object('name', 'Cliente', 'phone', phone, 'address', 'Calle 68 # 60-71', 'barrio', 'Normandía',
      'zone_id', '67000000-0000-4000-8000-000000000001'),
    'payment_code', 'nequi', 'items', items))
$$;
create function pg_temp.b(qty int, k text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', '57000000-0000-4000-8000-000000000001', 'qty', qty, 'key', k))
$$;
create function pg_temp.h(parent text default null, k text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', '57000000-0000-4000-8000-000000000002', 'qty', 1, 'key', k, 'parent', parent))
$$;

-- 3 hamburguesas: 2 sin nada y 1 con huevo.
select is(pg_temp.pedido('3170000001', jsonb_build_array(pg_temp.b(2), pg_temp.b(1, 'k1'), pg_temp.h('k1', 'k2'))) ->> 'total',
  '97000', 'precio del servidor con la adición: 3×30.000 + 2.000 + 5.000');
select is((select count(*)::int from public.order_items i join public.orders o on o.id = i.order_id
           where o.phone = '3170000001' and i.parent_item_id is not null), 1, 'la adición queda ligada a un plato');
select is((select p.qty::int from public.order_items h join public.order_items p on p.id = h.parent_item_id
           join public.orders o on o.id = h.order_id where o.phone = '3170000001'), 1, 'ligada a la hamburguesa separada (1 de las 3)');
select is(jsonb_array_length((select private.order_public(o) -> 'items' from public.orders o where o.phone = '3170000001')), 3,
  'el seguimiento trae los 3 ítems con su plato');

-- Sitio viejo: ítems planos siguen funcionando.
select is(pg_temp.pedido('3170000002', jsonb_build_array(pg_temp.b(1), pg_temp.h())) ->> 'ok', 'true', 'sin llaves (sitio viejo) también entra');

-- Rechazos.
select is(pg_temp.pedido('3170000003', jsonb_build_array(pg_temp.b(1, 'k1'), pg_temp.h('nope'))) ->> 'reason', 'datos', 'padre inexistente: rechazado');
select is(pg_temp.pedido('3170000004', jsonb_build_array(pg_temp.h(null, 'k1'), pg_temp.h('k1'))) ->> 'reason', 'datos', 'adición colgada de otra adición: rechazado');
select is(pg_temp.pedido('3170000005', jsonb_build_array(pg_temp.b(1, 'k1'), pg_temp.b(1) || '{"parent":"k1"}')) ->> 'reason', 'datos', 'un plato no puede ir dentro de otro plato');
select is(pg_temp.pedido('3170000006', jsonb_build_array(pg_temp.b(1, 'k1'), pg_temp.b(1, 'k1'))) ->> 'reason', 'datos', 'llaves repetidas: rechazado');

select * from finish();
rollback;
