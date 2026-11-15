import { assertEquals } from '@std/assert';
import { handle, parseMember, randomPassword, type Deps } from './handler.ts';

const ORIGIN = 'http://127.0.0.1:4331';
const RID = '15000000-0000-4000-8000-000000000001';
const OTHER = '25000000-0000-4000-8000-00000000000c';

function deps(over: Partial<Deps> = {}): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    callerRestaurant: () => Promise.resolve({ data: RID, error: null }),
    callerId: () => Promise.resolve('25000000-0000-4000-8000-00000000000a'),
    createUser: (email) => {
      calls.push(`create:${email}`);
      return Promise.resolve({ id: OTHER, exists: false });
    },
    deleteUser: (id) => {
      calls.push(`delete:${id}`);
      return Promise.resolve();
    },
    insertStaff: (row) => {
      calls.push(`staff:${row.restaurant_id}:${row.role}:${row.permissions.join(',')}`);
      return Promise.resolve(true);
    },
    staffRestaurant: () => Promise.resolve(RID),
    setPassword: (id) => {
      calls.push(`password:${id}`);
      return Promise.resolve(true);
    },
    randomPassword: () => 'temporal-123',
    callerInfo: () => Promise.resolve({ id: OTHER, aal: 'aal1', hasTotp: false, isStaff: true }),
    changeOwnPassword: (id) => {
      calls.push(`own:${id}`);
      return Promise.resolve(true);
    },
    allowedOrigins: ['local'],
    ...over,
  };
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/equipo', {
    method: 'POST',
    headers: { origin: ORIGIN, authorization: 'Bearer t', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const member = {
  action: 'create',
  email: 'Ana@Correo.co',
  full_name: 'Ana Pérez',
  role: 'operador',
  permissions: ['ventas'],
};

Deno.test('crea la cuenta en el restaurante de quien llama y devuelve la clave una vez', async () => {
  const d = deps();
  const res = await handle(post({ ...member, restaurant_id: 'otro' }), d);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).password, 'temporal-123');
  assertEquals(d.calls, ['create:ana@correo.co', `staff:${RID}:operador:ventas`]);
});
Deno.test('no es admin: 403 sin crear nada', async () => {
  const d = deps({
    callerRestaurant: () => Promise.resolve({ data: null, error: { message: 'x', code: '42501' } }),
  });
  assertEquals((await handle(post(member), d)).status, 403);
  assertEquals(d.calls, []);
});
Deno.test('sin sesión: 401', async () => {
  assertEquals((await handle(post(member, { authorization: '' }), deps())).status, 401);
});
Deno.test('origen no permitido: 403', async () => {
  assertEquals((await handle(post(member, { origin: 'https://otro.co' }), deps())).status, 403);
});
Deno.test('correo en uso: 409', async () => {
  const d = deps({ createUser: () => Promise.resolve({ id: null, exists: true }) });
  assertEquals((await handle(post(member), d)).status, 409);
});
Deno.test('si falla la ficha, borra la cuenta creada', async () => {
  const d = deps({ insertStaff: () => Promise.resolve(false) });
  assertEquals((await handle(post(member), d)).status, 500);
  assertEquals(d.calls.includes(`delete:${OTHER}`), true);
});
Deno.test('restablece la clave de alguien de su restaurante', async () => {
  const d = deps();
  const res = await handle(post({ action: 'reset', user_id: OTHER }), d);
  assertEquals(res.status, 200);
  assertEquals(d.calls, [`password:${OTHER}`]);
});
Deno.test('no restablece cuentas de otro restaurante', async () => {
  const d = deps({ staffRestaurant: () => Promise.resolve('otro') });
  assertEquals((await handle(post({ action: 'reset', user_id: OTHER }), d)).status, 404);
  assertEquals(d.calls, []);
});
Deno.test('no restablece la propia (se cambia desde Mi cuenta)', async () => {
  const d = deps({ callerId: () => Promise.resolve(OTHER) });
  assertEquals((await handle(post({ action: 'reset', user_id: OTHER }), d)).status, 400);
});
Deno.test('valida datos', () => {
  assertEquals(parseMember({ ...member, permissions: ['equipo'] }), null);
  assertEquals(parseMember({ ...member, role: 'dueño' }), null);
  assertEquals(parseMember({ ...member, email: 'sin-arroba' }), null);
  assertEquals(parseMember({ ...member, full_name: 'A1' }), null);
  assertEquals(parseMember({ ...member, role: 'admin' })?.permissions, []);
});
Deno.test('clave temporal de 24 caracteres', () => {
  assertEquals(randomPassword().length, 24);
});

Deno.test('cambia la propia clave aunque tenga la temporal pendiente', async () => {
  const d = deps({
    callerRestaurant: () => Promise.resolve({ data: null, error: { message: 'x', code: '42501' } }),
  });
  const res = await handle(post({ action: 'cambiar_clave', password: 'una-clave-larga-1' }), d);
  assertEquals(res.status, 200);
  assertEquals(d.calls, [`own:${OTHER}`]);
});
Deno.test('cambiar la propia clave exige el código si ya lo tiene', async () => {
  const d = deps({
    callerInfo: () => Promise.resolve({ id: OTHER, aal: 'aal1', hasTotp: true, isStaff: true }),
  });
  assertEquals(
    (await handle(post({ action: 'cambiar_clave', password: 'una-clave-larga-1' }), d)).status,
    403,
  );
  assertEquals(d.calls, []);
});
Deno.test('clave propia muy corta: 400', async () => {
  assertEquals((await handle(post({ action: 'cambiar_clave', password: 'corta' }), deps())).status, 400);
});
Deno.test('quien no es del equipo no cambia claves: 403', async () => {
  const d = deps({ callerInfo: () => Promise.resolve(null) });
  assertEquals(
    (await handle(post({ action: 'cambiar_clave', password: 'una-clave-larga-1' }), d)).status,
    403,
  );
});
