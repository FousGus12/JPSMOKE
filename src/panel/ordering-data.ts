// Pausa de pedidos (D61). La columna orders_paused_until solo la cambia la función pause_orders.
import { getSupabase } from '../lib/supabase';

export const PAUSE_OPTIONS = [15, 30, 45, 60] as const;

/** Hasta cuándo está pausado (ms), o null si no hay pausa vigente. */
export async function loadPausedUntil(restaurantId: string): Promise<number | null> {
  const { data, error } = await getSupabase()
    .from('restaurant_settings')
    .select('orders_paused_until')
    .eq('restaurant_id', restaurantId)
    .single();
  if (error || !data) throw new Error('No pudimos leer el estado de los pedidos.');
  return parsePause((data as { orders_paused_until: string | null }).orders_paused_until);
}

/** Pausa por `minutes` minutos; 0 reanuda. Devuelve la nueva hora de vuelta (ms) o null. */
export async function pauseOrders(minutes: number): Promise<number | null> {
  const { data, error } = await getSupabase().rpc('pause_orders', { p_minutes: minutes });
  if (error) {
    if (error.code === '42501') throw new Error('No tienes permiso para pausar los pedidos.');
    throw new Error('No se pudo cambiar la pausa de pedidos.');
  }
  return parsePause((data as { paused_until?: string | null } | null)?.paused_until);
}

export function parsePause(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Pausa vigente a esta hora: devuelve la hora de vuelta o null si ya venció. */
export function activePause(until: number | null, now: number): number | null {
  return until !== null && until > now ? until : null;
}

const clock = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Bogota',
});
/** HH:MM en hora de Bogotá. */
export const formatClock = (ms: number): string => clock.format(ms);

/** Minutos que faltan, redondeados hacia arriba (mínimo 1 mientras la pausa siga vigente). */
export const minutesLeft = (until: number, now: number): number =>
  Math.max(1, Math.ceil((until - now) / 60_000));
