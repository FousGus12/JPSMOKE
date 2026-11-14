/**
 * Normaliza un celular colombiano a 10 dígitos que empiezan por 3.
 * Acepta espacios, guiones, paréntesis y el prefijo +57 / 57. Devuelve null si no es un celular válido.
 */
export function normalizeColombianMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
  return /^3\d{9}$/.test(digits) ? digits : null;
}

/** Formato internacional para wa.me: 3001234567 → "573001234567". */
export function toWhatsAppNumber(mobile: string): string {
  const normalized = normalizeColombianMobile(mobile);
  if (!normalized) throw new Error('Celular inválido');
  return `57${normalized}`;
}
