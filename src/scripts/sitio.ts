// Comportamiento del sitio público (F4). Portado del mockup aprobado (mockup/assets/sitio.js).
// El total que vale lo calcula el servidor (place_order); aquí solo se muestra la vista previa (src/core/cart.ts).
import type { ClientData } from '../lib/content';
import {
  addLine,
  attachAddon,
  cartTotals,
  changeQty,
  childrenOf,
  comboUpsell,
  dropAddonsWithoutDish,
  hasDish,
  normalizeCart,
  orderItems,
  type CartCoupon,
  type CartLine,
  type CartProduct,
} from '../core/cart';
import { formatCop as money } from '../core/money';
import { normalizeColombianMobile } from '../core/phone';
import { bogotaDay, forcedWelcome, welcomeToShow } from '../core/welcome';
import {
  rememberOrder,
  recentOrders,
  trackPath,
  type Fulfillment,
  type RememberedOrder,
  ORDER_STEPS,
} from '../core/tracking';
import { mensajesPedido, type PedidoError } from '../../supabase/functions/_shared/mensajes';
import { createTokenGate, type TokenGate } from '../core/token-gate';
import {
  asLocalities,
  coverageFor,
  coverageForLocality,
  coverageMessage,
  toleranceFor,
  zoneForLocality,
  type Coverage,
  type GeoProblem,
  type Locality,
} from '../core/coverage';

// Lo oculto por `.reveal` solo se oculta si este script corre (sin JS o con error, todo se ve).
document.documentElement.classList.add('js-reveal');

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

/* ---------- Aparición al hacer scroll ----------
   Va al principio: un error más abajo no puede dejar secciones en opacity 0. Lo que ya está sobre el
   pliegue se muestra de una; sin IntersectionObserver se muestra todo. */
(function setupReveal() {
  const items = qsa('.reveal');
  const show = (el: Element) => el.classList.add('is-in');
  if (!('IntersectionObserver' in window)) return items.forEach(show);
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        show(entry.target);
        io.unobserve(entry.target);
      }),
    { threshold: 0, rootMargin: '0px 0px 10% 0px' },
  );
  items.forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight) show(el);
    else io.observe(el);
  });
})();

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
const newKey = () => crypto.randomUUID();
const isAddon = (id: string) => info.get(id)?.addon ?? false;
let cart = dropAddonsWithoutDish(
  normalizeCart(
    store.get<CartLine[]>('carrito', []).filter((line) => info.has(line.productId)),
    newKey,
  ),
  isAddon,
).lines;
/** D47: si ya no queda ningún plato, se quitan las adiciones (ligadas y aparte) con aviso. */
function dropOrphanAddons() {
  const result = dropAddonsWithoutDish(cart, isAddon);
  if (!result.removed) return;
  cart = result.lines;
  store.set('carrito', cart);
  toast('Quitamos las adiciones: van con un plato');
}
let coupon: CartCoupon | null = null;
let couponCode = '';
const choice = new Map<string, boolean>();

function toast(message: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  const box = qs('#toasts');
  box?.append(el);
  // Máximo 2 a la vez: si no, al agregar varias cosas seguidas tapan la pantalla.
  while (box && box.children.length > 2) box.firstElementChild?.remove();
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
type StockStatus = { sold_out: string[]; combo_out: string[] };
function fetchStockStatus(): Promise<StockStatus | null> {
  return fetch(`${data.supabaseUrl}/rest/v1/rpc/stock_status`, {
    method: 'POST',
    headers: {
      apikey: data.anonKey,
      Authorization: `Bearer ${data.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_restaurant: data.restaurant }),
  })
    .then((res) => (res.ok ? (res.json() as Promise<StockStatus>) : null))
    .catch(() => null);
}
function applyStockStatus(status: StockStatus) {
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
  cart = normalizeCart(
    cart.filter(
      (line) =>
        products.some((product) => product.id === line.productId && product.available) &&
        !(line.combo && comboOut.has(line.productId)),
    ),
    newKey,
  );
  dropOrphanAddons();
}

/** Zonas, medios de pago, mínimo y "recibiendo pedidos" también en vivo (F6): el admin los cambia sin publicar. */
type Ordering = [settings: unknown, zones: unknown, payments: unknown];
function fetchOrdering(): Promise<Ordering> {
  const rid = `restaurant_id=eq.${data.restaurantId}`;
  const safe = (path: string) => rest(path).catch(() => null);
  return Promise.all([
    safe(
      `restaurant_settings?select=accepting_orders,delivery_min,delivery_eta,pickup_enabled,store_address&${rid}`,
    ),
    safe(`delivery_zones?select=id,name,fee,active,locality_code&active=eq.true&order=position&${rid}`),
    safe(`payment_methods?select=code,label,asks_change&order=position&${rid}`),
  ]);
}
function applyOrdering([settings, zones, payments]: Ordering) {
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
  if (Array.isArray(zones)) {
    data.zones = (
      zones as Array<{ id: string; name: string; fee: number; active: boolean; locality_code: string | null }>
    ).map(({ locality_code, ...zone }) => ({ ...zone, localityCode: locality_code ?? null }));
    syncCoverage();
  }
  if (Array.isArray(payments))
    data.payments = (payments as Array<{ code: string; label: string; asks_change: boolean }>).map((row) => ({
      code: row.code,
      label: row.label,
      asksChange: row.asks_change,
    }));
}
async function refreshOrdering() {
  applyOrdering(await fetchOrdering());
}

type LiveProduct = { id: string; price: number; combo_price: number | null; available: boolean };
function applyLiveProducts(live: LiveProduct[]) {
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
  cart = normalizeCart(
    cart.filter((line) => products.some((product) => product.id === line.productId && product.available)),
    newKey,
  );
  dropOrphanAddons();
}

/**
 * D51: productos, inventario, ajustes, zonas y pagos en una sola tanda (5 peticiones en paralelo).
 * Se aplican en orden lógico: primero productos, luego inventario (que agota sobre esos productos),
 * luego lo del pedido. Cada petición falla sola: sin conexión se usa lo publicado.
 */
async function refreshAvailability() {
  try {
    const [live, stock, ordering] = await Promise.all([
      rest(`products?select=id,price,combo_price,available&restaurant_id=eq.${data.restaurantId}`).catch(
        () => null,
      ),
      fetchStockStatus(),
      fetchOrdering(),
    ]);
    if (Array.isArray(live)) applyLiveProducts(live as LiveProduct[]);
    if (stock) applyStockStatus(stock);
    syncCount();
    applyOrdering(ordering);
  } catch {
    /* sin conexión: se usa lo publicado */
  }
}

/* ---------- Inicio: 4 productos que se despliegan ----------
   D50: en celular o pantalla táctil (y con "reducir movimiento" en cualquier ancho) el inicio mide una
   pantalla y las fotos entran solas con CSS. Solo el escritorio liga la animación al desplazamiento. */
const hero = qs('#inicio');
const heroCards = qsa<HTMLElement>('.hcard');
/** Debe coincidir con la media query del bloque D50 de sitio.css. */
const compactHero = matchMedia('(max-width: 760px), (pointer: coarse)');
/** El progreso sigue al scroll solo en escritorio y sin "reducir movimiento". */
const heroLinked = () => Boolean(hero) && !reduced && !compactHero.matches;
type Layout = { start: number[][]; end: number[][]; s0: number; s1: number; vw: number; vh: number };
function layout(): Layout {
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
    vw: innerWidth,
    vh: innerHeight,
  };
}
let lay = layout();
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
/** Progreso objetivo según el desplazamiento (0 = juntas, 1 = separadas). */
function heroTarget(): number {
  if (!hero || reduced) return 1;
  const rect = hero.getBoundingClientRect();
  const total = (hero.offsetHeight - innerHeight) * 0.7;
  if (total <= 0) return 1;
  return ease(Math.min(1, Math.max(0, -rect.top / total)));
}
const heroLabels = heroCards.map((card) => card.querySelector<HTMLElement>('.hcard-label'));
let heroShown = -1;
/** Pinta un progreso: transform directo en cada tarjeta (sin variables CSS por cuadro). */
function paintHero(progress: number) {
  if (!hero || Math.abs(progress - heroShown) < 0.0005) return;
  heroShown = progress;
  hero.style.setProperty('--p', progress.toFixed(3));
  hero.classList.toggle('is-spread', progress > 0.55);
  const lbl = Math.max(0, (progress - 0.55) / 0.45);
  heroCards.forEach((card, i) => {
    const from = lay.start[i];
    const to = lay.end[i];
    if (!from || !to) return;
    const [ax = 0, ay = 0, ar = 0] = from;
    const [bx = 0, by = 0, br = 0] = to;
    const x = (ax + (bx - ax) * progress) * lay.vw;
    const y = (ay + (by - ay) * progress) * lay.vh;
    const rot = ar + (br - ar) * progress;
    const sc = lay.s0 + (lay.s1 - lay.s0) * progress;
    card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    const label = heroLabels[i];
    if (label) {
      label.style.opacity = lbl.toFixed(2);
      label.style.transform = `translate3d(0, ${((1 - lbl) * 10).toFixed(1)}px, 0)`;
    }
  });
}
/** Modo de una pantalla: sin estilos en línea, manda el CSS. */
function clearHero() {
  if (!hero) return;
  if (heroLoop) cancelAnimationFrame(heroLoop);
  heroLoop = 0;
  heroShown = -1;
  hero.style.removeProperty('--p');
  hero.classList.remove('is-spread');
  heroCards.forEach((card) => card.style.removeProperty('transform'));
  heroLabels.forEach((label) => {
    label?.style.removeProperty('opacity');
    label?.style.removeProperty('transform');
  });
}
// Suavizado: el progreso persigue al objetivo cuadro a cuadro, así la rueda del mouse (que avanza a
// saltos) no se ve a tirones. Se detiene solo al llegar.
let heroCurrent = 0;
let heroLoop = 0;
function heroFrame() {
  const target = heroTarget();
  heroCurrent += (target - heroCurrent) * 0.16;
  if (Math.abs(target - heroCurrent) < 0.001) heroCurrent = target;
  paintHero(heroCurrent);
  heroLoop = heroCurrent === target ? 0 : requestAnimationFrame(heroFrame);
}
function updateHero(instant = false) {
  if (!hero) return;
  if (compactHero.matches) return clearHero();
  if (instant || reduced) {
    heroCurrent = heroTarget();
    heroShown = -1;
    paintHero(heroCurrent);
    return;
  }
  if (!heroLoop) heroLoop = requestAnimationFrame(heroFrame);
}
compactHero.addEventListener('change', () => {
  lay = layout();
  updateHero(true);
});
// En celular la barra del navegador aparece y desaparece al desplazarse y cambia el alto: solo se
// recalcula si cambia el ancho (giro de pantalla), para que las tarjetas no salten.
let lastWidth = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastWidth && matchMedia('(pointer: coarse)').matches) return;
  lastWidth = innerWidth;
  lay = layout();
  updateHero(true);
  sizeStrip();
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

/* ---------- Franja de novedades: velocidad constante (px/s) en cualquier pantalla ---------- */
function sizeStrip() {
  const track = qs<HTMLElement>('.strip-track');
  if (!track) return;
  const pxPerSecond = innerWidth < 760 ? 45 : 70;
  track.style.setProperty('--strip-dur', `${Math.max(20, track.scrollWidth / 2 / pxPerSecond).toFixed(1)}s`);
}
sizeStrip();

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
      try {
        if (heroLinked()) updateHero();
        headerOnScroll();
      } finally {
        ticking = false;
      }
    });
  },
  { passive: true },
);
/** Bloquea el scroll de la página con una clase en <html> (no estilos en body: Safari iOS movía la barra). */
function lockScroll(lock: boolean) {
  document.documentElement.classList.toggle('is-locked', lock);
  syncKeyboard();
}
// Con el teclado abierto la barra inferior fija se iba a media pantalla en iPhone: se oculta mientras
// haya un campo de texto con foco.
const NOT_TYPING = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);
const typing = (el: EventTarget | null) =>
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement ||
  (el instanceof HTMLInputElement && !NOT_TYPING.has(el.type)) ||
  (el instanceof HTMLElement && el.isContentEditable);
/** Se calcula siempre desde el foco real: un campo borrado (innerHTML) o un modal cerrado no deja la barra oculta. */
function syncKeyboard() {
  document.documentElement.classList.toggle('kb-open', typing(document.activeElement));
}
document.addEventListener('focusin', syncKeyboard);
document.addEventListener('focusout', () => setTimeout(syncKeyboard, 0));
const menuBtn = qs('#menu-btn');
const drawer = qs('#drawer');
function setDrawer(open: boolean) {
  if (!drawer || !menuBtn) return;
  drawer.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  lockScroll(open);
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
  // D51: la foto vive en un <picture>; la copia usa la versión que ya bajó (no el respaldo).
  if (img.currentSrc) ghost.src = img.currentSrc;
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
  // D47: una adición necesita un plato en el pedido; D40: con plato, pregunta a cuál va (o aparte).
  if (isAddon(id)) {
    if (!hasDish(cart, isAddon)) return needDishFirst();
    openAddonPicker(id, from);
    return;
  }
  const asCombo = combo && product.comboPrice !== null;
  cart = addLine(cart, id, asCombo, newKey);
  saveCart();
  flyTo(from);
  toast(`${info.get(id)?.name ?? 'Producto'}${asCombo ? ' en combo' : ''} agregado 🔥`);
  if (!qs('#cart')?.hidden) renderCart();
}

/** D47: sin plato no se agrega la adición; se lleva a la carta (fuera de adiciones). */
function needDishFirst() {
  toast('Primero elige un plato; las adiciones van con él');
  if (!qs('#cart')?.hidden) closeCart();
  if (activeCat !== 'todo' && qs(`#carta-pills [data-cat="${activeCat}"]`)?.dataset.addons === '1') {
    activeCat = 'todo';
    qsa('#carta-pills [data-cat]').forEach((pill) =>
      pill.setAttribute('aria-pressed', String(pill.dataset.cat === 'todo')),
    );
    filterMenu();
  }
  const carta = qs('#carta');
  if (carta) carta.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  else location.href = '/#carta';
}

/* ---------- Adiciones: ¿a cuál plato? (D40) ---------- */
let pendingAddon: { id: string; from: Element | null } | null = null;
function lineLabel(line: CartLine): string {
  const name = info.get(line.productId)?.name ?? 'Producto';
  const extras = childrenOf(cart, line.key)
    .map((child) => `${child.qty > 1 ? `${child.qty}× ` : ''}${info.get(child.productId)?.name ?? ''}`)
    .join(', ');
  return `${name}${line.combo ? ' (combo)' : ''}${extras ? ` · ya lleva: ${extras}` : ''}`;
}
function openAddonPicker(id: string, from: Element | null) {
  const modal = qs('#addon-pick');
  const list = qs('#addon-list');
  if (!modal || !list) return;
  pendingAddon = { id, from };
  const title = qs('#addon-title');
  if (title) title.textContent = `¿A cuál le agregas ${info.get(id)?.name ?? 'la adición'}?`;
  const dishes = cart.filter((line) => !line.parent && !info.get(line.productId)?.addon);
  list.innerHTML =
    dishes
      .map((line) => {
        const meta = info.get(line.productId);
        const many =
          line.qty > 1 ? `<small>Tienes ${line.qty}: se la agregamos a 1 de las ${line.qty}</small>` : '';
        return `<button type="button" class="addon-opt" data-addon-to="${esc(line.key)}">${meta?.image ? `<img src="${esc(meta.image)}" alt="">` : '<span class="ph"></span>'}<span><b>${esc(lineLabel(line))}</b>${many}</span></button>`;
      })
      .join('') +
    `<button type="button" class="addon-opt addon-apart" data-addon-to=""><span class="ph">＋</span><span><b>Aparte</b><small>No va con ningún plato</small></span></button>`;
  returnFocus = document.activeElement as HTMLElement | null;
  modal.hidden = false;
  lockScroll(true);
  qs<HTMLButtonElement>('#addon-list .addon-opt')?.focus();
}
qs('#addon-list')?.addEventListener('click', (event) => {
  const opt = (event.target as HTMLElement).closest<HTMLElement>('[data-addon-to]');
  if (!opt || !pendingAddon) return;
  const parentKey = opt.dataset.addonTo || null;
  const { id, from } = pendingAddon;
  pendingAddon = null;
  const parent = parentKey ? cart.find((line) => line.key === parentKey) : null;
  cart = attachAddon(cart, id, parentKey, newKey);
  saveCart();
  closeModals();
  flyTo(from);
  const name = info.get(id)?.name ?? 'Adición';
  toast(
    parent
      ? `${name} agregado a ${info.get(parent.productId)?.name ?? 'tu plato'} 🔥`
      : `${name} agregado aparte 🔥`,
  );
  if (!qs('#cart')?.hidden) renderCart();
});

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
function openCart() {
  returnFocus = document.activeElement as HTMLElement | null;
  void loadTurnstile(); // precarga: el token está listo al llegar a Confirmar
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
    .map((line) => {
      const meta = info.get(line.productId);
      const product = byId(line.productId);
      if (!meta || !product) return '';
      const unit = line.combo && product.comboPrice !== null ? product.comboPrice : product.price;
      const key = esc(line.key);
      // D40: la adición se ve debajo de su plato.
      if (line.parent)
        return `<div class="line line-addon"><span class="addon-mark" aria-hidden="true">＋</span>
        <div><h4>${esc(meta.name)}</h4><small>Para ${esc(info.get(cart.find((item) => item.key === line.parent)?.productId ?? '')?.name)} · ${money(unit)}</small></div>
        <div class="qty"><button type="button" data-q="${key}" data-d="-1" aria-label="Quitar uno">−</button><span>${line.qty}</span><button type="button" data-q="${key}" data-d="1" aria-label="Agregar uno">＋</button></div></div>`;
      const label = line.combo
        ? 'Combo · papas + gaseosa'
        : product.comboPrice !== null
          ? 'Sola'
          : meta.addon
            ? 'Aparte'
            : '';
      return `<div class="line">${meta.image ? `<img src="${esc(meta.image)}" alt="">` : '<span class="ph"></span>'}
        <div><h4>${esc(meta.name)}</h4><small>${label}${label ? ' · ' : ''}${money(unit)}</small></div>
        <div class="qty"><button type="button" data-q="${key}" data-d="-1" aria-label="Quitar uno">−</button><span>${line.qty}</span><button type="button" data-q="${key}" data-d="1" aria-label="Agregar uno">＋</button></div></div>`;
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
    cart = changeQty(cart, qtyBtn.dataset.q ?? '', Number(qtyBtn.dataset.d), newKey);
    dropOrphanAddons();
    saveCart();
    renderCart();
    return;
  }
  const up = target.closest<HTMLElement>('[data-upsell]');
  if (up) {
    const id = up.dataset.upsell ?? '';
    const single = cart.find((line) => line.productId === id && !line.combo && !line.parent);
    const plain = (line: CartLine) => childrenOf(cart, line.key).length === 0;
    const twin = cart.find((line) => line.productId === id && line.combo && !line.parent && plain(line));
    if (single && twin && plain(single)) {
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

/* ---------- Cobertura verificable (D44) ----------
   La ubicación se lee en el navegador y solo se compara aquí con los límites: no se guarda ni se envía.
   Los polígonos se cargan al tocar "Usar mi ubicación" (import diferido). El servidor sigue validando la zona. */
type LiveZone = ClientData['zones'][number];
const geoSupported = 'geolocation' in navigator;
let localitiesLoad: Promise<Locality[]> | null = null;
function loadLocalities(): Promise<Locality[]> {
  localitiesLoad ??= import('../data/bogota-localidades.json')
    .then((mod) => asLocalities(mod.default))
    .catch((error: unknown) => {
      localitiesLoad = null; // el siguiente intento vuelve a cargarlos
      throw error;
    });
  return localitiesLoad;
}
type GeoOutcome = Coverage<LiveZone> | { kind: 'problem'; problem: GeoProblem };
function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000,
    }),
  );
}
async function locateCoverage(): Promise<GeoOutcome> {
  if (!geoSupported) return { kind: 'problem', problem: 'unsupported' };
  let position: GeolocationPosition;
  try {
    [position] = await Promise.all([currentPosition(), loadLocalities().catch(() => null)]);
  } catch (error) {
    const code = (error as GeolocationPositionError | null)?.code;
    return { kind: 'problem', problem: code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable' };
  }
  const tolerance = toleranceFor(position.coords.accuracy);
  if (tolerance === null) return { kind: 'problem', problem: 'imprecise' };
  try {
    const localities = await loadLocalities();
    return coverageFor(
      [position.coords.longitude, position.coords.latitude],
      data.zones,
      localities,
      tolerance,
    );
  } catch {
    return { kind: 'problem', problem: 'failed' };
  }
}
/** Localidad elegida en la lista (no necesita polígonos). */
function coverageForCode(code: string, name: string): Coverage<LiveZone> {
  return coverageForLocality({ code, name, rings: [] }, data.zones);
}
function waAsk(localityName: string | null) {
  if (!data.whatsapp) return '';
  const text = localityName
    ? `¡Hola ${data.restaurantName}! ¿Llegan a ${localityName}?`
    : `¡Hola ${data.restaurantName}! ¿Llegan a mi barrio?`;
  return ` <a href="https://wa.me/${esc(data.whatsapp)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a>`;
}
/** `yesHtml` va tras un sí (enlace propio); `noText`, tras un "todavía no" y antes de WhatsApp. */
function paintMessage(
  el: HTMLElement,
  outcome: GeoOutcome,
  extra: { yesHtml?: string; noText?: string } = {},
) {
  const msg = coverageMessage(outcome, money);
  el.classList.toggle('is-yes', msg.tone === 'yes');
  el.classList.toggle('is-no', msg.tone === 'no');
  el.innerHTML =
    esc(msg.text) +
    (msg.tone === 'yes' ? (extra.yesHtml ?? '') : '') +
    (msg.tone === 'no' && extra.noText ? ` ${esc(extra.noText)}` : '') +
    (msg.offerWhatsApp ? waAsk(msg.localities[0]?.name ?? null) : '');
  pickOnMap(msg.localities.map((locality) => locality.code));
}
function pickOnMap(codes: string[]) {
  qsa<SVGPathElement>('#cover-map [data-loc]').forEach((path) =>
    path.classList.toggle('is-picked', codes.includes(path.dataset.loc ?? '')),
  );
}
/** Pinta en vivo las localidades con zona activa y la lista de zonas (lo compilado sirve sin JS). */
function syncCoverage() {
  qsa<SVGPathElement>('#cover-map [data-loc]').forEach((path) =>
    path.classList.toggle('is-on', zoneForLocality(path.dataset.loc ?? '', data.zones) !== null),
  );
  qsa<HTMLElement>('#cobertura [data-zone-id]').forEach((item) => {
    const zone = data.zones.find((row) => row.id === item.dataset.zoneId);
    item.classList.toggle('off', !zone);
    const label = item.querySelector('span');
    if (label) label.textContent = zone ? `Domicilio ${money(zone.fee)}` : 'Pronto';
  });
}
async function withBusy(btn: HTMLButtonElement, run: () => Promise<void>) {
  if (btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    await run();
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
(function setupCoverCheck() {
  const geoBtn = qs<HTMLButtonElement>('[data-geo="cover"]');
  const select = qs<HTMLSelectElement>('#cover-loc');
  const result = qs('#cover-result');
  if (!result) return;
  const orderLink = ' <a href="#carta">Pide ahora</a>';
  if (geoBtn && geoSupported) geoBtn.hidden = false;
  geoBtn?.addEventListener('click', () =>
    withBusy(geoBtn, async () => {
      const outcome = await locateCoverage();
      if (select) select.value = outcome.kind === 'inside' ? outcome.locality.code : '';
      paintMessage(result, outcome, { yesHtml: orderLink });
    }),
  );
  select?.addEventListener('change', () => {
    if (!select.value) {
      result.textContent = '';
      result.classList.remove('is-yes', 'is-no');
      pickOnMap([]);
      return;
    }
    const name = select.selectedOptions[0]?.textContent?.trim() ?? '';
    paintMessage(result, coverageForCode(select.value, name), { yesHtml: orderLink });
  });
})();
/** En el pedido: si la ubicación cae en una zona activa la deja elegida; si no, aviso junto al campo. */
async function checkoutGeo(btn: HTMLButtonElement) {
  await withBusy(btn, async () => {
    const outcome = await locateCoverage();
    // El formulario pudo redibujarse mientras tanto: se buscan los elementos de nuevo.
    const select = qs<HTMLSelectElement>('#f-zone');
    const note = qs('#f-geo');
    if (!select || !note) return;
    if (outcome.kind === 'inside' && outcome.covered && outcome.zone) {
      select.value = outcome.zone.id;
      fieldError('#f-zone', '');
      form.zone = outcome.zone.id;
      paintMessage(note, outcome);
      return;
    }
    paintMessage(note, outcome, { noText: 'Si el pedido es para otra dirección, elige su localidad.' });
  });
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
// Tiempo mínimo antiabuso (elapsed_ms ≥ 4 s en el servidor): se cuenta desde la carga de la página y no se
// reinicia al reabrir Datos; con datos recordados se confirmaba en menos de 4 s y quedaba como robot.
const startedAt = Date.now();
function setStep(step: number) {
  qsa('#co-steps li').forEach((li, i) => li.classList.toggle('is-on', i <= step));
}
function openCheckout() {
  returnFocus = document.activeElement as HTMLElement | null;
  const modal = qs('#checkout');
  if (modal) modal.hidden = false;
  lockScroll(true);
  mountTurnstile('pedido', qs('#checkout .modal-card'));
  stepData();
}
const pickup = () => form.mode === 'recoger' && data.pickupEnabled;
function stepData(errorMsg = '') {
  setStep(0);
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
        .join('')}</select><span class="error"></span></div>
      <div class="field span-2 geo-row">${geoSupported ? '<button class="btn btn-soft btn-sm" type="button" data-geo="checkout">📍 Usar mi ubicación</button>' : ''}<p class="geo-note" id="f-geo" role="status" aria-live="polite"></p></div>`
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
  const geoBtn = qs<HTMLButtonElement>('#co-form [data-geo="checkout"]');
  geoBtn?.addEventListener('click', () => void checkoutGeo(geoBtn));
  qs('#co-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitData();
  });
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
      return line.parent
        ? `<div class="sum-addon"><span>+ ${line.qty} × ${esc(info.get(line.productId)?.name)}</span><span>${money(unit * line.qty)}</span></div>`
        : `<div><span>${line.qty} × ${esc(info.get(line.productId)?.name)}${line.combo ? ' (combo)' : ''}</span><span>${money(unit * line.qty)}</span></div>`;
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
  if (btn) btn.disabled = true;
  try {
    const turnstile = await turnstileToken('pedido', btn);
    if (turnstile === null) return stepConfirm(turnstileFail());
    if (btn) btn.textContent = 'Enviando…';
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
      items: orderItems(cart),
      acepta_datos: form.ok,
      promos: form.promos,
      elapsed_ms: Math.min(Date.now() - startedAt, 86_400_000), // tope del esquema del servidor
      turnstile,
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
    resetTurnstile('pedido');
  }
}

/* ---------- Cloudflare Turnstile (solo si hay clave; en local la función lo omite) ----------
   Un widget por formulario (pedido, cupón, cotización), montado una sola vez en un contenedor que no se
   redibuja. El token llega por callback a una compuerta; el envío lo espera con tope y se reinicia el
   widget después de cada intento (el token es de un solo uso). */
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
};
type TurnstileSlot = { host: HTMLElement; gate: TokenGate; id: string; spent: boolean };
const TURNSTILE_WAIT_MS = 10_000;
const TURNSTILE_FAIL = 'No pudimos verificar tu conexión, intenta de nuevo.';
const TURNSTILE_BLOCKED =
  'No pudimos cargar la verificación. Revisa tu conexión o desactiva el bloqueador y vuelve a intentar.';
/** El script de Turnstile no cargó (red o bloqueador): mensaje distinto al de tiempo agotado. */
let turnstileBlocked = false;
const turnstileFail = () => (turnstileBlocked ? TURNSTILE_BLOCKED : TURNSTILE_FAIL);
const turnstileSlots = new Map<string, TurnstileSlot>();
let turnstileScript: Promise<TurnstileApi | null> | null = null;
const turnstileApi = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null;
function loadTurnstile(): Promise<TurnstileApi | null> {
  if (!data.turnstileKey) return Promise.resolve(null);
  const ready = turnstileApi();
  if (ready) return Promise.resolve(ready);
  turnstileScript ??= new Promise((resolve) => {
    const hint = document.createElement('link');
    hint.rel = 'preconnect';
    hint.href = 'https://challenges.cloudflare.com';
    document.head.append(hint);
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      turnstileBlocked = false;
      resolve(turnstileApi());
    };
    script.onerror = () => {
      script.remove();
      turnstileBlocked = true;
      turnstileScript = null; // el siguiente intento vuelve a cargarlo
      resolve(null);
    };
    document.head.append(script);
  });
  return turnstileScript;
}
async function renderSlot(slot: TurnstileSlot) {
  if (slot.id) return;
  const api = await loadTurnstile();
  if (!api || slot.id || !slot.host.isConnected) return;
  try {
    slot.id = api.render(slot.host, {
      sitekey: data.turnstileKey,
      appearance: 'interaction-only',
      language: 'es',
      'refresh-expired': 'auto',
      callback: (token: string) => slot.gate.set(token),
      'expired-callback': () => slot.gate.clear(),
      'error-callback': () => {
        slot.gate.clear();
        return true; // Turnstile reintenta solo
      },
    });
  } catch {
    slot.id = '';
  }
}
/** Crea (una vez) el contenedor del widget dentro de `parent`, antes de `before`, y lo monta. */
function mountTurnstile(key: string, parent: HTMLElement | null, before: Element | null = null) {
  if (!data.turnstileKey || !parent) return;
  let slot = turnstileSlots.get(key);
  if (!slot || !slot.host.isConnected) {
    const host = document.createElement('div');
    host.className = 'ts-box span-2';
    parent.insertBefore(host, before);
    slot = { host, gate: createTokenGate(), id: '', spent: false };
    turnstileSlots.set(key, slot);
  }
  void renderSlot(slot);
}
/** '' sin clave (local: la función no lo exige); null si no hubo token a tiempo (no se envía). */
async function turnstileToken(key: string, btn: HTMLButtonElement | null): Promise<string | null> {
  if (!data.turnstileKey) return '';
  const slot = turnstileSlots.get(key);
  if (!slot) return null;
  if (!slot.gate.ready()) {
    if (btn) btn.textContent = 'Verificando…';
    // Si Turnstile pide interacción, que el reto quede a la vista.
    slot.host.scrollIntoView({ block: 'nearest' });
  }
  void renderSlot(slot);
  const token = await slot.gate.wait(TURNSTILE_WAIT_MS);
  if (token) slot.spent = true;
  return token;
}
/** Tras un envío (éxito o error) el token ya se gastó: widget nuevo. Sin envío no se toca el reto en curso. */
function resetTurnstile(key: string) {
  const slot = turnstileSlots.get(key);
  if (!slot?.spent) return;
  slot.spent = false;
  slot.gate.clear();
  const api = turnstileApi();
  if (!api || !slot.id) return;
  try {
    api.reset(slot.id);
  } catch {
    /* el widget ya no existe: se vuelve a montar al abrir */
  }
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
/** D51: máximo una vez al día por navegador (día de Bogotá); `?intro=` sigue forzando. */
const WELCOME_KEY = `${data.restaurant}:bienvenida`;
function showWelcome() {
  const today = bogotaDay(new Date());
  let lastSeen: string | null = null;
  try {
    lastSeen = localStorage.getItem(WELCOME_KEY);
  } catch {
    /* sin almacenamiento: se muestra */
  }
  const mode = welcomeToShow({
    forced: forcedWelcome(new URLSearchParams(location.search).get('intro')),
    configured: data.introMode,
    hasEvent: Boolean(data.introEvent),
    lastSeen,
    today,
  });
  if (mode === 'ninguna') return;
  const markSeen = () => {
    try {
      localStorage.setItem(WELCOME_KEY, today);
    } catch {
      /* nada */
    }
  };
  if (mode === 'aviso') return showPopup(markSeen);
  const el = qs('#intro');
  if (!el) return;
  loadIntroPhoto(el);
  el.hidden = false;
  lockScroll(true);
  // D50: la entrada de las fotos del inicio espera a que se cierre la bienvenida.
  hero?.classList.add('is-held');
  // D51: "Entrar al sitio" se ve desde el primer instante; la barra (0,8 s) es solo decoración.
  requestAnimationFrame(() => requestAnimationFrame(() => qs('#intro-bar')?.classList.add('is-full')));
  const close = () => {
    el.classList.add('is-out');
    lockScroll(false);
    if (hero?.classList.contains('is-held')) hero.classList.replace('is-held', 'is-replay');
    markSeen();
    setTimeout(() => (el.hidden = true), 900);
  };
  qsa('[data-intro-close]', el).forEach((btn) => btn.addEventListener('click', close));
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.hidden) close();
  });
}
/** D51: la foto de la bienvenida solo se descarga si se va a mostrar, y con prioridad alta. */
function loadIntroPhoto(el: HTMLElement) {
  const img = qs<HTMLImageElement>('.intro-bg', el);
  if (!img?.dataset.src) return;
  img.fetchPriority = 'high';
  qsa<HTMLSourceElement>('source[data-srcset]', el).forEach((source) => {
    source.srcset = source.dataset.srcset ?? '';
  });
  img.src = img.dataset.src;
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
  let popBusy = false;
  qs('#pop-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (popBusy) return;
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
    const btn = qs<HTMLButtonElement>('#pop-form [type="submit"]');
    const label = btn?.textContent ?? '';
    popBusy = true;
    if (btn) btn.disabled = true;
    type Captar = { ok: boolean; coupon?: string; title?: string; error?: string };
    let body: Captar;
    try {
      const turnstile = await turnstileToken('cupon', btn);
      if (turnstile === null) return fail(turnstileFail());
      if (btn) btn.textContent = 'Enviando…';
      body = (
        await callFunction<Captar>('captar', {
          restaurant: data.restaurant,
          event_id: el.dataset.event,
          name,
          phone,
          acepta_datos: true,
          turnstile,
          sitio_web: val('#p-hp'),
        }).catch(() => ({ body: { ok: false, error: 'error' } as Captar }))
      ).body;
    } finally {
      popBusy = false;
      resetTurnstile('cupon');
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
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
      const popForm = qs('#pop-form');
      mountTurnstile('cupon', popForm, qs('[type="submit"]', popForm ?? document));
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
  const quoteForm = qs('#quote-form');
  mountTurnstile('cotizar', quoteForm, qs('[type="submit"]', quoteForm ?? document));
  qs<HTMLSelectElement>('#q-tipo')?.focus();
});
let quoteBusy = false;
qs('#quote-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (quoteBusy) return;
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
  const btn = qs<HTMLButtonElement>('#quote-form [type="submit"]');
  const label = btn?.textContent ?? '';
  quoteBusy = true;
  if (btn) btn.disabled = true;
  type Cotizar = { status: number; body: { ok: boolean; error?: string } };
  let result: Cotizar;
  try {
    const turnstile = await turnstileToken('cotizar', btn);
    if (turnstile === null) return fail(turnstileFail());
    if (btn) btn.textContent = 'Enviando…';
    result = await callFunction<{ ok: boolean; error?: string }>('cotizar', {
      restaurant: data.restaurant,
      kind: val('#q-tipo'),
      name: val('#q-nombre'),
      phone,
      event_date: val('#q-fecha'),
      guests: val('#q-personas'),
      message: val('#q-msg'),
      acepta_datos: true,
      turnstile,
      sitio_web: val('#q-hp'),
    }).catch((): Cotizar => ({ status: 0, body: { ok: false } }));
  } finally {
    quoteBusy = false;
    resetTurnstile('cotizar');
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  const { status, body } = result;
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

updateHero(true);
syncCount();
void refreshAvailability();
void renderTracker();
showWelcome();
