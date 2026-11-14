// CORS compartido por las funciones de JP Smoke.
/**
 * "local" = cualquier puerto de localhost (lección de GMDevz); "*" vale por un segmento sin puntos
 * (vistas previas de Vercel). En remoto, la lista explícita del secreto CORS_ALLOWED_ORIGINS.
 */
export function originMatches(origin: string, entry: string): boolean {
  if (entry === 'local') return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
  if (!entry.includes('*')) return origin === entry;
  const escaped = entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'));
  return new RegExp(`^${escaped.join('[a-z0-9-]+')}$`).test(origin);
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin !== null && allowed.some((entry) => originMatches(origin, entry));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
