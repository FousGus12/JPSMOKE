import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
const supabaseWs = supabaseUrl.replace(/^http/, 'ws');
const supabaseHost = supabaseUrl ? new URL(supabaseUrl) : null;
// Cloudflare Turnstile (D9): solo se permite su script y su iframe si hay clave configurada.
const turnstile = env.PUBLIC_TURNSTILE_SITE_KEY ? 'https://challenges.cloudflare.com' : '';

// Sitio estático (D37): sin adaptador de servidor. La CSP de scripts y estilos la calcula Astro por hash
// en cada página; frame-ancestors y el resto de encabezados van en vercel.json.
export default defineConfig({
  site: env.SITE_URL ?? 'https://jp-smoke.vercel.app',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'directory', inlineStylesheets: 'never' },
  integrations: [react()],
  // Fotos del bucket `carta` (fotos de productos y eventos): Astro las descarga y optimiza al compilar; se sirven desde el sitio.
  image: supabaseHost
    ? {
        remotePatterns: [
          {
            protocol: supabaseHost.protocol.replace(':', ''),
            hostname: supabaseHost.hostname,
            pathname: '/storage/v1/object/public/carta/**',
          },
        ],
      }
    : {},
  vite: {
    plugins: [tailwindcss()],
    build: { sourcemap: false, assetsInlineLimit: 0 },
  },
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:" + (supabaseUrl ? ` ${supabaseUrl}` : ''),
        "font-src 'self'",
        "connect-src 'self'" + (supabaseUrl ? ` ${supabaseUrl} ${supabaseWs}` : ''),
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        ...(turnstile ? [`frame-src ${turnstile}`] : []),
      ],
      ...(turnstile ? { scriptDirective: { resources: ["'self'", turnstile] } } : {}),
    },
  },
});
