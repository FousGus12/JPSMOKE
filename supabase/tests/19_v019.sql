-- JP Smoke · v0.19: idempotencia (D58), anular con cupón, motivo público e insumos (D59), pausa y hora
-- dinámica (D61), bienvenida vencida (D62), tiempos (D63), importar CSV (D64), frenados y exportación (D65).
begin;
create extension if not exists pgtap with schema extensions;
select plan(94);

insert into public.restaurants (id, slug, name, order_prefix) values
  ('1c000000-0000-4000-8000-000000000001', 'v19-a', 'V19 A', 'VY'),
  ('1c000000-0000-4000-8000-000000000002', 'v19-b', 'V19 B', 'VZ');
insert into public.restaurant_settings (restaurant_id, delivery_min, delivery_eta, whatsapp, whatsapp_mode, protection) values
  ('1c000000-0000-4000-8000-000000000001', 0, '35–50 min', '573001112222', 'prueba', 'estricta'),
  ('1c000000-0000-4000-8000-000000000002', 0, '35–50 min', null, 'manual', 'recomendada');
insert into auth.users (id, email, raw_app_meta_data) values
  ('2c000000-0000-4000-8000-00000000000a', 'adm@v19.test', '{"role":"admin","restaurant_id":"1c000000-0000-4000-8000-000000000001"}'),
  ('2c000000-0000-4000-8000-00000000000c', 'ope@v19.test', '{"role":"operador","restaurant_id":"1c000000-0000-4000-8000-000000000001"}'),
  ('2c000000-0000-4000-8000-00000000000d', 'ven@v19.test', '{"role":"operador","restaurant_id":"1c000000-0000-4000-8000-000000000001"}'),
  ('2c000000-0000-4000-8000-00000000000b', 'adm@v19b.test', '{"role":"admin","restaurant_id":"1c000000-0000-4000-8000-000000000002"}');
update public.staff set permissions = '{ventas}' where user_id = '2c000000-0000-4000-8000-00000000000d';
insert into public.categories (id, restaurant_id, slug, name) values
  ('3c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'burgers', 'Burgers');
insert into public.products (id, restaurant_id, category_id, slug, name, price) values
  ('5c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 'burger', 'Burger', 30000);
insert into public.delivery_zones (id, restaurant_id, name, fee, active) values
  ('7c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'Engativá', 5000, true),
  ('7c000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000001', 'Fontibón', 5000, false);
insert into public.payment_methods (restaurant_id, code, label) values ('1c000000-0000-4000-8000-000000000001', 'nequi', 'Nequi');
insert into public.supplies (id, restaurant_id, name, unit, purchase_unit, per_purchase, stock, min_stock) values
  ('6c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'Pan', 'pan', 'paquete', 12, 20, 0);
insert into public.recipes (product_id, supply_id, restaurant_id, qty, combo_only) values
  ('5c000000-0000-4000-8000-000000000001', '6c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 1, false);
insert into public.coupons (id, restaurant_id, code, kind, value, title, once_per_phone, max_uses) values
  ('8c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'BIENV10', 'valor', 5000, 'Bienvenida', false, 10),
  ('8c000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000001', 'CERO', 'valor', 1000, 'Cero usos', false, null);
insert into public.events (id, restaurant_id, title, captures_leads, coupon_id, starts_on, ends_on) values
  ('9c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'Bienvenida vieja', true,
   '8c000000-0000-4000-8000-000000000001', (now() at time zone 'America/Bogota')::date - 10, (now() at time zone 'America/Bogota')::date - 1),
  ('9c000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000001', 'Bienvenida vigente', true,
   '8c000000-0000-4000-8000-000000000001', (now() at time zone 'America/Bogota')::date, (now() at time zone 'America/Bogota')::date + 5);
insert into public.customers (id, restaurant_id, phone, name, blocked) values
  ('4c000000-0000-4000-8000-000000000099', '1c000000-0000-4000-8000-000000000001', '3190000099', 'Bloqueado', true);

create function pg_temp.pedido(phone text, extra jsonb default '{}', tok text default null) returns jsonb language sql as $$
  select public.place_order(jsonb_build_object('restaurant', 'v19-a', 'token', coalesce(tok, 'token-v019-' || gen_random_uuid()),
    'customer', jsonb_build_object('name', 'Cliente Prueba', 'phone', phone, 'address', 'Calle 68 # 60-71',
                                   'zone_id', '7c000000-0000-4000-8000-000000000001'),
    'payment_code', 'nequi',
    'items', jsonb_build_array(jsonb_build_object('product_id', '5c000000-0000-4000-8000-000000000001', 'qty', 1))) || extra)
$$;
create function pg_temp.oid(c text) returns uuid language sql as $$
  select id from public.orders where restaurant_id = '1c000000-0000-4000-8000-000000000001' and code = c
$$;
create function pg_temp.pan() returns numeric language sql as $$
  select stock from public.supplies where id = '6c000000-0000-4000-8000-000000000001'
$$;
create function pg_temp.como(u text) returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"' || u || '","role":"authenticated","aal":"aal2"}', true)
$$;
create temp table res (k text primary key, j jsonb);
grant select, insert on res to authenticated, anon;

-- ---------------------------------------------------------------------------
-- D58: idempotencia.
-- ---------------------------------------------------------------------------
insert into res values ('p1', pg_temp.pedido('3190000001',
  '{"request_id":"aaaaaaaa-0000-4000-8000-000000000001","coupon":"BIENV10","fill_ms":45000,"checkout_ms":"abc"}', 'token-primero-0001'));
insert into res values ('p1b', pg_temp.pedido('3190000001',
  '{"request_id":"aaaaaaaa-0000-4000-8000-000000000001","coupon":"BIENV10"}', 'token-segundo-0001'));
select is((select j ->> 'code' from res where k = 'p1'), 'VY-0001', 'primer intento crea el pedido');
select is((select j - 'total' from res where k = 'p1b'), '{"ok":true,"code":"VY-0001","repeated":true}'::jsonb,
  'reintento con el mismo request_id: mismo pedido, marcado repeated');
select is((select (j ->> 'total')::int from res where k = 'p1b'), (select (j ->> 'total')::int from res where k = 'p1'), 'el reintento devuelve el mismo total');
select is((select count(*)::int from public.orders where restaurant_id = '1c000000-0000-4000-8000-000000000001'), 1, 'no crea un segundo pedido');
select is((select uses from public.coupons where id = '8c000000-0000-4000-8000-000000000001'), 1, 'el reintento no gasta otra vez el cupón');
select is(pg_temp.pan(), 19.00, 'el reintento no descuenta inventario otra vez');
select isnt(public.track_order('v19-a', 'VY-0001', 'token-segundo-0001'), null, 'el enlace pasa al token nuevo');
select is(public.track_order('v19-a', 'VY-0001', 'token-primero-0001'), null, 'el token viejo deja de servir');
select is((select array[fill_ms, checkout_ms] from public.orders where code = 'VY-0001' and restaurant_id = '1c000000-0000-4000-8000-000000000001'),
  array[45000, null]::int[], 'guarda fill_ms y descarta un checkout_ms inválido');

-- Antes del límite por celular (estricta = 2 por hora).
insert into res values ('p2', pg_temp.pedido('3190000001', '{"request_id":"aaaaaaaa-0000-4000-8000-000000000002"}'));
select is((select j ->> 'code' from res where k = 'p2'), 'VY-0002', 'segundo pedido del mismo celular');
select is(pg_temp.pedido('3190000001', '{"request_id":"aaaaaaaa-0000-4000-8000-000000000003"}') ->> 'reason', 'repetido',
  'el tercero choca con el límite por celular');
select is(pg_temp.pedido('3190000001', '{"request_id":"aaaaaaaa-0000-4000-8000-000000000002"}') ->> 'code', 'VY-0002',
  'el reintento no gasta cupo por celular aunque esté en el límite');

-- Vencido (> 15 min) o de otro celular: pedido nuevo sin request_id. Sin request_id: igual que antes.
insert into res values ('p3', pg_temp.pedido('3190000002', '{"request_id":"aaaaaaaa-0000-4000-8000-000000000004"}'));
update public.orders set created_at = now() - interval '16 minutes' where id = pg_temp.oid('VY-0003');
insert into res values ('p3b', pg_temp.pedido('3190000002', '{"request_id":"aaaaaaaa-0000-4000-8000-000000000004"}'));
select is((select array[j ->> 'code', j ->> 'repeated'] from res where k = 'p3b'), array['VY-0004', null], 'pasados 15 min es un pedido nuevo');
select is((select request_id from public.orders where id = pg_temp.oid('VY-0004')), null, 'el pedido nuevo no hereda el request_id');
select is(pg_temp.pedido('3190000003', '{"request_id":"aaaaaaaa-0000-4000-8000-000000000002"}') ->> 'code', 'VY-0005',
  'el mismo request_id con otro celular no devuelve el pedido ajeno');
select is(pg_temp.pedido('3190000004', '{"request_id":"no-es-uuid"}') ->> 'code', 'VY-0006', 'request_id inválido o ausente: pedido normal');

-- ---------------------------------------------------------------------------
-- D59: anular.
-- ---------------------------------------------------------------------------
insert into res values ('p7', pg_temp.pedido('3190000005', '{"coupon":"CERO"}', 'token-cero-00000007'));
update public.coupons set uses = 0 where id = '8c000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.set_order_status(pg_temp.oid('VY-0006'), 'cancelado', 'Cliente se arrepintió', null, false) $$, '22023', null,
  'conservar insumos antes de En el barril se rechaza');
select lives_ok($$ select public.set_order_status(pg_temp.oid('VY-0001'), 'cancelado', 'Cliente grosero al teléfono', 'Nos quedamos sin pan') $$,
  'anular con motivo interno y público');
select public.set_order_status(pg_temp.oid('VY-0007'), 'cancelado', 'Cliente se arrepintió');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select uses from public.coupons where id = '8c000000-0000-4000-8000-000000000001'), 0, 'anular devuelve el uso del cupón');
select is((select uses from public.coupons where id = '8c000000-0000-4000-8000-000000000002'), 0, 'el uso del cupón no baja de 0');
select is((select array[supplies_restored::text, cancel_public] from public.orders where id = pg_temp.oid('VY-0001')),
  array['true', 'Nos quedamos sin pan'], 'guarda motivo público e insumos devueltos');
select is((public.track_order('v19-a', 'VY-0001', 'token-segundo-0001') -> 'cancel_reason'), 'null'::jsonb, 'track_order nunca trae el motivo interno');
select is((public.track_order('v19-a', 'VY-0001', 'token-segundo-0001') ->> 'cancel_note'), 'Nos quedamos sin pan', 'track_order trae el motivo público');
select is(position('grosero' in public.track_order('v19-a', 'VY-0001', 'token-segundo-0001')::text), 0, 'el motivo interno no aparece en ninguna parte');
select is((public.track_order('v19-a', 'VY-0007', 'token-cero-00000007') ->> 'cancel_note'), null, 'sin motivo público, cancel_note nulo');
select is((select count(*)::int from public.whatsapp_messages where kind = 'pedido_cancelado' and order_id = pg_temp.oid('VY-0001')), 1,
  'con motivo público se encola el aviso al cliente');
select is((select count(*)::int from public.whatsapp_messages where kind = 'pedido_cancelado' and order_id = pg_temp.oid('VY-0007')), 0,
  'sin motivo público no se encola');
select is((select detail ->> 'motivo_publico' from public.audit_log where entity_id = 'VY-0001' and restaurant_id = '1c000000-0000-4000-8000-000000000001'
  and detail ->> 'a' = 'cancelado'), 'Nos quedamos sin pan', 'la auditoría guarda ambos motivos');

-- Conservar insumos desde En el barril; la bandera no contamina la siguiente anulación.
insert into res values ('p8', pg_temp.pedido('3190000006'));
insert into res values ('p9', pg_temp.pedido('3190000007'));
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select public.set_order_status(pg_temp.oid('VY-0008'), 'en_cocina');
select public.set_order_status(pg_temp.oid('VY-0009'), 'en_cocina');
reset role;
select set_config('request.jwt.claims', '', true);
create temp table pan_antes as select pg_temp.pan() v;
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select lives_ok($$ select public.set_order_status(pg_temp.oid('VY-0008'), 'cancelado', 'Se quemó la carne', null, false) $$,
  'el operador anula desde En el barril sin devolver insumos');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.pan(), (select v from pan_antes), 'p_restore=false no devuelve insumos');
select is((select supplies_restored from public.orders where id = pg_temp.oid('VY-0008')), false, 'supplies_restored queda en false');
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select public.set_order_status(pg_temp.oid('VY-0009'), 'cancelado', 'Cliente no contestó');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.pan(), (select v + 1 from pan_antes), 'la anulación siguiente sí devuelve (la bandera se apaga)');
select is((select count(*)::int from public.whatsapp_messages where kind = 'pedido_cancelado' and order_id = pg_temp.oid('VY-0008')), 0,
  'en modo prueba sin motivo público no hay aviso');

insert into res values ('p10', pg_temp.pedido('3190000008'));
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000a');
select lives_ok($$ select public.set_order_status(pg_temp.oid('VY-0010'), 'cancelado', repeat('m', 200), repeat('p', 300)) $$,
  'motivo interno de 200 caracteres ya no revienta');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select array[length(cancel_reason), length(cancel_public)] from public.orders where id = pg_temp.oid('VY-0010')), array[200, 160],
  'motivos cortados a 200 y 160');
select ok(to_regprocedure('public.set_order_status(uuid, public.order_status, text)') is null, 'la firma vieja de set_order_status ya no existe');
select ok(has_function_privilege('authenticated', 'public.set_order_status(uuid, public.order_status, text, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.set_order_status(uuid, public.order_status, text, text, boolean)', 'execute'),
  'la firma nueva es del panel, no de anon');

-- ---------------------------------------------------------------------------
-- D61: pausa y hora estimada.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select lives_ok($$ select public.pause_orders(30) $$, 'el operador sin apartados pausa pedidos');
select throws_ok($$ select public.pause_orders(181) $$, '22023', null, 'más de 180 min se rechaza');
select pg_temp.como('2c000000-0000-4000-8000-00000000000a');
select throws_ok($$ update public.restaurant_settings set orders_paused_until = null
  where restaurant_id = '1c000000-0000-4000-8000-000000000001' $$, '42501', null, 'ni siquiera el admin la cambia directo');
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select orders_paused_until between now() + interval '29 minutes' and now() + interval '31 minutes'
  from public.restaurant_settings where restaurant_id = '1c000000-0000-4000-8000-000000000001'), 'queda pausado 30 min');
insert into res values ('pausa', pg_temp.pedido('3190000009'));
select is((select j ->> 'reason' from res where k = 'pausa'), 'cerrado', 'en pausa no recibe pedidos');
select isnt((select j ->> 'resumes_at' from res where k = 'pausa'), null, 'y dice cuándo vuelve');
select is(pg_temp.pedido('3190000001', '{"request_id":"aaaaaaaa-0000-4000-8000-000000000002"}') ->> 'code', 'VY-0002',
  'en pausa un reintento igual devuelve su pedido');
set local role anon;
select ok(not has_function_privilege('anon', 'public.pause_orders(integer)', 'execute'), 'anon no pausa');
select is((public.ordering_status('v19-a') ->> 'accepting')::boolean, false, 'ordering_status: no recibe en pausa');
select isnt(public.ordering_status('v19-a') ->> 'resumes_at', null, 'ordering_status: hora de regreso');
select is((select array_agg(k order by k) from jsonb_object_keys(public.ordering_status('v19-a')) k), array['accepting', 'eta', 'resumes_at'],
  'ordering_status solo trae accepting, resumes_at y eta (sin conteos)');
select is(public.ordering_status('no-existe'), null, 'restaurante inexistente: nulo');
reset role;
select set_config('request.jwt.claims', '', true);
-- Pausa vencida: vuelve a recibir sola.
update public.restaurant_settings set orders_paused_until = now() - interval '1 minute' where restaurant_id = '1c000000-0000-4000-8000-000000000001';
select is((public.ordering_status('v19-a') -> 'resumes_at'), 'null'::jsonb, 'pausa vencida: sin hora de regreso');
select ok((public.ordering_status('v19-a') ->> 'accepting')::boolean and pg_temp.pedido('3190000009') ->> 'code' = 'VY-0011',
  'pausa vencida: recibe pedidos');
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select is(public.pause_orders(0) -> 'paused_until', 'null'::jsonb, 'pause_orders(0) reanuda');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.audit_log where restaurant_id = '1c000000-0000-4000-8000-000000000001'
  and action in ('pausar pedidos', 'reanudar pedidos')), 2, 'pausar y reanudar quedan en auditoría');

-- Hora estimada: fija por defecto; dinámica = base + 4 min por activo (tope 40).
select is(public.ordering_status('v19-a') ->> 'eta', '35–50 min', 'hora fija: delivery_eta tal cual');
update public.restaurant_settings set eta_dynamic = true where restaurant_id = '1c000000-0000-4000-8000-000000000001';
create temp table activos as select count(*)::int n from public.orders where restaurant_id = '1c000000-0000-4000-8000-000000000001'
  and status in ('nuevo', 'confirmado', 'en_cocina', 'en_camino');
select is(public.ordering_status('v19-a') ->> 'eta',
  format('%s–%s min', 35 + least((select n from activos) * 4, 40), 50 + least((select n from activos) * 4, 40)), 'hora dinámica suma por pedido activo');
update public.restaurant_settings set eta_per_order_min = 30 where restaurant_id = '1c000000-0000-4000-8000-000000000001';
select is(public.ordering_status('v19-a') ->> 'eta', '75–90 min', 'con tope de eta_max_extra_min');
select is(public.track_order('v19-a', 'VY-0001', 'token-segundo-0001') ->> 'eta', '75–90 min', 'el seguimiento usa la misma hora');
update public.restaurant_settings set delivery_eta = 'Pronto' where restaurant_id = '1c000000-0000-4000-8000-000000000001';
select is(public.ordering_status('v19-a') ->> 'eta', 'Pronto', 'texto no reconocible: tal cual');
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000d');
select throws_ok($$ update public.restaurant_settings set eta_dynamic = false where restaurant_id = '1c000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'con Ventas pero sin Sitio no cambia la hora dinámica');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- D62: bienvenida vencida.
-- ---------------------------------------------------------------------------
select is(public.capture_lead('v19-a', '9c000000-0000-4000-8000-000000000001', 'Ana Lead', '3190000050', 'v1') ->> 'reason', 'vencido',
  'bienvenida vencida no da cupón');
select is((select count(*)::int from public.leads where restaurant_id = '1c000000-0000-4000-8000-000000000001'), 0, 'ni guarda el contacto');
select is(public.capture_lead('v19-a', '9c000000-0000-4000-8000-000000000002', 'Ana Lead', '3190000050', 'v1') ->> 'coupon', 'BIENV10',
  'bienvenida vigente sí');

-- ---------------------------------------------------------------------------
-- D65: frenados con cliente y exportación.
-- ---------------------------------------------------------------------------
select is(pg_temp.pedido('3190000099') ->> 'reason', 'bloqueado', 'cliente bloqueado: frenado');
select is((select customer_id from public.blocked_attempts where restaurant_id = '1c000000-0000-4000-8000-000000000001' and reason = 'bloqueado'),
  '4c000000-0000-4000-8000-000000000099'::uuid, 'el frenado guarda el vínculo al cliente');
select public.register_blocked('v19-a', 'robot', '{"name":"Robot","phone":"573190000099"}'::jsonb);
select public.register_blocked('v19-a', 'robot', '{"name":"Robot Nuevo","phone":"3190000777"}'::jsonb);
select is((select array_agg(customer_id::text order by customer_name) from public.blocked_attempts
  where restaurant_id = '1c000000-0000-4000-8000-000000000001' and reason = 'robot'), array['4c000000-0000-4000-8000-000000000099', null],
  'register_blocked también enlaza (con 57) y un celular nuevo queda sin cliente');

insert into public.consents (restaurant_id, phone, kind, version, granted, source, at) values
  ('1c000000-0000-4000-8000-000000000001', '3190000001', 'promociones', 'v1', true, 'pedido web', now() - interval '1 day'),
  ('1c000000-0000-4000-8000-000000000001', '3190000002', 'promociones', 'v1', true, 'pedido web', now() - interval '2 days'),
  ('1c000000-0000-4000-8000-000000000001', '3190000002', 'promociones', 'v1', false, 'retiro', now() - interval '1 day'),
  ('1c000000-0000-4000-8000-000000000001', '3190000099', 'promociones', 'v1', true, 'pedido web', now() - interval '1 day');
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select throws_ok($$ select * from public.customers_promo_export() $$, '42501', null, 'el operador no exporta clientes');
select pg_temp.como('2c000000-0000-4000-8000-00000000000a');
select is((select array_agg(x ->> 'celular' order by x ->> 'celular') from jsonb_array_elements(public.customers_promo_export()) x), array['3190000001'],
  'exporta solo autorización vigente y no bloqueados');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select (detail ->> 'filas')::int from public.audit_log where restaurant_id = '1c000000-0000-4000-8000-000000000001'
  and action = 'exportar' and entity = 'clientes'), 1, 'la exportación queda en auditoría con el número de filas');
select ok(not has_function_privilege('anon', 'public.customers_promo_export()', 'execute'), 'anon no exporta');
-- v0.19.1: retirar la autorización (solo admin) saca al cliente de la exportación.
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select throws_ok($$ select public.revoke_promos((select id from public.customers where phone = '3190000001'
  and restaurant_id = '1c000000-0000-4000-8000-000000000001')) $$, '42501', null, 'el operador no retira autorizaciones');
select pg_temp.como('2c000000-0000-4000-8000-00000000000a');
select lives_ok($$ select public.revoke_promos((select id from public.customers where phone = '3190000001'
  and restaurant_id = '1c000000-0000-4000-8000-000000000001')) $$, 'el admin retira la autorización');
select is(jsonb_array_length(public.customers_promo_export()), 0, 'tras el retiro ya no sale en la exportación');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- D64: importar ventas de Rappi/DiDi.
-- ---------------------------------------------------------------------------
insert into public.orders (restaurant_id, number, code, track_hash, channel, status, customer_name, phone, address, zone_name,
  payment_label, subtotal, total) values
  ('1c000000-0000-4000-8000-000000000001', 900, 'VY-0900', 'x', 'rappi', 'entregado', 'Cliente Rappi', '3190000300', 'Calle 1 # 2-3 Rappi', 'Engativá',
   'Rappi', 42000, 42000);
create temp table filas as select jsonb_build_array(
  jsonb_build_object('external_id', 'R-1', 'date', to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD'), 'total', 42000),
  jsonb_build_object('external_id', 'R-2', 'date', to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD') || ' 00:30', 'total', '18000', 'items', '1× Burger'),
  jsonb_build_object('external_id', 'R-3', 'date', '2026-02-30', 'total', 1000),
  jsonb_build_object('external_id', '', 'date', '2026-11-01', 'total', 1000),
  jsonb_build_object('external_id', 'R-4', 'date', '2026-11-01', 'total', '12.5'),
  jsonb_build_object('external_id', 'R-1', 'date', '2026-11-01', 'total', 1)) j;
grant select on filas to authenticated;
set local role authenticated;
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select throws_ok($$ select public.import_external_sales('rappi', 'a.csv', (select j from filas)) $$, '42501', null, 'sin apartado Ventas no importa');
select pg_temp.como('2c000000-0000-4000-8000-00000000000d');
insert into res values ('imp', public.import_external_sales('rappi', 'rappi-noviembre.csv', (select j from filas)));
select is((select j - 'batch' - 'error_rows' from res where k = 'imp'),
  '{"insertadas":2,"repetidas":1,"ya_registradas":1,"errores":3}'::jsonb, 'conteos de la importación (valida cada fila en el servidor)');
select is((select jsonb_path_query_array(j -> 'error_rows', '$[*].reason') from res where k = 'imp'), '["fecha","id_externo","total"]'::jsonb,
  'dice qué falló en cada fila');
select is((select array_agg(e.external_id || ':' || coalesce(o.code, '-') order by e.external_id) from public.external_sales e
  left join public.orders o on o.id = e.matched_order_id), array['R-1:VY-0900', 'R-2:-'], 'la que coincide con un pedido manual queda ya registrada');
select is(public.import_external_sales('rappi', 'otra-vez.csv', (select j from filas)) - 'error_rows',
  '{"batch":null,"insertadas":0,"repetidas":3,"ya_registradas":0,"errores":3}'::jsonb, 'reimportar no duplica');
select throws_ok($$ select public.import_external_sales('rappi', 'grande.csv',
  (select jsonb_agg(jsonb_build_object('external_id', 'G-' || g, 'date', '2026-11-01', 'total', 1)) from generate_series(1, 2001) g)) $$,
  '22023', null, 'más de 2.000 filas se rechaza');
select is((select (public.external_sales_summary(30) - 'by_day' - 'by_channel' - 'batches')),
  '{"days":30,"total":18000,"orders":1,"matched":1,"commission":0,"matched_total":42000}'::jsonb, 'el resumen deja fuera lo ya registrado');
select lives_ok($$ update public.restaurant_settings set import_maps = '{"rappi":{"external_id":"ID"}}'
  where restaurant_id = '1c000000-0000-4000-8000-000000000001' $$, 'Ventas guarda el mapeo de columnas');
select pg_temp.como('2c000000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.external_sales), 0, 'sin Ventas no ve las ventas externas');
select pg_temp.como('2c000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.external_sales) + (select count(*)::int from public.import_batches), 0,
  'otro restaurante no ve lotes ni ventas externas');
select throws_ok($$ select public.revert_import(((select j from res where k = 'imp') ->> 'batch')::uuid) $$, '42501', null,
  'otro restaurante no deshace el lote');
select pg_temp.como('2c000000-0000-4000-8000-00000000000d');
select throws_ok($$ insert into public.external_sales (restaurant_id, batch_id, channel, external_id, sold_at, sold_on, total)
  values ('1c000000-0000-4000-8000-000000000001', ((select j from res where k = 'imp') ->> 'batch')::uuid, 'rappi', 'X', now(), current_date, 1) $$,
  '42501', null, 'nadie escribe directo en external_sales');
select is(public.revert_import(((select j from res where k = 'imp') ->> 'batch')::uuid), 2, 'deshacer el lote borra sus ventas');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.external_sales where restaurant_id = '1c000000-0000-4000-8000-000000000001')
  + (select count(*)::int from public.import_batches where restaurant_id = '1c000000-0000-4000-8000-000000000001'), 0, 'no queda nada del lote');
select ok(not has_table_privilege('anon', 'public.external_sales', 'select') and not has_table_privilege('anon', 'public.import_batches', 'select')
  and not has_function_privilege('anon', 'public.import_external_sales(text, text, jsonb)', 'execute'),
  'anon no toca tablas ni funciones de importación');
select ok((select bool_and(rowsecurity) from pg_tables where schemaname = 'public' and tablename in ('external_sales', 'import_batches')),
  'tablas nuevas con RLS');

-- ---------------------------------------------------------------------------
-- D56/D57: textos del cupón y reseñas.
-- ---------------------------------------------------------------------------
select lives_ok($$ update public.events set lead_copy = '{"kicker":"Hola","title":"Tu cupón","text":"Déjanos tu número","button":"Quiero"}'
  where id = '9c000000-0000-4000-8000-000000000002' $$, 'lead_copy con las cuatro llaves de texto');
select throws_ok($$ update public.events set lead_copy = '{"title":"x","link":"https://x.co"}' where id = '9c000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'lead_copy no acepta llaves extra');
select throws_ok($$ update public.events set lead_copy = '{"title":3}' where id = '9c000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'lead_copy solo acepta textos');
select throws_ok($$ update public.events set lead_copy = jsonb_build_object('text', repeat('x', 700)) where id = '9c000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'lead_copy máximo 600 caracteres');
insert into public.reviews (restaurant_id, author, stars, body, approved) values ('1c000000-0000-4000-8000-000000000001', 'Ana', 5, 'Muy buena', true);
select is((select array[source, (review_date = (now() at time zone 'America/Bogota')::date)::text, position::text] from public.reviews
  where restaurant_id = '1c000000-0000-4000-8000-000000000001'), array['En persona', 'true', '0'], 'reseña: fuente, fecha y orden por defecto');
select throws_ok($$ insert into public.reviews (restaurant_id, author, stars, body, source) values
  ('1c000000-0000-4000-8000-000000000001', 'Ana', 5, 'Muy buena', 'TripAdvisor') $$, '23514', null, 'fuente fuera de la lista se rechaza');

select * from finish();
rollback;
