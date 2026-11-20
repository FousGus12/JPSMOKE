import { describe, expect, it } from 'vitest';
import {
  addLine,
  attachAddon,
  cartTotals,
  changeQty,
  comboUpsell,
  dropAddonsWithoutDish,
  hasDish,
  normalizeCart,
  orderItems,
  readLastOrder,
  repeatOrder,
  snapshotOrder,
  type CartCoupon,
  type CartProduct,
} from './cart';

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

describe('adiciones ligadas a un plato (D40)', () => {
  const keys = () => {
    let count = 0;
    return () => `k${++count}`;
  };
  it('3 hamburguesas + huevo a una: se separa una unidad y el huevo va a esa', () => {
    const nk = keys();
    let cart = addLine([], 'burger', false, nk);
    cart = addLine(cart, 'burger', false, nk);
    cart = addLine(cart, 'burger', false, nk);
    expect(cart).toEqual([{ key: 'k1', productId: 'burger', qty: 3, combo: false }]);
    cart = attachAddon(cart, 'huevo', 'k1', nk);
    expect(cart).toEqual([
      { key: 'k1', productId: 'burger', qty: 2, combo: false },
      { key: 'k2', productId: 'burger', qty: 1, combo: false },
      { key: 'k3', productId: 'huevo', qty: 1, combo: false, parent: 'k2' },
    ]);
    // Otra hamburguesa igual no se mezcla con la que lleva huevo.
    cart = addLine(cart, 'burger', false, nk);
    expect(cart[0]?.qty).toBe(3);
    // Un segundo huevo a la misma suma cantidad.
    cart = attachAddon(cart, 'huevo', 'k2', nk);
    expect(cart.find((line) => line.key === 'k3')?.qty).toBe(2);
  });
  it('adición aparte: sin padre y se suma como cualquier producto', () => {
    const nk = keys();
    let cart = attachAddon([], 'papas', null, nk);
    cart = attachAddon(cart, 'papas', null, nk);
    expect(cart).toEqual([{ key: 'k1', productId: 'papas', qty: 2, combo: false }]);
  });
  it('quitar el plato quita sus adiciones', () => {
    const nk = keys();
    let cart = addLine([], 'burger', false, nk);
    cart = attachAddon(cart, 'queso', 'k1', nk);
    cart = changeQty(cart, 'k1', -1, nk);
    expect(cart).toEqual([]);
  });
  it('sumar a un plato con adiciones agrega una unidad aparte, sin adiciones', () => {
    const nk = keys();
    let cart = addLine([], 'burger', true, nk);
    cart = attachAddon(cart, 'queso', 'k1', nk);
    cart = changeQty(cart, 'k1', 1, nk);
    expect(cart).toEqual([
      { key: 'k1', productId: 'burger', qty: 1, combo: true },
      { key: 'k2', productId: 'queso', qty: 1, combo: false, parent: 'k1' },
      { key: 'k3', productId: 'burger', qty: 1, combo: true },
    ]);
  });
  it('carrito guardado antes de D40: recibe llaves y descarta adiciones huérfanas', () => {
    const nk = keys();
    expect(
      normalizeCart(
        [
          { productId: 'burger', qty: 1, combo: false },
          { productId: 'huevo', qty: 1, combo: false, parent: 'no-existe' },
        ],
        nk,
      ),
    ).toEqual([{ key: 'k1', productId: 'burger', qty: 1, combo: false }]);
  });
  it('ítems del pedido: llave y padre solo donde hay adiciones', () => {
    const nk = keys();
    let cart = addLine([], 'burger', false, nk);
    cart = addLine(cart, 'papas', false, nk);
    cart = attachAddon(cart, 'huevo', 'k1', nk);
    expect(orderItems(cart)).toEqual([
      { product_id: 'burger', qty: 1, combo: false, key: 'k1' },
      { product_id: 'huevo', qty: 1, combo: false, key: 'k3', parent: 'k1' },
      { product_id: 'papas', qty: 1, combo: false },
    ]);
  });
});

describe('adiciones solo con plato (D47)', () => {
  const addons = new Set(['huevo', 'tocineta']);
  const isAddon = (id: string) => addons.has(id);
  it('sin plato no hay plato', () => {
    expect(hasDish([], isAddon)).toBe(false);
    expect(hasDish([{ productId: 'huevo', qty: 1, combo: false }], isAddon)).toBe(false);
    expect(hasDish([{ productId: 'b1', qty: 1, combo: false }], isAddon)).toBe(true);
  });
  it('con plato no se toca nada', () => {
    const lines = [
      { key: 'p', productId: 'b1', qty: 1, combo: false },
      { key: 'a', productId: 'huevo', qty: 1, combo: false, parent: 'p' },
      { key: 'x', productId: 'tocineta', qty: 2, combo: false },
    ];
    expect(dropAddonsWithoutDish(lines, isAddon)).toEqual({ lines, removed: 0 });
  });
  it('al quitar el último plato se van las adiciones aparte y ligadas', () => {
    let seq = 0;
    const key = () => `k${++seq}`;
    let lines = addLine([], 'b1', false, key);
    lines = attachAddon(lines, 'huevo', 'k1', key);
    lines = attachAddon(lines, 'tocineta', null, key);
    lines = changeQty(lines, 'k1', -1, key);
    expect(lines).toHaveLength(1); // la aparte sigue tras changeQty
    const result = dropAddonsWithoutDish(lines, isAddon);
    expect(result.lines).toEqual([]);
    expect(result.removed).toBe(1);
  });
  it('carrito guardado solo con adiciones queda vacío', () => {
    const result = dropAddonsWithoutDish(
      [
        { key: 'a', productId: 'huevo', qty: 2, combo: false },
        { key: 'b', productId: 'tocineta', qty: 1, combo: false },
      ],
      isAddon,
    );
    expect(result).toEqual({ lines: [], removed: 3 });
  });
});

describe('repetir el último pedido (D63)', () => {
  const live: CartProduct[] = [
    { id: 'burger', price: 30000, comboPrice: 38000, available: true },
    { id: 'perro', price: 20000, comboPrice: null, available: true },
    { id: 'agotada', price: 25000, comboPrice: null, available: false },
    { id: 'huevo', price: 3000, comboPrice: null, available: true },
  ];
  const isAddon = (id: string) => id === 'huevo';
  let counter = 0;
  const newKey = () => `k${++counter}`;

  it('guarda solo las líneas y las vuelve a leer', () => {
    const snap = snapshotOrder(
      [
        { key: 'a', productId: 'burger', qty: 2, combo: true },
        { key: 'b', productId: 'huevo', qty: 1, combo: false, parent: 'a' },
      ],
      1,
    );
    expect(readLastOrder(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it('descarta lo dañado', () => {
    expect(readLastOrder(null)).toBeNull();
    expect(readLastOrder({ at: 1, lines: [] })).toBeNull();
    expect(
      readLastOrder({
        at: 1,
        lines: [
          { productId: 'x', qty: 0 },
          { productId: 3, qty: 1 },
        ],
      }),
    ).toBeNull();
    expect(readLastOrder({ at: 1, lines: [{ productId: 'x', qty: 2, parent: '<b>' }] })?.lines).toEqual([
      { productId: 'x', qty: 2, combo: false },
    ]);
  });

  it('arma el carrito con llaves nuevas y la adición ligada a su plato', () => {
    const { lines, missing, noCombo } = repeatOrder(
      {
        at: 1,
        lines: [
          { key: 'a', productId: 'burger', qty: 1, combo: true },
          { key: 'b', productId: 'huevo', qty: 1, combo: false, parent: 'a' },
          { key: 'c', productId: 'agotada', qty: 1, combo: false },
          { key: 'd', productId: 'oculta', qty: 1, combo: false },
        ],
      },
      { products: live, isAddon, newKey },
    );
    expect(missing).toEqual(['agotada', 'oculta']);
    expect(noCombo).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ productId: 'burger', combo: true });
    expect(lines[0]?.key).not.toBe('a');
    expect(lines[1]).toMatchObject({ productId: 'huevo', parent: lines[0]?.key });
  });

  it('sin combo disponible vuelve sola', () => {
    const { lines, noCombo } = repeatOrder(
      { at: 1, lines: [{ key: 'a', productId: 'burger', qty: 1, combo: true }] },
      { products: live, comboOut: new Set(['burger']), isAddon, newKey },
    );
    expect(lines[0]?.combo).toBe(false);
    expect(noCombo).toEqual(['burger']);
  });

  it('si el plato no está, la adición queda aparte; sin ningún plato se descarta', () => {
    const apart = repeatOrder(
      {
        at: 1,
        lines: [
          { key: 'a', productId: 'agotada', qty: 1, combo: false },
          { key: 'b', productId: 'huevo', qty: 1, combo: false, parent: 'a' },
          { key: 'c', productId: 'perro', qty: 1, combo: false },
        ],
      },
      { products: live, isAddon, newKey },
    );
    expect(apart.lines.map((line) => [line.productId, line.parent])).toEqual([
      ['huevo', undefined],
      ['perro', undefined],
    ]);
    const none = repeatOrder(
      {
        at: 1,
        lines: [
          { key: 'a', productId: 'agotada', qty: 1, combo: false },
          { key: 'b', productId: 'huevo', qty: 1, combo: false, parent: 'a' },
        ],
      },
      { products: live, isAddon, newKey },
    );
    expect(none.lines).toEqual([]);
    expect(none.missing).toEqual(['agotada', 'huevo']);
  });
});
