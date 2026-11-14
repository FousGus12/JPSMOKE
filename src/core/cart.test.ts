import { describe, expect, it } from 'vitest';
import { cartTotals, comboUpsell, type CartCoupon, type CartProduct } from './cart';

const products: CartProduct[] = [
  { id: 'b1', price: 30000, comboPrice: 39000, available: true },
  { id: 'b2', price: 20000, comboPrice: null, available: true },
  { id: 'out', price: 10000, comboPrice: null, available: false },
];
const pct: CartCoupon = { code: 'HUMO20', kind: 'porcentaje', value: 20, minTotal: 40000, title: '20%' };

describe('cartTotals (debe coincidir con place_order)', () => {
  it('2 combos + domicilio', () =>
    expect(cartTotals([{ productId: 'b1', qty: 2, combo: true }], products, { zoneFee: 5000 }).total).toBe(
      83000,
    ));
  it('cupón 20% sobre el mínimo', () => {
    const totals = cartTotals([{ productId: 'b1', qty: 2, combo: false }], products, {
      coupon: pct,
      zoneFee: 5000,
    });
    expect([totals.discount, totals.total]).toEqual([12000, 53000]);
  });
  it('cupón bajo el mínimo no aplica', () =>
    expect(
      cartTotals([{ productId: 'b1', qty: 1, combo: false }], products, { coupon: pct }).couponApplies,
    ).toBe(false));
  it('envío gratis deja el domicilio en 0', () => {
    const envio: CartCoupon = { code: 'ENVIO', kind: 'envio', value: 0, minTotal: 0, title: 'Envío' };
    expect(
      cartTotals([{ productId: 'b2', qty: 1, combo: false }], products, { coupon: envio, zoneFee: 7000 })
        .total,
    ).toBe(20000);
  });
  it('combo en un producto sin combo cobra precio normal', () =>
    expect(cartTotals([{ productId: 'b2', qty: 1, combo: true }], products).subtotal).toBe(20000));
  it('ignora agotados y cantidades inválidas', () =>
    expect(
      cartTotals(
        [
          { productId: 'out', qty: 1, combo: false },
          { productId: 'b2', qty: 0, combo: false },
        ],
        products,
      ).subtotal,
    ).toBe(0));
  it('cuánto falta para el mínimo', () =>
    expect(
      cartTotals([{ productId: 'b2', qty: 1, combo: false }], products, { deliveryMin: 25000 }).missingForMin,
    ).toBe(5000));
  it('descuento de valor no supera el subtotal', () => {
    const valor: CartCoupon = { code: 'MENOS', kind: 'valor', value: 50000, minTotal: 0, title: '-50k' };
    expect(cartTotals([{ productId: 'b2', qty: 1, combo: false }], products, { coupon: valor }).total).toBe(
      0,
    );
  });
});

describe('comboUpsell', () => {
  it('sugiere pasar a combo con la diferencia', () =>
    expect(comboUpsell([{ productId: 'b1', qty: 1, combo: false }], products)).toEqual({
      productId: 'b1',
      extra: 9000,
    }));
  it('nada que sugerir', () =>
    expect(comboUpsell([{ productId: 'b2', qty: 1, combo: false }], products)).toBeNull());
});
