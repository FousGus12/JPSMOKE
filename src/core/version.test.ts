import { describe, expect, it } from 'vitest';
import { isNewVersion, parseBuildId } from './version';

describe('parseBuildId', () => {
  it('lee el id de la respuesta', () => {
    expect(parseBuildId({ id: 'abc123' })).toBe('abc123');
    expect(parseBuildId({ id: ' abc123 ' })).toBe('abc123');
  });
  it('rechaza respuestas que no son un id', () => {
    for (const bad of [null, undefined, 'abc', 42, {}, { id: 7 }, { id: '  ' }, []])
      expect(parseBuildId(bad)).toBeNull();
  });
});

describe('isNewVersion', () => {
  it('avisa cuando el id cambió', () => {
    expect(isNewVersion('abc', { id: 'def' })).toBe(true);
  });
  it('no avisa con el mismo id', () => {
    expect(isNewVersion('abc', { id: 'abc' })).toBe(false);
  });
  it('no avisa si falta cualquiera de los dos ids', () => {
    expect(isNewVersion('', { id: 'def' })).toBe(false);
    expect(isNewVersion(undefined, { id: 'def' })).toBe(false);
    expect(isNewVersion('abc', {})).toBe(false);
    expect(isNewVersion('abc', null)).toBe(false);
  });
});
