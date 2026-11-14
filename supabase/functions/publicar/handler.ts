// Publicar el sitio (F6): la base valida admin con dos pasos y la pausa de un minuto; luego se llama
// el deploy hook de Vercel del restaurante (base compartida, D24: un proyecto de Vercel por restaurante).
// Nunca devuelve detalles internos ni la URL del hook (§7).
import { corsHeaders } from '../_shared/cors.ts';

type Result = PromiseLike<{ data: unknown; error: { message: string; code?: string; hint?: string } | null }>;

export interface Deps {
  publish: (authorization: string) => Result;
  unmark: (authorization: string) => Result;
  callHook: (slug: string) => Promise<boolean>;
  allowedOrigins: string[];
}

export type PublishError = 'sin_permiso' | 'muy_seguido' | 'deploy_hook' | 'error';

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'), deps.allowedOrigins);
  const fail = (error: PublishError, status: number) => json({ ok: false, error }, status, cors);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail('error', 405);
  if (!cors['Access-Control-Allow-Origin']) return fail('error', 403);
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) return fail('sin_permiso', 401);

  const { data, error } = await deps.publish(authorization);
  if (error) {
    if (error.code === '42501') return fail('sin_permiso', 403);
    if (error.hint === 'muy_seguido') return fail('muy_seguido', 429);
    return fail('error', 500);
  }
  const result = (data ?? {}) as { published_at?: string; slug?: string };
  let hookOk = false;
  try {
    hookOk = await deps.callHook(result.slug ?? '');
  } catch {
    hookOk = false;
  }
  if (!hookOk) {
    await deps.unmark(authorization);
    return fail('deploy_hook', 502);
  }
  return json({ ok: true, published_at: result.published_at ?? new Date().toISOString() }, 200, cors);
}

/** Hooks por restaurante: secreto VERCEL_DEPLOY_HOOKS = {"jp-smoke":"https://api.vercel.com/v1/integrations/deploy/..."} */
export function hookFor(slug: string, hooksJson: string): string | null {
  try {
    const hooks = JSON.parse(hooksJson || '{}') as Record<string, string>;
    const url = hooks[slug];
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  } catch {
    return null;
  }
}
