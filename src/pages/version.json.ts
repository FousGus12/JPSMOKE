import type { APIRoute } from 'astro';

// D67: id de la compilación (ver astro.config.mjs). Prerenderizado: cambia solo con un despliegue nuevo.
// vercel.json lo sirve sin caché para que el panel vea el cambio al momento.
export const prerender = true;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ id: import.meta.env.PUBLIC_BUILD_ID ?? '' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
