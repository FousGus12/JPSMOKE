-- =============================================================================
-- JP Smoke · Promociones, eventos y cotizaciones (F7). Cupones y eventos ya tienen
-- RLS de admin desde el núcleo; aquí: solicitudes de cotización (JP on Tour) y
-- cambio atómico del evento de bienvenida.
-- =============================================================================

create type public.quote_status as enum ('nueva', 'contactada', 'cerrada');

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind text not null check (kind in ('Catering al barril', 'Pedido corporativo', 'Otro')),
  name text not null check (length(trim(name)) between 2 and 80),
  phone text not null check (phone ~ '^3[0-9]{9}$'),
  event_date date,
  guests integer check (guests is null or guests between 1 and 5000),
  message text not null check (length(trim(message)) between 5 and 1000),
  status public.quote_status not null default 'nueva',
  created_at timestamptz not null default now()
);
create index on public.quotes (restaurant_id, created_at desc);
alter table public.quotes enable row level security;
create policy "admin ve sus cotizaciones" on public.quotes for select to authenticated using (public.is_admin_of(restaurant_id));
create policy "admin cambia estado de cotizaciones" on public.quotes for update to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
revoke update on public.quotes from authenticated;
grant update (status) on public.quotes to authenticated;
revoke insert, delete on public.quotes from anon, authenticated;

-- Solicitud pública (la llama la Edge Function cotizar después de campo trampa, Turnstile y límite por IP).
create function public.submit_quote(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid;
  ph text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
begin
  select id into rid from public.restaurants where slug = p ->> 'restaurant' and active;
  if rid is null then return jsonb_build_object('ok', false, 'reason', 'datos'); end if;
  if (select count(*) from public.quotes q where q.restaurant_id = rid and q.phone = ph and q.created_at > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'repetido');
  end if;
  insert into public.quotes (restaurant_id, kind, name, phone, event_date, guests, message)
  values (rid, p ->> 'kind', trim(p ->> 'name'), ph, nullif(p ->> 'event_date', '')::date,
          nullif(p ->> 'guests', '')::integer, trim(p ->> 'message'));
  insert into public.consents (restaurant_id, phone, kind, version, granted, source)
  values (rid, ph, 'cotizacion', coalesce(p ->> 'consent_version', 'v1'), true, 'cotización web');
  return jsonb_build_object('ok', true);
exception when check_violation or invalid_text_representation or invalid_datetime_format then
  return jsonb_build_object('ok', false, 'reason', 'datos');
end;
$$;
revoke execute on function public.submit_quote(jsonb) from public, anon, authenticated;
grant execute on function public.submit_quote(jsonb) to service_role;

-- Solo un evento de bienvenida: activar uno apaga los demás en la misma operación.
create function public.set_intro_event(p_event uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
begin
  if rid is null or public.my_role() <> 'admin' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  update public.events set show_intro = false where restaurant_id = rid and show_intro and id is distinct from p_event;
  if p_event is not null then
    update public.events set show_intro = true where id = p_event and restaurant_id = rid;
    if not found then raise exception 'Evento no encontrado' using errcode = '42501'; end if;
  end if;
end;
$$;
grant execute on function public.set_intro_event(uuid) to authenticated;

create trigger audit after insert or update or delete on public.events for each row execute function private.audit_change();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
