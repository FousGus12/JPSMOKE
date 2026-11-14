import { assertEquals } from '@std/assert';
import { handle, type Deps } from './handler.ts';

const ZONE = '00000000-0000-4000-8000-000000000001';
const PRODUCT = '00000000-0000-4000-8000-000000000002';
const valid = {
  restaurant: 'jp-smoke',
  customer: {
    name: 'Gustavo Prueba',
    phone: '310 555 1234',
    address: 'Calle 68 # 60-71',
    barrio: 'Normandía',
    zone_id: ZONE,
  },
  payment_code: 'nequi',
  items: [{ product_id: PRODUCT, qty: 2, combo: true }],
  acepta_datos: true,
  elapsed_ms: 9000,
  turnstile: 'ok',
  sitio_web: '',
};

function deps(over: Partial<Deps> = {}, calls: Array<[string, Record<string, unknown>]> = []): Deps {
  return {
    rpc: (fn, args) => {
      calls.push([fn, args]);
      if (fn === 'rate_hit') return Promise.resolve({ data: true, error: null });
      if (fn === 'place_order')
        return Promise.resolve({ data: { ok: true, code: 'JP-0001', total: 85000 }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    verifyTurnstile: () => Promise.resolve(true),
    allowedOrigins: ['local'],
    salt: 'test',
    minFillMs: 4000,
    maxPerHourIp: 10,
    newToken: () => 'TOKEN-de-prueba-1234',
    ...over,
  };
}
const post = (body: unknown, origin = 'http://127.0.0.1:4331') =>
  new Request('http://x/crear-pedido', { method: 'POST', headers: { origin }, body: JSON.stringify(body) });

Deno.test('pedido válido: crea y devuelve código y token del enlace único', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const res = await handle(post(valid), deps({}, calls));
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { ok: true, code: 'JP-0001', token: 'TOKEN-de-prueba-1234', total: 85000 });
  const place = calls.find(([fn]) => fn === 'place_order')!;
  const p = place[1].p as Record<string, unknown>;
  assertEquals((p.customer as Record<string, unknown>).phone, '3105551234');
  assertEquals('turnstile' in p || 'sitio_web' in p || 'elapsed_ms' in p, false);
});

Deno.test('nunca envía precios del navegador a la base', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  await handle(
    post({ ...valid, total: 1, items: [{ product_id: PRODUCT, qty: 1, combo: false, unit: 1 }] }),
    deps({}, calls),
  );
  const p = calls.find(([fn]) => fn === 'place_order')![1].p as Record<string, unknown>;
  assertEquals('total' in p, false);
  assertEquals((p.items as Array<Record<string, unknown>>)[0], { product_id: PRODUCT, qty: 1, combo: false });
});

Deno.test('campo trampa lleno: robot, no crea pedido y lo cuenta', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const res = await handle(post({ ...valid, sitio_web: 'spam' }), deps({}, calls));
  assertEquals(res.status, 422);
  assertEquals(
    calls.map(([fn]) => fn),
    ['register_blocked'],
  );
});

Deno.test('formulario llenado en menos del tiempo mínimo: robot', async () => {
  const res = await handle(post({ ...valid, elapsed_ms: 900 }), deps());
  assertEquals((await res.json()).error, 'robot');
});

Deno.test('Turnstile falla: robot con mensaje genérico', async () => {
  const res = await handle(post(valid), deps({ verifyTurnstile: () => Promise.resolve(false) }));
  const body = await res.json();
  assertEquals(body.error, 'robot');
  assertEquals(body.message.includes('Turnstile'), false);
});

Deno.test('límite por IP superado: repetido', async () => {
  const res = await handle(
    post(valid),
    deps({ rpc: (fn) => Promise.resolve({ data: fn === 'rate_hit' ? false : null, error: null }) }),
  );
  assertEquals((await res.json()).error, 'repetido');
});

Deno.test('celular inválido o sin autorización: datos inválidos', async () => {
  assertEquals(
    (await handle(post({ ...valid, customer: { ...valid.customer, phone: '123' } }), deps())).status,
    400,
  );
  assertEquals((await handle(post({ ...valid, acepta_datos: false }), deps())).status, 400);
});

Deno.test('motivo de la base se traduce a mensaje para el cliente', async () => {
  const res = await handle(
    post(valid),
    deps({
      rpc: (fn) =>
        Promise.resolve({
          data: fn === 'rate_hit' ? true : { ok: false, reason: 'fuera_de_zona' },
          error: null,
        }),
    }),
  );
  const body = await res.json();
  assertEquals(body.error, 'fuera_de_zona');
  assertEquals(body.message, 'Todavía no llegamos a esa localidad.');
});

Deno.test('origen no permitido: 403', async () => {
  assertEquals((await handle(post(valid, 'https://otro.com'), deps())).status, 403);
});

Deno.test('cuerpo demasiado grande: 413', async () => {
  const big = { ...valid, customer: { ...valid.customer, notes: 'x'.repeat(9000) } };
  assertEquals((await handle(post(big), deps())).status, 413);
});

Deno.test('error de la base: mensaje genérico sin detalles internos', async () => {
  const res = await handle(
    post(valid),
    deps({
      rpc: (fn) =>
        Promise.resolve(
          fn === 'rate_hit' ? { data: true, error: null } : { data: null, error: { message: 'relation x' } },
        ),
    }),
  );
  const body = await res.json();
  assertEquals(res.status, 500);
  assertEquals(JSON.stringify(body).includes('relation'), false);
});

Deno.test('sin inventario: dice qué producto se agotó', async () => {
  const res = await handle(
    post(valid),
    deps({
      rpc: (fn) =>
        Promise.resolve({
          data: fn === 'rate_hit' ? true : { ok: false, reason: 'agotado', product: 'Gaseosa 400 ml' },
          error: null,
        }),
    }),
  );
  assertEquals((await res.json()).message, 'Se agotó Gaseosa 400 ml. Quítalo de tu pedido o cámbialo.');
});

Deno.test('recoger en tienda: no pide dirección ni localidad', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const res = await handle(
    post({ ...valid, fulfillment: 'recoger', customer: { name: 'Gustavo Prueba', phone: '3105551234' } }),
    deps({}, calls),
  );
  assertEquals(res.status, 201);
  assertEquals(
    (calls.find(([fn]) => fn === 'place_order')![1].p as Record<string, unknown>).fulfillment,
    'recoger',
  );
});

Deno.test('domicilio sin dirección: datos inválidos', async () => {
  const res = await handle(
    post({ ...valid, customer: { name: 'Gustavo Prueba', phone: '3105551234' } }),
    deps(),
  );
  assertEquals(res.status, 400);
});

Deno.test('nombre con URL o salto de línea: datos inválidos (auditoría)', async () => {
  for (const name of ['bit.ly/pago', 'Ana\nURGENTE', 'Juan 123']) {
    const res = await handle(post({ ...valid, customer: { ...valid.customer, name } }), deps());
    assertEquals(res.status, 400, name);
  }
  const ok = await handle(
    post({ ...valid, customer: { ...valid.customer, name: "María José O'Neil-Pérez" } }),
    deps(),
  );
  assertEquals(ok.status, 201);
});
