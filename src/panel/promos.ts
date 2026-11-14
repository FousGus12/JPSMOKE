// Datos de promociones, cupones, captación, eventos y cotizaciones (F7). Todo pasa por RLS (admin con aal2).
import { getSupabase } from '../lib/supabase';

export type CouponKind = 'porcentaje' | 'valor' | 'envio' | 'regalo';
export interface EditCoupon {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  min_total: number;
  title: string;
  detail: string;
  visible: boolean;
  active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  once_per_phone: boolean;
  uses: number;
}
export const KIND_LABEL: Record<CouponKind, string> = {
  porcentaje: '% de descuento',
  valor: 'Valor fijo',
  envio: 'Domicilio gratis',
  regalo: 'Producto de regalo',
};

function fail(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return;
  if (error.code === '23505') throw new Error(`Ya existe ${what} con ese código.`);
  if (error.code === '42501') throw new Error('No tienes permiso para este cambio.');
  if (error.code === '23514' || error.code === '22P02' || error.code === '22007')
    throw new Error(`Revisa los datos de ${what}.`);
  throw new Error(`No se pudo guardar ${what}.`);
}

export async function loadCoupons(restaurantId: string): Promise<EditCoupon[]> {
  const { data, error } = await getSupabase()
    .from('coupons')
    .select(
      'id, code, kind, value, min_total, title, detail, visible, active, starts_on, ends_on, max_uses, once_per_phone, uses',
    )
    .eq('restaurant_id', restaurantId)
    .order('code');
  if (error) throw new Error('No pudimos cargar los cupones.');
  return (data ?? []) as EditCoupon[];
}

export async function saveCoupon(restaurantId: string, coupon: Partial<EditCoupon>): Promise<void> {
  const supabase = getSupabase();
  const { id, ...rest } = coupon;
  // Los usos los cuenta el servidor; nunca se envían desde el panel.
  const fields = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== 'uses'));
  const { error } = id
    ? await supabase.from('coupons').update(fields).eq('id', id)
    : await supabase.from('coupons').insert({ ...fields, restaurant_id: restaurantId });
  fail(error, 'el cupón');
}

export interface Lead {
  name: string;
  phone: string;
  created_at: string;
  coupon: string | null;
}
export async function loadLeads(restaurantId: string): Promise<Lead[]> {
  const { data, error } = await getSupabase()
    .from('leads')
    .select('name, phone, created_at, coupons(code)')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error('No pudimos cargar la captación.');
  return (data ?? []).map((row) => {
    const coupon = row.coupons as unknown as { code: string } | null;
    return { name: row.name, phone: row.phone, created_at: row.created_at, coupon: coupon?.code ?? null };
  });
}

export interface EditEvent {
  id: string;
  title: string;
  kicker: string;
  body: string;
  image_path: string | null;
  cta_label: string;
  cta_href: string;
  show_intro: boolean;
  show_strip: boolean;
  show_section: boolean;
  captures_leads: boolean;
  coupon_id: string | null;
  active: boolean;
  starts_on: string;
  ends_on: string;
  position: number;
}
export async function loadEvents(restaurantId: string): Promise<EditEvent[]> {
  const { data, error } = await getSupabase()
    .from('events')
    .select(
      'id, title, kicker, body, image_path, cta_label, cta_href, show_intro, show_strip, show_section, captures_leads, coupon_id, active, starts_on, ends_on, position',
    )
    .eq('restaurant_id', restaurantId)
    .order('position');
  if (error) throw new Error('No pudimos cargar los eventos.');
  return (data ?? []) as EditEvent[];
}
export async function saveEvent(restaurantId: string, event: Partial<EditEvent>): Promise<void> {
  const supabase = getSupabase();
  const { id, ...rest } = event;
  // La bienvenida se cambia con set_intro_event (solo una por restaurante).
  const fields = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== 'show_intro'));
  const { error } = id
    ? await supabase.from('events').update(fields).eq('id', id)
    : await supabase.from('events').insert({ ...fields, restaurant_id: restaurantId });
  fail(error, 'el evento');
}
export async function deleteEvent(id: string): Promise<void> {
  const { error } = await getSupabase().from('events').delete().eq('id', id);
  fail(error, 'el evento');
}
/** Solo un evento de bienvenida (null = ninguno). */
export async function setIntroEvent(eventId: string | null): Promise<void> {
  const { error } = await getSupabase().rpc('set_intro_event', { p_event: eventId });
  fail(error, 'la bienvenida');
}
export async function saveIntroMode(
  restaurantId: string,
  mode: 'completa' | 'aviso' | 'ninguna',
): Promise<void> {
  const { error } = await getSupabase()
    .from('restaurant_settings')
    .update({ intro_mode: mode })
    .eq('restaurant_id', restaurantId);
  fail(error, 'la bienvenida');
}
export async function loadIntroMode(restaurantId: string): Promise<'completa' | 'aviso' | 'ninguna'> {
  const { data } = await getSupabase()
    .from('restaurant_settings')
    .select('intro_mode')
    .eq('restaurant_id', restaurantId)
    .single();
  return (data?.intro_mode ?? 'completa') as 'completa' | 'aviso' | 'ninguna';
}

export interface Quote {
  id: string;
  kind: string;
  name: string;
  phone: string;
  event_date: string | null;
  guests: number | null;
  message: string;
  status: 'nueva' | 'contactada' | 'cerrada';
  created_at: string;
}
export async function loadQuotes(restaurantId: string): Promise<Quote[]> {
  const { data, error } = await getSupabase()
    .from('quotes')
    .select('id, kind, name, phone, event_date, guests, message, status, created_at')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('No pudimos cargar las cotizaciones.');
  return (data ?? []) as Quote[];
}
export async function setQuoteStatus(id: string, status: Quote['status']): Promise<void> {
  const { error } = await getSupabase().from('quotes').update({ status }).eq('id', id);
  fail(error, 'la cotización');
}
