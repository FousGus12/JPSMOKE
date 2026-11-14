-- JP Smoke · Lo que ve un visitante sin sesión: carta, ajustes, zonas, pagos activos, cupones visibles y eventos vigentes.
-- (El build del sitio lee esto con la clave pública; si una regla llama funciones del equipo, el sitio no compila.)
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.restaurants (id, slug, name, order_prefix) values ('13000000-0000-4000-8000-000000000001', 'pub-a', 'Pub A', 'PU');
insert into public.restaurant_settings (restaurant_id) values ('13000000-0000-4000-8000-000000000001');
insert into public.categories (id, restaurant_id, slug, name, visible) values
  ('33000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'si', 'Visible', true),
  ('33000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', 'no', 'Oculta', false);
insert into public.products (restaurant_id, category_id, slug, name, price, visible) values
  ('13000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 'p1', 'Visible', 1000, true),
  ('13000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 'p2', 'Oculto', 1000, false);
insert into public.payment_methods (restaurant_id, code, label, active) values
  ('13000000-0000-4000-8000-000000000001', 'nequi', 'Nequi', true), ('13000000-0000-4000-8000-000000000001', 'datafono', 'Datáfono', false);
insert into public.coupons (restaurant_id, code, kind, value, title, visible) values
  ('13000000-0000-4000-8000-000000000001', 'VISIBLE1', 'valor', 1000, 'Visible', true),
  ('13000000-0000-4000-8000-000000000001', 'SECRETO1', 'valor', 1000, 'Secreto', false);
insert into public.events (restaurant_id, title, starts_on, ends_on) values
  ('13000000-0000-4000-8000-000000000001', 'Vigente', current_date - 1, current_date + 1),
  ('13000000-0000-4000-8000-000000000001', 'Pasado', current_date - 10, current_date - 5);
insert into public.reviews (restaurant_id, author, stars, body, approved) values
  ('13000000-0000-4000-8000-000000000001', 'Ana', 5, 'Muy buena', true), ('13000000-0000-4000-8000-000000000001', 'Spam', 1, 'Pendiente', false);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select lives_ok($$ select * from public.products $$, 'anon lee la carta sin errores de permisos');
select is((select array_agg(slug) from public.categories where restaurant_id = '13000000-0000-4000-8000-000000000001'), array['si'], 'solo categorías visibles');
select is((select array_agg(slug) from public.products where restaurant_id = '13000000-0000-4000-8000-000000000001'), array['p1'], 'solo productos visibles');
select is((select array_agg(code) from public.payment_methods where restaurant_id = '13000000-0000-4000-8000-000000000001'), array['nequi'], 'solo medios de pago activos');
select is((select array_agg(code::text) from public.coupons where restaurant_id = '13000000-0000-4000-8000-000000000001'), array['VISIBLE1'], 'los cupones secretos no se ven');
select throws_ok($$ select uses from public.coupons $$, '42501', null, 'anon no ve cuántas veces se usó un cupón');
select is((select array_agg(title) from public.events where restaurant_id = '13000000-0000-4000-8000-000000000001'), array['Vigente'], 'solo eventos vigentes');
select is((select array_agg(author) from public.reviews where restaurant_id = '13000000-0000-4000-8000-000000000001'), array['Ana'], 'solo reseñas aprobadas');
select lives_ok($$ select hero, sections, accepting_orders, pickup_enabled from public.restaurant_settings $$, 'anon lee los ajustes públicos (solo columnas públicas, F10)');
reset role;

select * from finish();
rollback;
