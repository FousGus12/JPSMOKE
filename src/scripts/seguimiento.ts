// Página de seguimiento (D21). Consulta la función seguir-pedido cada 15 s; solo estado y resumen.
import type { ClientData } from '../lib/content';
import { formatCop as money } from '../core/money';
import { ORDER_STEPS, stepIndex, stepName, type Fulfillment, type OrderStatus } from '../core/tracking';

interface PublicOrder {
  code: string;
  status: OrderStatus;
  fulfillment?: Fulfillment;
  created_at: string;
  cancel_reason: string | null;
  address: string;
  barrio: string;
  payment: string;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  coupon: string | null;
  gift: string | null;
  eta: string;
  items: Array<{ name: string; qty: number; combo: boolean; unit: number }>;
  events: Array<{ status: OrderStatus; at: string }>;
}

const data = JSON.parse(document.getElementById('jp-data')?.textContent ?? '{}') as ClientData;
const main = document.getElementById('track-main');
const esc = (text: unknown) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });
const HINT: Record<string, string> = {
  nuevo: 'El parrillero ya lo vio. En un momento lo confirma.',
  confirmado: 'Confirmado. Tu pedido entra al barril en breve.',
  en_cocina: 'Tu pedido está en el barril tomando humo.',
  en_camino: 'Va en camino. Ten listo el pago.',
  entregado: '¡Buen provecho! Gracias por pedir.',
};
const PICKUP_HINT: Partial<Record<string, string>> = {
  en_camino: 'Tu pedido está listo. Pasa por él cuando quieras.',
  entregado: '¡Buen provecho! Gracias por venir.',
};

const params = new URLSearchParams(location.search);
const code = (params.get('c') ?? '').toUpperCase();
const token = params.get('t');
let last4: string | null = null;
try {
  const saved = JSON.parse(sessionStorage.getItem(`${data.restaurant}:buscar`) ?? 'null') as {
    code: string;
    last4: string;
  } | null;
  if (saved && saved.code === code) last4 = saved.last4;
} catch {
  /* nada */
}

let lastStatus = '';
function toast(message: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.getElementById('toasts')?.append(el);
  setTimeout(() => el.remove(), 3500);
}

function notFound(message: string) {
  if (!main) return;
  main.innerHTML = `<section class="track-hero"><h1 class="display track-status">No encontrado</h1><p>${esc(message)}</p>
    <a class="btn btn-primary" href="/" data-open-track>Buscar con código y celular</a></section>`;
}

/** Enlace con solo el código (el que llega por WhatsApp): pide los últimos 4 dígitos del celular. */
function askLast4(message = '') {
  if (!main) return;
  main.innerHTML = `<section class="track-hero"><p class="code">Pedido ${esc(code)}</p><h1 class="display track-status">Tu pedido</h1>
    <p>Para verlo, escribe los últimos 4 dígitos del celular con el que pediste.</p>
    <form class="form-grid" id="last4-form" novalidate>
      <div class="field"><label for="last4">Últimos 4 dígitos</label><input class="input" id="last4" inputmode="numeric" maxlength="4" autocomplete="off"></div>
      ${message ? `<p class="form-error span-2" role="alert">${esc(message)}</p>` : ''}
      <button class="btn btn-primary btn-block span-2" type="submit">Ver mi pedido</button>
    </form></section>`;
  document.getElementById('last4-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value =
      (document.getElementById('last4') as HTMLInputElement | null)?.value.replace(/\D/g, '') ?? '';
    if (value.length !== 4) return askLast4('Escribe los 4 dígitos.');
    last4 = value;
    try {
      sessionStorage.setItem(`${data.restaurant}:buscar`, JSON.stringify({ code, last4 }));
    } catch {
      /* nada */
    }
    void load();
  });
  (document.getElementById('last4') as HTMLInputElement | null)?.focus();
}

async function load() {
  if (code && !token && !last4) return askLast4();
  if (!code)
    return notFound(
      'El enlace no está completo. Búscalo con el código y los últimos 4 dígitos de tu celular.',
    );
  const res = await fetch(`${data.supabaseUrl}/functions/v1/seguir-pedido`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: data.anonKey,
      Authorization: `Bearer ${data.anonKey}`,
    },
    body: JSON.stringify(
      token ? { restaurant: data.restaurant, code, token } : { restaurant: data.restaurant, code, last4 },
    ),
  }).catch(() => null);
  if (!res) return; // sin conexión: se reintenta en el próximo ciclo
  if (res.status === 429) return notFound('Hiciste muchas búsquedas seguidas. Espera unos minutos.');
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; order?: PublicOrder };
  if (!body.ok || !body.order) {
    if (!token && last4) {
      last4 = null;
      return askLast4('No coincide. Revisa los 4 dígitos.');
    }
    return notFound('El enlace no es válido o el pedido ya no está disponible.');
  }
  render(body.order);
}

function render(order: PublicOrder) {
  if (!main) return;
  if (lastStatus && lastStatus !== order.status)
    toast(`Tu pedido ahora está: ${stepName(order.status, order.fulfillment)}`);
  lastStatus = order.status;
  const cancelled = order.status === 'cancelado';
  const idx = stepIndex(order.status);
  const at = Object.fromEntries(order.events.map((event) => [event.status, event.at]));
  const pickup = order.fulfillment === 'recoger';
  const label = stepName(order.status, order.fulfillment);
  document.title = `${label} · ${order.code}`;
  main.classList.toggle('cancelled', cancelled);
  main.innerHTML = `
    <section class="track-hero">
      <p class="code">Pedido ${esc(order.code)}</p>
      <h1 class="display track-status">${esc(label)}</h1>
      <p>${cancelled ? `Motivo: ${esc(order.cancel_reason ?? 'sin detalle')}. Si fue un error, escríbenos.` : esc((pickup && PICKUP_HINT[order.status]) || HINT[order.status] || '')}</p>
      ${!cancelled && !pickup && order.status !== 'entregado' ? `<p><b>Entrega estimada:</b> ${esc(order.eta)} desde las ${time(order.created_at)}</p>` : ''}
    </section>
    ${
      cancelled
        ? ''
        : `<section class="track-card"><h2>Estado</h2><ol class="steps-v">${ORDER_STEPS.map(
            ([key], i) =>
              `<li class="${i <= idx ? 'is-done' : ''} ${i === idx ? 'now' : ''}"><span><b>${stepName(key, order.fulfillment)}</b></span><time>${at[key] ? time(at[key]) : ''}</time></li>`,
          ).join('')}</ol></section>`
    }
    <section class="track-card"><h2>Tu pedido</h2><div class="track-lines">
      ${order.items.map((item) => `<div><span>${item.qty} × ${esc(item.name)}${item.combo ? ' (combo)' : ''}</span><span>${money(item.unit * item.qty)}</span></div>`).join('')}
      ${pickup ? '' : `<div class="muted"><span>Domicilio</span><span>${order.delivery_fee ? money(order.delivery_fee) : 'Gratis'}</span></div>`}
      ${order.discount ? `<div class="muted"><span>Cupón ${esc(order.coupon)}</span><span>−${money(order.discount)}</span></div>` : ''}
      ${order.gift ? `<div class="muted"><span>🎁 ${esc(order.gift)}</span><span>$0</span></div>` : ''}
      <div class="tot"><span>Total</span><span>${money(order.total)}</span></div></div>
      <p class="muted">${pickup ? esc(order.address) : `${esc(order.address)}, ${esc(order.barrio)}`} · Pago: ${esc(order.payment)}</p></section>
    <p class="track-note">${token ? 'Guarda este enlace: es único para tu pedido. ' : ''}Se actualiza solo, no tienes que recargar.</p>`;
}

void load();
setInterval(() => {
  // Solo se actualiza cuando ya hay un pedido en pantalla (no mientras escriben los 4 dígitos).
  if (lastStatus && lastStatus !== 'entregado' && lastStatus !== 'cancelado') void load();
}, 15000);
