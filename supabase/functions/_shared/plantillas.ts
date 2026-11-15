// Plantillas de WhatsApp (F9, D32). Los nombres y el orden de los parámetros se registran igual en Meta.
// Sin dependencias: las usan la función whatsapp (Deno) y el panel (vista previa).

export type WaKind = 'pedido_recibido' | 'aviso_negocio' | 'en_camino' | 'informe_semanal';

export interface WaOrder {
  code: string;
  status: string;
  name: string;
  phone: string;
  total: number;
  items: number;
  zone: string;
  channel: string;
}
export interface WaReport {
  from: string;
  to: string;
  total: number;
  orders: number;
  star: string | null;
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
  }
}
