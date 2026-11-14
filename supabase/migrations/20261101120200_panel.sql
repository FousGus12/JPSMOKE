-- =============================================================================
-- JP Smoke · Panel (F5, D12): el administrador solo actúa con verificación en dos
-- pasos (sesión aal2). El operador entra con contraseña. Se aplica en la base, no en
-- la interfaz: una sesión de admin sin el código no ve ni cambia nada.
-- =============================================================================

create or replace function public.my_restaurant() returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.restaurant_id from public.staff s
  join public.restaurants r on r.id = s.restaurant_id and r.active
  where s.user_id = (select auth.uid()) and s.active
    and (s.role = 'operador' or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
$$;

create or replace function public.my_role() returns public.staff_role
language sql stable security definer set search_path = ''
as $$
  select s.role from public.staff s
  where s.user_id = (select auth.uid()) and s.active
    and (s.role = 'operador' or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
$$;

-- Ficha propia para el panel (nombre y rol) aunque falte el segundo paso: así la interfaz sabe qué pedir.
create function public.my_staff() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', s.full_name, 'role', s.role, 'restaurant', r.name, 'slug', r.slug,
    'restaurant_id', r.id, 'aal_ok', s.role = 'operador' or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
  from public.staff s join public.restaurants r on r.id = s.restaurant_id and r.active
  where s.user_id = (select auth.uid()) and s.active
$$;
revoke execute on function public.my_staff() from public, anon;
grant execute on function public.my_staff() to authenticated;

-- Resumen del tablero (admin y operador): sin dinero para el operador (D19).
create function public.board_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  today timestamptz := date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
  money boolean := public.my_role() = 'admin';
begin
  if rid is null then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'orders_today', count(*) filter (where status <> 'cancelado'),
      'cancelled_today', count(*) filter (where status = 'cancelado'),
      'active', count(*) filter (where status in ('nuevo', 'confirmado', 'en_cocina', 'en_camino')),
      'waiting', count(*) filter (where status = 'nuevo'),
      'avg_minutes', (select round(avg(extract(epoch from (e.at - o2.created_at)) / 60)) from public.orders o2
                      join public.order_events e on e.order_id = o2.id and e.status = 'entregado'
                      where o2.restaurant_id = rid and o2.created_at >= today),
      'sales_today', case when money then coalesce(sum(total) filter (where status <> 'cancelado'), 0) end,
      'ticket_today', case when money then round(avg(total) filter (where status <> 'cancelado')) end,
      'blocked_week', case when money then (select count(*) from public.blocked_attempts b
                       where b.restaurant_id = rid and b.at > now() - interval '7 days') end
    )
    from public.orders where restaurant_id = rid and created_at >= today
  );
end;
$$;
grant execute on function public.board_summary() to authenticated;

-- Cierre de permisos de esta migración (la plataforma da EXECUTE a anon por defecto a las funciones nuevas).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
