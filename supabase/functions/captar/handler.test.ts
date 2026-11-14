import { assertEquals } from '@std/assert';
import { handle, type Deps } from './handler.ts';

const valid = {
  restaurant: 'jp-smoke',
  event_id: '00000000-0000-4000-8000-000000000003',
  name: 'Gus',
  phone: '3105551234',
  acepta_datos: true,
  turnstile: 'ok',
};
function deps(over: Partial<Deps> = {}): Deps {
  return {
    rpc: (fn) =>
      Promise.resolve({
        data: fn === 'rate_hit' ? true : { ok: true, coupon: 'BIENVENIDA10', title: '10%' },
        error: null,
      }),
    verifyTurnstile: () => Promise.resolve(true),
    allowedOrigins: ['local'],
    salt: 'test',
    maxPerHourIp: 5,
    ...over,
  };
}
const post = (body: unknown) =>
  new Request('http://x/captar', {
    method: 'POST',
    headers: { origin: 'http://localhost:4331' },
    body: JSON.stringify(body),
  });

Deno.test('entrega el cupón', async () => {
  const res = await handle(post(valid), deps());
  assertEquals(await res.json(), { ok: true, coupon: 'BIENVENIDA10', title: '10%' });
});
Deno.test('sin autorización de datos: 400', async () => {
  assertEquals((await handle(post({ ...valid, acepta_datos: false }), deps())).status, 400);
});
Deno.test('celular ya registrado', async () => {
  const res = await handle(
    post(valid),
    deps({
      rpc: (fn) =>
        Promise.resolve({
          data: fn === 'rate_hit' ? true : { ok: false, reason: 'ya_registrado' },
          error: null,
        }),
    }),
  );
  assertEquals((await res.json()).error, 'ya_registrado');
});
Deno.test('robot: no capta', async () => {
  const res = await handle(post({ ...valid, sitio_web: 'x' }), deps());
  assertEquals(res.status, 422);
});
