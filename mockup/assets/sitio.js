/* JP Smoke · comportamiento del sitio (mockup) */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const { money } = JP;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let catalog = JP.catalog();
  let settings = JP.settings();
  let promos = JP.promos();
  let events = JP.events();
  let cart = JP.cart();
  let coupon = null;
  const choice = {}; // presentación elegida por producto: true = combo

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = (id) => catalog.find((p) => p.id === id);

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3200);
  }

  function waLink(text) {
    return `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(text)}`;
  }

  /* ---------- Dirección visual (solo mockup) ---------- */
  function syncDirection() {
    const d = document.documentElement.dataset.direccion;
    $$('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === d)));
  }
  $$('[data-dir]').forEach((b) => b.addEventListener('click', () => { JP.setDirection(b.dataset.dir); syncDirection(); }));
  syncDirection();

  /* ---------- Contenido editable desde el panel ---------- */
  function renderSettings() {
    $('#logo-mark').innerHTML = JP.logoSvg;
    $$('[data-logo-mark]').forEach((el) => (el.innerHTML = JP.logoSvg));
    $('[data-hero-kicker]').textContent = settings.hero.kicker;
    const words = settings.hero.title.trim().split(/\s+/);
    $('[data-hero-title]').innerHTML = words.map((w, i) => `<span class="w${i + 1}">${esc(w)}</span>`).join(' ');
    $('[data-hero-text]').textContent = settings.hero.text;
    $$('[data-wa]').forEach((a) => { a.href = waLink('¡Hola JP Smoke! Quiero hacer un pedido 🔥'); a.target = '_blank'; a.rel = 'noopener'; });
    for (const key of ['rappi', 'didi']) {
      const ch = settings.channels[key];
      $$(`[data-channel="${key}"]`).forEach((a) => { a.hidden = !ch.visible; a.href = ch.url; });
    }
    $$('[data-channel-label]').forEach((el) => (el.hidden = !(settings.channels.rappi.visible || settings.channels.didi.visible)));
    for (const [key, visible] of Object.entries(settings.sections)) {
      const el = $(`[data-section="${key}"]`);
      if (el) el.hidden = !visible;
    }
    $('[data-eta]').textContent = settings.delivery.eta;
    $('[data-min]').textContent = money(settings.delivery.min);
    $('#zones').innerHTML = settings.zones.map((z) => `<div class="zone ${z.active ? '' : 'off'}"><b>${esc(z.name)}</b><span>${z.active ? 'Domicilio ' + money(z.fee) : 'Pronto'}</span></div>`).join('') +
      '<div class="zone soon"><b>📍 Punto físico</b><span>Próximamente</span></div>';
    $('#hours').innerHTML = settings.hours.map(([d, h]) => `<div><dt>${esc(d)}</dt><dd>${esc(h)}</dd></div>`).join('');
  }

  /* ---------- Inicio: 4 productos que se despliegan ---------- */
  const heroCards = $('#hero-cards');
  let heroItems = [];
  function renderHero() {
    heroItems = catalog.filter((p) => p.hero && p.img).slice(0, 4);
    heroCards.innerHTML = heroItems.map((p, i) => `
      <button class="hcard" type="button" data-hero="${p.id}" style="z-index:${4 - i}" aria-label="${esc(p.name)}, ${money(p.price)}. Agregar al pedido">
        <img src="${p.img}" alt="" ${i < 2 ? 'fetchpriority="high"' : 'loading="lazy"'}>
        <span class="hcard-label"><b>${esc(p.name)}</b><span>${money(p.price)}</span></span>
      </button>`).join('');
    $$('[data-hero]').forEach((b) => b.addEventListener('click', () => addToCart(b.dataset.hero, false, b)));
    updateHero();
  }
  // Posición final de cada tarjeta: escritorio a los lados del titular; celular en abanico debajo
  function layout() {
    const vw = innerWidth, vh = innerHeight, mobile = vw < 760;
    if (mobile) return {
      start: [[0, 0.38, -10], [0, 0.38, -3], [0, 0.38, 4], [0, 0.38, 11]],
      end: [[-0.235, -0.11, -3], [0.235, -0.1, 3], [0.235 * -1, 0.15, 2], [0.235, 0.16, -3]],
      s0: 0.7, s1: 1, vw, vh,
    };
    return {
      start: [[0, 0.36, -12], [0, 0.36, -4], [0, 0.36, 4], [0, 0.36, 12]],
      end: [[-0.36, -0.16, -8], [-0.31, 0.22, 6], [0.36, -0.17, 7], [0.31, 0.21, -5]],
      s0: 0.62, s1: 1, vw, vh,
    };
  }
  let L = layout();
  addEventListener('resize', () => { L = layout(); updateHero(); });
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function updateHero() {
    const hero = $('#inicio');
    const rect = hero.getBoundingClientRect();
    const total = hero.offsetHeight - innerHeight;
    const raw = Math.min(1, Math.max(0, -rect.top / (total * 0.7)));
    const p = reduced ? 1 : ease(raw);
    hero.style.setProperty('--p', p.toFixed(3));
    hero.classList.toggle('is-spread', p > 0.55);
    $$('.hcard', heroCards).forEach((c, i) => {
      const a = L.start[i], b = L.end[i];
      if (!a) return;
      const x = (a[0] + (b[0] - a[0]) * p) * L.vw;
      const y = (a[1] + (b[1] - a[1]) * p) * L.vh;
      const r = a[2] + (b[2] - a[2]) * p;
      const s = L.s0 + (L.s1 - L.s0) * p;
      c.style.setProperty('--x', x.toFixed(1) + 'px');
      c.style.setProperty('--y', y.toFixed(1) + 'px');
      c.style.setProperty('--r', r.toFixed(2) + 'deg');
      c.style.setProperty('--s', s.toFixed(3));
      c.style.setProperty('--lbl', Math.max(0, (p - 0.55) / 0.45).toFixed(2));
    });
  }
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateHero(); headerOnScroll(); ticking = false; });
  }, { passive: true });

  // Chispas
  if (!reduced) {
    const em = $('.hero-embers');
    for (let i = 0; i < 22; i++) {
      const s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.animationDelay = (Math.random() * 7).toFixed(2) + 's';
      s.style.animationDuration = (5 + Math.random() * 5).toFixed(2) + 's';
      s.style.setProperty('--dx', (Math.random() * 120 - 60).toFixed(0) + 'px');
      em.append(s);
    }
  }

  /* ---------- Encabezado: se esconde al bajar, vuelve al subir ---------- */
  let lastY = scrollY;
  function headerOnScroll() {
    const y = scrollY;
    const drawerOpen = !$('#drawer').hidden;
    const hide = !drawerOpen && y > lastY && y > 400;
    $('#header').classList.toggle('is-hidden', hide);
    document.body.classList.toggle('hdr-hidden', hide);
    lastY = y;
  }
  $('#menu-btn').addEventListener('click', () => {
    const open = $('#drawer').hidden;
    $('#drawer').hidden = !open;
    $('#menu-btn').setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  });
  $$('#drawer a').forEach((a) => a.addEventListener('click', () => { $('#drawer').hidden = true; $('#menu-btn').setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }));

  /* ---------- Tarjetas de producto ---------- */
  function variantHtml(p) {
    if (!p.combo) return `<div class="price-one">${money(p.price)}</div>`;
    const c = !!choice[p.id];
    return `<div class="variant" role="group" aria-label="Presentación">
      <button type="button" data-variant="${p.id}" data-combo="0" aria-pressed="${!c}"><small>Sola</small><b>${money(p.price)}</b></button>
      <button type="button" data-variant="${p.id}" data-combo="1" aria-pressed="${c}"><small>Combo</small><b>${money(p.combo)}</b></button>
    </div>`;
  }
  function pcard(p) {
    return `<article class="pcard ${p.available ? '' : 'sold-out'}">
      <div class="pcard-img"><img src="${p.img}" alt="${esc(p.name)}" loading="lazy">${p.badge ? `<span class="tag tag-accent">${esc(p.badge)}</span>` : ''}</div>
      <div class="pcard-body"><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div>
      <div class="pcard-foot">${variantHtml(p)}
        ${p.available ? `<button class="btn btn-primary btn-block" type="button" data-add="${p.id}">＋ Agregar al pedido</button>` : '<button class="btn btn-soft btn-block" disabled>Agotado hoy</button>'}
      </div>
    </article>`;
  }
  function renderArsenal() {
    $('#arsenal-track').innerHTML = catalog.filter((p) => p.featured).map(pcard).join('');
  }
  $$('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
    const t = $('#arsenal-track');
    t.scrollBy({ left: Number(b.dataset.scroll) * (t.clientWidth * 0.8), behavior: reduced ? 'auto' : 'smooth' });
  }));

  /* ---------- Carta completa ---------- */
  let activeCat = 'todo';
  let query = '';
  function renderPills() {
    const counts = Object.fromEntries(JP.CATEGORIES.map((c) => [c.id, catalog.filter((p) => p.cat === c.id).length]));
    $('#carta-pills').innerHTML = [`<button class="pill" type="button" data-cat="todo" aria-pressed="${activeCat === 'todo'}">Todo</button>`]
      .concat(JP.CATEGORIES.map((c) => `<button class="pill" type="button" data-cat="${c.id}" aria-pressed="${activeCat === c.id}">${c.emoji} ${esc(c.name)} <span class="count">${counts[c.id]}</span></button>`)).join('');
    $('#carta-count').textContent = `${catalog.filter((p) => p.cat !== 'adicionales').length} platos y ${counts.adicionales} adicionales`;
  }
  function itemHtml(p) {
    if (p.cat === 'adicionales') {
      return `<div class="extra"><span>${esc(p.name)}${p.desc ? `<small>${esc(p.desc)}</small>` : ''}</span>
        <button class="add" type="button" data-add="${p.id}" ${p.available ? '' : 'disabled'}>＋ <b>${money(p.price)}</b></button></div>`;
    }
    const actions = !p.available ? '<span class="badge-out">Agotado hoy</span>'
      : p.combo
        ? `<button class="add" type="button" data-add="${p.id}" data-combo="0">＋ Sola <b>${money(p.price)}</b></button><button class="add primary" type="button" data-add="${p.id}" data-combo="1">＋ Combo <b>${money(p.combo)}</b></button>`
        : `<button class="add primary" type="button" data-add="${p.id}">＋ Agregar <b>${money(p.price)}</b></button>`;
    return `<article class="item ${p.available ? '' : 'sold-out'}">
      <div class="item-img">${p.img ? `<img src="${p.img}" alt="" loading="lazy">` : ''}</div>
      <div class="item-body"><h4>${esc(p.name)}</h4><p>${esc(p.desc)}</p><div class="item-actions">${actions}</div></div>
    </article>`;
  }
  function renderCarta() {
    const q = query.trim().toLowerCase();
    const html = JP.CATEGORIES.filter((c) => activeCat === 'todo' || c.id === activeCat).map((c) => {
      const items = catalog.filter((p) => p.cat === c.id && (!q || (p.name + ' ' + p.desc).toLowerCase().includes(q)));
      if (!items.length) return '';
      const grid = c.id === 'adicionales' ? 'extras' : 'items';
      return `<div class="cat-block" id="cat-${c.id}"><div class="cat-head"><h3>${esc(c.name)}</h3>${c.note ? `<p>${esc(c.note)}</p>` : ''}</div><div class="${grid}">${items.map(itemHtml).join('')}</div></div>`;
    }).join('');
    $('#carta-list').innerHTML = html || `<p class="empty">Nada con "${esc(query)}". Prueba con "costilla" o "tocineta".</p>`;
  }
  $('#carta-pills').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    activeCat = b.dataset.cat;
    renderPills(); renderCarta();
    $('#carta').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });
  $('#carta-search').addEventListener('input', (e) => { query = e.target.value; renderCarta(); });

  /* ---------- Promos, eventos, reseñas ---------- */
  function renderPromos() {
    const list = promos.filter((c) => c.visible && c.active);
    $('#coupon-list').innerHTML = list.map((c) => `<div class="coupon"><h3>${esc(c.title)}</h3><p>${esc(c.detail)} Vence ${new Date(c.until + 'T12:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}.</p>
      <div class="coupon-code"><code>${esc(c.code)}</code><button class="btn btn-soft btn-sm" type="button" data-apply-coupon="${esc(c.code)}">Usar cupón</button></div></div>`).join('') || '<p class="muted">Sin cupones por ahora.</p>';
  }
  function activeEvents() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    return events.filter((e) => e.active && e.from <= today && e.to >= today);
  }
  function renderEvents() {
    const list = activeEvents();
    const sec = list.filter((e) => e.section);
    $('#events').innerHTML = sec.map((e) => `<article class="event"><img src="${e.img}" alt="" loading="lazy"><div class="event-in"><span class="tag tag-gold">${esc(e.kicker)}</span><h3>${esc(e.title)}</h3><p>${esc(e.text)}</p><a class="btn btn-primary btn-sm" href="${esc(e.href)}">${esc(e.cta)}</a></div></article>`).join('');
    if (!sec.length) $('#eventos').hidden = true;
    const strip = list.filter((e) => e.strip);
    $('#strip').hidden = !strip.length;
    const items = strip.map((e) => `<a href="${esc(e.href)}">${esc(e.title)} · ${esc(e.kicker)}</a>`).join('');
    $('#strip-track').innerHTML = items.repeat(4) + items.repeat(4);
  }
  function renderReviews() {
    $('#reviews').innerHTML = JP.REVIEWS.map((r) => `<article class="review"><div class="stars" aria-label="${r.stars} de 5">${'★'.repeat(r.stars)}</div><blockquote>“${esc(r.text)}”</blockquote><footer><span class="avatar">${esc(r.name[0])}</span>${esc(r.name)}</footer></article>`).join('');
  }

  /* ---------- Intro de evento (antes de entrar) ---------- */
  function showIntro() {
    const force = new URLSearchParams(location.search).get('intro');
    let seen = false;
    try { seen = sessionStorage.getItem('jp:intro') === '1'; } catch { /* nada */ }
    const mode = force === 'aviso' || force === 'completa' ? force : settings.introMode;
    const ev = activeEvents().find((e) => e.intro);
    if (!ev || mode === 'ninguna' || (seen && !force)) return;
    const markSeen = () => { try { sessionStorage.setItem('jp:intro', '1'); } catch { /* nada */ } };
    if (mode === 'aviso') return showPopup(ev, markSeen);
    const el = $('#intro');
    $('#intro-bg').style.backgroundImage = `url(${ev.img})`;
    $('#intro-logo').innerHTML = JP.logoSvg;
    $('#intro-kicker').textContent = ev.kicker;
    $('#intro-title').textContent = ev.title;
    $('#intro-text').textContent = ev.text;
    $('#intro-cta').textContent = ev.cta;
    $('#intro-cta').href = ev.href;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => ($('#intro-bar').style.width = '100%')));
    setTimeout(() => el.classList.add('is-ready'), reduced ? 0 : 2400);
    const close = () => {
      el.classList.add('is-out');
      document.body.style.overflow = '';
      markSeen();
      setTimeout(() => (el.hidden = true), 900);
    };
    $('#intro-close').addEventListener('click', close);
    $('#intro-cta').addEventListener('click', close);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) close(); });
  }

  // Aviso centrado: aparece sobre el sitio ya cargado; si el evento capta datos, entrega un cupón
  function showPopup(ev, markSeen) {
    const el = $('#popup');
    const promo = promos.find((c) => c.code === ev.couponCode && c.active);
    $('#pop-kicker').textContent = ev.capture && promo ? promo.title : ev.kicker;
    $('#pop-title').textContent = ev.capture && promo ? 'Tu primera mordida va con descuento' : ev.title;
    $('#pop-text').textContent = ev.capture && promo ? 'Déjanos tus datos y te damos un cupón de bienvenida. Te llega por WhatsApp y lo usas en tu pedido.' : ev.text;
    $('#pop-body').innerHTML = ev.capture && promo ? `<form id="pop-form" novalidate>
        <div class="field"><label for="p-name">Nombre</label><input class="input" id="p-name" autocomplete="given-name" required></div>
        <div class="field"><label for="p-phone">Celular</label><input class="input" id="p-phone" inputmode="numeric" autocomplete="tel-national" placeholder="300 123 4567" required></div>
        <a class="terms-link" href="#">ⓘ Ver términos y condiciones del cupón</a>
        <input class="hp" tabindex="-1" autocomplete="off" id="p-hp" aria-hidden="true">
        <label class="check"><input type="checkbox" id="p-ok"> <span>He leído y acepto los términos y la <a href="#" style="color:var(--accent-2)">política de tratamiento de datos</a>, y autorizo a JP Smoke a enviarme este cupón por WhatsApp.</span></label>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Quiero mi cupón</button></form>`
      : `<a class="btn btn-primary btn-lg btn-block" href="${esc(ev.href)}" data-pop-close>${esc(ev.cta)}</a>`;
    const close = () => { el.hidden = true; document.body.style.overflow = ''; markSeen(); };
    $$('[data-pop-close]', el).forEach((b) => b.addEventListener('click', close));
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) close(); });
    $('#pop-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#p-name').value.trim(), phone = $('#p-phone').value.replace(/\D/g, '');
      const okName = name.length >= 2, okPhone = phoneOk(phone);
      $('#p-name').setAttribute('aria-invalid', String(!okName));
      $('#p-phone').setAttribute('aria-invalid', String(!okPhone));
      if (!okName || !okPhone) { toast('Revisa nombre y celular'); return; }
      if (!$('#p-ok').checked) { toast('Necesitamos tu autorización para enviarte el cupón'); return; }
      if ($('#p-hp').value) { close(); return; }
      const leads = JP.leads();
      if (leads.some((l) => l.phone === phone)) { toast('Este celular ya recibió su cupón de bienvenida'); return; }
      leads.push({ name, phone, at: Date.now(), coupon: promo.code, event: ev.id });
      JP.saveLeads(leads);
      $('#pop-title').textContent = `¡Listo, ${name.split(' ')[0]}!`;
      $('#pop-text').textContent = 'Te enviamos el cupón por WhatsApp. También puedes usarlo ya mismo:';
      $('#pop-body').innerHTML = `<div class="coupon"><div class="coupon-code"><code>${esc(promo.code)}</code><span class="tag tag-gold">${esc(promo.title)}</span></div></div>
        <button class="btn btn-primary btn-lg btn-block" type="button" id="pop-use">Usar en mi pedido</button>`;
      $('#pop-use').addEventListener('click', () => { close(); coupon = promo; toast(`Cupón ${promo.code} listo 🎟️`); $('#carta').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); });
    });
    setTimeout(() => { el.hidden = false; document.body.style.overflow = 'hidden'; ($('#p-name') || $('.popup-x')).focus(); }, reduced ? 0 : 1200);
  }

  /* ---------- Carrito ---------- */
  function cartCount() { return cart.reduce((a, it) => a + it.qty, 0); }
  function saveCart() { JP.saveCart(cart); syncCount(); }
  function syncCount() {
    $$('[data-cart-count]').forEach((el) => { el.textContent = cartCount(); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); });
  }
  function addToCart(id, combo, from) {
    const p = byId(id);
    if (!p || !p.available) return;
    combo = !!combo && !!p.combo;
    const found = cart.find((it) => it.id === id && it.combo === combo);
    if (found) found.qty += 1; else cart.push({ id, combo, qty: 1 });
    saveCart();
    flyTo(from);
    toast(`${p.name}${combo ? ' en combo' : ''} agregado 🔥`);
    if (!$('#cart').hidden) renderCart();
  }
  // El producto "vuela" al carrito
  function flyTo(from) {
    if (reduced || !from) return;
    const img = from.closest('.pcard, .item, .hcard')?.querySelector('img');
    const target = innerWidth < 760 ? $('.bottom-bar button') : $('.cart-btn');
    if (!img || !target) return;
    const a = img.getBoundingClientRect(), b = target.getBoundingClientRect();
    const ghost = img.cloneNode();
    Object.assign(ghost.style, { position: 'fixed', zIndex: 300, left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', objectFit: 'cover', borderRadius: '16px', transition: 'transform .7s cubic-bezier(.2,.7,.2,1), opacity .7s', pointerEvents: 'none' });
    document.body.append(ghost);
    requestAnimationFrame(() => {
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(.08)`;
      ghost.style.opacity = '.4';
    });
    setTimeout(() => ghost.remove(), 720);
  }

  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-variant]');
    if (v) { choice[v.dataset.variant] = v.dataset.combo === '1'; $$(`[data-variant="${v.dataset.variant}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.combo === v.dataset.combo))); return; }
    const add = e.target.closest('[data-add]');
    if (add) { const combo = add.dataset.combo != null ? add.dataset.combo === '1' : !!choice[add.dataset.add]; addToCart(add.dataset.add, combo, add); return; }
    const ap = e.target.closest('[data-apply-coupon]');
    if (ap) { applyCoupon(ap.dataset.applyCoupon, true); return; }
    if (e.target.closest('[data-open-cart]')) openCart();
    if (e.target.closest('[data-close-cart]') || e.target.id === 'cart-backdrop') closeCart();
    if (e.target.closest('[data-close-modal]') || e.target.classList.contains('modal')) closeModals();
  });

  function applyCoupon(code, open) {
    const c = promos.find((x) => x.code === String(code).trim().toUpperCase() && x.active);
    if (!c) { toast('Ese cupón no existe o ya venció'); return false; }
    coupon = c;
    toast(`Cupón ${c.code} listo. Se aplica al confirmar 🎟️`);
    if (open) openCart(); else renderCart();
    return true;
  }

  function lastFocus() { return document.activeElement; }
  let returnFocus = null;
  function openCart() {
    returnFocus = lastFocus();
    renderCart();
    $('#cart').hidden = false; $('#cart-backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#cart [data-close-cart]').focus();
  }
  function closeCart() {
    $('#cart').hidden = true; $('#cart-backdrop').hidden = true;
    document.body.style.overflow = '';
    returnFocus?.focus?.();
  }
  function renderCart() {
    const body = $('#cart-body'), foot = $('#cart-foot');
    if (!cart.length) {
      body.innerHTML = `<div class="cart-empty"><p class="display">Barril vacío</p><p>Todavía no has agregado nada.</p><a class="btn btn-primary" href="#carta" data-close-cart>Ver la carta</a></div>`;
      foot.innerHTML = '';
      return;
    }
    body.innerHTML = cart.map((it, i) => {
      const p = byId(it.id);
      if (!p) return '';
      const unit = it.combo ? p.combo : p.price;
      return `<div class="line">${p.img ? `<img src="${p.img}" alt="">` : '<span class="ph"></span>'}
        <div><h4>${esc(p.name)}</h4><small>${it.combo ? 'Combo · papas + gaseosa' : p.combo ? 'Sola' : ''} · ${money(unit)}</small></div>
        <div class="qty"><button type="button" data-q="${i}" data-d="-1" aria-label="Quitar uno">−</button><span>${it.qty}</span><button type="button" data-q="${i}" data-d="1" aria-label="Agregar uno">＋</button></div></div>`;
    }).join('');
    const single = cart.find((it) => !it.combo && byId(it.id)?.combo);
    if (single) {
      const p = byId(single.id);
      body.insertAdjacentHTML('beforeend', `<div class="upsell"><span>¿Pasas <b>${esc(p.name)}</b> a combo por ${money(p.combo - p.price)} más?</span><button class="btn btn-soft btn-sm" type="button" data-upsell="${cart.indexOf(single)}">Sí, combo</button></div>`);
    }
    const t = JP.priceCart(cart, catalog, coupon, null);
    foot.innerHTML = `
      <div class="coupon-row"><input class="input" id="coupon-in" placeholder="Cupón" value="${coupon ? esc(coupon.code) : ''}" aria-label="Código de cupón"><button class="btn btn-soft" type="button" id="coupon-btn">Aplicar</button></div>
      ${t.note ? `<p class="muted" style="margin:0;font-size:13px">${esc(t.note)}</p>` : ''}
      <div class="totals"><div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        ${t.discount ? `<div class="disc"><span>Descuento ${esc(coupon.code)}</span><span>−${money(t.discount)}</span></div>` : ''}
        <div><span>Domicilio</span><span class="muted">${coupon?.type === 'envio' && t.subtotal >= coupon.min ? 'Gratis' : 'Según tu barrio'}</span></div>
        <div class="grand"><span>Total</span><span>${money(t.total)}</span></div></div>
      ${t.subtotal < settings.delivery.min ? `<p class="form-error">El pedido mínimo es ${money(settings.delivery.min)}. Te faltan ${money(settings.delivery.min - t.subtotal)}.</p>` : ''}
      <button class="btn btn-primary btn-lg btn-block" type="button" id="go-checkout" ${t.subtotal < settings.delivery.min ? 'disabled' : ''}>Continuar con el pedido</button>`;
    $('#coupon-btn').addEventListener('click', () => applyCoupon($('#coupon-in').value, false));
    $('#go-checkout')?.addEventListener('click', () => { closeCart(); openCheckout(); });
  }
  $('#cart-body').addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) {
      const it = cart[Number(q.dataset.q)];
      it.qty += Number(q.dataset.d);
      if (it.qty <= 0) cart.splice(Number(q.dataset.q), 1);
      saveCart(); renderCart();
      return;
    }
    const up = e.target.closest('[data-upsell]');
    if (up) {
      const it = cart[Number(up.dataset.upsell)];
      const twin = cart.find((x) => x.id === it.id && x.combo);
      if (twin) { twin.qty += it.qty; cart.splice(cart.indexOf(it), 1); } else it.combo = true;
      saveCart(); renderCart();
    }
  });

  /* ---------- Pedido: datos → verificación → confirmación ---------- */
  const form = { name: '', phone: '', address: '', barrio: '', zone: '', notes: '', pay: '', cash: '', ok: false, promo: false };
  let startedAt = 0;
  function setStep(n) { $$('#co-steps li').forEach((li, i) => li.classList.toggle('is-on', i <= n)); }
  function openCheckout() {
    returnFocus = lastFocus();
    $('#checkout').hidden = false;
    document.body.style.overflow = 'hidden';
    stepData();
  }
  function closeModals() {
    $$('.modal').forEach((m) => (m.hidden = true));
    document.body.style.overflow = '';
    returnFocus?.focus?.();
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#cart').hidden) closeCart(); else closeModals(); } });

  const phoneOk = (v) => /^3\d{9}$/.test(v.replace(/\D/g, ''));
  function stepData(errorMsg) {
    setStep(0);
    startedAt = Date.now();
    const zones = settings.zones.filter((z) => z.active);
    $('#co-body').innerHTML = `
      <form class="form-grid" id="co-form" novalidate>
        <h2 class="display h-md span-2" id="co-title">¿A dónde lo llevamos?</h2>
        ${errorMsg ? `<p class="form-error span-2">${esc(errorMsg)}</p>` : ''}
        <div class="field"><label for="f-name">Nombre <span class="req">*</span></label><input class="input" id="f-name" autocomplete="name" required value="${esc(form.name)}"><span class="error"></span></div>
        <div class="field"><label for="f-phone">Celular <span class="req">*</span></label><input class="input" id="f-phone" inputmode="numeric" autocomplete="tel-national" placeholder="300 123 4567" required value="${esc(form.phone)}"><span class="error"></span></div>
        <div class="field span-2"><label for="f-address">Dirección <span class="req">*</span></label><input class="input" id="f-address" autocomplete="street-address" placeholder="Calle 68 # 60-71, apto 302" required value="${esc(form.address)}"><span class="error"></span></div>
        <div class="field"><label for="f-barrio">Barrio <span class="req">*</span></label><input class="input" id="f-barrio" required value="${esc(form.barrio)}"><span class="error"></span></div>
        <div class="field"><label for="f-zone">Localidad <span class="req">*</span></label><select class="select" id="f-zone" required><option value="">Elige</option>${zones.map((z) => `<option value="${z.id}" ${form.zone === z.id ? 'selected' : ''}>${esc(z.name)} · ${money(z.fee)}</option>`).join('')}</select><span class="error"></span></div>
        <div class="field span-2"><label for="f-notes">Indicaciones para el domiciliario</label><input class="input" id="f-notes" placeholder="Torre 2, portería, casa esquinera…" value="${esc(form.notes)}"></div>
        <fieldset class="field span-2" style="border:0;padding:0;margin:0"><legend style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:6px">¿Cómo pagas? <span class="req">*</span></legend>
          <div class="pay">${settings.payments.filter((m) => m.active).map((m) => `<label><input type="radio" name="pay" value="${esc(m.id)}" ${form.pay === m.id ? 'checked' : ''}>${esc(m.label)}</label>`).join('')}</div><span class="error"></span></fieldset>
        <div class="field span-2" id="cash-field" ${settings.payments.find((m) => m.id === form.pay)?.cash ? '' : 'hidden'}><label for="f-cash">¿Con cuánto pagas?</label><input class="input" id="f-cash" inputmode="numeric" placeholder="Para llevar las vueltas" value="${esc(form.cash)}"></div>
        <input class="hp" tabindex="-1" autocomplete="off" name="sitio_web" id="f-hp" aria-hidden="true">
        <label class="check span-2"><input type="checkbox" id="f-ok" ${form.ok ? 'checked' : ''}> <span>Autorizo a JP Smoke a tratar mis datos para gestionar y entregar este pedido, según la <a href="#">política de tratamiento de datos</a>. <span class="req">*</span></span></label>
        <label class="check span-2"><input type="checkbox" id="f-promo" ${form.promo ? 'checked' : ''}> <span>Quiero recibir promociones por WhatsApp (opcional).</span></label>
        <div class="antibot span-2"><span class="ok-mark">✓</span> Verificación antibots (Cloudflare Turnstile) · en producción es invisible casi siempre</div>
        <button class="btn btn-primary btn-lg btn-block span-2" type="submit">Continuar</button>
      </form>`;
    $$('#co-form input[name="pay"]').forEach((r) => r.addEventListener('change', () => ($('#cash-field').hidden = !settings.payments.find((m) => m.id === r.value)?.cash)));
    $('#co-form').addEventListener('submit', (e) => { e.preventDefault(); submitData(); });
    $('#f-name').focus();
  }
  function fieldError(id, msg) {
    const input = $(id);
    const err = input.closest('.field').querySelector('.error');
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err) err.textContent = msg || '';
    return !msg;
  }
  function submitData() {
    form.name = $('#f-name').value.trim();
    form.phone = $('#f-phone').value.trim();
    form.address = $('#f-address').value.trim();
    form.barrio = $('#f-barrio').value.trim();
    form.zone = $('#f-zone').value;
    form.notes = $('#f-notes').value.trim();
    form.pay = $('#co-form input[name="pay"]:checked')?.value || '';
    form.cash = $('#f-cash').value.trim();
    form.ok = $('#f-ok').checked;
    form.promo = $('#f-promo').checked;
    let ok = true;
    ok = fieldError('#f-name', form.name.length < 3 ? 'Escribe tu nombre' : '') && ok;
    ok = fieldError('#f-phone', !phoneOk(form.phone) ? 'Celular colombiano de 10 dígitos (empieza por 3)' : '') && ok;
    ok = fieldError('#f-address', !/\d/.test(form.address) || form.address.length < 8 ? 'Escribe la dirección completa con número' : '') && ok;
    ok = fieldError('#f-barrio', form.barrio.length < 3 ? 'Escribe tu barrio' : '') && ok;
    ok = fieldError('#f-zone', !form.zone ? 'Elige tu localidad' : '') && ok;
    const payErr = $('#co-form .pay').parentElement.querySelector('.error');
    payErr.textContent = form.pay ? '' : 'Elige cómo pagas';
    ok = !!form.pay && ok;
    if (!form.ok) { toast('Necesitamos tu autorización de datos para entregar el pedido'); ok = false; }
    if (!ok) { $('#co-form [aria-invalid="true"]')?.focus(); return; }
    // Capas antibots simuladas (en producción las valida la Edge Function)
    const bot = $('#f-hp').value || Date.now() - startedAt < settings.security.minFillSeconds * 1000;
    if (bot) { stepData('No pudimos procesar el pedido. Intenta de nuevo.'); return; }
    const phone = form.phone.replace(/\D/g, '');
    const recent = JP.orders().filter((o) => o.customer.phone === phone && Date.now() - o.at < 3600000).length;
    if (recent >= settings.security.maxPerHourPhone) { stepData('No pudimos procesar el pedido. Si ya pediste, escríbenos por WhatsApp.'); return; }
    stepConfirm();
  }
  function stepConfirm() {
    setStep(1);
    const zone = settings.zones.find((z) => z.id === form.zone);
    const t = JP.priceCart(cart, catalog, coupon, zone.fee);
    const payLabel = settings.payments.find((m) => m.id === form.pay)?.label || form.pay;
    const ph = form.phone.replace(/\D/g, '');
    const lines = cart.map((it) => { const p = byId(it.id); return `<div><span>${it.qty} × ${esc(p.name)}${it.combo ? ' (combo)' : ''}</span><span>${money((it.combo ? p.combo : p.price) * it.qty)}</span></div>`; }).join('');
    $('#co-body').innerHTML = `
      <h2 class="display h-md" id="co-title">Confirma tu pedido</h2>
      <div class="summary">${lines}
        <div class="muted"><span>Domicilio a ${esc(zone.name)}</span><span>${t.fee ? money(t.fee) : 'Gratis'}</span></div>
        ${t.discount ? `<div class="muted"><span>Cupón ${esc(coupon.code)}</span><span>−${money(t.discount)}</span></div>` : ''}
        ${coupon?.type === 'regalo' && t.subtotal >= coupon.min ? `<div class="muted"><span>🎁 ${esc(coupon.title)}</span><span>$0</span></div>` : ''}
        <div style="font-weight:800;font-size:18px"><span>Total</span><span>${money(t.total)}</span></div>
        <div class="muted"><span>${esc(form.name)} · ${esc(form.address)}, ${esc(form.barrio)}</span><span>${esc(payLabel)}</span></div>
      </div>
      <div class="confirm-actions">
        <button class="btn btn-primary btn-lg btn-block" type="button" id="send-order">Confirmar pedido · ${money(t.total)}</button>
        <button class="btn btn-soft btn-block" type="button" id="co-back">Cambiar datos</button>
        <p class="muted center" style="font-size:12px;margin:4px 0 0">Te llegará la confirmación por WhatsApp al ${ph.slice(0, 3)} ${ph.slice(3, 6)} ${ph.slice(6)}.</p>
      </div>`;
    $('#send-order').addEventListener('click', () => place(t, zone));
    $('#co-back').addEventListener('click', () => stepData());
  }
  function place(t, zone) {
    const orders = JP.orders();
    const code = 'JP-' + String(orders.length + 1).padStart(4, '0');
    const items = cart.map((it) => { const p = byId(it.id); return { id: p.id, name: p.name, qty: it.qty, combo: it.combo, unit: it.combo ? p.combo : p.price }; });
    orders.push({
      code, at: Date.now(), channel: 'web', status: 'nuevo',
      customer: { name: form.name, phone: form.phone.replace(/\D/g, ''), address: form.address, barrio: form.barrio, zone: zone.name, notes: form.notes },
      items, pay: form.pay, cash: form.cash, subtotal: t.subtotal, discount: t.discount, fee: t.fee, total: t.total, coupon: coupon?.code || null,
      token: JP.newToken(),
    });
    JP.saveOrders(orders);
    const order = orders[orders.length - 1];
    JP.saveMine([{ code, token: order.token, at: order.at }].concat(JP.mine()).slice(0, 10));
    cart = []; coupon = null; saveCart();
    $('#co-body').innerHTML = `<div class="done">
      <p class="eyebrow">Pedido recibido</p>
      <p class="code">${code}</p>
      <p class="muted">Ya le llegó al parrillero. Entrega estimada: ${esc(settings.delivery.eta)}. Puedes seguirlo en vivo con tu enlace único; también lo verás en esta página mientras esté activo.</p>
      <div class="timeline" aria-hidden="true"><span class="on"></span><span></span><span></span><span></span><span></span></div>
      <div class="timeline-labels"><span>Recibido</span><span>Confirmado</span><span>En el barril</span><span>En camino</span><span>Entregado</span></div>
      <a class="btn btn-primary btn-lg btn-block" href="${JP.trackUrl(order)}">Seguir mi pedido</a>
      <button class="btn btn-soft btn-block" type="button" id="copy-track">Copiar enlace de seguimiento</button>
      <button class="popup-later" type="button" data-close-modal>Seguir mirando la carta</button></div>`;
    $('#copy-track').addEventListener('click', async () => {
      const url = new URL(JP.trackUrl(order), location.href).href;
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Guárdalo o compártelo'); } catch { prompt('Copia tu enlace de seguimiento:', url); }
    });
    renderTracker();
  }

  /* ---------- Mi pedido activo (sin cuenta: se recuerda en este navegador) ---------- */
  function activeMine() {
    const orders = JP.orders();
    return JP.mine().map((m) => orders.find((o) => o.code === m.code && o.token === m.token)).filter((o) => o && !['entregado', 'cancelado'].includes(o.status) && Date.now() - o.at < 8 * 3600000);
  }
  function renderTracker() {
    const o = activeMine()[0];
    const el = $('#tracker');
    el.hidden = !o;
    if (!o) return;
    const label = Object.fromEntries(JP.STATES)[o.status];
    el.href = JP.trackUrl(o);
    el.innerHTML = `<span class="tracker-dot"></span><span><b>Tu pedido ${esc(o.code)}</b><small>${esc(label)}</small></span><span aria-hidden="true">→</span>`;
  }

  /* ---------- Seguir un pedido con código + últimos 4 dígitos ---------- */
  $$('[data-open-track]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    returnFocus = lastFocus();
    const mine = JP.mine();
    const orders = JP.orders();
    const recent = mine.map((m) => orders.find((o) => o.code === m.code && o.token === m.token)).filter(Boolean).slice(0, 3);
    $('#track-recent').innerHTML = recent.length ? `<p class="eyebrow" style="margin:0">En este celular</p>${recent.map((o) => `<a class="zone" href="${JP.trackUrl(o)}"><b>${esc(o.code)}</b><span>${esc(Object.fromEntries(JP.STATES)[o.status] || 'Cancelado')} →</span></a>`).join('')}` : '';
    $('#track').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#t-code').focus();
  }));
  $('#track-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#t-code').value.trim().toUpperCase().replace(/^(\d+)$/, 'JP-$1');
    const last4 = $('#t-last').value.replace(/\D/g, '');
    const o = JP.orders().find((x) => x.code === code && x.customer.phone.endsWith(last4) && last4.length === 4);
    if (!o) { $('#track-error').hidden = false; return; }
    if (!o.token) { o.token = JP.newToken(); const l = JP.orders().map((x) => (x.code === o.code ? o : x)); JP.saveOrders(l); }
    location.href = JP.trackUrl(o);
  });

  /* ---------- Cotización ---------- */
  $('#open-quote').addEventListener('click', () => { returnFocus = lastFocus(); $('#quote').hidden = false; document.body.style.overflow = 'hidden'; $('#q-tipo').focus(); });
  $('#quote-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const req = ['#q-tipo', '#q-nombre', '#q-msg'];
    let ok = req.every((s) => $(s).value.trim());
    req.forEach((s) => $(s).setAttribute('aria-invalid', String(!$(s).value.trim())));
    const ph = phoneOk($('#q-cel').value); $('#q-cel').setAttribute('aria-invalid', String(!ph)); ok = ok && ph;
    if (!$('#q-ok').checked) { toast('Falta la autorización de datos'); ok = false; }
    if (!ok) return;
    closeModals(); e.target.reset();
    toast('Solicitud enviada. Te escribimos en menos de 24 h ✔');
  });

  /* ---------- Aparición al hacer scroll ---------- */
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));

  /* ---------- Cambios hechos en el panel (otra pestaña) ---------- */
  addEventListener('storage', (e) => {
    if (!e.key?.startsWith('jp:')) return;
    catalog = JP.catalog(); settings = JP.settings(); promos = JP.promos(); events = JP.events();
    if (e.key === JP.KEYS.dir) { document.documentElement.dataset.direccion = JP.direction(); syncDirection(); }
    renderAll();
  });

  function renderAll() {
    renderSettings(); renderHero(); renderArsenal(); renderPills(); renderCarta(); renderPromos(); renderEvents(); renderReviews(); syncCount(); renderTracker();
  }
  renderAll();
  showIntro();
})();
