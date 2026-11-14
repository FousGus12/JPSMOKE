// Seguimiento sin cuenta (D21). Con enlace único (código + token) o con código + últimos 4 dígitos
// del celular; esta segunda vía tiene límite de intentos por IP. Devuelve solo estado y resumen.
import { seguimientoSchema } from '../_shared/pedido.ts';
import { hashIp, json, prelude, type Rpc } from '../_shared/publico.ts';

export interface Deps {
  rpc: Rpc;
  allowedOrigins: string[];
  salt: string;
  maxLookupsPerHour: number;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const pre = await prelude(request, deps.allowedOrigins, 1024);
  if (!pre.ok) return pre.response;
  const { cors, ip } = pre;
  const parsed = seguimientoSchema.safeParse(pre.body);
  if (!parsed.success) return json({ ok: false, error: 'no_encontrado' }, 404, cors);
  const query = parsed.data;

  const key = `seguir:ip:${await hashIp(ip, deps.salt)}`;
  if ('last4' in query) {
    // Solo cuentan los fallos: la página puede consultar su pedido cada 15 s; adivinar sigue limitado.
    const { data: used } = await deps.rpc('rate_count', { p_key: key, p_seconds: 3600 });
    if (typeof used !== 'number' || used >= deps.maxLookupsPerHour)
      return json({ ok: false, error: 'demasiados_intentos' }, 429, cors);
  }
  const { data, error } =
    'last4' in query
      ? await deps.rpc('track_order_by_phone', {
          p_restaurant: query.restaurant,
          p_code: query.code,
          p_last4: query.last4,
        })
      : await deps.rpc('track_order', {
          p_restaurant: query.restaurant,
          p_code: query.code,
          p_token: query.token,
        });
  if (!error && !data && 'last4' in query)
    await deps.rpc('rate_hit', { p_key: key, p_max: deps.maxLookupsPerHour, p_seconds: 3600 });
  if (error) {
    console.error('seguimiento falló', error.message);
    return json({ ok: false, error: 'error' }, 500, cors);
  }
  if (!data) return json({ ok: false, error: 'no_encontrado' }, 404, cors);
  return json({ ok: true, order: data }, 200, cors);
}
