import type { APIRoute } from 'astro';

// Nada se indexa hasta el lanzamiento (F10); el panel nunca.
export const GET: APIRoute = ({ site }) => {
  const indexable = import.meta.env.SITE_INDEXABLE === 'true';
  const body = indexable
    ? `User-agent: *\nDisallow: /panel\nSitemap: ${new URL('/sitemap.xml', site).href}\n`
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
