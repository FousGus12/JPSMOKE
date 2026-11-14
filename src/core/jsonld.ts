// Datos estructurados schema.org para Google (SEO local): Restaurant con su carta (Menu).

interface JsonLdSite {
  restaurant: { name: string };
  hero: { text: string };
  whatsapp: string | null;
  instagram: string | null;
  categories: Array<{ id: string; name: string }>;
  products: Array<{
    categoryId: string;
    name: string;
    description: string;
    price: number;
    image: string | null;
  }>;
  zones: Array<{ name: string; active: boolean }>;
  store?: { open: boolean; address: string; mapsUrl: string };
}

export function restaurantJsonLd(site: JsonLdSite, siteUrl: string) {
  const abs = (path: string | null) =>
    path ? new URL(path, siteUrl || 'https://example.com').toString() : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: site.restaurant.name,
    description: site.hero.text || undefined,
    url: siteUrl || undefined,
    servesCuisine: ['Hamburguesas', 'Parrilla', 'Comida colombiana'],
    priceRange: '$$',
    telephone: site.whatsapp ? `+${site.whatsapp}` : undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.store?.open && site.store.address ? site.store.address : undefined,
      addressLocality: 'Bogotá',
      addressRegion: 'Bogotá D.C.',
      addressCountry: 'CO',
    },
    areaServed: site.zones
      .filter((zone) => zone.active)
      .map((zone) => ({ '@type': 'AdministrativeArea', name: zone.name })),
    hasMap: site.store?.open && site.store.mapsUrl ? site.store.mapsUrl : undefined,
    sameAs: site.instagram ? [`https://www.instagram.com/${site.instagram.replace('@', '')}`] : [],
    hasMenu: {
      '@type': 'Menu',
      name: 'Carta',
      hasMenuSection: site.categories
        .map((category) => ({
          '@type': 'MenuSection',
          name: category.name,
          hasMenuItem: site.products
            .filter((product) => product.categoryId === category.id)
            .map((product) => ({
              '@type': 'MenuItem',
              name: product.name,
              description: product.description || undefined,
              image: abs(product.image),
              offers: { '@type': 'Offer', price: product.price, priceCurrency: 'COP' },
            })),
        }))
        .filter((section) => section.hasMenuItem.length > 0),
    },
  };
}

/** JSON seguro para incrustar en <script type="application/ld+json"> (evita cerrar la etiqueta). */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
