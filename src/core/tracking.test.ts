import { describe, expect, it } from 'vitest';
import { cancelText, recentOrders, rememberOrder, stepIndex, stepName, trackPath } from './tracking';

describe('seguimiento', () => {
  it('arma el enlace único', () => expect(trackPath('JP-0001', 'a/b')).toBe('/pedido?c=JP-0001&t=a%2Fb'));
  it('recuerda sin duplicar y con tope de 10', () => {
    let list = Array.from({ length: 12 }, (_, i) => ({ code: `JP-${i}`, token: 't', at: i }));
    list = rememberOrder(list, { code: 'JP-3', token: 't', at: 99 });
    expect(list.length).toBe(10);
    expect(list.filter((x) => x.code === 'JP-3').length).toBe(1);
    expect(list[0]?.at).toBe(99);
  });
  it('solo pedidos de las últimas 8 horas', () =>
    expect(
      recentOrders(
        [
          { code: 'a', token: 't', at: 0 },
          { code: 'b', token: 't', at: 9 * 3600_000 },
        ],
        10 * 3600_000,
      ).map((x) => x.code),
    ).toEqual(['b']));
  it('posición del estado', () => {
    expect(stepIndex('en_cocina')).toBe(2);
    expect(stepIndex('cancelado')).toBe(-1);
  });
});

describe('stepName', () => {
  it('cambia los pasos finales cuando el cliente recoge', () => {
    expect(stepName('en_camino')).toBe('En camino');
    expect(stepName('en_camino', 'recoger')).toBe('Listo para recoger');
    expect(stepName('entregado', 'recoger')).toBe('Recogido');
    expect(stepName('en_cocina', 'recoger')).toBe('En el barril');
    expect(stepName('cancelado', 'recoger')).toBe('Cancelado');
  });
});

describe('cancelText (D59)', () => {
  it('usa el motivo público si existe', () => {
    expect(cancelText('  Se nos acabó   la carne ')).toBe('Se nos acabó la carne');
  });
  it('sin motivo, el texto genérico', () => {
    for (const note of [null, undefined, '', '   '])
      expect(cancelText(note)).toBe('Tu pedido fue cancelado. Si tienes dudas, escríbenos por WhatsApp.');
  });
});
