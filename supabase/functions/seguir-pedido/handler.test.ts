import { assertEquals } from '@std/assert';
import { envLimit } from '../_shared/publico.ts';
import { handle, type Deps } from './handler.ts';

const order = { code: 'JP-0001', status: 'en_cocina' };
function deps(over: Partial<Deps> = {}, calls: string[] = []): Deps {
  return {
    rpc: (fn) => {
      calls.push(fn);
      if (fn === 'rate_hit') return Promise.resolve({ data: true, error: null });
      if (fn === 'rate_count') return Promise.resolve({ data: 0, error: null });
      return Promise.resolve({ data: order, error: null });
    },
    allowedOrigins: ['local'],
    salt: 'test',
    maxLookupsPerHour: 10,
    ...over,
  };
}
const post = (body: unknown) =>
  new Request('http://x/seguir-pedido', {
    method: 'POST',
    headers: { origin: 'http://localhost:4331' },
    body: JSON.stringify(body),
  });

Deno.test('con enlace único: no gasta intentos y devuelve el pedido', async () => {
  const calls: string[] = [];
  const res = await handle(
    post({ restaurant: 'jp-smoke', code: 'jp-0001', token: 'abcdefghijklmnop1234' }),
    deps({}, calls),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).order, order);
  assertEquals(calls, ['track_order']);
});

Deno.test('con últimos 4 dígitos correctos: revisa el límite pero no lo gasta', async () => {
  const calls: string[] = [];
  await handle(post({ restaurant: 'jp-smoke', code: 'JP-0001', last4: '1234' }), deps({}, calls));
  assertEquals(calls, ['rate_count', 'track_order_by_phone']);
});

Deno.test('con 4 dígitos equivocados: cuenta el fallo', async () => {
  const calls: string[] = [];
  const res = await handle(
    post({ restaurant: 'jp-smoke', code: 'JP-0001', last4: '9999' }),
    deps({
      rpc: (fn) => (
        calls.push(fn),
        Promise.resolve({ data: fn === 'rate_count' ? 0 : fn === 'rate_hit' ? true : null, error: null })
      ),
    }),
  );
  assertEquals(res.status, 404);
  assertEquals(calls, ['rate_count', 'track_order_by_phone', 'rate_hit']);
});

Deno.test('10 fallos en la hora: 429 sin consultar', async () => {
  const calls: string[] = [];
  const res = await handle(
    post({ restaurant: 'jp-smoke', code: 'JP-0001', last4: '1234' }),
    deps({ rpc: (fn) => (calls.push(fn), Promise.resolve({ data: 10, error: null })) }),
  );
  assertEquals(res.status, 429);
  assertEquals(calls, ['rate_count']);
});

Deno.test('no existe o token corto: 404 igual (no revela nada)', async () => {
  assertEquals(
    (await handle(post({ restaurant: 'jp-smoke', code: 'JP-0001', token: 'corto' }), deps())).status,
    404,
  );
  const none = deps({ rpc: () => Promise.resolve({ data: null, error: null }) });
  assertEquals(
    (await handle(post({ restaurant: 'jp-smoke', code: 'JP-0001', token: 'abcdefghijklmnop1234' }), none))
      .status,
    404,
  );
});

Deno.test('envLimit: valores inválidos usan el límite seguro (auditoría)', () => {
  assertEquals(envLimit(undefined, 10), 10);
  assertEquals(envLimit('abc', 10), 10);
  assertEquals(envLimit('0', 10), 10);
  assertEquals(envLimit('25', 10), 25);
});
