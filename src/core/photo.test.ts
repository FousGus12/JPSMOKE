import { describe, expect, it } from 'vitest';
import { fallbackWidth, photoHeight, photoWidths } from './photo';

const WANTED = [160, 320, 480, 800];

describe('photoWidths', () => {
  it('no pasa del original', () =>
    expect(photoWidths({ width: 600, height: 900 }, WANTED)).toEqual([160, 320, 480]));
  it('con recorte 4:5 limita por el alto del original', () =>
    // 1100×734 recortada a 4:5 da como máximo 587 px de ancho.
    expect(photoWidths({ width: 1100, height: 734 }, WANTED, 4 / 5)).toEqual([160, 320, 480]));
  it('cuadrada: limita por el lado menor', () =>
    expect(photoWidths({ width: 1100, height: 619 }, WANTED, 1)).toEqual([160, 320, 480]));
  it('foto muy pequeña: un solo ancho, el máximo posible', () =>
    expect(photoWidths({ width: 120, height: 90 }, WANTED)).toEqual([120]));
  it('ordena y quita repetidos', () =>
    expect(photoWidths({ width: 2000, height: 2000 }, [800, 160, 160])).toEqual([160, 800]));
  it('sin medidas no genera nada', () => expect(photoWidths({ width: 0, height: 10 }, WANTED)).toEqual([]));
});

describe('fallbackWidth', () => {
  it('el mayor hasta 480', () => expect(fallbackWidth([160, 320, 480, 800])).toBe(480));
  it('si todos pasan, el menor', () => expect(fallbackWidth([800, 1100])).toBe(800));
});

describe('photoHeight', () => {
  it('recorte', () => expect(photoHeight(320, { width: 1100, height: 734 }, 4 / 5)).toBe(400));
  it('proporcional', () => expect(photoHeight(550, { width: 1100, height: 734 })).toBe(367));
});
