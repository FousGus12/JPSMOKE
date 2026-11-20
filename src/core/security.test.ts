import { describe, expect, it } from 'vitest';
import { auditDetailText, maskPhone, nextAuditCursor, reasonLabel } from './security';

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
