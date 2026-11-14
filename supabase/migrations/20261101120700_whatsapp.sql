-- =============================================================================
-- JP Smoke · WhatsApp automático (F9, D32). Modo por restaurante: manual (nada sale),
-- prueba (se arma y se registra como "simulado", sin llamar a Meta ni costo) y activo
-- (Cloud API de Meta; requiere credenciales y aprobación). La cola no guarda celulares
-- ni textos: se arman al enviar.
-- =============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

alter table public.restaurant_settings
  add column whatsapp_mode text not null default 'manual' check (whatsapp_mode in ('manual', 'prueba', 'activo')),
  add column site_url text check (site_url is null or site_url ~ '^https?://');

create type public.wa_kind as enum ('pedido_recibido', 'aviso_negocio', 'en_camino', 'informe_semanal');
create type public.wa_status as enum ('pendiente', 'enviado', 'simulado', 'fallido', 'omitido');

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind public.wa_kind not null,
  order_id uuid references public.orders (id) on delete cascade,
  status public.wa_status not null default 'pendiente',
  attempts smallint not null default 0 check (attempts between 0 and 3),
  error text check (length(error) <= 200),
  provider_id text check (length(provider_id) <= 200),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  check (kind = 'informe_semanal' or order_id is not null)
);
create unique index whatsapp_once on public.whatsapp_messages (order_id, kind) where order_id is not null;
create index whatsapp_queue on public.whatsapp_messages (created_at) where status in ('pendiente', 'fallido');
create index on public.whatsapp_messages (restaurant_id, created_at desc);
alter table public.whatsapp_messages enable row level security;
create policy "admin ve sus mensajes" on public.whatsapp_messages for select to authenticated using (public.is_admin_of(restaurant_id));
revoke insert, update, delete on public.whatsapp_messages from anon, authenticated;

-- Encolar según el pedido. Pedidos web: confirmación al cliente y aviso al negocio. Todos: "va en camino".
create function private.queue_whatsapp() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select whatsapp_mode from public.restaurant_settings where restaurant_id = new.restaurant_id) = 'manual' then
    return null;
  end if;
  if tg_op = 'INSERT' and new.channel = 'web' then
    insert into public.whatsapp_messages (restaurant_id, kind, order_id) values
      (new.restaurant_id, 'pedido_recibido', new.id), (new.restaurant_id, 'aviso_negocio', new.id)
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and new.status = 'en_camino' and old.status is distinct from 'en_camino' and new.fulfillment = 'domicilio' then
    insert into public.whatsapp_messages (restaurant_id, kind, order_id) values (new.restaurant_id, 'en_camino', new.id)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger queue_whatsapp after insert or update of status on public.orders for each row execute function private.queue_whatsapp();

-- Lo que necesita el despacho (solo el servidor): toma hasta p_limit mensajes y los marca como tomados
-- (dos despachos a la vez no envían el mismo mensaje).
create function public.whatsapp_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
begin
  select array_agg(id) into ids from (
    select m.id from public.whatsapp_messages m
    where m.status in ('pendiente', 'fallido') and m.attempts < 3
      and (m.claimed_at is null or m.claimed_at < now() - interval '5 minutes')
    order by m.created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ) x;
  if ids is null then return '[]'::jsonb; end if;
  update public.whatsapp_messages set claimed_at = now(), attempts = attempts + 1 where id = any (ids);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'kind', m.kind, 'mode', st.whatsapp_mode, 'restaurant', r.name, 'site_url', st.site_url,
      'business_phone', st.whatsapp, 'eta', st.delivery_eta,
      'order', case when o.id is null then null else jsonb_build_object(
        'code', o.code, 'status', o.status, 'name', split_part(o.customer_name, ' ', 1), 'phone', o.phone, 'total', o.total,
        'items', (select count(*) from public.order_items i where i.order_id = o.id), 'zone', o.zone_name, 'channel', o.channel) end,
      'report', case when m.kind = 'informe_semanal' then public.weekly_report(m.restaurant_id) end
    ) order by m.created_at), '[]')
    from public.whatsapp_messages m
    join public.restaurants r on r.id = m.restaurant_id
    join public.restaurant_settings st on st.restaurant_id = m.restaurant_id
    left join public.orders o on o.id = m.order_id
    where m.id = any (ids)
  );
end;
$$;

create function public.whatsapp_mark(p_id uuid, p_status public.wa_status, p_error text default null, p_provider text default null) returns void
language sql security definer set search_path = ''
as $$
  update public.whatsapp_messages
  set status = p_status, error = left(p_error, 200), provider_id = left(p_provider, 200),
      sent_at = case when p_status in ('enviado', 'simulado') then now() end, claimed_at = null
  where id = p_id
$$;

-- Despacho: pg_cron llama la función whatsapp con un secreto guardado en Vault (lo crea db-local / el montaje).
create function private.whatsapp_tick() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'jps_whatsapp_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'jps_whatsapp_secret');
begin
  if url is null or secret is null
     or not exists (select 1 from public.whatsapp_messages where status in ('pendiente', 'fallido') and attempts < 3) then
    return;
  end if;
  perform net.http_post(url := url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-jps-cron', secret),
                        body := '{}'::jsonb, timeout_milliseconds := 10000);
end;
$$;
select cron.schedule('jps-whatsapp', '* * * * *', 'select private.whatsapp_tick()');

-- Informe semanal (P11): lunes 8:00 a. m. de Bogotá (13:00 UTC) para cada restaurante con WhatsApp encendido.
create function private.queue_weekly_reports() returns void
language sql security definer set search_path = ''
as $$
  insert into public.whatsapp_messages (restaurant_id, kind)
  select st.restaurant_id, 'informe_semanal' from public.restaurant_settings st
  join public.restaurants r on r.id = st.restaurant_id and r.active
  where st.whatsapp_mode <> 'manual' and st.whatsapp is not null
$$;
select cron.schedule('jps-informe-semanal', '0 13 * * 1', 'select private.queue_weekly_reports()');

-- weekly_report con id explícito solo para el servidor (ya lo valida la función); aquí lo usa el despacho.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
revoke execute on function public.whatsapp_claim(integer), public.whatsapp_mark(uuid, public.wa_status, text, text) from authenticated;
grant execute on function public.whatsapp_claim(integer), public.whatsapp_mark(uuid, public.wa_status, text, text) to service_role;
