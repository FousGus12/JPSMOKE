// Equipo (D38): el admin crea cuentas y restablece contraseñas. La base decide si quien llama es admin con
// dos pasos (team_restaurant con su propio JWT) y de qué restaurante; nunca se toma del cuerpo.
// La contraseña temporal se devuelve una sola vez y no se registra en ningún lado.
import { corsHeaders } from '../_shared/cors.ts';

export const AREAS = ['ventas', 'inventario', 'whatsapp', 'carta', 'sitio', 'promos', 'eventos'] as const;
export type Role = 'admin' | 'operador';

type DbError = { message: string; code?: string } | null;
type Result<T> = PromiseLike<{ data: T | null; error: DbError }>;

export interface NewMember {
  email: string;
  full_name: string;
  role: Role;
  permissions: string[];
}

export interface Deps {
  /** Restaurante de quien llama si es admin con dos pasos; error 42501 si no. */
  callerRestaurant: (authorization: string) => Result<string>;
  /** Id de quien llama (sub del JWT ya validado por la base). */
  callerId: (authorization: string) => Promise<string | null>;
  createUser: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ id: string | null; exists: boolean }>;
  deleteUser: (id: string) => Promise<void>;
  insertStaff: (row: NewMember & { user_id: string; restaurant_id: string }) => Promise<boolean>;
  staffRestaurant: (userId: string) => Promise<string | null>;
  setPassword: (userId: string, password: string) => Promise<boolean>;
  randomPassword: () => string;
  allowedOrigins: string[];
}

export type TeamError =
  'sin_permiso' | 'datos_invalidos' | 'correo_en_uso' | 'no_encontrado' | 'propia' | 'error';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const NAME = /^[\p{L} .'-]{2,80}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMember(body: unknown): NewMember | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const name = typeof b.full_name === 'string' ? b.full_name.trim().replace(/\s+/g, ' ') : '';
  const role = b.role;
  const perms = Array.isArray(b.permissions) ? b.permissions : [];
  if (!EMAIL.test(email) || !NAME.test(name)) return null;
  if (role !== 'admin' && role !== 'operador') return null;
  if (!perms.every((p) => typeof p === 'string' && (AREAS as readonly string[]).includes(p))) return null;
  return {
    email,
    full_name: name,
    role,
    permissions: role === 'admin' ? [] : [...new Set(perms as string[])],
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'), deps.allowedOrigins);
  const fail = (error: TeamError, status: number) => json({ ok: false, error }, status, cors);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail('error', 405);
  if (!cors['Access-Control-Allow-Origin']) return fail('error', 403);
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) return fail('sin_permiso', 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('datos_invalidos', 400);
  }

  const { data: restaurantId, error } = await deps.callerRestaurant(authorization);
  if (error || !restaurantId) return fail('sin_permiso', 403);

  try {
    if (body.action === 'create') {
      const member = parseMember(body);
      if (!member) return fail('datos_invalidos', 400);
      const password = deps.randomPassword();
      const user = await deps.createUser(member.email, password, member.full_name);
      if (user.exists) return fail('correo_en_uso', 409);
      if (!user.id) return fail('error', 500);
      const ok = await deps.insertStaff({ ...member, user_id: user.id, restaurant_id: restaurantId });
      if (!ok) {
        await deps.deleteUser(user.id);
        return fail('error', 500);
      }
      return json({ ok: true, user_id: user.id, password }, 200, cors);
    }

    if (body.action === 'reset') {
      const userId = typeof body.user_id === 'string' ? body.user_id : '';
      if (!UUID.test(userId)) return fail('datos_invalidos', 400);
      if ((await deps.callerId(authorization)) === userId) return fail('propia', 400);
      if ((await deps.staffRestaurant(userId)) !== restaurantId) return fail('no_encontrado', 404);
      const password = deps.randomPassword();
      if (!(await deps.setPassword(userId, password))) return fail('error', 500);
      return json({ ok: true, password }, 200, cors);
    }
  } catch {
    return fail('error', 500);
  }
  return fail('datos_invalidos', 400);
}

/** 18 bytes aleatorios en base64url: 24 caracteres. */
export function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
