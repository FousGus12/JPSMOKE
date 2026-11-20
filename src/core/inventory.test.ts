import { describe, expect, it } from 'vitest';
import {
  costFromPurchase,
  costPerUse,
  inPurchaseUnits,
  inputText,
  margin,
  parseInput,
  qtyText,
  recipeCost,
  roundUpTo100,
  servingsLeft,
  suggestedPrice,
  suppliesWithoutCost,
  supplyLevel,
} from './inventory';

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

const pan = { id: 'pan', name: 'Pan', cost: 12000, costBasis: 'compra' as const, perPurchase: 12 };
const lechuga = { id: 'lechuga', name: 'Lechuga', cost: 150, costBasis: 'uso' as const, perPurchase: 20 };
const gaseosa = { id: 'gaseosa', name: 'Gaseosa', cost: null, costBasis: 'compra' as const, perPurchase: 1 };
const costs = [pan, lechuga, gaseosa];

describe('costo y margen (D49)', () => {
  it('costo por unidad de uso', () => {
    expect(costPerUse(pan)).toBe(1000);
    expect(costPerUse(lechuga)).toBe(150);
    expect(costPerUse(gaseosa)).toBeNull();
    expect(costPerUse({ cost: 5000, costBasis: 'compra', perPurchase: 0 })).toBeNull();
  });
  it('costo al registrar una compra según la base', () => {
    expect(costFromPurchase(12000, 'compra', 12)).toBe(12000);
    expect(costFromPurchase(10000, 'uso', 3)).toBe(3333.33);
  });
  it('costo de receta: el plato no suma lo de combo', () => {
    expect(recipeCost(recipe, costs)).toEqual({ cost: 1300, missing: [] });
  });
  it('el combo suma todo y avisa lo que no tiene costo', () => {
    expect(recipeCost(recipe, costs, true)).toEqual({ cost: 1300, missing: ['Gaseosa'] });
    expect(suppliesWithoutCost(recipe, costs)).toEqual(['Gaseosa']);
    expect(recipeCost([{ supplyId: 'otro', qty: 1, comboOnly: false }], costs).missing).toEqual([
      'insumo borrado',
    ]);
  });
  it('margen en pesos y %', () => {
    expect(margin(20000, 7000)).toEqual({ amount: 13000, percent: 65 });
    expect(margin(0, 1000).percent).toBeNull();
  });
  it('precio sugerido redondeado a $100 hacia arriba', () => {
    expect(suggestedPrice(3500, 65)).toBe(10000);
    expect(suggestedPrice(7000, 65)).toBe(20000);
    expect(suggestedPrice(7001, 65)).toBe(20100);
    expect(suggestedPrice(0, 65)).toBeNull();
    expect(suggestedPrice(1000, 96)).toBeNull();
    expect(roundUpTo100(10000.000000000002)).toBe(10000);
    expect(roundUpTo100(10000.01)).toBe(10100);
  });
});

describe('campos numéricos', () => {
  it('ida y vuelta sin perder miles ni decimales', () => {
    for (const value of [0, 1, 1.5, 1000, 12000, 3333.33, 100000])
      expect(parseInput(inputText(value))).toBe(value);
  });
  it('acepta como lo escribe el dueño', () => {
    expect(parseInput('12.000')).toBe(12000);
    expect(parseInput('$ 1.250.000')).toBe(1250000);
    expect(parseInput('1.5')).toBe(1.5);
    expect(parseInput('1,5')).toBe(1.5);
    expect(parseInput('12.000,50')).toBe(12000.5);
    expect(parseInput('')).toBeNaN();
    expect(parseInput('abc')).toBeNaN();
  });
});
