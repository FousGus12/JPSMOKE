-- =============================================================================
-- JP Smoke · Núcleo del esquema (F3, D24): restaurantes, equipo, ajustes, carta,
-- zonas, medios de pago, cupones, eventos, reseñas, clientes, pedidos, captación,
-- autorizaciones (Ley 1581) y auditoría.
-- Base compartida: TODA tabla lleva restaurant_id y RLS por restaurante.
-- Reglas: autorización solo en la base (§7); funciones privilegiadas con
-- search_path vacío y sin EXECUTE para anon; valores de enum en español.
-- =============================================================================

create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Las funciones nuevas no quedan ejecutables para anon por defecto.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('admin', 'operador');
create type public.order_channel as enum ('web', 'whatsapp', 'manual', 'rappi', 'didi');
create type public.order_status as enum ('nuevo', 'confirmado', 'en_cocina', 'en_camino', 'entregado', 'cancelado');
create type public.coupon_kind as enum ('porcentaje', 'valor', 'envio', 'regalo');
create type public.intro_mode as enum ('completa', 'aviso', 'ninguna');
create type public.protection_level as enum ('basica', 'recomendada', 'estricta');
create type public.consent_kind as enum ('datos_pedido', 'promociones', 'cupon_bienvenida', 'cotizacion');

-- ---------------------------------------------------------------------------
-- Restaurantes y equipo
-- ---------------------------------------------------------------------------
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  name text not null check (length(trim(name)) between 2 and 60),
  active boolean not null default true,
  plan text not null default 'esencial' check (plan in ('esencial', 'pro', 'completo')),
  order_prefix text not null default 'PED' check (order_prefix ~ '^[A-Z]{2,4}$'),
  created_at timestamptz not null default now()
);
comment on table public.restaurants is 'Cada cliente de la micro app (D23, D24).';

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 80),
  role public.staff_role not null default 'operador',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.staff (restaurant_id);
comment on table public.staff is 'Equipo de cada restaurante. Una cuenta pertenece a un solo restaurante. Sin registro público.';

-- Restaurante y rol de quien llama. security definer para que las políticas no se llamen a sí mismas.
create function public.my_restaurant() returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.restaurant_id from public.staff s
  join public.restaurants r on r.id = s.restaurant_id and r.active
  where s.user_id = (select auth.uid()) and s.active
$$;

create function public.my_role() returns public.staff_role
language sql stable security definer set search_path = ''
as $$ select s.role from public.staff s where s.user_id = (select auth.uid()) and s.active $$;

create function public.is_staff_of(rid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.my_restaurant() = rid, false) $$;

create function public.is_admin_of(rid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.my_restaurant() = rid and public.my_role() = 'admin', false) $$;

revoke execute on function public.my_restaurant(), public.my_role(), public.is_staff_of(uuid), public.is_admin_of(uuid) from public, anon;
grant execute on function public.my_restaurant(), public.my_role(), public.is_staff_of(uuid), public.is_admin_of(uuid) to authenticated;

-- Al crear una cuenta (solo el servidor, con app_metadata) nace su ficha de equipo.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := nullif(new.raw_app_meta_data ->> 'restaurant_id', '')::uuid;
begin
  if rid is null then
    return new; -- cuentas sin restaurante (soporte de CLOUP.CO) no entran a ningún panel
  end if;
  insert into public.staff (user_id, restaurant_id, full_name, role)
  values (
    new.id, rid,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    coalesce((new.raw_app_meta_data ->> 'role')::public.staff_role, 'operador')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.restaurants enable row level security;
create policy "público ve restaurantes activos" on public.restaurants for select to anon, authenticated using (active);

alter table public.staff enable row level security;
create policy "equipo ve su equipo" on public.staff for select to authenticated using (public.is_staff_of(restaurant_id));
create policy "admin edita su equipo" on public.staff for update to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
-- Nadie se cambia de restaurante ni de cuenta desde el navegador.
revoke update on public.staff from authenticated;
grant update (full_name, role, active) on public.staff to authenticated;

-- ---------------------------------------------------------------------------
-- Ajustes del restaurante (marca, inicio, canales, secciones, pedidos)
-- ---------------------------------------------------------------------------
create table public.restaurant_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  brand jsonb not null default '{}'::jsonb,        -- colores, fuentes, logo
  hero jsonb not null default '{}'::jsonb,         -- titular, antetítulo, texto
  sections jsonb not null default '{}'::jsonb,     -- secciones visibles
  channels jsonb not null default '{}'::jsonb,     -- rappi/didi: visible + url
  whatsapp text check (whatsapp ~ '^57[0-9]{10}$'),
  instagram text,
  tiktok text,
  hours jsonb not null default '[]'::jsonb,
  delivery_min integer not null default 0 check (delivery_min >= 0),
  delivery_eta text not null default '35–50 min',
  intro_mode public.intro_mode not null default 'completa',
  protection public.protection_level not null default 'recomendada',
  accepting_orders boolean not null default true,
  -- Punto físico (F10, D33): se muestra cuando abre; "recoger en tienda" se enciende aparte.
  store_open boolean not null default false,
  store_address text check (length(store_address) <= 160),
  store_maps_url text check (store_maps_url is null or store_maps_url ~ '^https://'),
  store_hours jsonb not null default '[]'::jsonb,
  pickup_enabled boolean not null default false,
  check (not pickup_enabled or (store_open and store_address is not null)),
  updated_at timestamptz not null default now()
);
alter table public.restaurant_settings enable row level security;
create policy "público ve ajustes de restaurantes activos" on public.restaurant_settings for select to anon, authenticated
  using (exists (select 1 from public.restaurants r where r.id = restaurant_id and r.active));
create policy "admin edita sus ajustes" on public.restaurant_settings for update to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));

-- ---------------------------------------------------------------------------
-- Carta
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 2 and 40),
  emoji text check (length(emoji) <= 8),
  note text check (length(note) <= 120),
  position smallint not null default 0,
  visible boolean not null default true,
  unique (restaurant_id, slug)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 2 and 60),
  badge text check (length(badge) <= 30),
  description text not null default '' check (length(description) <= 300),
  price integer not null check (price > 0 and price <= 2000000),
  combo_price integer check (combo_price is null or (combo_price > 0 and combo_price <= 2000000)),
  image_path text,
  available boolean not null default true,   -- false = agotado hoy (se ve, no se pide)
  featured boolean not null default false,   -- arsenal pesado
  hero boolean not null default false,       -- 4 del inicio
  visible boolean not null default true,
  position smallint not null default 0,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, slug)
);
create index on public.products (restaurant_id, category_id, position);

-- La categoría de un producto debe ser del mismo restaurante.
create function private.check_same_restaurant() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.categories c where c.id = new.category_id and c.restaurant_id = new.restaurant_id) then
    raise exception 'La categoría no es de este restaurante' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger products_same_restaurant before insert or update on public.products
  for each row execute function private.check_same_restaurant();

alter table public.categories enable row level security;
create policy "público ve categorías visibles" on public.categories for select to anon
  using (visible);
create policy "público ve categorías visibles (y el equipo todo lo suyo)" on public.categories for select to authenticated
  using (visible or public.is_staff_of(restaurant_id));
create policy "admin gestiona categorías" on public.categories for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));

alter table public.products enable row level security;
create policy "público ve productos visibles" on public.products for select to anon
  using (visible);
create policy "público ve productos visibles (y el equipo todo lo suyo)" on public.products for select to authenticated
  using (visible or public.is_staff_of(restaurant_id));
create policy "admin gestiona productos" on public.products for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));

-- ---------------------------------------------------------------------------
-- Domicilios y pagos (D17)
-- ---------------------------------------------------------------------------
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 40),
  fee integer not null default 0 check (fee between 0 and 100000),
  active boolean not null default true,
  position smallint not null default 0,
  unique (restaurant_id, name)
);
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text not null check (length(trim(label)) between 2 and 30),
  asks_change boolean not null default false, -- efectivo: "¿con cuánto pagas?"
  active boolean not null default true,
  position smallint not null default 0,
  unique (restaurant_id, code)
);
alter table public.delivery_zones enable row level security;
create policy "público ve zonas" on public.delivery_zones for select to anon, authenticated using (true);
create policy "admin gestiona zonas" on public.delivery_zones for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
alter table public.payment_methods enable row level security;
create policy "público ve medios de pago activos" on public.payment_methods for select to anon
  using (active);
create policy "público ve medios de pago activos (y el equipo todo lo suyo)" on public.payment_methods for select to authenticated
  using (active or public.is_staff_of(restaurant_id));
create policy "admin gestiona medios de pago" on public.payment_methods for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));

-- ---------------------------------------------------------------------------
-- Cupones y eventos
-- ---------------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  code extensions.citext not null check (code ~ '^[A-Za-z0-9]{4,20}$'),
  kind public.coupon_kind not null,
  value integer not null default 0 check (value >= 0),
  min_total integer not null default 0 check (min_total >= 0),
  title text not null check (length(trim(title)) between 3 and 60),
  detail text not null default '' check (length(detail) <= 160),
  visible boolean not null default false,   -- sale en el sitio; si no, es secreto
  active boolean not null default true,
  starts_on date,
  ends_on date,
  max_uses integer check (max_uses is null or max_uses > 0),
  once_per_phone boolean not null default true,
  uses integer not null default 0,
  check (kind <> 'porcentaje' or value between 1 and 100),
  check (max_uses is null or uses <= max_uses),
  unique (restaurant_id, code)
);
alter table public.coupons enable row level security;
-- El público solo ve los cupones visibles y vigentes; los secretos solo los valida el servidor.
create policy "público ve cupones visibles" on public.coupons for select to anon
  using ((visible and active and (ends_on is null or ends_on >= (now() at time zone 'America/Bogota')::date)));
create policy "público ve cupones visibles (y el equipo todo lo suyo)" on public.coupons for select to authenticated
  using ((visible and active and (ends_on is null or ends_on >= (now() at time zone 'America/Bogota')::date)) or public.is_staff_of(restaurant_id));
create policy "admin gestiona cupones" on public.coupons for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
revoke select on public.coupons from anon;
grant select (id, restaurant_id, code, kind, value, min_total, title, detail, ends_on) on public.coupons to anon;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  title text not null check (length(trim(title)) between 3 and 60),
  kicker text not null default '' check (length(kicker) <= 40),
  body text not null default '' check (length(body) <= 240),
  image_path text,
  cta_label text not null default 'Pedir ahora' check (length(cta_label) <= 30),
  cta_href text not null default '#carta' check (cta_href ~ '^#[a-z-]+$'),
  show_intro boolean not null default false,
  show_strip boolean not null default false,
  show_section boolean not null default true,
  captures_leads boolean not null default false,
  coupon_id uuid references public.coupons (id) on delete set null,
  active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date not null,
  position smallint not null default 0,
  check (ends_on >= starts_on)
);
-- Solo un evento de bienvenida por restaurante.
create unique index events_one_intro on public.events (restaurant_id) where show_intro;
alter table public.events enable row level security;
create policy "público ve eventos vigentes" on public.events for select to anon
  using ((active and (now() at time zone 'America/Bogota')::date between starts_on and ends_on));
create policy "público ve eventos vigentes (y el equipo todo lo suyo)" on public.events for select to authenticated
  using ((active and (now() at time zone 'America/Bogota')::date between starts_on and ends_on) or public.is_staff_of(restaurant_id));
create policy "admin gestiona eventos" on public.events for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  author text not null check (length(trim(author)) between 2 and 40),
  stars smallint not null check (stars between 1 and 5),
  body text not null check (length(trim(body)) between 5 and 400),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
create policy "público ve reseñas aprobadas" on public.reviews for select to anon
  using (approved);
create policy "público ve reseñas aprobadas (y el equipo todo lo suyo)" on public.reviews for select to authenticated
  using (approved or public.is_staff_of(restaurant_id));
create policy "admin gestiona reseñas" on public.reviews for all to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));

-- ---------------------------------------------------------------------------
-- Clientes, pedidos, captación (datos personales: nunca para anon)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null check (phone ~ '^3[0-9]{9}$'),
  name text not null check (length(trim(name)) between 2 and 80),
  trusted boolean not null default false,
  blocked boolean not null default false,
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  unique (restaurant_id, phone)
);
alter table public.customers enable row level security;
create policy "admin ve sus clientes" on public.customers for select to authenticated using (public.is_admin_of(restaurant_id));
create policy "admin edita sus clientes" on public.customers for update to authenticated
  using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
revoke update on public.customers from authenticated;
grant update (name, trusted, blocked, notes) on public.customers to authenticated;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  number integer not null,
  code text not null, -- prefijo del restaurante + consecutivo, p. ej. JP-0042
  track_hash text not null, -- sha256 del token del enlace único (D21); el token nunca se guarda
  customer_id uuid references public.customers (id) on delete set null,
  channel public.order_channel not null default 'web',
  fulfillment text not null default 'domicilio' check (fulfillment in ('domicilio', 'recoger')),
  status public.order_status not null default 'nuevo',
  customer_name text not null,
  phone text not null check (phone ~ '^3[0-9]{9}$'),
  address text not null check (length(trim(address)) between 8 and 160),
  barrio text not null default '' check (length(barrio) <= 60),
  zone_name text not null,
  notes text not null default '' check (length(notes) <= 200),
  payment_label text not null,
  cash_with integer check (cash_with is null or cash_with >= 0),
  subtotal integer not null check (subtotal >= 0),
  discount integer not null default 0 check (discount >= 0),
  delivery_fee integer not null default 0 check (delivery_fee >= 0),
  total integer not null check (total >= 0),
  coupon_code text,
  gift text,
  cancel_reason text check (length(cancel_reason) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, number),
  unique (restaurant_id, code)
);
create index on public.orders (restaurant_id, created_at desc);
create index on public.orders (restaurant_id, status) where status not in ('entregado', 'cancelado');
create index on public.orders (restaurant_id, phone, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name text not null,
  qty smallint not null check (qty between 1 and 30),
  combo boolean not null default false,
  unit_price integer not null check (unit_price >= 0)
);
create index on public.order_items (order_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  status public.order_status not null,
  by_user uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index on public.order_events (order_id, at);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
-- El admin ve todos los pedidos de su restaurante; el operador solo los de las últimas 36 h (lo que muestra
-- el tablero), así no reconstruye ventas históricas por la API (D19, auditoría 2026-11-02). Cambios por funciones.
create policy "equipo ve sus pedidos" on public.orders for select to authenticated
  using (public.is_admin_of(restaurant_id) or (public.is_staff_of(restaurant_id) and created_at > now() - interval '36 hours'));
create policy "equipo ve productos de sus pedidos" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy "equipo ve historial de sus pedidos" on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
revoke insert, update, delete on public.orders, public.order_items, public.order_events from anon, authenticated;
revoke select (track_hash) on public.orders from authenticated;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  phone text not null check (phone ~ '^3[0-9]{9}$'),
  coupon_id uuid references public.coupons (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, phone)
);
alter table public.leads enable row level security;
create policy "admin ve su captación" on public.leads for select to authenticated using (public.is_admin_of(restaurant_id));

create table public.consents (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null,
  kind public.consent_kind not null,
  version text not null,
  granted boolean not null,
  source text not null,
  at timestamptz not null default now()
);
alter table public.consents enable row level security;
create policy "admin ve sus autorizaciones" on public.consents for select to authenticated using (public.is_admin_of(restaurant_id));

create table public.audit_log (
  id bigint generated always as identity primary key,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy "admin ve su auditoría" on public.audit_log for select to authenticated using (public.is_admin_of(restaurant_id));

-- Límites de intentos (antifraude): solo el servidor.
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Contador de pedidos frenados (P12): lo escribe el servidor, lo ve el admin.
create table public.blocked_attempts (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  reason text not null check (reason in ('robot', 'repetido', 'bloqueado', 'fuera_de_zona', 'cerrado', 'precio')),
  at timestamptz not null default now()
);
create index on public.blocked_attempts (restaurant_id, at desc);
alter table public.blocked_attempts enable row level security;
create policy "admin ve intentos frenados" on public.blocked_attempts for select to authenticated using (public.is_admin_of(restaurant_id));

-- updated_at
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger touch before update on public.orders for each row execute function private.touch_updated_at();
create trigger touch before update on public.products for each row execute function private.touch_updated_at();
create trigger touch before update on public.restaurant_settings for each row execute function private.touch_updated_at();
