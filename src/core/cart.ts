// Vista previa del total en el carrito. El total que vale lo calcula la base (place_order);
// esta copia solo muestra al cliente lo que va a pagar y debe coincidir con la regla del servidor.

export interface CartProduct {
  id: string;
  price: number;
  comboPrice: number | null;
  available: boolean;
}
export interface CartLine {
  productId: string;
  qty: number;
  combo: boolean;
}
export type CouponKind = 'porcentaje' | 'valor' | 'envio' | 'regalo';
export interface CartCoupon {
  code: string;
  kind: CouponKind;
  value: number;
  minTotal: number;
  title: string;
}
export interface CartTotals {
  subtotal: number;
  discount: number;
  fee: number;
  total: number;
  gift: string | null;
  couponApplies: boolean;
  missingForMin: number;
}

export function unitPrice(product: CartProduct, combo: boolean): number {
  return combo && product.comboPrice !== null ? product.comboPrice : product.price;
}

export function cartTotals(
  lines: CartLine[],
  products: CartProduct[],
  options: { coupon?: CartCoupon | null; zoneFee?: number | null; deliveryMin?: number } = {},
): CartTotals {
  const byId = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product || !product.available || line.qty < 1) continue;
    subtotal += unitPrice(product, line.combo) * line.qty;
  }
  let fee = options.zoneFee ?? 0;
  let discount = 0;
  let gift: string | null = null;
  const coupon = options.coupon ?? null;
  const couponApplies = coupon !== null && subtotal >= coupon.minTotal;
  if (coupon && couponApplies) {
    if (coupon.kind === 'porcentaje') discount = Math.round((subtotal * coupon.value) / 100);
    else if (coupon.kind === 'valor') discount = Math.min(coupon.value, subtotal);
    else if (coupon.kind === 'envio') fee = 0;
    else gift = coupon.title;
  }
  const missingForMin = Math.max(0, (options.deliveryMin ?? 0) - subtotal);
  return { subtotal, discount, fee, total: subtotal - discount + fee, gift, couponApplies, missingForMin };
}

/** Upsell (P8): primera línea que se puede pasar a combo y cuánto cuesta la diferencia. */
export function comboUpsell(
  lines: CartLine[],
  products: CartProduct[],
): { productId: string; extra: number } | null {
  for (const line of lines) {
    const product = products.find((item) => item.id === line.productId);
    if (product && !line.combo && product.comboPrice !== null) {
      return { productId: product.id, extra: product.comboPrice - product.price };
    }
  }
  return null;
}
