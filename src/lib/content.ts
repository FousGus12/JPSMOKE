import { getSupabase } from './supabase';
import { readPublicEnv } from './env';
import { mediaUrl } from '../core/media';

export interface Product {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  badge: string | null;
  description: string;
  price: number;
  comboPrice: number | null;
  image: string | null;
  available: boolean;
  featured: boolean;
  hero: boolean;
}
export interface Category {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  note: string | null;
  /** Categoría de adiciones (D40). */
  isAddons: boolean;
}
export interface Zone {
  id: string;
  name: string;
  fee: number;
  active: boolean;
  /** Localidad de Bogotá (IDECA, 2 dígitos) para el mapa y el verificador (D44). */
  localityCode: string | null;
}
export interface PaymentMethod {
  code: string;
  label: string;
  asksChange: boolean;
}
export interface Coupon {
  code: string;
  kind: 'porcentaje' | 'valor' | 'envio' | 'regalo';
  value: number;
  minTotal: number;
  title: string;
  detail: string;
  endsOn: string | null;
}
export interface SiteEvent {
  id: string;
  title: string;
  kicker: string;
  body: string;
  image: string | null;
  ctaLabel: string;
  ctaHref: string;
  showIntro: boolean;
  showStrip: boolean;
  showSection: boolean;
  capturesLeads: boolean;
}
export interface Review {
  author: string;
  stars: number;
  body: string;
}
export interface Blocks {
  promo: {
    visible: boolean;
    tag: string;
    title: string;
    text: string;
    cta: string;
    coupon: string;
    image: string | null;
  };
  tour: {
    kicker: string;
    title: string;
    text: string;
    cards: Array<{ title: string; text: string }>;
    image: string | null;
  };
}
export interface SiteData {
  restaurant: { id: string; slug: string; name: string };
  hero: { title: string; kicker: string; text: string };
  blocks: Blocks;
  sections: Record<string, boolean>;
  channels: Record<'rappi' | 'didi', { visible: boolean; url: string }>;
  whatsapp: string | null;
  instagram: string | null;
  tiktok: string | null;
  hours: Array<[string, string]>;
  /** Punto físico (D33): se muestra solo con `open`; recoger exige local abierto y dirección. */
  store: {
    open: boolean;
    address: string;
    mapsUrl: string;
    hours: Array<[string, string]>;
    pickup: boolean;
    /** Coordenadas del local para el mapa (D44); null si no se han puesto. */
    lat: number | null;
    lng: number | null;
  };
  deliveryMin: number;
  deliveryEta: string;
  introMode: 'completa' | 'aviso' | 'ninguna';
  acceptingOrders: boolean;
  categories: Category[];
  products: Product[];
  zones: Zone[];
  payments: PaymentMethod[];
  coupons: Coupon[];
  events: SiteEvent[];
  reviews: Review[];
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error || result.data === null)
    throw new Error(`No se pudo leer ${what}: ${result.error?.message ?? 'vacío'}`);
  return result.data as NonNullable<T>;
}

/** Lee el contenido publicado del restaurante de este despliegue (D24) en el build. Solo datos públicos (RLS). */
export async function loadSiteData(): Promise<SiteData> {
  const supabase = getSupabase();
  const env = readPublicEnv();
  const media = (path: string | null) => mediaUrl(path, env.PUBLIC_MEDIA_BASE, env.PUBLIC_SUPABASE_URL);
  const restaurant = must(
    await supabase
      .from('restaurants')
      .select('id, slug, name')
      .eq('slug', env.PUBLIC_RESTAURANT_SLUG)
      .single(),
    `el restaurante "${env.PUBLIC_RESTAURANT_SLUG}"`,
  );
  const rid = restaurant.id;
  const [settings, categories, products, zones, payments, coupons, events, reviews] = await Promise.all([
    supabase
      .from('restaurant_settings')
      .select(
        'hero, blocks, sections, channels, whatsapp, instagram, tiktok, hours, delivery_min, delivery_eta, intro_mode, accepting_orders, store_open, store_address, store_maps_url, store_hours, pickup_enabled, store_lat, store_lng',
      )
      .eq('restaurant_id', rid)
      .single(),
    supabase
      .from('categories')
      .select('id, slug, name, emoji, note, is_addons')
      .eq('restaurant_id', rid)
      .order('position'),
    supabase
      .from('products')
      .select(
        'id, category_id, slug, name, badge, description, price, combo_price, image_path, available, featured, hero',
      )
      .eq('restaurant_id', rid)
      .order('position'),
    supabase
      .from('delivery_zones')
      .select('id, name, fee, active, locality_code')
      .eq('restaurant_id', rid)
      .order('position'),
    supabase
      .from('payment_methods')
      .select('code, label, asks_change')
      .eq('restaurant_id', rid)
      .order('position'),
    supabase
      .from('coupons')
      .select('code, kind, value, min_total, title, detail, ends_on')
      .eq('restaurant_id', rid),
    supabase
      .from('events')
      .select(
        'id, title, kicker, body, image_path, cta_label, cta_href, show_intro, show_strip, show_section, captures_leads',
      )
      .eq('restaurant_id', rid)
      .order('position'),
    supabase.from('reviews').select('author, stars, body').eq('restaurant_id', rid).order('created_at'),
  ]);
  const st = must(settings, 'los ajustes');
  return {
    restaurant,
    hero: { title: restaurant.name, kicker: '', text: '', ...(st.hero as object) },
    blocks: readBlocks(st.blocks as Partial<Record<'promo' | 'tour', Record<string, unknown>>> | null, media),
    sections: (st.sections ?? {}) as Record<string, boolean>,
    channels: {
      rappi: { visible: false, url: '' },
      didi: { visible: false, url: '' },
      ...(st.channels as object),
    },
    whatsapp: st.whatsapp,
    instagram: st.instagram,
    tiktok: st.tiktok,
    hours: (st.hours ?? []) as Array<[string, string]>,
    store: {
      open: st.store_open,
      address: st.store_address ?? '',
      mapsUrl: st.store_maps_url ?? '',
      hours: (st.store_hours ?? []) as Array<[string, string]>,
      pickup: st.pickup_enabled,
      lat: st.store_lat === null ? null : Number(st.store_lat),
      lng: st.store_lng === null ? null : Number(st.store_lng),
    },
    deliveryMin: st.delivery_min,
    deliveryEta: st.delivery_eta,
    introMode: st.intro_mode,
    acceptingOrders: st.accepting_orders,
    categories: must(categories, 'las categorías').map(({ is_addons, ...category }) => ({
      ...category,
      isAddons: is_addons,
    })),
    products: must(products, 'la carta').map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      slug: row.slug,
      name: row.name,
      badge: row.badge,
      description: row.description,
      price: row.price,
      comboPrice: row.combo_price,
      image: media(row.image_path),
      available: row.available,
      featured: row.featured,
      hero: row.hero,
    })),
    zones: must(zones, 'las zonas').map(({ locality_code, ...zone }) => ({
      ...zone,
      localityCode: locality_code,
    })),
    payments: must(payments, 'los medios de pago').map((row) => ({
      code: row.code,
      label: row.label,
      asksChange: row.asks_change,
    })),
    coupons: must(coupons, 'los cupones').map((row) => ({
      code: row.code,
      kind: row.kind,
      value: row.value,
      minTotal: row.min_total,
      title: row.title,
      detail: row.detail,
      endsOn: row.ends_on,
    })),
    events: must(events, 'los eventos').map((row) => ({
      id: row.id,
      title: row.title,
      kicker: row.kicker,
      body: row.body,
      image: media(row.image_path),
      ctaLabel: row.cta_label,
      ctaHref: row.cta_href,
      showIntro: row.show_intro,
      showStrip: row.show_strip,
      showSection: row.show_section,
      capturesLeads: row.captures_leads,
    })),
    reviews: must(reviews, 'las reseñas'),
  };
}

/** Lo que el navegador necesita para el carrito, el pedido y la bienvenida (sin datos privados). */
export function clientData(site: SiteData, env = readPublicEnv()) {
  return {
    restaurant: site.restaurant.slug,
    restaurantId: site.restaurant.id,
    restaurantName: site.restaurant.name,
    supabaseUrl: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    turnstileKey: env.PUBLIC_TURNSTILE_SITE_KEY,
    whatsapp: site.whatsapp,
    deliveryMin: site.deliveryMin,
    deliveryEta: site.deliveryEta,
    introMode: site.introMode,
    acceptingOrders: site.acceptingOrders,
    pickupEnabled: site.store.pickup,
    storeAddress: site.store.address,
    products: site.products.map(({ id, name, price, comboPrice, image, available, categoryId }) => ({
      id,
      name,
      price,
      comboPrice,
      image,
      available,
      addon: site.categories.some((category) => category.id === categoryId && category.isAddons),
    })),
    zones: site.zones.filter((zone) => zone.active),
    payments: site.payments,
    coupons: site.coupons,
    introEvent: site.events.find((event) => event.showIntro) ?? null,
  };
}
export type ClientData = ReturnType<typeof clientData>;

/** Bloques editables (F6) con valores por defecto si el restaurante aún no los llenó. */
function readBlocks(
  raw: Partial<Record<'promo' | 'tour', Record<string, unknown>>> | null,
  media: (path: string | null) => string | null,
): Blocks {
  const promo = raw?.promo ?? {};
  const tour = raw?.tour ?? {};
  const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
  const cards = Array.isArray(tour.cards) ? (tour.cards as Array<{ title?: unknown; text?: unknown }>) : [];
  return {
    promo: {
      visible: promo.visible !== false && Boolean(text(promo.title)),
      tag: text(promo.tag),
      title: text(promo.title),
      text: text(promo.text),
      cta: text(promo.cta, 'Reclamar mi promoción'),
      coupon: text(promo.coupon),
      image: media(text(promo.image, 'sitio/brasas.webp')),
    },
    tour: {
      kicker: text(tour.kicker, 'Eventos privados'),
      title: text(tour.title, 'Llevamos el barril'),
      text: text(tour.text),
      cards: cards
        .filter((card) => text(card.title))
        .map((card) => ({ title: text(card.title), text: text(card.text) })),
      image: media(text(tour.image, 'sitio/costillas-parrilla.webp')),
    },
  };
}
