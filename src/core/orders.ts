// Reglas del tablero de pedidos (F5). Puras y probadas; la base valida lo mismo en set_order_status.

export type OrderStatus = 'nuevo' | 'confirmado' | 'en_cocina' | 'en_camino' | 'entregado' | 'cancelado';
export type OrderChannel = 'web' | 'whatsapp' | 'manual' | 'rappi' | 'didi';

export const BOARD_COLUMNS: Array<[OrderStatus, string]> = [
  ['nuevo', 'Nuevos'],
  ['confirmado', 'Confirmados'],
  ['en_cocina', 'En el barril'],
  ['en_camino', 'En camino'],
  ['entregado', 'Entregados hoy'],
];
export const STATUS_LABEL: Record<OrderStatus, string> = {
  nuevo: 'Nuevo',
  confirmado: 'Confirmado',
  en_cocina: 'En el barril',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};
export const CHANNEL_LABEL: Record<OrderChannel, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  manual: 'Llamada',
  rappi: 'Rappi',
  didi: 'DiDi',
};
const NEXT: Partial<Record<OrderStatus, [OrderStatus, string]>> = {
  nuevo: ['confirmado', 'Confirmar'],
  confirmado: ['en_cocina', 'Al barril'],
  en_cocina: ['en_camino', 'Despachar'],
  en_camino: ['entregado', 'Entregado'],
};
export const CANCEL_REASONS = [
  'Cliente no responde',
  'Fuera de cobertura',
  'Pedido falso o broma',
  'Producto agotado',
  'El cliente canceló',
];

/** Siguiente estado y el texto del botón; null si el pedido ya está cerrado. Quien recoge no se despacha (D33). */
export function nextStep(
  status: OrderStatus,
  fulfillment: 'domicilio' | 'recoger' = 'domicilio',
): { status: OrderStatus; label: string } | null {
  const next = NEXT[status];
  if (!next) return null;
  if (fulfillment === 'recoger' && status === 'en_cocina')
    return { status: next[0], label: 'Listo para recoger' };
  if (fulfillment === 'recoger' && status === 'en_camino') return { status: next[0], label: 'Ya lo recogió' };
  return { status: next[0], label: next[1] };
}

export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}

/** Un pedido abierto con más de 45 minutos se marca en rojo. */
export function isLate(status: OrderStatus, iso: string, now: number): boolean {
  return !['entregado', 'cancelado'].includes(status) && minutesSince(iso, now) > 45;
}

/** Inicio del día en Bogotá (UTC-5, sin horario de verano). */
export function startOfBogotaDay(now: number): number {
  const offset = 5 * 3600_000;
  return Math.floor((now - offset) / 86_400_000) * 86_400_000 + offset;
}

export interface BoardOrder {
  id: string;
  status: OrderStatus;
  created_at: string;
}

/** Agrupa por columna: abiertos de cualquier día (más viejos primero) y entregados solo de hoy. */
export function groupBoard<T extends BoardOrder>(orders: T[], now: number): Record<OrderStatus, T[]> {
  const today = startOfBogotaDay(now);
  const groups: Record<OrderStatus, T[]> = {
    nuevo: [],
    confirmado: [],
    en_cocina: [],
    en_camino: [],
    entregado: [],
    cancelado: [],
  };
  for (const order of orders) {
    if (
      (order.status === 'entregado' || order.status === 'cancelado') &&
      new Date(order.created_at).getTime() < today
    )
      continue;
    groups[order.status].push(order);
  }
  for (const list of Object.values(groups))
    list.sort((first, second) => first.created_at.localeCompare(second.created_at));
  return groups;
}

/** Celular legible: 3105551234 → "310 555 1234". */
export function formatPhone(phone: string): string {
  return phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
}

/** Mensaje para escribirle al cliente por WhatsApp desde el pedido (opcional; el flujo no depende de WhatsApp, D20). */
export function customerWhatsApp(phone: string, name: string, code: string, restaurant: string): string {
  const text = `Hola ${name.split(' ')[0] ?? ''}, te escribimos de ${restaurant} por tu pedido ${code} 🔥`;
  return `https://wa.me/57${phone}?text=${encodeURIComponent(text)}`;
}

/** Ítem de un pedido con su plato (D40). */
export interface NestableItem {
  id?: string | null;
  parent?: string | null;
  position?: number | null;
}
/**
 * Ordena los ítems de un pedido con cada adición justo debajo de su plato (D40). Los pedidos viejos
 * (sin id ni padre) quedan como vienen.
 */
export function nestItems<T extends NestableItem>(items: T[]): Array<T & { isAddon: boolean }> {
  const sorted = [...items].sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const ids = new Set(sorted.map((item) => item.id).filter(Boolean));
  const out: Array<T & { isAddon: boolean }> = [];
  for (const item of sorted) {
    if (item.parent && ids.has(item.parent)) continue;
    out.push({ ...item, isAddon: false });
    if (item.id)
      for (const child of sorted) if (child.parent === item.id) out.push({ ...child, isAddon: true });
  }
  return out;
}
