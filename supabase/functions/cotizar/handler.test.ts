import { assertEquals } from '@std/assert';
import { handle, type Deps } from './handler.ts';

const valid = {
  restaurant: 'jp-smoke',
  kind: 'Catering al barril',
  name: 'Ana',
  phone: '3105551234',
  event_date: '2026-12-12',
  guests: '40',
  message: 'Cumpleaños en casa',
  acepta_datos: true,
};
function deps(over: Partial<Deps> = {}, calls: string[] = []): Deps {
  return {
    rpc: (fn) => {
      calls.push(fn);
      return Promise.resolve({ data: fn === 'rate_hit' ? true : { ok: true }, error: null });
    },
    verifyTurnstile: () => Promise.resolve(true),
    allowedOrigins: ['local'],
    salt: 't',
    maxPerHourIp: 5,
    ...over,
  };
}
const post = (body: unknown) =>
  new Request('http://x/cotizar', {
    method: 'POST',
    headers: { origin: 'http://localhost:4331' },
    body: JSON.stringify(body),
  });

Deno.test('guarda la solicitud', async () => {
  const calls: string[] = [];
  assertEquals((await handle(post(valid), deps({}, calls))).status, 201);
  assertEquals(calls, ['rate_hit', 'submit_quote']);
});
Deno.test('sin autorización o datos malos: 400', async () => {
  assertEquals((await handle(post({ ...valid, acepta_datos: false }), deps())).status, 400);
  assertEquals((await handle(post({ ...valid, kind: 'Boda' }), deps())).status, 400);
});
Deno.test('robot: no guarda', async () => {
  const calls: string[] = [];
  assertEquals((await handle(post({ ...valid, sitio_web: 'x' }), deps({}, calls))).status, 422);
  assertEquals(calls, ['register_blocked']);
});
Deno.test('demasiadas del mismo celular: 422', async () => {
  const res = await handle(
    post(valid),
    deps({
      rpc: (fn) =>
        Promise.resolve({ data: fn === 'rate_hit' ? true : { ok: false, reason: 'repetido' }, error: null }),
    }),
  );
  assertEquals((await res.json()).error, 'demasiados_intentos');
});
