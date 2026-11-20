import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenGate } from './token-gate';

describe('createTokenGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('entrega de una el token que ya llegó y lo consume', async () => {
    const gate = createTokenGate();
    gate.set('abc');
    expect(gate.ready()).toBe(true);
    await expect(gate.wait(10_000)).resolves.toBe('abc');
    expect(gate.ready()).toBe(false);
  });

  it('espera el token que llega por callback antes del tope', async () => {
    const gate = createTokenGate();
    const pending = gate.wait(10_000);
    vi.advanceTimersByTime(3_000);
    gate.set('tarde');
    await expect(pending).resolves.toBe('tarde');
    expect(gate.ready()).toBe(false);
  });

  it('devuelve null si no llega token al tope', async () => {
    const gate = createTokenGate();
    const pending = gate.wait(10_000);
    vi.advanceTimersByTime(10_000);
    await expect(pending).resolves.toBeNull();
    // Un token posterior queda listo para el siguiente intento.
    gate.set('nuevo');
    await expect(gate.wait(10)).resolves.toBe('nuevo');
  });

  it('no reutiliza un token vencido o reiniciado', async () => {
    const gate = createTokenGate();
    gate.set('viejo');
    gate.clear();
    const pending = gate.wait(1_000);
    vi.advanceTimersByTime(1_000);
    await expect(pending).resolves.toBeNull();
  });

  it('un token vacío no despierta a nadie', async () => {
    const gate = createTokenGate();
    const pending = gate.wait(500);
    gate.set('');
    vi.advanceTimersByTime(500);
    await expect(pending).resolves.toBeNull();
  });

  it('cada token sirve a un solo envío', async () => {
    const gate = createTokenGate();
    const first = gate.wait(1_000);
    const second = gate.wait(1_000);
    gate.set('uno');
    await expect(first).resolves.toBe('uno');
    vi.advanceTimersByTime(1_000);
    await expect(second).resolves.toBeNull();
  });
});
