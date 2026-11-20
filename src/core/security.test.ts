import { describe, expect, it } from 'vitest';
import { toCsv } from './sales';
import {
  auditDetailText,
  blockedActions,
  blockedWhatsApp,
  bogotaStamp,
  maskPhone,
  nextAuditCursor,
  promoExportFileName,
  promoExportRows,
  readPromoExport,
  reasonLabel,
} from './security';

describe('security', () => {
  it('traduce motivos', () => {
    expect(reasonLabel('robot')).toBe('Verificación antibots');
    expect(reasonLabel('repetido')).toBe('Demasiados pedidos seguidos');
    expect(reasonLabel('x')).toBe('Otro motivo');
  });
  it('enmascara el celular', () => {
    expect(maskPhone('1234')).toBe('••••1234');
    expect(maskPhone(null)).toBe('—');
  });
  it('cursor de auditoría', () => {
    expect(nextAuditCursor([{ at: 'a' }, { at: 'b' }], 2)).toBe('b');
    expect(nextAuditCursor([{ at: 'a' }], 2)).toBeNull();
  });
  it('detalle de auditoría', () => {
    expect(auditDetailText({ a: 1, b: null, c: 'x' })).toBe('a: 1 · c: x');
    expect(auditDetailText(null)).toBe('');
  });
});

describe('acciones desde un frenado (D65)', () => {
  const customer = { blocked: true, phone: '3001234567', name: 'Laura Gómez' };
  it('sin vínculo no hay acciones', () => {
    expect(blockedActions({ customer_id: null, customer: null })).toBeNull();
    // Vínculo sin datos del cliente (p. ej. lo borraron entre la carga y la lectura).
    expect(blockedActions({ customer_id: 'c1', customer: null })).toBeNull();
  });
  it('cliente bloqueado: desbloquear y WhatsApp', () => {
    const actions = blockedActions({ customer_id: 'c1', customer }, 'Lau');
    expect(actions?.unblock).toBe(true);
    expect(actions?.whatsapp).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/);
    expect(decodeURIComponent(actions?.whatsapp ?? '')).toContain('Hola Lau,');
  });
  it('cliente no bloqueado: solo WhatsApp, con el nombre guardado si no escribió nombre', () => {
    const actions = blockedActions({ customer_id: 'c1', customer: { ...customer, blocked: false } }, '  ');
    expect(actions?.unblock).toBe(false);
    expect(decodeURIComponent(actions?.whatsapp ?? '')).toContain('Hola Laura,');
  });
  it('celular inválido: sin enlace', () => {
    expect(
      blockedActions({ customer_id: 'c1', customer: { ...customer, phone: '12' } })?.whatsapp,
    ).toBeNull();
  });
  it('el mensaje no menciona el motivo ni el bloqueo', () => {
    const text = decodeURIComponent(blockedWhatsApp('3001234567', ''));
    expect(text).toContain('Hola, vimos');
    expect(text).not.toMatch(/bloque/i);
  });
});

describe('exportar clientes con promociones (D65)', () => {
  it('fecha y hora de Bogotá', () => {
    expect(bogotaStamp('2026-11-20T03:30:00Z')).toBe('2026-11-19 22:30');
    expect(bogotaStamp(null)).toBe('');
    expect(bogotaStamp('no-fecha')).toBe('');
  });
  it('filas y CSV seguro', () => {
    const rows = promoExportRows([
      {
        nombre: 'Ana, la de "arriba"',
        celular: '3001234567',
        autorizado_el: '2026-11-19T15:00:00Z',
        pedidos: 3,
        ultimo_pedido: null,
      },
      {
        nombre: '=HYPERLINK("x")',
        celular: '3109876543',
        autorizado_el: null,
        pedidos: null,
        ultimo_pedido: null,
      },
    ]);
    expect(rows[0]).toEqual({
      Nombre: 'Ana, la de "arriba"',
      Celular: '3001234567',
      'Autorizó promociones': '2026-11-19 10:00',
      Pedidos: 3,
    });
    expect(rows[1]?.Pedidos).toBe(0);
    const csv = toCsv(rows).split('\n');
    expect(csv[0]).toBe('Nombre,Celular,Autorizó promociones,Pedidos');
    expect(csv[1]).toBe('"Ana, la de ""arriba""",3001234567,2026-11-19 10:00,3');
    expect(csv[2]?.startsWith('"\'=HYPERLINK')).toBe(true);
  });
  it('lee la exportación como un único jsonb y descarta lo inválido', () => {
    expect(readPromoExport(null)).toEqual([]);
    expect(readPromoExport({ nombre: 'x' })).toEqual([]);
    expect(
      readPromoExport([
        {
          nombre: 'Ana',
          celular: '3001234567',
          autorizado_el: '2026-11-19T15:00:00Z',
          pedidos: 2,
          ultimo_pedido: '2026-11-19T16:00:00Z',
        },
        { nombre: 'Sin celular' },
        'basura',
      ]),
    ).toEqual([
      {
        nombre: 'Ana',
        celular: '3001234567',
        autorizado_el: '2026-11-19T15:00:00Z',
        pedidos: 2,
        ultimo_pedido: '2026-11-19T16:00:00Z',
      },
    ]);
  });
  it('nombre del archivo con el día de Bogotá', () => {
    expect(promoExportFileName(new Date('2026-11-20T02:00:00Z'))).toBe('clientes-promociones-2026-11-19.csv');
  });
});
