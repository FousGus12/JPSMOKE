import { describe, expect, it } from 'vitest';
import {
  customerWhatsApp,
  formatPhone,
  groupBoard,
  isLate,
  nestItems,
  nextStep,
  startOfBogotaDay,
} from './orders';

const NOW = Date.parse('2026-11-01T20:00:00Z'); // 3:00 p. m. en Bogotá

describe('tablero', () => {
  it('siguiente estado en orden y nada después de entregado', () => {
    expect(nextStep('nuevo')).toEqual({ status: 'confirmado', label: 'Confirmar' });
    expect(nextStep('en_camino')?.status).toBe('entregado');
    expect(nextStep('entregado')).toBeNull();
    expect(nextStep('cancelado')).toBeNull();
    expect(nextStep('en_cocina', 'recoger')).toEqual({ status: 'en_camino', label: 'Listo para recoger' });
    expect(nextStep('en_camino', 'recoger')?.label).toBe('Ya lo recogió');
  });
  it('pedido abierto de más de 45 min es tarde; cerrado nunca', () => {
    expect(isLate('nuevo', '2026-11-01T19:00:00Z', NOW)).toBe(true);
    expect(isLate('en_cocina', '2026-11-01T19:30:00Z', NOW)).toBe(false);
    expect(isLate('entregado', '2026-11-01T10:00:00Z', NOW)).toBe(false);
  });
  it('el día empieza a medianoche de Bogotá', () =>
    expect(new Date(startOfBogotaDay(NOW)).toISOString()).toBe('2026-11-01T05:00:00.000Z'));
  it('agrupa: abiertos de ayer siguen; entregados de ayer no; más viejos primero', () => {
    const board = groupBoard(
      [
        { id: 'a', status: 'nuevo' as const, created_at: '2026-11-01T19:50:00Z' },
        { id: 'b', status: 'nuevo' as const, created_at: '2026-11-01T19:10:00Z' },
        { id: 'c', status: 'en_cocina' as const, created_at: '2026-10-31T23:00:00Z' },
        { id: 'd', status: 'entregado' as const, created_at: '2026-10-31T23:00:00Z' },
        { id: 'e', status: 'entregado' as const, created_at: '2026-11-01T18:00:00Z' },
      ],
      NOW,
    );
    expect(board.nuevo.map((order) => order.id)).toEqual(['b', 'a']);
    expect(board.en_cocina.map((order) => order.id)).toEqual(['c']);
    expect(board.entregado.map((order) => order.id)).toEqual(['e']);
  });
  it('celular legible y enlace de WhatsApp', () => {
    expect(formatPhone('3105551234')).toBe('310 555 1234');
    expect(customerWhatsApp('3105551234', 'Ana María', 'JP-0001', 'JP Smoke')).toContain(
      'wa.me/573105551234',
    );
  });
});

describe('nestItems (D40)', () => {
  it('cada adición queda debajo de su plato', () => {
    const items = [
      { id: 'a', parent: null, position: 1, name: 'Burger' },
      { id: 'b', parent: null, position: 2, name: 'Burger' },
      { id: 'c', parent: 'b', position: 3, name: 'Huevo' },
      { id: 'd', parent: null, position: 4, name: 'Papas' },
    ];
    expect(nestItems(items).map((item) => `${item.isAddon ? '+' : ''}${item.name}`)).toEqual([
      'Burger',
      'Burger',
      '+Huevo',
      'Papas',
    ]);
  });
  it('pedidos viejos sin id ni padre quedan iguales', () => {
    const old: Array<{ name: string; id?: string }> = [{ name: 'A' }, { name: 'B' }];
    expect(nestItems(old).map((item) => item.name)).toEqual(['A', 'B']);
  });
});
