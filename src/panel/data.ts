// Datos del panel de pedidos (F5). Todo pasa por RLS y por funciones que validan el rol en la base.
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
  order_events: Array<{ status: OrderStatus; at: string }>;
}

const ORDER_COLUMNS =
  'id, code, status, channel, fulfillment, customer_name, phone, address, barrio, zone_name, notes, payment_label, cash_with, subtotal, discount, delivery_fee, total, coupon_code, gift, cancel_reason, created_at, order_items(id, parent_item_id, position, name, qty, combo, unit_price), order_events(status, at)';

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

export async function setStatus(orderId: string, status: OrderStatus, reason?: string): Promise<void> {
  const { error } = await getSupabase().rpc('set_order_status', {
    p_order: orderId,
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(statusErrorText(error));
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
