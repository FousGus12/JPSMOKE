// Comportamiento del sitio público (F4). Portado del mockup aprobado (mockup/assets/sitio.js).
// El total que vale lo calcula el servidor (place_order); aquí solo se muestra la vista previa (src/core/cart.ts).
import type { ClientData } from '../lib/content';
import { cartTotals, comboUpsell, type CartCoupon, type CartLine, type CartProduct } from '../core/cart';
import { formatCop as money } from '../core/money';
import { normalizeColombianMobile } from '../core/phone';
import {
  rememberOrder,
  recentOrders,
  trackPath,
  type Fulfillment,
  type RememberedOrder,
  ORDER_STEPS,
} from '../core/tracking';
import { mensajesPedido, type PedidoError } from '../../supabase/functions/_shared/pedido';

const qs = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);
const qsa = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(sel),
];
const esc = (text: unknown) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const dataEl = document.getElementById('jp-data');
const data = JSON.parse(dataEl?.textContent ?? '{}') as ClientData;
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`${data.restaurant}:${key}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`${data.restaurant}:${key}`, JSON.stringify(value));
    } catch {
      /* sin almacenamiento: el carrito vive en memoria */
    }
  },
};

let products: CartProduct[] = data.products.map(({ id, price, comboPrice, available }) => ({
  id,
  price,
  comboPrice,
  available,
}));
const info = new Map(data.products.map((product) => [product.id, product]));
let cart = store.get<CartLine[]>('carrito', []).filter((line) => info.has(line.productId));
let coupon: CartCoupon | null = null;
let couponCode = '';
const choice = new Map<string, boolean>();

function toast(message: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  qs('#toasts')?.append(el);
  setTimeout(() => el.remove(), 3200);
}

function fnUrl(name: string) {
  return `${data.supabaseUrl}/functions/v1/${name}`;
}
async function callFunction<T>(name: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(fnUrl(name), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: data.anonKey,
      Authorization: `Bearer ${data.anonKey}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/* ---------- Disponibilidad y precios en vivo (sin publicar, D26) ---------- */
const rest = (path: string) =>
  fetch(`${data.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: data.anonKey, Authorization: `Bearer ${data.anonKey}` },
  }).then((res) => (res.ok ? (res.json() as Promise<unknown>) : null));
/** Inventario (D30): productos que no alcanzan con los insumos salen agotados; si solo falta un extra del combo, se puede pedir sola. */
let comboOut = new Set<string>();
async function applyStockStatus() {
  const res = await fetch(`${data.supabaseUrl}/rest/v1/rpc/stock_status`, {
    method: 'POST',
    headers: {
      apikey: data.anonKey,
      Authorization: `Bearer ${data.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_restaurant: data.restaurant }),
  }).catch(() => null);
  if (!res?.ok) return;
  const status = (await res.json()) as { sold_out: string[]; combo_out: string[] };
  const soldOut = new Set(status.sold_out);
  comboOut = new Set(status.combo_out);
  products = products.map((product) =>
    soldOut.has(product.id) ? { ...product, available: false } : product,
  );
  for (const id of soldOut) {
    qsa<HTMLElement>(`[data-product="${id}"]`).forEach((card) => card.classList.add('sold-out'));
    qsa<HTMLButtonElement>(`[data-add="${id}"]`).forEach((btn) => (btn.disabled = true));
  }
  for (const id of comboOut) {
    if (soldOut.has(id)) continue;
    qsa<HTMLButtonElement>(
      `[data-add="${id}"][data-combo="1"], [data-variant="${id}"][data-combo="1"]`,
    ).forEach((btn) => {
      btn.disabled = true;
      btn.title = 'El combo se agotó: pídela sola';
    });
  }
  cart = cart.filter(
    (line) =>
      products.some((product) => product.id === line.productId && product.available) &&
      !(line.combo && comboOut.has(line.productId)),
  );
}

/** Zonas, medios de pago, mínimo y "recibiendo pedidos" también en vivo (F6): el admin los cambia sin publicar. */
async function refreshOrdering() {
  const rid = `restaurant_id=eq.${data.restaurantId}`;
  const [settings, zones, payments] = await Promise.all([
    rest(
      `restaurant_settings?select=accepting_orders,delivery_min,delivery_eta,pickup_enabled,store_address&${rid}`,
    ),
    rest(`delivery_zones?select=id,name,fee,active&active=eq.true&order=position&${rid}`),
    rest(`payment_methods?select=code,label,asks_change&order=position&${rid}`),
  ]);
  const st = (
    settings as Array<{
      accepting_orders: boolean;
      delivery_min: number;
      delivery_eta: string;
      pickup_enabled: boolean;
      store_address: string | null;
    }> | null
  )?.[0];
  if (st) {
    data.acceptingOrders = st.accepting_orders;
    data.pickupEnabled = st.pickup_enabled;
    data.storeAddress = st.store_address ?? '';
    data.deliveryMin = st.delivery_min;
    data.deliveryEta = st.delivery_eta;
  }
  if (Array.isArray(zones)) data.zones = zones as ClientData['zones'];
  if (Array.isArray(payments))
    data.payments = (payments as Array<{ code: string; label: string; asks_change: boolean }>).map((row) => ({
      code: row.code,
      label: row.label,
      asksChange: row.asks_change,
    }));
}

async function refreshAvailability() {
  try {
    const url = `${data.supabaseUrl}/rest/v1/products?select=id,price,combo_price,available&restaurant_id=eq.${data.restaurantId}`;
    const res = await fetch(url, {
      headers: { apikey: data.anonKey, Authorization: `Bearer ${data.anonKey}` },
    });
    if (!res.ok) return;
    const live = (await res.json()) as Array<{
      id: string;
      price: number;
      combo_price: number | null;
      available: boolean;
    }>;
    products = live.map((row) => ({
      id: row.id,
      price: row.price,
      comboPrice: row.combo_price,
      available: row.available,
    }));
    for (const row of live) {
      qsa<HTMLElement>(`[data-product="${row.id}"]`).forEach((card) =>
        card.classList.toggle('sold-out', !row.available),
      );
      qsa<HTMLButtonElement>(`[data-add="${row.id}"]`).forEach((btn) => (btn.disabled = !row.available));
    }
    cart = cart.filter((line) =>
      products.some((product) => product.id === line.productId && product.available),
    );
    await applyStockStatus();
    syncCount();
    await refreshOrdering();
  } catch {
    /* sin conexión: se usa lo publicado */
  }
}

/* ---------- Inicio: 4 productos que se despliegan ---------- */
const hero = qs('#inicio');
const heroCards = qsa<HTMLElement>('.hcard');
type Layout = { start: number[][]; end: number[][]; s0: number; s1: number; vw: number; vh: number };
function layout(): Layout {
  const vw = innerWidth;
  const vh = innerHeight;
  if (vw < 760)
    return {
      start: [
        [0, 0.38, -10],
        [0, 0.38, -3],
        [0, 0.38, 4],
        [0, 0.38, 11],
      ],
      end: [
        [-0.235, -0.11, -3],
        [0.235, -0.1, 3],
        [-0.235, 0.15, 2],
        [0.235, 0.16, -3],
      ],
      s0: 0.7,
      s1: 1,
      vw,
      vh,
    };
  return {
    start: [
      [0, 0.36, -12],
      [0, 0.36, -4],
      [0, 0.36, 4],
      [0, 0.36, 12],
    ],
    end: [
      [-0.36, -0.16, -8],
      [-0.31, 0.22, 6],
      [0.36, -0.17, 7],
      [0.31, 0.21, -5],
    ],
    s0: 0.62,
    s1: 1,
    vw,
    vh,
  };
}
let lay = layout();
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
function updateHero() {
  if (!hero) return;
  const rect = hero.getBoundingClientRect();
  const total = hero.offsetHeight - innerHeight;
  const raw = Math.min(1, Math.max(0, -rect.top / (total * 0.7)));
  const progress = reduced ? 1 : ease(raw);
  hero.style.setProperty('--p', progress.toFixed(3));
  hero.classList.toggle('is-spread', progress > 0.55);
  heroCards.forEach((card, i) => {
    const from = lay.start[i];
    const to = lay.end[i];
    if (!from || !to) return;
    const [ax = 0, ay = 0, ar = 0] = from;
    const [bx = 0, by = 0, br = 0] = to;
    card.style.setProperty('--x', `${((ax + (bx - ax) * progress) * lay.vw).toFixed(1)}px`);
    card.style.setProperty('--y', `${((ay + (by - ay) * progress) * lay.vh).toFixed(1)}px`);
    card.style.setProperty('--r', `${(ar + (br - ar) * progress).toFixed(2)}deg`);
    card.style.setProperty('--s', (lay.s0 + (lay.s1 - lay.s0) * progress).toFixed(3));
    card.style.setProperty('--lbl', Math.max(0, (progress - 0.55) / 0.45).toFixed(2));
  });
}
addEventListener('resize', () => {
  lay = layout();
  updateHero();
});
if (!reduced) {
  const embers = qs('.hero-embers');
  for (let i = 0; i < 22; i++) {
    const ember = document.createElement('i');
    ember.style.left = `${Math.random() * 100}%`;
    ember.style.animationDelay = `${(Math.random() * 7).toFixed(2)}s`;
    ember.style.animationDuration = `${(5 + Math.random() * 5).toFixed(2)}s`;
    ember.style.setProperty('--dx', `${(Math.random() * 120 - 60).toFixed(0)}px`);
    embers?.append(ember);
  }
}

/* ---------- Encabezado y menú móvil ---------- */
let lastY = scrollY;
function headerOnScroll() {
  const y = scrollY;
  const hide = Boolean(qs('#drawer')?.hidden) && y > lastY && y > 400;
  qs('#header')?.classList.toggle('is-hidden', hide);
  document.body.classList.toggle('hdr-hidden', hide);
  lastY = y;
}
let ticking = false;
addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateHero();
      headerOnScroll();
      ticking = false;
    });
  },
  { passive: true },
);
const menuBtn = qs('#menu-btn');
const drawer = qs('#drawer');
function setDrawer(open: boolean) {
  if (!drawer || !menuBtn) return;
  drawer.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
}
menuBtn?.addEventListener('click', () => setDrawer(Boolean(drawer?.hidden)));
qsa('#drawer a').forEach((link) => link.addEventListener('click', () => setDrawer(false)));

/* ---------- Carrusel y carta ---------- */
qsa<HTMLButtonElement>('[data-scroll]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const track = qs('#arsenal-track');
    track?.scrollBy({
      left: Number(btn.dataset.scroll) * track.clientWidth * 0.8,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }),
);
let activeCat = 'todo';
function filterMenu() {
  const query = (qs<HTMLInputElement>('#carta-search')?.value ?? '').trim().toLowerCase();
  let shown = 0;
  qsa<HTMLElement>('[data-cat-block]').forEach((block) => {
    const inCat = activeCat === 'todo' || block.dataset.catBlock === activeCat;
    let visible = 0;
    qsa<HTMLElement>('[data-search]', block).forEach((item) => {
      const match = inCat && (!query || (item.dataset.search ?? '').includes(query));
      item.classList.toggle('carta-hidden', !match);
      if (match) visible += 1;
    });
    block.classList.toggle('carta-hidden', visible === 0);
    shown += visible;
  });
  const empty = qs('#carta-empty');
  if (empty) empty.hidden = shown > 0;
}
qs('#carta-pills')?.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cat]');
  if (!btn) return;
  activeCat = btn.dataset.cat ?? 'todo';
  qsa('#carta-pills [data-cat]').forEach((pill) => pill.setAttribute('aria-pressed', String(pill === btn)));
  filterMenu();
  qs('#carta')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
});
qs('#carta-search')?.addEventListener('input', filterMenu);

/* ---------- Carrito ---------- */
const byId = (id: string) => products.find((product) => product.id === id);
const count = () => cart.reduce((sum, line) => sum + line.qty, 0);
function syncCount() {
  qsa('[data-cart-count]').forEach((el) => {
    el.textContent = String(count());
    el.classList.remove('bump');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('bump');
  });
}
function saveCart() {
  store.set('carrito', cart);
  syncCount();
}
function flyTo(from: Element | null) {
  if (reduced || !from) return;
  const img = from.closest('.pcard, .item, .hcard')?.querySelector('img');
  const target = innerWidth < 760 ? qs('.bottom-bar button') : qs('.cart-btn');
  if (!img || !target) return;
  const src = img.getBoundingClientRect();
  const dst = target.getBoundingClientRect();
  const ghost = img.cloneNode() as HTMLImageElement;
  ghost.className = 'fly';
  Object.assign(ghost.style, {
    left: `${src.left}px`,
    top: `${src.top}px`,
    width: `${src.width}px`,
    height: `${src.height}px`,
  });
  document.body.append(ghost);
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${dst.left + dst.width / 2 - (src.left + src.width / 2)}px, ${dst.top + dst.height / 2 - (src.top + src.height / 2)}px) scale(.08)`;
    ghost.style.opacity = '.4';
  });
  setTimeout(() => ghost.remove(), 720);
}
function addToCart(id: string, combo: boolean, from: Element | null) {
  const product = byId(id);
  if (!product?.available) {
    toast('Ese producto se agotó por hoy');
    return;
  }
  if (combo && comboOut.has(id)) {
    toast('El combo se agotó por hoy; puedes pedirla sola');
    return;
  }
  const asCombo = combo && product.comboPrice !== null;
  const line = cart.find((item) => item.productId === id && item.combo === asCombo);
  if (line) line.qty += 1;
  else cart.push({ productId: id, qty: 1, combo: asCombo });
  saveCart();
  flyTo(from);
  toast(`${info.get(id)?.name ?? 'Producto'}${asCombo ? ' en combo' : ''} agregado 🔥`);
  if (!qs('#cart')?.hidden) renderCart();
}

function applyCoupon(code: string, open: boolean) {
  const clean = code.trim().toUpperCase();
  if (!clean) return;
  couponCode = clean;
  const found = data.coupons.find((item) => item.code.toUpperCase() === clean);
  coupon = found
    ? { code: found.code, kind: found.kind, value: found.value, minTotal: found.minTotal, title: found.title }
    : null;
  toast(found ? `Cupón ${found.code} listo 🎟️` : `Cupón ${clean} guardado: se valida al confirmar`);
  if (open) openCart();
  else renderCart();
}

let returnFocus: HTMLElement | null = null;
function lockScroll(lock: boolean) {
  document.body.style.overflow = lock ? 'hidden' : '';
}
function openCart() {
  returnFocus = document.activeElement as HTMLElement | null;
  renderCart();
  const sheet = qs('#cart');
  const backdrop = qs('#cart-backdrop');
  if (sheet) sheet.hidden = false;
  if (backdrop) backdrop.hidden = false;
  lockScroll(true);
  qs<HTMLButtonElement>('#cart [data-close-cart]')?.focus();
}
function closeCart() {
  const sheet = qs('#cart');
  const backdrop = qs('#cart-backdrop');
  if (sheet) sheet.hidden = true;
  if (backdrop) backdrop.hidden = true;
  lockScroll(false);
  returnFocus?.focus();
}
function totals(zoneFee: number | null = null) {
  return cartTotals(cart, products, { coupon, zoneFee, deliveryMin: data.deliveryMin });
}
function renderCart() {
  const body = qs('#cart-body');
  const foot = qs('#cart-foot');
  if (!body || !foot) return;
  if (!cart.length) {
    body.innerHTML = `<div class="cart-empty"><p class="display">Barril vacío</p><p>Todavía no has agregado nada.</p><a class="btn btn-primary" href="/#carta" data-close-cart>Ver la carta</a></div>`;
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = cart
    .map((line, i) => {
      const meta = info.get(line.productId);
      const product = byId(line.productId);
      if (!meta || !product) return '';
      const unit = line.combo && product.comboPrice !== null ? product.comboPrice : product.price;
      return `<div class="line">${meta.image ? `<img src="${esc(meta.image)}" alt="">` : '<span class="ph"></span>'}
        <div><h4>${esc(meta.name)}</h4><small>${line.combo ? 'Combo · papas + gaseosa' : product.comboPrice !== null ? 'Sola' : ''} · ${money(unit)}</small></div>
        <div class="qty"><button type="button" data-q="${i}" data-d="-1" aria-label="Quitar uno">−</button><span>${line.qty}</span><button type="button" data-q="${i}" data-d="1" aria-label="Agregar uno">＋</button></div></div>`;
    })
    .join('');
  const upsell = comboUpsell(cart, products);
  if (upsell) {
    body.insertAdjacentHTML(
      'beforeend',
      `<div class="upsell"><span>¿Pasas <b>${esc(info.get(upsell.productId)?.name)}</b> a combo por ${money(upsell.extra)} más?</span><button class="btn btn-soft btn-sm" type="button" data-upsell="${esc(upsell.productId)}">Sí, combo</button></div>`,
    );
  }
  const sum = totals();
  const below = sum.missingForMin > 0;
  foot.innerHTML = `
    <div class="coupon-row"><input class="input upper" id="coupon-in" placeholder="Cupón" value="${esc(couponCode)}" aria-label="Código de cupón"><button class="btn btn-soft" type="button" id="coupon-btn">Aplicar</button></div>
    ${coupon && !sum.couponApplies ? `<p class="cart-note">Este cupón aplica desde ${money(coupon.minTotal)}</p>` : ''}
    ${couponCode && !coupon ? `<p class="cart-note">El cupón ${esc(couponCode)} se valida al confirmar.</p>` : ''}
    <div class="totals"><div><span>Subtotal</span><span>${money(sum.subtotal)}</span></div>
      ${sum.discount ? `<div class="disc"><span>Descuento ${esc(coupon?.code)}</span><span>−${money(sum.discount)}</span></div>` : ''}
      ${sum.gift ? `<div class="disc"><span>🎁 ${esc(sum.gift)}</span><span>$0</span></div>` : ''}
      <div><span>Domicilio</span><span class="muted">${coupon?.kind === 'envio' && sum.couponApplies ? 'Gratis' : 'Según tu barrio'}</span></div>
      <div class="grand"><span>Total</span><span>${money(sum.total)}</span></div></div>
    ${below ? `<p class="form-error">El pedido mínimo es ${money(data.deliveryMin)}. Te faltan ${money(sum.missingForMin)}.</p>` : ''}
    ${!data.acceptingOrders ? '<p class="form-error">En este momento no estamos recibiendo pedidos.</p>' : ''}
    <button class="btn btn-primary btn-lg btn-block" type="button" id="go-checkout" ${below || !data.acceptingOrders ? 'disabled' : ''}>Continuar con el pedido</button>`;
  qs('#coupon-btn')?.addEventListener('click', () =>
    applyCoupon(qs<HTMLInputElement>('#coupon-in')?.value ?? '', false),
  );
  qs('#go-checkout')?.addEventListener('click', () => {
    closeCart();
    openCheckout();
  });
}
qs('#cart-body')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const qtyBtn = target.closest<HTMLElement>('[data-q]');
  if (qtyBtn) {
    const index = Number(qtyBtn.dataset.q);
    const line = cart[index];
    if (!line) return;
    line.qty += Number(qtyBtn.dataset.d);
    if (line.qty <= 0) cart.splice(index, 1);
    saveCart();
    renderCart();
    return;
  }
  const up = target.closest<HTMLElement>('[data-upsell]');
  if (up) {
    const id = up.dataset.upsell ?? '';
    const single = cart.find((line) => line.productId === id && !line.combo);
    const twin = cart.find((line) => line.productId === id && line.combo);
    if (single && twin) {
      twin.qty += single.qty;
      cart.splice(cart.indexOf(single), 1);
    } else if (single) single.combo = true;
    saveCart();
    renderCart();
  }
});

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const variant = target.closest<HTMLButtonElement>('[data-variant]');
  if (variant) {
    const id = variant.dataset.variant ?? '';
    choice.set(id, variant.dataset.combo === '1');
    qsa(`[data-variant="${id}"]`).forEach((btn) => btn.setAttribute('aria-pressed', String(btn === variant)));
    return;
  }
  const add = target.closest<HTMLButtonElement>('[data-add]');
  if (add) {
    const id = add.dataset.add ?? '';
    addToCart(
      id,
      add.dataset.combo !== undefined ? add.dataset.combo === '1' : (choice.get(id) ?? false),
      add,
    );
    return;
  }
  const apply = target.closest<HTMLElement>('[data-apply-coupon]');
  if (apply) {
    applyCoupon(apply.dataset.applyCoupon ?? '', true);
    return;
  }
  if (target.closest('[data-open-cart]')) openCart();
  if (target.closest('[data-close-cart]') || target.id === 'cart-backdrop') closeCart();
  if (target.closest('[data-close-modal]') || target.classList.contains('modal')) closeModals();
  if (target.closest('[data-open-track]')) {
    event.preventDefault();
    openTrack();
  }
});
addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!qs('#cart')?.hidden) closeCart();
  else closeModals();
});
function closeModals() {
  qsa('.modal').forEach((modal) => (modal.hidden = true));
  lockScroll(false);
  returnFocus?.focus();
}

/* ---------- Pedido: datos → confirmar (un solo botón, D15) ---------- */
interface Form {
  mode: Fulfillment;
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
const form: Form = store.get<Form>('datos', {
  mode: 'domicilio',
  name: '',
  phone: '',
  address: '',
  barrio: '',
  zone: '',
  notes: '',
  pay: '',
  cash: '',
  ok: false,
  promos: false,
});
let startedAt = 0;
function setStep(step: number) {
  qsa('#co-steps li').forEach((li, i) => li.classList.toggle('is-on', i <= step));
}
function openCheckout() {
  returnFocus = document.activeElement as HTMLElement | null;
  const modal = qs('#checkout');
  if (modal) modal.hidden = false;
  lockScroll(true);
  startedAt = 0;
  stepData();
}
const pickup = () => form.mode === 'recoger' && data.pickupEnabled;
function stepData(errorMsg = '') {
  setStep(0);
  if (!startedAt) startedAt = Date.now();
  const body = qs('#co-body');
  if (!body) return;
  if (!data.pickupEnabled) form.mode = 'domicilio';
  const asksChange = (code: string) =>
    data.payments.find((method) => method.code === code)?.asksChange ?? false;
  body.innerHTML = `
    <form class="form-grid" id="co-form" novalidate>
      <h2 class="display h-md span-2" id="co-title">${pickup() ? '¿Quién lo recoge?' : '¿A dónde lo llevamos?'}</h2>
      ${errorMsg ? `<p class="form-error span-2" role="alert">${esc(errorMsg)}</p>` : ''}
      ${
        data.pickupEnabled
          ? `<fieldset class="field span-2 pay-fieldset"><legend class="cash-legend">¿Cómo lo quieres?</legend><div class="pay">
          <label><input type="radio" name="mode" value="domicilio" ${pickup() ? '' : 'checked'}>🛵 Domicilio</label>
          <label><input type="radio" name="mode" value="recoger" ${pickup() ? 'checked' : ''}>📍 Recoger en tienda</label></div>
          ${pickup() ? `<p class="cash-legend" data-testid="store-address">Recoges en ${esc(data.storeAddress)}. Sin costo de domicilio.</p>` : ''}</fieldset>`
          : ''
      }
      <div class="field"><label for="f-name">Nombre <span class="req">*</span></label><input class="input" id="f-name" autocomplete="name" required value="${esc(form.name)}"><span class="error"></span></div>
      <div class="field"><label for="f-phone">Celular <span class="req">*</span></label><input class="input" id="f-phone" inputmode="numeric" autocomplete="tel-national" placeholder="300 123 4567" required value="${esc(form.phone)}"><span class="error"></span></div>
      ${
        pickup()
          ? ''
          : `<div class="field span-2"><label for="f-address">Dirección <span class="req">*</span></label><input class="input" id="f-address" autocomplete="street-address" placeholder="Calle 68 # 60-71, apto 302" required value="${esc(form.address)}"><span class="error"></span></div>
      <div class="field"><label for="f-barrio">Barrio <span class="req">*</span></label><input class="input" id="f-barrio" required value="${esc(form.barrio)}"><span class="error"></span></div>
      <div class="field"><label for="f-zone">Localidad <span class="req">*</span></label><select class="select" id="f-zone" required><option value="">Elige</option>${data.zones
        .map(
          (zone) =>
            `<option value="${zone.id}" ${form.zone === zone.id ? 'selected' : ''}>${esc(zone.name)} · ${money(zone.fee)}</option>`,
        )
        .join('')}</select><span class="error"></span></div>`
      }
      <div class="field span-2"><label for="f-notes">${pickup() ? 'Nota para el pedido' : 'Indicaciones para el domiciliario'}</label><input class="input" id="f-notes" maxlength="200" placeholder="${pickup() ? 'Llego en 20 minutos, sin cebolla…' : 'Torre 2, portería, casa esquinera…'}" value="${esc(form.notes)}"></div>
      <fieldset class="field span-2 pay-fieldset"><legend class="cash-legend">¿Cómo pagas? <span class="req">*</span></legend>
        <div class="pay">${data.payments
          .map(
            (method) =>
              `<label><input type="radio" name="pay" value="${esc(method.code)}" ${form.pay === method.code ? 'checked' : ''}>${esc(method.label)}</label>`,
          )
          .join('')}</div><span class="error" id="pay-error"></span></fieldset>
      <div class="field span-2" id="cash-field" ${asksChange(form.pay) ? '' : 'hidden'}><label for="f-cash">¿Con cuánto pagas?</label><input class="input" id="f-cash" inputmode="numeric" placeholder="Para llevar las vueltas" value="${esc(form.cash)}"></div>
      <input class="hp" tabindex="-1" autocomplete="off" id="f-hp" aria-hidden="true">
      <label class="check span-2"><input type="checkbox" id="f-ok" ${form.ok ? 'checked' : ''}> <span>Autorizo a ${esc(data.restaurantName)} a tratar mis datos para gestionar y entregar este pedido, según la <a href="/privacidad" target="_blank">política de tratamiento de datos</a>. <span class="req">*</span></span></label>
      <label class="check span-2"><input type="checkbox" id="f-promo" ${form.promos ? 'checked' : ''}> <span>Quiero recibir promociones por WhatsApp (opcional).</span></label>
      <div id="turnstile" class="span-2"></div>
      <button class="btn btn-primary btn-lg btn-block span-2" type="submit">Continuar</button>
    </form>`;
  qsa<HTMLInputElement>('#co-form input[name="mode"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      readForm();
      form.mode = radio.value === 'recoger' ? 'recoger' : 'domicilio';
      stepData();
    }),
  );
  qsa<HTMLInputElement>('#co-form input[name="pay"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      const cash = qs('#cash-field');
      if (cash) cash.hidden = !asksChange(radio.value);
    }),
  );
  qs('#co-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitData();
  });
  renderTurnstile();
  qs<HTMLInputElement>('#f-name')?.focus();
}
function fieldError(sel: string, message: string) {
  const input = qs<HTMLInputElement>(sel);
  if (!input) return true;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  const err = input.closest('.field')?.querySelector('.error');
  if (err) err.textContent = message;
  return !message;
}
// Si el campo no está (recoger), se conserva lo último escrito para el próximo domicilio.
const val = (sel: string, keep = '') => (qs<HTMLInputElement>(sel)?.value ?? keep).trim();
function readForm() {
  Object.assign(form, {
    name: val('#f-name'),
    phone: val('#f-phone'),
    address: val('#f-address', form.address),
    barrio: val('#f-barrio', form.barrio),
    zone: val('#f-zone', form.zone),
    notes: val('#f-notes'),
    pay: qs<HTMLInputElement>('#co-form input[name="pay"]:checked')?.value ?? '',
    cash: val('#f-cash'),
    ok: Boolean(qs<HTMLInputElement>('#f-ok')?.checked),
    promos: Boolean(qs<HTMLInputElement>('#f-promo')?.checked),
  });
}
function submitData() {
  readForm();
  let ok = fieldError(
    '#f-name',
    form.name.length < 3
      ? 'Escribe tu nombre'
      : /^[\p{L}](?:[\p{L} '-]|\.(?=\s|$))*$/u.test(form.name)
        ? ''
        : 'Escribe solo tu nombre, sin números ni símbolos',
  );
  ok =
    fieldError(
      '#f-phone',
      normalizeColombianMobile(form.phone) ? '' : 'Celular colombiano de 10 dígitos (empieza por 3)',
    ) && ok;
  if (!pickup()) {
    ok =
      fieldError(
        '#f-address',
        !/\d/.test(form.address) || form.address.length < 8 ? 'Escribe la dirección completa con número' : '',
      ) && ok;
    ok = fieldError('#f-barrio', form.barrio.length < 3 ? 'Escribe tu barrio' : '') && ok;
    ok = fieldError('#f-zone', form.zone ? '' : 'Elige tu localidad') && ok;
  }
  const payErr = qs('#pay-error');
  if (payErr) payErr.textContent = form.pay ? '' : 'Elige cómo pagas';
  ok = Boolean(form.pay) && ok;
  if (!form.ok) {
    toast('Necesitamos tu autorización de datos para entregar el pedido');
    ok = false;
  }
  if (!ok) {
    qs<HTMLElement>('#co-form [aria-invalid="true"]')?.focus();
    return;
  }
  // Se recuerdan para el próximo pedido en este navegador (sin cuenta).
  store.set('datos', { ...form, ok: false });
  stepConfirm();
}
function stepConfirm(errorMsg = '') {
  setStep(1);
  const zone = pickup() ? null : data.zones.find((item) => item.id === form.zone);
  const body = qs('#co-body');
  if ((!pickup() && !zone) || !body) return;
  const sum = totals(zone?.fee ?? 0);
  const pay = data.payments.find((method) => method.code === form.pay)?.label ?? form.pay;
  const phone = normalizeColombianMobile(form.phone) ?? '';
  const lines = cart
    .map((line) => {
      const product = byId(line.productId);
      const unit = product
        ? line.combo && product.comboPrice !== null
          ? product.comboPrice
          : product.price
        : 0;
      return `<div><span>${line.qty} × ${esc(info.get(line.productId)?.name)}${line.combo ? ' (combo)' : ''}</span><span>${money(unit * line.qty)}</span></div>`;
    })
    .join('');
  body.innerHTML = `
    <h2 class="display h-md" id="co-title">Confirma tu pedido</h2>
    ${errorMsg ? `<p class="form-error" role="alert">${esc(errorMsg)}</p>` : ''}
    <div class="summary">${lines}
      ${zone ? `<div class="muted"><span>Domicilio a ${esc(zone.name)}</span><span>${sum.fee ? money(sum.fee) : 'Gratis'}</span></div>` : '<div class="muted"><span>Recoges en tienda</span><span>Sin domicilio</span></div>'}
      ${sum.discount ? `<div class="muted"><span>Cupón ${esc(coupon?.code)}</span><span>−${money(sum.discount)}</span></div>` : ''}
      ${sum.gift ? `<div class="muted"><span>🎁 ${esc(sum.gift)}</span><span>$0</span></div>` : ''}
      ${couponCode && !coupon ? `<div class="muted"><span>Cupón ${esc(couponCode)}</span><span>se valida al confirmar</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(sum.total)}</span></div>
      <div class="muted"><span>${esc(form.name)} · ${zone ? `${esc(form.address)}, ${esc(form.barrio)}` : esc(data.storeAddress)}</span><span>${esc(pay)}</span></div>
    </div>
    <div class="confirm-actions">
      <button class="btn btn-primary btn-lg btn-block" type="button" id="send-order">Confirmar pedido · ${money(sum.total)}</button>
      <button class="btn btn-soft btn-block" type="button" id="co-back">Cambiar datos</button>
      <p class="center-note">Sigue tu pedido en vivo con el enlace que te damos al confirmar. Celular ${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}.</p>
    </div>`;
  qs('#send-order')?.addEventListener('click', placeOrder);
  qs('#co-back')?.addEventListener('click', () => stepData());
}

let sending = false;
async function placeOrder() {
  if (sending) return;
  sending = true;
  const btn = qs<HTMLButtonElement>('#send-order');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando…';
  }
  try {
    const { status, body } = await callFunction<{
      ok: boolean;
      code?: string;
      token?: string;
      total?: number;
      error?: PedidoError;
      message?: string;
    }>('crear-pedido', {
      restaurant: data.restaurant,
      fulfillment: pickup() ? 'recoger' : 'domicilio',
      customer: pickup()
        ? { name: form.name, phone: form.phone, notes: form.notes }
        : {
            name: form.name,
            phone: form.phone,
            address: form.address,
            barrio: form.barrio,
            zone_id: form.zone,
            notes: form.notes,
          },
      payment_code: form.pay,
      cash_with: form.cash || undefined,
      coupon: couponCode || undefined,
      items: cart.map((line) => ({ product_id: line.productId, qty: line.qty, combo: line.combo })),
      acepta_datos: form.ok,
      promos: form.promos,
      elapsed_ms: Date.now() - startedAt,
      turnstile: await turnstileToken(),
      sitio_web: qs<HTMLInputElement>('#f-hp')?.value ?? '',
    });
    if (!body.ok || !body.code || !body.token) {
      const reason = body.error ?? 'error';
      if (reason === 'agotado') await refreshAvailability();
      if (reason === 'recoger') {
        await refreshOrdering();
        form.mode = 'domicilio';
        return stepData(body.message ?? mensajesPedido.recoger);
      }
      if (reason === 'cupon' || reason === 'cupon_usado') {
        coupon = null;
        couponCode = '';
      }
      stepConfirm(body.message ?? mensajesPedido[reason] ?? mensajesPedido.error);
      if (status >= 500) toast('Revisa tu conexión e inténtalo de nuevo');
      return;
    }
    const sentPickup = pickup();
    const order: RememberedOrder = { code: body.code, token: body.token, at: Date.now() };
    store.set('pedidos', rememberOrder(store.get<RememberedOrder[]>('pedidos', []), order));
    cart = [];
    coupon = null;
    couponCode = '';
    saveCart();
    const link = trackPath(order.code, order.token);
    const done = qs('#co-body');
    if (done)
      done.innerHTML = `<div class="done">
        <p class="eyebrow">Pedido recibido</p>
        <p class="code">${esc(order.code)}</p>
        <p class="muted">Ya le llegó al parrillero. Total ${money(body.total ?? 0)} · ${sentPickup ? `recoges en ${esc(data.storeAddress)}` : `entrega estimada ${esc(data.deliveryEta)}`}. Síguelo en vivo con tu enlace único; también lo verás en esta página mientras esté activo.</p>
        <a class="btn btn-primary btn-lg btn-block" href="${esc(link)}">Seguir mi pedido</a>
        <button class="btn btn-soft btn-block" type="button" id="copy-track">Copiar enlace de seguimiento</button>
        <button class="popup-later" type="button" data-close-modal>Seguir mirando la carta</button></div>`;
    qs('#copy-track')?.addEventListener('click', async () => {
      const url = new URL(link, location.href).href;
      try {
        await navigator.clipboard.writeText(url);
        toast('Enlace copiado. Guárdalo o compártelo');
      } catch {
        prompt('Copia tu enlace de seguimiento:', url);
      }
    });
    renderTracker();
  } catch {
    stepConfirm('No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.');
  } finally {
    sending = false;
  }
}

/* ---------- Cloudflare Turnstile (solo si hay clave; en local la función lo omite) ---------- */
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  getResponse: (id: string) => string;
};
let turnstileId = '';
function renderTurnstile() {
  if (!data.turnstileKey) return;
  const mount = () => {
    const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    const el = qs('#turnstile');
    if (api && el)
      turnstileId = api.render(el, {
        sitekey: data.turnstileKey,
        appearance: 'interaction-only',
        language: 'es',
      });
  };
  if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) return mount();
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.onload = mount;
  document.head.append(script);
}
async function turnstileToken(): Promise<string> {
  const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  return api && turnstileId ? api.getResponse(turnstileId) : '';
}

/* ---------- Seguimiento sin cuenta (D21) ---------- */
type PublicOrder = { code: string; status: string };
async function renderTracker() {
  const el = qs<HTMLAnchorElement>('#tracker');
  if (!el) return;
  const latest = recentOrders(store.get<RememberedOrder[]>('pedidos', []), Date.now())[0];
  if (!latest || location.pathname.startsWith('/pedido')) {
    el.hidden = true;
    return;
  }
  try {
    const { body } = await callFunction<{ ok: boolean; order?: PublicOrder }>('seguir-pedido', {
      restaurant: data.restaurant,
      code: latest.code,
      token: latest.token,
    });
    const status = body.order?.status;
    if (!status || status === 'entregado' || status === 'cancelado') {
      el.hidden = true;
      return;
    }
    const label = ORDER_STEPS.find(([key]) => key === status)?.[1] ?? status;
    el.href = trackPath(latest.code, latest.token);
    el.innerHTML = `<span class="tracker-dot"></span><span><b>Tu pedido ${esc(latest.code)}</b><small>${esc(label)}</small></span><span aria-hidden="true">→</span>`;
    el.hidden = false;
  } catch {
    el.hidden = true;
  }
}
function openTrack() {
  returnFocus = document.activeElement as HTMLElement | null;
  const recent = store.get<RememberedOrder[]>('pedidos', []).slice(0, 3);
  const box = qs('#track-recent');
  if (box)
    box.innerHTML = recent.length
      ? `<p class="eyebrow">En este celular</p>${recent.map((order) => `<a class="zone" href="${esc(trackPath(order.code, order.token))}"><b>${esc(order.code)}</b><span>Ver →</span></a>`).join('')}`
      : '';
  const modal = qs('#track');
  if (modal) modal.hidden = false;
  lockScroll(true);
  qs<HTMLInputElement>('#t-code')?.focus();
}
qs('#track-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = val('#t-code').toUpperCase();
  const code = /^\d+$/.test(raw)
    ? `${data.restaurant === 'jp-smoke' ? 'JP' : 'PED'}-${raw.padStart(4, '0')}`
    : raw;
  const last4 = val('#t-last').replace(/\D/g, '');
  const err = qs('#track-error');
  if (!/^[A-Z]{2,4}-\d{4,6}$/.test(code) || last4.length !== 4) {
    if (err) err.hidden = false;
    return;
  }
  try {
    sessionStorage.setItem(`${data.restaurant}:buscar`, JSON.stringify({ code, last4 }));
  } catch {
    /* sin sesión: la página pedirá los datos */
  }
  location.href = `/pedido?c=${encodeURIComponent(code)}`;
});

/* ---------- Bienvenida: pantalla completa o aviso (D16) ---------- */
function showWelcome() {
  const params = new URLSearchParams(location.search);
  const forced = params.get('intro');
  const mode = forced === 'completa' || forced === 'aviso' || forced === 'ninguna' ? forced : data.introMode;
  let seen = false;
  try {
    seen = sessionStorage.getItem(`${data.restaurant}:bienvenida`) === '1';
  } catch {
    /* nada */
  }
  if (!data.introEvent || mode === 'ninguna' || (seen && !forced)) return;
  const markSeen = () => {
    try {
      sessionStorage.setItem(`${data.restaurant}:bienvenida`, '1');
    } catch {
      /* nada */
    }
  };
  if (mode === 'aviso') return showPopup(markSeen);
  const el = qs('#intro');
  if (!el) return;
  el.hidden = false;
  lockScroll(true);
  requestAnimationFrame(() => requestAnimationFrame(() => qs('#intro-bar')?.classList.add('is-full')));
  setTimeout(() => el.classList.add('is-ready'), reduced ? 0 : 2400);
  const close = () => {
    el.classList.add('is-out');
    lockScroll(false);
    markSeen();
    setTimeout(() => (el.hidden = true), 900);
  };
  qsa('[data-intro-close]', el).forEach((btn) => btn.addEventListener('click', close));
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.hidden) close();
  });
}
function showPopup(markSeen: () => void) {
  const el = qs('#popup');
  if (!el) return;
  const close = () => {
    el.hidden = true;
    lockScroll(false);
    markSeen();
  };
  qsa('[data-pop-close]', el).forEach((btn) => btn.addEventListener('click', close));
  el.addEventListener('click', (event) => {
    if (event.target === el) close();
  });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.hidden) close();
  });
  qs('#pop-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = val('#p-name');
    const phone = normalizeColombianMobile(val('#p-phone'));
    qs('#p-name')?.setAttribute('aria-invalid', String(name.length < 2));
    qs('#p-phone')?.setAttribute('aria-invalid', String(!phone));
    const err = qs('#pop-error');
    const fail = (message: string) => {
      if (err) {
        err.textContent = message;
        err.hidden = false;
      }
    };
    if (name.length < 2 || !phone) return fail('Revisa nombre y celular.');
    if (!qs<HTMLInputElement>('#p-ok')?.checked)
      return fail('Necesitamos tu autorización para enviarte el cupón.');
    const { body } = await callFunction<{ ok: boolean; coupon?: string; title?: string; error?: string }>(
      'captar',
      {
        restaurant: data.restaurant,
        event_id: el.dataset.event,
        name,
        phone,
        acepta_datos: true,
        turnstile: await turnstileToken(),
        sitio_web: val('#p-hp'),
      },
    ).catch(() => ({
      body: { ok: false, error: 'error' } as { ok: boolean; coupon?: string; title?: string; error?: string },
    }));
    if (!body.ok || !body.coupon) {
      return fail(
        body.error === 'ya_registrado'
          ? 'Este celular ya recibió su cupón de bienvenida.'
          : 'No pudimos generar tu cupón. Inténtalo de nuevo.',
      );
    }
    const code = body.coupon;
    const box = qs('#pop-body');
    if (box)
      box.innerHTML = `<p class="eyebrow">${esc(body.title)}</p><h2 class="display popup-title" id="pop-title">¡Listo, ${esc(name.split(' ')[0])}!</h2>
        <p class="popup-text">Este es tu cupón. Úsalo en tu pedido:</p>
        <div class="coupon"><div class="coupon-code"><code>${esc(code)}</code></div></div>
        <button class="btn btn-primary btn-lg btn-block" type="button" id="pop-use">Usar en mi pedido</button>`;
    qs('#pop-use')?.addEventListener('click', () => {
      close();
      applyCoupon(code, false);
      qs('#carta')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
  });
  setTimeout(
    () => {
      el.hidden = false;
      lockScroll(true);
      (qs<HTMLInputElement>('#p-name') ?? qs<HTMLButtonElement>('.popup-x'))?.focus();
    },
    reduced ? 0 : 1200,
  );
}

/* ---------- Cotización de eventos (F7): función cotizar, queda en el panel ---------- */
qs('#open-quote')?.addEventListener('click', () => {
  returnFocus = document.activeElement as HTMLElement | null;
  const modal = qs('#quote');
  if (modal) modal.hidden = false;
  lockScroll(true);
  qs<HTMLSelectElement>('#q-tipo')?.focus();
});
qs('#quote-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const err = qs('#q-error');
  const fail = (message: string) => {
    if (err) {
      err.textContent = message;
      err.hidden = false;
    }
  };
  const required = ['#q-tipo', '#q-nombre', '#q-msg'];
  required.forEach((sel) => qs(sel)?.setAttribute('aria-invalid', String(!val(sel))));
  const phone = normalizeColombianMobile(val('#q-cel'));
  qs('#q-cel')?.setAttribute('aria-invalid', String(!phone));
  if (!required.every((sel) => val(sel)) || !phone) return fail('Completa los campos marcados.');
  if (!qs<HTMLInputElement>('#q-ok')?.checked) return fail('Necesitamos tu autorización para responderte.');
  const { status, body } = await callFunction<{ ok: boolean; error?: string }>('cotizar', {
    restaurant: data.restaurant,
    kind: val('#q-tipo'),
    name: val('#q-nombre'),
    phone,
    event_date: val('#q-fecha'),
    guests: val('#q-personas'),
    message: val('#q-msg'),
    acepta_datos: true,
    turnstile: await turnstileToken(),
    sitio_web: val('#q-hp'),
  }).catch(() => ({ status: 0, body: { ok: false } as { ok: boolean; error?: string } }));
  if (!body.ok) {
    return fail(
      body.error === 'demasiados_intentos'
        ? 'Ya recibimos tus solicitudes de hoy. Te escribimos pronto.'
        : status === 0
          ? 'No pudimos conectarnos. Inténtalo de nuevo.'
          : 'Revisa los datos e inténtalo de nuevo.',
    );
  }
  (event.target as HTMLFormElement).reset();
  if (err) err.hidden = true;
  closeModals();
  toast('Solicitud enviada. Te escribimos en menos de 24 h ✔');
});

/* ---------- Aparición al hacer scroll ---------- */
const io = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }),
  { threshold: 0.12 },
);
qsa('.reveal').forEach((el) => io.observe(el));

updateHero();
syncCount();
void refreshAvailability();
void renderTracker();
showWelcome();
