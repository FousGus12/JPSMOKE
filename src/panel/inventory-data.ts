// Datos del inventario (F8b). Solo admin; el stock solo cambia por pedidos y por register_supply (queda el movimiento).
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
}
export interface Recipe {
  product_id: string;
  supply_id: string;
  qty: number;
  combo_only: boolean;
}
export interface SupplyMove {
  id: number;
  kind: 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste';
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
  const [supplies, recipes, products] = await Promise.all([
    supabase
      .from('supplies')
      .select('id, name, unit, purchase_unit, per_purchase, stock, min_stock, active, position')
      .eq('restaurant_id', restaurantId)
      .order('position'),
    supabase
      .from('recipes')
      .select('product_id, supply_id, qty, combo_only')
      .eq('restaurant_id', restaurantId),
    supabase
      .from('products')
      .select('id, name, combo_price')
      .eq('restaurant_id', restaurantId)
      .order('position'),
  ]);
  if (supplies.error || recipes.error || products.error) throw new Error('No pudimos cargar el inventario.');
  return {
    supplies: (supplies.data ?? []).map((row) => ({
      ...row,
      per_purchase: Number(row.per_purchase),
      stock: Number(row.stock),
      min_stock: Number(row.min_stock),
    })) as Supply[],
    recipes: (recipes.data ?? []).map((row) => ({ ...row, qty: Number(row.qty) })) as Recipe[],
    products: (products.data ?? []) as Array<{ id: string; name: string; combo_price: number | null }>,
  };
}

export async function loadMoves(restaurantId: string): Promise<SupplyMove[]> {
  const { data, error } = await getSupabase()
    .from('supply_moves')
    .select('id, kind, qty, note, at, supplies(name, unit), orders(code)')
    .eq('restaurant_id', restaurantId)
    .order('at', { ascending: false })
    .limit(100);
  if (error) throw new Error('No pudimos cargar los movimientos.');
  return (data ?? []).map((row) => ({ ...row, qty: Number(row.qty) })) as unknown as SupplyMove[];
}

export async function saveSupply(
  restaurantId: string,
  supply: Partial<Supply> & { name: string },
): Promise<void> {
  const supabase = getSupabase();
  const { id, stock, ...fields } = supply;
  const { error } = id
    ? await supabase.from('supplies').update(fields).eq('id', id)
    : await supabase.from('supplies').insert({ ...fields, stock: stock ?? 0, restaurant_id: restaurantId });
  fail(error, 'el insumo');
}

/** Compra (en unidades de compra), merma (en unidades de uso) o conteo físico (nuevo stock). */
export async function registerSupply(
  supplyId: string,
  kind: 'compra' | 'merma' | 'ajuste',
  qty: number,
  note: string,
): Promise<number> {
  const { data, error } = await getSupabase().rpc('register_supply', {
    p_supply: supplyId,
    p_kind: kind,
    p_qty: qty,
    p_note: note || null,
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
