/**
 * Pedido web (D58, D61, D63): validación de los datos del cliente, pedido exprés, id del intento
 * (idempotencia), tiempos del formulario y estado de pedidos. Lógica pura: la usa src/scripts/sitio.ts.
 * El servidor vuelve a validar todo (crear-pedido + place_order).
 */
import { normalizeColombianMobile } from './phone';

export type FulfillmentMode = 'domicilio' | 'recoger';

/** Datos que el navegador recuerda entre pedidos (sin cuenta). `ok` (autorización) nunca se guarda en true. */
export interface CustomerForm {
  mode: FulfillmentMode;
  name: string;
  phone: string;
  address: string;
  barrio: string;
  zone: string;
  notes: string;
  pay: string;
  cash: string;
  ok: boolean;
  promos: boolean;
}

export interface CheckoutContext {
  zones: ReadonlyArray<{ id: string }>;
  payments: ReadonlyArray<{ code: string }>;
  pickupEnabled: boolean;
}

export type CustomerField = 'name' | 'phone' | 'address' | 'barrio' | 'zone' | 'pay';
export type FieldErrors = Partial<Record<CustomerField, string>>;

const NAME = /^[\p{L}](?:[\p{L} '-]|\.(?=\s|$))*$/u;

/** Recoger solo si el local lo permite hoy. */
export const isPickup = (form: Pick<CustomerForm, 'mode'>, ctx: Pick<CheckoutContext, 'pickupEnabled'>) =>
  form.mode === 'recoger' && ctx.pickupEnabled;

/**
 * Errores por campo (los mismos mensajes del formulario). La zona y el medio de pago se validan contra lo
 * que está activo ahora: una zona apagada o un pago retirado obligan a pasar por Datos.
 */
export function validateCustomer(form: CustomerForm, ctx: CheckoutContext): FieldErrors {
  const errors: FieldErrors = {};
  const name = form.name.trim();
  if (name.length < 3) errors.name = 'Escribe tu nombre';
  else if (!NAME.test(name)) errors.name = 'Escribe solo tu nombre, sin números ni símbolos';
  if (!normalizeColombianMobile(form.phone))
    errors.phone = 'Celular colombiano de 10 dígitos (empieza por 3)';
  if (!isPickup(form, ctx)) {
    const address = form.address.trim();
    if (!/\d/.test(address) || address.length < 8)
      errors.address = 'Escribe la dirección completa con número';
    if (form.barrio.trim().length < 3) errors.barrio = 'Escribe tu barrio';
    if (!form.zone) errors.zone = 'Elige tu localidad';
    else if (!ctx.zones.some((zone) => zone.id === form.zone)) errors.zone = 'Elige tu localidad';
  }
  if (!form.pay || !ctx.payments.some((method) => method.code === form.pay)) errors.pay = 'Elige cómo pagas';
  return errors;
}

/** Pedido exprés (D63): con datos recordados completos y vigentes, "Continuar" abre directo en Confirmar. */
export function canExpress(form: CustomerForm | null | undefined, ctx: CheckoutContext): boolean {
  if (!form) return false;
  return Object.keys(validateCustomer(form, ctx)).length === 0;
}

/** Lee los datos guardados (formato viejo o dañado = vacíos donde falte). */
export function readSavedForm(raw: unknown): CustomerForm {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '');
  return {
    mode: value.mode === 'recoger' ? 'recoger' : 'domicilio',
    name: text('name'),
    phone: text('phone'),
    address: text('address'),
    barrio: text('barrio'),
    zone: text('zone'),
    notes: text('notes'),
    pay: text('pay'),
    cash: text('cash'),
    ok: false, // la autorización se pide en cada pedido
    promos: value.promos === true,
  };
}

/* ---------- Id del intento (D58) ---------- */

export interface Attempt {
  id: string;
  signature: string;
}

/** Firma del pedido tal como se envía: si cambia el carrito, los datos, el cupón o el modo, es otro intento. */
export function attemptSignature(payload: unknown): string {
  return JSON.stringify(payload, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : value,
  );
}

/** Mismo pedido = mismo id (un reintento tras un corte no duplica); otro pedido = id nuevo. */
export function attemptFor(prev: Attempt | null, signature: string, newId: () => string): Attempt {
  return prev && prev.signature === signature ? prev : { id: newId(), signature };
}

/** Lee el intento guardado en la sesión (sobrevive a recargar la página tras un corte). */
export function readAttempt(raw: unknown): Attempt | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, signature } = raw as Record<string, unknown>;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && typeof signature === 'string'
    ? { id, signature }
    : null;
}

/* ---------- Tiempos (D63) ---------- */

export const MAX_MS = 86_400_000;
/** Milisegundos enteros entre 0 y 24 h (el tope del servidor). */
export const boundedMs = (ms: number) =>
  Number.isFinite(ms) ? Math.min(MAX_MS, Math.max(0, Math.round(ms))) : 0;

/** Cuánto esperar antes de enviar para no caer en el tiempo mínimo antirobots del servidor (4 s desde la carga). */
export function antiBotWait(startedAt: number, now: number, minMs = 4000, marginMs = 300): number {
  return Math.max(0, minMs + marginMs - (now - startedAt));
}

/** Cronómetro que acumula solo mientras corre (tiempo en Datos, que puede abrirse varias veces). */
export interface Stopwatch {
  start(now: number): void;
  stop(now: number): void;
  reset(): void;
  /** Total acumulado (incluye el tramo en curso); null si nunca corrió. */
  total(now: number): number | null;
}
export function createStopwatch(): Stopwatch {
  let since: number | null = null;
  let sum = 0;
  let ran = false;
  return {
    start(now) {
      if (since === null) since = now;
      ran = true;
    },
    stop(now) {
      if (since !== null) sum += Math.max(0, now - since);
      since = null;
    },
    reset() {
      since = null;
      sum = 0;
      ran = false;
    },
    total(now) {
      if (!ran) return null;
      return boundedMs(sum + (since !== null ? Math.max(0, now - since) : 0));
    },
  };
}

/* ---------- Estado de pedidos (D61) ---------- */

export interface OrderingStatus {
  accepting: boolean;
  /** Pausa del equipo: hasta cuándo (ISO). */
  resumesAt: string | null;
  eta: string | null;
}

/** Respuesta de `ordering_status`; null si no tiene la forma esperada (se usa la lectura de respaldo). */
export function readOrderingStatus(raw: unknown): OrderingStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.accepting !== 'boolean') return null;
  const resumes =
    typeof value.resumes_at === 'string' && !Number.isNaN(Date.parse(value.resumes_at))
      ? value.resumes_at
      : null;
  const eta = typeof value.eta === 'string' && value.eta.trim() ? value.eta.trim() : null;
  return { accepting: value.accepting, resumesAt: value.accepting ? null : resumes, eta };
}

/**
 * Cuándo volver a consultar tras una pausa: al terminar más un margen (relojes desfasados). null si no hay
 * pausa o ya pasó hace rato. Tope de 3 h (la pausa máxima).
 */
export function reopenDelay(resumesAt: string | null, now: number, marginMs = 2000): number | null {
  if (!resumesAt) return null;
  const at = Date.parse(resumesAt);
  if (Number.isNaN(at)) return null;
  return Math.min(3 * 3600_000 + marginMs, Math.max(marginMs, at - now + marginMs));
}
