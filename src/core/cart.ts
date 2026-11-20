// Vista previa del total en el carrito. El total que vale lo calcula la base (place_order);
// esta copia solo muestra al cliente lo que va a pagar y debe coincidir con la regla del servidor.

export interface CartProduct {
  id: string;
  price: number;
  comboPrice: number | null;
  available: boolean;
}
export interface CartLine {
  productId: string;
  qty: number;
  combo: boolean;
  /** Identificador de la línea (D40). Las líneas guardadas antes no lo traen: normalizeCart lo pone. */
  key?: string;
  /** Línea del plato al que va esta adición (D40); sin padre = plato o adición aparte. */
  parent?: string;
}
export type CouponKind = 'porcentaje' | 'valor' | 'envio' | 'regalo';
export interface CartCoupon {
  code: string;
  kind: CouponKind;
  value: number;
  minTotal: number;
  title: string;
}
export interface CartTotals {
  subtotal: number;
  discount: number;
  fee: number;
  total: number;
  gift: string | null;
  couponApplies: boolean;
  missingForMin: number;
}

export function unitPrice(product: CartProduct, combo: boolean): number {
  return combo && product.comboPrice !== null ? product.comboPrice : product.price;
}

export function cartTotals(
  lines: CartLine[],
  products: CartProduct[],
  options: { coupon?: CartCoupon | null; zoneFee?: number | null; deliveryMin?: number } = {},
): CartTotals {
  const byId = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product || !product.available || line.qty < 1) continue;
    subtotal += unitPrice(product, line.combo) * line.qty;
  }
  let fee = options.zoneFee ?? 0;
  let discount = 0;
  let gift: string | null = null;
  const coupon = options.coupon ?? null;
  const couponApplies = coupon !== null && subtotal >= coupon.minTotal;
  if (coupon && couponApplies) {
    if (coupon.kind === 'porcentaje') discount = Math.round((subtotal * coupon.value) / 100);
    else if (coupon.kind === 'valor') discount = Math.min(coupon.value, subtotal);
    else if (coupon.kind === 'envio') fee = 0;
    else gift = coupon.title;
  }
  const missingForMin = Math.max(0, (options.deliveryMin ?? 0) - subtotal);
  return { subtotal, discount, fee, total: subtotal - discount + fee, gift, couponApplies, missingForMin };
}

/** Upsell (P8): primera línea que se puede pasar a combo y cuánto cuesta la diferencia. */
export function comboUpsell(
  lines: CartLine[],
  products: CartProduct[],
): { productId: string; extra: number } | null {
  for (const line of lines) {
    const product = products.find((item) => item.id === line.productId);
    if (product && !line.combo && product.comboPrice !== null) {
      return { productId: product.id, extra: product.comboPrice - product.price };
    }
  }
  return null;
}

/* ---------- Adiciones ligadas a un plato (D40) ---------- */

/** Pone llave a las líneas guardadas antes de D40 y descarta adiciones cuyo plato ya no está. */
export function normalizeCart(lines: CartLine[], newKey: () => string): CartLine[] {
  const withKeys = lines.map((line) => ({ ...line, key: line.key ?? newKey() }));
  const keys = new Set(withKeys.map((line) => line.key));
  return withKeys.filter((line) => !line.parent || keys.has(line.parent));
}

export const childrenOf = (lines: CartLine[], key: string | undefined) =>
  key ? lines.filter((line) => line.parent === key) : [];

/** Agrega un plato (o adición aparte): se suma a una línea igual que no tenga adiciones. */
export function addLine(
  lines: CartLine[],
  productId: string,
  combo: boolean,
  newKey: () => string,
): CartLine[] {
  const twin = lines.find(
    (line) =>
      line.productId === productId &&
      line.combo === combo &&
      !line.parent &&
      childrenOf(lines, line.key).length === 0,
  );
  if (twin) return lines.map((line) => (line === twin ? { ...line, qty: line.qty + 1 } : line));
  return [...lines, { key: newKey(), productId, qty: 1, combo }];
}

/**
 * Liga una adición a un plato. Si el plato tiene varias unidades se separa una (para saber a cuál de
 * las 3 hamburguesas va el huevo). parentKey null = adición aparte.
 */
export function attachAddon(
  lines: CartLine[],
  addonId: string,
  parentKey: string | null,
  newKey: () => string,
): CartLine[] {
  if (!parentKey) return addLine(lines, addonId, false, newKey);
  const parent = lines.find((line) => line.key === parentKey && !line.parent);
  if (!parent) return lines;
  const next = [...lines];
  let target: CartLine & { key: string } = { ...parent, key: parentKey };
  if (parent.qty > 1) {
    target = { key: newKey(), productId: parent.productId, qty: 1, combo: parent.combo };
    const at = next.indexOf(parent);
    next[at] = { ...parent, qty: parent.qty - 1 };
    next.splice(at + 1, 0, target);
  }
  const existing = next.find((line) => line.parent === target.key && line.productId === addonId);
  if (existing) return next.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line));
  const lastChild = [...next].reverse().find((line) => line.parent === target.key);
  const anchor = lastChild ? next.indexOf(lastChild) : next.findIndex((line) => line.key === target.key);
  const at = anchor + 1;
  next.splice(at, 0, { key: newKey(), productId: addonId, qty: 1, combo: false, parent: target.key });
  return next;
}

/** Cambia la cantidad de una línea; en 0 se quita con sus adiciones. Un plato con adiciones queda en 1:
 * otra unidad se agrega como línea aparte (sin adiciones). */
export function changeQty(lines: CartLine[], key: string, delta: number, newKey: () => string): CartLine[] {
  const line = lines.find((item) => item.key === key);
  if (!line) return lines;
  const qty = line.qty + delta;
  if (qty <= 0) return lines.filter((item) => item.key !== key && item.parent !== key);
  if (delta > 0 && !line.parent && childrenOf(lines, key).length > 0) {
    const twin = lines.find(
      (item) =>
        item.productId === line.productId &&
        item.combo === line.combo &&
        !item.parent &&
        item.key !== key &&
        childrenOf(lines, item.key).length === 0,
    );
    if (twin) return lines.map((item) => (item === twin ? { ...item, qty: item.qty + delta } : item));
    const at = lines.indexOf(line) + 1 + childrenOf(lines, key).length;
    const next = [...lines];
    next.splice(at, 0, { key: newKey(), productId: line.productId, qty: delta, combo: line.combo });
    return next;
  }
  return lines.map((item) => (item.key === key ? { ...item, qty } : item));
}

/** Ítems para el pedido: llave y padre solo cuando hay adiciones ligadas. */
export function orderItems(lines: CartLine[]) {
  const parents = new Set(lines.filter((line) => line.parent).map((line) => line.parent));
  return lines.map((line) => ({
    product_id: line.productId,
    qty: line.qty,
    combo: line.combo,
    ...(line.key && (parents.has(line.key) || line.parent) ? { key: line.key } : {}),
    ...(line.parent ? { parent: line.parent } : {}),
  }));
}

/* ---------- Adiciones solo con plato (D47) ---------- */

/** Hay al menos un plato (línea sin padre que no es adición). `isAddon` dice si un producto es de la categoría de adiciones. */
export function hasDish(lines: CartLine[], isAddon: (productId: string) => boolean): boolean {
  return lines.some((line) => !line.parent && line.qty > 0 && !isAddon(line.productId));
}

/** Sin ningún plato no quedan adiciones (ni ligadas ni aparte): el servidor rechaza el pedido (`sin_plato`). */
export function dropAddonsWithoutDish(
  lines: CartLine[],
  isAddon: (productId: string) => boolean,
): { lines: CartLine[]; removed: number } {
  if (hasDish(lines, isAddon)) return { lines, removed: 0 };
  const kept = lines.filter((line) => !line.parent && !isAddon(line.productId));
  const removed = lines.filter((line) => !kept.includes(line)).reduce((sum, line) => sum + line.qty, 0);
  return { lines: kept, removed };
}

/* ---------- Repetir el último pedido (D63) ---------- */

/** Lo que guarda el navegador del último pedido confirmado: solo líneas (sin precios ni datos). */
export interface LastOrder {
  at: number;
  lines: CartLine[];
}

/** Copia del pedido recién confirmado. */
export function snapshotOrder(lines: CartLine[], at: number): LastOrder {
  return {
    at,
    lines: lines.map(({ productId, qty, combo, key, parent }) => ({
      productId,
      qty,
      combo,
      ...(key ? { key } : {}),
      ...(parent ? { parent } : {}),
    })),
  };
}

const KEY = /^[A-Za-z0-9-]{1,40}$/;

/** Lee lo guardado; null si no hay nada usable (formato viejo o dañado). */
export function readLastOrder(raw: unknown): LastOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const { at, lines } = raw as Record<string, unknown>;
  if (typeof at !== 'number' || !Array.isArray(lines)) return null;
  const clean: CartLine[] = [];
  for (const item of lines.slice(0, 30) as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const line = item as Record<string, unknown>;
    if (typeof line.productId !== 'string' || !line.productId) continue;
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 30) continue;
    clean.push({
      productId: line.productId,
      qty,
      combo: line.combo === true,
      ...(typeof line.key === 'string' && KEY.test(line.key) ? { key: line.key } : {}),
      ...(typeof line.parent === 'string' && KEY.test(line.parent) ? { parent: line.parent } : {}),
    });
  }
  return clean.length ? { at, lines: clean } : null;
}

export interface RepeatResult {
  lines: CartLine[];
  /** Productos que ya no se pueden pedir (agotados, ocultos o adiciones que se quedaron sin plato). */
  missing: string[];
  /** Productos que vuelven sin combo (el combo se agotó o ya no existe). */
  noCombo: string[];
}

/**
 * Arma el carrito del último pedido con la carta en vivo: descarta agotados y ocultos (no están en
 * `products`), quita el combo si ya no se puede y da llaves nuevas (las adiciones siguen a su plato;
 * si el plato no está, la adición queda aparte y, sin ningún plato, se descarta).
 */
export function repeatOrder(
  saved: LastOrder,
  options: {
    products: CartProduct[];
    comboOut?: ReadonlySet<string>;
    isAddon: (productId: string) => boolean;
    newKey: () => string;
  },
): RepeatResult {
  const byId = new Map(options.products.map((product) => [product.id, product]));
  const missing: string[] = [];
  const noCombo: string[] = [];
  const keys = new Map<string, string>();
  const kept: CartLine[] = [];
  for (const line of saved.lines) {
    const product = byId.get(line.productId);
    if (!product?.available) {
      missing.push(line.productId);
      continue;
    }
    const key = options.newKey();
    if (line.key) keys.set(line.key, key);
    const comboOk = product.comboPrice !== null && !options.comboOut?.has(line.productId);
    if (line.combo && !comboOk) noCombo.push(line.productId);
    kept.push({
      productId: line.productId,
      qty: line.qty,
      combo: line.combo && comboOk,
      key,
      ...(line.parent ? { parent: line.parent } : {}),
    });
  }
  // Padres con llave nueva; si el plato no volvió, la adición queda aparte.
  const relinked = kept.map(({ parent, ...line }) => {
    const to = parent ? keys.get(parent) : undefined;
    return to && kept.some((other) => other.key === to && !other.parent) ? { ...line, parent: to } : line;
  });
  const result = dropAddonsWithoutDish(relinked, options.isAddon);
  if (result.removed) {
    for (const line of relinked) if (!result.lines.includes(line)) missing.push(line.productId);
  }
  return { lines: result.lines, missing: [...new Set(missing)], noCombo: [...new Set(noCombo)] };
}
