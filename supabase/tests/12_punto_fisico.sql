-- JP Smoke · Punto físico y recoger en tienda (F10, D33).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.restaurants (id, slug, name, order_prefix) values ('1b000000-0000-4000-8000-000000000001', 'pf-a', 'Local A', 'PF');
insert into public.restaurant_settings (restaurant_id, whatsapp_mode) values ('1b000000-0000-4000-8000-000000000001', 'prueba');
insert into public.categories (id, restaurant_id, slug, name) values ('3b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'burgers', 'Burgers');
insert into public.products (id, restaurant_id, category_id, slug, name, price) values
  ('5b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', 'b1', 'Burger', 30000);
insert into public.delivery_zones (restaurant_id, name, fee) values ('1b000000-0000-4000-8000-000000000001', 'Zona A', 6000);
insert into public.payment_methods (restaurant_id, code, label) values ('1b000000-0000-4000-8000-000000000001', 'efectivo', 'Efectivo');

create function pg_temp.recoger(phone text) returns jsonb language sql as $$
  select public.place_order(jsonb_build_object('restaurant', 'pf-a', 'token', 'token-recoger-' || phone, 'fulfillment', 'recoger',
    'customer', jsonb_build_object('name', 'Cliente', 'phone', phone), 'payment_code', 'efectivo',
    'items', '[{"product_id":"5b000000-0000-4000-8000-000000000001","qty":1}]'::jsonb))
$$;

select throws_ok($$ update public.restaurant_settings set pickup_enabled = true where restaurant_id = '1b000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'no se puede ofrecer recoger sin local abierto y con dirección');
select is(pg_temp.recoger('3100000001') ->> 'reason', 'recoger', 'con recoger apagado, el pedido se rechaza con mensaje claro');
update public.restaurant_settings set store_open = true, store_address = 'Calle 68 # 60-71', pickup_enabled = true
  where restaurant_id = '1b000000-0000-4000-8000-000000000001';
select is(pg_temp.recoger('3100000002') ->> 'total', '30000', 'recoger no cobra domicilio ni pide dirección');
select is((select fulfillment || '|' || zone_name || '|' || address from public.orders where phone = '3100000002'),
  'recoger|Recoge en tienda|Recoge en: Calle 68 # 60-71', 'el pedido queda como recoger con la dirección del local');
select is((public.track_order('pf-a', 'PF-0001', 'token-recoger-3100000002') ->> 'fulfillment'), 'recoger', 'el seguimiento sabe que es para recoger');
update public.orders set status = 'en_camino' where phone = '3100000002';
select is((select count(*)::int from public.whatsapp_messages w join public.orders o on o.id = w.order_id where o.phone = '3100000002' and w.kind = 'en_camino'),
  0, 'recoger no manda "va en camino"');
select is((select count(*)::int from public.whatsapp_messages w join public.orders o on o.id = w.order_id where o.phone = '3100000002'),
  2, 'sí manda pedido recibido y aviso al negocio');
select is(public.place_order(jsonb_build_object('restaurant', 'pf-a', 'token', 'token-domicilio-3100000003',
    'customer', jsonb_build_object('name', 'Cliente', 'phone', '3100000003', 'address', 'Calle 1'), 'payment_code', 'efectivo',
    'items', '[{"product_id":"5b000000-0000-4000-8000-000000000001","qty":1}]'::jsonb)) ->> 'reason', 'datos', 'domicilio sigue exigiendo dirección completa');

select * from finish();
rollback;
