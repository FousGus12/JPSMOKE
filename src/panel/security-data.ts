// Seguridad (D43): pedidos frenados (30 días) y registro de auditoría (RPC solo admin).
import { getSupabase } from '../lib/supabase';

export interface BlockedAttempt {
  id: string;
  at: string;
  reason: string;
  customer_name: string | null;
  phone_last4: string | null;
  zone_name: string | null;
  total_attempt: number | null;
  items_count: number | null;
}
export interface AuditRow {
  id: string;
  at: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: unknown;
  actor: string;
}
export const AUDIT_PAGE = 30;

export async function loadBlocked(): Promise<BlockedAttempt[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await getSupabase()
    .from('blocked_attempts')
    .select('id, at, reason, customer_name, phone_last4, zone_name, total_attempt, items_count')
    .gte('at', since)
    .order('at', { ascending: false })
    .limit(300);
  if (error) throw new Error('No se pudieron cargar los pedidos frenados.');
  return (data ?? []) as unknown as BlockedAttempt[];
}

export async function loadAudit(before: string | null): Promise<AuditRow[]> {
  const { data, error } = await getSupabase().rpc('audit_list', {
    p_limit: AUDIT_PAGE,
    p_before: before ?? undefined,
  });
  if (error) throw new Error('No se pudo cargar el registro.');
  return (data ?? []) as unknown as AuditRow[];
}
