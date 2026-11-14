/**
 * URL pública de una foto. Las que sube el panel viven en el bucket público `carta` de Supabase Storage
 * bajo la carpeta del restaurante (`<restaurant_id>/<archivo>.webp`); las de muestra, en `public/media/`.
 */
const UPLOADED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//;

export function mediaUrl(path: string | null | undefined, base: string, supabaseUrl = ''): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  if (UPLOADED.test(path) && supabaseUrl)
    return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/carta/${path}`;
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/** Medidas para reducir una foto antes de subirla (lado mayor 1200 px, sin agrandar). */
export function fitInside(width: number, height: number, max = 1200): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
