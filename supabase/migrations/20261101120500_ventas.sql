-- =============================================================================
-- JP Smoke · Ventas y estadísticas (F8): resumen por periodo con comparación,
-- exportar sin datos personales (auditado), cierre de caja (P10) e informe semanal (P11).
-- Solo admin con dos pasos. Días en America/Bogota.
-- =============================================================================

create function private.bogota_day_start(days_back integer) returns timestamptz
language sql stable set search_path = ''
as $$ select (date_trunc('day', now() at time zone 'America/Bogota') - make_interval(days => days_back)) at time zone 'America/Bogota' $$;

create or replace function public.sales_summary(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  days integer := greatest(1, least(coalesce(p_days, 30), 366));
  since timestamptz := private.bogota_day_start(days - 1);
  prev timestamptz := private.bogota_day_start(2 * days - 1);
begin
  if rid is null or public.my_role() <> 'admin' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where restaurant_id = rid and created_at >= since and status <> 'cancelado'),
    p as (select * from public.orders where restaurant_id = rid and created_at >= prev and created_at < since and status <> 'cancelado'),
    days_list as (select (generate_series(since at time zone 'America/Bogota', now() at time zone 'America/Bogota', interval '1 day'))::date d)
    select jsonb_build_object(
      'days', days,
      'total', coalesce((select sum(total) from o), 0),
      'orders', (select count(*) from o),
      'ticket', coalesce((select round(avg(total)) from o), 0),
      'previous_total', coalesce((select sum(total) from p), 0),
      'previous_orders', (select count(*) from p),
      'cancelled', (select count(*) from public.orders where restaurant_id = rid and created_at >= since and status = 'cancelado'),
      'discounts', coalesce((select sum(discount) from o), 0),
      'delivery_fees', coalesce((select sum(delivery_fee) from o), 0),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', dl.d, 'total', coalesce(x.t, 0), 'orders', coalesce(x.c, 0)) order by dl.d), '[]')
                 from days_list dl left join (select (created_at at time zone 'America/Bogota')::date d, sum(total) t, count(*) c from o group by 1) x on x.d = dl.d),
      'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('key', channel, 'total', t, 'orders', c) order by t desc), '[]')
                     from (select channel, sum(total) t, count(*) c from o group by 1) x),
      'by_payment', (select coalesce(jsonb_agg(jsonb_build_object('key', payment_label, 'total', t, 'orders', c) order by t desc), '[]')
                     from (select payment_label, sum(total) t, count(*) c from o group by 1) x),
      'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'orders', coalesce(c, 0)) order by h), '[]')
                  from generate_series(10, 23) h left join (select extract(hour from created_at at time zone 'America/Bogota')::int hr, count(*) c from o group by 1) x on x.hr = h),
      'top_products', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'total', t) order by t desc), '[]')
                       from (select i.name, sum(i.qty) q, sum(i.qty * i.unit_price) t from public.order_items i join o on o.id = i.order_id
                             group by 1 order by 3 desc limit 10) x),
      'customers', (select count(distinct customer_id) from o),
      'recurrent_pct', coalesce((select round(100.0 * count(*) filter (where n > 1) / nullif(count(*), 0)) from
                        (select o.customer_id, (select count(*) from public.orders y where y.customer_id = o.customer_id and y.status <> 'cancelado') n
                         from o where o.customer_id is not null group by o.customer_id) x), 0),
      'blocked', (select count(*) from public.blocked_attempts b where b.restaurant_id = rid and b.at >= since)
    )
  );
end;
$$;

-- Exportar (sin celular ni dirección: §7) y dejar constancia de quién exportó.
create function public.sales_export(p_days integer default 30) returns table (
  codigo text, fecha timestamptz, canal text, estado text, pago text, subtotal integer, descuento integer, domicilio integer, total integer, cupon text, productos text
)
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
begin
  if rid is null or public.my_role() <> 'admin' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, detail)
  values (rid, auth.uid(), 'exportar', 'ventas', jsonb_build_object('dias', p_days));
  return query
    select o.code, o.created_at, o.channel::text, o.status::text, o.payment_label, o.subtotal, o.discount, o.delivery_fee, o.total, o.coupon_code,
      (select string_agg(i.qty || '× ' || i.name || case when i.combo then ' (combo)' else '' end, '; ') from public.order_items i where i.order_id = o.id)
    from public.orders o
    where o.restaurant_id = rid and o.created_at >= private.bogota_day_start(greatest(1, least(coalesce(p_days, 30), 366)) - 1)
    order by o.created_at;
end;
$$;
grant execute on function public.sales_export(integer) to authenticated;

-- Cierre de caja (P10): efectivo esperado del día (pedidos entregados en medios que piden vuelto) vs. contado.
create table public.cash_closings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day date not null,
  expected integer not null check (expected >= 0),
  counted integer not null check (counted >= 0),
  difference integer generated always as (counted - expected) stored,
  notes text check (length(notes) <= 300),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz not null default now(),
  unique (restaurant_id, day)
);
alter table public.cash_closings enable row level security;
create policy "admin ve sus cierres" on public.cash_closings for select to authenticated using (public.is_admin_of(restaurant_id));
revoke insert, update, delete on public.cash_closings from anon, authenticated;

create function public.cash_expected(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  d date := coalesce(p_day, (now() at time zone 'America/Bogota')::date);
begin
  if rid is null or public.my_role() <> 'admin' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    select jsonb_build_object('day', d,
      'expected', coalesce(sum(o.total), 0), 'orders', count(*),
      'closed', (select jsonb_build_object('counted', c.counted, 'difference', c.difference, 'notes', c.notes, 'closed_at', c.closed_at)
                 from public.cash_closings c where c.restaurant_id = rid and c.day = d))
    from public.orders o
    where o.restaurant_id = rid and o.status = 'entregado' and (o.created_at at time zone 'America/Bogota')::date = d
      and o.payment_label in (select m.label from public.payment_methods m where m.restaurant_id = rid and m.asks_change)
  );
end;
$$;
grant execute on function public.cash_expected(date) to authenticated;

create function public.close_cash(p_day date, p_counted integer, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  exp integer;
begin
  if rid is null or public.my_role() <> 'admin' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Valor contado inválido' using errcode = '22023'; end if;
  if p_day > (now() at time zone 'America/Bogota')::date then raise exception 'No se cierra un día futuro' using errcode = '22023'; end if;
  exp := (public.cash_expected(p_day) ->> 'expected')::integer;
  insert into public.cash_closings (restaurant_id, day, expected, counted, notes, closed_by)
  values (rid, p_day, exp, p_counted, nullif(trim(p_notes), ''), auth.uid())
  on conflict (restaurant_id, day) do update set expected = excluded.expected, counted = excluded.counted, notes = excluded.notes,
    closed_by = excluded.closed_by, closed_at = now();
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values (rid, auth.uid(), 'cierre de caja', 'cash_closings', p_day::text, jsonb_build_object('esperado', exp, 'contado', p_counted));
  return jsonb_build_object('expected', exp, 'counted', p_counted, 'difference', p_counted - exp);
end;
$$;
grant execute on function public.close_cash(date, integer, text) to authenticated;

-- Informe semanal (P11): la semana pasada (lunes a domingo) contra la anterior. El envío automático llega con WhatsApp (F9).
create function public.weekly_report(p_restaurant uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := coalesce(p_restaurant, public.my_restaurant());
  this_monday date := date_trunc('week', now() at time zone 'America/Bogota')::date;
  w_start timestamptz := (this_monday - 7)::timestamp at time zone 'America/Bogota';
  w_end timestamptz := this_monday::timestamp at time zone 'America/Bogota';
  p_start timestamptz := (this_monday - 14)::timestamp at time zone 'America/Bogota';
begin
  -- Desde el panel: solo admin. Sin sesión (cron del servidor, F9): solo con el id explícito y rol de servicio.
  if p_restaurant is null and (rid is null or public.my_role() <> 'admin') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_restaurant is not null and coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    with w as (select * from public.orders where restaurant_id = rid and created_at >= w_start and created_at < w_end and status <> 'cancelado'),
    pw as (select * from public.orders where restaurant_id = rid and created_at >= p_start and created_at < w_start and status <> 'cancelado')
    select jsonb_build_object(
      'from', this_monday - 7, 'to', this_monday - 1,
      'total', coalesce((select sum(total) from w), 0), 'orders', (select count(*) from w),
      'previous_total', coalesce((select sum(total) from pw), 0), 'previous_orders', (select count(*) from pw),
      'ticket', coalesce((select round(avg(total)) from w), 0),
      'star', (select i.name from public.order_items i join w on w.id = i.order_id group by i.name order by sum(i.qty) desc limit 1),
      'peak_hour', (select extract(hour from created_at at time zone 'America/Bogota')::int from w group by 1 order by count(*) desc limit 1),
      'peak_day', (select to_char(created_at at time zone 'America/Bogota', 'ID')::int from w group by 1 order by count(*) desc limit 1),
      'blocked', (select count(*) from public.blocked_attempts b where b.restaurant_id = rid and b.at >= w_start and b.at < w_end),
      'cancelled', (select count(*) from public.orders where restaurant_id = rid and created_at >= w_start and created_at < w_end and status = 'cancelado')
    )
  );
end;
$$;
grant execute on function public.weekly_report(uuid) to authenticated, service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
