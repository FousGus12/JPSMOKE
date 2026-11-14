-- JP Smoke · Ventas (F8): números correctos, solo admin, exportar sin datos personales, cierre de caja e informe semanal.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.restaurants (id, slug, name, order_prefix) values ('17000000-0000-4000-8000-000000000001', 've-a', 'Ventas A', 'VE');
insert into public.restaurant_settings (restaurant_id) values ('17000000-0000-4000-8000-000000000001');
insert into public.payment_methods (restaurant_id, code, label, asks_change) values
  ('17000000-0000-4000-8000-000000000001', 'efectivo', 'Efectivo', true), ('17000000-0000-4000-8000-000000000001', 'nequi', 'Nequi', false);
insert into auth.users (id, email, raw_app_meta_data) values
  ('27000000-0000-4000-8000-00000000000a', 'adm@ve.test', '{"role":"admin","restaurant_id":"17000000-0000-4000-8000-000000000001"}'),
  ('27000000-0000-4000-8000-00000000000c', 'ope@ve.test', '{"role":"operador","restaurant_id":"17000000-0000-4000-8000-000000000001"}');
insert into public.customers (id, restaurant_id, phone, name) values
  ('57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', '3001112222', 'Recurrente'),
  ('57000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000001', '3003334444', 'Nuevo');
-- Hoy: 2 entregados en efectivo (30.000 y 20.000), 1 en Nequi (40.000), 1 cancelado. Hace 40 días: 1 del recurrente.
insert into public.orders (id, restaurant_id, number, code, track_hash, customer_id, customer_name, phone, address, zone_name, payment_label, subtotal, total, status, created_at, channel) values
  ('47000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 1, 'VE-0001', 'x', '57000000-0000-4000-8000-000000000001', 'R', '3001112222', 'Calle 1 # 2-3', 'Z', 'Efectivo', 30000, 30000, 'entregado', now(), 'web'),
  ('47000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000001', 2, 'VE-0002', 'x', '57000000-0000-4000-8000-000000000002', 'N', '3003334444', 'Calle 1 # 2-3', 'Z', 'Efectivo', 20000, 20000, 'entregado', now(), 'manual'),
  ('47000000-0000-4000-8000-000000000003', '17000000-0000-4000-8000-000000000001', 3, 'VE-0003', 'x', '57000000-0000-4000-8000-000000000002', 'N', '3003334444', 'Calle 1 # 2-3', 'Z', 'Nequi', 40000, 40000, 'entregado', now(), 'web'),
  ('47000000-0000-4000-8000-000000000004', '17000000-0000-4000-8000-000000000001', 4, 'VE-0004', 'x', '57000000-0000-4000-8000-000000000002', 'N', '3003334444', 'Calle 1 # 2-3', 'Z', 'Nequi', 99000, 99000, 'cancelado', now(), 'web'),
  ('47000000-0000-4000-8000-000000000005', '17000000-0000-4000-8000-000000000001', 5, 'VE-0005', 'x', '57000000-0000-4000-8000-000000000001', 'R', '3001112222', 'Calle 1 # 2-3', 'Z', 'Nequi', 10000, 10000, 'entregado', now() - interval '40 days', 'web');
insert into public.order_items (order_id, restaurant_id, name, qty, unit_price) values
  ('47000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'Burger', 2, 15000),
  ('47000000-0000-4000-8000-000000000003', '17000000-0000-4000-8000-000000000001', 'Costillas', 1, 40000);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"27000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select public.sales_export(30) $$, '42501', null, 'el operador no exporta ventas');
select throws_ok($$ select public.cash_expected() $$, '42501', null, 'el operador no hace cierre de caja');

select set_config('request.jwt.claims', '{"sub":"27000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is((public.sales_summary(30) ->> 'total')::int, 90000, 'ingresos de 30 días sin cancelados');
select is((public.sales_summary(30) ->> 'ticket')::int, 30000, 'ticket promedio');
select is((public.sales_summary(30) ->> 'previous_total')::int, 10000, 'periodo anterior para comparar');
select is(jsonb_array_length(public.sales_summary(7) -> 'by_day'), 7, 'una barra por día aunque no haya ventas');
select is((public.sales_summary(30) -> 'top_products' -> 0 ->> 'name'), 'Costillas', 'producto que más vende');
select is((public.sales_summary(30) ->> 'recurrent_pct')::int, 100, 'los 2 clientes del periodo tienen más de un pedido (sin contar cancelados)');
select ok((select not (proargnames && array['phone', 'address', 'celular', 'direccion']) from pg_proc where proname = 'sales_export'),
  'el CSV no lleva celular ni dirección');
select is((select count(*)::int from public.sales_export(30)), 4, 'exporta los pedidos del periodo');
select is((public.cash_expected() ->> 'expected')::int, 50000, 'efectivo esperado: solo entregados en medios que piden vuelto');
select is((public.close_cash((now() at time zone 'America/Bogota')::date, 48000, 'Faltó vuelto') ->> 'difference')::int, -2000, 'el cierre muestra el faltante');
select throws_ok($$ select public.weekly_report('17000000-0000-4000-8000-000000000001') $$, '42501', null,
  'el informe de otro restaurante por id solo lo pide el servidor');
reset role;

select * from finish();
rollback;
