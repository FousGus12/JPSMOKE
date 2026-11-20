-- JP Smoke · v0.18: pedidos sin plato (D47), frenados con detalle (D43), anular hasta el final (D42),
-- inventario inicial, costo y aviso de insumo bajo (D46, D49), Clientes y Seguridad (D41), cobertura (D44).
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

insert into public.restaurants (id, slug, name, order_prefix) values ('1b000000-0000-4000-8000-000000000001', 'v18-a', 'V18 A', 'VX');
insert into public.restaurant_settings (restaurant_id, delivery_min, whatsapp, whatsapp_mode)
  values ('1b000000-0000-4000-8000-000000000001', 0, '573001112222', 'prueba');
insert into auth.users (id, email, raw_app_meta_data) values
  ('2b000000-0000-4000-8000-00000000000a', 'adm@v18.test', '{"role":"admin","restaurant_id":"1b000000-0000-4000-8000-000000000001"}'),
  ('2b000000-0000-4000-8000-00000000000c', 'ope@v18.test', '{"role":"operador","restaurant_id":"1b000000-0000-4000-8000-000000000001"}'),
  ('2b000000-0000-4000-8000-00000000000e', 'inv@v18.test', '{"role":"operador","restaurant_id":"1b000000-0000-4000-8000-000000000001"}'),
  ('2b000000-0000-4000-8000-00000000000f', 'sit@v18.test', '{"role":"operador","restaurant_id":"1b000000-0000-4000-8000-000000000001"}');
update public.staff set permissions = '{inventario}' where user_id = '2b000000-0000-4000-8000-00000000000e';
update public.staff set permissions = '{sitio}' where user_id = '2b000000-0000-4000-8000-00000000000f';
insert into public.categories (id, restaurant_id, slug, name, is_addons) values
  ('3b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'burgers', 'Burgers', false),
  ('3b000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', 'extras', 'Adicionales', true);
insert into public.products (id, restaurant_id, category_id, slug, name, price) values
  ('5b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', 'burger', 'Burger', 30000),
  ('5b000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000002', 'huevo', 'Huevo', 2000);
insert into public.delivery_zones (id, restaurant_id, name, fee, active) values
  ('7b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'Engativá', 5000, true),
  ('7b000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', 'Fontibón', 5000, false);
insert into public.payment_methods (restaurant_id, code, label) values ('1b000000-0000-4000-8000-000000000001', 'nequi', 'Nequi');
insert into public.supplies (id, restaurant_id, name, unit, purchase_unit, per_purchase, stock, min_stock) values
  ('6b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'Pan', 'pan', 'paquete', 12, 20, 5),
  ('6b000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', 'Lechuga', 'hoja', 'lechuga', 12, 10, 4),
  ('6b000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000001', 'Queso', 'tajada', 'paquete', 12, 10, 3),
  ('6b000000-0000-4000-8000-000000000004', '1b000000-0000-4000-8000-000000000001', 'Tomate', 'rodaja', 'tomate', 6, 10, 3);
insert into public.recipes (product_id, supply_id, restaurant_id, qty, combo_only) values
  ('5b000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 1, false);
insert into public.customers (restaurant_id, phone, name, blocked) values ('1b000000-0000-4000-8000-000000000001', '3180000008', 'Bloqueado', true);

create function pg_temp.pedido(phone text, items jsonb, zone text default '7b000000-0000-4000-8000-000000000001', nm text default 'Cliente Prueba')
returns jsonb language sql as $$
  select public.place_order(jsonb_build_object('restaurant', 'v18-a', 'token', 'token-v018-' || phone || '-' || gen_random_uuid(),
    'customer', jsonb_build_object('name', nm, 'phone', phone, 'address', 'Calle 68 # 60-71', 'zone_id', zone),
    'payment_code', 'nequi', 'items', items))
$$;
create function pg_temp.burger() returns jsonb language sql as $$ select '{"product_id":"5b000000-0000-4000-8000-000000000001","qty":1}'::jsonb $$;
create function pg_temp.huevo() returns jsonb language sql as $$ select '{"product_id":"5b000000-0000-4000-8000-000000000002","qty":1}'::jsonb $$;
create function pg_temp.frenado(why text) returns text[] language sql as $$
  select array[customer_name, phone_last4, zone_name, items_count::text] from public.blocked_attempts
  where restaurant_id = '1b000000-0000-4000-8000-000000000001' and reason = why
$$;
create function pg_temp.oid(c text) returns uuid language sql as $$
  select id from public.orders where restaurant_id = '1b000000-0000-4000-8000-000000000001' and code = c
$$;

-- D47: una adición sola no es pedido.
select is(pg_temp.pedido('3180000001', jsonb_build_array(pg_temp.huevo(), pg_temp.huevo())) ->> 'reason', 'sin_plato', 'solo adiciones: sin_plato');
select is((select count(*)::int from public.blocked_attempts where restaurant_id = '1b000000-0000-4000-8000-000000000001'), 0,
  'sin_plato no cuenta como intento frenado');
select is(pg_temp.pedido('3180000003', jsonb_build_array(pg_temp.burger(), pg_temp.huevo())) ->> 'code', 'VX-0001', 'plato + adición pasa');

-- D43: intentos frenados con detalle mínimo.
select is(pg_temp.pedido('3180000007', jsonb_build_array(pg_temp.burger(), pg_temp.huevo()), '7b000000-0000-4000-8000-000000000002', 'Ana Frenada') ->> 'reason',
  'fuera_de_zona', 'zona apagada: fuera_de_zona');
select is(pg_temp.frenado('fuera_de_zona'), array['Ana Frenada', '0007', 'Fontibón', '2'], 'guarda nombre, últimos 4, zona y número de productos');
select is(pg_temp.pedido('3180000008', jsonb_build_array(pg_temp.burger())) ->> 'reason', 'bloqueado', 'cliente bloqueado: frenado');
select is(pg_temp.frenado('bloqueado'), array['Cliente Prueba', '0008', 'Engativá', '1'], 'el bloqueado también deja su detalle');
select ok((select bool_and(phone_last4 ~ '^[0-9]{4}$') from public.blocked_attempts where restaurant_id = '1b000000-0000-4000-8000-000000000001'),
  'nunca se guarda el celular completo');
select lives_ok($$ select public.register_blocked('v18-a', 'robot',
  '{"zone_id":"7b000000-0000-4000-8000-000000000001","name":"Robot","phone":"300 123 4567","items":"3"}'::jsonb) $$, 'el servidor registra un robot');
select is(pg_temp.frenado('robot'), array['Robot', '4567', 'Engativá', '3'], 'register_blocked resuelve la zona por id');
select ok(not has_function_privilege('anon', 'public.register_blocked(text, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.register_blocked(text, text, jsonb)', 'execute'),
  'register_blocked solo desde el servidor');
insert into public.blocked_attempts (restaurant_id, reason, at) values ('1b000000-0000-4000-8000-000000000001', 'robot', now() - interval '31 days');
select private.purge_blocked();
select is((select array[count(*) filter (where at < now() - interval '30 days'), count(*)]::int[] from public.blocked_attempts
  where restaurant_id = '1b000000-0000-4000-8000-000000000001'), array[0, 3], 'purge_blocked borra solo lo de más de 30 días');

-- D46/D49: inventario con Inicial y costo (operador con Inventario).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000e","role":"authenticated","aal":"aal2"}', true);
select is(public.register_supply('6b000000-0000-4000-8000-000000000002', 'inicial', 30), 30.00, 'Inicial deja la existencia en el valor contado');
select ok((select initial_stock = 30 and initial_at is not null and stock = 30 from public.supplies where id = '6b000000-0000-4000-8000-000000000002'),
  'Inicial guarda la existencia de partida y su fecha');
select is(public.register_supply('6b000000-0000-4000-8000-000000000002', 'merma', 5, 'Se dañaron'), 25.00, 'la merma resta de la actual');
select is((select initial_stock from public.supplies where id = '6b000000-0000-4000-8000-000000000002'), 30.00, 'la merma no toca el inicial');
select is((select count(*)::int from public.supply_moves where supply_id = '6b000000-0000-4000-8000-000000000002' and kind = 'inicial'), 1,
  'queda el movimiento inicial');
select is(public.register_supply('6b000000-0000-4000-8000-000000000002', 'compra', 1, null, 12000), 37.00, 'compra con costo');
select ok((select cost = 12000 and cost_at is not null from public.supplies where id = '6b000000-0000-4000-8000-000000000002'),
  'el costo se actualiza con su fecha');
select throws_ok($$ select public.register_supply('6b000000-0000-4000-8000-000000000002', 'compra', 1, null, -1) $$, '22023', null, 'costo negativo rechazado');

-- D46: aviso de insumo bajo (modo prueba).
select public.register_supply('6b000000-0000-4000-8000-000000000003', 'merma', 8);
select public.register_supply('6b000000-0000-4000-8000-000000000003', 'compra', 1);
select public.register_supply('6b000000-0000-4000-8000-000000000003', 'merma', 12);

-- D49: margen objetivo.
update public.restaurant_settings set target_margin = 50 where restaurant_id = '1b000000-0000-4000-8000-000000000001';
reset role;
select is((select target_margin::int from public.restaurant_settings where restaurant_id = '1b000000-0000-4000-8000-000000000001'), 50,
  'quien tiene Inventario cambia el margen objetivo');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000f","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ update public.restaurant_settings set target_margin = 40 where restaurant_id = '1b000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'con solo Editar página no cambia el margen');
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ update public.restaurant_settings set target_margin = 96 where restaurant_id = '1b000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'margen fuera de 1–95 rechazado');
select lives_ok($$ update public.restaurant_settings set target_margin = 40 where restaurant_id = '1b000000-0000-4000-8000-000000000001' $$,
  'el admin cambia el margen');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select target_margin::int from public.restaurant_settings where restaurant_id = '1b000000-0000-4000-8000-000000000001'), 40, 'margen guardado');

select ok(to_regprocedure('public.register_supply(uuid, public.supply_move_kind, numeric, text)') is null, 'la firma vieja de 4 argumentos ya no existe');
select ok(to_regprocedure('public.register_supply(uuid, public.supply_move_kind, numeric, text, numeric)') is not null, 'existe la de 5 con costo');
set local role anon;
select throws_ok($$ select cost from public.supplies $$, '42501', null, 'la página no ve insumos ni costos');
reset role;

select is((select count(*)::int from public.whatsapp_messages where kind = 'stock_bajo' and supply_id = '6b000000-0000-4000-8000-000000000003'), 1,
  'cruzar el mínimo encola un solo aviso aunque cruce dos veces en 6 h');
update public.restaurant_settings set whatsapp_mode = 'manual' where restaurant_id = '1b000000-0000-4000-8000-000000000001';
update public.supplies set stock = 1 where id = '6b000000-0000-4000-8000-000000000004';
select is((select count(*)::int from public.whatsapp_messages where kind = 'stock_bajo' and supply_id = '6b000000-0000-4000-8000-000000000004'), 0,
  'en modo manual no se encola');
select is((select count(*)::int from public.whatsapp_messages where kind = 'stock_bajo' and restaurant_id = '1b000000-0000-4000-8000-000000000001'), 1,
  'total de avisos de insumo');

-- D42: anular hasta el final.
select pg_temp.pedido('3180000020', jsonb_build_array(pg_temp.burger()));
select pg_temp.pedido('3180000020', jsonb_build_array(pg_temp.burger()));
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select public.set_order_status(pg_temp.oid('VX-0002'), 'entregado');
select public.set_order_status(pg_temp.oid('VX-0003'), 'entregado');
select is((select trusted from public.customers where restaurant_id = '1b000000-0000-4000-8000-000000000001' and phone = '3180000020'), true,
  'dos entregados: cliente de confianza');
select public.close_cash((now() at time zone 'America/Bogota')::date, 0);
reset role;
update public.cash_closings set closed_at = now() - interval '1 hour' where restaurant_id = '1b000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000c","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$ select public.set_order_status(pg_temp.oid('VX-0002'), 'cancelado', 'Error del cliente') $$, '42501', null,
  'el operador no anula un entregado');
select throws_ok($$ select public.customers_list() $$, '42501', null, 'el operador no ve Clientes');
select throws_ok($$ select public.audit_list() $$, '42501', null, 'el operador no ve la auditoría');
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ select public.set_order_status(pg_temp.oid('VX-0002'), 'cancelado', 'Cliente devolvió el pedido') $$, 'el admin anula un entregado');
select public.set_order_status(pg_temp.oid('VX-0003'), 'cancelado', 'Pedido de prueba');
select throws_ok($$ select public.set_order_status(pg_temp.oid('VX-0002'), 'entregado') $$, '22023', null, 'un cancelado ya no cambia');
select is((public.sales_summary(30) ->> 'cancelled')::int, 1, 'el pedido de prueba no cuenta como cancelado en Ventas');
select is((public.board_summary() ->> 'cancelled_today')::int, 1, 'ni en el Resumen');
select is((select array_agg(codigo order by codigo) from public.sales_export(30)), array['VX-0001', 'VX-0002'], 'ni en la exportación');
select is(jsonb_path_query_array(public.sales_summary(30) -> 'voided_after_close', '$[*].code'), '["VX-0002"]'::jsonb,
  'Ventas muestra aparte el entregado anulado después del cierre');
select is((public.customers_list('3180000020') -> 'rows' -> 0 ->> 'name'), 'Cliente Prueba', 'el admin busca clientes por celular');
select is((public.customers_list() ->> 'total')::int, 3, 'Clientes lista los clientes del restaurante');
select is((select count(*)::int from jsonb_array_elements(public.audit_list(200)) e where e ->> 'action' = 'anular' and e ->> 'actor' = 'adm'), 2,
  'la auditoría trae la anulación con el nombre de quien la hizo');
reset role;
select set_config('request.jwt.claims', '', true);

select is((select array[status::text, voided_from::text, is_test::text] from public.orders where id = pg_temp.oid('VX-0002')),
  array['cancelado', 'entregado', 'false'], 'anulado: cancelado desde entregado');
select is((select is_test from public.orders where id = pg_temp.oid('VX-0003')), true, '"Pedido de prueba" marca is_test');
select is((select qty from public.supply_moves where order_id = pg_temp.oid('VX-0002') and kind = 'devolucion'), 1.00, 'anular devuelve los insumos');
select is((select stock from public.supplies where id = '6b000000-0000-4000-8000-000000000001'), 19.00, 'el pan vuelve (20 − 3 + 2)');
select is((select trusted from public.customers where restaurant_id = '1b000000-0000-4000-8000-000000000001' and phone = '3180000020'), false,
  'la confianza del cliente se recalcula');
select ok(not has_function_privilege('anon', 'public.customers_list(text, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.audit_list(integer, timestamptz)', 'execute'), 'anon no ejecuta Clientes ni auditoría');

-- D44: cobertura.
select is((select array_agg(coalesce(z.locality_code, '--') order by z.name) from public.delivery_zones z join public.restaurants r on r.id = z.restaurant_id
  where r.slug = 'jp-smoke'), array['12', '02', '10', '09', '08', '11', '13'], 'las zonas del seed tienen su código de localidad');
select ok(has_column_privilege('anon', 'public.restaurant_settings', 'store_lat', 'select')
  and has_column_privilege('anon', 'public.restaurant_settings', 'store_lng', 'select'), 'el sitio lee las coordenadas del local');
select throws_ok($$ update public.restaurant_settings set store_lat = 6.25 where restaurant_id = '1b000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'latitud fuera de Bogotá rechazada');
select throws_ok($$ update public.restaurant_settings set store_lng = -75.5 where restaurant_id = '1b000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'longitud fuera de Bogotá rechazada');

-- Correcciones: búsqueda de clientes, "Pedido de prueba" solo del admin, total de intentos frenados.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is((public.customers_list('Bloq') ->> 'total')::int, 1, 'customers_list filtra por nombre');
select is((public.customers_list('zzzz') ->> 'total')::int, 0, 'customers_list sin coincidencias no devuelve clientes');
reset role;
select set_config('request.jwt.claims', '', true);

select pg_temp.pedido('3180000031', jsonb_build_array(pg_temp.burger()), '7b000000-0000-4000-8000-000000000001', 'Prueba Operador');
select pg_temp.pedido('3180000032', jsonb_build_array(pg_temp.burger()), '7b000000-0000-4000-8000-000000000001', 'Prueba Admin');
create function pg_temp.oid_tel(t text) returns uuid language sql as $$
  select o.id from public.orders o join public.customers c on c.id = o.customer_id
  where o.restaurant_id = '1b000000-0000-4000-8000-000000000001' and c.phone = t
$$;
create temp table ids_prueba as select pg_temp.oid_tel('3180000031') as ope, pg_temp.oid_tel('3180000032') as adm;
grant select on ids_prueba to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000c","role":"authenticated","aal":"aal1"}', true);
select public.set_order_status((select ope from ids_prueba), 'cancelado', 'Pedido de prueba del operador');
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select public.set_order_status((select adm from ids_prueba), 'cancelado', 'Pedido de prueba del admin');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select is_test from public.orders where id = pg_temp.oid_tel('3180000031')), false, 'el operador no marca is_test');
select is((select is_test from public.orders where id = pg_temp.oid_tel('3180000032')), true, 'el admin sí marca is_test');

select is((select private.order_public(o) -> 'cancel_reason' from public.orders o where o.id = (select ope from ids_prueba)), 'null'::jsonb,
  'el seguimiento público de un cancelado no trae el motivo interno');
select pg_temp.pedido('3180000033', jsonb_build_array(pg_temp.burger(), pg_temp.huevo()), '7b000000-0000-4000-8000-000000000002', 'Total Frenado');
select is((select total_attempt from public.blocked_attempts where customer_name = 'Total Frenado'), 32000, 'fuera_de_zona guarda el total con precios del servidor');
select public.register_blocked('v18-a', 'robot', jsonb_build_object('name', 'Lineas Robot',
  'lines', jsonb_build_array(jsonb_build_object('product_id', '5b000000-0000-4000-8000-000000000001', 'qty', 2),
                             jsonb_build_object('product_id', '5b000000-0000-4000-8000-000000000002', 'qty', 1))));
select is((select total_attempt from public.blocked_attempts where customer_name = 'Lineas Robot'), 62000, 'register_blocked calcula el total desde las líneas');
select lives_ok($$ select public.register_blocked('v18-a', 'robot', jsonb_build_object('name', 'Lineas Malas',
  'lines', jsonb_build_array(jsonb_build_object('product_id', 'no-es-uuid', 'qty', 1),
                             jsonb_build_object('product_id', '5b000000-0000-4000-8000-000000000001', 'qty', 'x'),
                             jsonb_build_object('qty', null)))) $$, 'líneas inválidas no rompen register_blocked');
select is((select total_attempt from public.blocked_attempts where customer_name = 'Lineas Malas'), null, 'líneas inválidas: total nulo');
select lives_ok($$ select public.register_blocked('v18-a', 'robot', jsonb_build_object('name', 'Lineas Parcial',
  'lines', jsonb_build_array(jsonb_build_object('product_id', '5b000000-0000-4000-8000-000000000001', 'qty', 1),
                             jsonb_build_object('product_id', 'zz', 'qty', 1)))) $$, 'líneas parcialmente válidas no rompen');
select is((select total_attempt from public.blocked_attempts where customer_name = 'Lineas Parcial'), 30000, 'solo suma las líneas válidas');
select lives_ok($$ select public.register_blocked('v18-a', 'robot', jsonb_build_object('name', 'Zona Rara', 'zone_id', repeat('-', 36))) $$,
  'zone_id de 36 guiones no lanza excepción');

-- Regla de cierre (todas las funciones de public, no solo security definer; el 01 cubre estas).
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), array['ordering_status', 'stock_status', 'track_order'],
  'anon solo ejecuta track_order, stock_status y ordering_status (D61) en public');

select * from finish();
rollback;
