import { formatCop } from './money';
import { CHANNEL_LABEL, nestItems, type OrderChannel, type OrderStatus } from './orders';

/** Datos mínimos de un pedido para el recibo (D54). PanelOrder los cumple. */
export interface ReceiptOrderInput {
  code: string;
  status: OrderStatus;
  channel: OrderChannel;
  fulfillment: 'domicilio' | 'recoger';
  customer_name: string;
  phone: string;
  address: string;
  barrio: string;
  notes: string;
  payment_label: string;
  cash_with: number | null;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  coupon_code: string | null;
  gift: string | null;
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
}

export interface ReceiptBusiness {
  name: string;
  phone?: string;
  address?: string;
}

export interface ReceiptItem {
  qty: number;
  name: string;
  /** Total de la línea (precio × cantidad) ya formateado. */
  amount: string;
  addon: boolean;
}
export interface ReceiptRow {
  label: string;
  value: string;
  strong?: boolean;
}
export interface Receipt {
  business: ReceiptBusiness;
  code: string;
  dateText: string;
  channel: string;
  customer: string;
  phone: string;
  /** Celular enmascarado para la imagen compartida: "••• 4567". */
  phoneMasked: string;
  delivery: { pickup: boolean; address: string; barrio: string };
  items: ReceiptItem[];
  totals: ReceiptRow[];
  payment: ReceiptRow[];
  notes: string;
  gift: string | null;
  voided: boolean;
  thanks: string;
  legal: string;
}

export const RECEIPT_THANKS = '¡Gracias por pedir!';
export const RECEIPT_LEGAL = 'Documento no válido como factura electrónica';

const dateFormat = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/**
 * "19/11/2026 3:45 p.m.": corto para la tirilla de 58 mm. La hora y su "p.m." van unidas con espacio
 * duro para que la línea no se parta dejando "m." sola; solo puede saltar entre fecha y hora.
 */
export function receiptDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = dateFormat.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const period = part('dayPeriod').replace(/\s+/g, '');
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}\u00a0${period}`;
}

/** "3001234567" → "••• 4567". Sin dígitos suficientes no muestra nada. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `••• ${digits.slice(-4)}` : '';
}

export function buildReceipt(order: ReceiptOrderInput, business: ReceiptBusiness): Receipt {
  const items = nestItems(
    order.order_items.map((item) => ({ ...item, parent: item.parent_item_id })),
  ).map<ReceiptItem>((item) => ({
    qty: item.qty,
    name: item.combo ? `${item.name} (combo)` : item.name,
    amount: formatCop(item.unit_price * item.qty),
    addon: item.isAddon,
  }));

  const pickup = order.fulfillment === 'recoger';
  const totals: ReceiptRow[] = [{ label: 'Subtotal', value: formatCop(order.subtotal) }];
  if (order.discount > 0) {
    totals.push({
      label: order.coupon_code ? `Descuento (${order.coupon_code})` : 'Descuento',
      value: `−${formatCop(order.discount)}`,
    });
  }
  if (!pickup) {
    totals.push({
      label: 'Domicilio',
      value: order.delivery_fee > 0 ? formatCop(order.delivery_fee) : 'Gratis',
    });
  }
  totals.push({ label: 'Total', value: formatCop(order.total), strong: true });

  const payment: ReceiptRow[] = [];
  if (order.payment_label) payment.push({ label: 'Pago', value: order.payment_label });
  if (typeof order.cash_with === 'number' && order.cash_with > 0) {
    payment.push({ label: 'Paga con', value: formatCop(order.cash_with) });
    if (order.cash_with >= order.total) {
      payment.push({ label: 'Cambio', value: formatCop(order.cash_with - order.total) });
    }
  }

  return {
    business,
    code: order.code,
    dateText: receiptDate(order.created_at),
    channel: CHANNEL_LABEL[order.channel] ?? order.channel,
    customer: order.customer_name,
    phone: order.phone,
    phoneMasked: maskPhone(order.phone),
    delivery: pickup
      ? { pickup: true, address: '', barrio: '' }
      : { pickup: false, address: order.address, barrio: order.barrio },
    items,
    totals,
    payment,
    notes: order.notes.trim(),
    gift: order.gift,
    voided: order.status === 'cancelado',
    thanks: RECEIPT_THANKS,
    legal: RECEIPT_LEGAL,
  };
}

/** Parte un texto en renglones de máximo `max` caracteres (para dibujar el SVG compartido). */
export function wrapText(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const piece = word.length > max ? (word.match(new RegExp(`.{1,${max}}`, 'g')) ?? [word]) : [word];
      for (const part of piece) {
        if (line && `${line} ${part}`.length > max) {
          lines.push(line);
          line = part;
        } else {
          line = line ? `${line} ${part}` : part;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
