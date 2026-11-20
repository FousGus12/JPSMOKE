// Inventario de insumos (F8b, D30): cálculos de presentación. El descuento real lo hace la base al crear el pedido.

export interface RecipeLine {
  supplyId: string;
  qty: number;
  comboOnly: boolean;
}
export interface SupplyStock {
  id: string;
  stock: number;
  minStock: number;
}

/** Cuántas unidades de un producto alcanzan con el inventario actual (null = sin receta, no se controla). */
export function servingsLeft(recipe: RecipeLine[], supplies: SupplyStock[], combo = false): number | null {
  const lines = recipe.filter((line) => combo || !line.comboOnly);
  if (!lines.length) return null;
  const byId = new Map(supplies.map((supply) => [supply.id, supply.stock]));
  return Math.max(0, Math.min(...lines.map((line) => Math.floor((byId.get(line.supplyId) ?? 0) / line.qty))));
}

/** Estado del insumo para la tabla: agotado, bajo (en el mínimo o menos) u ok. */
export function supplyLevel(supply: SupplyStock): 'agotado' | 'bajo' | 'ok' {
  if (supply.stock <= 0) return 'agotado';
  return supply.stock <= supply.minStock ? 'bajo' : 'ok';
}

/** "48 panes = 4 paquetes" para que el dueño piense en lo que compra. */
export function inPurchaseUnits(stock: number, perPurchase: number): number {
  return Math.floor((stock / perPurchase) * 10) / 10;
}

/** Cantidades sin ceros sobrantes: 2.00 → "2", 1.50 → "1,5". */
export function qtyText(value: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
}

// ---------------------------------------------------------------------------
// D49 · costo de insumos y margen por receta. Solo presentación: el precio al público se cambia en Carta.

export type CostBasis = 'compra' | 'uso';
export interface SupplyCost {
  id: string;
  name: string;
  cost: number | null;
  costBasis: CostBasis;
  perPurchase: number;
}
export interface RecipeCost {
  /** Suma de lo que sí tiene costo (incompleta si `missing` no está vacío). */
  cost: number;
  /** Nombres de los insumos de la receta sin costo (o que ya no existen). */
  missing: string[];
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** Costo en COP de una unidad de uso (un pan, una hoja). null si no hay costo o la equivalencia no sirve. */
export function costPerUse(supply: Pick<SupplyCost, 'cost' | 'costBasis' | 'perPurchase'>): number | null {
  if (supply.cost === null || !Number.isFinite(supply.cost) || supply.cost < 0) return null;
  if (supply.costBasis === 'uso') return supply.cost;
  if (!(supply.perPurchase > 0)) return null;
  return supply.cost / supply.perPurchase;
}

/** Costo a guardar cuando se paga `paidPerPurchase` por unidad de compra, según cómo lleve el costo el insumo. */
export function costFromPurchase(paidPerPurchase: number, basis: CostBasis, perPurchase: number): number {
  if (basis === 'compra') return cents(paidPerPurchase);
  if (!(perPurchase > 0)) throw new Error('Equivalencia inválida');
  return cents(paidPerPurchase / perPurchase);
}

/** Costo de una receta: el plato solo excluye las líneas "solo en combo"; el combo las suma todas. */
export function recipeCost(recipe: RecipeLine[], supplies: SupplyCost[], combo = false): RecipeCost {
  const byId = new Map(supplies.map((supply) => [supply.id, supply]));
  let cost = 0;
  const missing: string[] = [];
  for (const line of recipe) {
    if (!combo && line.comboOnly) continue;
    const supply = byId.get(line.supplyId);
    const unit = supply ? costPerUse(supply) : null;
    if (unit === null) {
      const name = supply?.name ?? 'insumo borrado';
      if (!missing.includes(name)) missing.push(name);
      continue;
    }
    cost += unit * line.qty;
  }
  return { cost: cents(cost), missing };
}

/** Insumos de la receta (plato y combo) a los que les falta el costo, sin repetir. */
export function suppliesWithoutCost(recipe: RecipeLine[], supplies: SupplyCost[]): string[] {
  return recipeCost(recipe, supplies, true).missing;
}

/** Margen sobre el precio de venta: en pesos y en % (null si el precio no sirve). */
export function margin(price: number, cost: number): { amount: number; percent: number | null } {
  const amount = price - cost;
  return { amount, percent: price > 0 ? Math.round((amount / price) * 1000) / 10 : null };
}

/** Sube al siguiente múltiplo de $100 (redondeado a centavos antes, para no saltar por la coma flotante). */
export function roundUpTo100(value: number): number {
  return Math.ceil(cents(value) / 100) * 100;
}

/** Precio sugerido = costo / (1 − margen objetivo), redondeado a $100 hacia arriba. Margen en % (1–95). */
export function suggestedPrice(cost: number, targetMargin: number): number | null {
  if (!(cost > 0) || !(targetMargin >= 1 && targetMargin <= 95)) return null;
  return roundUpTo100((cost * 100) / (100 - targetMargin));
}

/** Número para precargar un campo: sin separador de miles y con coma decimal (1500 → "1500", 1.5 → "1,5"). */
export function inputText(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

/**
 * Lee lo que escribe el dueño: "12.000", "12000", "$ 12.000", "1,5", "1.5" o "3333,33".
 * Con coma, los puntos son miles; sin coma, un punto seguido de grupos de 3 cifras también.
 */
export function parseInput(text: string): number {
  const clean = text.trim().replace(/[$\s]/g, '');
  if (!clean) return Number.NaN;
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) return Number(clean.replace(/\./g, ''));
  return Number(clean);
}

// ---------------------------------------------------------------------------
// D66 · lista de compras desde insumos en o bajo el mínimo, en unidades de compra.

export interface ShoppingSupply extends SupplyCost {
  stock: number;
  minStock: number;
  initialStock: number | null;
  unit: string;
  purchaseUnit: string;
  active: boolean;
}
export interface ShoppingItem {
  id: string;
  name: string;
  /** Unidades de compra a comprar (entero, redondeado hacia arriba). */
  qty: number;
  purchaseUnit: string;
  /** Costo estimado en COP; null si el insumo no tiene costo. */
  cost: number | null;
}
export interface ShoppingList {
  items: ShoppingItem[];
  /** Suma de lo que sí tiene costo. */
  total: number;
  /** Cuántos renglones quedaron sin costo (el total es incompleto). */
  withoutCost: number;
}

/**
 * Insumos activos con existencia ≤ mínimo. Se compra hasta el Inicial (si es mayor a lo que hay) o,
 * si no hay Inicial útil, hasta 2× el mínimo; en unidades de compra, hacia arriba.
 */
export function shoppingList(supplies: ShoppingSupply[]): ShoppingList {
  const items: ShoppingItem[] = [];
  for (const supply of supplies) {
    if (!supply.active || supply.stock > supply.minStock || !(supply.perPurchase > 0)) continue;
    const initial = supply.initialStock;
    const target = initial !== null && initial > supply.stock ? initial : supply.minStock * 2;
    const missingUse = target - supply.stock;
    if (!(missingUse > 0)) continue;
    // El redondeo a 1e-9 evita que 0.1 × 3 de coma flotante suba un paquete de más.
    const qty = Math.ceil(Math.round((missingUse / supply.perPurchase) * 1e9) / 1e9);
    const unit = costPerUse(supply);
    items.push({
      id: supply.id,
      name: supply.name,
      qty,
      purchaseUnit: supply.purchaseUnit,
      cost: unit === null ? null : cents(unit * supply.perPurchase * qty),
    });
  }
  items.sort((left, right) => left.name.localeCompare(right.name, 'es-CO'));
  return {
    items,
    total: cents(items.reduce((sum, item) => sum + (item.cost ?? 0), 0)),
    withoutCost: items.filter((item) => item.cost === null).length,
  };
}

/** Texto para copiar o mandar por WhatsApp. `dateText` ya viene en fecha de Bogotá. */
export function shoppingText(list: ShoppingList, dateText: string, money: (value: number) => string): string {
  const lines = ['JP Smoke · lista de compras', dateText, ''];
  for (const item of list.items) {
    lines.push(
      `• ${item.name}: ${qtyText(item.qty)} ${item.purchaseUnit} (${item.cost === null ? 'sin costo' : money(item.cost)})`,
    );
  }
  lines.push(
    '',
    `Total estimado: ${money(list.total)}${list.withoutCost ? ` (sin contar ${list.withoutCost} sin costo)` : ''}`,
  );
  return lines.join('\n');
}

/** Enlace de WhatsApp sin destinatario: el dueño elige a quién enviarlo. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
