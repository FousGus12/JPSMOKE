// Decisión del paso de entrada al panel (D12, D38, D39, D51). Pura: recibe lo que ya respondieron
// `my_staff`, el nivel de dos pasos (AAL) y la lista de factores, y dice qué pantalla sigue.
// El orden de las reglas es el de siempre; no cambiarlo sin registrarlo en ROADMAP §14.

export interface StaffFlags {
  needs_totp: boolean;
  must_change_password?: boolean | null;
}

export type AuthDecision =
  | { kind: 'sin_ficha' }
  | { kind: 'verificar_totp'; factorId: string }
  | { kind: 'cambiar_clave' }
  | { kind: 'inscribir_totp' }
  | { kind: 'dentro' };

export interface AuthInputs {
  /** Respuesta de `my_staff`; null o undefined si no hay ficha. */
  staff: StaffFlags | null | undefined;
  /** `currentLevel` del AAL; null si no se pudo leer. */
  currentLevel: string | null | undefined;
  /** Factores TOTP del usuario (cualquier estado). */
  totp: ReadonlyArray<{ id: string; status: string }> | null | undefined;
}

export function decideAuthStep({ staff, currentLevel, totp }: AuthInputs): AuthDecision {
  if (!staff) return { kind: 'sin_ficha' };
  const verified = totp?.find((factor) => factor.status === 'verified');
  if (verified && currentLevel !== 'aal2') return { kind: 'verificar_totp', factorId: verified.id };
  if (staff.must_change_password) return { kind: 'cambiar_clave' };
  if (staff.needs_totp && !verified) return { kind: 'inscribir_totp' };
  return { kind: 'dentro' };
}
