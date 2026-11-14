// Despacho de WhatsApp (F9, D32): lo llama pg_cron con un secreto; nunca el navegador.
// Modo prueba: arma el mensaje y lo marca "simulado" sin llamar a Meta (sin costo). Nunca registra celulares ni textos.
import { buildMessage, type WaMessage } from '../_shared/plantillas.ts';

export type Status = 'enviado' | 'simulado' | 'fallido' | 'omitido';
export type Send = { ok: true; id: string } | { ok: false; error: string };

export interface Deps {
  secret: string;
  claim: () => Promise<WaMessage[]>;
  mark: (id: string, status: Status, error?: string, providerId?: string) => Promise<void>;
  /** null = sin credenciales de Meta. */
  send: ((to: string, template: string, params: string[]) => Promise<Send>) | null;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  if (!sameSecret(request.headers.get('x-jps-cron') ?? '', deps.secret)) return json({ ok: false }, 401);
  let messages: WaMessage[];
  try {
    messages = await deps.claim();
  } catch {
    return json({ ok: false, error: 'cola' }, 500);
  }
  const summary: Record<Status, number> = { enviado: 0, simulado: 0, fallido: 0, omitido: 0 };
  for (const message of messages) {
    const built = buildMessage(message);
    let status: Status;
    let error: string | undefined;
    let providerId: string | undefined;
    if ('skip' in built) [status, error] = ['omitido', built.skip];
    else if (message.mode === 'manual') [status, error] = ['omitido', 'modo_manual'];
    else if (message.mode === 'prueba') status = 'simulado';
    else if (!deps.send) [status, error] = ['fallido', 'sin_credenciales'];
    else {
      const result = await deps
        .send(built.to, built.template, built.params)
        .catch(() => ({ ok: false, error: 'red' }) as Send);
      if (result.ok) [status, providerId] = ['enviado', result.id];
      else [status, error] = ['fallido', result.error];
    }
    await deps.mark(message.id, status, error, providerId);
    summary[status] += 1;
  }
  return json({ ok: true, ...summary }, 200);
}

const GRAPH = 'https://graph.facebook.com/v21.0';
/** Envío real con plantillas aprobadas en Meta (Cloud API). */
export function metaSender(token: string, phoneId: string, fetcher: typeof fetch = fetch) {
  return async (to: string, template: string, params: string[]): Promise<Send> => {
    const response = await fetcher(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: 'es' },
          components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { code?: number };
    };
    const id = body.messages?.[0]?.id;
    return response.ok && id
      ? { ok: true, id }
      : { ok: false, error: `meta_${body.error?.code ?? response.status}` };
  };
}
