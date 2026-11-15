// Equipo (D38): lista, cambios de rol/apartados/estado (RLS + guardias en la base) y altas o claves
// temporales por la Edge Function `equipo` (la clave temporal se muestra una sola vez).
import { readPublicEnv } from '../lib/env';
import { getSupabase } from '../lib/supabase';

export const AREAS = [
  ['ventas', 'Ventas y estadísticas'],
  ['inventario', 'Inventario'],
  ['whatsapp', 'WhatsApp'],
  ['carta', 'Carta y precios'],
  ['sitio', 'Editar página'],
  ['promos', 'Promociones y cupones'],
  ['eventos', 'Eventos y banners'],
] as const;
export type Area = (typeof AREAS)[number][0];
export type Role = 'admin' | 'operador';

export interface Member {
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  permissions: Area[];
  created_at: string;
  last_sign_in_at: string | null;
  has_totp: boolean;
  is_me: boolean;
}

const DB_ERRORS: Record<string, string> = {
  propio: 'No puedes cambiar tu propio acceso. Pídeselo a otro administrador.',
  ultimo_admin: 'El restaurante necesita al menos un administrador activo.',
};

export async function loadTeam(): Promise<Member[]> {
  const { data, error } = await getSupabase().rpc('team_list');
  if (error) throw new Error('No se pudo cargar el equipo.');
  return (data ?? []) as Member[];
}

export async function updateMember(
  userId: string,
  patch: Partial<Pick<Member, 'full_name' | 'role' | 'active' | 'permissions'>>,
): Promise<void> {
  const { error } = await getSupabase().from('staff').update(patch).eq('user_id', userId);
  if (error) throw new Error(DB_ERRORS[error.hint ?? ''] ?? 'No se pudo guardar el cambio.');
}

type FnResult = { ok: true; password: string } | { ok: false; message: string };

async function callTeam(body: Record<string, unknown>): Promise<FnResult> {
  const supabase = getSupabase();
  const env = readPublicEnv();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { ok: false, message: 'Tu sesión venció. Vuelve a entrar.' };
  const res = await fetch(`${env.PUBLIC_SUPABASE_URL}/functions/v1/equipo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.PUBLIC_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = (await res?.json().catch(() => ({}))) as { ok?: boolean; password?: string; error?: string };
  if (res?.ok && json.ok && json.password) return { ok: true, password: json.password };
  const messages: Record<string, string> = {
    sin_permiso: 'Solo un administrador con su código de seguridad puede hacerlo.',
    datos_invalidos: 'Revisa el correo y el nombre (solo letras).',
    correo_en_uso: 'Ese correo ya tiene una cuenta. Usa otro.',
    no_encontrado: 'Esa cuenta no es de tu restaurante.',
    propia: 'Tu propia contraseña la cambias en "Mi cuenta".',
  };
  return { ok: false, message: messages[json.error ?? ''] ?? 'No se pudo completar. Revisa tu conexión.' };
}

export function createMember(input: {
  email: string;
  full_name: string;
  role: Role;
  permissions: Area[];
}): Promise<FnResult> {
  return callTeam({ action: 'create', ...input });
}

export function resetPassword(userId: string): Promise<FnResult> {
  return callTeam({ action: 'reset', user_id: userId });
}

/** Cambio de la propia contraseña (D39): por la función `equipo`, que también quita la marca de clave
 * temporal y exige el código de dos pasos si la cuenta ya lo tiene. */
export async function changeMyPassword(password: string): Promise<void> {
  if (password.length < 12) throw new Error('Usa al menos 12 caracteres.');
  const supabase = getSupabase();
  const env = readPublicEnv();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Tu sesión venció. Vuelve a entrar.');
  const res = await fetch(`${env.PUBLIC_SUPABASE_URL}/functions/v1/equipo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.PUBLIC_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'cambiar_clave', password }),
  }).catch(() => null);
  const json = (await res?.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (res?.ok && json.ok) {
    // Cambiar la clave cierra todas las sesiones de la cuenta: se vuelve a entrar con la nueva.
    const email = session.session?.user.email ?? '';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Contraseña cambiada. Vuelve a entrar con la nueva.');
    return;
  }
  const messages: Record<string, string> = {
    clave_corta: 'Usa entre 12 y 72 caracteres.',
    sin_permiso: 'Entra con tu código de seguridad para cambiar la contraseña.',
  };
  throw new Error(messages[json.error ?? ''] ?? 'No se pudo cambiar la contraseña. Inténtalo de nuevo.');
}
