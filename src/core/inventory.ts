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
