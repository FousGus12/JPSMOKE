import { describe, expect, it } from 'vitest';
import { buildReceipt, maskPhone, wrapText, type ReceiptOrderInput } from './receipt';

const business = { name: 'JP Smoke' };
function order(patch: Partial<ReceiptOrderInput> = {}): ReceiptOrderInput {
  return {
    code: 'JP-0042',
    status: 'nuevo',
    channel: 'web',
    fulfillment: 'domicilio',
    customer_name: 'Ana',
    phone: '300 123 4567',
    address: 'Cra 7 # 10-20',
    barrio: 'Chapinero',
    notes: '',
    payment_label: 'Efectivo',
    cash_with: null,
    subtotal: 52000,
    discount: 0,
    delivery_fee: 5000,
    total: 57000,
    coupon_code: null,
    gift: null,
    created_at: '2026-11-19T20:45:00Z',
    order_items: [
      {
        id: 'b',
        parent_item_id: 'a',
        position: 2,
        name: 'Tocineta extra',
        qty: 2,
        combo: false,
        unit_price: 3000,
      },
      {
        id: 'a',
        parent_item_id: null,
        position: 1,
        name: 'Burger Negra',
        qty: 2,
        combo: true,
        unit_price: 23000,
      },
    ],
    ...patch,
  };
}

describe('buildReceipt', () => {
  it('anida adiciones bajo su plato y calcula líneas', () => {
    const built = buildReceipt(order(), business);
    expect(built.items.map((item) => [item.name, item.addon, item.amount])).toEqual([
      ['Burger Negra (combo)', false, '$46.000'],
      ['Tocineta extra', true, '$6.000'],
    ]);
  });
  it('fecha en hora de Bogotá', () => {
    expect(buildReceipt(order(), business).dateText).toMatch(/3:45/);
  });
  it('descuento con cupón', () => {
    const built = buildReceipt(order({ discount: 5200, coupon_code: 'HUMO10', total: 51800 }), business);
    expect(built.totals.find((total) => total.label.startsWith('Descuento'))).toEqual({
      label: 'Descuento (HUMO10)',
      value: '−$5.200',
    });
  });
  it('envío gratis', () => {
    const built = buildReceipt(order({ delivery_fee: 0, total: 52000 }), business);
    expect(built.totals.find((total) => total.label === 'Domicilio')?.value).toBe('Gratis');
  });
  it('recoger: sin domicilio ni dirección', () => {
    const built = buildReceipt(order({ fulfillment: 'recoger', delivery_fee: 0 }), business);
    expect(built.delivery.pickup).toBe(true);
    expect(built.totals.some((total) => total.label === 'Domicilio')).toBe(false);
  });
  it('anulado', () => {
    expect(buildReceipt(order({ status: 'cancelado' }), business).voided).toBe(true);
    expect(buildReceipt(order(), business).voided).toBe(false);
  });
  it('paga con y cambio, redondeo COP', () => {
    const built = buildReceipt(order({ cash_with: 100000, total: 57000.4 }), business);
    expect(built.payment.map((pay) => pay.value)).toEqual(['Efectivo', '$100.000', '$43.000']);
    expect(built.totals.at(-1)?.value).toBe('$57.000');
  });
  it('no inventa cambio si paga con menos del total', () => {
    const built = buildReceipt(order({ cash_with: 20000 }), business);
    expect(built.payment.some((pay) => pay.label === 'Cambio')).toBe(false);
  });
  it('pedido viejo sin ids queda en orden', () => {
    const built = buildReceipt(
      order({
        order_items: [
          { id: '', parent_item_id: null, position: 0, name: 'A', qty: 1, combo: false, unit_price: 1000 },
          { id: '', parent_item_id: null, position: 0, name: 'B', qty: 1, combo: false, unit_price: 2000 },
        ],
      }),
      business,
    );
    expect(built.items.map((item) => item.name)).toEqual(['A', 'B']);
  });
});

describe('maskPhone y wrapText', () => {
  it('enmascara', () => {
    expect(maskPhone('300 123 4567')).toBe('••• 4567');
    expect(maskPhone('12')).toBe('');
  });
  it('parte renglones', () => {
    expect(wrapText('uno dos tres cuatro', 8)).toEqual(['uno dos', 'tres', 'cuatro']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});
