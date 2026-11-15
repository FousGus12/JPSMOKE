-- =============================================================================
-- JP Smoke · datos del restaurante (D24). Idempotente: sirve de seed local y para cargar
-- el restaurante en el Supabase remoto el día de la publicación (D25). Generado desde el mockup.
-- Fotos: rutas del bucket `carta`; se suben al montar Storage.
-- =============================================================================
begin;
insert into public.restaurants (id, slug, name, plan, order_prefix) values ('00000000-0000-4000-8000-0000000000a1', 'jp-smoke', 'JP Smoke', 'completo', 'JP')
on conflict (id) do update set name = excluded.name, order_prefix = excluded.order_prefix;

insert into public.restaurant_settings (restaurant_id, brand, hero, sections, channels, whatsapp, instagram, tiktok, hours, delivery_min, delivery_eta, intro_mode, protection)
values ('00000000-0000-4000-8000-0000000000a1',
  '{"direction":"vino","accent":"#e10600","bg":"#260212","surface":"#4f0423","display":"Bebas Neue","body":"Inter"}'::jsonb,
  '{"title":"JP Smoke","kicker":"Hamburguesas al barril · Bogotá","text":"Carne ahumada lento en barril, con leña y paciencia. Llega a tu puerta todavía oliendo a humo."}'::jsonb, '{"eventos":true,"arsenal":true,"carta":true,"promos":true,"tour":true,"resenas":true,"cobertura":true}'::jsonb, '{"rappi":{"visible":false,"url":"https://www.rappi.com.co/"},"didi":{"visible":false,"url":"https://web.didi-food.com/"}}'::jsonb,
  '573001234567', '@jpsmoke.bta', '@jpsmoke.bta', '[["Lunes a miércoles","12:00 m. – 9:00 p. m."],["Jueves a sábado","12:00 m. – 11:00 p. m."],["Domingo y festivos","12:00 m. – 8:00 p. m."]]'::jsonb, 25000, '35–50 min', 'completa', 'recomendada')
on conflict (restaurant_id) do nothing;

insert into public.categories (restaurant_id, slug, name, emoji, note, position) values
  ('00000000-0000-4000-8000-0000000000a1', 'burgers', 'Burgers al barril', '🍔', 'Precio sola / combo (papas + gaseosa)', 0),
  ('00000000-0000-4000-8000-0000000000a1', 'costillas', 'Costillas y platos', '🔥', 'Acompañamientos incluidos', 1),
  ('00000000-0000-4000-8000-0000000000a1', 'perros', 'Perros', '🌭', 'Precio solo / combo', 2),
  ('00000000-0000-4000-8000-0000000000a1', 'papas', 'Papas y salchipapas', '🍟', 'Para compartir', 3),
  ('00000000-0000-4000-8000-0000000000a1', 'arepas', 'Arepas', '🫓', null, 4),
  ('00000000-0000-4000-8000-0000000000a1', 'bebidas', 'Bebidas', '🥤', null, 5),
  ('00000000-0000-4000-8000-0000000000a1', 'adicionales', 'Adicionales', '➕', 'Súmalos a cualquier plato', 6)
on conflict (restaurant_id, slug) do nothing;
-- Adiciones ligadas a un plato (D40).
update public.categories set is_addons = true
where restaurant_id = '00000000-0000-4000-8000-0000000000a1' and slug = 'adicionales';

insert into public.products (restaurant_id, category_id, slug, name, badge, description, price, combo_price, image_path, available, featured, hero, position)
select '00000000-0000-4000-8000-0000000000a1', c.id, v.slug, v.name, v.badge, v.description, v.price, v.combo, v.img, v.available, v.featured, v.hero, v.pos
from (values
  ('burgers', 'la-ahumadora', 'La Ahumadora', 'La más pedida', 'Doble carne ahumada 12 h al barril, cheddar fundido, tocineta crocante, cebolla caramelizada y salsa JP.', 32000, 41000, 'productos/burger-doble.webp', true, true, true, 0),
  ('burgers', 'pulled-jp', 'Pulled JP', 'Ahumada al barril', 'Cerdo desmechado ahumado lento, coleslaw de la casa, pepinillos y BBQ de panela en pan brioche.', 31000, 40000, 'productos/burger-desmechada.webp', true, true, true, 1),
  ('burgers', 'barril-negro', 'Barril Negro', 'Pan de carbón', 'Carne de 180 g, queso costeño fundido, chimichurri ahumado y plátano maduro en pan negro.', 30000, 39000, 'productos/burger-negra.webp', true, true, false, 2),
  ('burgers', 'tocinazo', 'Tocinazo', 'Triple tocineta', 'Carne de 150 g, triple tocineta, cheddar, cebolla crispy y mayonesa de chipotle.', 29000, 38000, 'productos/burger-tocineta.webp', true, false, false, 3),
  ('burgers', 'doble-humo', 'Doble Humo', 'Smash x2', 'Dos carnes smash con costra, doble americano, pepinillos y salsa de la casa.', 34000, 43000, 'productos/burger-doble-carne.webp', true, true, false, 4),
  ('burgers', 'la-clasica', 'La Clásica', 'Sin vueltas', 'Carne de 150 g, queso, lechuga, tomate, cebolla y salsa JP.', 22000, 31000, 'productos/burger-clasica.webp', true, false, false, 5),
  ('costillas', 'costillas-barril', 'Costillas al barril', 'Medio costillar', 'Costillas de cerdo ahumadas 6 h, glaseadas en BBQ de panela, con papas y ensalada.', 42000, null::integer, 'productos/costillas.webp', true, true, true, 6),
  ('costillas', 'picada-tribu', 'Picada de la Tribu', 'Para 2 o más', '600 g de poder: costillas, bondiola, chorizo artesanal, chicharrón, papas criollas y arepitas.', 68000, null::integer, 'productos/costillas-parrilla.webp', true, true, false, 7),
  ('perros', 'perro-humo', 'Perro Humo', 'Clásico bogotano', 'Salchicha americana ahumada, tocineta, queso, papa ripio y salsas de la casa.', 19000, 28000, 'productos/perro.webp', true, false, false, 8),
  ('perros', 'perro-cargado', 'Perro Cargado', 'Carne a elección', 'Salchicha + 140 g de cerdo desmechado o carne ahumada, piña, queso gratinado y maíz.', 24000, 33000, 'productos/perros-cargados.webp', true, true, false, 9),
  ('papas', 'papas-jp', 'Papas JP cargadas', 'La monstruosa', 'Papa en casco, cerdo desmechado, cheddar fundido, tocineta, cebollín y salsa de ajo.', 26000, null::integer, 'productos/papas-cargadas.webp', true, true, true, 10),
  ('papas', 'salchipapa-barril', 'Salchipapa del barril', 'Para compartir', 'Doble papa, salchicha y chorizo ahumado, tocineta, queso y salsas.', 28000, null::integer, 'productos/papas-tocineta.webp', true, false, false, 11),
  ('arepas', 'arepa-costilla', 'Arepa de costilla', 'Rellena', 'Arepa de maíz peto rellena de costilla desmechada, queso doble crema y hogao.', 21000, 30000, 'productos/arepa.webp', true, false, false, 12),
  ('bebidas', 'gaseosa-400', 'Gaseosa 400 ml', null, 'Coca-Cola, Sprite o Quatro.', 5000, null::integer, 'productos/gaseosa.webp', true, false, false, 13),
  ('bebidas', 'gaseosa-15', 'Gaseosa 1,5 L', 'Para la mesa', 'Ideal para la picada.', 9000, null::integer, 'productos/gaseosas.webp', true, false, false, 14),
  ('bebidas', 'limonada-panela', 'Limonada de panela', 'De la casa', 'Panela, limón y hierbabuena. 500 ml.', 7000, null::integer, 'productos/gaseosa.webp', false, false, false, 15),
  ('adicionales', 'add-tocineta', 'Tocineta', null, '2 tiras', 4000, null::integer, null, true, false, false, 16),
  ('adicionales', 'add-queso', 'Queso extra', null, 'Cheddar o costeño', 3000, null::integer, null, true, false, false, 17),
  ('adicionales', 'add-carne', 'Carne ahumada 150 g', null, '', 9000, null::integer, null, true, false, false, 18),
  ('adicionales', 'add-papas', 'Porción de papas', null, '', 8000, null::integer, null, true, false, false, 19),
  ('adicionales', 'add-huevo', 'Huevo frito', null, '', 2000, null::integer, null, true, false, false, 20)
) as v(cat, slug, name, badge, description, price, combo, img, available, featured, hero, pos)
join public.categories c on c.restaurant_id = '00000000-0000-4000-8000-0000000000a1' and c.slug = v.cat
on conflict (restaurant_id, slug) do nothing;

insert into public.delivery_zones (restaurant_id, name, fee, active, position) values
  ('00000000-0000-4000-8000-0000000000a1', 'Engativá', 5000, true, 0),
  ('00000000-0000-4000-8000-0000000000a1', 'Barrios Unidos', 5000, true, 1),
  ('00000000-0000-4000-8000-0000000000a1', 'Teusaquillo', 6000, true, 2),
  ('00000000-0000-4000-8000-0000000000a1', 'Suba', 7000, true, 3),
  ('00000000-0000-4000-8000-0000000000a1', 'Fontibón', 7000, true, 4),
  ('00000000-0000-4000-8000-0000000000a1', 'Chapinero', 8000, true, 5),
  ('00000000-0000-4000-8000-0000000000a1', 'Kennedy', 8000, false, 6)
on conflict (restaurant_id, name) do nothing;

insert into public.payment_methods (restaurant_id, code, label, asks_change, position) values
  ('00000000-0000-4000-8000-0000000000a1', 'efectivo', 'Efectivo', true, 0),
  ('00000000-0000-4000-8000-0000000000a1', 'nequi', 'Nequi', false, 1),
  ('00000000-0000-4000-8000-0000000000a1', 'daviplata', 'Daviplata', false, 2),
  ('00000000-0000-4000-8000-0000000000a1', 'transferencia', 'Transferencia', false, 3),
  ('00000000-0000-4000-8000-0000000000a1', 'datafono', 'Datáfono', false, 4)
on conflict (restaurant_id, code) do nothing;

insert into public.coupons (restaurant_id, code, kind, value, min_total, title, detail, visible, active, ends_on, max_uses) values
  ('00000000-0000-4000-8000-0000000000a1', 'HUMO20', 'porcentaje', 20, 40000, '20% de inauguración', 'En pedidos desde $40.000. Un uso por celular.', true, true, '2026-11-30', 300),
  ('00000000-0000-4000-8000-0000000000a1', 'ENVIOGRATIS', 'envio', 0, 60000, 'Domicilio gratis', 'En pedidos desde $60.000.', true, true, '2026-12-31', null),
  ('00000000-0000-4000-8000-0000000000a1', 'FRIOBOGOTA', 'regalo', 7000, 50000, 'Limonada de panela de cortesía', 'Jueves a sábado después de las 7 p. m.', false, true, '2026-12-31', null),
  ('00000000-0000-4000-8000-0000000000a1', 'BIENVENIDA10', 'porcentaje', 10, 25000, '10% en tu primer pedido', 'Se entrega con el aviso de bienvenida.', false, true, '2026-12-31', null),
  ('00000000-0000-4000-8000-0000000000a1', 'COMBOJP', 'valor', 5000, 30000, '$5.000 en combos', 'Cupón secreto para clientes recurrentes.', false, false, '2026-12-15', 100)
on conflict (restaurant_id, code) do nothing;

insert into public.events (restaurant_id, title, kicker, body, image_path, cta_label, cta_href, show_intro, show_strip, show_section, captures_leads, coupon_id, starts_on, ends_on, position)
select '00000000-0000-4000-8000-0000000000a1', v.title, v.kicker, v.body, v.img, v.cta, v.href, v.intro, v.strip, v.section, v.capture, cp.id, v.f::date, v.t::date, v.pos
from (values
  ('Gran apertura JP Smoke', 'Sábado 15 de noviembre', 'Encendemos los barriles. 20% en toda la carta con el código HUMO20 y sorpresas en cada pedido.', 'eventos/fuego.webp', 'Pedir con 20%', '#carta', true, true, true, true, 'BIENVENIDA10', '2026-11-01', '2026-11-30', 0),
  ('Jueves de costilla', 'Todos los jueves', 'Medio costillar + gaseosa a $45.000.', 'eventos/costillas.webp', 'Ver costillas', '#carta', false, true, true, false, null, '2026-11-01', '2026-12-31', 1),
  ('Punto físico en camino', 'Próximamente', 'Estamos montando el templo del humo. Muy pronto podrás venir por tu burger.', 'eventos/humo.webp', 'Avísame', '#cobertura', false, false, true, false, null, '2026-11-01', '2027-03-01', 2)
) as v(title, kicker, body, img, cta, href, intro, strip, section, capture, coupon, f, t, pos)
left join public.coupons cp on cp.restaurant_id = '00000000-0000-4000-8000-0000000000a1' and cp.code = v.coupon::extensions.citext
where not exists (select 1 from public.events e where e.restaurant_id = '00000000-0000-4000-8000-0000000000a1' and e.title = v.title);

-- Bloques editables (F6): promo destacada y JP on Tour.
update public.restaurant_settings set blocks = '{
  "promo": {"visible": true, "tag": "Boleto dorado", "title": "El frío bogotano se corta con fuego",
    "text": "Jueves a sábado después de las 7 p. m.: limonada de panela de cortesía en pedidos desde $50.000.",
    "cta": "Reclamar mi promoción", "coupon": "FRIOBOGOTA", "image": "sitio/brasas.webp"},
  "tour": {"kicker": "JP on Tour", "title": "Llevamos el barril",
    "text": "¿Cumpleaños, empresa o fiesta en casa? Montamos el barril en vivo y cocinamos frente a tus invitados.",
    "cards": [{"title": "Catering al barril", "text": "Desde 20 personas. Burgers, costillas y picadas."},
              {"title": "Pedido corporativo", "text": "Almuerzos para equipos con factura electrónica."}],
    "image": "sitio/costillas-parrilla.webp"}
}'::jsonb
where restaurant_id = '00000000-0000-4000-8000-0000000000a1' and blocks = '{}'::jsonb;

-- WhatsApp (F9): en modo prueba hasta tener credenciales de Meta y aprobación (D32).
update public.restaurant_settings set whatsapp_mode = 'prueba' where restaurant_id = '00000000-0000-4000-8000-0000000000a1' and whatsapp_mode = 'manual';

-- Inventario de insumos (D30). Stock inicial de ejemplo; se corrige con un conteo en el panel.
insert into public.supplies (restaurant_id, name, unit, purchase_unit, per_purchase, stock, min_stock, position) values
  ('00000000-0000-4000-8000-0000000000a1', 'Pan brioche', 'pan', 'paquete', 12, 48, 12, 0),
  ('00000000-0000-4000-8000-0000000000a1', 'Pan negro', 'pan', 'paquete', 12, 24, 6, 1),
  ('00000000-0000-4000-8000-0000000000a1', 'Carne de res 150 g', 'porción', 'caja', 50, 60, 15, 2),
  ('00000000-0000-4000-8000-0000000000a1', 'Cerdo desmechado', 'porción', 'bolsa', 20, 30, 8, 3),
  ('00000000-0000-4000-8000-0000000000a1', 'Costilla', 'porción', 'costillar', 2, 16, 4, 4),
  ('00000000-0000-4000-8000-0000000000a1', 'Tocineta', 'tira', 'paquete', 20, 80, 20, 5),
  ('00000000-0000-4000-8000-0000000000a1', 'Queso cheddar', 'tajada', 'paquete', 30, 90, 20, 6),
  ('00000000-0000-4000-8000-0000000000a1', 'Lechuga', 'hoja', 'lechuga', 12, 36, 12, 7),
  ('00000000-0000-4000-8000-0000000000a1', 'Tomate', 'rodaja', 'tomate', 8, 40, 8, 8),
  ('00000000-0000-4000-8000-0000000000a1', 'Cebolla', 'porción', 'cebolla', 10, 40, 10, 9),
  ('00000000-0000-4000-8000-0000000000a1', 'Papa a la francesa', 'porción', 'bulto', 40, 80, 20, 10),
  ('00000000-0000-4000-8000-0000000000a1', 'Salchicha americana', 'unidad', 'paquete', 10, 30, 10, 11),
  ('00000000-0000-4000-8000-0000000000a1', 'Arepa de maíz peto', 'unidad', 'paquete', 10, 20, 5, 12),
  ('00000000-0000-4000-8000-0000000000a1', 'Gaseosa 400 ml', 'unidad', 'paca', 12, 36, 12, 13),
  ('00000000-0000-4000-8000-0000000000a1', 'Gaseosa 1,5 L', 'unidad', 'paca', 6, 12, 3, 14)
on conflict (restaurant_id, name) do nothing;

insert into public.recipes (product_id, supply_id, restaurant_id, qty, combo_only)
select p.id, s.id, p.restaurant_id, v.qty, v.combo
from (values
  ('la-ahumadora', 'Pan brioche', 1, false), ('la-ahumadora', 'Carne de res 150 g', 2, false), ('la-ahumadora', 'Queso cheddar', 2, false),
  ('la-ahumadora', 'Tocineta', 2, false), ('la-ahumadora', 'Cebolla', 1, false),
  ('pulled-jp', 'Pan brioche', 1, false), ('pulled-jp', 'Cerdo desmechado', 1, false),
  ('barril-negro', 'Pan negro', 1, false), ('barril-negro', 'Carne de res 150 g', 1, false),
  ('tocinazo', 'Pan brioche', 1, false), ('tocinazo', 'Carne de res 150 g', 1, false), ('tocinazo', 'Tocineta', 3, false), ('tocinazo', 'Queso cheddar', 1, false),
  ('doble-humo', 'Pan brioche', 1, false), ('doble-humo', 'Carne de res 150 g', 2, false), ('doble-humo', 'Queso cheddar', 2, false),
  ('la-clasica', 'Pan brioche', 1, false), ('la-clasica', 'Carne de res 150 g', 1, false), ('la-clasica', 'Queso cheddar', 1, false),
  ('la-clasica', 'Lechuga', 1, false), ('la-clasica', 'Tomate', 2, false), ('la-clasica', 'Cebolla', 1, false),
  ('costillas-barril', 'Costilla', 1, false), ('costillas-barril', 'Papa a la francesa', 1, false),
  ('picada-tribu', 'Costilla', 1, false), ('picada-tribu', 'Cerdo desmechado', 1, false), ('picada-tribu', 'Papa a la francesa', 2, false),
  ('perro-humo', 'Salchicha americana', 1, false), ('perro-humo', 'Tocineta', 1, false),
  ('perro-cargado', 'Salchicha americana', 1, false), ('perro-cargado', 'Cerdo desmechado', 1, false),
  ('papas-jp', 'Papa a la francesa', 2, false), ('papas-jp', 'Cerdo desmechado', 1, false), ('papas-jp', 'Tocineta', 1, false),
  ('salchipapa-barril', 'Papa a la francesa', 2, false), ('salchipapa-barril', 'Salchicha americana', 1, false),
  ('arepa-costilla', 'Arepa de maíz peto', 1, false), ('arepa-costilla', 'Costilla', 1, false),
  ('gaseosa-400', 'Gaseosa 400 ml', 1, false), ('gaseosa-15', 'Gaseosa 1,5 L', 1, false),
  ('add-tocineta', 'Tocineta', 2, false), ('add-queso', 'Queso cheddar', 1, false), ('add-carne', 'Carne de res 150 g', 1, false),
  ('add-papas', 'Papa a la francesa', 1, false)
) as v(product, supply, qty, combo)
join public.products p on p.restaurant_id = '00000000-0000-4000-8000-0000000000a1' and p.slug = v.product
join public.supplies s on s.restaurant_id = p.restaurant_id and s.name = v.supply
on conflict do nothing;

-- Todo combo suma papas y gaseosa 400 ml.
insert into public.recipes (product_id, supply_id, restaurant_id, qty, combo_only)
select p.id, s.id, p.restaurant_id, 1, true
from public.products p join public.supplies s on s.restaurant_id = p.restaurant_id and s.name in ('Papa a la francesa', 'Gaseosa 400 ml')
where p.restaurant_id = '00000000-0000-4000-8000-0000000000a1' and p.combo_price is not null
on conflict do nothing;

commit;
