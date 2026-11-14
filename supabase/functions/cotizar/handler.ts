// Cotización de eventos privados (F7, JP on Tour): campo trampa, Turnstile y límite por IP;
// la base limita 3 solicitudes al día por celular y guarda la autorización de datos.
import { cotizarSchema, CONSENT_VERSION } from '../_shared/pedido.ts';
import { hashIp, json, prelude, type Rpc, type VerifyTurnstile } from '../_shared/publico.ts';

export interface Deps {
  rpc: Rpc;
  verifyTurnstile: VerifyTurnstile;
  allowedOrigins: string[];
  salt: string;
  maxPerHourIp: number;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const pre = await prelude(request, deps.allowedOrigins, 4096);
  if (!pre.ok) return pre.response;
  const { cors, ip } = pre;
  const parsed = cotizarSchema.safeParse(pre.body);
  if (!parsed.success) return json({ ok: false, error: 'datos_invalidos' }, 400, cors);
  const { sitio_web: honeypot, turnstile, acepta_datos: _ok, ...quote } = parsed.data;
  if (honeypot || !(await deps.verifyTurnstile(turnstile, ip))) {
    await deps.rpc('register_blocked', { p_restaurant: quote.restaurant, p_reason: 'robot' });
    return json({ ok: false, error: 'error' }, 422, cors);
  }
  const { data: allowed } = await deps.rpc('rate_hit', {
    p_key: `cotizar:ip:${await hashIp(ip, deps.salt)}`,
    p_max: deps.maxPerHourIp,
    p_seconds: 3600,
  });
  if (allowed !== true) return json({ ok: false, error: 'demasiados_intentos' }, 429, cors);
  const { data, error } = await deps.rpc('submit_quote', {
    p: { ...quote, consent_version: CONSENT_VERSION },
  });
  if (error || !data || typeof data !== 'object') return json({ ok: false, error: 'error' }, 500, cors);
  const result = data as { ok: boolean; reason?: string };
  if (!result.ok)
    return json(
      { ok: false, error: result.reason === 'repetido' ? 'demasiados_intentos' : 'datos_invalidos' },
      422,
      cors,
    );
  return json({ ok: true }, 201, cors);
}
