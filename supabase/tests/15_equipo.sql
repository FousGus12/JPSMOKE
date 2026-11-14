-- JP Smoke · Equipo y apartados delegados (D38): la base decide qué ve y cambia cada persona.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into public.restaurants (id, slug, name, order_prefix) values
  ('15000000-0000-4000-8000-000000000001', 'eq-a', 'Equipo A', 'EA'),
  ('15000000-0000-4000-8000-000000000002', 'eq-b', 'Equipo B', 'EB');
insert into public.restaurant_settings (restaurant_id) values
  ('15000000-0000-4000-8000-000000000001'), ('15000000-0000-4000-8000-000000000002');
insert into auth.users (id, email, raw_app_meta_data) values
  ('25000000-0000-4000-8000-00000000000a', 'adm@eq.test', '{"role":"admin","restaurant_id":"15000000-0000-4000-8000-000000000001"}'),
  ('25000000-0000-4000-8000-00000000000c', 'ope@eq.test', '{"role":"operador","restaurant_id":"15000000-0000-4000-8000-000000000001"}'),
  ('25000000-0000-4000-8000-00000000000d', 'ven@eq.test', '{"role":"operador","restaurant_id":"15000000-0000-4000-8000-000000000001"}'),
  ('25000000-0000-4000-8000-00000000000b', 'adm@eqb.test', '{"role":"admin","restaurant_id":"15000000-0000-4000-8000-000000000002"}');
update public.staff set permissions = '{ventas,carta}' where user_id = '25000000-0000-4000-8000-00000000000d';
insert into public.categories (id, restaurant_id, slug, name) values
  ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'cat', 'Cat');

select throws_ok($$ update public.staff set permissions = '{equipo}' where user_id = '25000000-0000-4000-8000-00000000000c' $$,
  '23514', null, 'Equipo no es un apartado delegable');

set local role authenticated;

-- Operador sin apartados: entra con contraseña, solo la base.
select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000c","role":"authenticated","aal":"aal1"}', true);
select ok(public.my_restaurant() is not null, 'operador sin apartados entra con contraseña');
select is(public.can('ventas'), false, 'operador sin apartados no tiene Ventas');
select throws_ok($$ select public.sales_summary(30) $$, '42501', null, 'operador sin apartados no ve ventas');
select throws_ok($$ select public.team_list() $$, '42501', null, 'operador no ve la gestión del equipo');
update public.categories set name = 'Hackeada' where id = '35000000-0000-4000-8000-000000000001';
select is((select name from public.categories where id = '35000000-0000-4000-8000-000000000001'), 'Cat', 'operador sin Carta no edita la carta');
update public.staff set permissions = '{ventas}' where user_id = '25000000-0000-4000-8000-00000000000c';
select is((select cardinality(permissions) from public.staff where user_id = '25000000-0000-4000-8000-00000000000c'), 0,
  'operador no se puede dar apartados');

-- Operador con Ventas y Carta: necesita el segundo paso.
select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000d","role":"authenticated","aal":"aal1"}', true);
select ok(public.my_restaurant() is null, 'operador con apartados y solo contraseña no entra');
select is((public.my_staff() ->> 'needs_totp')::boolean, true, 'el panel sabe que debe pedir el segundo paso');
select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000d","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ select public.sales_summary(30) $$, 'operador con Ventas ve ventas');
select ok((public.board_summary() ->> 'sales_today') is not null, 'operador con Ventas ve dinero en el resumen');
update public.categories set name = 'Nueva' where id = '35000000-0000-4000-8000-000000000001';
select is((select name from public.categories where id = '35000000-0000-4000-8000-000000000001'), 'Nueva', 'operador con Carta edita la carta');
select is(public.can('inventario'), false, 'operador con Ventas y Carta no tiene Inventario');
select throws_ok($$ update public.restaurant_settings set whatsapp = '573000000000' where restaurant_id = '15000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'operador sin Editar página no cambia los ajustes del sitio');
select throws_ok($$ select public.team_list() $$, '42501', null, 'operador con apartados tampoco gestiona el equipo');

-- Admin del restaurante A.
select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is(jsonb_array_length(public.team_list()), 3, 'admin ve su equipo (3 cuentas)');
select ok(public.team_list()::text !~ 'adm@eqb.test', 'admin no ve cuentas de otro restaurante');
update public.staff set permissions = '{inventario}' where user_id = '25000000-0000-4000-8000-00000000000c';
select is((select permissions from public.staff where user_id = '25000000-0000-4000-8000-00000000000c'), '{inventario}'::text[],
  'admin delega Inventario al operador');
update public.staff set full_name = 'Intruso' where user_id = '25000000-0000-4000-8000-00000000000b';
select throws_ok($$ update public.staff set active = false where user_id = '25000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'admin no se puede desactivar a sí mismo');
select throws_ok($$ update public.staff set restaurant_id = '15000000-0000-4000-8000-000000000002' where user_id = '25000000-0000-4000-8000-00000000000c' $$,
  '42501', null, 'admin no puede mover una cuenta a otro restaurante');
update public.staff set active = false where user_id = '25000000-0000-4000-8000-00000000000d';
reset role;

select isnt((select full_name from public.staff where user_id = '25000000-0000-4000-8000-00000000000b'), 'Intruso',
  'admin no toca cuentas de otro restaurante');

-- Desactivar corta el acceso de inmediato, aunque la sesión siga viva.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000d","role":"authenticated","aal":"aal2"}', true);
select ok(public.my_restaurant() is null, 'cuenta desactivada pierde el acceso');
reset role;

-- Último admin: ni el servidor deja el restaurante sin admin activo.
select throws_ok($$ update public.staff set role = 'operador' where user_id = '25000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'no se puede quitar el último admin');
select throws_ok($$ delete from public.staff where user_id = '25000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'no se puede borrar el último admin');

select * from finish();
rollback;
