import { describe, expect, it } from 'vitest';
import { formatCop } from './money';

describe('formatCop', () => {
  it('usa punto de miles y sin decimales', () => {
    expect(formatCop(120000)).toBe('$120.000');
    expect(formatCop(5000)).toBe('$5.000');
    expect(formatCop(0)).toBe('$0');
  });
  it('redondea y marca negativos', () => {
    expect(formatCop(1999.6)).toBe('$2.000');
    expect(formatCop(-20000)).toBe('−$20.000');
  });
  it('rechaza valores no numéricos', () => {
    expect(() => formatCop(Number.NaN)).toThrow();
  });
});
