-- JP Smoke · WhatsApp (F9, D32): qué se encola según el modo, quién lo ve y quién lo despacha.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.restaurants (id, slug, name, order_prefix) values ('1a000000-0000-4000-8000-000000000001', 'wa-a', 'WA A', 'WA');
insert into public.restaurant_settings (restaurant_id, whatsapp, whatsapp_mode) values ('1a000000-0000-4000-8000-000000000001', '573001234567', 'manual');
insert into auth.users (id, email, raw_app_meta_data) values
  ('2a000000-0000-4000-8000-00000000000a', 'adm@wa.test', '{"role":"admin","restaurant_id":"1a000000-0000-4000-8000-000000000001"}'),
  ('2a000000-0000-4000-8000-00000000000c', 'ope@wa.test', '{"role":"operador","restaurant_id":"1a000000-0000-4000-8000-000000000001"}');
create function pg_temp.order(n int, channel text) returns uuid language sql as $$
  insert into public.orders (restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total, channel)
  values ('1a000000-0000-4000-8000-000000000001', n, 'WA-' || lpad(n::text, 4, '0'), 'x', 'Ana Pérez', '3105551234', 'Calle 1 # 2-3', 'Zona A', 'Nequi', 30000, 30000, channel::public.order_channel)
  returning id
$$;
create function pg_temp.queued() returns int language sql as $$
  select count(*)::int from public.whatsapp_messages where restaurant_id = '1a000000-0000-4000-8000-000000000001'
$$;

select pg_temp.order(1, 'web');
select is(pg_temp.queued(), 0, 'modo manual: no se encola nada');
update public.restaurant_settings set whatsapp_mode = 'prueba' where restaurant_id = '1a000000-0000-4000-8000-000000000001';
select pg_temp.order(2, 'web');
select is((select array_agg(kind::text order by kind) from public.whatsapp_messages where restaurant_id = '1a000000-0000-4000-8000-000000000001'),
  array['pedido_recibido', 'aviso_negocio'], 'pedido web: confirmación al cliente y aviso al negocio');
select pg_temp.order(3, 'manual');
select is(pg_temp.queued(), 2, 'pedido manual (ya habló con el negocio): no se le escribe');
update public.orders set status = 'en_camino' where code = 'WA-0002' and restaurant_id = '1a000000-0000-4000-8000-000000000001';
update public.orders set status = 'en_camino' where code = 'WA-0002' and restaurant_id = '1a000000-0000-4000-8000-000000000001';
select is(pg_temp.queued(), 3, '"va en camino" sale una sola vez');

select ok(not has_function_privilege('authenticated', 'public.whatsapp_claim(integer)', 'execute'), 'el navegador no despacha mensajes');
select ok(jsonb_array_length(public.whatsapp_claim(10)) >= 3, 'el servidor toma la cola');
select is((select count(*)::int from public.whatsapp_messages where restaurant_id = '1a000000-0000-4000-8000-000000000001' and claimed_at is null), 0,
  'lo tomado queda marcado (otro despacho no lo repite)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2a000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select is(pg_temp.queued(), 3, 'el admin ve el registro de mensajes');
select set_config('request.jwt.claims', '{"sub":"2a000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select is(pg_temp.queued(), 0, 'el operador no');
reset role;

select * from finish();
rollback;
