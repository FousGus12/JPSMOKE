// Datos de WhatsApp (F9). Solo admin. La cola no guarda celulares ni textos (D32).
import { getSupabase } from '../lib/supabase';

export type WaMode = 'manual' | 'prueba' | 'activo';
export interface WaLog {
  id: string;
  kind: 'pedido_recibido' | 'aviso_negocio' | 'en_camino' | 'informe_semanal' | 'stock_bajo';
  status: 'pendiente' | 'enviado' | 'simulado' | 'fallido' | 'omitido';
  error: string | null;
  created_at: string;
  sent_at: string | null;
  orders: { code: string } | null;
}

export async function loadWhatsApp(
  restaurantId: string,
): Promise<{ mode: WaMode; siteUrl: string; phone: string; logs: WaLog[] }> {
  const supabase = getSupabase();
  const [settings, logs] = await Promise.all([
    supabase
      .from('restaurant_settings')
      .select('whatsapp_mode, site_url, whatsapp')
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
    phone: settings.data.whatsapp ?? '',
    logs: (logs.data ?? []) as unknown as WaLog[],
  };
}

export async function saveWhatsApp(
  restaurantId: string,
  patch: { whatsapp_mode?: WaMode; site_url?: string | null; whatsapp?: string | null },
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

/** Número del negocio al formato de Meta (57 + 10 dígitos). null = vacío; undefined = inválido. */
export function normalizeBusinessPhone(raw: string): string | null | undefined {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (/^3\d{9}$/.test(digits)) return `57${digits}`;
  if (/^573\d{9}$/.test(digits)) return digits;
  return undefined;
}

export const STATUS_LABEL: Record<WaLog['status'], string> = {
  pendiente: 'En cola',
  enviado: 'Enviado',
  simulado: 'Prueba: no se envió',
  fallido: 'No se pudo enviar',
  omitido: 'No se envió',
};

const ERROR_LABEL: Record<string, string> = {
  sin_credenciales: 'faltan el token y el número de Meta',
  modo_manual: 'WhatsApp estaba apagado',
  sin_celular: 'el pedido no tiene celular válido',
  cancelado: 'el pedido se canceló',
  sin_whatsapp_negocio: 'falta el número del negocio',
  red: 'no hubo conexión con Meta',
};
/** Motivo en palabras (los códigos de Meta salen como "Meta rechazó el envío (código)"). */
export function errorLabel(code: string | null): string {
  if (!code) return '';
  if (ERROR_LABEL[code]) return ERROR_LABEL[code];
  const meta = /^meta_(\d+)$/.exec(code);
  return meta ? `Meta rechazó el envío (código ${meta[1]})` : 'motivo no identificado';
}

export type StepState = 'listo' | 'falta' | 'pendiente';
export interface Step {
  key: string;
  title: string;
  detail: string;
  state: StepState;
  note: string;
}

/** Lo que el panel puede saber: el número del negocio y si ya salió un mensaje real o falló por credenciales. */
export function activationSteps(phone: string, logs: WaLog[]): Step[] {
  const sentReal = logs.some((log) => log.status === 'enviado');
  const noCredentials = logs.some((log) => log.status === 'fallido' && log.error === 'sin_credenciales');
  // Un envío real exitoso prueba que cuenta, plantillas, token y pago funcionan.
  const proven = (state: StepState): StepState => (sentReal ? 'listo' : state);
  const team = (): StepState => (noCredentials ? 'falta' : 'pendiente');
  const note = (state: StepState, falta = 'Falta') =>
    state === 'listo' ? 'Listo' : state === 'falta' ? falta : 'Por confirmar con el equipo';
  const phoneState: StepState = phone ? 'listo' : 'falta';
  const meta = proven('pendiente');
  const templates = proven('pendiente');
  const token = proven(team());
  const payment = proven('pendiente');
  return [
    {
      key: 'cuenta',
      title: 'Cuenta de WhatsApp Business en Meta',
      detail: 'La crea el dueño en business.facebook.com con los datos del negocio.',
      state: meta,
      note: note(meta),
    },
    {
      key: 'numero',
      title: 'Número del negocio',
      detail: 'El WhatsApp donde te llega el aviso de cada pedido. Se escribe en esta pantalla.',
      state: phoneState,
      note: note(phoneState),
    },
    {
      key: 'plantillas',
      title: 'Las 5 plantillas aprobadas por Meta',
      detail:
        'pedido_recibido, aviso_negocio, en_camino, informe_semanal y stock_bajo. Los textos están abajo, en "Así se ven".',
      state: templates,
      note: note(templates),
    },
    {
      key: 'token',
      title: 'Token y número de envío configurados',
      detail: 'Lo carga el equipo técnico en el servidor. No se escribe aquí.',
      state: token,
      note: note(token),
    },
    {
      key: 'pago',
      title: 'Método de pago en Meta',
      detail: 'Meta cobra los mensajes automáticos a la tarjeta de la cuenta.',
      state: payment,
      note: note(payment),
    },
  ];
}
