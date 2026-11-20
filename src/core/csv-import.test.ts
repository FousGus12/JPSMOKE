import { describe, expect, it } from 'vitest';
import {
  bogotaToday,
  buildRows,
  cleanMap,
  dayRange,
  decodeCsv,
  detectDelimiter,
  missingFields,
  parseCsv,
  parseDate,
  parseMoney,
  previewCounts,
  resolveMap,
  serverErrors,
  suggestMap,
} from './csv-import';

const NOW = new Date('2026-11-19T17:00:00Z'); // 12:00 m. en Bogotá

describe('parseCsv', () => {
  it('autodetecta coma y punto y coma', () => {
    expect(detectDelimiter('a,b,c\n1;2')).toBe(',');
    expect(detectDelimiter('a;b;"c,d"\n1,2,3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(parseCsv('Id;Total\n1;12.000').rows[0]?.cells).toEqual(['1', '12.000']);
    expect(parseCsv('Id,Total\n1,"12,000"').rows[0]?.cells).toEqual(['1', '12,000']);
  });

  it('quita el BOM, acepta CRLF, CR y línea final vacía', () => {
    const table = parseCsv('\uFEFFOrder ID,Total\r\nA1,100\r\nA2,200\r\n\r\n');
    expect(table.headers).toEqual(['Order ID', 'Total']);
    expect(table.rows.map((row) => row.cells[0])).toEqual(['A1', 'A2']);
    expect(parseCsv('a,b\r1,2\r3,4').rows).toHaveLength(2);
  });

  it('respeta comillas, comillas dobles escapadas y saltos dentro de comillas', () => {
    const table = parseCsv('id,items,total\n1,"Doble, ""queso""\nsin cebolla",30000\n2,Papas,9000');
    expect(table.rows[0]?.cells).toEqual(['1', 'Doble, "queso"\nsin cebolla', '30000']);
    expect(table.rows[1]?.line).toBe(4);
    expect(table.rows[1]?.cells[1]).toBe('Papas');
  });

  it('rellena filas cortas, nombra encabezados vacíos y repetidos', () => {
    const table = parseCsv('Total,,Total\n1');
    expect(table.headers).toEqual(['Total', 'Columna 2', 'Total (2)']);
    expect(table.rows[0]?.cells).toEqual(['1', '', '']);
  });

  it('entiende la línea sep=; de Excel y un archivo vacío', () => {
    const table = parseCsv('sep=;\r\nid;total\r\n1;2');
    expect(table.delimiter).toBe(';');
    expect(table.headers).toEqual(['id', 'total']);
    expect(parseCsv('').headers).toEqual([]);
  });

  it('decodifica UTF-8 y cae a Windows-1252', () => {
    expect(decodeCsv(new TextEncoder().encode('Comisión'))).toBe('Comisión');
    expect(decodeCsv(new Uint8Array([0x43, 0x6f, 0x6d, 0x69, 0x73, 0x69, 0xf3, 0x6e]))).toBe('Comisión');
  });
});

describe('parseMoney', () => {
  it.each([
    ['12000', 12000],
    ['$ 12.000', 12000],
    ['$12.000', 12000],
    ['12,000', 12000],
    ['1.234,50', 1235],
    ['1,234.50', 1235],
    ['1.234.567', 1234567],
    ['1.234.567,89', 1234568],
    ['12000.00', 12000],
    ['12000,4', 12000],
    ['COP 45.900', 45900],
    ['0', 0],
    [' 9 000 ', 9000],
  ])('%s → %d', (raw, value) => expect(parseMoney(raw)).toBe(value));

  it.each(['', 'abc', '-5000', '(5000)', '12.00.0', '1,2,3', '1.2345.678', '999.999.999'])(
    'rechaza %j',
    (raw) => expect(parseMoney(raw)).toBeNull(),
  );
});

describe('parseDate', () => {
  it.each([
    ['19/11/2026', '2026-11-19'],
    ['1/2/2026', '2026-02-01'],
    ['19-11-26', '2026-11-19'],
    ['19/11/2026 18:05', '2026-11-19 18:05'],
    ['19/11/2026 6:05:09', '2026-11-19 06:05:09'],
    ['19/11/2026 6:05 p. m.', '2026-11-19 18:05'],
    ['19/11/2026 12:10 a.m.', '2026-11-19 00:10'],
    ['19/11/2026, 12:10 PM', '2026-11-19 12:10'],
    ['2026-11-19', '2026-11-19'],
    ['2026-11-19 08:30', '2026-11-19 08:30'],
    ['2026-11-19T08:30:15', '2026-11-19 08:30:15'],
    ['2026-11-19T03:30:00Z', '2026-11-18 22:30:00'],
    ['2026-11-19T03:30:00.000+00:00', '2026-11-18 22:30:00'],
    ['2026-11-19T08:30-05:00', '2026-11-19 08:30'],
  ])('%s → %s', (raw, value) => expect(parseDate(raw)).toBe(value));

  it.each(['', '31/02/2026', '11/19/2026', '2026-13-01', '19/11/2026 25:00', '19/11/2026 13:00 pm', 'ayer'])(
    'rechaza %j',
    (raw) => expect(parseDate(raw)).toBeNull(),
  );

  it('el día de hoy es el de Bogotá', () => {
    expect(bogotaToday(new Date('2026-11-20T04:30:00Z'))).toBe('2026-11-19');
  });
});

describe('mapeo', () => {
  it('propone por nombres comunes, con o sin tildes', () => {
    expect(suggestMap(['Order ID', 'Fecha', 'Total', 'Comisión', 'Estado', 'Productos'])).toEqual({
      external_id: 'Order ID',
      date: 'Fecha',
      total: 'Total',
      commission: 'Comisión',
      status: 'Estado',
      items: 'Productos',
    });
    expect(suggestMap(['ID pedido', 'Fecha del pedido', 'Valor total (COP)', 'Comision'])).toEqual({
      external_id: 'ID pedido',
      date: 'Fecha del pedido',
      total: 'Valor total (COP)',
      commission: 'Comision',
    });
  });

  it('prefiere el mapeo guardado y completa con la propuesta', () => {
    const headers = ['Código', 'Fecha', 'Neto', 'Total'];
    expect(resolveMap(headers, { external_id: 'Código', total: 'Neto', status: 'No existe' })).toEqual({
      external_id: 'Código',
      date: 'Fecha',
      total: 'Neto',
    });
    expect(resolveMap(headers, null)).toEqual({ date: 'Fecha', total: 'Total' });
    expect(resolveMap(['codigo ', 'FECHA', 'Neto'], { external_id: 'Código', total: 'Neto' })).toEqual({
      external_id: 'codigo ',
      date: 'FECHA',
      total: 'Neto',
    });
    expect(missingFields({ date: 'Fecha' })).toEqual(['Id del pedido', 'Total']);
    expect(cleanMap({ total: 'x'.repeat(100), items: '' })).toEqual({ total: 'x'.repeat(80) });
  });
});

describe('buildRows', () => {
  const csv = [
    'Order ID;Fecha;Total;Comisión;Estado;Productos',
    'R1;19/11/2026 12:30;$ 45.000;9.000;Entregado;Doble  barril',
    'R2;18/11/2026;30.000;6.000;Cancelado;',
    'R3;31/02/2026;10.000;;Entregado;',
    ';18/11/2026;10.000;;Entregado;',
    'R4;18/11/2026;gratis;;Entregado;',
    'R1;19/11/2026;45.000;9.000;Entregado;',
    'R5;2019-12-31;10.000;;Entregado;',
    'R6;2026-11-21;10.000;;Entregado;',
    'R7;2026-11-20 23:00;"1.234,50";;Entregado;',
  ].join('\r\n');
  const table = parseCsv(csv);
  const built = buildRows(table, resolveMap(table.headers, {}), NOW);

  it('arma las filas válidas para la RPC', () => {
    expect(built.rows).toEqual([
      { external_id: 'R1', date: '2026-11-19 12:30', total: 45000, commission: 9000, items: 'Doble barril' },
      { external_id: 'R7', date: '2026-11-20 23:00', total: 1235 },
    ]);
    expect(built.lines).toEqual([2, 10]);
    expect(built.commission).toBe(9000);
  });

  it('cuenta errores con motivo, repetidas en el archivo y anuladas', () => {
    expect(built.voided).toBe(1);
    expect(built.repeatedInFile).toBe(1);
    expect(built.errors.map((error) => error.line)).toEqual([4, 5, 6, 8, 9]);
    expect(built.errors[0]?.reason).toContain('fecha');
    expect(built.errors[1]?.reason).toContain('id');
    expect(built.errors[2]?.reason).toContain('«gratis»');
  });

  it('sin columna de comisión no inventa una suma', () => {
    const plain = parseCsv('id,fecha,total\nA,19/11/2026,100');
    expect(buildRows(plain, suggestMap(plain.headers), NOW).commission).toBeNull();
  });

  it('rango de días', () => {
    expect(dayRange(built.rows)).toEqual({ from: '2026-11-19', to: '2026-11-20' });
    expect(dayRange([])).toBeNull();
  });
});

describe('previewCounts', () => {
  const rows = [
    { external_id: 'A', date: '2026-11-18 12:00', total: 30000 },
    { external_id: 'B', date: '2026-11-18 13:00', total: 30000 },
    { external_id: 'C', date: '2026-11-18', total: 30000 },
    { external_id: 'D', date: '2026-11-19', total: 20000 },
  ];
  const orders = [
    { id: 'o2', total: 30000, day: '2026-11-18', created_at: '2026-11-18T20:00:00Z' },
    { id: 'o1', total: 30000, day: '2026-11-18', created_at: '2026-11-18T18:00:00Z' },
    { id: 'o3', total: 20000, day: '2026-11-18', created_at: '2026-11-18T18:00:00Z' },
  ];
  it('repetidas no consumen pedido y cada pedido casa una vez', () => {
    expect(previewCounts(rows, new Set(['A']), orders, new Set())).toEqual({
      fresh: 1,
      repeated: 1,
      matched: 2,
    });
  });
  it('excluye los pedidos que ya casaron en otro lote', () => {
    expect(previewCounts(rows, new Set(), orders, new Set(['o1']))).toEqual({
      fresh: 3,
      repeated: 0,
      matched: 1,
    });
  });
});

describe('serverErrors', () => {
  it('traduce el índice de la RPC a la fila del archivo', () => {
    expect(serverErrors([{ row: 2, reason: 'fecha' }, { row: 'x' }], [5, 9])).toEqual([
      { line: 9, reason: 'fecha no válida o fuera de rango' },
    ]);
    expect(serverErrors(null, [])).toEqual([]);
  });
});
