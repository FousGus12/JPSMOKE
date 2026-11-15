-- JP Smoke · Correcciones de la auditoría run-2 (D39).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.restaurants (id, slug, name, order_prefix) values ('16000000-0000-4000-8000-000000000001', 'cr-a', 'Correcciones A', 'CA');
insert into public.restaurant_settings (restaurant_id, whatsapp) values ('16000000-0000-4000-8000-000000000001', '573001112222');
insert into auth.users (id, email, raw_app_meta_data) values
  ('26000000-0000-4000-8000-00000000000a', 'adm@cr.test', '{"role":"admin","restaurant_id":"16000000-0000-4000-8000-000000000001"}'),
  ('26000000-0000-4000-8000-00000000000b', 'sit@cr.test', '{"role":"operador","restaurant_id":"16000000-0000-4000-8000-000000000001"}');
update public.staff set permissions = '{sitio}' where user_id = '26000000-0000-4000-8000-00000000000b';
insert into auth.sessions (id, user_id) values ('36000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-00000000000b');
insert into public.orders (id, restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total) values
  ('46000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 1, 'CA-0001', 'x', 'Cliente', '3001234567', 'Calle 1 # 2-3', 'Z', 'Nequi', 30000, 30000);

set local role authenticated;
-- Operador con solo "Editar página" (sitio), con sesión viva.
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-00000000000b","role":"authenticated","aal":"aal2","session_id":"36000000-0000-4000-8000-000000000001"}', true);
select ok(public.my_restaurant() is not null, 'sesión viva: entra');
select throws_ok($$ update public.restaurant_settings set whatsapp = '573009999999' where restaurant_id = '16000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'con solo Editar página no cambia el número de WhatsApp del negocio');
select lives_ok($$ update public.restaurant_settings set delivery_eta = '40–60 min' where restaurant_id = '16000000-0000-4000-8000-000000000001' $$,
  'con Editar página sí cambia lo del sitio');
select throws_ok($$ update public.restaurant_settings set brand = '{"x":1}'::jsonb where restaurant_id = '16000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'la marca sigue siendo solo del admin');

-- Publicar: published_at no se toca a mano; la pausa no se puede reiniciar.
select throws_ok($$ update public.restaurant_settings set published_at = now() where restaurant_id = '16000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'published_at no se escribe a mano (reinicio o adelanto)');
select throws_ok($$ update public.restaurant_settings set published_at = '2099-01-01' where restaurant_id = '16000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'tampoco se puede bloquear Publicar con una fecha futura');
select lives_ok($$ select public.publish_site() $$, 'publica');
select throws_ok($$ select public.publish_site() $$, 'P0001', null, 'la segunda en el mismo minuto se frena');
select lives_ok($$ select public.unmark_published() $$, 'deshacer la marca solo aplica a la publicación recién hecha');
reset role;
select set_config('request.jwt.claims', '', true);
update public.restaurant_settings set published_at = now() - interval '10 minutes' where restaurant_id = '16000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-00000000000b","role":"authenticated","aal":"aal2","session_id":"36000000-0000-4000-8000-000000000001"}', true);
select public.unmark_published();
reset role;
select ok((select published_at from public.restaurant_settings where restaurant_id = '16000000-0000-4000-8000-000000000001') is not null,
  'unmark no borra una publicación vieja (no reinicia la pausa)');

-- Sesión cerrada: el token deja de autorizar.
delete from auth.sessions where id = '36000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-00000000000b","role":"authenticated","aal":"aal2","session_id":"36000000-0000-4000-8000-000000000001"}', true);
select ok(public.my_restaurant() is null, 'sesión cerrada: el token ya no autoriza');
reset role;

-- Clave temporal pendiente: sin panel hasta cambiarla, pero el panel sabe qué pedir.
update public.staff set must_change_password = true where user_id = '26000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select ok(public.my_restaurant() is null, 'con clave temporal pendiente no entra');
select is((public.my_staff() ->> 'must_change_password')::boolean, true, 'el panel sabe que debe pedir el cambio');
select throws_ok($$ update public.staff set must_change_password = false where user_id = '26000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'nadie se quita la marca a mano');
reset role;

-- Seguimiento por 4 dígitos: tope acumulado de 15 fallos por pedido, aunque cambie la hora.
insert into private.track_fails (order_id, fails) values ('46000000-0000-4000-8000-000000000001', 15);
select is(public.track_order_by_phone('cr-a', 'CA-0001', '4567'), null, 'tras 15 fallos ni el número correcto sirve por esta vía');
delete from private.track_fails;
select isnt(public.track_order_by_phone('cr-a', 'CA-0001', '4567'), null, 'sin fallos acumulados, el número correcto funciona');
select is(public.track_order_by_phone('cr-a', 'CA-0001', '0000'), null, 'un fallo devuelve vacío y suma');

select * from finish();
rollback;
