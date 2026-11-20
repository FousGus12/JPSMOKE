// Seguridad (D43, D65): motivos de pedidos frenados en lenguaje claro y lectura de la auditoría.
import { normalizeColombianMobile } from './phone';
export const BLOCK_REASONS = {
  robot: 'Verificación antibots',
  repetido: 'Demasiados pedidos seguidos',
  bloqueado: 'Cliente bloqueado',
  fuera_de_zona: 'Fuera de zona de entrega',
  cerrado: 'Restaurante cerrado',
  precio: 'Precio desactualizado',
} as const;
export type BlockReason = keyof typeof BLOCK_REASONS;

export function reasonLabel(reason: string): string {
  return (BLOCK_REASONS as Record<string, string>)[reason] ?? 'Otro motivo';
}

/** Teléfono enmascarado: solo los últimos 4 dígitos. */
export function maskPhone(last4: string | null): string {
  return last4 ? `••••${last4}` : '—';
}

/** Cursor para la página siguiente de la auditoría: fecha del último registro, o null si ya no hay más. */
export function nextAuditCursor(rows: Array<{ at: string }>, limit: number): string | null {
  return rows.length >= limit ? (rows[rows.length - 1]?.at ?? null) : null;
}

/** Texto corto del detalle de auditoría (objeto plano → "clave: valor · …"). */
export function auditDetailText(detail: unknown): string {
  if (detail === null || detail === undefined) return '';
  if (typeof detail !== 'object') return String(detail);
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
    .slice(0, 240);
}

// D65: acciones desde un pedido frenado. Solo hay acciones si el frenado quedó ligado a un cliente existente.
export interface BlockedLink {
  customer_id: string | null;
  customer: { blocked: boolean; phone: string; name: string } | null;
}
export interface BlockedActions {
  /** Mostrar "Desbloquear": el cliente sigue bloqueado. */
  unblock: boolean;
  /** Enlace de wa.me con el celular del cliente (nunca se pinta en la lista), o null. */
  whatsapp: string | null;
}

export function blockedActions(row: BlockedLink, typedName?: string | null): BlockedActions | null {
  if (!row.customer_id || !row.customer) return null;
  const phone = normalizeColombianMobile(row.customer.phone);
  const name = (typedName ?? '').trim() || row.customer.name;
  return {
    unblock: row.customer.blocked,
    whatsapp: phone ? blockedWhatsApp(phone, name) : null,
  };
}

/** Mensaje para retomar un pedido que no pasó (sin decir el motivo: puede ser un bloqueo). */
export function blockedWhatsApp(phone: string, name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const text = `Hola${first ? ` ${first}` : ''}, vimos que intentaste hacer un pedido y no se pudo completar. ¿Te ayudamos a terminarlo?`;
  return `https://wa.me/57${phone}?text=${encodeURIComponent(text)}`;
}

// D65: exportación de clientes con autorización vigente de promociones (Ley 1581).
export interface PromoCustomer {
  nombre: string;
  celular: string;
  autorizado_el: string | null;
  pedidos: number | null;
  ultimo_pedido: string | null;
}

/** La exportación llega como un único jsonb (array); descarta lo que no tenga nombre y celular. */
export function readPromoExport(raw: unknown): PromoCustomer[] {
  if (!Array.isArray(raw)) return [];
  const out: PromoCustomer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    if (typeof value.nombre !== 'string' || typeof value.celular !== 'string') continue;
    const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null);
    out.push({
      nombre: value.nombre,
      celular: value.celular,
      autorizado_el: text('autorizado_el'),
      pedidos: typeof value.pedidos === 'number' ? value.pedidos : null,
      ultimo_pedido: text('ultimo_pedido'),
    });
  }
  return out;
}

const bogotaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Fecha y hora de Bogotá en formato ordenable: "2026-11-19 14:05". Vacío si no hay fecha válida. */
export function bogotaStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = bogotaParts.formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

/** Filas del CSV: nombre, celular, fecha de autorización y pedidos (columnas en español). */
export function promoExportRows(rows: PromoCustomer[]): Array<Record<string, string | number>> {
  return rows.map((row) => ({
    Nombre: row.nombre,
    Celular: row.celular,
    'Autorizó promociones': bogotaStamp(row.autorizado_el),
    Pedidos: row.pedidos ?? 0,
  }));
}

export function promoExportFileName(now = new Date()): string {
  return `clientes-promociones-${bogotaStamp(now.toISOString()).slice(0, 10)}.csv`;
}
