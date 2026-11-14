-- JP Smoke · Editor (F6): fotos por carpeta de restaurante, cambios auditados, publicar solo admin y con pausa.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.restaurants (id, slug, name, order_prefix) values
  ('15000000-0000-4000-8000-000000000001', 'ed-a', 'Editor A', 'EA'), ('15000000-0000-4000-8000-000000000002', 'ed-b', 'Editor B', 'EB');
insert into public.restaurant_settings (restaurant_id) values ('15000000-0000-4000-8000-000000000001'), ('15000000-0000-4000-8000-000000000002');
insert into auth.users (id, email, raw_app_meta_data) values
  ('25000000-0000-4000-8000-00000000000a', 'adm@ed.test', '{"role":"admin","restaurant_id":"15000000-0000-4000-8000-000000000001"}'),
  ('25000000-0000-4000-8000-00000000000c', 'ope@ed.test', '{"role":"operador","restaurant_id":"15000000-0000-4000-8000-000000000001"}');
insert into public.categories (id, restaurant_id, slug, name) values ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'burgers', 'Burgers');
insert into public.products (id, restaurant_id, category_id, slug, name, price) values
  ('55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', 'b1', 'Burger', 30000);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('carta', '15000000-0000-4000-8000-000000000001/foto.webp') $$,
  'admin sube una foto en la carpeta de su restaurante');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('carta', '15000000-0000-4000-8000-000000000002/foto.webp') $$,
  '42501', null, 'admin no sube fotos en la carpeta de otro restaurante');
select lives_ok($$ update public.products set price = 31000, available = false where id = '55000000-0000-4000-8000-000000000001' $$, 'admin cambia precio y agotado');
select lives_ok($$ update public.restaurant_settings set blocks = '{"promo":{"title":"Nuevo"}}' where restaurant_id = '15000000-0000-4000-8000-000000000001' $$,
  'admin edita los bloques de la página');
select lives_ok($$ select public.publish_site() $$, 'admin publica');
select throws_ok($$ select public.publish_site() $$, 'P0001', null, 'no se puede publicar dos veces en el mismo minuto');

select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('carta', '15000000-0000-4000-8000-000000000001/otra.webp') $$,
  '42501', null, 'admin sin segundo paso no sube fotos');

select set_config('request.jwt.claims', '{"sub":"25000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('carta', '15000000-0000-4000-8000-000000000001/ope.webp') $$,
  '42501', null, 'operador no sube fotos');
select throws_ok($$ select public.publish_site() $$, '42501', null, 'operador no publica');
reset role;

select is((select detail ->> 'price' from public.audit_log where entity = 'products' and actor = '25000000-0000-4000-8000-00000000000a' order by at desc limit 1),
  '31000', 'el cambio de precio queda en la auditoría con quién lo hizo');
select is((select count(*)::int from public.audit_log where entity = 'restaurant_settings' and actor = '25000000-0000-4000-8000-00000000000a'),
  2, 'editar bloques y publicar quedan auditados');

select * from finish();
rollback;
