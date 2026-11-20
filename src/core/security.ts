// Seguridad (D43): motivos de pedidos frenados en lenguaje claro y lectura de la auditoría.
export const BLOCK_REASONS = {
  robot: 'Verificación antibots',
  repetido: 'Demasiados pedidos seguidos',
  bloqueado: 'Cliente bloqueado',
  fuera_de_zona: 'Fuera de zona de entrega',
  cerrado: 'Restaurante cerrado',
  precio: 'Precio desactualizado',
} as const;
export type BlockReason = keyof typeof BLOCK_REASONS;

export function reasonLabel(reason: string): string {
  return (BLOCK_REASONS as Record<string, string>)[reason] ?? 'Otro motivo';
}

/** Teléfono enmascarado: solo los últimos 4 dígitos. */
export function maskPhone(last4: string | null): string {
  return last4 ? `••••${last4}` : '—';
}

/** Cursor para la página siguiente de la auditoría: fecha del último registro, o null si ya no hay más. */
export function nextAuditCursor(rows: Array<{ at: string }>, limit: number): string | null {
  return rows.length >= limit ? (rows[rows.length - 1]?.at ?? null) : null;
}

/** Texto corto del detalle de auditoría (objeto plano → "clave: valor · …"). */
export function auditDetailText(detail: unknown): string {
  if (detail === null || detail === undefined) return '';
  if (typeof detail !== 'object') return String(detail);
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
    .slice(0, 240);
}
