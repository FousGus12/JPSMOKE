-- JP Smoke · Inventario (F8b, D30): descuenta al pedir, frena si no alcanza, combo suma extras, cancelar devuelve,
-- compras con equivalencia, mermas, conteo físico, permisos y estado público.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.restaurants (id, slug, name, order_prefix) values ('18000000-0000-4000-8000-000000000001', 'inv-a', 'Inv A', 'IN');
insert into public.restaurant_settings (restaurant_id) values ('18000000-0000-4000-8000-000000000001');
insert into auth.users (id, email, raw_app_meta_data) values
  ('28000000-0000-4000-8000-00000000000a', 'adm@inv.test', '{"role":"admin","restaurant_id":"18000000-0000-4000-8000-000000000001"}'),
  ('28000000-0000-4000-8000-00000000000c', 'ope@inv.test', '{"role":"operador","restaurant_id":"18000000-0000-4000-8000-000000000001"}');
insert into public.categories (id, restaurant_id, slug, name) values ('38000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'burgers', 'Burgers');
insert into public.products (id, restaurant_id, category_id, slug, name, price, combo_price) values
  ('58000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', 'burger', 'Burger', 30000, 39000),
  ('58000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', 'gaseosa', 'Gaseosa', 5000, null);
insert into public.supplies (id, restaurant_id, name, unit, purchase_unit, per_purchase, stock, min_stock) values
  ('68000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'Pan', 'pan', 'paquete', 12, 2, 1),
  ('68000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001', 'Lechuga', 'hoja', 'lechuga', 12, 10, 4),
  ('68000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000001', 'Gaseosa', 'unidad', 'paca', 12, 1, 2);
insert into public.recipes (product_id, supply_id, restaurant_id, qty, combo_only) values
  ('58000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 1, false),
  ('58000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001', 2, false),
  ('58000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000001', 1, true),
  ('58000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000001', 1, false);
insert into public.delivery_zones (id, restaurant_id, name, fee) values ('78000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'Zona A', 0);
insert into public.payment_methods (restaurant_id, code, label) values ('18000000-0000-4000-8000-000000000001', 'nequi', 'Nequi');

create function pg_temp.pedir(phone text, items jsonb) returns jsonb language sql as $$
  select public.place_order(jsonb_build_object('restaurant', 'inv-a', 'token', 'token-inventario-' || phone,
    'customer', jsonb_build_object('name', 'Cliente', 'phone', phone, 'address', 'Calle 1 # 2-3', 'zone_id', '78000000-0000-4000-8000-000000000001'),
    'payment_code', 'nequi', 'items', items))
$$;
create function pg_temp.stock(name text) returns numeric language sql as $$
  select stock from public.supplies where restaurant_id = '18000000-0000-4000-8000-000000000001' and supplies.name = $1
$$;

select is(pg_temp.pedir('3100000001', '[{"product_id":"58000000-0000-4000-8000-000000000001","qty":1,"combo":true}]') ->> 'ok', 'true', 'pedido en combo pasa');
select is(pg_temp.stock('Pan'), 1.00, 'descuenta el pan');
select is(pg_temp.stock('Lechuga'), 8.00, 'descuenta 2 hojas de lechuga');
select is(pg_temp.stock('Gaseosa'), 0.00, 'el combo descuenta la gaseosa');
select is(public.stock_status('inv-a') -> 'sold_out', '["58000000-0000-4000-8000-000000000002"]'::jsonb, 'la gaseosa sola sale agotada en la página');
select is(public.stock_status('inv-a') -> 'combo_out', '["58000000-0000-4000-8000-000000000001", "58000000-0000-4000-8000-000000000002"]'::jsonb,
  'la burger en combo también (no hay gaseosa), pero sola sí se puede');

select is(pg_temp.pedir('3100000002', '[{"product_id":"58000000-0000-4000-8000-000000000002","qty":1}]') ->> 'reason', 'agotado', 'sin gaseosa: agotado');
select is(pg_temp.pedir('3100000003', '[{"product_id":"58000000-0000-4000-8000-000000000001","qty":2}]') ->> 'product', 'Burger',
  'pedir 2 burgers con 1 pan: dice qué producto se agotó');
select is((select count(*)::int from public.orders where restaurant_id = '18000000-0000-4000-8000-000000000001'), 1, 'un pedido frenado no queda guardado');
select is(pg_temp.stock('Pan'), 1.00, 'ni descuenta a medias');

-- Cancelar devuelve
insert into public.supply_moves (restaurant_id, supply_id, kind, qty) values ('18000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'ajuste', 0);
update public.orders set status = 'cancelado', cancel_reason = 'Prueba' where restaurant_id = '18000000-0000-4000-8000-000000000001';
select is(pg_temp.stock('Pan') + pg_temp.stock('Gaseosa'), 3.00, 'cancelar devuelve pan y gaseosa');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"28000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is(public.register_supply('68000000-0000-4000-8000-000000000002', 'compra', 2), 34.00, 'comprar 2 lechugas suma 24 hojas');
select is(public.register_supply('68000000-0000-4000-8000-000000000002', 'merma', 4, 'Se dañaron'), 30.00, 'la merma resta');
select is(public.register_supply('68000000-0000-4000-8000-000000000002', 'ajuste', 25, 'Conteo'), 25.00, 'el conteo físico deja el stock contado');
select is(public.register_supply('68000000-0000-4000-8000-000000000002', 'ajuste', 0, 'Se acabó'), 0.00, 'un conteo puede dejarlo en cero');

select set_config('request.jwt.claims', '{"sub":"28000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select public.register_supply('68000000-0000-4000-8000-000000000002', 'compra', 1) $$, '42501', null, 'el operador no registra compras');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.supplies $$, '42501', null, 'la página no ve insumos ni cantidades');
reset role;

select * from finish();
rollback;
