// Datos del panel de pedidos (F5). Todo pasa por RLS y por funciones que validan el rol en la base.
import { readPublicEnv } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { statusErrorText, type OrderChannel, type OrderStatus, type StaffRole } from '../core/orders';

export interface PanelOrder {
  id: string;
  code: string;
  status: OrderStatus;
  channel: OrderChannel;
  fulfillment: 'domicilio' | 'recoger';
  customer_name: string;
  phone: string;
  address: string;
  barrio: string;
  zone_name: string;
  notes: string;
  payment_label: string;
  cash_with: number | null;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  coupon_code: string | null;
  gift: string | null;
  cancel_reason: string | null;
  /** Motivo que ve el cliente (D59). */
  cancel_public: string | null;
  /** Al anular: si los insumos volvieron (D59); null si no se anuló. */
  supplies_restored: boolean | null;
  /** Estado desde el que se anuló (D42). */
  voided_from: OrderStatus | null;
  is_test: boolean;
  created_at: string;
  order_items: Array<{
    id: string;
    parent_item_id: string | null;
    position: number;
    name: string;
    qty: number;
    combo: boolean;
    unit_price: number;
  }>;
  order_events: Array<{ status: OrderStatus; at: string; by_user: string | null }>;
}

const ORDER_COLUMNS =
  'id, code, status, channel, fulfillment, customer_name, phone, address, barrio, zone_name, notes, payment_label, cash_with, subtotal, discount, delivery_fee, total, coupon_code, gift, cancel_reason, cancel_public, supplies_restored, voided_from, is_test, created_at, order_items(id, parent_item_id, position, name, qty, combo, unit_price), order_events(status, at, by_user)';

/** Pedidos de las últimas 36 horas (abiertos de ayer + todo lo de hoy). */
export async function loadOrders(): Promise<PanelOrder[]> {
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const { data, error } = await getSupabase()
    .from('orders')
    .select(ORDER_COLUMNS)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw new Error('No pudimos cargar los pedidos.');
  return (data ?? []) as unknown as PanelOrder[];
}

/** Al anular o cancelar (D59): motivo público opcional y si los insumos vuelven (solo cuenta desde En el barril). */
export interface CancelOptions {
  publicReason?: string | null;
  restore?: boolean;
}

function statusArgs(orderId: string, status: OrderStatus, reason?: string, options: CancelOptions = {}) {
  return {
    p_order: orderId,
    p_status: status,
    p_reason: reason ?? null,
    p_public_reason: options.publicReason ?? null,
    p_restore: options.restore ?? true,
  };
}

export async function setStatus(
  orderId: string,
  status: OrderStatus,
  reason?: string,
  options?: CancelOptions,
): Promise<void> {
  const { error } = await getSupabase().rpc('set_order_status', statusArgs(orderId, status, reason, options));
  if (error) throw new Error(statusErrorText(error));
}

/** Token de la sesión actual, para enviar un cambio al cerrar la pestaña (D60). null sin sesión. */
export async function sessionToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Envía el cambio de estado aunque la pestaña se esté cerrando (`fetch` con keepalive al RPC). Es síncrono a
 * propósito: en `pagehide` no hay tiempo de esperar promesas. La base valida igual que con setStatus.
 */
export function setStatusKeepalive(orderId: string, status: OrderStatus, token: string): void {
  const env = readPublicEnv();
  try {
    void fetch(`${env.PUBLIC_SUPABASE_URL}/rest/v1/rpc/set_order_status`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(statusArgs(orderId, status)),
    }).catch(() => undefined);
  } catch {
    // Sin red o navegador sin keepalive: el tablero lo mostrará sin cambiar al volver.
  }
}

/** Nombres del equipo por usuario (RLS: solo el propio restaurante), para "quién" en Cancelados de hoy. */
export async function loadStaffNames(): Promise<Map<string, string>> {
  const { data, error } = await getSupabase().from('staff').select('user_id, full_name');
  if (error || !data) return new Map();
  return new Map(
    (data as Array<{ user_id: string; full_name: string }>).map((row) => [row.user_id, row.full_name]),
  );
}

/** Rol de quien usa el panel (solo para mostrar botones; la base valida con is_admin_of). */
export async function loadMyRole(): Promise<StaffRole | null> {
  const { data, error } = await getSupabase().rpc('my_staff');
  if (error || !data) return null;
  const role = (data as { role?: unknown }).role;
  return role === 'admin' || role === 'operador' ? role : null;
}

export interface Summary {
  orders_today: number;
  cancelled_today: number;
  active: number;
  waiting: number;
  avg_minutes: number | null;
  sales_today: number | null;
  ticket_today: number | null;
  blocked_week: number | null;
  low_supplies: string[];
}
export async function loadSummary(): Promise<Summary> {
  const { data, error } = await getSupabase().rpc('board_summary');
  if (error || !data) throw new Error('No pudimos cargar el resumen.');
  return data as Summary;
}

export interface ManualCatalog {
  products: Array<{
    id: string;
    name: string;
    price: number;
    combo_price: number | null;
    available: boolean;
  }>;
  zones: Array<{ id: string; name: string; fee: number }>;
  payments: Array<{ code: string; label: string }>;
}
export async function loadManualCatalog(restaurantId: string): Promise<ManualCatalog> {
  const supabase = getSupabase();
  const [products, zones, payments] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, combo_price, available')
      .eq('restaurant_id', restaurantId)
      .order('position'),
    supabase
      .from('delivery_zones')
      .select('id, name, fee')
      .eq('restaurant_id', restaurantId)
      .eq('active', true)
      .order('position'),
    supabase
      .from('payment_methods')
      .select('code, label')
      .eq('restaurant_id', restaurantId)
      .eq('active', true)
      .order('position'),
  ]);
  if (products.error || zones.error || payments.error) throw new Error('No pudimos cargar la carta.');
  return { products: products.data ?? [], zones: zones.data ?? [], payments: payments.data ?? [] };
}

export interface ManualOrderInput {
  channel: Exclude<OrderChannel, 'web'>;
  customer: { name: string; phone: string; address: string; zone_id: string };
  payment_code: string;
  items: Array<{ product_id: string; qty: number; combo: boolean }>;
}
export async function createManualOrder(input: ManualOrderInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_manual_order', { p: input });
  if (error?.code === 'P0002') throw new Error(`No hay inventario para ${error.message}.`);
  if (error || typeof data !== 'string') throw new Error('No se pudo crear el pedido. Revisa los datos.');
  return data;
}

/** Tablero en vivo: escucha cambios de pedidos del restaurante (RLS) y además revisa cada 20 s por si se cae la conexión. */
export function watchOrders(
  restaurantId: string,
  onChange: (event: { type: string; id?: string | undefined }) => void,
): () => void {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`pedidos-${restaurantId}-${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => onChange({ type: payload.eventType, id: (payload.new as { id?: string } | null)?.id }),
    )
    .subscribe();
  const timer = setInterval(() => onChange({ type: 'poll' }), 20_000);
  return () => {
    clearInterval(timer);
    void supabase.removeChannel(channel);
  };
}
