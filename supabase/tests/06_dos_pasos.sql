-- JP Smoke · El admin sin segundo paso (aal1) no ve ni cambia nada; el operador entra con contraseña (D12, F5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.restaurants (id, slug, name, order_prefix) values ('14000000-0000-4000-8000-000000000001', 'mfa-a', 'MFA A', 'MF');
insert into public.restaurant_settings (restaurant_id) values ('14000000-0000-4000-8000-000000000001');
insert into auth.users (id, email, raw_app_meta_data) values
  ('24000000-0000-4000-8000-00000000000a', 'adm@mfa.test', '{"role":"admin","restaurant_id":"14000000-0000-4000-8000-000000000001"}'),
  ('24000000-0000-4000-8000-00000000000c', 'ope@mfa.test', '{"role":"operador","restaurant_id":"14000000-0000-4000-8000-000000000001"}');
insert into public.orders (restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total) values
  ('14000000-0000-4000-8000-000000000001', 1, 'MF-0001', 'x', 'Cliente', '3001112222', 'Calle 1 # 2-3', 'Z', 'Nequi', 30000, 30000);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from public.orders), 0, 'admin con solo contraseña no ve pedidos');
select is((public.my_staff() ->> 'aal_ok')::boolean, false, 'el panel sabe que le falta el segundo paso');
select throws_ok($$ select public.sales_summary(30) $$, '42501', null, 'admin sin segundo paso no ve ventas');

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.orders), 1, 'admin con segundo paso ve sus pedidos');
select ok((public.board_summary() ->> 'sales_today') is not null, 'admin ve ventas de hoy en el resumen');

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-00000000000c","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from public.orders), 1, 'operador entra con contraseña');
select ok((public.board_summary() ->> 'sales_today') is null, 'el resumen del operador no trae dinero');
reset role;

select * from finish();
rollback;
