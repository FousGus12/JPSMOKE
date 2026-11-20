// Datos del inventario (F8b). Solo admin o Inventario delegado; el stock solo cambia por pedidos y por
// register_supply (queda el movimiento). Costos y margen (D49) nunca salen al sitio.
import type { CostBasis } from '../core/inventory';
import { getSupabase } from '../lib/supabase';

export interface Supply {
  id: string;
  name: string;
  unit: string;
  purchase_unit: string;
  per_purchase: number;
  stock: number;
  min_stock: number;
  active: boolean;
  position: number;
  /** D46: existencia de partida y cuándo se fijó. */
  initial_stock: number | null;
  initial_at: string | null;
  /** D49: COP por unidad de compra ('compra') o de uso ('uso'); fecha del último precio. */
  cost: number | null;
  cost_basis: CostBasis;
  cost_at: string | null;
}
/** Lo que se puede guardar desde el formulario (la base solo deja cambiar estas columnas). */
export type SupplyFields = Pick<
  Supply,
  'name' | 'unit' | 'purchase_unit' | 'per_purchase' | 'min_stock' | 'active'
> & {
  cost: number | null;
  cost_basis: CostBasis;
};
export interface InventoryProduct {
  id: string;
  name: string;
  price: number;
  combo_price: number | null;
}
export type MoveKind = 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste' | 'inicial';
export interface Recipe {
  product_id: string;
  supply_id: string;
  qty: number;
  combo_only: boolean;
}
export interface SupplyMove {
  id: number;
  kind: MoveKind;
  qty: number;
  note: string | null;
  at: string;
  supplies: { name: string; unit: string } | null;
  orders: { code: string } | null;
}

function fail(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return;
  if (error.code === '23505') throw new Error(`Ya existe ${what} con ese nombre.`);
  if (error.code === '42501') throw new Error('No tienes permiso para este cambio.');
  if (error.code === '22023') throw new Error(error.message);
  if (error.code === '23503') throw new Error('Ese insumo está en recetas: quítalo de ellas primero.');
  throw new Error(`No se pudo guardar ${what}.`);
}

export async function loadInventory(restaurantId: string) {
  const supabase = getSupabase();
  const [supplies, recipes, products, settings] = await Promise.all([
    supabase
      .from('supplies')
      .select(
        'id, name, unit, purchase_unit, per_purchase, stock, min_stock, active, position, initial_stock, initial_at, cost, cost_basis, cost_at',
      )
      .eq('restaurant_id', restaurantId)
      .order('position'),
    supabase
      .from('recipes')
      .select('product_id, supply_id, qty, combo_only')
      .eq('restaurant_id', restaurantId),
    supabase
      .from('products')
      .select('id, name, price, combo_price')
      .eq('restaurant_id', restaurantId)
      .order('position'),
    supabase.from('restaurant_settings').select('target_margin').eq('restaurant_id', restaurantId).single(),
  ]);
  if (supplies.error || recipes.error || products.error || settings.error)
    throw new Error('No pudimos cargar el inventario.');
  return {
    supplies: (supplies.data ?? []).map((row) => ({
      ...row,
      per_purchase: Number(row.per_purchase),
      stock: Number(row.stock),
      min_stock: Number(row.min_stock),
      initial_stock: orNull(row.initial_stock),
      cost: orNull(row.cost),
      cost_basis: row.cost_basis === 'uso' ? 'uso' : 'compra',
    })) as Supply[],
    recipes: (recipes.data ?? []).map((row) => ({ ...row, qty: Number(row.qty) })) as Recipe[],
    products: (products.data ?? []).map((row) => ({
      ...row,
      price: Number(row.price),
      combo_price: orNull(row.combo_price),
    })) as InventoryProduct[],
    targetMargin: Number(settings.data.target_margin),
  };
}

/** numeric llega como número o texto; NULL se queda NULL (Number(null) daría 0 y un costo falso). */
function orNull(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/** Últimos 100 movimientos; con `supplyId`, solo los de ese insumo (el historial completo de uno). */
export async function loadMoves(restaurantId: string, supplyId = ''): Promise<SupplyMove[]> {
  let query = getSupabase()
    .from('supply_moves')
    .select('id, kind, qty, note, at, supplies(name, unit), orders(code)')
    .eq('restaurant_id', restaurantId);
  if (supplyId) query = query.eq('supply_id', supplyId);
  const { data, error } = await query.order('at', { ascending: false }).limit(100);
  if (error) throw new Error('No pudimos cargar los movimientos.');
  return (data ?? []).map((row) => ({ ...row, qty: Number(row.qty) })) as unknown as SupplyMove[];
}

/**
 * Crea o edita un insumo. La fecha del precio (cost_at) la pone la base al cambiar el costo; al crear,
 * el costo se guarda en un segundo paso para que quede con fecha.
 */
export async function saveSupply(
  restaurantId: string,
  id: string | null,
  fields: SupplyFields,
  position: number,
): Promise<void> {
  const supabase = getSupabase();
  if (id) {
    const { error } = await supabase.from('supplies').update(fields).eq('id', id);
    return fail(error, 'el insumo');
  }
  const { cost, cost_basis, ...rest } = fields;
  const { data, error } = await supabase
    .from('supplies')
    .insert({ ...rest, cost_basis, position, stock: 0, restaurant_id: restaurantId })
    .select('id')
    .single();
  fail(error, 'el insumo');
  if (cost !== null && data) {
    const second = await supabase.from('supplies').update({ cost }).eq('id', data.id);
    fail(second.error, 'el costo');
  }
}

/**
 * Compra (en unidades de compra), merma (en unidades de uso, resta de lo actual) o inicial (D46: fija la
 * existencia de partida y la actual). `cost` (D49) actualiza el costo del insumo en su base.
 */
export async function registerSupply(
  supplyId: string,
  kind: 'compra' | 'merma' | 'inicial',
  qty: number,
  note: string,
  cost: number | null = null,
): Promise<number> {
  const { data, error } = await getSupabase().rpc('register_supply', {
    p_supply: supplyId,
    p_kind: kind,
    p_qty: qty,
    p_note: note || undefined,
    ...(cost === null ? {} : { p_cost: cost }),
  });
  fail(error, 'el movimiento');
  return Number(data);
}

export async function setRecipeLine(restaurantId: string, line: Recipe): Promise<void> {
  const { error } = await getSupabase()
    .from('recipes')
    .upsert({ ...line, restaurant_id: restaurantId });
  fail(error, 'la receta');
}
export async function removeRecipeLine(line: Recipe): Promise<void> {
  const { error } = await getSupabase()
    .from('recipes')
    .delete()
    .eq('product_id', line.product_id)
    .eq('supply_id', line.supply_id)
    .eq('combo_only', line.combo_only);
  fail(error, 'la receta');
}

/** D49: margen objetivo (1–95 %) para sugerir precios. Se guarda en los ajustes del restaurante. */
export async function saveTargetMargin(restaurantId: string, value: number): Promise<void> {
  const { data, error } = await getSupabase()
    .from('restaurant_settings')
    .update({ target_margin: value })
    .eq('restaurant_id', restaurantId)
    .select('target_margin');
  fail(error, 'el margen');
  // RLS que no deja actualizar no da error: devuelve cero filas.
  if (!data?.length) throw new Error('No tienes permiso para cambiar el margen.');
}
