/**
 * Textos editables del inicio (D56). Lectura tolerante de `restaurant_settings.blocks` (`titles`, `final`,
 * `cta`) y de `events.lead_copy`: lo vacío, lo que no es texto o lo que falta usa el texto de hoy.
 *
 * El resultado es texto plano: nunca HTML. Astro lo escapa al pintarlo y el navegador lo pone con
 * `textContent` o `esc()`. Los títulos se parten por salto de línea (Enter en el panel) en renglones.
 * Contrato de llaves compartido con el panel (src/panel/editor.ts, P3).
 */

export const COPY_SECTIONS = ['arsenal', 'carta', 'promos', 'eventos', 'resenas', 'cobertura'] as const;
export type CopySection = (typeof COPY_SECTIONS)[number];

/** Topes por campo (los mismos del panel). */
export const COPY_LIMITS = { kicker: 40, title: 80, text: 240, button: 30, note: 80 } as const;
/** Renglones máximos de un título. */
export const MAX_TITLE_LINES = 3;

export interface SectionCopy {
  kicker: string;
  /** Renglones del título (vacío = sin título). */
  title: string[];
  /** null = el texto propio de la página (lleva enlace, conteos o variantes); '' = sin texto. */
  text: string | null;
}
export interface SiteCopy {
  titles: Record<CopySection, SectionCopy>;
  final: { kicker: string; title: string[]; text: string; button: string };
  cta: { primary: string; whatsapp: string; noteClosed: string; noteOpen: string };
}
export interface LeadCopy {
  kicker: string;
  title: string[];
  text: string;
  button: string;
}

/** Textos de hoy por sección (fuente única; el panel los usa como marcador). `text: null` = texto propio de la página. */
export const DEFAULT_TITLES: Record<CopySection, { kicker: string; title: string; text: string | null }> = {
  arsenal: { kicker: 'El arsenal pesado', title: 'Directo\ndel barril', text: null },
  carta: { kicker: 'La carta completa', title: 'Conócelos\ntodos', text: null },
  promos: { kicker: 'Cupones activos', title: '', text: '' },
  eventos: { kicker: 'Eventos y novedades', title: 'Lo que se\nestá cocinando', text: '' },
  resenas: { kicker: 'Prueba social', title: 'El rugido\nde la manada', text: '' },
  cobertura: { kicker: 'Domicilios', title: '¿Llegamos\na tu barrio?', text: null },
};
export const DEFAULT_FINAL = {
  kicker: '',
  title: 'El barril\nestá encendido',
  text: '',
  button: 'Pedir ahora',
};
export const DEFAULT_CTA = {
  primary: 'Pedir ahora',
  whatsapp: 'Pedir por WhatsApp',
  noteClosed: 'Solo domicilio · punto físico muy pronto',
  noteOpen: 'Domicilio y punto físico abierto',
};
export const LEAD_DEFAULTS = {
  kicker: 'Cupón de bienvenida',
  title: 'Tu primera mordida va con descuento',
  text: 'Déjanos tu nombre y celular y te damos un cupón para tu pedido.',
  button: 'Quiero mi cupón',
};

// Caracteres de control (salvo el salto de línea, que se trata aparte) y marcas invisibles de dirección.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g;

/** Corta a `max` caracteres visibles sin partir un emoji (puntos de código, no unidades UTF-16). */
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text;
}

/** Texto de un renglón: sin controles, espacios colapsados, recortado. No texto = ''. */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return cut(
    value
      .replace(/\r?\n|\r/g, ' ')
      .replace(CONTROL, '')
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  );
}

/** Título con saltos de línea: renglones limpios, sin vacíos, máximo 3; el tope cuenta todo el título. */
export function titleLines(value: unknown, max: number = COPY_LIMITS.title): string[] {
  if (typeof value !== 'string') return [];
  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(CONTROL, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  // Más de 3 renglones: los sobrantes se pegan al último (no se pierde texto).
  const kept =
    lines.length > MAX_TITLE_LINES
      ? [...lines.slice(0, MAX_TITLE_LINES - 1), lines.slice(MAX_TITLE_LINES - 1).join(' ')]
      : lines;
  const out: string[] = [];
  let left = max;
  for (const line of kept) {
    if (left <= 0) break;
    const piece = cut(line, left);
    if (piece) out.push(piece);
    left -= Array.from(piece).length;
  }
  return out;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Texto o el de por defecto si queda vacío. */
const lineOr = (value: unknown, max: number, fallback: string) => cleanLine(value, max) || fallback;
const titleOr = (value: unknown, fallback: string) => {
  const lines = titleLines(value);
  return lines.length ? lines : titleLines(fallback);
};

/** Textos del inicio desde `blocks` (null, viejo o mal formado = textos de hoy). */
export function readCopy(blocks: unknown): SiteCopy {
  const raw = record(blocks);
  const titles = record(raw.titles);
  const final = record(raw.final);
  const cta = record(raw.cta);
  const sections = Object.fromEntries(
    COPY_SECTIONS.map((key) => {
      const given = record(titles[key]);
      const base = DEFAULT_TITLES[key];
      const text = cleanLine(given.text, COPY_LIMITS.text);
      return [
        key,
        {
          kicker: lineOr(given.kicker, COPY_LIMITS.kicker, base.kicker),
          title: titleOr(given.title, base.title),
          text: text || base.text,
        },
      ];
    }),
  ) as Record<CopySection, SectionCopy>;
  return {
    titles: sections,
    final: {
      kicker: lineOr(final.kicker, COPY_LIMITS.kicker, DEFAULT_FINAL.kicker),
      title: titleOr(final.title, DEFAULT_FINAL.title),
      text: lineOr(final.text, COPY_LIMITS.text, DEFAULT_FINAL.text),
      button: lineOr(final.button, COPY_LIMITS.button, DEFAULT_FINAL.button),
    },
    cta: {
      primary: lineOr(cta.primary, COPY_LIMITS.button, DEFAULT_CTA.primary),
      whatsapp: lineOr(cta.whatsapp, COPY_LIMITS.button, DEFAULT_CTA.whatsapp),
      noteClosed: lineOr(cta.note_closed, COPY_LIMITS.note, DEFAULT_CTA.noteClosed),
      noteOpen: lineOr(cta.note_open, COPY_LIMITS.note, DEFAULT_CTA.noteOpen),
    },
  };
}

/** Nota bajo los botones del inicio: un texto sin local y otro con el local abierto (`store_open`). */
export function heroNote(copy: SiteCopy, storeOpen: boolean): string {
  return storeOpen ? copy.cta.noteOpen : copy.cta.noteClosed;
}

/** Textos del aviso del cupón de bienvenida (`events.lead_copy`, D56). */
export function readLeadCopy(raw: unknown): LeadCopy {
  const given = record(raw);
  return {
    kicker: lineOr(given.kicker, COPY_LIMITS.kicker, LEAD_DEFAULTS.kicker),
    title: titleOr(given.title, LEAD_DEFAULTS.title),
    text: lineOr(given.text, COPY_LIMITS.text, LEAD_DEFAULTS.text),
    button: lineOr(given.button, COPY_LIMITS.button, LEAD_DEFAULTS.button),
  };
}
