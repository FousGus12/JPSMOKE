import { describe, expect, it } from 'vitest';
import { normalizeColombianMobile, toWhatsAppNumber } from './phone';

describe('normalizeColombianMobile', () => {
  it.each([
    ['300 123 4567', '3001234567'],
    ['+57 300-123-4567', '3001234567'],
    ['57 (310) 555 0000', '3105550000'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeColombianMobile(input)).toBe(expected);
  });
  it.each(['601 555 1234', '300123456', '', '30012345678'])('rechaza %s', (input) => {
    expect(normalizeColombianMobile(input)).toBeNull();
  });
});

describe('toWhatsAppNumber', () => {
  it('antepone 57', () => expect(toWhatsAppNumber('3001234567')).toBe('573001234567'));
  it('falla con un número inválido', () => expect(() => toWhatsAppNumber('123')).toThrow());
});
