-- JP Smoke · F10 · Endurecimiento final (revisión de seguridad 2026-11-01, docs/seguridad/revision-2026-11-01.md).
-- Supabase da a anon todos los privilegios de tabla y deja a RLS como única barrera. Defensa en profundidad:
-- anon queda solo con SELECT de lo que el sitio publica, sin columnas internas (plan, nivel de protección,
-- modo de WhatsApp). Los pedidos siguen entrando solo por la Edge Function (service_role → place_order).

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Lo que se cree después tampoco nace abierto para anon.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

grant select (id, slug, name, active, order_prefix) on public.restaurants to anon;
grant select (restaurant_id, brand, hero, sections, channels, blocks, whatsapp, instagram, tiktok, hours,
  delivery_min, delivery_eta, intro_mode, accepting_orders, store_open, store_address, store_maps_url,
  store_hours, pickup_enabled, published_at, site_url) on public.restaurant_settings to anon;
grant select on public.categories, public.products, public.delivery_zones, public.payment_methods,
  public.events, public.reviews to anon;
grant select (id, restaurant_id, code, kind, value, min_total, title, detail, ends_on) on public.coupons to anon;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
