// Seguimiento sin cuenta (D21): enlace único y pedidos recordados en el navegador.

export const ORDER_STEPS = [
  ['nuevo', 'Recibido'],
  ['confirmado', 'Confirmado'],
  ['en_cocina', 'En el barril'],
  ['en_camino', 'En camino'],
  ['entregado', 'Entregado'],
] as const;
export type OrderStatus = (typeof ORDER_STEPS)[number][0] | 'cancelado';
export type Fulfillment = 'domicilio' | 'recoger';

/** Nombre del paso según cómo se entrega: quien recoge no espera un domiciliario (D33). */
export function stepName(status: OrderStatus, fulfillment: Fulfillment = 'domicilio'): string {
  if (status === 'cancelado') return 'Cancelado';
  if (fulfillment === 'recoger' && status === 'en_camino') return 'Listo para recoger';
  if (fulfillment === 'recoger' && status === 'entregado') return 'Recogido';
  return ORDER_STEPS.find(([key]) => key === status)?.[1] ?? '';
}

export function trackPath(code: string, token: string): string {
  return `/pedido?c=${encodeURIComponent(code)}&t=${encodeURIComponent(token)}`;
}

export interface RememberedOrder {
  code: string;
  token: string;
  at: number;
}

/** Agrega el pedido al inicio, sin duplicados, máximo 10 (lo que guarda el navegador). */
export function rememberOrder(list: RememberedOrder[], order: RememberedOrder): RememberedOrder[] {
  return [order, ...list.filter((item) => item.code !== order.code)].slice(0, 10);
}

/** Pedidos que vale la pena mostrar en el botón flotante: de las últimas 8 horas. */
export function recentOrders(list: RememberedOrder[], now: number): RememberedOrder[] {
  return list.filter((item) => now - item.at < 8 * 3600_000);
}

export function stepIndex(status: OrderStatus): number {
  return ORDER_STEPS.findIndex(([key]) => key === status);
}

/** Texto del pedido cancelado: el motivo público que escribió el equipo (D59) o el genérico. */
export function cancelText(note: string | null | undefined): string {
  const clean = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
  return clean || 'Tu pedido fue cancelado. Si tienes dudas, escríbenos por WhatsApp.';
}
