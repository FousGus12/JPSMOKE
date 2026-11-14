// Esquemas y mensajes de los formularios públicos (D9, D21, D22), compartidos por el sitio (Vite) y las funciones (Deno).
import { z } from 'zod';

const celular = z
  .string()
  .transform((value) => {
    const digits = value.replace(/\D/g, '');
    return digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits;
  })
  .pipe(z.string().regex(/^3\d{9}$/, 'Celular colombiano de 10 dígitos (empieza por 3)'));

// Campo trampa: las personas no lo ven; si viene con algo, es un robot (lo decide la función, para contarlo).
const trampa = z.string().max(200).optional();
const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(40);

/** Nombre de persona: letras (con tildes), espacios, punto, apóstrofo y guion. Sale en WhatsApp con la cuenta del
 * negocio, así que no se aceptan URLs, saltos de línea ni símbolos (auditoría 2026-11-02). */
export const nombre = z
  .string()
  .trim()
  .min(3, 'Escribe tu nombre')
  .max(80)
  .regex(/^[\p{L}][\p{L} .'-]*$/u, 'Escribe solo tu nombre, sin números ni símbolos');

export const pedidoSchema = z
  .object({
    restaurant: slug,
    // Recoger en tienda (D33): sin dirección, barrio ni localidad.
    fulfillment: z.enum(['domicilio', 'recoger']).default('domicilio'),
    customer: z.object({
      name: nombre,
      phone: celular,
      address: z.string().trim().max(160).default(''),
      barrio: z.string().trim().max(60).default(''),
      zone_id: z.uuid('Elige tu localidad').optional(),
      notes: z.string().trim().max(200).default(''),
    }),
    payment_code: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Elige cómo pagas'),
    cash_with: z.string().max(12).optional(),
    coupon: z.string().trim().max(20).optional(),
    items: z
      .array(
        z.object({
          product_id: z.uuid(),
          qty: z.number().int().min(1).max(30),
          combo: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(30),
    acepta_datos: z.literal(true, 'Necesitamos tu autorización para entregar el pedido'),
    promos: z.boolean().default(false),
    elapsed_ms: z.number().int().min(0).max(86_400_000),
    turnstile: z.string().max(4096).default(''),
    sitio_web: trampa,
  })
  .superRefine((data, ctx) => {
    if (data.fulfillment === 'recoger') return;
    const { address, barrio, zone_id: zone } = data.customer;
    if (address.length < 8 || !/\d/.test(address))
      ctx.addIssue({
        code: 'custom',
        path: ['customer', 'address'],
        message: 'Escribe la dirección completa con número',
      });
    if (barrio.length < 3)
      ctx.addIssue({ code: 'custom', path: ['customer', 'barrio'], message: 'Escribe tu barrio' });
    if (!zone) ctx.addIssue({ code: 'custom', path: ['customer', 'zone_id'], message: 'Elige tu localidad' });
  });
export type Pedido = z.infer<typeof pedidoSchema>;

export type PedidoError =
  | 'robot'
  | 'repetido'
  | 'bloqueado'
  | 'cerrado'
  | 'fuera_de_zona'
  | 'pago'
  | 'agotado'
  | 'minimo'
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
  cupon: 'Ese cupón no aplica a este pedido.',
  cupon_usado: 'Ya usaste ese cupón con este celular.',
  recoger: 'Hoy no estamos entregando en el local. Elige domicilio.',
  restaurante: 'No pudimos tomar tu pedido. Inténtalo de nuevo.',
  datos: 'Revisa los datos e inténtalo de nuevo.',
  datos_invalidos: 'Revisa los datos e inténtalo de nuevo.',
  error: 'No pudimos tomar tu pedido. Inténtalo de nuevo en un momento.',
};

export const seguimientoSchema = z.union([
  z.object({
    restaurant: slug,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,4}-\d{4,6}$/),
    token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  }),
  z.object({
    restaurant: slug,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,4}-\d{4,6}$/),
    last4: z.string().regex(/^\d{4}$/),
  }),
]);
export type Seguimiento = z.infer<typeof seguimientoSchema>;

export const captarSchema = z.object({
  restaurant: slug,
  event_id: z.uuid(),
  name: z.string().trim().min(2, 'Escribe tu nombre').max(80),
  phone: celular,
  acepta_datos: z.literal(true, 'Necesitamos tu autorización para enviarte el cupón'),
  turnstile: z.string().max(4096).default(''),
  sitio_web: trampa,
});
export type Captar = z.infer<typeof captarSchema>;

export const cotizarSchema = z.object({
  restaurant: slug,
  kind: z.enum(['Catering al barril', 'Pedido corporativo', 'Otro'], 'Elige qué necesitas'),
  name: z.string().trim().min(2, 'Escribe tu nombre').max(80),
  phone: celular,
  event_date: z.iso.date().optional().or(z.literal('')),
  guests: z.coerce.number().int().min(1).max(5000).optional().or(z.literal('')),
  message: z.string().trim().min(5, 'Cuéntanos un poco más').max(1000),
  acepta_datos: z.literal(true, 'Necesitamos tu autorización para responderte'),
  turnstile: z.string().max(4096).default(''),
  sitio_web: trampa,
});
export type Cotizar = z.infer<typeof cotizarSchema>;

export const CONSENT_VERSION = 'v1-2026-11';
