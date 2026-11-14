import { assertEquals } from '@std/assert';
import { buildMessage, safeName, type WaMessage } from '../_shared/plantillas.ts';
import { handle, metaSender, type Deps, type Status } from './handler.ts';

const order = {
  code: 'JP-0001',
  status: 'nuevo',
  name: 'Ana',
  phone: '3105551234',
  total: 45000,
  items: 2,
  zone: 'Engativá',
  channel: 'web',
};
const base: WaMessage = {
  id: 'm1',
  kind: 'pedido_recibido',
  mode: 'prueba',
  restaurant: 'JP Smoke',
  site_url: 'https://jp-smoke.vercel.app',
  business_phone: '573001234567',
  eta: '35–50 min',
  order,
  report: null,
};
function deps(messages: WaMessage[], over: Partial<Deps> = {}) {
  const marks: Array<[string, Status, string | undefined]> = [];
  const d: Deps = {
    secret: 's3cr3t',
    claim: () => Promise.resolve(messages),
    mark: (id, status, error) => (marks.push([id, status, error]), Promise.resolve()),
    send: null,
    ...over,
  };
  return { d, marks };
}
const post = (secret = 's3cr3t') =>
  new Request('http://x/whatsapp', { method: 'POST', headers: { 'x-jps-cron': secret } });

Deno.test('plantilla de pedido recibido con enlace por código (sin token)', () => {
  const built = buildMessage(base);
  if ('skip' in built) throw new Error('no debía omitirse');
  assertEquals(built.to, '573105551234');
  assertEquals(built.params, [
    'Ana',
    'JP-0001',
    '$45.000',
    '35–50 min',
    'https://jp-smoke.vercel.app/pedido?c=JP-0001',
  ]);
});
Deno.test('aviso al negocio va al WhatsApp del negocio', () => {
  const built = buildMessage({ ...base, kind: 'aviso_negocio' });
  assertEquals('skip' in built ? built.skip : built.to, '573001234567');
});
Deno.test('pedido cancelado no envía "va en camino"', () => {
  assertEquals(buildMessage({ ...base, kind: 'en_camino', order: { ...order, status: 'cancelado' } }), {
    skip: 'cancelado',
  });
});
Deno.test('sin secreto correcto: 401 sin tocar la cola', async () => {
  let claimed = false;
  const { d } = deps([base], { claim: () => ((claimed = true), Promise.resolve([])) });
  assertEquals((await handle(post('otro'), d)).status, 401);
  assertEquals(claimed, false);
});
Deno.test('modo prueba: simula sin llamar a Meta', async () => {
  let sent = false;
  const { d, marks } = deps([base], { send: () => ((sent = true), Promise.resolve({ ok: true, id: 'x' })) });
  await handle(post(), d);
  assertEquals(marks, [['m1', 'simulado', undefined]]);
  assertEquals(sent, false);
});
Deno.test('modo activo sin credenciales: fallido, no inventa un envío', async () => {
  const { d, marks } = deps([{ ...base, mode: 'activo' }]);
  await handle(post(), d);
  assertEquals(marks, [['m1', 'fallido', 'sin_credenciales']]);
});
Deno.test('modo activo con Meta: enviado', async () => {
  const fake = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }),
    )) as typeof fetch;
  const { d, marks } = deps([{ ...base, mode: 'activo' }], { send: metaSender('tok', 'phone', fake) });
  await handle(post(), d);
  assertEquals(marks[0]?.[1], 'enviado');
});
Deno.test('Meta rechaza: fallido con código', async () => {
  const fake = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { code: 131026 } }), { status: 400 }),
    )) as typeof fetch;
  const { d, marks } = deps([{ ...base, mode: 'activo' }], { send: metaSender('tok', 'phone', fake) });
  await handle(post(), d);
  assertEquals(marks[0], ['m1', 'fallido', 'meta_131026']);
});

Deno.test('safeName deja solo un primer nombre seguro (auditoría)', () => {
  assertEquals(safeName('bit.ly/pago-jp\n\nURGENTE'), 'bit.ly');
  assertEquals(safeName('María José'), 'María');
  assertEquals(safeName('https://x.co'), 'https');
  assertEquals(safeName(''), 'cliente');
});
