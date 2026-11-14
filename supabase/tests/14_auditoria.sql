-- JP Smoke · Regresiones de la auditoría de seguridad (2026-11-02, skill security-audit de Cloudflare).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.restaurants (id, slug, name, order_prefix) values ('1d000000-0000-4000-8000-000000000001', 'au-a', 'Auditoría', 'AU');
insert into public.restaurant_settings (restaurant_id) values ('1d000000-0000-4000-8000-000000000001');
insert into public.categories (id, restaurant_id, slug, name) values ('3d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'burgers', 'Burgers');
insert into public.products (id, restaurant_id, category_id, slug, name, price) values
  ('5d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001', 'b1', 'Burger', 30000);
insert into public.delivery_zones (id, restaurant_id, name, fee) values ('7d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'Zona A', 0);
insert into public.payment_methods (restaurant_id, code, label) values ('1d000000-0000-4000-8000-000000000001', 'efectivo', 'Efectivo');
insert into public.coupons (restaurant_id, code, kind, value, max_uses, title) values ('1d000000-0000-4000-8000-000000000001', 'UNICO', 'valor', 5000, 1, 'Cupón único');

create function pg_temp.pedir(phone text, coupon text default null) returns jsonb language sql as $$
  select public.place_order(jsonb_build_object('restaurant', 'au-a', 'token', 'token-auditoria-' || phone, 'coupon', coupon,
    'customer', jsonb_build_object('name', 'Cliente', 'phone', phone, 'address', 'Calle 1 # 2-3', 'barrio', 'Centro', 'zone_id', '7d000000-0000-4000-8000-000000000001'),
    'payment_code', 'efectivo', 'items', '[{"product_id":"5d000000-0000-4000-8000-000000000001","qty":1}]'::jsonb))
$$;

-- Cupón: el cupo no se puede pasar ni por fuera de place_order.
select is(pg_temp.pedir('3200000001', 'UNICO') ->> 'ok', 'true', 'el primer pedido usa el cupón único');
select is(pg_temp.pedir('3200000002', 'UNICO') ->> 'reason', 'cupon', 'el segundo ya no puede');
select throws_ok($$ update public.coupons set uses = 2 where code = 'UNICO' and restaurant_id = '1d000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'la base no deja que los usos pasen el máximo');

-- Seguimiento por 4 dígitos: máximo 5 fallos por hora por pedido, sin importar la IP.
select pg_temp.pedir('3200000003');
select is((select count(*)::int from generate_series(1, 5) g where public.track_order_by_phone('au-a', 'AU-0002', '900' || g) is null), 5, '5 intentos fallidos');
select is(public.track_order_by_phone('au-a', 'AU-0002', '0003'), null, 'al sexto, ni el número correcto abre el pedido');
select isnt(public.track_order_by_phone('au-a', 'AU-0001', '0001'), null, 'otro pedido no se afecta');

-- Operador: solo pedidos de las últimas 36 h; el admin ve todo.
insert into auth.users (id, email) values ('9d000000-0000-4000-8000-000000000002', 'op@au.test');
update public.staff set restaurant_id = '1d000000-0000-4000-8000-000000000001', role = 'operador' where user_id = '9d000000-0000-4000-8000-000000000002';
insert into public.staff (user_id, restaurant_id, full_name, role) values ('9d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000001', 'Operador', 'operador')
  on conflict (user_id) do update set restaurant_id = excluded.restaurant_id, role = 'operador';
update public.orders set created_at = now() - interval '30 days' where code = 'AU-0001' and restaurant_id = '1d000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9d000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
select is((select array_agg(code order by code) from public.orders), array['AU-0002'], 'el operador no ve pedidos viejos (ni sus montos)');
select is((select count(*)::int from public.order_items), 1, 'ni sus productos');
reset role;

select * from finish();
rollback;
