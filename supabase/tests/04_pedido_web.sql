-- JP Smoke · Pedido web (D9): precios del servidor, cupones, zonas, pagos, límites, bloqueos y seguimiento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.restaurants (id, slug, name, order_prefix) values ('12000000-0000-4000-8000-000000000001', 'web-a', 'Web A', 'WA');
insert into public.restaurant_settings (restaurant_id, delivery_min, protection) values ('12000000-0000-4000-8000-000000000001', 20000, 'recomendada');
insert into public.categories (id, restaurant_id, slug, name) values ('32000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'burgers', 'Burgers');
insert into public.products (id, restaurant_id, category_id, slug, name, price, combo_price, available) values
  ('52000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'b1', 'Burger', 30000, 39000, true),
  ('52000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'b2', 'Agotada', 20000, null, false);
insert into public.delivery_zones (id, restaurant_id, name, fee, active) values
  ('62000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Engativá', 5000, true),
  ('62000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', 'Kennedy', 8000, false);
insert into public.payment_methods (restaurant_id, code, label, active) values
  ('12000000-0000-4000-8000-000000000001', 'nequi', 'Nequi', true), ('12000000-0000-4000-8000-000000000001', 'datafono', 'Datáfono', false);
insert into public.coupons (restaurant_id, code, kind, value, min_total, title) values
  ('12000000-0000-4000-8000-000000000001', 'HUMO20', 'porcentaje', 20, 40000, '20%'),
  ('12000000-0000-4000-8000-000000000001', 'ENVIO', 'envio', 0, 0, 'Envío gratis');

create function pg_temp.pedido(phone text, items jsonb, extra jsonb default '{}') returns jsonb language sql as $$
  select public.place_order(jsonb_build_object(
    'restaurant', 'web-a', 'token', 'token-de-prueba-' || phone,
    'customer', jsonb_build_object('name', 'Cliente', 'phone', phone, 'address', 'Calle 68 # 60-71', 'barrio', 'Normandía',
      'zone_id', '62000000-0000-4000-8000-000000000001'),
    'payment_code', 'nequi', 'items', items) || extra)
$$;
create function pg_temp.burger(qty int, combo bool) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', '52000000-0000-4000-8000-000000000001', 'qty', qty, 'combo', combo, 'unit', 1))
$$;

select is(pg_temp.pedido('3100000001', pg_temp.burger(2, true)) ->> 'total', '83000', 'total con precios del servidor: 2 combos 78.000 + domicilio 5.000 (ignora unit=1)');
select is((select code from public.orders where phone = '3100000001'), 'WA-0001', 'código con el prefijo del restaurante');
select is(pg_temp.pedido('3100000002', pg_temp.burger(2, false), '{"coupon":"humo20"}') ->> 'total', '53000', 'cupón 20%: 60.000 − 12.000 + 5.000');
select is(pg_temp.pedido('3100000002', pg_temp.burger(2, false), '{"coupon":"HUMO20"}') ->> 'reason', 'cupon_usado', 'cupón de un uso por celular');
select is(pg_temp.pedido('3100000003', pg_temp.burger(1, false), '{"coupon":"HUMO20"}') ->> 'reason', 'cupon', 'cupón bajo el mínimo no aplica');
select is(pg_temp.pedido('3100000004', pg_temp.burger(1, false), '{"coupon":"ENVIO"}') ->> 'total', '30000', 'cupón de envío deja el domicilio en 0');
select is(pg_temp.pedido('3100000005', '[{"product_id":"52000000-0000-4000-8000-000000000002","qty":2}]') ->> 'reason', 'agotado', 'producto agotado no se pide');
select is(pg_temp.pedido('3100000005', pg_temp.burger(1, false), '{"payment_code":"datafono"}') ->> 'reason', 'pago', 'medio de pago apagado no se acepta (D17)');
select is(pg_temp.pedido('3100000006', pg_temp.burger(1, false),
  '{"customer":{"name":"Cliente","phone":"3100000006","address":"Calle 1 # 2-3","zone_id":"62000000-0000-4000-8000-000000000002"}}') ->> 'reason',
  'fuera_de_zona', 'zona inactiva rechazada');
select is(pg_temp.pedido('3100000007', '[{"product_id":"52000000-0000-4000-8000-000000000002","qty":1}]') ->> 'reason', 'agotado', 'mínimo no se evalúa antes que agotado');
select is(pg_temp.pedido('3100000008', pg_temp.burger(1, false) || '[]'::jsonb) ->> 'ok', 'true', 'pedido sobre el mínimo pasa');

-- Límite por celular (Recomendada = 3 por hora)
select pg_temp.pedido('3109999999', pg_temp.burger(1, false));
select pg_temp.pedido('3109999999', pg_temp.burger(1, false));
select pg_temp.pedido('3109999999', pg_temp.burger(1, false));
select is(pg_temp.pedido('3109999999', pg_temp.burger(1, false)) ->> 'reason', 'repetido', 'el 4.º pedido en una hora del mismo celular se frena');
select ok(exists (select 1 from public.blocked_attempts where restaurant_id = '12000000-0000-4000-8000-000000000001' and reason = 'repetido'),
  'el intento frenado queda en el contador (P12)');

-- Cancelar como pedido falso bloquea el celular
insert into auth.users (id, email, raw_app_meta_data) values
  ('22000000-0000-4000-8000-00000000000c', 'ope@web.test', '{"role":"operador","restaurant_id":"12000000-0000-4000-8000-000000000001"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select public.set_order_status((select id from public.orders where phone = '3100000001'), 'cancelado', 'Pedido falso o broma');
reset role;
select is(pg_temp.pedido('3100000001', pg_temp.burger(1, false)) ->> 'reason', 'bloqueado', 'número bloqueado tras "Pedido falso"');

-- Seguimiento
set local role anon;
select is(public.track_order('web-a', 'wa-0002', 'token-de-prueba-3100000002') ->> 'status', 'nuevo', 'anon sigue su pedido con el enlace único');
select is(public.track_order('web-a', 'WA-0002', 'token-equivocado-123456'), null, 'token equivocado no devuelve nada');
select ok(public.track_order('web-a', 'WA-0002', 'token-de-prueba-3100000002')::text !~ '310000000', 'el seguimiento nunca expone el celular');
reset role;

select * from finish();
rollback;
