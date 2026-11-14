-- JP Smoke · Roles (D19): el operador mueve pedidos; no ve ventas, clientes ni edita carta o ajustes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.restaurants (id, slug, name, order_prefix) values ('11000000-0000-4000-8000-000000000001', 'rol-a', 'Rol A', 'RA');
insert into public.restaurant_settings (restaurant_id) values ('11000000-0000-4000-8000-000000000001');
insert into auth.users (id, email, raw_app_meta_data) values
  ('21000000-0000-4000-8000-00000000000a', 'adm@rol.test', '{"role":"admin","restaurant_id":"11000000-0000-4000-8000-000000000001"}'),
  ('21000000-0000-4000-8000-00000000000c', 'ope@rol.test', '{"role":"operador","restaurant_id":"11000000-0000-4000-8000-000000000001"}');
insert into public.categories (id, restaurant_id, slug, name) values ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'burgers', 'Burgers');
insert into public.products (restaurant_id, category_id, slug, name, price) values ('11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'b1', 'Burger', 30000);
insert into public.customers (restaurant_id, phone, name) values ('11000000-0000-4000-8000-000000000001', '3001112222', 'Cliente');
insert into public.orders (id, restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total) values
  ('41000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 1, 'RA-0001', 'x', 'Cliente', '3001112222', 'Calle 1 # 2-3', 'Z', 'Nequi', 30000, 30000);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.orders), 1, 'operador ve los pedidos de su restaurante');
select lives_ok($$ select public.set_order_status('41000000-0000-4000-8000-000000000001', 'confirmado') $$, 'operador confirma un pedido');
select is((select count(*)::int from public.customers), 0, 'operador no ve la lista de clientes');
select throws_ok($$ select public.sales_summary(30) $$, '42501', null, 'operador no ve ventas ni estadísticas');
update public.products set price = 1 where slug = 'b1';
reset role;
select is((select price from public.products where slug = 'b1'), 30000, 'operador no cambia precios');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ insert into public.orders (restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total)
  values ('11000000-0000-4000-8000-000000000001', 2, 'RA-0002', 'x', 'X', '3000000000', 'Calle 1 # 2-3', 'Z', 'N', 1, 1) $$,
  '42501', null, 'nadie inserta pedidos directo desde el navegador');
select throws_ok($$ select track_hash from public.orders $$, '42501', null, 'el hash del enlace no se lee ni desde el panel');

select set_config('request.jwt.claims', '{"sub":"21000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ select public.sales_summary(30) $$, 'admin ve ventas y estadísticas');
select is((select count(*)::int from public.customers), 1, 'admin ve sus clientes');

reset role;
select * from finish();
rollback;
