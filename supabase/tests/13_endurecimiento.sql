-- JP Smoke · Endurecimiento F10: anon solo lee lo público y no ve columnas internas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(not has_table_privilege('anon', 'public.orders', 'select'), 'anon no lee pedidos');
select ok(not has_table_privilege('anon', 'public.customers', 'select'), 'anon no lee clientes');
select ok(not has_table_privilege('anon', 'public.products', 'insert'), 'anon no inserta productos (ni con RLS apagado)');
select ok(not has_table_privilege('anon', 'public.restaurant_settings', 'update'), 'anon no edita ajustes');
select ok(not has_column_privilege('anon', 'public.restaurant_settings', 'protection', 'select'), 'anon no ve el nivel de protección');
select ok(not has_column_privilege('anon', 'public.restaurant_settings', 'whatsapp_mode', 'select'), 'anon no ve el modo de WhatsApp');
select ok(not has_column_privilege('anon', 'public.restaurants', 'plan', 'select'), 'anon no ve el plan contratado');
select ok(not has_table_privilege('authenticated', 'public.orders', 'truncate'), 'nadie del panel puede vaciar tablas');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), 3, 'anon solo ejecuta track_order, stock_status y ordering_status (D61)');

select * from finish();
rollback;
