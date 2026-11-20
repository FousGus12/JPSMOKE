-- =============================================================================
-- JP Smoke · v0.19 administración.
-- D65: el frenado guarda el vínculo al cliente si el celular ya existía; exportar clientes con autorización
--      vigente de promociones (solo admin, con auditoría).
-- D64: ventas de Rappi/DiDi importadas desde CSV a external_sales (no a orders), por lotes reversibles,
--      sin duplicar por id externo y marcando "ya registrada" si coincide con un pedido manual.
-- =============================================================================

-- D65: vínculo del frenado al cliente existente (nunca se guarda el celular completo en el frenado).
alter table public.blocked_attempts add column customer_id uuid references public.customers (id) on delete set null;
create index on public.blocked_attempts (customer_id) where customer_id is not null;

create or replace function private.log_blocked(rid uuid, why text, d jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ph text := regexp_replace(coalesce(d ->> 'phone', ''), '\D', '', 'g');
  cid uuid;
begin
  if length(ph) = 12 and left(ph, 2) = '57' then ph := right(ph, 10); end if;
  if ph ~ '^3[0-9]{9}$' then
    select c.id into cid from public.customers c where c.restaurant_id = rid and c.phone = ph;
  end if;
  insert into public.blocked_attempts (restaurant_id, reason, customer_name, phone_last4, zone_name, total_attempt, items_count, customer_id)
  values (rid, why,
    nullif(left(trim(coalesce(d ->> 'name', '')), 80), ''),
    case when length(ph) >= 4 then right(ph, 4) end,
    nullif(left(trim(coalesce(d ->> 'zone', '')), 60), ''),
    case when coalesce(d ->> 'total', '') ~ '^[0-9]{1,8}$' then (d ->> 'total')::integer end,
    case when coalesce(d ->> 'items', '') ~ '^[0-9]{1,2}$' then (d ->> 'items')::smallint end,
    cid);
  return jsonb_build_object('ok', false, 'reason', why);
end;
$$;

-- D65: clientes con autorización de promociones vigente (la última autorización del celular la concede).
-- Los bloqueados no salen. Solo admin; cada exportación queda en auditoría con el número de filas.
create function public.customers_promo_export()
returns table (nombre text, celular text, autorizado_el timestamptz, pedidos integer, ultimo_pedido timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  n integer;
begin
  if rid is null or not public.is_admin_of(rid) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    with last as (
      select distinct on (k.phone) k.phone, k.granted, k.at from public.consents k
      where k.restaurant_id = rid and k.kind = 'promociones'
      order by k.phone, k.at desc, k.id desc)
    select c.name, c.phone, l.at,
      (select count(*)::integer from public.orders o where o.customer_id = c.id and o.status <> 'cancelado'),
      (select max(o.created_at) from public.orders o where o.customer_id = c.id)
    from last l join public.customers c on c.restaurant_id = rid and c.phone = l.phone
    where l.granted and not c.blocked
    order by c.name;
  get diagnostics n = row_count;
  insert into public.audit_log (restaurant_id, actor, action, entity, detail)
  values (rid, auth.uid(), 'exportar', 'clientes', jsonb_build_object('filas', n, 'tipo', 'promociones'));
end;
$$;
grant execute on function public.customers_promo_export() to authenticated;

-- D64: mapeo de columnas del CSV por canal (apartado Ventas; guard_settings ya lo mapea desde pedidos_v019).
alter table public.restaurant_settings
  add column import_maps jsonb not null default '{}'::jsonb
    check (jsonb_typeof(import_maps) = 'object' and length(import_maps::text) <= 4000);
comment on column public.restaurant_settings.import_maps is 'Mapeo de columnas del CSV por canal (rappi, didi), D64.';
drop policy "equipo con apartado edita ajustes" on public.restaurant_settings;
create policy "equipo con apartado edita ajustes" on public.restaurant_settings for update to authenticated
  using (public.can_of(restaurant_id, 'sitio') or public.can_of(restaurant_id, 'whatsapp') or public.can_of(restaurant_id, 'promos')
         or public.can_of(restaurant_id, 'eventos') or public.can_of(restaurant_id, 'carta') or public.can_of(restaurant_id, 'inventario')
         or public.can_of(restaurant_id, 'ventas'))
  with check (public.my_restaurant() = restaurant_id);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  channel public.order_channel not null check (channel in ('rappi', 'didi')),
  file_name text not null default '' check (length(file_name) <= 120),
  inserted integer not null default 0,
  repeated integer not null default 0,
  matched integer not null default 0,
  errors integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.import_batches (restaurant_id, created_at desc);

create table public.external_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  channel public.order_channel not null check (channel in ('rappi', 'didi')),
  external_id text not null check (length(external_id) between 1 and 80),
  sold_at timestamptz not null,
  sold_on date not null, -- día de Bogotá
  total integer not null check (total between 0 and 100000000),
  commission integer check (commission between 0 and 100000000), -- comisión de la plataforma (informativa)
  items text not null default '' check (length(items) <= 300),
  matched_order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, channel, external_id)
);
create index on public.external_sales (restaurant_id, sold_at);
create index on public.external_sales (batch_id);
-- Un pedido manual casa con una sola venta externa.
create unique index external_sales_match_once on public.external_sales (matched_order_id) where matched_order_id is not null;

alter table public.import_batches enable row level security;
alter table public.external_sales enable row level security;
create policy "ventas ve sus lotes" on public.import_batches for select to authenticated using (public.can_of(restaurant_id, 'ventas'));
create policy "ventas ve sus ventas externas" on public.external_sales for select to authenticated using (public.can_of(restaurant_id, 'ventas'));
-- Solo escriben las funciones (validan cada fila en el servidor).
revoke all on public.import_batches, public.external_sales from anon;
revoke insert, update, delete, truncate, references, trigger on public.import_batches, public.external_sales from authenticated;

-- Importar ventas de Rappi/DiDi. Filas: [{external_id, date, total, items?}] (máx. 2.000).
-- date: AAAA-MM-DD u AAAA-MM-DD HH:MM[:SS] en hora de Bogotá. total: entero en pesos.
-- insertadas incluye las ya_registradas (coinciden con un pedido manual del mismo canal, día y total).
-- repetidas: id externo ya importado (o repetido en el archivo). errores: filas inválidas (no se guardan).
create function public.import_external_sales(p_channel text, p_file text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  ch public.order_channel;
  bid uuid;
  row_data jsonb;
  idx bigint;
  ext text;
  dt text;
  tt text;
  ts timestamptz;
  d_day date;
  today date := (now() at time zone 'America/Bogota')::date;
  sid uuid;
  mo uuid;
  n_ins integer := 0;
  n_rep integer := 0;
  n_match integer := 0;
  n_err integer := 0;
  errs jsonb := '[]'::jsonb;
  why text;
begin
  if rid is null or not public.can('ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if coalesce(p_channel, '') not in ('rappi', 'didi') then raise exception 'Canal inválido' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'El archivo debe tener entre 1 y 2.000 filas' using errcode = '22023';
  end if;
  ch := p_channel::public.order_channel;
  -- Una importación a la vez por restaurante: dos lotes no casan el mismo pedido.
  perform pg_advisory_xact_lock(hashtextextended('importar:' || rid::text, 0));
  insert into public.import_batches (restaurant_id, channel, file_name, created_by)
  values (rid, ch, left(trim(coalesce(p_file, '')), 120), auth.uid()) returning id into bid;

  for row_data, idx in select x, i from jsonb_array_elements(p_rows) with ordinality as t(x, i) loop
    why := null;
    ext := trim(coalesce(row_data ->> 'external_id', ''));
    dt := trim(coalesce(row_data ->> 'date', ''));
    tt := trim(coalesce(row_data ->> 'total', ''));
    ts := null;
    if jsonb_typeof(row_data) is distinct from 'object' then why := 'fila';
    elsif length(ext) not between 1 and 80 then why := 'id_externo';
    elsif tt !~ '^[0-9]{1,9}$' or tt::bigint > 100000000 then why := 'total';
    elsif dt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9]{2}:[0-9]{2}(:[0-9]{2})?)?$' then why := 'fecha';
    else
      begin
        ts := (replace(dt, 'T', ' ')::timestamp) at time zone 'America/Bogota';
      exception when others then
        why := 'fecha';
      end;
      if why is null then
        d_day := (ts at time zone 'America/Bogota')::date;
        if d_day < date '2020-01-01' or d_day > today + 1 then why := 'fecha'; end if;
      end if;
    end if;
    if why is not null then
      n_err := n_err + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_object('row', idx, 'reason', why); end if;
      continue;
    end if;

    sid := null;
    insert into public.external_sales (restaurant_id, batch_id, channel, external_id, sold_at, sold_on, total, commission, items)
    values (rid, bid, ch, ext, ts, d_day, tt::integer,
      case when coalesce(row_data ->> 'commission', '') ~ '^[0-9]{1,9}$' and (row_data ->> 'commission')::bigint <= 100000000
           then (row_data ->> 'commission')::integer end,
      left(trim(coalesce(row_data ->> 'items', '')), 300))
    on conflict (restaurant_id, channel, external_id) do nothing
    returning id into sid;
    if sid is null then n_rep := n_rep + 1; continue; end if;
    n_ins := n_ins + 1;
    select o.id into mo from public.orders o
    where o.restaurant_id = rid and o.channel = ch and o.status <> 'cancelado' and o.total = tt::integer
      and (o.created_at at time zone 'America/Bogota')::date = d_day
      and not exists (select 1 from public.external_sales e where e.matched_order_id = o.id)
    order by o.created_at limit 1;
    if mo is not null then
      update public.external_sales set matched_order_id = mo where id = sid;
      n_match := n_match + 1;
      mo := null;
    end if;
  end loop;

  if n_ins = 0 then
    delete from public.import_batches where id = bid;
    bid := null;
  else
    update public.import_batches set inserted = n_ins, repeated = n_rep, matched = n_match, errors = n_err where id = bid;
  end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values (rid, auth.uid(), 'importar', 'external_sales', bid::text,
          jsonb_build_object('canal', ch, 'archivo', left(trim(coalesce(p_file, '')), 120), 'insertadas', n_ins,
                             'repetidas', n_rep, 'ya_registradas', n_match, 'errores', n_err));
  return jsonb_build_object('batch', bid, 'insertadas', n_ins, 'repetidas', n_rep, 'ya_registradas', n_match,
                            'errores', n_err, 'error_rows', errs);
end;
$$;
grant execute on function public.import_external_sales(text, text, jsonb) to authenticated;

-- Deshacer un lote: borra el lote y sus ventas externas. Devuelve cuántas ventas borró.
create function public.revert_import(p_batch uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  b public.import_batches;
  n integer;
begin
  select * into b from public.import_batches where id = p_batch for update;
  if b.id is null or not public.can_of(b.restaurant_id, 'ventas') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  delete from public.external_sales where batch_id = b.id;
  get diagnostics n = row_count;
  delete from public.import_batches where id = b.id;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values (b.restaurant_id, auth.uid(), 'deshacer importación', 'external_sales', b.id::text,
          jsonb_build_object('canal', b.channel, 'archivo', b.file_name, 'borradas', n));
  return n;
end;
$$;
grant execute on function public.revert_import(uuid) to authenticated;

-- Resumen de ventas externas (fuera de caja). total/orders/by_* sin las ya registradas (ya cuentan como pedido manual).
create function public.external_sales_summary(p_days integer default 30) returns jsonb
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
    u as (select * from e where matched_order_id is null)
    select jsonb_build_object(
      'days', days,
      'total', coalesce((select sum(total) from u), 0),
      'commission', coalesce((select sum(commission) from u), 0),
      'orders', (select count(*) from u),
      'matched', (select count(*) from e where matched_order_id is not null),
      'matched_total', coalesce((select sum(total) from e where matched_order_id is not null), 0),
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
grant execute on function public.external_sales_summary(integer) to authenticated;

-- Cierre (regla del proyecto).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
grant execute on function public.ordering_status(text) to anon, authenticated;
