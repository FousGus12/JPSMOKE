/**
 * Fotos adaptables (D51): versiones AVIF y WebP por tamaño, generadas al compilar con `astro:assets`.
 *
 * - Las de muestra viven en `public/media` y la base guarda su ruta (`productos/x.webp`), así que no se
 *   mueven: se describen como imagen local con sus medidas (leídas con sharp) y Astro las lee de la salida
 *   del build, donde `public/` ya está copiado. El original sigue publicado (carrito, panel, JSON-LD).
 * - Las del bucket `carta` de Supabase son remotas permitidas en `image.remotePatterns`.
 * - Cualquier otra (o si algo falla) devuelve null y el componente pinta un `<img>` simple: nunca tumba el build.
 */
import { getImage, inferRemoteSize } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { join } from 'node:path';
import sharp from 'sharp';
import { fallbackWidth, photoHeight, photoWidths, type PhotoSize } from '../core/photo';
/** Formatos en orden de preferencia. Si el build se vuelve lento, dejar solo 'webp' (D51). */
const FORMATS = ['avif', 'webp'] as const;

export interface PhotoPreset {
  /** Anchos deseados en px (se filtran para no pasar del original). */
  widths: readonly number[];
  /** Atributo `sizes`: ancho real en pantalla según sitio.css. */
  sizes: string;
  /** Recorte ancho / alto cuando la caja lo impone (object-fit: cover). */
  ratio?: number;
}

export interface ResponsivePhoto {
  src: string;
  width: number;
  height: number;
  sizes: string;
  sources: Array<{ type: string; srcset: string }>;
}

type Source = { kind: 'local'; meta: ImageMetadata } | { kind: 'remote'; url: string; size: PhotoSize };

const LOCAL_FORMATS = new Set(['webp', 'jpeg', 'jpg', 'png', 'avif']);

async function describe(url: string): Promise<Source | null> {
  if (/^https?:\/\//.test(url)) {
    const size = await inferRemoteSize(url);
    return size.width && size.height ? { kind: 'remote', url, size } : null;
  }
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  const file = join(process.cwd(), 'public', decodeURIComponent(url.split('?')[0] ?? ''));
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height || !meta.format || !LOCAL_FORMATS.has(meta.format)) return null;
  return {
    kind: 'local',
    meta: {
      src: url,
      width: meta.width,
      height: meta.height,
      format: meta.format as ImageMetadata['format'],
    },
  };
}

async function build(url: string, preset: PhotoPreset): Promise<ResponsivePhoto | null> {
  const source = await describe(url);
  if (!source) return null;
  const original = source.kind === 'local' ? source.meta : source.size;
  const widths = photoWidths(original, preset.widths, preset.ratio);
  if (widths.length === 0) return null;
  const width = fallbackWidth(widths);
  const height = photoHeight(width, original, preset.ratio);
  const common = {
    src: source.kind === 'local' ? source.meta : source.url,
    width,
    height,
    widths,
    sizes: preset.sizes,
    ...(preset.ratio ? { fit: 'cover' as const } : {}),
  };
  const results = await Promise.all(FORMATS.map((format) => getImage({ ...common, format })));
  // Remota no permitida: Astro devuelve la URL original sin transformar.
  if (results.some((result) => result.src === url)) return null;
  const fallback = results.at(-1);
  if (!fallback) return null;
  return {
    src: fallback.src,
    width,
    height,
    sizes: preset.sizes,
    sources: results.map((result, i) => ({ type: `image/${FORMATS[i]}`, srcset: result.srcSet.attribute })),
  };
}

const cache = new Map<string, Promise<ResponsivePhoto | null>>();

/** Versiones de una foto para `<picture>`; null si no se puede optimizar (se usa la URL tal cual). */
export function responsivePhoto(
  url: string | null | undefined,
  preset: PhotoPreset,
): Promise<ResponsivePhoto | null> {
  if (!url) return Promise.resolve(null);
  const key = `${url}|${preset.widths.join(',')}|${preset.ratio ?? ''}|${preset.sizes}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = build(url, preset).catch((error: unknown) => {
      console.warn(
        `[images] sin versiones para ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    });
    cache.set(key, hit);
  }
  return hit;
}

/** Miniatura para el navegador (carrito y selector de adiciones, D56): WebP cuadrado de 96 y 192 px. */
export interface Thumb {
  src: string;
  srcset: string;
}
const THUMB_WIDTHS = [96, 192] as const;

async function buildThumb(url: string): Promise<Thumb | null> {
  const source = await describe(url);
  if (!source) return null;
  const original = source.kind === 'local' ? source.meta : source.size;
  const widths = photoWidths(original, THUMB_WIDTHS, 1);
  if (widths.length === 0) return null;
  const width = Math.min(...widths);
  const result = await getImage({
    src: source.kind === 'local' ? source.meta : source.url,
    width,
    height: width,
    widths,
    fit: 'cover',
    format: 'webp',
  });
  if (result.src === url) return null; // remota no permitida: sin versiones
  return { src: result.src, srcset: result.srcSet.attribute };
}

const thumbCache = new Map<string, Promise<Thumb | null>>();

/** Miniatura de una foto de la carta; null si no se puede optimizar (el navegador usa la original). */
export function thumbnail(url: string | null | undefined): Promise<Thumb | null> {
  if (!url) return Promise.resolve(null);
  let hit = thumbCache.get(url);
  if (!hit) {
    hit = buildThumb(url).catch((error: unknown) => {
      console.warn(
        `[images] sin miniatura para ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    });
    thumbCache.set(url, hit);
  }
  return hit;
}

/** Usos del sitio. Los `sizes` siguen a sitio.css; si cambia el CSS, ajustarlos. */
export const PHOTO = {
  /** Fotos del inicio (.hcard, 4:5). Celular: --cw = min((100vw − 2·gutter) / 3.75, 21svh, 190px). */
  hero: {
    widths: [160, 320, 480, 800],
    ratio: 4 / 5,
    sizes:
      '(max-width: 760px) min(24.5vw, 190px), (pointer: coarse) min(24.5vw, 190px), clamp(150px, 21vw, 320px)',
  },
  /** Destacados (.pcard, 1:1): grid-auto-columns clamp(270px, 30vw, 380px). */
  card: { widths: [320, 480, 800], ratio: 1, sizes: 'clamp(270px, 30vw, 380px)' },
  /** Miniaturas de la carta (.item-img, 1:1): 112 px, 92 px en celular. */
  thumb: { widths: [160, 320], ratio: 1, sizes: '(max-width: 760px) 92px, 112px' },
  /** Promoción principal: columna 1.4fr de 2.4fr; una sola columna hasta 860 px. */
  promo: { widths: [320, 480, 800], sizes: '(max-width: 860px) 92vw, 56vw' },
  /** Recorrido / eventos privados: dos columnas desde 861 px. */
  tour: { widths: [320, 480, 800], sizes: '(max-width: 860px) 92vw, 46vw' },
  /** Bienvenida a pantalla completa. */
  intro: { widths: [480, 800], sizes: '100vw' },
} satisfies Record<string, PhotoPreset>;

/** Eventos: rejilla auto-fit de columnas ≥ 280 px; con uno solo ocupa todo el ancho. */
export function eventPreset(count: number): PhotoPreset {
  return {
    widths: [320, 480, 800],
    sizes:
      count <= 1 ? '92vw' : `(max-width: 640px) 92vw, (max-width: 960px) 46vw, ${count === 2 ? 46 : 31}vw`,
  };
}
