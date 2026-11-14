// Utilidades de las funciones públicas: respuestas, tamaño, IP con sal, Turnstile y token del enlace único.
// Nunca devuelven detalles internos (§7, A10).
import { corsHeaders } from './cors.ts';

export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export type Prelude =
  { ok: true; body: unknown; cors: Record<string, string>; ip: string } | { ok: false; response: Response };

/** CORS, método, tamaño y JSON. */
export async function prelude(
  request: Request,
  allowedOrigins: string[],
  maxBytes: number,
): Promise<Prelude> {
  const cors = corsHeaders(request.headers.get('origin'), allowedOrigins);
  if (request.method === 'OPTIONS')
    return { ok: false, response: new Response(null, { status: 204, headers: cors }) };
  if (request.method !== 'POST')
    return { ok: false, response: json({ ok: false, error: 'error' }, 405, cors) };
  if (!cors['Access-Control-Allow-Origin'])
    return { ok: false, response: json({ ok: false, error: 'error' }, 403, cors) };
  const raw = await request.text();
  if (raw.length > maxBytes)
    return { ok: false, response: json({ ok: false, error: 'datos_invalidos' }, 413, cors) };
  try {
    const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'sin-ip';
    return { ok: true, body: JSON.parse(raw), cors, ip };
  } catch {
    return { ok: false, response: json({ ok: false, error: 'datos_invalidos' }, 400, cors) };
  }
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/** Token del enlace único (D21): 18 bytes aleatorios en base64url (144 bits). La base guarda solo su hash. */
export function newTrackToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export type VerifyTurnstile = (token: string, ip: string) => Promise<boolean>;

/**
 * Cloudflare Turnstile. Sin secreto configurado solo se permite en local (TURNSTILE_SECRET=off-local);
 * en remoto un secreto vacío rechaza todo, para no publicar sin la protección.
 */
export function turnstileVerifier(secret: string): VerifyTurnstile {
  if (secret === 'off-local') return () => Promise.resolve(true);
  return async (token, ip) => {
    if (!secret || !token) return false;
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip !== 'sin-ip') form.append('remoteip', ip);
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  };
}

export type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Límite por hora desde el entorno: si falta o no es un entero positivo, usa el valor seguro (auditoría 2026-11-02). */
export function envLimit(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
