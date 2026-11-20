import { describe, expect, it } from 'vitest';
import { decideAuthStep } from './auth-step';

const verified = { id: 'f1', status: 'verified' };
const unverified = { id: 'f0', status: 'unverified' };
const admin = { needs_totp: true };
const operador = { needs_totp: false };

describe('decideAuthStep', () => {
  it('sin ficha: cierra sesión aunque haya factores', () => {
    expect(decideAuthStep({ staff: null, currentLevel: 'aal2', totp: [verified] })).toEqual({
      kind: 'sin_ficha',
    });
    expect(decideAuthStep({ staff: undefined, currentLevel: null, totp: null })).toEqual({
      kind: 'sin_ficha',
    });
  });

  it('factor verificado sin aal2: pide el código antes que el cambio de clave', () => {
    expect(
      decideAuthStep({
        staff: { ...admin, must_change_password: true },
        currentLevel: 'aal1',
        totp: [unverified, verified],
      }),
    ).toEqual({ kind: 'verificar_totp', factorId: 'f1' });
  });

  it('AAL ilegible con factor verificado: pide el código', () => {
    expect(decideAuthStep({ staff: admin, currentLevel: null, totp: [verified] })).toEqual({
      kind: 'verificar_totp',
      factorId: 'f1',
    });
  });

  it('clave temporal (D39) va antes que inscribir el TOTP', () => {
    expect(
      decideAuthStep({ staff: { ...admin, must_change_password: true }, currentLevel: 'aal1', totp: [] }),
    ).toEqual({ kind: 'cambiar_clave' });
    expect(
      decideAuthStep({
        staff: { ...admin, must_change_password: true },
        currentLevel: 'aal2',
        totp: [verified],
      }),
    ).toEqual({ kind: 'cambiar_clave' });
  });

  it('necesita TOTP sin factor verificado: inscribir (lista ilegible cuenta como sin factor)', () => {
    expect(decideAuthStep({ staff: admin, currentLevel: 'aal1', totp: [unverified] })).toEqual({
      kind: 'inscribir_totp',
    });
    expect(decideAuthStep({ staff: admin, currentLevel: 'aal1', totp: null })).toEqual({
      kind: 'inscribir_totp',
    });
  });

  it('listo: admin en aal2 o operador sin factor', () => {
    expect(decideAuthStep({ staff: admin, currentLevel: 'aal2', totp: [verified] })).toEqual({
      kind: 'dentro',
    });
    expect(decideAuthStep({ staff: operador, currentLevel: 'aal1', totp: [] })).toEqual({ kind: 'dentro' });
    expect(
      decideAuthStep({
        staff: { ...operador, must_change_password: null },
        currentLevel: 'aal1',
        totp: null,
      }),
    ).toEqual({ kind: 'dentro' });
  });
});
