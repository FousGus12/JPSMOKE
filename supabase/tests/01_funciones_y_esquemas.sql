-- JP Smoke · Ninguna función con privilegios queda abierta sin sesión; el esquema private no se expone (lección de Pulso).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in ('track_order', 'stock_status', 'ordering_status')),
  0, 'anon no ejecuta funciones security definer, salvo track_order (D21), stock_status (solo ids agotados, D30) y ordering_status (D61)');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon no usa el esquema private');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated no usa el esquema private');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'toda función security definer fija su search_path');
select ok(not has_function_privilege('anon', 'public.place_order(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.place_order(jsonb)', 'execute'),
  'crear pedido web solo lo ejecuta el servidor (D9)');
select ok(not has_function_privilege('authenticated', 'public.track_order_by_phone(text, text, text)', 'execute'),
  'buscar por últimos 4 dígitos solo desde el servidor (con límite de intentos)');
select ok(not has_function_privilege('authenticated', 'public.rate_hit(text, integer, integer)', 'execute'), 'nadie del navegador toca los límites');
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'todas las tablas de public tienen RLS');

select * from finish();
rollback;
