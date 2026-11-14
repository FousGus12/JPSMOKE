// Crear pedido web (D9, D15, D21). Capas: CORS, tamaño, Zod, campo trampa, tiempo mínimo, Turnstile,
// límite por IP y, en la base, límite por celular, bloqueos, zona, horario y precios recalculados.
import { mensajesPedido, pedidoSchema, CONSENT_VERSION, type PedidoError } from '../_shared/pedido.ts';
import { hashIp, json, newTrackToken, prelude, type Rpc, type VerifyTurnstile } from '../_shared/publico.ts';

export interface Deps {
  rpc: Rpc;
  verifyTurnstile: VerifyTurnstile;
  allowedOrigins: string[];
  salt: string;
  minFillMs: number;
  maxPerHourIp: number;
  newToken?: () => string;
}

const STATUS: Partial<Record<PedidoError, number>> = { datos_invalidos: 400, error: 500 };

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const pre = await prelude(request, deps.allowedOrigins, 8192);
  if (!pre.ok) return pre.response;
  const { cors, ip } = pre;
  const fail = (reason: PedidoError) =>
    json({ ok: false, error: reason, message: mensajesPedido[reason] }, STATUS[reason] ?? 422, cors);

  const parsed = pedidoSchema.safeParse(pre.body);
  if (!parsed.success) return fail('datos_invalidos');
  const { sitio_web: honeypot, turnstile, elapsed_ms: elapsed, acepta_datos: _ok, ...order } = parsed.data;

  const block = async (reason: 'robot' | 'repetido') => {
    await deps.rpc('register_blocked', { p_restaurant: order.restaurant, p_reason: reason });
    return fail(reason);
  };
  if (honeypot || elapsed < deps.minFillMs) return block('robot');
  if (!(await deps.verifyTurnstile(turnstile, ip))) return block('robot');
  const ipKey = `pedido:ip:${await hashIp(ip, deps.salt)}`;
  const { data: allowed, error: rateError } = await deps.rpc('rate_hit', {
    p_key: ipKey,
    p_max: deps.maxPerHourIp,
    p_seconds: 3600,
  });
  if (rateError) return fail('error');
  if (allowed !== true) return block('repetido');

  const token = (deps.newToken ?? newTrackToken)();
  const { data, error } = await deps.rpc('place_order', {
    p: { ...order, token, consent_version: CONSENT_VERSION },
  });
  if (error || !data || typeof data !== 'object') {
    console.error('place_order falló', error?.message);
    return fail('error');
  }
  const result = data as {
    ok: boolean;
    reason?: PedidoError;
    code?: string;
    total?: number;
    product?: string;
  };
  if (!result.ok) {
    if (result.reason === 'agotado' && result.product) {
      return json(
        {
          ok: false,
          error: 'agotado',
          message: `Se agotó ${result.product}. Quítalo de tu pedido o cámbialo.`,
        },
        422,
        cors,
      );
    }
    return fail(result.reason && result.reason in mensajesPedido ? result.reason : 'error');
  }
  return json({ ok: true, code: result.code, token, total: result.total }, 201, cors);
}
