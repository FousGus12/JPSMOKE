-- JP Smoke · Base compartida (D24): un restaurante nunca ve ni toca los datos de otro.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.restaurants (id, slug, name, order_prefix) values
  ('10000000-0000-4000-8000-000000000001', 'prueba-a', 'Prueba A', 'PA'),
  ('10000000-0000-4000-8000-000000000002', 'prueba-b', 'Prueba B', 'PB');
insert into public.restaurant_settings (restaurant_id) values
  ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('20000000-0000-4000-8000-00000000000a', 'admin.a@prueba.test', '{"role":"admin","restaurant_id":"10000000-0000-4000-8000-000000000001"}', '{"full_name":"Admin A"}'),
  ('20000000-0000-4000-8000-00000000000b', 'admin.b@prueba.test', '{"role":"admin","restaurant_id":"10000000-0000-4000-8000-000000000002"}', '{"full_name":"Admin B"}'),
  ('20000000-0000-4000-8000-00000000000c', 'oper.a@prueba.test', '{"role":"operador","restaurant_id":"10000000-0000-4000-8000-000000000001"}', '{"full_name":"Oper A"}'),
  ('20000000-0000-4000-8000-00000000000d', 'sin.rest@prueba.test', '{}', '{"full_name":"Soporte"}');
insert into public.categories (id, restaurant_id, slug, name) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'burgers', 'Burgers'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'burgers', 'Burgers');
insert into public.customers (restaurant_id, phone, name) values
  ('10000000-0000-4000-8000-000000000001', '3001112222', 'Cliente A'),
  ('10000000-0000-4000-8000-000000000002', '3003334444', 'Cliente B');
insert into public.orders (restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total) values
  ('10000000-0000-4000-8000-000000000001', 1, 'PA-0001', 'x', 'Cliente A', '3001112222', 'Calle 1 # 2-3', 'Z', 'Nequi', 10000, 10000),
  ('10000000-0000-4000-8000-000000000002', 1, 'PB-0001', 'y', 'Cliente B', '3003334444', 'Calle 4 # 5-6', 'Z', 'Nequi', 20000, 20000);

select is((select count(*)::int from public.staff where restaurant_id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')),
  3, 'las cuentas con restaurante nacen en su equipo; la de soporte no entra a ningún panel');

-- Admin A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is((select array_agg(code) from public.orders), array['PA-0001'], 'admin A ve solo pedidos de A');
select is((select array_agg(name) from public.customers), array['Cliente A'], 'admin A ve solo clientes de A');
select is((select count(*)::int from public.staff), 2, 'admin A ve solo su equipo');
select throws_ok($$ insert into public.products (restaurant_id, category_id, slug, name, price)
  values ('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'x', 'Intrusa', 1000) $$,
  '42501', null, 'admin A no crea productos en B');
select throws_ok($$ insert into public.products (restaurant_id, category_id, slug, name, price)
  values ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'x', 'Mezcla', 1000) $$,
  '23514', null, 'un producto de A no puede usar una categoría de B');
update public.restaurant_settings set delivery_min = 99999 where restaurant_id = '10000000-0000-4000-8000-000000000002';
reset role;
select is((select delivery_min from public.restaurant_settings where restaurant_id = '10000000-0000-4000-8000-000000000002'),
  0, 'admin A no cambia los ajustes de B');

-- Admin A no cambia el estado de un pedido de B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select public.set_order_status((select id from public.orders where code = 'PB-0001'), 'confirmado') $$,
  '42501', null, 'admin A no toca pedidos de B (ni sabe si existen)');
select throws_ok($$ update public.staff set restaurant_id = '10000000-0000-4000-8000-000000000002' where user_id = '20000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'nadie se cambia de restaurante desde el navegador');

-- Soporte sin restaurante
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
select is((select count(*)::int from public.orders), 0, 'una cuenta sin restaurante no ve pedidos');

-- Anónimo
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select count(*) from public.orders $$, '42501', null, 'anon no tiene permiso sobre pedidos (F10)');
select throws_ok($$ select count(*) from public.customers $$, '42501', null, 'anon no tiene permiso sobre clientes (F10)');
select is((select count(*)::int from public.restaurants where slug in ('prueba-a', 'prueba-b')), 2, 'anon ve los restaurantes activos (para la carta)');

reset role;
select * from finish();
rollback;
