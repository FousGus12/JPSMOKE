// Ilustraciones del seguimiento (D52): SVG propio, solo el del estado actual. Colores por clase (seguimiento.css) y currentColor.
// El estado base de cada dibujo es el cuadro final; las animaciones viven en seguimiento.css (quietas con "reducir movimiento").
import type { Fulfillment, OrderStatus } from '../core/tracking';

const wrap = (inner: string) =>
  `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

/** Recibido: hoja con un lápiz que escribe (las líneas aparecen). */
const RECEIVED = wrap(
  '<rect x="26" y="14" width="60" height="82" rx="6"/>' +
    '<path class="ln ln1 acc" pathLength="1" d="M38 34h36"/>' +
    '<path class="ln ln2 acc" pathLength="1" d="M38 48h36"/>' +
    '<path class="ln ln3 acc" pathLength="1" d="M38 62h24"/>' +
    '<g transform="translate(64 64) rotate(-45)"><g class="pen"><path d="M0 0l8-5v10z"/><rect x="8" y="-5" width="26" height="10" rx="2"/><path d="M14 -5v10"/></g></g>',
);

/** Confirmado: chulo verde que se dibuja y luego late suave. */
const CONFIRMED = wrap(
  '<g class="beat ok">' +
    '<circle class="ring" pathLength="1" cx="60" cy="60" r="42"/>' +
    '<path class="tick" pathLength="1" d="M38 62l15 15 30-32"/>' +
    '</g>',
);

/** En el barril: barril con humo que sube y una hamburguesa. */
const BARREL = wrap(
  '<path class="sm sm1" d="M38 28c-6-5 6-9 0-15"/>' +
    '<path class="sm sm2" d="M52 26c-6-5 6-9 0-15"/>' +
    '<path class="sm sm3" d="M64 28c-6-5 6-9 0-15"/>' +
    '<ellipse cx="50" cy="38" rx="26" ry="7"/>' +
    '<path d="M24 38c-4 18-4 42 0 60 6 5 46 5 52 0 4-18 4-42 0-60"/>' +
    '<path class="acc" d="M26 56c8 4 40 4 48 0M26 80c8 4 40 4 48 0"/>' +
    '<g class="burger"><path d="M80 88c0-14 32-14 32 0z"/><path class="acc" d="M80 94h32"/><path d="M80 100h32v2a4 4 0 0 1-4 4H84a4 4 0 0 1-4-4z"/></g>',
);

/** En camino: domiciliario en moto (ruedas que giran, líneas de velocidad). */
const ON_THE_WAY = wrap(
  '<path class="sp sp1" d="M4 50h14"/><path class="sp sp2" d="M8 64h12"/><path class="sp sp3" d="M2 78h16"/>' +
    '<path class="gr" d="M4 104h112"/>' +
    '<g class="moto"><rect class="acc" x="22" y="48" width="20" height="16" rx="3"/>' +
    '<path d="M30 88l16-22h24M42 66h14M70 66l4-22M74 44h8M74 44l16 42"/>' +
    '<circle cx="56" cy="36" r="7"/><path d="M56 44l-4 18M55 50l18-4"/></g>' +
    '<g class="whs"><circle cx="30" cy="88" r="14"/><circle cx="92" cy="88" r="14"/>' +
    '<g class="wh"><path d="M30 76v24M18 88h24"/></g><g class="wh"><path d="M92 76v24M80 88h24"/></g></g>',
);

/** Recoger (listo): bolsa lista para pasar por ella. */
const BAG = wrap(
  '<g class="bag"><path d="M32 44h56l6 54H26z"/><path d="M46 44v-8a14 14 0 0 1 28 0v8"/>' +
    '<path class="tick ok" pathLength="1" d="M48 74l9 9 17-19"/></g>',
);

/** Entregado / recogido: caja empacada con moño y sello. */
const DELIVERED = wrap(
  '<g class="box"><rect x="28" y="52" width="64" height="44" rx="4"/><rect x="24" y="40" width="72" height="14" rx="3"/>' +
    '<path class="acc" d="M60 40v56"/>' +
    '<g class="bow acc"><path d="M60 40c-6-14-22-12-18-4 4 6 14 4 18 4zM60 40c6-14 22-12 18-4-4 6-14 4-18 4z"/></g></g>' +
    '<g class="seal ok"><circle cx="94" cy="92" r="14"/><path class="tick" pathLength="1" d="M87 92l5 5 9-10"/></g>',
);

/** Ilustración del estado actual. Cancelado no lleva dibujo. */
export function trackArt(status: OrderStatus, fulfillment: Fulfillment = 'domicilio'): string {
  switch (status) {
    case 'nuevo':
      return RECEIVED;
    case 'confirmado':
      return CONFIRMED;
    case 'en_cocina':
      return BARREL;
    case 'en_camino':
      return fulfillment === 'recoger' ? BAG : ON_THE_WAY;
    case 'entregado':
      return DELIVERED;
    default:
      return '';
  }
}

/** Clave del dibujo: si no cambia, el SVG no se repinta (la animación no se reinicia). */
export function artKey(status: OrderStatus, fulfillment: Fulfillment = 'domicilio'): string {
  return trackArt(status, fulfillment) ? `${status}:${fulfillment}` : '';
}
