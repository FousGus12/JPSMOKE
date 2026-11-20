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
