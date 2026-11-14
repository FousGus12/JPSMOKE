// Captación con el aviso de bienvenida (D16, D22): nombre y celular a cambio de un cupón.
// Campo trampa, Turnstile y límite por IP; la base evita duplicados por celular.
import { captarSchema, CONSENT_VERSION } from '../_shared/pedido.ts';
import { hashIp, json, prelude, type Rpc, type VerifyTurnstile } from '../_shared/publico.ts';

export interface Deps {
  rpc: Rpc;
  verifyTurnstile: VerifyTurnstile;
  allowedOrigins: string[];
  salt: string;
  maxPerHourIp: number;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const pre = await prelude(request, deps.allowedOrigins, 2048);
  if (!pre.ok) return pre.response;
  const { cors, ip } = pre;
  const parsed = captarSchema.safeParse(pre.body);
  if (!parsed.success) return json({ ok: false, error: 'datos_invalidos' }, 400, cors);
  const data = parsed.data;
  if (data.sitio_web || !(await deps.verifyTurnstile(data.turnstile, ip))) {
    await deps.rpc('register_blocked', { p_restaurant: data.restaurant, p_reason: 'robot' });
    return json({ ok: false, error: 'error' }, 422, cors);
  }
  const { data: allowed } = await deps.rpc('rate_hit', {
    p_key: `captar:ip:${await hashIp(ip, deps.salt)}`,
    p_max: deps.maxPerHourIp,
    p_seconds: 3600,
  });
  if (allowed !== true) return json({ ok: false, error: 'demasiados_intentos' }, 429, cors);
  const { data: result, error } = await deps.rpc('capture_lead', {
    p_restaurant: data.restaurant,
    p_event: data.event_id,
    p_name: data.name,
    p_phone: data.phone,
    p_consent_version: CONSENT_VERSION,
  });
  if (error || !result || typeof result !== 'object') return json({ ok: false, error: 'error' }, 500, cors);
  const res = result as { ok: boolean; reason?: string; coupon?: string; title?: string };
  if (!res.ok)
    return json(
      { ok: false, error: res.reason === 'ya_registrado' ? 'ya_registrado' : 'datos_invalidos' },
      422,
      cors,
    );
  return json({ ok: true, coupon: res.coupon, title: res.title }, 201, cors);
}
