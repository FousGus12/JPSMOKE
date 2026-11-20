/** Trazos del logo (viewBox 40×40): única fuente para el sitio (Logo.astro), el recibo y su imagen compartida. */
export const LOGO_VIEWBOX = '0 0 40 40';

export interface LogoShape {
  tag: 'rect' | 'path';
  /** Atributos SVG en kebab-case, en el orden en que se escriben. */
  attrs: Record<string, string | number>;
}

/** `ink` colorea la caja y `accent` el vapor: en el sitio `currentColor` y `var(--accent)`, en el papel `#000` los dos. */
export function logoShapes(ink = 'currentColor', accent = 'var(--accent)'): LogoShape[] {
  return [
    {
      tag: 'rect',
      attrs: {
        x: 7,
        y: 9,
        width: 26,
        height: 26,
        rx: 6,
        fill: 'none',
        stroke: ink,
        'stroke-width': 2.4,
      },
    },
    { tag: 'path', attrs: { d: 'M7 17h26M7 27h26', stroke: ink, 'stroke-width': 2.4 } },
    {
      tag: 'path',
      attrs: {
        d: 'M15 7c0-3 3-3 3-6M21 7c0-3 3-3 3-6',
        fill: 'none',
        stroke: accent,
        'stroke-width': 2.4,
        'stroke-linecap': 'round',
      },
    },
  ];
}

/** Los trazos como texto SVG (para la imagen compartida). */
export function logoSvgMarkup(ink: string, accent: string): string {
  return logoShapes(ink, accent)
    .map(
      ({ tag, attrs }) =>
        `<${tag} ${Object.entries(attrs)
          .map(([key, value]) => `${key}="${value}"`)
          .join(' ')}/>`,
    )
    .join('');
}
