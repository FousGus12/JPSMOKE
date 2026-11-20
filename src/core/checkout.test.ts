import { describe, expect, it } from 'vitest';
import {
  antiBotWait,
  attemptFor,
  attemptSignature,
  boundedMs,
  canExpress,
  createStopwatch,
  readAttempt,
  readOrderingStatus,
  readSavedForm,
  reopenDelay,
  validateCustomer,
  type CustomerForm,
} from './checkout';

const ctx = {
  zones: [{ id: 'z1' }],
  payments: [{ code: 'nequi' }, { code: 'efectivo' }],
  pickupEnabled: false,
};
const good: CustomerForm = {
  mode: 'domicilio',
  name: 'Ana María',
  phone: '300 123 4567',
  address: 'Calle 68 # 60-71',
  barrio: 'Normandía',
  zone: 'z1',
  notes: '',
  pay: 'nequi',
  cash: '',
  ok: false,
  promos: false,
};

describe('validateCustomer', () => {
  it('datos completos no tienen errores', () => {
    expect(validateCustomer(good, ctx)).toEqual({});
  });
  it('marca cada campo con su mensaje', () => {
    const errors = validateCustomer(
      { ...good, name: 'A1', phone: '123', address: 'calle', barrio: 'x', zone: '', pay: '' },
      ctx,
    );
    expect(errors).toEqual({
      name: 'Escribe tu nombre',
      phone: 'Celular colombiano de 10 dígitos (empieza por 3)',
      address: 'Escribe la dirección completa con número',
      barrio: 'Escribe tu barrio',
      zone: 'Elige tu localidad',
      pay: 'Elige cómo pagas',
    });
    expect(validateCustomer({ ...good, name: 'Ana 2' }, ctx).name).toBe(
      'Escribe solo tu nombre, sin números ni símbolos',
    );
  });
  it('zona apagada o pago retirado = hay que volver a Datos', () => {
    expect(validateCustomer({ ...good, zone: 'vieja' }, ctx).zone).toBeDefined();
    expect(validateCustomer({ ...good, pay: 'daviplata' }, ctx).pay).toBeDefined();
  });
  it('recoger no pide dirección (solo si el local lo permite)', () => {
    const pickup = { ...good, mode: 'recoger' as const, address: '', barrio: '', zone: '' };
    expect(validateCustomer(pickup, { ...ctx, pickupEnabled: true })).toEqual({});
    expect(validateCustomer(pickup, ctx).address).toBeDefined();
  });
});

describe('canExpress', () => {
  it('solo con datos recordados completos y vigentes', () => {
    expect(canExpress(good, ctx)).toBe(true);
    expect(canExpress(null, ctx)).toBe(false);
    expect(canExpress({ ...good, zone: 'vieja' }, ctx)).toBe(false);
    expect(canExpress(readSavedForm({}), ctx)).toBe(false);
  });
});

describe('readSavedForm', () => {
  it('nunca recuerda la autorización y tolera basura', () => {
    expect(readSavedForm({ ...good, ok: true }).ok).toBe(false);
    expect(readSavedForm('x')).toMatchObject({ mode: 'domicilio', name: '', promos: false });
    expect(readSavedForm({ name: 5, mode: 'recoger' })).toMatchObject({ name: '', mode: 'recoger' });
  });
});

describe('intento (request_id)', () => {
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-00000000000${++counter}`;
  it('mismo pedido conserva el id; otro pedido trae id nuevo', () => {
    const sig = attemptSignature({ items: [{ product_id: 'a', qty: 1 }], customer: { name: 'Ana' } });
    const first = attemptFor(null, sig, newId);
    expect(attemptFor(first, sig, newId)).toBe(first);
    const other = attemptSignature({ items: [{ product_id: 'a', qty: 2 }], customer: { name: 'Ana' } });
    expect(attemptFor(first, other, newId).id).not.toBe(first.id);
  });
  it('la firma no depende del orden de las llaves', () => {
    expect(attemptSignature({ a: 1, b: { c: 2, d: 3 } })).toBe(attemptSignature({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it('lee el intento guardado solo si es válido', () => {
    expect(readAttempt({ id: '00000000-0000-4000-8000-000000000001', signature: 's' })).not.toBeNull();
    expect(readAttempt({ id: 'x', signature: 's' })).toBeNull();
    expect(readAttempt(null)).toBeNull();
  });
});

describe('tiempos', () => {
  it('boundedMs acota a 0–24 h', () => {
    expect(boundedMs(-5)).toBe(0);
    expect(boundedMs(1.6)).toBe(2);
    expect(boundedMs(1e12)).toBe(86_400_000);
    expect(boundedMs(Number.NaN)).toBe(0);
  });
  it('antiBotWait espera lo que falte para los 4 s', () => {
    expect(antiBotWait(0, 1000)).toBe(3300);
    expect(antiBotWait(0, 10_000)).toBe(0);
  });
  it('el cronómetro acumula tramos y es null si nunca corrió', () => {
    const watch = createStopwatch();
    expect(watch.total(0)).toBeNull();
    watch.start(1000);
    watch.start(1500); // ya corría: no reinicia
    watch.stop(3000);
    expect(watch.total(9000)).toBe(2000);
    watch.start(10_000);
    expect(watch.total(10_500)).toBe(2500);
    watch.reset();
    expect(watch.total(11_000)).toBeNull();
  });
});

describe('estado de pedidos (ordering_status)', () => {
  it('lee la respuesta del servidor', () => {
    expect(
      readOrderingStatus({ accepting: false, resumes_at: '2026-11-19T20:30:00+00:00', eta: ' 35–50 min ' }),
    ).toEqual({ accepting: false, resumesAt: '2026-11-19T20:30:00+00:00', eta: '35–50 min' });
    expect(readOrderingStatus({ accepting: true, resumes_at: null, eta: null })).toEqual({
      accepting: true,
      resumesAt: null,
      eta: null,
    });
  });
  it('forma inesperada = null (se usa el respaldo)', () => {
    expect(readOrderingStatus(null)).toBeNull();
    expect(readOrderingStatus([])).toBeNull();
    expect(readOrderingStatus({ accepting: 'si' })).toBeNull();
  });
  it('reabre al terminar la pausa con margen y tope', () => {
    const now = Date.parse('2026-11-19T20:00:00Z');
    expect(reopenDelay('2026-11-19T20:15:00Z', now)).toBe(15 * 60_000 + 2000);
    expect(reopenDelay('2026-11-19T19:00:00Z', now)).toBe(2000);
    expect(reopenDelay('2026-11-20T20:00:00Z', now)).toBe(3 * 3600_000 + 2000);
    expect(reopenDelay(null, now)).toBeNull();
    expect(reopenDelay('mañana', now)).toBeNull();
  });
});
