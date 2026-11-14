import { describe, expect, it } from 'vitest';
import { fitInside, mediaUrl } from './media';

const RID = '00000000-0000-4000-8000-0000000000a1';
describe('mediaUrl', () => {
  it('fotos de muestra en /media', () =>
    expect(mediaUrl('productos/a.webp', '/media/')).toBe('/media/productos/a.webp'));
  it('fotos subidas al bucket del restaurante', () =>
    expect(mediaUrl(`${RID}/x.webp`, '/media', 'http://127.0.0.1:57321')).toBe(
      `http://127.0.0.1:57321/storage/v1/object/public/carta/${RID}/x.webp`,
    ));
  it('respeta URLs completas', () =>
    expect(mediaUrl('https://x.co/a.webp', '/media')).toBe('https://x.co/a.webp'));
  it('sin foto', () => expect(mediaUrl(null, '/media')).toBeNull());
});
describe('fitInside', () => {
  it('reduce al lado mayor', () => expect(fitInside(4000, 3000)).toEqual({ width: 1200, height: 900 }));
  it('no agranda', () => expect(fitInside(800, 600)).toEqual({ width: 800, height: 600 }));
});
