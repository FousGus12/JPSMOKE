// Importar ventas de Rappi y DiDi desde CSV (D64). Lector propio, montos, fechas en Bogotá, mapeo de columnas
// y vista previa. Todo puro: la base vuelve a validar cada fila en `import_external_sales`.

export type ImportChannel = 'rappi' | 'didi';
export type ImportField = 'external_id' | 'date' | 'total' | 'commission' | 'status' | 'items';
/** Mapeo campo → nombre de encabezado (no índice: sobrevive a columnas reordenadas). */
export type ColumnMap = Partial<Record<ImportField, string>>;

export const FIELDS: Array<{ key: ImportField; label: string; required: boolean }> = [
  { key: 'external_id', label: 'Id del pedido', required: true },
  { key: 'date', label: 'Fecha', required: true },
  { key: 'total', label: 'Total', required: true },
  { key: 'commission', label: 'Comisión', required: false },
  { key: 'status', label: 'Estado', required: false },
  { key: 'items', label: 'Productos', required: false },
];

/** Límites del servidor (import_external_sales). */
export const MAX_ROWS = 2000;
export const MAX_TOTAL = 100_000_000;
const MAX_ID = 80;
const MAX_ITEMS = 300;
const MAX_HEADER = 80;
const MIN_DAY = '2020-01-01';

// ---------------------------------------------------------------- lectura

/** UTF-8 si es válido; si no, Windows-1252 (lo que suelen exportar Excel y los portales en español). */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Separador del encabezado contando fuera de comillas: `;` si gana a `,` (Excel en español), tabulador si no hay otro. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) counts[char] += 1;
  }
  if (counts[';'] > counts[',']) return ';';
  if (counts[','] === 0 && counts['\t'] > 0) return '\t';
  return ',';
}

export interface CsvTable {
  headers: string[];
  /** Filas de datos (mismo largo que headers) con su número de fila en el archivo (encabezado = 1). */
  rows: Array<{ line: number; cells: string[] }>;
  delimiter: string;
}

/** Lee CSV: BOM, `sep=;` de Excel, comillas con `""`, saltos dentro de comillas, CRLF/LF/CR, filas vacías. */
export function parseCsv(input: string): CsvTable {
  let text = input.replace(/^\uFEFF/, '');
  let delimiter: string | null = null;
  const sep = /^sep=(.)\r?\n?/i.exec(text);
  if (sep?.[1]) {
    delimiter = sep[1];
    text = text.slice(sep[0].length);
  }
  delimiter ??= detectDelimiter(text);

  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const push = () => {
    cells.push(cell);
    cell = '';
  };
  const end = () => {
    push();
    if (cells.some((value) => value.trim() !== '')) records.push({ line: startLine, cells });
    cells = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) line += 1;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === '') {
      cell = '';
      quoted = true;
    } else if (char === delimiter) push();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      end();
      line += 1;
      startLine = line;
    } else cell += char;
  }
  if (cell !== '' || cells.length) end();

  const [head, ...data] = records;
  if (!head) return { headers: [], rows: [], delimiter };
  const seen = new Map<string, number>();
  const headers = head.cells.map((raw, index) => {
    let name = raw.trim().slice(0, MAX_HEADER) || `Columna ${index + 1}`;
    const times = (seen.get(name) ?? 0) + 1;
    seen.set(name, times);
    if (times > 1) name = `${name} (${times})`;
    return name;
  });
  const width = headers.length;
  return {
    headers,
    rows: data.map(({ line: at, cells: values }) => ({
      line: at,
      cells: Array.from({ length: width }, (_, index) => (values[index] ?? '').trim()),
    })),
    delimiter,
  };
}

// ---------------------------------------------------------------- valores

/**
 * Dinero a pesos enteros: `1.234,50` → 1235, `$ 12.000` → 12000, `12,000` → 12000, `1,234.50` → 1235, `12000` → 12000.
 * Un separador único seguido de exactamente 3 dígitos es de miles. null si no es un monto válido o es negativo.
 */
export function parseMoney(raw: string): number | null {
  let text = raw.replace(/cop|\$|\s|\u00a0/gi, '');
  if (!text) return null;
  if (/^\(.*\)$/.test(text) || text.startsWith('-') || text.startsWith('−')) return null;
  text = text.replace(/^\+/, '');
  if (!/^[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) return null;
  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;
  let normalized: string;
  if (dots && commas) {
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    if ((decimal === '.' ? dots : commas) > 1) return null;
    normalized = text.split(thousands).join('').replace(decimal, '.');
  } else if (dots || commas) {
    const mark = dots ? '.' : ',';
    const parts = text.split(mark);
    const groups = parts.slice(1);
    if (parts.length > 2 || groups[0]?.length === 3) {
      // Miles: todos los grupos de 3 dígitos y el primero de 1 a 3.
      if (!groups.every((group) => group.length === 3) || !/^[0-9]{1,3}$/.test(parts[0] ?? '')) return null;
      normalized = parts.join('');
    } else normalized = `${parts[0] || '0'}.${groups[0] ?? ''}`;
  } else normalized = text;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > MAX_TOTAL ? null : rounded;
}

const pad = (value: number) => String(value).padStart(2, '0');
const validDay = (year: number, month: number, dayOfMonth: number) => {
  if (month < 1 || month > 12 || dayOfMonth < 1) return false;
  return dayOfMonth <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const BOGOTA_OFFSET_MS = 5 * 3_600_000; // UTC−5 fijo, sin horario de verano.

/** Día de hoy en Bogotá (AAAA-MM-DD). */
export function bogotaToday(now = new Date()): string {
  return new Date(now.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** AAAA-MM-DD[ HH:MM[:SS]] o null si la hora no existe. */
function stamp(
  year: number,
  month: number,
  dayOfMonth: number,
  hour?: number,
  minute?: number,
  second?: number,
) {
  const day = `${year}-${pad(month)}-${pad(dayOfMonth)}`;
  if (hour === undefined || minute === undefined) return day;
  if (hour > 23 || minute > 59 || (second !== undefined && second > 59)) return null;
  return `${day} ${pad(hour)}:${pad(minute)}${second === undefined ? '' : `:${pad(second)}`}`;
}
const num = (text: string | undefined) => (text === undefined ? undefined : Number(text));

/**
 * Fecha del archivo al formato de la RPC (`AAAA-MM-DD[ HH:MM[:SS]]`, hora de Bogotá).
 * Acepta dd/mm/aaaa, dd-mm-aaaa, dd/mm/aa, con hora hh:mm[:ss] y a. m./p. m.; ISO con o sin hora;
 * ISO con `Z` o desfase se pasa a Bogotá. null si no es una fecha real.
 */
export function parseDate(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const iso =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      text,
    );
  if (iso) {
    const [, ys, ms, ds, hs, mins, secs, zone] = iso;
    const [year, month, dayOfMonth] = [Number(ys), Number(ms), Number(ds)];
    if (!validDay(year, month, dayOfMonth)) return null;
    const plain = stamp(year, month, dayOfMonth, num(hs), num(mins), num(secs));
    if (!plain || !zone || hs === undefined) return plain;
    const offset =
      zone.toUpperCase() === 'Z'
        ? 0
        : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2))) * 60_000;
    const utc = Date.UTC(year, month - 1, dayOfMonth, Number(hs), Number(mins), Number(secs ?? 0)) - offset;
    const local = new Date(utc - BOGOTA_OFFSET_MS).toISOString();
    return `${local.slice(0, 10)} ${local.slice(11, secs === undefined ? 16 : 19)}`;
  }
  const latin =
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:,? (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([ap])\.? ?m\.?)?)?$/i.exec(
      text,
    );
  if (!latin) return null;
  const [, ds, ms, ys, hs, mins, secs, meridiem] = latin;
  const [dayOfMonth, month] = [Number(ds), Number(ms)];
  const year = (ys ?? '').length === 2 ? 2000 + Number(ys) : Number(ys);
  if (!validDay(year, month, dayOfMonth)) return null;
  let hour = num(hs);
  if (hour !== undefined && meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0);
  }
  return stamp(year, month, dayOfMonth, hour, num(mins), num(secs));
}

/** Día siguiente (AAAA-MM-DD). */
function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Estados que la plataforma reporta como no cobrados: no se importan. */
const VOID_STATUS = /cancel|anulad|rechaz|reembols|refund|devuel|fallid|fail|declin|no entregad/i;
export const isVoidStatus = (status: string) => VOID_STATUS.test(status);

// ---------------------------------------------------------------- mapeo

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Nombres comunes por campo, del más específico al más general (ya normalizados). */
const ALIASES: Record<ImportField, string[]> = {
  external_id: [
    'order id',
    'id pedido',
    'id del pedido',
    'id de pedido',
    'id orden',
    'id de la orden',
    'order number',
    'numero de pedido',
    'numero pedido',
    'numero de orden',
    'no pedido',
    'pedido id',
    'orden id',
    'order',
    'pedido',
    'orden',
    'id',
  ],
  date: [
    'fecha del pedido',
    'fecha pedido',
    'fecha de creacion',
    'fecha y hora',
    'fecha hora',
    'order date',
    'created at',
    'fecha',
    'date',
    'created',
    'dia',
  ],
  total: [
    'total del pedido',
    'total pedido',
    'valor total',
    'monto total',
    'total venta',
    'order total',
    'total amount',
    'gross sales',
    'ventas brutas',
    'total',
    'valor',
    'monto',
    'amount',
  ],
  commission: [
    'comision',
    'comision plataforma',
    'commission',
    'fee',
    'tarifa de servicio',
    'cargo plataforma',
  ],
  status: ['estado del pedido', 'estado pedido', 'order status', 'estado', 'status'],
  items: ['productos', 'detalle', 'items', 'articulos', 'products', 'descripcion'],
};

/** Propone el mapeo por nombres comunes ("Order ID", "ID pedido", "Fecha", "Total", "Comisión"…). */
export function suggestMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  const normalized = headers.map((header) => [header, normalize(header)] as const);
  for (const field of FIELDS.map((item) => item.key)) {
    const aliases = ALIASES[field];
    // 1) igual al alias, 2) empieza por el alias (p. ej. "Total (COP)").
    const pick =
      aliases
        .map((alias) => normalized.find(([header, norm]) => !used.has(header) && norm === alias))
        .find(Boolean) ??
      aliases
        .filter((alias) => alias.length > 3)
        .map((alias) =>
          normalized.find(([header, norm]) => !used.has(header) && norm.startsWith(`${alias} `)),
        )
        .find(Boolean);
    if (pick) {
      map[field] = pick[0];
      used.add(pick[0]);
    }
  }
  return map;
}

/** Mapeo guardado si sus columnas están en el archivo; lo que falte se completa con la propuesta. */
export function resolveMap(headers: string[], saved: unknown): ColumnMap {
  const suggestion = suggestMap(headers);
  const map: ColumnMap = {};
  const stored = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const taken = new Set<string>();
  for (const { key } of FIELDS) {
    const value = stored[key];
    // Tolera cambios de mayúsculas, tildes o espacios entre descargas del mismo portal.
    const match =
      typeof value === 'string'
        ? headers.find((header) => normalize(header) === normalize(value))
        : undefined;
    if (match && !taken.has(match)) {
      map[key] = match;
      taken.add(match);
    }
  }
  for (const { key } of FIELDS) {
    const proposed = suggestion[key];
    if (!map[key] && proposed && !taken.has(proposed)) {
      map[key] = proposed;
      taken.add(proposed);
    }
  }
  return map;
}

/** Mapeo listo para guardar en `import_maps` (solo campos conocidos con nombre corto). */
export function cleanMap(map: ColumnMap): ColumnMap {
  const out: ColumnMap = {};
  for (const { key } of FIELDS) {
    const value = map[key];
    if (value) out[key] = value.slice(0, MAX_HEADER);
  }
  return out;
}

export const missingFields = (map: ColumnMap) =>
  FIELDS.filter((field) => field.required && !map[field.key]).map((field) => field.label);

// ---------------------------------------------------------------- filas

/** Fila tal como la recibe la RPC. */
export interface ImportRow {
  external_id: string;
  date: string;
  total: number;
  commission?: number;
  items?: string;
}
export interface RowError {
  line: number;
  reason: string;
}
export interface BuiltRows {
  rows: ImportRow[];
  /** Fila del archivo de cada elemento de `rows` (para traducir los errores del servidor). */
  lines: number[];
  errors: RowError[];
  /** Ids repetidos dentro del mismo archivo (se envía solo el primero). */
  repeatedInFile: number;
  /** Anuladas o rechazadas según la columna Estado: no se importan. */
  voided: number;
  /** Suma de la columna Comisión de las filas válidas (informativa: la tabla no la guarda). */
  commission: number | null;
}

export const REASON: Record<string, string> = {
  fila: 'fila sin datos',
  id_externo: 'id vacío o de más de 80 caracteres',
  total: 'total no válido',
  fecha: 'fecha no válida o fuera de rango',
};

/** Convierte la tabla con el mapeo a filas para la RPC, con las mismas reglas del servidor. */
export function buildRows(table: CsvTable, map: ColumnMap, now = new Date()): BuiltRows {
  const col = (field: ImportField) => (map[field] ? table.headers.indexOf(map[field]) : -1);
  const [idCol, dateCol, totalCol, commissionCol, statusCol, itemsCol] = (
    ['external_id', 'date', 'total', 'commission', 'status', 'items'] as const
  ).map(col);
  const maxDay = nextDay(bogotaToday(now));
  const out: BuiltRows = { rows: [], lines: [], errors: [], repeatedInFile: 0, voided: 0, commission: null };
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const at = (index: number | undefined) => (index !== undefined && index >= 0 ? (cells[index] ?? '') : '');
    if (statusCol !== undefined && statusCol >= 0 && isVoidStatus(at(statusCol))) {
      out.voided += 1;
      continue;
    }
    const id = at(idCol).trim();
    if (!id || id.length > MAX_ID) {
      out.errors.push({ line, reason: REASON.id_externo as string });
      continue;
    }
    const rawDate = at(dateCol);
    const date = parseDate(rawDate);
    const day = date?.slice(0, 10);
    if (!date || !day || day < MIN_DAY || day > maxDay) {
      out.errors.push({
        line,
        reason: `${REASON.fecha as string}${rawDate ? ` («${rawDate.slice(0, 30)}»)` : ''}`,
      });
      continue;
    }
    const rawTotal = at(totalCol);
    const total = parseMoney(rawTotal);
    if (total === null) {
      out.errors.push({
        line,
        reason: `${REASON.total as string}${rawTotal ? ` («${rawTotal.slice(0, 20)}»)` : ''}`,
      });
      continue;
    }
    if (seen.has(id)) {
      out.repeatedInFile += 1;
      continue;
    }
    seen.add(id);
    const row: ImportRow = { external_id: id, date, total };
    if (commissionCol !== undefined && commissionCol >= 0) {
      const rowFee = parseMoney(at(commissionCol));
      if (rowFee !== null) row.commission = rowFee;
    }
    const items = at(itemsCol).replace(/\s+/g, ' ').trim().slice(0, MAX_ITEMS);
    if (items) row.items = items;
    out.rows.push(row);
    out.lines.push(line);
    if (commissionCol !== undefined && commissionCol >= 0) {
      const fee = parseMoney(at(commissionCol));
      if (fee !== null) out.commission = (out.commission ?? 0) + fee;
    }
  }
  return out;
}

/** Rango de días (Bogotá) de las filas, para consultar lo ya importado y los pedidos manuales. */
export function dayRange(rows: ImportRow[]): { from: string; to: string } | null {
  if (!rows.length) return null;
  let from = rows[0]?.date.slice(0, 10) as string;
  let to = from;
  for (const row of rows) {
    const day = row.date.slice(0, 10);
    if (day < from) from = day;
    if (day > to) to = day;
  }
  return { from, to };
}

export interface ManualOrder {
  id: string;
  total: number;
  /** Día de Bogotá (AAAA-MM-DD). */
  day: string;
  created_at: string;
}
export interface PreviewCounts {
  fresh: number;
  repeated: number;
  matched: number;
}

/**
 * Estimado de lo que hará el servidor: ya importadas (id existente) = repetidas; de las nuevas, las que casan con un
 * pedido manual del mismo canal, día y total (el más antiguo libre, una sola vez) = ya registradas a mano.
 */
export function previewCounts(
  rows: ImportRow[],
  existingIds: Set<string>,
  orders: ManualOrder[],
  alreadyMatched: Set<string>,
): PreviewCounts {
  const free = [...orders]
    .filter((order) => !alreadyMatched.has(order.id))
    .sort((first, second) => first.created_at.localeCompare(second.created_at));
  const used = new Set<string>();
  const counts: PreviewCounts = { fresh: 0, repeated: 0, matched: 0 };
  for (const row of rows) {
    if (existingIds.has(row.external_id)) {
      counts.repeated += 1;
      continue;
    }
    const day = row.date.slice(0, 10);
    const hit = free.find((order) => !used.has(order.id) && order.day === day && order.total === row.total);
    if (hit) {
      used.add(hit.id);
      counts.matched += 1;
    } else counts.fresh += 1;
  }
  return counts;
}

/** Errores del servidor (`error_rows`, índice 1 de las filas enviadas) a filas del archivo. */
export function serverErrors(errorRows: unknown, lines: number[]): RowError[] {
  if (!Array.isArray(errorRows)) return [];
  return errorRows.flatMap((entry) => {
    const { row, reason } = (entry ?? {}) as { row?: unknown; reason?: unknown };
    if (typeof row !== 'number') return [];
    return [{ line: lines[row - 1] ?? row, reason: REASON[String(reason)] ?? String(reason) }];
  });
}
