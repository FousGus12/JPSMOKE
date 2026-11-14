#!/usr/bin/env bash
# Prueba de pedidos simultáneos (D30) contra la base LOCAL: queda 1 gaseosa y dos clientes la piden al tiempo.
# Debe pasar exactamente uno; el otro recibe "agotado" y el stock nunca queda negativo.
# Segunda parte (auditoría 2026-11-02): dos pedidos con un cupón de un solo uso; solo uno lleva descuento.
set -euo pipefail
DB="postgresql://postgres:postgres@127.0.0.1:57322/postgres"
q() { psql "$DB" -Atqc "$1"; }
q "delete from public.restaurants where slug = 'simul-a'"
q "insert into public.restaurants (id, slug, name, order_prefix) values ('19000000-0000-4000-8000-000000000001', 'simul-a', 'Simultáneos', 'SI');
   insert into public.restaurant_settings (restaurant_id) values ('19000000-0000-4000-8000-000000000001');
   insert into public.categories (id, restaurant_id, slug, name) values ('39000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'bebidas', 'Bebidas');
   insert into public.products (id, restaurant_id, category_id, slug, name, price) values ('59000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', 'gaseosa', 'Gaseosa', 5000);
   insert into public.supplies (id, restaurant_id, name, unit, purchase_unit, stock) values ('69000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'Gaseosa', 'unidad', 'paca', 1);
   insert into public.recipes (product_id, supply_id, restaurant_id, qty) values ('59000000-0000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 1);
   insert into public.delivery_zones (id, restaurant_id, name, fee) values ('79000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'Zona A', 0);
   insert into public.payment_methods (restaurant_id, code, label) values ('19000000-0000-4000-8000-000000000001', 'nequi', 'Nequi');"
order() { # $1 celular, $2 segundos que la transacción queda abierta después de pedir
  psql "$DB" -Atq <<SQL
begin;
select public.place_order(jsonb_build_object('restaurant', 'simul-a', 'token', 'token-simultaneo-$1',
  'customer', jsonb_build_object('name', 'Cliente', 'phone', '$1', 'address', 'Calle 1 # 2-3', 'zone_id', '79000000-0000-4000-8000-000000000001'),
  'payment_code', 'nequi', 'items', '[{"product_id":"59000000-0000-4000-8000-000000000001","qty":1}]'::jsonb)) ->> 'ok';
select pg_sleep($2);
commit;
SQL
}
TMP=$(mktemp -d)
order 3101111111 2 > "$TMP/a" &   # el primero toma la gaseosa y tarda en confirmar
sleep 0.4
order 3102222222 0 > "$TMP/b" &   # el segundo llega mientras el primero no ha terminado
wait
A=$(head -1 "$TMP/a"); B=$(head -1 "$TMP/b"); STOCK=$(q "select stock from public.supplies where id = '69000000-0000-4000-8000-000000000001'")
ORDERS=$(q "select count(*) from public.orders where restaurant_id = '19000000-0000-4000-8000-000000000001'")
q "delete from public.restaurants where slug = 'simul-a'"
rm -rf "$TMP"
if [ "$A" = "true" ] && [ "$B" = "false" ] && [ "$ORDERS" = "1" ] && [ "$STOCK" = "0.00" ]; then
  echo "pedidos simultáneos: 1 de 2 pasó, stock 0, sin negativos"
else
  echo "FALLÓ: primero=$A segundo=$B pedidos=$ORDERS stock=$STOCK"; exit 1
fi

# --- Cupón de un solo uso pedido al tiempo -----------------------------------
q "delete from public.restaurants where slug = 'simul-c'"
q "insert into public.restaurants (id, slug, name, order_prefix) values ('19000000-0000-4000-8000-000000000002', 'simul-c', 'Cupón simultáneo', 'SC');
   insert into public.restaurant_settings (restaurant_id) values ('19000000-0000-4000-8000-000000000002');
   insert into public.categories (id, restaurant_id, slug, name) values ('39000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000002', 'burgers', 'Burgers');
   insert into public.products (id, restaurant_id, category_id, slug, name, price) values ('59000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000002', '39000000-0000-4000-8000-000000000002', 'burger', 'Burger', 30000);
   insert into public.delivery_zones (id, restaurant_id, name, fee) values ('79000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000002', 'Zona A', 0);
   insert into public.payment_methods (restaurant_id, code, label) values ('19000000-0000-4000-8000-000000000002', 'nequi', 'Nequi');
   insert into public.coupons (restaurant_id, code, kind, value, max_uses, title) values ('19000000-0000-4000-8000-000000000002', 'UNICO', 'valor', 5000, 1, 'Cupón único');"
coupon_order() {
  psql "$DB" -Atq <<SQL
begin;
select public.place_order(jsonb_build_object('restaurant', 'simul-c', 'token', 'token-cupon-simul-$1', 'coupon', 'UNICO',
  'customer', jsonb_build_object('name', 'Cliente', 'phone', '$1', 'address', 'Calle 1 # 2-3', 'barrio', 'Centro', 'zone_id', '79000000-0000-4000-8000-000000000002'),
  'payment_code', 'nequi', 'items', '[{"product_id":"59000000-0000-4000-8000-000000000002","qty":1}]'::jsonb)) ->> 'ok';
select pg_sleep($2);
commit;
SQL
}
TMP=$(mktemp -d)
coupon_order 3103333331 2 > "$TMP/a" &
sleep 0.4
coupon_order 3103333332 0 > "$TMP/b" &
wait
USES=$(q "select uses from public.coupons where restaurant_id = '19000000-0000-4000-8000-000000000002'")
DISC=$(q "select count(*) from public.orders where restaurant_id = '19000000-0000-4000-8000-000000000002' and discount > 0")
q "delete from public.restaurants where slug = 'simul-c'"
rm -rf "$TMP"
if [ "$USES" = "1" ] && [ "$DISC" = "1" ]; then
  echo "cupón de un solo uso al tiempo: 1 descuento, usos 1"
else
  echo "FALLÓ cupón simultáneo: usos=$USES pedidos_con_descuento=$DISC"; exit 1
fi
