/* JP Smoke · datos de muestra y almacén del mockup.
   En el mockup, sitio y panel comparten datos con localStorage (mismo origen) para mostrar
   que lo que se edita en el panel se ve en el sitio. En producción esto vive en Supabase. */
(function () {
  const F = (n) => `assets/fotos/${n}.webp`;

  const CATEGORIES = [
    { id: 'burgers', name: 'Burgers al barril', emoji: '🍔', note: 'Precio sola / combo (papas + gaseosa)' },
    { id: 'costillas', name: 'Costillas y platos', emoji: '🔥', note: 'Acompañamientos incluidos' },
    { id: 'perros', name: 'Perros', emoji: '🌭', note: 'Precio solo / combo' },
    { id: 'papas', name: 'Papas y salchipapas', emoji: '🍟', note: 'Para compartir' },
    { id: 'arepas', name: 'Arepas', emoji: '🫓', note: '' },
    { id: 'bebidas', name: 'Bebidas', emoji: '🥤', note: '' },
    { id: 'adicionales', name: 'Adicionales', emoji: '➕', note: 'Súmalos a cualquier plato' },
  ];

  const PRODUCTS = [
    { id: 'la-ahumadora', cat: 'burgers', name: 'La Ahumadora', badge: 'La más pedida', desc: 'Doble carne ahumada 12 h al barril, cheddar fundido, tocineta crocante, cebolla caramelizada y salsa JP.', price: 32000, combo: 41000, img: F('burger-doble'), featured: true, hero: true, available: true },
    { id: 'pulled-jp', cat: 'burgers', name: 'Pulled JP', badge: 'Ahumada al barril', desc: 'Cerdo desmechado ahumado lento, coleslaw de la casa, pepinillos y BBQ de panela en pan brioche.', price: 31000, combo: 40000, img: F('burger-desmechada'), featured: true, hero: true, available: true },
    { id: 'barril-negro', cat: 'burgers', name: 'Barril Negro', badge: 'Pan de carbón', desc: 'Carne de 180 g, queso costeño fundido, chimichurri ahumado y plátano maduro en pan negro.', price: 30000, combo: 39000, img: F('burger-negra'), featured: true, available: true },
    { id: 'tocinazo', cat: 'burgers', name: 'Tocinazo', badge: 'Triple tocineta', desc: 'Carne de 150 g, triple tocineta, cheddar, cebolla crispy y mayonesa de chipotle.', price: 29000, combo: 38000, img: F('burger-tocineta'), featured: false, available: true },
    { id: 'doble-humo', cat: 'burgers', name: 'Doble Humo', badge: 'Smash x2', desc: 'Dos carnes smash con costra, doble americano, pepinillos y salsa de la casa.', price: 34000, combo: 43000, img: F('burger-doble-carne'), featured: true, available: true },
    { id: 'la-clasica', cat: 'burgers', name: 'La Clásica', badge: 'Sin vueltas', desc: 'Carne de 150 g, queso, lechuga, tomate, cebolla y salsa JP.', price: 22000, combo: 31000, img: F('burger-clasica'), featured: false, available: true },
    { id: 'costillas-barril', cat: 'costillas', name: 'Costillas al barril', badge: 'Medio costillar', desc: 'Costillas de cerdo ahumadas 6 h, glaseadas en BBQ de panela, con papas y ensalada.', price: 42000, combo: null, img: F('costillas'), featured: true, hero: true, available: true },
    { id: 'picada-tribu', cat: 'costillas', name: 'Picada de la Tribu', badge: 'Para 2 o más', desc: '600 g de poder: costillas, bondiola, chorizo artesanal, chicharrón, papas criollas y arepitas.', price: 68000, combo: null, img: F('costillas-parrilla'), featured: true, available: true },
    { id: 'perro-humo', cat: 'perros', name: 'Perro Humo', badge: 'Clásico bogotano', desc: 'Salchicha americana ahumada, tocineta, queso, papa ripio y salsas de la casa.', price: 19000, combo: 28000, img: F('perro'), featured: false, available: true },
    { id: 'perro-cargado', cat: 'perros', name: 'Perro Cargado', badge: 'Carne a elección', desc: 'Salchicha + 140 g de cerdo desmechado o carne ahumada, piña, queso gratinado y maíz.', price: 24000, combo: 33000, img: F('perros-cargados'), featured: true, available: true },
    { id: 'papas-jp', cat: 'papas', name: 'Papas JP cargadas', badge: 'La monstruosa', desc: 'Papa en casco, cerdo desmechado, cheddar fundido, tocineta, cebollín y salsa de ajo.', price: 26000, combo: null, img: F('papas-cargadas'), featured: true, hero: true, available: true },
    { id: 'salchipapa-barril', cat: 'papas', name: 'Salchipapa del barril', badge: 'Para compartir', desc: 'Doble papa, salchicha y chorizo ahumado, tocineta, queso y salsas.', price: 28000, combo: null, img: F('papas-tocineta'), featured: false, available: true },
    { id: 'arepa-costilla', cat: 'arepas', name: 'Arepa de costilla', badge: 'Rellena', desc: 'Arepa de maíz peto rellena de costilla desmechada, queso doble crema y hogao.', price: 21000, combo: 30000, img: F('arepa'), featured: false, available: true },
    { id: 'gaseosa-400', cat: 'bebidas', name: 'Gaseosa 400 ml', badge: '', desc: 'Coca-Cola, Sprite o Quatro.', price: 5000, combo: null, img: F('gaseosa'), featured: false, available: true },
    { id: 'gaseosa-15', cat: 'bebidas', name: 'Gaseosa 1,5 L', badge: 'Para la mesa', desc: 'Ideal para la picada.', price: 9000, combo: null, img: F('gaseosas'), featured: false, available: true },
    { id: 'limonada-panela', cat: 'bebidas', name: 'Limonada de panela', badge: 'De la casa', desc: 'Panela, limón y hierbabuena. 500 ml.', price: 7000, combo: null, img: F('gaseosa'), featured: false, available: false },
    { id: 'add-tocineta', cat: 'adicionales', name: 'Tocineta', desc: '2 tiras', price: 4000, combo: null, available: true },
    { id: 'add-queso', cat: 'adicionales', name: 'Queso extra', desc: 'Cheddar o costeño', price: 3000, combo: null, available: true },
    { id: 'add-carne', cat: 'adicionales', name: 'Carne ahumada 150 g', desc: '', price: 9000, combo: null, available: true },
    { id: 'add-papas', cat: 'adicionales', name: 'Porción de papas', desc: '', price: 8000, combo: null, available: true },
    { id: 'add-huevo', cat: 'adicionales', name: 'Huevo frito', desc: '', price: 2000, combo: null, available: true },
  ];

  const SETTINGS = {
    whatsapp: '573001234567',
    whatsappLabel: '300 123 4567',
    instagram: '@jpsmoke.bta',
    tiktok: '@jpsmoke.bta',
    hero: {
      title: 'JP Smoke',
      kicker: 'Hamburguesas al barril · Bogotá',
      text: 'Carne ahumada lento en barril, con leña y paciencia. Llega a tu puerta todavía oliendo a humo.',
    },
    channels: {
      rappi: { visible: false, url: 'https://www.rappi.com.co/' },
      didi: { visible: false, url: 'https://web.didi-food.com/' },
    },
    sections: { eventos: true, arsenal: true, carta: true, promos: true, tour: true, resenas: true, cobertura: true },
    delivery: { min: 25000, eta: '35–50 min' },
    zones: [
      { id: 'engativa', name: 'Engativá', fee: 5000, active: true },
      { id: 'barrios-unidos', name: 'Barrios Unidos', fee: 5000, active: true },
      { id: 'teusaquillo', name: 'Teusaquillo', fee: 6000, active: true },
      { id: 'suba', name: 'Suba', fee: 7000, active: true },
      { id: 'fontibon', name: 'Fontibón', fee: 7000, active: true },
      { id: 'chapinero', name: 'Chapinero', fee: 8000, active: true },
      { id: 'kennedy', name: 'Kennedy', fee: 8000, active: false },
    ],
    hours: [
      ['Lunes a miércoles', '12:00 m. – 9:00 p. m.'],
      ['Jueves a sábado', '12:00 m. – 11:00 p. m.'],
      ['Domingo y festivos', '12:00 m. – 8:00 p. m.'],
    ],
    introMode: 'completa', // completa | aviso | ninguna
    payments: [
      { id: 'efectivo', label: 'Efectivo', active: true, cash: true },
      { id: 'nequi', label: 'Nequi', active: true },
      { id: 'daviplata', label: 'Daviplata', active: true },
      { id: 'transferencia', label: 'Transferencia', active: true },
      { id: 'datafono', label: 'Datáfono', active: true },
    ],
    security: { level: 'recomendada', turnstile: true, maxPerHourPhone: 3, maxPerHourIp: 10, minFillSeconds: 4 },
  };

  const PROMOS = [
    { code: 'HUMO20', type: 'porcentaje', value: 20, min: 40000, visible: true, active: true, title: '20% de inauguración', detail: 'En pedidos desde $40.000. Un uso por celular.', until: '2026-11-30', uses: 37, maxUses: 300 },
    { code: 'ENVIOGRATIS', type: 'envio', value: 0, min: 60000, visible: true, active: true, title: 'Domicilio gratis', detail: 'En pedidos desde $60.000.', until: '2026-12-31', uses: 12, maxUses: null },
    { code: 'FRIOBOGOTA', type: 'regalo', value: 7000, min: 50000, visible: false, active: true, title: 'Limonada de panela de cortesía', detail: 'Jueves a sábado después de las 7 p. m.', until: '2026-12-31', uses: 8, maxUses: null },
    { code: 'BIENVENIDA10', type: 'porcentaje', value: 10, min: 25000, visible: false, active: true, title: '10% en tu primer pedido', detail: 'Se entrega con el aviso de bienvenida.', until: '2026-12-31', uses: 4, maxUses: null },
    { code: 'COMBOJP', type: 'valor', value: 5000, min: 30000, visible: false, active: false, title: '$5.000 en combos', detail: 'Cupón secreto para clientes recurrentes.', until: '2026-12-15', uses: 0, maxUses: 100 },
  ];

  const EVENTS = [
    { id: 'inauguracion', capture: true, couponCode: 'BIENVENIDA10', title: 'Gran apertura JP Smoke', kicker: 'Sábado 15 de noviembre', text: 'Encendemos los barriles. 20% en toda la carta con el código HUMO20 y sorpresas en cada pedido.', img: F('fuego'), cta: 'Pedir con 20%', href: '#carta', intro: true, strip: true, section: true, active: true, from: '2026-11-01', to: '2026-11-30' },
    { id: 'jueves-costilla', title: 'Jueves de costilla', kicker: 'Todos los jueves', text: 'Medio costillar + gaseosa a $45.000.', img: F('costillas'), cta: 'Ver costillas', href: '#carta', intro: false, strip: true, section: true, active: true, from: '2026-11-01', to: '2026-12-31' },
    { id: 'punto-fisico', title: 'Punto físico en camino', kicker: 'Próximamente', text: 'Estamos montando el templo del humo. Muy pronto podrás venir por tu burger.', img: F('humo'), cta: 'Avísame', href: '#cobertura', intro: false, strip: false, section: true, active: true, from: '2026-11-01', to: '2027-03-01' },
  ];

  const REVIEWS = [
    { name: 'Camila R.', stars: 5, text: 'La Ahumadora llegó caliente y oliendo a leña. Se nota que no es parrilla de gas.' },
    { name: 'Andrés P.', stars: 5, text: 'Pedí por la página, me llamaron a confirmar y en 40 minutos estaba en la puerta.' },
    { name: 'Laura M.', stars: 5, text: 'Las papas cargadas alcanzan para dos. La costilla se deshace.' },
  ];

  const KEYS = { catalog: 'jp:catalog', settings: 'jp:settings', promos: 'jp:promos', events: 'jp:events', orders: 'jp:orders', dir: 'jp:direccion', cart: 'jp:cart', leads: 'jp:leads', mine: 'jp:mis-pedidos' };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : structuredClone(fallback);
    } catch { return structuredClone(fallback); }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento: el mockup sigue en memoria */ }
  }

  const money = (n) => '$' + Math.round(n).toLocaleString('es-CO');

  function priceCart(items, catalog, coupon, zoneFee) {
    const byId = Object.fromEntries(catalog.map((p) => [p.id, p]));
    let subtotal = 0;
    for (const it of items) {
      const p = byId[it.id];
      if (!p) continue;
      subtotal += (it.combo && p.combo ? p.combo : p.price) * it.qty;
    }
    let discount = 0;
    let fee = zoneFee ?? 0;
    let note = '';
    if (coupon) {
      if (subtotal < coupon.min) note = `Este cupón aplica desde ${money(coupon.min)}`;
      else if (coupon.type === 'porcentaje') discount = Math.round(subtotal * coupon.value / 100);
      else if (coupon.type === 'valor') discount = coupon.value;
      else if (coupon.type === 'envio') fee = 0;
      else if (coupon.type === 'regalo') note = coupon.title;
    }
    return { subtotal, discount, fee, total: Math.max(0, subtotal - discount + fee), note };
  }

  /* Pedidos de ejemplo de los últimos 30 días (generador fijo para que el panel tenga historia) */
  function seedOrders() {
    let s = 20261101;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const names = ['Camila Rojas', 'Andrés Pérez', 'Laura Méndez', 'Julián Torres', 'Valentina Cruz', 'Santiago Gómez', 'Daniela Ruiz', 'Felipe Castro', 'Mariana López', 'Sebastián Díaz', 'Natalia Vargas', 'Juan David Mora'];
    const barrios = ['Normandía', 'La Floresta', 'Galerías', 'Modelia', 'Niza', 'Santa Fe', 'El Lago', 'Park Way', 'Minuto de Dios', 'Bochica'];
    const pays = ['efectivo', 'nequi', 'nequi', 'transferencia', 'datafono', 'daviplata'];
    const chans = ['web', 'web', 'web', 'whatsapp', 'whatsapp', 'manual'];
    const sellable = PRODUCTS.filter((p) => p.cat !== 'adicionales');
    const orders = [];
    const now = Date.now();
    const phones = names.map(() => '3' + String(100000000 + Math.floor(rnd() * 899999999)));
    let n = 1;
    for (let d = 29; d >= 0; d--) {
      const count = 3 + Math.floor(rnd() * (d % 7 === 1 || d % 7 === 2 ? 9 : 6));
      for (let k = 0; k < count; k++) {
        const hour = [12, 13, 13, 18, 19, 19, 20, 20, 21, 14, 17][Math.floor(rnd() * 11)];
        const at = now - d * 86400000 + (hour - 13) * 3600000 + Math.floor(rnd() * 3600000);
        if (at > now) continue;
        const items = [];
        const lines = 1 + Math.floor(rnd() * 3);
        for (let l = 0; l < lines; l++) {
          const p = sellable[Math.floor(rnd() * sellable.length)];
          items.push({ id: p.id, name: p.name, qty: 1 + Math.floor(rnd() * 2), combo: !!p.combo && rnd() > .5, unit: 0 });
        }
        items.forEach((it) => { const p = PRODUCTS.find((x) => x.id === it.id); it.unit = it.combo ? p.combo : p.price; });
        const zone = SETTINGS.zones[Math.floor(rnd() * 6)];
        const subtotal = items.reduce((a, it) => a + it.unit * it.qty, 0);
        const ni = Math.floor(rnd() * names.length);
        const name = names[ni];
        orders.push({
          code: 'JP-' + String(n++).padStart(4, '0'),
          at,
          channel: chans[Math.floor(rnd() * chans.length)],
          status: 'entregado',
          customer: { name, phone: rnd() > .35 ? phones[ni] : '3' + String(100000000 + Math.floor(rnd() * 899999999)), address: `Calle ${20 + Math.floor(rnd() * 120)} # ${10 + Math.floor(rnd() * 90)}-${10 + Math.floor(rnd() * 80)}`, barrio: barrios[Math.floor(rnd() * barrios.length)], zone: zone.name, notes: '' },
          items, pay: pays[Math.floor(rnd() * pays.length)], subtotal, discount: 0, fee: zone.fee, total: subtotal + zone.fee, coupon: null, verified: true,
        });
      }
    }
    /* Los de hoy más recientes quedan activos para el tablero */
    const states = ['entregado', 'en_camino', 'en_cocina', 'en_cocina', 'confirmado', 'nuevo', 'nuevo'];
    orders.slice(-7).forEach((o, i) => { o.status = states[i]; o.at = now - (7 - i) * 6 * 60000; });
    orders[orders.length - 9] && (orders[orders.length - 9].status = 'cancelado', orders[orders.length - 9].cancelReason = 'Fuera de cobertura');
    return orders;
  }

  window.JP = {
    KEYS, CATEGORIES, REVIEWS, money, priceCart,
    catalog: () => read(KEYS.catalog, PRODUCTS),
    saveCatalog: (v) => write(KEYS.catalog, v),
    settings: () => ({ ...structuredClone(SETTINGS), ...read(KEYS.settings, SETTINGS) }),
    saveSettings: (v) => write(KEYS.settings, v),
    promos: () => read(KEYS.promos, PROMOS),
    savePromos: (v) => write(KEYS.promos, v),
    events: () => read(KEYS.events, EVENTS),
    saveEvents: (v) => write(KEYS.events, v),
    orders: () => { const o = read(KEYS.orders, null); if (o) return o; const seeded = seedOrders(); write(KEYS.orders, seeded); return seeded; },
    saveOrders: (v) => write(KEYS.orders, v),
    leads: () => read(KEYS.leads, []),
    saveLeads: (v) => write(KEYS.leads, v),
    mine: () => read(KEYS.mine, []),
    saveMine: (v) => write(KEYS.mine, v),
    // Enlace único: código + token aleatorio. En producción el token se guarda con hash y la función seguir-pedido solo devuelve estado.
    newToken: () => { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12); },
    trackUrl: (o) => `pedido.html?c=${encodeURIComponent(o.code)}&t=${encodeURIComponent(o.token)}`,
    STATES: [['nuevo', 'Recibido'], ['confirmado', 'Confirmado'], ['en_cocina', 'En el barril'], ['en_camino', 'En camino'], ['entregado', 'Entregado']],
    cart: () => read(KEYS.cart, []),
    saveCart: (v) => write(KEYS.cart, v),
    reset: () => { try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ } },
    direction: () => { try { return localStorage.getItem(KEYS.dir) || 'vino'; } catch { return 'vino'; } },
    setDirection: (d) => { document.documentElement.dataset.direccion = d; try { localStorage.setItem(KEYS.dir, d); } catch { /* nada */ } },
    logoSvg: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="9" width="26" height="26" rx="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M7 17h26M7 27h26" stroke="currentColor" stroke-width="2.4"/><path d="M15 7c0-3 3-3 3-6M21 7c0-3 3-3 3-6" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"/></svg>',
  };
  document.documentElement.dataset.direccion = window.JP.direction();
})();
