// Sesión del panel (D12): correo + contraseña y, para el admin o quien tenga apartados delegados (D38),
// segundo paso TOTP (la base exige aal2).
// Copiado de Aura y adaptado a la base compartida (D24).
import { decideAuthStep } from '../core/auth-step';
import { getSupabase } from '../lib/supabase';

export interface Staff {
  name: string;
  role: 'admin' | 'operador';
  restaurant: string;
  slug: string;
  restaurant_id: string;
  /** Apartados delegados (D38); el admin los tiene todos. */
  permissions: string[];
  /** Admin o persona con apartados delegados: la base exige el segundo paso. */
  needs_totp: boolean;
  /** Clave temporal sin cambiar (D39): no entra al panel hasta cambiarla. */
  must_change_password?: boolean;
}

export type AuthStep =
  | { kind: 'sin_sesion' }
  | { kind: 'cambiar_clave' }
  | { kind: 'inscribir_totp' }
  | { kind: 'verificar_totp'; factorId: string }
  | { kind: 'dentro'; staff: Staff };

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error('Correo o contraseña incorrectos.');
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

/**
 * En qué paso está la persona: pide código, inscripción o deja entrar.
 * D51: la sesión sale del almacenamiento local (solo va a la red si toca renovar el token); con ella,
 * la ficha (`my_staff`, red), el nivel AAL (local: lee el JWT de la sesión) y los factores
 * (`listFactors`, red: GET /user) se piden juntos, en una sola espera de red.
 */
export async function currentStep(): Promise<AuthStep> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { kind: 'sin_sesion' };
  const [{ data: staff }, { data: aal }, { data: factors }] = await Promise.all([
    supabase.rpc('my_staff'),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const me = staff as (Staff & { aal_ok: boolean }) | null;
  const decision = decideAuthStep({
    staff: me,
    currentLevel: aal?.currentLevel,
    totp: factors?.totp,
  });
  if (decision.kind === 'sin_ficha' || !me) {
    await supabase.auth.signOut();
    return { kind: 'sin_sesion' };
  }
  if (decision.kind === 'dentro')
    return { kind: 'dentro', staff: { ...me, permissions: me.permissions ?? [] } };
  return decision;
}

/** Inicia la inscripción del TOTP: QR (SVG en data URL) y secreto para escribirlo a mano. */
export async function enrollTotp(): Promise<{ factorId: string; qrSvg: string; secret: string }> {
  const supabase = getSupabase();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified')
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Panel JP Smoke',
  });
  if (error || !data) throw new Error('No pudimos iniciar el segundo paso. Inténtalo de nuevo.');
  return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.mfa.challengeAndVerify({
    factorId,
    code: code.replace(/\D/g, ''),
  });
  if (error) throw new Error('El código no es válido o ya venció. Escribe el que aparece ahora en tu app.');
}

export function onAuthChange(callback: () => void): () => void {
  const { data } = getSupabase().auth.onAuthStateChange(() => callback());
  return () => data.subscription.unsubscribe();
}
