import { z } from 'zod';

/** Variables públicas (van al navegador por diseño). Nunca service_role ni tokens (CLAUDE.md). */
const schema = z.object({
  PUBLIC_SUPABASE_URL: z.url(),
  PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  // Restaurante que sirve este despliegue (D24: base compartida, un sitio por restaurante).
  PUBLIC_RESTAURANT_SLUG: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .default('jp-smoke'),
  // Fotos de la carta: bucket público `carta` en producción; `public/media` mientras tanto.
  PUBLIC_MEDIA_BASE: z.string().min(1).default('/media'),
  // Cloudflare Turnstile: vacío en local (la función acepta con TURNSTILE_SECRET=off-local).
  PUBLIC_TURNSTILE_SITE_KEY: z.string().default(''),
});

export type PublicEnv = z.infer<typeof schema>;

export function readPublicEnv(source: Record<string, unknown> = import.meta.env): PublicEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error('Faltan variables públicas de Supabase: revisa .env.local (ver .env.example).');
  }
  return parsed.data;
}
