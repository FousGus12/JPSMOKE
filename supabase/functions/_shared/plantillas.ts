// Plantillas de WhatsApp (F9, D32). Los nombres y el orden de los parámetros se registran igual en Meta.
// Sin dependencias: las usan la función whatsapp (Deno) y el panel (vista previa).

export type WaKind =
  'pedido_recibido' | 'aviso_negocio' | 'en_camino' | 'informe_semanal' | 'stock_bajo' | 'pedido_cancelado';

export interface WaOrder {
  code: string;
  status: string;
  name: string;
  phone: string;
  total: number;
  items: number;
  zone: string;
  channel: string;
  /** Motivo público de la anulación (D59); el interno nunca llega aquí. */
  cancel_note?: string | null;
}
export interface WaReport {
  from: string;
  to: string;
  total: number;
  orders: number;
  star: string | null;
}
/** Insumo que cruzó su mínimo (D46). */
export interface WaSupply {
  name: string;
  stock: number;
  min: number;
  unit: string;
}
export interface WaMessage {
  id: string;
  kind: WaKind;
  mode: 'manual' | 'prueba' | 'activo';
  restaurant: string;
  site_url: string | null;
  business_phone: string | null;
  eta: string;
  order: WaOrder | null;
  report: WaReport | null;
  supply?: WaSupply | null;
}
export type Built = { to: string; template: WaKind; params: string[]; preview: string } | { skip: string };

const cop = (value: number) =>
  `$${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(value))}`;
/** Celular colombiano de 10 dígitos o el número del negocio (57 + 10). Devuelve el formato de Meta (57…). */
/** Primer nombre seguro para un parámetro de plantilla: solo letras, apóstrofo y guion (sin punto: nada de dominios, D39); máximo 30. */
export function safeName(name: string | null | undefined): string {
  const clean =
    (name ?? '')
      .normalize('NFC')
      .replace(/[^\p{L} '-]/gu, ' ')
      .trim()
      .split(/\s+/)[0] ?? '';
  return clean.slice(0, 30) || 'cliente';
}

/** Texto libre para un parámetro de Meta: sin saltos de línea ni tabulaciones ni espacios repetidos; máximo 160. */
export function safeText(text: string | null | undefined, max = 160): string {
  return (text ?? '')
    .normalize('NFC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function toWhatsApp(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) return `57${digits}`;
  if (/^573\d{9}$/.test(digits)) return digits;
  return null;
}

export function buildMessage(message: WaMessage): Built {
  const order = message.order;
  const track =
    message.site_url && order
      ? `${message.site_url.replace(/\/$/, '')}/pedido?c=${encodeURIComponent(order.code)}`
      : '';
  switch (message.kind) {
    case 'pedido_recibido': {
      const to = toWhatsApp(order?.phone);
      if (!order || !to) return { skip: 'sin_celular' };
      if (order.status === 'cancelado') return { skip: 'cancelado' };
      const params = [
        safeName(order.name),
        order.code,
        cop(order.total),
        message.eta,
        track || 'nuestra página',
      ];
      return {
        to,
        template: 'pedido_recibido',
        params,
        preview: `¡Hola ${params[0]}! 🔥 Recibimos tu pedido ${params[1]} en ${message.restaurant} por ${params[2]}. Llega en ${params[3]}. Síguelo en ${params[4]} con tu código y los últimos 4 dígitos de tu celular.`,
      };
    }
    case 'aviso_negocio': {
      const to = toWhatsApp(message.business_phone);
      if (!order || !to) return { skip: 'sin_whatsapp_negocio' };
      const params = [order.code, String(order.items), cop(order.total), order.zone];
      return {
        to,
        template: 'aviso_negocio',
        params,
        preview: `🔔 Pedido nuevo ${params[0]}: ${params[1]} productos por ${params[2]} para ${params[3]}. Míralo en el panel.`,
      };
    }
    case 'en_camino': {
      const to = toWhatsApp(order?.phone);
      if (!order || !to) return { skip: 'sin_celular' };
      if (order.status === 'cancelado') return { skip: 'cancelado' };
      const params = [safeName(order.name), order.code];
      return {
        to,
        template: 'en_camino',
        params,
        preview: `🛵 ${params[0]}, tu pedido ${params[1]} de ${message.restaurant} va en camino. Ten listo el pago.`,
      };
    }
    case 'pedido_cancelado': {
      const to = toWhatsApp(order?.phone);
      const note = safeText(order?.cancel_note);
      if (!order || !to) return { skip: 'sin_celular' };
      if (!note) return { skip: 'sin_motivo' };
      const params = [safeName(order.name), order.code, note];
      return {
        to,
        template: 'pedido_cancelado',
        params,
        preview: `${params[0]}, anulamos tu pedido ${params[1]} de ${message.restaurant}. Motivo: ${params[2]}. Si tienes dudas, escríbenos por WhatsApp.`,
      };
    }
    case 'informe_semanal': {
      const to = toWhatsApp(message.business_phone);
      const report = message.report;
      if (!to || !report) return { skip: 'sin_whatsapp_negocio' };
      const params = [report.from, report.to, cop(report.total), String(report.orders), report.star ?? '—'];
      return {
        to,
        template: 'informe_semanal',
        params,
        preview: `📊 ${message.restaurant}, semana del ${params[0]} al ${params[1]}: ventas ${params[2]}, ${params[3]} pedidos. Producto estrella: ${params[4]}.`,
      };
    }
    case 'stock_bajo': {
      const to = toWhatsApp(message.business_phone);
      const supply = message.supply;
      if (!to || !supply) return { skip: 'sin_whatsapp_negocio' };
      const qty = (value: number) =>
        new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
      const params = [
        supply.name.slice(0, 60),
        `${qty(supply.stock)} ${supply.unit}`,
        `${qty(supply.min)} ${supply.unit}`,
      ];
      return {
        to,
        template: 'stock_bajo',
        params,
        preview: `⚠️ ${message.restaurant}: ${params[0]} llegó al mínimo. Quedan ${params[1]} (mínimo ${params[2]}). Revisa el inventario en el panel.`,
      };
    }
  }
}
