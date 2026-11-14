-- JP Smoke · Promociones, eventos y cotizaciones (F7): solo el admin gestiona; cotizaciones solo por el servidor.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.restaurants (id, slug, name, order_prefix) values ('16000000-0000-4000-8000-000000000001', 'pe-a', 'Promos A', 'PE');
insert into public.restaurant_settings (restaurant_id) values ('16000000-0000-4000-8000-000000000001');
insert into auth.users (id, email, raw_app_meta_data) values
  ('26000000-0000-4000-8000-00000000000a', 'adm@pe.test', '{"role":"admin","restaurant_id":"16000000-0000-4000-8000-000000000001"}'),
  ('26000000-0000-4000-8000-00000000000c', 'ope@pe.test', '{"role":"operador","restaurant_id":"16000000-0000-4000-8000-000000000001"}');
insert into public.events (id, restaurant_id, title, ends_on, show_intro) values
  ('46000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'Uno', current_date + 5, true),
  ('46000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'Dos', current_date + 5, false);

select is(public.submit_quote('{"restaurant":"pe-a","kind":"Catering al barril","name":"Ana","phone":"3105551234","guests":"40","message":"Cumpleaños en casa"}') ->> 'ok',
  'true', 'el servidor guarda una cotización válida');
select is(public.submit_quote('{"restaurant":"pe-a","kind":"Boda","name":"Ana","phone":"3105551234","message":"Algo más largo"}') ->> 'reason',
  'datos', 'tipo de evento inválido se rechaza sin error interno');
select public.submit_quote('{"restaurant":"pe-a","kind":"Otro","name":"Ana","phone":"3105551234","message":"Segunda solicitud"}');
select public.submit_quote('{"restaurant":"pe-a","kind":"Otro","name":"Ana","phone":"3105551234","message":"Tercera solicitud"}');
select is(public.submit_quote('{"restaurant":"pe-a","kind":"Otro","name":"Ana","phone":"3105551234","message":"Cuarta solicitud"}') ->> 'reason',
  'repetido', 'máximo 3 solicitudes al día por celular');
select ok(not has_function_privilege('anon', 'public.submit_quote(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.submit_quote(jsonb)', 'execute'), 'cotizar solo desde el servidor');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.quotes), 0, 'el operador no ve cotizaciones (datos personales)');
select throws_ok($$ insert into public.coupons (restaurant_id, code, kind, title) values ('16000000-0000-4000-8000-000000000001', 'OPER1', 'envio', 'Envío') $$,
  '42501', null, 'el operador no crea cupones');
select throws_ok($$ select public.set_intro_event('46000000-0000-4000-8000-000000000002') $$, '42501', null, 'el operador no cambia la bienvenida');

select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.quotes), 3, 'el admin ve las cotizaciones');
select lives_ok($$ update public.quotes set status = 'contactada' $$, 'el admin cambia el estado de una cotización');
select throws_ok($$ update public.quotes set phone = '3000000000' $$, '42501', null, 'el admin no altera los datos que envió el cliente');
select public.set_intro_event('46000000-0000-4000-8000-000000000002');
reset role;
select is((select array_agg(title) from public.events where restaurant_id = '16000000-0000-4000-8000-000000000001' and show_intro), array['Dos'],
  'activar una bienvenida apaga la anterior');

select * from finish();
rollback;
