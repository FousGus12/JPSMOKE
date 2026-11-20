// Mensajes del pedido (sin zod): los usan el sitio y la Edge Function. Separado para que el sitio no cargue zod.
export type PedidoError =
  | 'robot'
  | 'repetido'
  | 'bloqueado'
  | 'cerrado'
  | 'fuera_de_zona'
  | 'pago'
  | 'agotado'
  | 'minimo'
  | 'sin_plato'
  | 'cupon'
  | 'cupon_usado'
  | 'recoger'
  | 'restaurante'
  | 'datos'
  | 'datos_invalidos'
  | 'error';

// Lo que ve el cliente. Los motivos de fraude comparten un mensaje genérico (no revelar qué capa frenó).
const generico = 'No pudimos tomar tu pedido. Si ya pediste hace poco, escríbenos por WhatsApp.';
export const mensajesPedido: Record<PedidoError, string> = {
  robot: generico,
  repetido: generico,
  bloqueado: generico,
  cerrado: 'En este momento no estamos recibiendo pedidos. Revisa nuestro horario.',
  fuera_de_zona: 'Todavía no llegamos a esa localidad.',
  pago: 'Ese medio de pago no está disponible hoy. Elige otro.',
  agotado: 'Uno de los productos se agotó. Revisa tu pedido.',
  minimo: 'Tu pedido no alcanza el mínimo para domicilio.',
  sin_plato: 'Agrega al menos un plato: las adiciones van con un plato.',
  cupon: 'Ese cupón no aplica a este pedido.',
  cupon_usado: 'Ya usaste ese cupón con este celular.',
  recoger: 'Hoy no estamos entregando en el local. Elige domicilio.',
  restaurante: 'No pudimos tomar tu pedido. Inténtalo de nuevo.',
  datos: 'Revisa los datos e inténtalo de nuevo.',
  datos_invalidos: 'Revisa los datos e inténtalo de nuevo.',
  error: 'No pudimos tomar tu pedido. Inténtalo de nuevo en un momento.',
};

/** D61: pedidos en pausa. "Pausamos los pedidos por unos minutos. Volvemos a las 19:30." (hora de Bogotá).
 * Sin hora válida, el mensaje de cerrado. */
export function mensajePausa(resumesAt: string | Date | null | undefined): string {
  const date = resumesAt ? new Date(resumesAt) : null;
  if (!date || Number.isNaN(date.getTime())) return mensajesPedido.cerrado;
  const hora = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `Pausamos los pedidos por unos minutos. Volvemos a las ${hora}.`;
}
