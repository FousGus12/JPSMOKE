-- =============================================================================
-- JP Smoke · v0.19.1: correcciones de la revisión final (Fable).
-- D65: retirar la autorización de promociones desde el panel (con auditoría); Clientes muestra si está vigente;
--      la exportación devuelve un único jsonb (sin el tope de filas de PostgREST).
-- D64: una venta casada con un pedido manual que se anuló vuelve a sumar en Plataformas.
-- D60: Cancelados de hoy por fecha del evento de cancelación, sin la ventana de 36 h del tablero.
-- =============================================================================

create or replace function public.customers_list(p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if rid is null or not public.is_admin_of(rid) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with base as (
      select c.id, c.name, c.phone, c.trusted, c.blocked, c.notes, c.created_at,
        (select count(*) from public.orders o where o.customer_id = c.id and o.status <> 'cancelado') orders,
        (select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = c.id and o.status = 'entregado') spent,
        (select max(o.created_at) from public.orders o where o.customer_id = c.id) last_order,
        coalesce((select k.granted from public.consents k where k.restaurant_id = rid and k.kind = 'promociones' and k.phone = c.phone
                  order by k.at desc, k.id desc limit 1), false) promos
      from public.customers c
      where c.restaurant_id = rid
        and (q is null or c.name ilike '%' || q || '%'
             or (regexp_replace(q, '\D', '', 'g') <> '' and c.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%'))
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', (select coalesce(jsonb_agg(to_jsonb(b) order by b.last_order desc nulls last), '[]') from (
        select * from base order by last_order desc nulls last
        limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) b))
  );
end;
$$;

-- Retirar la autorización de promociones de un cliente (solo admin). Queda en consents y en auditoría.
create function public.revoke_promos(p_customer uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or not public.is_admin_of(c.restaurant_id) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  insert into public.consents (restaurant_id, phone, kind, version, granted, source)
  values (c.restaurant_id, c.phone, 'promociones', 'retiro', false, 'panel');
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values (c.restaurant_id, auth.uid(), 'retirar promociones', 'customers', c.id::text, jsonb_build_object('celular', '••••' || right(c.phone, 4)));
end;
$$;
grant execute on function public.revoke_promos(uuid) to authenticated;

-- Exportación en un solo jsonb (PostgREST corta los conjuntos en max_rows).
drop function public.customers_promo_export();
create function public.customers_promo_export() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  out jsonb;
begin
  if rid is null or not public.is_admin_of(rid) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  with last as (
    select distinct on (k.phone) k.phone, k.granted, k.at from public.consents k
    where k.restaurant_id = rid and k.kind = 'promociones'
    order by k.phone, k.at desc, k.id desc)
  select coalesce(jsonb_agg(jsonb_build_object('nombre', c.name, 'celular', c.phone, 'autorizado_el', l.at,
      'pedidos', (select count(*) from public.orders o where o.customer_id = c.id and o.status <> 'cancelado'),
      'ultimo_pedido', (select max(o.created_at) from public.orders o where o.customer_id = c.id)) order by c.name), '[]')
  into out
  from last l join public.customers c on c.restaurant_id = rid and c.phone = l.phone
  where l.granted and not c.blocked;
  insert into public.audit_log (restaurant_id, actor, action, entity, detail)
  values (rid, auth.uid(), 'exportar', 'clientes', jsonb_build_object('filas', jsonb_array_length(out), 'tipo', 'promociones'));
  return out;
end;
$$;
grant execute on function public.customers_promo_export() to authenticated;

create or replace function public.external_sales_summary(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  days integer := greatest(1, least(coalesce(p_days, 30), 366));
  since timestamptz := private.bogota_day_start(days - 1);
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with e as (select * from public.external_sales where restaurant_id = rid and sold_at >= since),
    -- Una venta casada con un pedido manual que luego se anuló vuelve a contar como venta de plataforma.
    m as (select e.* from e join public.orders o on o.id = e.matched_order_id where o.status <> 'cancelado'),
    u as (select * from e where matched_order_id is null
          or not exists (select 1 from public.orders o where o.id = e.matched_order_id and o.status <> 'cancelado'))
    select jsonb_build_object(
      'days', days,
      'total', coalesce((select sum(total) from u), 0),
      'commission', coalesce((select sum(commission) from u), 0),
      'orders', (select count(*) from u),
      'matched', (select count(*) from m),
      'matched_total', coalesce((select sum(total) from m), 0),
      'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('key', channel, 'total', t, 'orders', c) order by t desc), '[]')
                     from (select channel, sum(total) t, count(*) c from u group by 1) x),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', sold_on, 'total', t, 'orders', c) order by sold_on), '[]')
                 from (select sold_on, sum(total) t, count(*) c from u group by 1) x),
      'batches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'channel', b.channel, 'file', b.file_name,
                    'at', b.created_at, 'inserted', b.inserted, 'repeated', b.repeated, 'matched', b.matched, 'errors', b.errors,
                    'by', coalesce(s.full_name, 'Cuenta eliminada')) order by b.created_at desc), '[]')
                  from (select * from public.import_batches ib where ib.restaurant_id = rid order by ib.created_at desc limit 20) b
                  left join public.staff s on s.user_id = b.created_by)
    )
  );
end;
$$;

-- Cancelados de hoy (día de Bogotá) por fecha del evento de cancelación, para todo el equipo.
create function public.cancelled_today() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  today timestamptz := date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
begin
  if rid is null or not public.is_staff_of(rid) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'total', o.total, 'customer_name', o.customer_name,
        'cancel_reason', o.cancel_reason, 'cancel_public', o.cancel_public, 'voided_from', o.voided_from,
        'supplies_restored', o.supplies_restored, 'is_test', o.is_test, 'at', e.at,
        'by', coalesce(s.full_name, case when e.by_user is null then 'Sistema' else 'Cuenta eliminada' end)) order by e.at desc), '[]')
    from public.orders o
    join lateral (select x.at, x.by_user from public.order_events x where x.order_id = o.id and x.status = 'cancelado'
                  order by x.at desc limit 1) e on true
    left join public.staff s on s.user_id = e.by_user
    where o.restaurant_id = rid and o.status = 'cancelado' and e.at >= today
  );
end;
$$;
grant execute on function public.cancelled_today() to authenticated;

-- Cierre (regla del proyecto).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
grant execute on function public.ordering_status(text) to anon, authenticated;
