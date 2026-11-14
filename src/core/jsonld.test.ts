import { describe, expect, it } from 'vitest';
import { restaurantJsonLd, serializeJsonLd } from './jsonld';

const site = {
  restaurant: { name: 'JP Smoke' },
  hero: { text: 'Al barril' },
  whatsapp: '573001234567',
  instagram: '@jpsmoke.bta',
  categories: [
    { id: 'c1', name: 'Burgers' },
    { id: 'c2', name: 'Vacía' },
  ],
  products: [
    { categoryId: 'c1', name: 'La Ahumadora', description: 'Doble', price: 32000, image: '/media/a.webp' },
  ],
  zones: [
    { name: 'Engativá', active: true },
    { name: 'Kennedy', active: false },
  ],
};

describe('restaurantJsonLd', () => {
  const data = restaurantJsonLd(site, 'https://jp-smoke.vercel.app/');
  it('es un Restaurant con carta y precios en COP', () => {
    expect(data['@type']).toBe('Restaurant');
    expect(data.hasMenu.hasMenuSection).toHaveLength(1);
    expect(data.hasMenu.hasMenuSection[0]?.hasMenuItem[0]?.offers).toEqual({
      '@type': 'Offer',
      price: 32000,
      priceCurrency: 'COP',
    });
  });
  it('fotos con URL absoluta y solo zonas activas', () => {
    expect(data.hasMenu.hasMenuSection[0]?.hasMenuItem[0]?.image).toBe(
      'https://jp-smoke.vercel.app/media/a.webp',
    );
    expect(data.areaServed).toHaveLength(1);
  });
  it('dirección y mapa solo con el punto físico abierto', () => {
    expect(data.address.streetAddress).toBeUndefined();
    const open = restaurantJsonLd(
      { ...site, store: { open: true, address: 'Calle 68 # 60-71', mapsUrl: 'https://maps.app.goo.gl/x' } },
      '',
    );
    expect(open.address.streetAddress).toBe('Calle 68 # 60-71');
    expect(open.hasMap).toBe('https://maps.app.goo.gl/x');
  });
  it('no permite cerrar la etiqueta script', () =>
    expect(serializeJsonLd({ a: '</script>' })).not.toContain('</script>'));
});
