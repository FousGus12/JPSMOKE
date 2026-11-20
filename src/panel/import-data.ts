// Datos de la importación de Rappi y DiDi (D64). La base valida cada fila y decide repetidas y ya registradas;
// aquí solo se lee lo necesario para la vista previa (estimado) y se llaman las RPC.
import { getSupabase } from '../lib/supabase';
import {
  cleanMap,
  dayRange,
  serverErrors,
  type ColumnMap,
  type ImportChannel,
  type ImportRow,
  type ManualOrder,
  type RowError,
} from '../core/csv-import';

const PAGE = 1000; // max_rows de PostgREST
const CHUNK = 100; // ids por consulta: la URL no crece sin límite
const bogotaStart = (day: string) => `${day}T00:00:00-05:00`;
const nextDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const bogotaDay = (iso: string) =>
  new Date(new Date(iso).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

/** Mapeos guardados por canal (`restaurant_settings.import_maps`). */
export async function loadImportMaps(restaurantId: string): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabase()
    .from('restaurant_settings')
    .select('import_maps')
    .eq('restaurant_id', restaurantId)
    .single();
  if (error) throw new Error('No pudimos cargar el mapeo guardado.');
  const maps = (data as { import_maps: unknown }).import_maps;
  return maps && typeof maps === 'object' ? (maps as Record<string, unknown>) : {};
}

/** Guarda el mapeo de un canal sin tocar el del otro (lee y mezcla). */
export async function saveImportMap(
  restaurantId: string,
  channel: ImportChannel,
  map: ColumnMap,
): Promise<void> {
  const current = await loadImportMaps(restaurantId);
  const { error } = await getSupabase()
    .from('restaurant_settings')
    .update({ import_maps: { ...current, [channel]: cleanMap(map) } })
    .eq('restaurant_id', restaurantId);
  if (error) throw new Error('No se pudo guardar el mapeo.');
}

async function paged<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error('No pudimos preparar la vista previa.');
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export interface PreviewContext {
  existingIds: Set<string>;
  orders: ManualOrder[];
  alreadyMatched: Set<string>;
}

/** Lo ya importado del canal (ids) y los pedidos manuales del canal en el rango de días del archivo. */
export async function loadPreviewContext(
  restaurantId: string,
  channel: ImportChannel,
  rows: ImportRow[],
): Promise<PreviewContext> {
  const supabase = getSupabase();
  const range = dayRange(rows);
  const context: PreviewContext = { existingIds: new Set(), orders: [], alreadyMatched: new Set() };
  if (!range) return context;
  const ids = rows.map((row) => row.external_id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const [existing, orders, matched] = await Promise.all([
    Promise.all(
      chunks.map(async (chunk) => {
        const { data, error } = await supabase
          .from('external_sales')
          .select('external_id')
          .eq('restaurant_id', restaurantId)
          .eq('channel', channel)
          .in('external_id', chunk);
        if (error) throw new Error('No pudimos preparar la vista previa.');
        return (data ?? []) as Array<{ external_id: string }>;
      }),
    ),
    paged<{ id: string; total: number; created_at: string }>((from, to) =>
      supabase
        .from('orders')
        .select('id, total, created_at')
        .eq('restaurant_id', restaurantId)
        .eq('channel', channel)
        .neq('status', 'cancelado')
        .gte('created_at', bogotaStart(range.from))
        .lt('created_at', bogotaStart(nextDay(range.to)))
        .order('created_at')
        .range(from, to),
    ),
    paged<{ matched_order_id: string }>((from, to) =>
      supabase
        .from('external_sales')
        .select('matched_order_id')
        .eq('restaurant_id', restaurantId)
        .eq('channel', channel)
        .not('matched_order_id', 'is', null)
        .gte('sold_on', range.from)
        .lte('sold_on', range.to)
        .order('id')
        .range(from, to),
    ),
  ]);
  for (const row of existing.flat()) context.existingIds.add(row.external_id);
  context.orders = orders.map((order) => ({ ...order, day: bogotaDay(order.created_at) }));
  for (const row of matched) context.alreadyMatched.add(row.matched_order_id);
  return context;
}

export interface ImportResult {
  batch: string | null;
  inserted: number;
  repeated: number;
  matched: number;
  errors: number;
  errorRows: RowError[];
}

export async function importSales(
  channel: ImportChannel,
  fileName: string,
  rows: ImportRow[],
  lines: number[],
): Promise<ImportResult> {
  const { data, error } = await getSupabase().rpc('import_external_sales', {
    p_channel: channel,
    p_file: fileName.slice(0, 120),
    p_rows: rows,
  });
  if (error || !data) {
    if (error?.code === '42501') throw new Error('Tu cuenta no tiene permiso de Ventas.');
    if (error?.code === '22023') throw new Error(error.message);
    throw new Error('No se pudo importar. Intenta de nuevo.');
  }
  const result = data as {
    batch: string | null;
    insertadas: number;
    repetidas: number;
    ya_registradas: number;
    errores: number;
    error_rows: unknown;
  };
  return {
    batch: result.batch,
    inserted: result.insertadas,
    repeated: result.repetidas,
    matched: result.ya_registradas,
    errors: result.errores,
    errorRows: serverErrors(result.error_rows, lines),
  };
}

/** Deshace un lote completo. Devuelve cuántas ventas borró. */
export async function revertImport(batch: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('revert_import', { p_batch: batch });
  if (error) throw new Error('No se pudo revertir el lote.');
  return Number(data ?? 0);
}

export interface ImportBatch {
  id: string;
  channel: ImportChannel;
  file: string;
  at: string;
  inserted: number;
  repeated: number;
  matched: number;
  errors: number;
  by: string;
}
export interface ExternalSummary {
  days: number;
  /** Sin las ya registradas a mano (esas ya cuentan como pedido). */
  total: number;
  orders: number;
  matched: number;
  matched_total: number;
  commission: number;
  by_channel: Array<{ key: ImportChannel; total: number; orders: number }>;
  by_day: Array<{ day: string; total: number; orders: number }>;
  batches: ImportBatch[];
}

export async function loadExternalSummary(days: number): Promise<ExternalSummary> {
  const { data, error } = await getSupabase().rpc('external_sales_summary', { p_days: days });
  if (error || !data) throw new Error('No pudimos cargar las ventas de Rappi y DiDi.');
  return data as ExternalSummary;
}
