const formatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** Formato de pesos colombianos sin decimales: 120000 → "$120.000". Precios finales, impoconsumo incluido. */
export function formatCop(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Valor no numérico');
  const sign = value < 0 ? '−' : '';
  return `${sign}$${formatter.format(Math.abs(Math.round(value)))}`;
}
