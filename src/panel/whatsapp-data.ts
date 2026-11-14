// Datos de WhatsApp (F9). Solo admin. La cola no guarda celulares ni textos (D32).
import { getSupabase } from '../lib/supabase';

export type WaMode = 'manual' | 'prueba' | 'activo';
export interface WaLog {
  id: string;
  kind: 'pedido_recibido' | 'aviso_negocio' | 'en_camino' | 'informe_semanal';
  status: 'pendiente' | 'enviado' | 'simulado' | 'fallido' | 'omitido';
  error: string | null;
  created_at: string;
  sent_at: string | null;
  orders: { code: string } | null;
}

export async function loadWhatsApp(
  restaurantId: string,
): Promise<{ mode: WaMode; siteUrl: string; logs: WaLog[] }> {
  const supabase = getSupabase();
  const [settings, logs] = await Promise.all([
    supabase
      .from('restaurant_settings')
      .select('whatsapp_mode, site_url')
      .eq('restaurant_id', restaurantId)
      .single(),
    supabase
      .from('whatsapp_messages')
      .select('id, kind, status, error, created_at, sent_at, orders(code)')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  if (settings.error || logs.error) throw new Error('No pudimos cargar WhatsApp.');
  return {
    mode: settings.data.whatsapp_mode as WaMode,
    siteUrl: settings.data.site_url ?? '',
    logs: (logs.data ?? []) as unknown as WaLog[],
  };
}

export async function saveWhatsApp(
  restaurantId: string,
  patch: { whatsapp_mode?: WaMode; site_url?: string | null },
): Promise<void> {
  const { error } = await getSupabase()
    .from('restaurant_settings')
    .update(patch)
    .eq('restaurant_id', restaurantId);
  if (error)
    throw new Error(
      error.code === '23514' ? 'La dirección de la página debe empezar por https://' : 'No se pudo guardar.',
    );
}
