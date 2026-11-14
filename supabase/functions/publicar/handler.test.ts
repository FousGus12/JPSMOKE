import { assertEquals } from '@std/assert';
import { handle, hookFor, type Deps } from './handler.ts';

const ORIGIN = 'http://127.0.0.1:4331';
function deps(over: Partial<Deps> = {}): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    publish: (auth) => {
      calls.push(`publish:${auth}`);
      return Promise.resolve({
        data: { published_at: '2026-11-01T15:00:00Z', slug: 'jp-smoke' },
        error: null,
      });
    },
    unmark: () => {
      calls.push('unmark');
      return Promise.resolve({ data: null, error: null });
    },
    callHook: (slug) => {
      calls.push(`hook:${slug}`);
      return Promise.resolve(true);
    },
    allowedOrigins: ['local'],
    ...over,
  };
}
const post = (headers: Record<string, string> = {}) =>
  new Request('http://x/publicar', {
    method: 'POST',
    headers: { origin: ORIGIN, authorization: 'Bearer t', ...headers },
  });

Deno.test('publica y llama el hook del restaurante', async () => {
  const d = deps();
  const res = await handle(post(), d);
  assertEquals(res.status, 200);
  assertEquals(d.calls, ['publish:Bearer t', 'hook:jp-smoke']);
});
Deno.test('sin sesión: 401 sin llamar a la base', async () => {
  const d = deps();
  assertEquals((await handle(post({ authorization: '' }), d)).status, 401);
  assertEquals(d.calls, []);
});
Deno.test('no es admin: 403 y no llama el hook', async () => {
  const d = deps({ publish: () => Promise.resolve({ data: null, error: { message: 'x', code: '42501' } }) });
  assertEquals((await handle(post(), d)).status, 403);
  assertEquals(d.calls, []);
});
Deno.test('muy seguido: 429', async () => {
  const d = deps({
    publish: () => Promise.resolve({ data: null, error: { message: 'x', hint: 'muy_seguido' } }),
  });
  assertEquals((await handle(post(), d)).status, 429);
});
Deno.test('falla el hook: desmarca y 502', async () => {
  const d = deps({ callHook: () => Promise.resolve(false) });
  assertEquals((await handle(post(), d)).status, 502);
  assertEquals(d.calls.includes('unmark'), true);
});
Deno.test('hook por restaurante solo https', () => {
  assertEquals(hookFor('jp-smoke', '{"jp-smoke":"https://api.vercel.com/x"}'), 'https://api.vercel.com/x');
  assertEquals(hookFor('otro', '{"jp-smoke":"https://api.vercel.com/x"}'), null);
  assertEquals(hookFor('jp-smoke', '{"jp-smoke":"http://malo"}'), null);
  assertEquals(hookFor('jp-smoke', 'no-json'), null);
});
