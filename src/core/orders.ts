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

/** Motivos al anular (D42). El texto lo lee la base: "Pedido de prueba…" marca is_test y "Pedido falso…" bloquea el celular. */
export const VOID_REASONS = ['Pedido de prueba', 'Pedido falso', 'El cliente canceló', 'Otro'] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

export type StaffRole = 'admin' | 'operador';

export interface OrderActions {
  /** Siguiente estado (null si está cerrado). */
  next: { status: OrderStatus; label: string } | null;
  /** Operador (o rol aún sin cargar): cancelar con la lista de siempre, solo en estados abiertos. */
  canCancel: boolean;
  /** Admin: anular en cualquier estado no cancelado, también entregado (D42). */
  canVoid: boolean;
}

/** Qué puede hacer cada rol con un pedido. La base valida lo mismo en set_order_status. */
export function orderActions(
  status: OrderStatus,
  role: StaffRole | null,
  fulfillment: 'domicilio' | 'recoger' = 'domicilio',
): OrderActions {
  const open = status !== 'entregado' && status !== 'cancelado';
  return {
    next: nextStep(status, fulfillment),
    canCancel: role !== 'admin' && open,
    canVoid: role === 'admin' && status !== 'cancelado',
  };
}

/**
 * Motivo que se manda a la base al anular. "Otro" exige texto (3 a 200 caracteres); en los demás el
 * detalle es opcional y va después del motivo para no romper el prefijo. null si falta algo.
 */
export function voidReasonText(choice: VoidReason | '', detail: string): string | null {
  const extra = detail.trim().replace(/\s+/g, ' ');
  if (!choice) return null;
  if (choice === 'Otro') return extra.length >= 3 ? extra.slice(0, 200) : null;
  return (extra ? `${choice} · ${extra}` : choice).slice(0, 200);
}

/** Error de set_order_status en texto para el equipo. */
export function statusErrorText(error: { code?: string | null; message?: string | null }): string {
  const message = (error.message ?? '').toLowerCase();
  if (error.code === '42501')
    return message.includes('admin')
      ? 'Solo el admin puede anular un pedido entregado.'
      : 'No tienes permiso para cambiar este pedido.';
  if (message.includes('ya está cancelado')) return 'Ese pedido ya estaba cancelado.';
  if (message.includes('ya está cerrado')) return 'Ese pedido ya está cerrado.';
  if (message.includes('insumos se conservan'))
    return 'Ese pedido aún no entra al barril: sus insumos siempre vuelven al inventario.';
  if (message.includes('motivo')) return 'Escribe el motivo (mínimo 3 letras).';
  if (message.includes('no sigue')) return 'Ese pedido ya cambió de estado. Revisa el tablero.';
  return 'No se pudo cambiar el estado. Revisa la conexión e intenta de nuevo.';
}

/** Los entregados de hoy se ven compactos (código y total) hasta tocarlos (D42). */
export function isCompact(status: OrderStatus): boolean {
  return status === 'entregado';
}

/** Abre o cierra una tarjeta compacta sin mutar el conjunto. */
export function toggleOpen(open: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

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

/* Tablero arrastrable (D53). La base exige lo mismo en set_order_status (compara la posición del enum). */

const FLOW: OrderStatus[] = ['nuevo', 'confirmado', 'en_cocina', 'en_camino', 'entregado'];

/** Se puede soltar un pedido de `from` en `to`: solo hacia adelante (se permite saltar), nunca a cancelado ni desde un estado cerrado. */
export function canDrop(from: OrderStatus, to: OrderStatus): boolean {
  if (to === 'cancelado' || from === 'entregado' || from === 'cancelado') return false;
  return FLOW.indexOf(to) > FLOW.indexOf(from);
}

/** Se puede empezar a arrastrar desde este estado. */
export function canDrag(status: OrderStatus): boolean {
  return status !== 'entregado' && status !== 'cancelado';
}

/** Aviso al soltar en una columna no válida; null si se puede (o si es la misma columna: no pasa nada). */
export function dropRejection(from: OrderStatus, to: OrderStatus): string | null {
  if (from === to || canDrop(from, to)) return null;
  if (!canDrag(from)) return `Un pedido ${STATUS_LABEL[from].toLowerCase()} ya no se mueve.`;
  if (to === 'cancelado') return 'Para cancelar abre el pedido y usa el botón con motivo.';
  return `Solo se avanza: no puede volver a ${STATUS_LABEL[to]}.`;
}

/** Soltar en Entregado o saltarse estados pide confirmación; un paso a la vez no. */
export function needsDropConfirm(from: OrderStatus, to: OrderStatus): boolean {
  if (!canDrop(from, to)) return false;
  return to === 'entregado' || FLOW.indexOf(to) - FLOW.indexOf(from) > 1;
}

/** Pregunta de la confirmación al soltar. */
export function dropConfirmText(code: string, from: OrderStatus, to: OrderStatus): string {
  if (to === 'entregado') return `¿Marcar ${code} como entregado? El operador no puede deshacerlo.`;
  return `¿Pasar ${code} de ${STATUS_LABEL[from]} a ${STATUS_LABEL[to]}? Se salta pasos del flujo.`;
}

/** Movimiento optimista: vale mientras el pedido siga en `from` (cuando llega el dato real, caduca solo). */
export interface PendingMove {
  from: OrderStatus;
  to: OrderStatus;
}

/** Aplica los movimientos pendientes sin mutar la lista. */
export function applyMoves<T extends { id: string; status: OrderStatus }>(
  orders: T[],
  moves: ReadonlyMap<string, PendingMove>,
): T[] {
  if (moves.size === 0) return orders;
  return orders.map((order) => {
    const move = moves.get(order.id);
    return move && order.status === move.from ? { ...order, status: move.to } : order;
  });
}

/** Movimientos que ya no aplican porque el pedido cambió o desapareció de la lista. */
export function staleMoves(
  orders: ReadonlyArray<{ id: string; status: OrderStatus }>,
  moves: ReadonlyMap<string, PendingMove>,
): string[] {
  const byId = new Map(orders.map((order) => [order.id, order.status]));
  return [...moves].filter(([id, move]) => byId.get(id) !== move.from).map(([id]) => id);
}

/** Desplazamiento por cuadro al arrastrar cerca del borde: negativo a la izquierda, 0 lejos del borde. */
export function edgeScroll(x: number, left: number, right: number, edge = 56, max = 18): number {
  if (right - left <= edge * 2) return 0;
  if (x < left + edge) return -Math.round(max * Math.min(1, (left + edge - x) / edge));
  if (x > right - edge) return Math.round(max * Math.min(1, (x - (right - edge)) / edge));
  return 0;
}

/** El gesto con mouse se vuelve arrastre al pasar el umbral (6 px), para no confundirlo con un clic. */
export function passedThreshold(dx: number, dy: number, threshold = 6): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

/* Anular o cancelar con mensaje para el cliente (D59). La base corta el público a 160 y el interno a 200. */

/** Mensajes cortos que ve el cliente en el seguimiento y en WhatsApp. "Otro" pide texto. */
export const PUBLIC_CANCEL_MESSAGES = [
  'Nos quedamos sin un producto',
  'No llegamos a tu zona',
  'Problema con el pago',
  'Otro',
] as const;
export type PublicCancelChoice = (typeof PUBLIC_CANCEL_MESSAGES)[number];
export const PUBLIC_CANCEL_MAX = 160;

/**
 * Mensaje público que se manda a la base: '' (ninguno elegido) → null; "Otro" exige 3 a 160 caracteres
 * (undefined si falta). Los demás van tal cual.
 */
export function publicCancelText(choice: PublicCancelChoice | '', other: string): string | null | undefined {
  if (!choice) return null;
  if (choice !== 'Otro') return choice;
  const text = other.trim().replace(/\s+/g, ' ');
  return text.length >= 3 ? text.slice(0, PUBLIC_CANCEL_MAX) : undefined;
}

/** Desde En el barril ya se usaron insumos: el modal pregunta si vuelven al inventario (D59). Antes siempre vuelven. */
export function asksRestore(status: OrderStatus): boolean {
  return status === 'en_cocina' || status === 'en_camino' || status === 'entregado';
}

/** Valor de p_restore: la respuesta solo cuenta cuando se pregunta (la base rechaza conservar antes de En el barril). */
export function restoreFlag(status: OrderStatus, answer: boolean): boolean {
  return asksRestore(status) ? answer : true;
}

/** Enlace de WhatsApp para avisar la anulación al cliente (código y mensaje público), sin envío automático (D48). */
export function cancelWhatsApp(
  phone: string,
  name: string,
  code: string,
  restaurant: string,
  message: string,
): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const text = `Hola ${first}, te escribimos de ${restaurant}: tu pedido ${code} fue cancelado. ${message.trim()}`;
  return `https://wa.me/57${phone}?text=${encodeURIComponent(text.replace(/\s+/g, ' ').trim())}`;
}

/* Deshacer al marcar Entregado (D60): el cambio sale a los 10 s salvo que se deshaga. */

export const DELIVER_UNDO_MS = 10_000;

/** Segundos que se muestran en "Deshacer (N s)": redondea hacia arriba y nunca baja de 0. */
export function undoSecondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Entregas diferidas cuyo pedido cambió (otro dispositivo) o desapareció: no se envían para no pisar. */
export function deferredConflicts(
  orders: ReadonlyArray<{ id: string; status: OrderStatus }>,
  deferred: ReadonlyMap<string, { from: OrderStatus }>,
): string[] {
  const byId = new Map(orders.map((order) => [order.id, order.status]));
  return [...deferred].filter(([id, entry]) => byId.get(id) !== entry.from).map(([id]) => id);
}

/* Cancelados de hoy (D60): los trae la RPC `cancelled_today` por la hora del evento de anulación (sin la
   ventana de 36 h del tablero). */

export interface CancelledToday {
  id: string;
  code: string;
  total: number;
  customerName: string;
  reason: string | null;
  publicMessage: string | null;
  voidedFrom: OrderStatus | null;
  suppliesRestored: boolean | null;
  at: string;
  by: string;
}

/**
 * Lee la respuesta de `cancelled_today`: el más reciente primero. Los de prueba no cuentan como cancelados
 * (D42). Descarta filas sin id, código u hora.
 */
export function readCancelledToday(raw: unknown): CancelledToday[] {
  if (!Array.isArray(raw)) return [];
  const out: CancelledToday[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.is_test === true) continue;
    if (typeof row.id !== 'string' || typeof row.code !== 'string' || typeof row.at !== 'string') continue;
    const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : null);
    const from = text('voided_from');
    out.push({
      id: row.id,
      code: row.code,
      total: typeof row.total === 'number' ? row.total : 0,
      customerName: text('customer_name') ?? '',
      reason: text('cancel_reason'),
      publicMessage: text('cancel_public'),
      voidedFrom: from && from in STATUS_LABEL ? (from as OrderStatus) : null,
      suppliesRestored: typeof row.supplies_restored === 'boolean' ? row.supplies_restored : null,
      at: row.at,
      by: text('by') ?? '—',
    });
  }
  return out.sort((first, second) => second.at.localeCompare(first.at));
}
