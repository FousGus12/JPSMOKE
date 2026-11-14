import { describe, expect, it } from 'vitest';
import { inPurchaseUnits, qtyText, servingsLeft, supplyLevel } from './inventory';

const supplies = [
  { id: 'pan', stock: 12, minStock: 4 },
  { id: 'lechuga', stock: 10, minStock: 4 },
  { id: 'gaseosa', stock: 0, minStock: 2 },
];
const recipe = [
  { supplyId: 'pan', qty: 1, comboOnly: false },
  { supplyId: 'lechuga', qty: 2, comboOnly: false },
  { supplyId: 'gaseosa', qty: 1, comboOnly: true },
];

describe('inventario', () => {
  it('alcanza para lo que permita el insumo más escaso', () =>
    expect(servingsLeft(recipe, supplies)).toBe(5));
  it('en combo cuenta los extras', () => expect(servingsLeft(recipe, supplies, true)).toBe(0));
  it('sin receta no se controla', () => expect(servingsLeft([], supplies)).toBeNull());
  it('nivel del insumo', () => {
    expect(supplyLevel({ id: 'x', stock: 0, minStock: 2 })).toBe('agotado');
    expect(supplyLevel({ id: 'x', stock: 2, minStock: 2 })).toBe('bajo');
    expect(supplyLevel({ id: 'x', stock: 3, minStock: 2 })).toBe('ok');
  });
  it('en unidades de compra y sin ceros', () => {
    expect(inPurchaseUnits(48, 12)).toBe(4);
    expect(inPurchaseUnits(30, 12)).toBe(2.5);
    expect(qtyText(2)).toBe('2');
    expect(qtyText(1.5)).toBe('1,5');
  });
});
