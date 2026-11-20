// Datos del editor (F6): carta, fotos, ajustes de la página, zonas, pagos y publicar. Todo pasa por RLS (admin con aal2).
import { getSupabase } from '../lib/supabase';
import { readPublicEnv } from '../lib/env';
import { fitInside, mediaUrl } from '../core/media';

export interface EditCategory {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  note: string | null;
  position: number;
  visible: boolean;
}
export interface EditProduct {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  badge: string | null;
  description: string;
  price: number;
  combo_price: number | null;
  image_path: string | null;
  available: boolean;
  featured: boolean;
  hero: boolean;
  visible: boolean;
  position: number;
}
const PRODUCT_COLUMNS =
  'id, category_id, slug, name, badge, description, price, combo_price, image_path, available, featured, hero, visible, position';

function fail(error: { message: string; code?: string } | null, what: string): never | void {
  if (!error) return;
  if (error.code === '23505') throw new Error(`Ya existe ${what} con ese nombre.`);
  if (error.code === '42501') throw new Error('No tienes permiso para este cambio.');
  if (error.code === '23514' || error.code === '22P02') throw new Error(`Revisa los datos de ${what}.`);
  throw new Error(`No se pudo guardar ${what}.`);
}

export function photoUrl(path: string | null): string | null {
  const env = readPublicEnv();
  return mediaUrl(path, env.PUBLIC_MEDIA_BASE, env.PUBLIC_SUPABASE_URL);
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'producto'
  );
}

export async function loadCatalog(
  restaurantId: string,
): Promise<{ categories: EditCategory[]; products: EditProduct[] }> {
  const supabase = getSupabase();
  const [categories, products] = await Promise.all([
    supabase
      .from('categories')
      .select('id, slug, name, emoji, note, position, visible')
      .eq('restaurant_id', restaurantId)
      .order('position'),
    supabase.from('products').select(PRODUCT_COLUMNS).eq('restaurant_id', restaurantId).order('position'),
  ]);
  if (categories.error || products.error) throw new Error('No pudimos cargar la carta.');
  return { categories: categories.data ?? [], products: (products.data ?? []) as EditProduct[] };
}

export async function updateProduct(id: string, patch: Partial<EditProduct>): Promise<void> {
  const { error } = await getSupabase().from('products').update(patch).eq('id', id);
  fail(error, 'el producto');
}

export async function createProduct(restaurantId: string, product: Omit<EditProduct, 'id'>): Promise<void> {
  const { error } = await getSupabase()
    .from('products')
    .insert({ ...product, restaurant_id: restaurantId });
  fail(error, 'un producto');
}

/** Borrar solo si nunca se vendió; si ya tiene pedidos, se oculta (la historia de ventas se conserva). */
export async function removeProduct(id: string): Promise<'borrado' | 'oculto'> {
  const supabase = getSupabase();
  const { count } = await supabase
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', id);
  if (count) {
    await updateProduct(id, { visible: false });
    return 'oculto';
  }
  const { error } = await supabase.from('products').delete().eq('id', id);
  fail(error, 'el producto');
  return 'borrado';
}

export async function updateCategory(id: string, patch: Partial<EditCategory>): Promise<void> {
  const { error } = await getSupabase().from('categories').update(patch).eq('id', id);
  fail(error, 'la categoría');
}

export async function createCategory(restaurantId: string, name: string, position: number): Promise<void> {
  const { error } = await getSupabase()
    .from('categories')
    .insert({ restaurant_id: restaurantId, name: name.trim(), slug: slugify(name), position });
  fail(error, 'una categoría');
}

/**
 * Reduce a 1200 px y vuelve a codificar: así también se quitan los metadatos (EXIF, ubicación).
 * WebP si el navegador sabe generarlo; Safari en iPhone no lo genera desde canvas y entrega PNG, así que ahí va JPG.
 */
export async function compressPhoto(file: File): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  if (!/^image\//.test(file.type)) throw new Error('El archivo debe ser una imagen.');
  if (file.size > 15 * 1024 * 1024) throw new Error('La foto pesa más de 15 MB.');
  const bitmap = await createImageBitmap(file);
  const size = fitInside(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode('image/webp', 0.82);
  if (webp?.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const jpeg = await encode('image/jpeg', 0.85);
  if (jpeg?.type === 'image/jpeg') return { blob: jpeg, ext: 'jpg' };
  throw new Error('No se pudo procesar la foto.');
}

export async function uploadPhoto(restaurantId: string, file: File): Promise<string> {
  const { blob, ext } = await compressPhoto(file);
  const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await getSupabase()
    .storage.from('carta')
    .upload(path, blob, { contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg', upsert: false });
  if (error) throw new Error('No se pudo subir la foto.');
  return path;
}

export interface SiteSettings {
  hero: { title?: string; kicker?: string; text?: string };
  sections: Record<string, boolean>;
  channels: Record<string, { visible: boolean; url: string }>;
  blocks: {
    promo?: { visible?: boolean; tag?: string; title?: string; text?: string; cta?: string; coupon?: string };
    tour?: { kicker?: string; title?: string; text?: string; cards?: Array<{ title: string; text: string }> };
  };
  whatsapp: string | null;
  instagram: string | null;
  tiktok: string | null;
  hours: Array<[string, string]>;
  delivery_min: number;
  delivery_eta: string;
  accepting_orders: boolean;
  store_open: boolean;
  store_address: string | null;
  store_maps_url: string | null;
  store_lat: number | null;
  store_lng: number | null;
  store_hours: Array<[string, string]>;
  pickup_enabled: boolean;
  published_at: string | null;
  updated_at: string;
}
const SETTINGS_COLUMNS =
  'hero, sections, channels, blocks, whatsapp, instagram, tiktok, hours, delivery_min, delivery_eta, accepting_orders, store_open, store_address, store_maps_url, store_lat, store_lng, store_hours, pickup_enabled, published_at, updated_at';

export async function loadSettings(restaurantId: string): Promise<SiteSettings> {
  const { data, error } = await getSupabase()
    .from('restaurant_settings')
    .select(SETTINGS_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .single();
  if (error || !data) throw new Error('No pudimos cargar los ajustes.');
  return data as unknown as SiteSettings;
}

export async function saveSettings(
  restaurantId: string,
  patch: Partial<Omit<SiteSettings, 'published_at' | 'updated_at'>>,
): Promise<void> {
  const { error } = await getSupabase()
    .from('restaurant_settings')
    .update(patch)
    .eq('restaurant_id', restaurantId);
  fail(error, 'los ajustes');
}

/** Las 19 localidades urbanas de Bogotá con su código IDECA (D44): el mapa de cobertura las une con las zonas. */
export const BOGOTA_LOCALITIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'Usaquén' },
  { code: '02', name: 'Chapinero' },
  { code: '03', name: 'Santa Fe' },
  { code: '04', name: 'San Cristóbal' },
  { code: '05', name: 'Usme' },
  { code: '06', name: 'Tunjuelito' },
  { code: '07', name: 'Bosa' },
  { code: '08', name: 'Kennedy' },
  { code: '09', name: 'Fontibón' },
  { code: '10', name: 'Engativá' },
  { code: '11', name: 'Suba' },
  { code: '12', name: 'Barrios Unidos' },
  { code: '13', name: 'Teusaquillo' },
  { code: '14', name: 'Los Mártires' },
  { code: '15', name: 'Antonio Nariño' },
  { code: '16', name: 'Puente Aranda' },
  { code: '17', name: 'La Candelaria' },
  { code: '18', name: 'Rafael Uribe Uribe' },
  { code: '19', name: 'Ciudad Bolívar' },
];

export const LAT_RANGE = [4.4, 4.9] as const;
export const LNG_RANGE = [-74.3, -73.9] as const;

/** Valida una coordenada escrita por el dueño. Vacío = sin coordenada (null). */
export function parseCoordinate(
  text: string,
  kind: 'lat' | 'lng',
): { ok: true; value: number | null } | { ok: false; message: string } {
  const clean = text.trim().replace(/°/g, '').replace(',', '.');
  if (!clean) return { ok: true, value: null };
  const value = Number(clean);
  const [min, max] = kind === 'lat' ? LAT_RANGE : LNG_RANGE;
  if (!/^-?\d+(\.\d+)?$/.test(clean) || value < min || value > max)
    return {
      ok: false,
      message:
        kind === 'lat'
          ? `La latitud de Bogotá está entre ${min} y ${max} (p. ej. 4.68).`
          : `La longitud de Bogotá está entre ${min} y ${max} (p. ej. -74.08).`,
    };
  return { ok: true, value: Math.round(value * 1e6) / 1e6 };
}

/** Acepta lo que Google Maps copia con clic derecho: "4.68, -74.08" (también con punto y coma o espacio). */
export function parseCoordinatePair(text: string): { lat: string; lng: string } | null {
  const match = text
    .trim()
    .replace(/°/g, '')
    .match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  return match ? { lat: match[1] as string, lng: match[2] as string } : null;
}

/** Enlaces de la página: solo https://. */
export const isHttps = (url: string): boolean => /^https:\/\/[^\s/]+/i.test(url.trim());

export interface EditZone {
  id: string;
  name: string;
  fee: number;
  locality_code: string | null;
  active: boolean;
  position: number;
}
export interface EditPayment {
  id: string;
  code: string;
  label: string;
  asks_change: boolean;
  active: boolean;
  position: number;
}
export async function loadZonesAndPayments(
  restaurantId: string,
): Promise<{ zones: EditZone[]; payments: EditPayment[] }> {
  const supabase = getSupabase();
  const [zones, payments] = await Promise.all([
    supabase
      .from('delivery_zones')
      .select('id, name, fee, locality_code, active, position')
      .eq('restaurant_id', restaurantId)
      .order('position'),
    supabase
      .from('payment_methods')
      .select('id, code, label, asks_change, active, position')
      .eq('restaurant_id', restaurantId)
      .order('position'),
  ]);
  if (zones.error || payments.error) throw new Error('No pudimos cargar zonas y pagos.');
  return { zones: zones.data ?? [], payments: payments.data ?? [] };
}
export async function upsertZone(
  restaurantId: string,
  zone: Partial<EditZone> & { name: string },
): Promise<void> {
  const supabase = getSupabase();
  const { error } = zone.id
    ? await supabase.from('delivery_zones').update(zone).eq('id', zone.id)
    : await supabase.from('delivery_zones').insert({ ...zone, restaurant_id: restaurantId });
  fail(error, 'la zona');
}
export async function upsertPayment(
  restaurantId: string,
  method: Partial<EditPayment> & { label: string },
): Promise<void> {
  const supabase = getSupabase();
  const { error } = method.id
    ? await supabase.from('payment_methods').update(method).eq('id', method.id)
    : await supabase
        .from('payment_methods')
        .insert({ ...method, code: slugify(method.label), restaurant_id: restaurantId });
  fail(error, 'el medio de pago');
}
export async function deletePayment(id: string): Promise<void> {
  const { error } = await getSupabase().from('payment_methods').delete().eq('id', id);
  fail(error, 'el medio de pago');
}

export type PublishResult = { ok: true; published_at: string } | { ok: false; message: string };
export async function publishSite(): Promise<PublishResult> {
  const supabase = getSupabase();
  const env = readPublicEnv();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { ok: false, message: 'Tu sesión venció. Vuelve a entrar.' };
  const res = await fetch(`${env.PUBLIC_SUPABASE_URL}/functions/v1/publicar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: env.PUBLIC_SUPABASE_ANON_KEY },
  }).catch(() => null);
  const body = (await res?.json().catch(() => ({}))) as {
    ok?: boolean;
    published_at?: string;
    error?: string;
  };
  if (res?.ok && body.ok && body.published_at) return { ok: true, published_at: body.published_at };
  const messages: Record<string, string> = {
    sin_permiso: 'Solo el administrador con su código de seguridad puede publicar.',
    muy_seguido: 'Espera un minuto entre publicaciones.',
    deploy_hook: 'No se pudo regenerar el sitio. Inténtalo en unos minutos.',
  };
  return { ok: false, message: messages[body.error ?? ''] ?? 'No se pudo publicar. Revisa tu conexión.' };
}
