-- =============================================================================
-- JP Smoke · Equipo gestionable desde el panel (D38).
-- El admin crea cuentas (Edge Function `equipo`), cambia rol, activa/desactiva y delega apartados al
-- operador. Se aplica en la base: `can(apartado)` reemplaza los chequeos de "solo admin" en políticas,
-- RPC y Storage. Resumen y Pedidos son la base de todo operador; Equipo y auditoría, solo del admin.
-- Toda cuenta con apartados delegados exige dos pasos (aal2), igual que el admin.
-- =============================================================================

alter table public.staff add column permissions text[] not null default '{}'
  check (permissions <@ array['ventas', 'inventario', 'whatsapp', 'carta', 'sitio', 'promos', 'eventos']::text[]);
comment on column public.staff.permissions is 'Apartados delegados al operador (D38). El admin tiene todos; vacío para el admin.';

-- Sin segundo paso solo entra el operador sin apartados delegados.
create or replace function public.my_restaurant() returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.restaurant_id from public.staff s
  join public.restaurants r on r.id = s.restaurant_id and r.active
  where s.user_id = (select auth.uid()) and s.active
    and ((s.role = 'operador' and cardinality(s.permissions) = 0)
         or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
$$;

create or replace function public.my_role() returns public.staff_role
language sql stable security definer set search_path = ''
as $$
  select s.role from public.staff s
  where s.user_id = (select auth.uid()) and s.active
    and ((s.role = 'operador' and cardinality(s.permissions) = 0)
         or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
$$;

-- ¿Quien llama puede usar este apartado de su restaurante? El admin, todos; el operador, los delegados.
-- 'equipo' no es delegable (la restricción de la columna lo impide): solo admin.
create function public.can(area text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select s.role = 'admin' or area = any (s.permissions)
    from public.staff s
    where s.user_id = (select auth.uid()) and s.active and s.restaurant_id = public.my_restaurant()
  ), false)
$$;

create function public.can_of(rid uuid, area text) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.my_restaurant() = rid and public.can(area), false) $$;

-- Ficha propia para el panel: ahora con apartados y si necesita el segundo paso.
create or replace function public.my_staff() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', s.full_name, 'role', s.role, 'restaurant', r.name, 'slug', r.slug,
    'restaurant_id', r.id, 'permissions', to_jsonb(s.permissions),
    'needs_totp', s.role = 'admin' or cardinality(s.permissions) > 0,
    'aal_ok', (s.role = 'operador' and cardinality(s.permissions) = 0)
              or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
  from public.staff s join public.restaurants r on r.id = s.restaurant_id and r.active
  where s.user_id = (select auth.uid()) and s.active
$$;

-- Equipo con correo y último ingreso (están en auth.users): solo admin.
create function public.team_list() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare rid uuid := public.my_restaurant();
begin
  if rid is null or not public.can('equipo') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', s.user_id, 'full_name', s.full_name, 'email', u.email, 'role', s.role, 'active', s.active,
      'permissions', to_jsonb(s.permissions), 'created_at', s.created_at, 'last_sign_in_at', u.last_sign_in_at,
      'has_totp', exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified'),
      'is_me', s.user_id = (select auth.uid())
    ) order by s.active desc, s.role, s.full_name), '[]'::jsonb)
    from public.staff s join auth.users u on u.id = s.user_id
    where s.restaurant_id = rid
  );
end $$;

-- Para la Edge Function `equipo`: con el JWT de quien llama, confirma admin (con dos pasos) y da su restaurante.
create function public.team_restaurant() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare rid uuid := public.my_restaurant();
begin
  if rid is null or not public.can('equipo') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return rid;
end $$;

-- Guardias del equipo, también frente al servidor: nadie cambia su propio acceso, el restaurante nunca
-- queda sin admin activo y la ficha no cambia de dueño ni de restaurante.
create function private.guard_staff() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.restaurant_id <> old.restaurant_id then
    raise exception 'La cuenta no cambia de persona ni de restaurante' using errcode = '42501';
  end if;
  if new.role = 'admin' then new.permissions := '{}'; end if;
  if old.user_id = (select auth.uid())
     and (new.role <> old.role or new.active <> old.active or new.permissions <> old.permissions) then
    raise exception 'No puedes cambiar tu propio acceso' using errcode = '42501', hint = 'propio';
  end if;
  if old.role = 'admin' and old.active and not (new.role = 'admin' and new.active) then
    perform 1 from public.restaurants where id = old.restaurant_id for update;
    if not exists (select 1 from public.staff s where s.restaurant_id = old.restaurant_id
                   and s.user_id <> old.user_id and s.role = 'admin' and s.active) then
      raise exception 'El restaurante necesita al menos un admin activo' using errcode = '42501', hint = 'ultimo_admin';
    end if;
  end if;
  return new;
end $$;
create trigger guard_staff before update on public.staff for each row execute function private.guard_staff();

create function private.guard_staff_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.restaurants where id = old.restaurant_id for update;
  if old.role = 'admin' and old.active and not exists (select 1 from public.staff s
      where s.restaurant_id = old.restaurant_id and s.user_id <> old.user_id and s.role = 'admin' and s.active) then
    raise exception 'El restaurante necesita al menos un admin activo' using errcode = '42501', hint = 'ultimo_admin';
  end if;
  return old;
end $$;
create trigger guard_staff_delete before delete on public.staff for each row execute function private.guard_staff_delete();

-- El admin solo edita nombre, rol, estado y apartados (nunca user_id ni restaurante).
revoke update on public.staff from authenticated;
grant update (full_name, role, active, permissions) on public.staff to authenticated;

-- Ajustes del restaurante: cada grupo de columnas pide su apartado.
create function private.guard_settings() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old) - 'updated_at';
  n jsonb := to_jsonb(new) - 'updated_at';
  k text;
  area text;
begin
  if (select auth.uid()) is null then return new; end if; -- servidor y tareas programadas
  for k in select key from jsonb_each(n) where n -> key is distinct from o -> key loop
    area := case
      when k in ('whatsapp_mode', 'site_url') then 'whatsapp'
      when k = 'intro_mode' then 'promos'
      when k = 'published_at' then 'publicar'
      when k in ('brand', 'protection', 'restaurant_id') then 'equipo'
      else 'sitio' end;
    if area = 'publicar' and (public.can('carta') or public.can('sitio') or public.can('promos') or public.can('eventos')) then continue; end if;
    if area = 'promos' and public.can('eventos') then continue; end if;
    if not public.can(area) then
      raise exception 'Sin permiso para cambiar %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
create trigger guard_settings before update on public.restaurant_settings for each row execute function private.guard_settings();

-- Políticas: "solo admin" → apartado.
drop policy "admin edita sus ajustes" on public.restaurant_settings;
create policy "equipo con apartado edita ajustes" on public.restaurant_settings for update to authenticated
  using (public.can_of(restaurant_id, 'sitio') or public.can_of(restaurant_id, 'whatsapp') or public.can_of(restaurant_id, 'promos')
         or public.can_of(restaurant_id, 'eventos') or public.can_of(restaurant_id, 'carta'))
  with check (public.my_restaurant() = restaurant_id);

drop policy "admin gestiona categorías" on public.categories;
create policy "carta gestiona categorías" on public.categories for all to authenticated
  using (public.can_of(restaurant_id, 'carta')) with check (public.can_of(restaurant_id, 'carta'));
drop policy "admin gestiona productos" on public.products;
create policy "carta gestiona productos" on public.products for all to authenticated
  using (public.can_of(restaurant_id, 'carta')) with check (public.can_of(restaurant_id, 'carta'));

drop policy "admin gestiona zonas" on public.delivery_zones;
create policy "sitio gestiona zonas" on public.delivery_zones for all to authenticated
  using (public.can_of(restaurant_id, 'sitio')) with check (public.can_of(restaurant_id, 'sitio'));
drop policy "admin gestiona medios de pago" on public.payment_methods;
create policy "sitio gestiona medios de pago" on public.payment_methods for all to authenticated
  using (public.can_of(restaurant_id, 'sitio')) with check (public.can_of(restaurant_id, 'sitio'));
drop policy "admin gestiona reseñas" on public.reviews;
create policy "sitio gestiona reseñas" on public.reviews for all to authenticated
  using (public.can_of(restaurant_id, 'sitio')) with check (public.can_of(restaurant_id, 'sitio'));

drop policy "admin gestiona cupones" on public.coupons;
create policy "promos gestiona cupones" on public.coupons for all to authenticated
  using (public.can_of(restaurant_id, 'promos')) with check (public.can_of(restaurant_id, 'promos'));
drop policy "admin ve su captación" on public.leads;
create policy "promos ve su captación" on public.leads for select to authenticated using (public.can_of(restaurant_id, 'promos'));
drop policy "admin ve sus autorizaciones" on public.consents;
create policy "promos ve sus autorizaciones" on public.consents for select to authenticated using (public.can_of(restaurant_id, 'promos'));

drop policy "admin gestiona eventos" on public.events;
create policy "eventos gestiona eventos" on public.events for all to authenticated
  using (public.can_of(restaurant_id, 'eventos')) with check (public.can_of(restaurant_id, 'eventos'));
drop policy "admin ve sus cotizaciones" on public.quotes;
create policy "eventos ve sus cotizaciones" on public.quotes for select to authenticated using (public.can_of(restaurant_id, 'eventos'));
drop policy "admin cambia estado de cotizaciones" on public.quotes;
create policy "eventos cambia estado de cotizaciones" on public.quotes for update to authenticated
  using (public.can_of(restaurant_id, 'eventos')) with check (public.can_of(restaurant_id, 'eventos'));

drop policy "admin gestiona insumos" on public.supplies;
create policy "inventario gestiona insumos" on public.supplies for all to authenticated
  using (public.can_of(restaurant_id, 'inventario')) with check (public.can_of(restaurant_id, 'inventario'));
drop policy "admin gestiona recetas" on public.recipes;
create policy "inventario gestiona recetas" on public.recipes for all to authenticated
  using (public.can_of(restaurant_id, 'inventario')) with check (public.can_of(restaurant_id, 'inventario'));
drop policy "admin ve movimientos" on public.supply_moves;
create policy "inventario ve movimientos" on public.supply_moves for select to authenticated using (public.can_of(restaurant_id, 'inventario'));

drop policy "admin ve sus cierres" on public.cash_closings;
create policy "ventas ve sus cierres" on public.cash_closings for select to authenticated using (public.can_of(restaurant_id, 'ventas'));

drop policy "admin ve sus mensajes" on public.whatsapp_messages;
create policy "whatsapp ve sus mensajes" on public.whatsapp_messages for select to authenticated using (public.can_of(restaurant_id, 'whatsapp'));

-- Fotos (bucket carta): las suben Carta, Eventos y Editar página.
drop policy "admin sube fotos de su carta" on storage.objects;
drop policy "admin cambia fotos de su carta" on storage.objects;
drop policy "admin borra fotos de su carta" on storage.objects;
create policy "equipo sube fotos de su carta" on storage.objects for insert to authenticated
  with check (bucket_id = 'carta' and (public.can('carta') or public.can('eventos') or public.can('sitio'))
              and (storage.foldername(name))[1] = public.my_restaurant()::text);
create policy "equipo cambia fotos de su carta" on storage.objects for update to authenticated
  using (bucket_id = 'carta' and (public.can('carta') or public.can('eventos') or public.can('sitio'))
         and (storage.foldername(name))[1] = public.my_restaurant()::text);
create policy "equipo borra fotos de su carta" on storage.objects for delete to authenticated
  using (bucket_id = 'carta' and (public.can('carta') or public.can('eventos') or public.can('sitio'))
         and (storage.foldername(name))[1] = public.my_restaurant()::text);

-- RPC: el mismo cambio, partiendo de su definición vigente.
CREATE OR REPLACE FUNCTION public.board_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
  today timestamptz := date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
  money boolean := public.can('ventas');
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
                       where b.restaurant_id = rid and b.at > now() - interval '7 days') end,
      'low_supplies', (select coalesce(jsonb_agg(s.name order by s.stock / nullif(s.min_stock, 0)), '[]') from public.supplies s
                       where s.restaurant_id = rid and s.active and s.stock <= s.min_stock)
    )
    from public.orders where restaurant_id = rid and created_at >= today
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cash_expected(p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
  d date := coalesce(p_day, (now() at time zone 'America/Bogota')::date);
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.close_cash(p_day date, p_counted integer, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
  exp integer;
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.sales_export(p_days integer DEFAULT 30)
 RETURNS TABLE(codigo text, fecha timestamp with time zone, canal text, estado text, pago text, subtotal integer, descuento integer, domicilio integer, total integer, cupon text, productos text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, detail)
  values (rid, auth.uid(), 'exportar', 'ventas', jsonb_build_object('dias', p_days));
  return query
    select o.code, o.created_at, o.channel::text, o.status::text, o.payment_label, o.subtotal, o.discount, o.delivery_fee, o.total, o.coupon_code,
      (select string_agg(i.qty || '× ' || i.name || case when i.combo then ' (combo)' else '' end, '; ') from public.order_items i where i.order_id = o.id)
    from public.orders o
    where o.restaurant_id = rid and o.created_at >= private.bogota_day_start(greatest(1, least(coalesce(p_days, 30), 366)) - 1)
    order by o.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_summary(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
  days integer := greatest(1, least(coalesce(p_days, 30), 366));
  since timestamptz := private.bogota_day_start(days - 1);
  prev timestamptz := private.bogota_day_start(2 * days - 1);
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.weekly_report(p_restaurant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := coalesce(p_restaurant, public.my_restaurant());
  this_monday date := date_trunc('week', now() at time zone 'America/Bogota')::date;
  w_start timestamptz := (this_monday - 7)::timestamp at time zone 'America/Bogota';
  w_end timestamptz := this_monday::timestamp at time zone 'America/Bogota';
  p_start timestamptz := (this_monday - 14)::timestamp at time zone 'America/Bogota';
begin
  -- Desde el panel: solo admin. Sin sesión (cron del servidor, F9): solo con el id explícito y rol de servicio.
  if p_restaurant is null and (rid is null or not public.can('ventas')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.publish_site()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
  last timestamptz;
begin
  if rid is null or not (public.can('carta') or public.can('sitio') or public.can('promos') or public.can('eventos')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select published_at into last from public.restaurant_settings where restaurant_id = rid;
  if last is not null and last > now() - interval '1 minute' then
    raise exception 'Espera un minuto entre publicaciones' using errcode = 'P0001', hint = 'muy_seguido';
  end if;
  update public.restaurant_settings set published_at = now() where restaurant_id = rid;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id) values (rid, auth.uid(), 'publicar', 'sitio', null);
  return jsonb_build_object('published_at', now(), 'slug', (select slug from public.restaurants where id = rid));
end;
$function$;

CREATE OR REPLACE FUNCTION public.unmark_published()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ update public.restaurant_settings set published_at = null where restaurant_id = public.my_restaurant() and (public.can('carta') or public.can('sitio') or public.can('promos') or public.can('eventos')) $function$;

CREATE OR REPLACE FUNCTION public.register_supply(p_supply uuid, p_kind supply_move_kind, p_qty numeric, p_note text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.supplies;
  delta numeric;
begin
  select * into s from public.supplies where id = p_supply for update;
  if s.id is null or not public.can_of(s.restaurant_id, 'inventario') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  -- Un conteo puede dejar el insumo en 0; una compra o merma de 0 no tiene sentido.
  if p_kind not in ('compra', 'merma', 'ajuste') or p_qty is null or p_qty < 0 or (p_kind <> 'ajuste' and p_qty = 0) then
    raise exception 'Movimiento inválido' using errcode = '22023';
  end if;
  -- Compra en unidades de compra (paquetes, lechugas); merma en unidades de uso; ajuste = conteo físico (nuevo stock).
  delta := case p_kind when 'compra' then abs(p_qty) * s.per_purchase when 'merma' then -abs(p_qty) else p_qty - s.stock end;
  if s.stock + delta < 0 then raise exception 'No hay tanto en inventario' using errcode = '22023'; end if;
  update public.supplies set stock = stock + delta where id = s.id;
  insert into public.supply_moves (restaurant_id, supply_id, kind, qty, note, by_user)
  values (s.restaurant_id, s.id, p_kind, delta, nullif(trim(p_note), ''), auth.uid());
  return s.stock + delta;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_intro_event(p_event uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rid uuid := public.my_restaurant();
begin
  if rid is null or not (public.can('eventos') or public.can('promos')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  update public.events set show_intro = false where restaurant_id = rid and show_intro and id is distinct from p_event;
  if p_event is not null then
    update public.events set show_intro = true where id = p_event and restaurant_id = rid;
    if not found then raise exception 'Evento no encontrado' using errcode = '42501'; end if;
  end if;
end;
$function$;

-- Contraseña temporal nueva = cerrar las sesiones abiertas de esa cuenta (solo el servidor).
create function public.revoke_sessions(p_user uuid) returns void
language sql security definer set search_path = ''
as $$ delete from auth.sessions where user_id = p_user $$;

-- Cierre (D34): nada nuevo abierto para anon; el sitio sigue con track_order y stock_status.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
grant execute on function public.can(text), public.can_of(uuid, text), public.team_list(), public.team_restaurant() to authenticated;
revoke execute on function public.revoke_sessions(uuid) from authenticated;
grant execute on function public.revoke_sessions(uuid) to service_role;
