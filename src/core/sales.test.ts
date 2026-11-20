import { describe, expect, it } from 'vitest';
import { csvCell, niceMax, percentChange, toCsv, voidedAfterClose, weeklyText } from './sales';

describe('ventas', () => {
  it('cambio porcentual y sin inventar cuando antes fue cero', () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(50, 0)).toBeNull();
  });
  it('techo redondo para el eje', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(87_000)).toBe(100_000);
    expect(niceMax(180_000)).toBe(200_000);
    expect(niceMax(230_000)).toBe(250_000);
  });
  it('CSV: escapa comillas, comas y evita fórmulas', () => {
    expect(csvCell('La "Ahumadora", combo')).toBe('"La ""Ahumadora"", combo"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe('');
    expect(toCsv([{ codigo: 'JP-0001', total: 32000 }])).toBe('codigo,total\nJP-0001,32000');
  });
  it('informe semanal en texto', () => {
    const text = weeklyText(
      {
        from: '2026-10-26',
        to: '2026-11-01',
        total: 1_200_000,
        orders: 40,
        previous_total: 1_000_000,
        previous_orders: 35,
        ticket: 30_000,
        star: 'La Ahumadora',
        peak_hour: 19,
        peak_day: 5,
        blocked: 3,
        cancelled: 2,
      },
      'JP Smoke',
    );
    expect(text).toContain('Ventas: $1.200.000 (▲ 20% vs. la semana anterior)');
    expect(text).toContain('Producto estrella: La Ahumadora');
    expect(text).toContain('viernes a las 7 p. m.');
  });
});

describe('anulados después del cierre (D42)', () => {
  it('sin el campo (base vieja) queda vacío', () => {
    expect(voidedAfterClose(undefined)).toEqual({ rows: [], total: 0 });
    expect(voidedAfterClose(null).rows).toEqual([]);
  });
  it('suma lo anulado', () => {
    const list = [
      { code: 'JP-0001', total: 30000, day: '2026-11-18', reason: 'Pedido falso' },
      { code: 'JP-0002', total: 12000, day: '2026-11-19', reason: null },
    ];
    expect(voidedAfterClose(list)).toEqual({ rows: list, total: 42000 });
  });
});
