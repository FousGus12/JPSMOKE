/**
 * Versiones por tamaño de una foto (D51). Lógica pura: qué anchos generar sin pasar del original
 * y, si la caja recorta la foto (ratio = ancho / alto), sin pasar del recorte posible.
 */
export interface PhotoSize {
  width: number;
  height: number;
}

/** Anchos a generar: los pedidos que caben en el original (o en su recorte); si ninguno cabe, el máximo posible. */
export function photoWidths(original: PhotoSize, wanted: readonly number[], ratio?: number): number[] {
  if (!(original.width > 0) || !(original.height > 0)) return [];
  const max = Math.floor(ratio ? Math.min(original.width, original.height * ratio) : original.width);
  const fit = [...new Set(wanted)]
    .filter((width) => width > 0 && width <= max)
    .sort((left, right) => left - right);
  return fit.length > 0 ? fit : [max];
}

/** Ancho del `src` de respaldo: el mayor que no pase de `preferred` (o el menor si todos lo pasan). */
export function fallbackWidth(widths: readonly number[], preferred = 480): number {
  const fit = widths.filter((width) => width <= preferred);
  return fit.length > 0 ? Math.max(...fit) : Math.min(...widths);
}

/** Alto para un ancho dado: el del recorte si hay ratio, si no el proporcional al original. */
export function photoHeight(width: number, original: PhotoSize, ratio?: number): number {
  return Math.round(ratio ? width / ratio : (width * original.height) / original.width);
}
