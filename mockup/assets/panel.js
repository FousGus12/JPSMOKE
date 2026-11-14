/* JP Smoke · panel del negocio (mockup). En producción: React + Supabase con RLS por rol. */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const { money } = JP;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOW = () => Date.now();
  const DAY = 86400000;

  let role = 'admin';
  let view = 'resumen';
  let seenCodes = new Set(JP.orders().map((o) => o.code));

  const STATES = [
    ['nuevo', 'Nuevos'], ['confirmado', 'Confirmados'], ['en_cocina', 'En el barril'], ['en_camino', 'En camino'], ['entregado', 'Entregados hoy'],
  ];
  const STATE_LABEL = { nuevo: 'Nuevo', confirmado: 'Confirmado', en_cocina: 'En el barril', en_camino: 'En camino', entregado: 'Entregado', cancelado: 'Cancelado' };
  const NEXT = { nuevo: 'confirmado', confirmado: 'en_cocina', en_cocina: 'en_camino', en_camino: 'entregado' };
  const NEXT_LABEL = { nuevo: 'Confirmar', confirmado: 'Al barril', en_cocina: 'Despachar', en_camino: 'Entregado' };
  const PAY = { efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata', transferencia: 'Transferencia', datafono: 'Datáfono' };
  const payLabel = (id) => JP.settings().payments.find((m) => m.id === id)?.label || PAY[id] || id;
  const CHANNEL = { web: 'Web', whatsapp: 'WhatsApp', manual: 'Manual', rappi: 'Rappi', didi: 'DiDi' };

  const VIEWS = [
    { id: 'resumen', ico: '◎', name: 'Resumen', roles: ['admin', 'operador'] },
    { id: 'pedidos', ico: '🔥', name: 'Pedidos', roles: ['admin', 'operador'] },
    { id: 'ventas', ico: '📈', name: 'Ventas y estadísticas', roles: ['admin'] },
    { sep: 'Contenido' },
    { id: 'carta', ico: '🍔', name: 'Carta y precios', roles: ['admin'] },
    { id: 'promos', ico: '🎟️', name: 'Promociones y cupones', roles: ['admin'] },
    { id: 'eventos', ico: '📣', name: 'Eventos y banners', roles: ['admin'] },
    { id: 'sitio', ico: '✏️', name: 'Editar página', roles: ['admin'] },
    { sep: 'Negocio' },
    { id: 'clientes', ico: '👤', name: 'Clientes', roles: ['admin'] },
    { id: 'ajustes', ico: '⚙️', name: 'Ajustes y seguridad', roles: ['admin'] },
  ];

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3000);
  }
  const fmtTime = (t) => new Date(t).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  const fmtDate = (t) => new Date(t).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  const mins = (t) => Math.max(0, Math.round((NOW() - t) / 60000));
  const maskPhone = (p) => `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  /* ---------- Dirección visual ---------- */
  function syncDir() { const d = document.documentElement.dataset.direccion; $$('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === d))); }
  $$('[data-dir]').forEach((b) => b.addEventListener('click', () => { JP.setDirection(b.dataset.dir); syncDir(); }));
  syncDir();
  $$('[data-logo]').forEach((el) => (el.innerHTML = JP.logoSvg));

  /* ---------- Ingreso ---------- */
  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test($('#l-totp').value)) { toast('El código de 2 pasos debe tener 6 dígitos'); return; }
    role = $('#l-role').value;
    $('#login').hidden = true; $('#app').hidden = false;
    $('#who-name').textContent = role === 'admin' ? 'Admin JP' : 'Operador';
    $('#who-avatar').textContent = role === 'admin' ? 'A' : 'O';
    $('#who-role').textContent = role === 'admin' ? 'Administrador · 2FA activo' : 'Operador de pedidos';
    renderNav(); go('resumen');
  });
  $('#logout').addEventListener('click', () => { $('#app').hidden = true; $('#login').hidden = false; });
  $('#side-toggle').addEventListener('click', () => $('#side').classList.toggle('is-open'));
  // Aviso al parrillero aunque el panel esté en otra pestaña (en producción: notificación push del panel instalado)
  function syncBell() {
    const b = $('#bell');
    const p = 'Notification' in window ? Notification.permission : 'denied';
    b.textContent = p === 'granted' ? '🔔 Avisos activos' : '🔕 Activar avisos';
    b.setAttribute('aria-pressed', String(p === 'granted'));
  }
  $('#bell').addEventListener('click', async () => {
    if (!('Notification' in window)) { toast('Este navegador no permite avisos'); return; }
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'denied') toast('Los avisos están bloqueados en el navegador; actívalos en la configuración del sitio');
    syncBell(); beep();
  });
  syncBell();

  function renderNav() {
    const nuevos = JP.orders().filter((o) => o.status === 'nuevo').length;
    $('#side-nav').innerHTML = VIEWS.filter((v) => v.sep || v.roles.includes(role)).map((v) => v.sep
      ? (role === 'admin' ? `<div class="sep">${v.sep}</div>` : '')
      : `<button type="button" data-view="${v.id}" ${view === v.id ? 'aria-current="page"' : ''}><span class="ico">${v.ico}</span>${v.name}${v.id === 'pedidos' && nuevos ? `<span class="badge">${nuevos}</span>` : ''}</button>`).join('');
  }
  $('#side-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { go(b.dataset.view); $('#side').classList.remove('is-open'); } });
  function go(v) {
    view = v;
    const meta = VIEWS.find((x) => x.id === v);
    $('#view-title').textContent = meta.name;
    renderNav();
    ({ resumen, pedidos, ventas, carta, promos, eventos, sitio, clientes, ajustes })[v]();
    $('#view').scrollTop = 0; scrollTo(0, 0);
  }

  /* ---------- Modales ---------- */
  function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; $('#modal').hidden = false; $('#modal [data-close]').focus(); }
  function openDrawer(title, html) { $('#drawer-title').textContent = title; $('#drawer-body').innerHTML = html; $('#drawer').hidden = false; $('#backdrop').hidden = false; $('#drawer [data-close]').focus(); }
  function closeAll() { $('#modal').hidden = true; $('#drawer').hidden = true; $('#backdrop').hidden = true; }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target.id === 'backdrop' || e.target.id === 'modal') closeAll();
    if (e.target.closest('[data-new-order]')) newOrder();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  /* ---------- Datos derivados ---------- */
  const valid = (o) => o.status !== 'cancelado';
  function inRange(orders, days) { const from = startOfDay(NOW()) - (days - 1) * DAY; return orders.filter((o) => o.at >= from); }
  function byDay(orders, days) {
    const out = [];
    const base = startOfDay(NOW());
    for (let i = days - 1; i >= 0; i--) {
      const d0 = base - i * DAY;
      const list = orders.filter((o) => o.at >= d0 && o.at < d0 + DAY && valid(o));
      out.push({ t: d0, v: list.reduce((a, o) => a + o.total, 0), n: list.length });
    }
    return out;
  }
  function barChart(data, fmt, labels) {
    const max = Math.max(1, ...data.map((d) => d.v));
    return `<div class="chart" data-chart><div class="bars">${data.map((d, i) => `<div class="b ${i < data.length - 1 && labels === 'dias' ? '' : ''}" style="height:${Math.max(1.5, (d.v / max) * 100)}%" data-tip="${esc(d.label || fmtDate(d.t))}: ${esc(fmt(d))}" tabindex="0" aria-label="${esc(d.label || fmtDate(d.t))}: ${esc(fmt(d))}"></div>`).join('')}</div>
      <div class="axis"><span>${esc(data[0].label || fmtDate(data[0].t))}</span><span>${esc(data[data.length - 1].label || 'Hoy')}</span></div></div>`;
  }
  function wireTips(root = document) {
    $$('[data-chart]', root).forEach((ch) => {
      let tip;
      const show = (b) => { tip?.remove(); tip = document.createElement('div'); tip.className = 'tip'; tip.textContent = b.dataset.tip; ch.append(tip); const r = b.getBoundingClientRect(), c = ch.getBoundingClientRect(); tip.style.left = (r.left - c.left + r.width / 2) + 'px'; tip.style.top = (r.top - c.top) + 'px'; };
      $$('.b', ch).forEach((b) => { b.addEventListener('mouseenter', () => show(b)); b.addEventListener('focus', () => show(b)); b.addEventListener('mouseleave', () => tip?.remove()); b.addEventListener('blur', () => tip?.remove()); });
    });
  }
  function hbars(rows, fmt) {
    const max = Math.max(1, ...rows.map((r) => r.v));
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span>${esc(r.k)}</span><div class="track"><div class="fill" style="width:${(r.v / max) * 100}%"></div></div><span class="v">${esc(fmt(r))}</span></div>`).join('')}</div>`;
  }
  function group(orders, key) {
    const m = {};
    orders.filter(valid).forEach((o) => { const k = key(o); m[k] = m[k] || { k, v: 0, n: 0 }; m[k].v += o.total; m[k].n += 1; });
    return Object.values(m).sort((a, b) => b.v - a.v);
  }

  /* ---------- Resumen ---------- */
  function resumen() {
    const orders = JP.orders();
    const today = orders.filter((o) => o.at >= startOfDay(NOW()));
    const yest = orders.filter((o) => o.at >= startOfDay(NOW()) - DAY && o.at < startOfDay(NOW()));
    const sum = (l) => l.filter(valid).reduce((a, o) => a + o.total, 0);
    const active = orders.filter((o) => ['nuevo', 'confirmado', 'en_cocina', 'en_camino'].includes(o.status));
    const tick = today.filter(valid).length ? sum(today) / today.filter(valid).length : 0;
    const diff = sum(yest) ? Math.round((sum(today) / sum(yest) - 1) * 100) : 0;
    const admin = role === 'admin';
    $('#view').innerHTML = `
      <div class="kpis">
        ${admin ? `<div class="kpi"><small>Ventas de hoy</small><b>${money(sum(today))}</b><span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}% vs. ayer</span></div>` : ''}
        <div class="kpi"><small>Pedidos de hoy</small><b>${today.filter(valid).length}</b><span>${today.filter((o) => o.status === 'cancelado').length} cancelados</span></div>
        <div class="kpi"><small>Activos ahora</small><b>${active.length}</b><span>${active.filter((o) => o.status === 'nuevo').length} sin confirmar</span></div>
        ${admin ? `<div class="kpi"><small>Ticket promedio</small><b>${money(tick)}</b><span>hoy</span></div>` : '<div class="kpi"><small>Tiempo promedio</small><b>38 min</b><span>del pedido a la entrega</span></div>'}
      </div>
      <div class="grid-3">
        ${admin ? `<section class="card"><div class="card-head"><div><h2>Ventas · últimos 14 días</h2><p>Pedidos entregados y activos (sin cancelados)</p></div><button class="btn btn-soft btn-sm" type="button" data-goto="ventas">Ver estadísticas →</button></div>${barChart(byDay(orders, 14), (d) => `${money(d.v)} · ${d.n} pedidos`)}</section>` : ''}
        <section class="card" style="${admin ? '' : 'grid-column:1/-1'}"><div class="card-head"><div><h2>Pedidos activos</h2><p>Lo que hay que mover ya</p></div><button class="btn btn-primary btn-sm" type="button" data-goto="pedidos">Abrir tablero</button></div>
          <div class="rows">${active.slice().sort((a, b) => a.at - b.at).map((o) => `<div class="row"><div><b>${o.code} · ${esc(o.customer.name)}</b><small>${o.items.length} productos · hace ${mins(o.at)} min · <span class="ch ch-${o.channel}">${CHANNEL[o.channel]}</span></small></div><div class="right"><span class="st st-${o.status}">${STATE_LABEL[o.status]}</span><button class="btn btn-soft btn-sm" type="button" data-order="${o.code}">Ver</button></div></div>`).join('') || '<p class="muted">Sin pedidos activos.</p>'}</div></section>
      </div>
      ${admin ? `<div class="note">💡 <b>Antifraude de hoy:</b> 2 intentos bloqueados por límite de pedidos por celular y 1 por campo trampa. Detalle en Ajustes → Seguridad.</div>` : ''}`;
    wireTips();
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto);
    const o = e.target.closest('[data-order]'); if (o) orderDetail(o.dataset.order);
  });

  /* ---------- Pedidos ---------- */
  function pedidos() {
    const orders = JP.orders();
    const today0 = startOfDay(NOW());
    $('#view').innerHTML = `
      <div class="toolbar"><div class="note grow">Los pedidos de la web y los que se envían por WhatsApp desde la web entran solos. Los que llegan directo al WhatsApp se registran con <b>＋ Pedido manual</b>.</div></div>
      <div class="board">${STATES.map(([st, label]) => {
        const list = orders.filter((o) => o.status === st && (st !== 'entregado' || o.at >= today0)).sort((a, b) => a.at - b.at);
        return `<section class="col" aria-label="${label}"><div class="col-head"><b>${label}</b><span>${list.length}</span></div>
          ${list.slice(-12).map((o) => `<button class="ocard ${seenCodes.has(o.code) ? '' : 'is-new'}" type="button" data-order="${o.code}">
            <div class="ocard-top"><b>${o.code}</b><span class="ch ch-${o.channel}">${CHANNEL[o.channel]}</span></div>
            <p>${esc(o.customer.name)} · ${esc(o.customer.barrio)}</p>
            <p>${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}</p>
            <div class="ocard-foot"><b>${money(o.total)}</b><span class="age ${st !== 'entregado' && mins(o.at) > 45 ? 'late' : ''}">${st === 'entregado' ? fmtTime(o.at) : `hace ${mins(o.at)} min`}</span></div>
          </button>`).join('') || '<p class="muted" style="padding:8px">Vacío</p>'}</section>`;
      }).join('')}</div>`;
    orders.forEach((o) => seenCodes.add(o.code));
  }

  function setStatus(code, status, reason) {
    const orders = JP.orders();
    const o = orders.find((x) => x.code === code);
    o.status = status;
    if (reason) o.cancelReason = reason;
    o.log = (o.log || []).concat({ at: NOW(), status, by: role === 'admin' ? 'Admin JP' : 'Operador' });
    JP.saveOrders(orders);
    toast(`${code} → ${STATE_LABEL[status]}`);
    closeAll(); go(view);
  }
  function orderDetail(code) {
    const o = JP.orders().find((x) => x.code === code);
    if (!o) return;
    const wa = `https://wa.me/57${o.customer.phone}?text=${encodeURIComponent(`Hola ${o.customer.name.split(' ')[0]}, te escribimos de JP Smoke por tu pedido ${o.code} 🔥`)}`;
    const confirmMsg = `¡Hola ${o.customer.name.split(' ')[0]}! 🔥 Recibimos tu pedido ${o.code} en JP Smoke.\n${o.items.map((i) => `• ${i.qty} × ${i.name}${i.combo ? ' (combo)' : ''}`).join('\n')}\nTotal: ${money(o.total)} · Pago: ${payLabel(o.pay)}\nEntrega en ${JP.settings().delivery.eta} a ${o.customer.address}.`;
    const notify = `https://wa.me/57${o.customer.phone}?text=${encodeURIComponent(confirmMsg)}`;
    openDrawer(`${o.code} · ${STATE_LABEL[o.status]}`, `
      <div class="btn-row">${NEXT[o.status] ? `<button class="btn btn-primary" type="button" data-set="${NEXT[o.status]}">${NEXT_LABEL[o.status]} →</button>` : ''}
        <a class="btn btn-soft" href="${wa}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn-soft" href="tel:+57${o.customer.phone}">Llamar</a>
        <button class="btn btn-soft" type="button" onclick="window.print()">Comanda</button></div>
      ${o.token ? `<div class="note">🔗 El cliente sigue este pedido en su enlace único y ve cada cambio de estado al instante. <button class="btn btn-soft btn-sm" type="button" id="copy-link" style="margin-top:8px">Copiar enlace de seguimiento</button></div>` : ''}
      <dl class="kv"><dt>Cliente</dt><dd>${esc(o.customer.name)}</dd>
        <dt>Celular</dt><dd>${maskPhone(o.customer.phone)}</dd>
        <dt>Dirección</dt><dd>${esc(o.customer.address)}, ${esc(o.customer.barrio)} · ${esc(o.customer.zone)}</dd>
        ${o.customer.notes ? `<dt>Indicaciones</dt><dd>${esc(o.customer.notes)}</dd>` : ''}
        <dt>Pago</dt><dd>${esc(payLabel(o.pay))}${o.cash ? ` · paga con ${esc(o.cash)}` : ''}</dd>
        <dt>Canal</dt><dd><span class="ch ch-${o.channel}">${CHANNEL[o.channel]}</span> · ${fmtDate(o.at)} ${fmtTime(o.at)}</dd>
        ${o.cancelReason ? `<dt>Motivo</dt><dd>${esc(o.cancelReason)}</dd>` : ''}</dl>
      <div class="card"><div class="lines">${o.items.map((i) => `<div><span>${i.qty} × ${esc(i.name)}${i.combo ? ' (combo)' : ''}</span><span>${money(i.unit * i.qty)}</span></div>`).join('')}
        <div class="muted"><span>Domicilio</span><span>${money(o.fee)}</span></div>
        ${o.discount ? `<div class="muted"><span>Cupón ${esc(o.coupon)}</span><span>−${money(o.discount)}</span></div>` : ''}
        <div class="tot"><span>Total</span><span>${money(o.total)}</span></div></div></div>
      <div><h3 style="font-size:14px;margin-bottom:10px">Línea de tiempo</h3><ul class="tl"><li><div>Pedido recibido por ${CHANNEL[o.channel]}<small>${fmtTime(o.at)}</small></div></li>${(o.log || []).map((l) => `<li><div>${STATE_LABEL[l.status]} · ${esc(l.by)}<small>${fmtTime(l.at)}</small></div></li>`).join('')}</ul></div>
      ${!['entregado', 'cancelado'].includes(o.status) ? `<div class="field"><label for="cancel-r">Cancelar pedido</label><select class="select" id="cancel-r"><option value="">Motivo…</option><option>Cliente no responde</option><option>Fuera de cobertura</option><option>Pedido falso o broma</option><option>Producto agotado</option><option>El cliente canceló</option></select><button class="btn btn-soft btn-sm" type="button" id="cancel-btn" style="margin-top:6px">Cancelar con motivo</button><span class="hint">"Pedido falso" bloquea el celular automáticamente.</span></div>` : ''}`);
    $$('[data-set]').forEach((b) => b.addEventListener('click', () => setStatus(code, b.dataset.set)));
    $('#copy-link')?.addEventListener('click', async () => { const url = new URL(JP.trackUrl(o), location.href).href; try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { prompt('Enlace de seguimiento:', url); } });
    $('#cancel-btn')?.addEventListener('click', () => { const r = $('#cancel-r').value; if (!r) { toast('Elige un motivo'); return; } setStatus(code, 'cancelado', r); });
  }

  function newOrder() {
    const catalog = JP.catalog().filter((p) => p.available);
    const settings = JP.settings();
    const pick = {};
    openModal('Nuevo pedido manual', `<form class="form" id="mo-form" novalidate>
      <div class="note">Para pedidos que llegan directo por WhatsApp o por llamada. Queda en el tablero y suma en ventas.</div>
      <div class="form-2">
        <div class="field"><label for="mo-ch">Canal</label><select class="select" id="mo-ch"><option value="whatsapp">WhatsApp</option><option value="manual">Llamada</option>${settings.channels.rappi.visible ? '<option value="rappi">Rappi</option>' : ''}${settings.channels.didi.visible ? '<option value="didi">DiDi</option>' : ''}</select></div>
        <div class="field"><label for="mo-phone">Celular <span class="req">*</span></label><input class="input" id="mo-phone" inputmode="numeric" placeholder="3001234567"></div>
        <div class="field"><label for="mo-name">Nombre <span class="req">*</span></label><input class="input" id="mo-name"></div>
        <div class="field"><label for="mo-zone">Localidad <span class="req">*</span></label><select class="select" id="mo-zone">${settings.zones.filter((z) => z.active).map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div>
        <div class="field span-2"><label for="mo-addr">Dirección y barrio <span class="req">*</span></label><input class="input" id="mo-addr"></div>
        <div class="field"><label for="mo-pay">Pago</label><select class="select" id="mo-pay">${JP.settings().payments.filter((m) => m.active).map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Productos</label><div class="picker">${catalog.map((p) => `<div class="pick"><span>${esc(p.name)} <small class="muted">${money(p.price)}</small></span><span class="qty-mini"><button type="button" data-p="${p.id}" data-d="-1" aria-label="Quitar">−</button><b id="q-${p.id}">0</b><button type="button" data-p="${p.id}" data-d="1" aria-label="Agregar">＋</button></span></div>`).join('')}</div></div>
      <button class="btn btn-primary btn-block" type="submit">Crear pedido · <span id="mo-total">$0</span></button></form>`);
    $('#mo-form').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      pick[b.dataset.p] = Math.max(0, (pick[b.dataset.p] || 0) + Number(b.dataset.d));
      $(`#q-${b.dataset.p}`).textContent = pick[b.dataset.p];
      const t = JP.priceCart(Object.entries(pick).filter(([, q]) => q).map(([id, qty]) => ({ id, qty, combo: false })), catalog, null, 0);
      $('#mo-total').textContent = money(t.subtotal);
    });
    $('#mo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const phone = $('#mo-phone').value.replace(/\D/g, '');
      const items = Object.entries(pick).filter(([, q]) => q).map(([id, qty]) => { const p = catalog.find((x) => x.id === id); return { id, name: p.name, qty, combo: false, unit: p.price }; });
      if (!/^3\d{9}$/.test(phone) || !$('#mo-name').value.trim() || !$('#mo-addr').value.trim() || !items.length) { toast('Completa celular, nombre, dirección y al menos un producto'); return; }
      const zone = settings.zones.find((z) => z.id === $('#mo-zone').value);
      const orders = JP.orders();
      const subtotal = items.reduce((a, i) => a + i.unit * i.qty, 0);
      const code = 'JP-' + String(orders.length + 1).padStart(4, '0');
      orders.push({ code, at: NOW(), channel: $('#mo-ch').value, status: 'confirmado', customer: { name: $('#mo-name').value.trim(), phone, address: $('#mo-addr').value.trim(), barrio: '', zone: zone.name, notes: '' }, items, pay: $('#mo-pay').value, subtotal, discount: 0, fee: zone.fee, total: subtotal + zone.fee, coupon: null, verified: false, log: [{ at: NOW(), status: 'confirmado', by: role === 'admin' ? 'Admin JP' : 'Operador' }] });
      JP.saveOrders(orders);
      seenCodes.add(code);
      closeAll(); toast(`Pedido ${code} creado`); go('pedidos');
    });
  }

  /* ---------- Ventas ---------- */
  let range = 30;
  function ventas() {
    const all = JP.orders();
    const orders = inRange(all, range);
    const ok = orders.filter(valid);
    const total = ok.reduce((a, o) => a + o.total, 0);
    const prev = all.filter((o) => o.at >= startOfDay(NOW()) - (2 * range - 1) * DAY && o.at < startOfDay(NOW()) - (range - 1) * DAY).filter(valid).reduce((a, o) => a + o.total, 0);
    const phones = {};
    all.forEach((o) => { phones[o.customer.phone] = (phones[o.customer.phone] || 0) + 1; });
    const recurrent = ok.filter((o) => phones[o.customer.phone] > 1).length;
    const prod = {};
    ok.forEach((o) => o.items.forEach((i) => { prod[i.name] = prod[i.name] || { k: i.name, v: 0, n: 0 }; prod[i.name].v += i.unit * i.qty; prod[i.name].n += i.qty; }));
    const top = Object.values(prod).sort((a, b) => b.v - a.v).slice(0, 8);
    const hours = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 11}:00`, v: ok.filter((o) => new Date(o.at).getHours() === i + 11).length }));
    $('#view').innerHTML = `
      <div class="toolbar"><div class="seg" role="group" aria-label="Periodo">${[7, 30].map((d) => `<button type="button" data-range="${d}" aria-pressed="${range === d}">Últimos ${d} días</button>`).join('')}</div><span class="grow"></span><button class="btn btn-soft btn-sm" type="button" id="csv">Exportar CSV</button></div>
      <div class="kpis">
        <div class="kpi"><small>Ingresos</small><b>${money(total)}</b><span class="${total >= prev ? 'up' : 'down'}">${prev ? `${total >= prev ? '▲' : '▼'} ${Math.abs(Math.round((total / prev - 1) * 100))}% vs. periodo anterior` : '—'}</span></div>
        <div class="kpi"><small>Pedidos</small><b>${ok.length}</b><span>${orders.length - ok.length} cancelados</span></div>
        <div class="kpi"><small>Ticket promedio</small><b>${money(ok.length ? total / ok.length : 0)}</b><span>con domicilio</span></div>
        <div class="kpi"><small>Recurrentes</small><b>${ok.length ? Math.round(recurrent / ok.length * 100) : 0}%</b><span>de los pedidos</span></div>
      </div>
      <section class="card"><div class="card-head"><div><h2>Ingresos por día</h2><p>Sin cancelados. Pasa el cursor para ver el detalle.</p></div></div>${barChart(byDay(all, range), (d) => `${money(d.v)} · ${d.n} pedidos`)}</section>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>Por canal</h2></div>${hbars(group(orders, (o) => CHANNEL[o.channel]), (r) => money(r.v))}</section>
        <section class="card"><div class="card-head"><h2>Por medio de pago</h2></div>${hbars(group(orders, (o) => payLabel(o.pay)), (r) => money(r.v))}</section>
      </div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><div><h2>Horas pico</h2><p>Pedidos por hora del día</p></div></div>${barChart(hours, (d) => `${d.v} pedidos`)}</section>
        <section class="card"><div class="card-head"><h2>Productos más vendidos</h2></div><div class="table-wrap"><table><thead><tr><th>Producto</th><th class="num">Unidades</th><th class="num">Ingresos</th></tr></thead><tbody>${top.map((p) => `<tr><td>${esc(p.k)}</td><td class="num">${p.n}</td><td class="num">${money(p.v)}</td></tr>`).join('')}</tbody></table></div></section>
      </div>`;
    $$('[data-range]').forEach((b) => b.addEventListener('click', () => { range = Number(b.dataset.range); ventas(); }));
    $('#csv').addEventListener('click', () => {
      const rows = [['codigo', 'fecha', 'canal', 'estado', 'pago', 'subtotal', 'descuento', 'domicilio', 'total']].concat(orders.map((o) => [o.code, new Date(o.at).toISOString(), o.channel, o.status, o.pay, o.subtotal, o.discount, o.fee, o.total]));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
      a.download = `jp-smoke-ventas-${range}d.csv`; a.click();
      toast('CSV generado (sin datos personales). Queda registrado en auditoría.');
    });
    wireTips();
  }

  /* ---------- Carta ---------- */
  function carta() {
    const catalog = JP.catalog();
    $('#view').innerHTML = `
      <div class="toolbar"><div class="note grow">Cambia precios y disponibilidad aquí; el sitio se actualiza al instante (en producción, al <b>Publicar</b>). "Agotado" deja el producto visible pero sin botón de agregar.</div><button class="btn btn-primary btn-sm" type="button" id="add-prod">＋ Producto</button></div>
      ${JP.CATEGORIES.map((c) => `<section class="card"><div class="card-head"><h2>${c.emoji} ${esc(c.name)}</h2><span class="muted">${catalog.filter((p) => p.cat === c.id).length} productos</span></div>
        <div class="table-wrap"><table><thead><tr><th>Producto</th><th class="num">Sola</th><th class="num">Combo</th><th>Disponible</th><th>Destacado</th><th></th></tr></thead><tbody>
        ${catalog.filter((p) => p.cat === c.id).map((p) => `<tr>
          <td><div class="cell-name">${p.img ? `<img class="thumb" src="${p.img}" alt="">` : '<span class="thumb"></span>'}<div><b>${esc(p.name)}</b><small>${esc(p.badge || '')}</small></div></div></td>
          <td class="num"><input class="input price-in" data-price="${p.id}" value="${p.price}" inputmode="numeric" aria-label="Precio de ${esc(p.name)}"></td>
          <td class="num">${p.combo != null ? `<input class="input price-in" data-combo="${p.id}" value="${p.combo}" inputmode="numeric" aria-label="Precio combo de ${esc(p.name)}">` : '<span class="muted">—</span>'}</td>
          <td><label class="switch"><input type="checkbox" data-avail="${p.id}" ${p.available ? 'checked' : ''} aria-label="Disponible"><span></span></label></td>
          <td><label class="switch"><input type="checkbox" data-feat="${p.id}" ${p.featured ? 'checked' : ''} aria-label="Destacado"><span></span></label></td>
          <td><button class="btn btn-soft btn-sm" type="button" data-edit="${p.id}">Editar</button></td></tr>`).join('')}
        </tbody></table></div></section>`).join('')}`;
    const update = (id, fn, msg) => { const list = JP.catalog(); fn(list.find((p) => p.id === id)); JP.saveCatalog(list); toast(msg); };
    $$('[data-price]').forEach((i) => i.addEventListener('change', () => { const v = Number(i.value.replace(/\D/g, '')); if (!v) { toast('Precio inválido'); return; } update(i.dataset.price, (p) => (p.price = v), `Precio actualizado a ${money(v)}`); }));
    $$('[data-combo]').forEach((i) => i.addEventListener('change', () => { const v = Number(i.value.replace(/\D/g, '')); update(i.dataset.combo, (p) => (p.combo = v || null), `Combo actualizado a ${money(v)}`); }));
    $$('[data-avail]').forEach((i) => i.addEventListener('change', () => update(i.dataset.avail, (p) => (p.available = i.checked), i.checked ? 'Disponible de nuevo' : 'Marcado como agotado')));
    $$('[data-feat]').forEach((i) => i.addEventListener('change', () => update(i.dataset.feat, (p) => (p.featured = i.checked), i.checked ? 'Sale en el arsenal pesado' : 'Quitado de destacados')));
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editProduct(b.dataset.edit)));
    $('#add-prod').addEventListener('click', () => editProduct(null));
  }
  function editProduct(id) {
    const list = JP.catalog();
    const p = id ? list.find((x) => x.id === id) : { id: '', cat: 'burgers', name: '', badge: '', desc: '', price: 0, combo: null, img: 'assets/fotos/burger-clasica.webp', featured: false, available: true };
    const fotos = ['burger-doble', 'burger-negra', 'burger-tocineta', 'burger-desmechada', 'burger-doble-carne', 'burger-clasica', 'costillas', 'costillas-parrilla', 'perro', 'perros-cargados', 'papas-cargadas', 'papas-tocineta', 'arepa', 'gaseosa', 'gaseosas'];
    openModal(id ? `Editar · ${p.name}` : 'Nuevo producto', `<form class="form" id="pf" novalidate><div class="form-2">
      <div class="field span-2"><label for="pf-name">Nombre <span class="req">*</span></label><input class="input" id="pf-name" value="${esc(p.name)}"></div>
      <div class="field"><label for="pf-cat">Categoría</label><select class="select" id="pf-cat">${JP.CATEGORIES.map((c) => `<option value="${c.id}" ${p.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="pf-badge">Etiqueta</label><input class="input" id="pf-badge" value="${esc(p.badge || '')}" placeholder="La más pedida"></div>
      <div class="field span-2"><label for="pf-desc">Descripción</label><textarea class="textarea" id="pf-desc">${esc(p.desc)}</textarea></div>
      <div class="field"><label for="pf-price">Precio sola <span class="req">*</span></label><input class="input" id="pf-price" inputmode="numeric" value="${p.price || ''}"></div>
      <div class="field"><label for="pf-combo">Precio combo (vacío = sin combo)</label><input class="input" id="pf-combo" inputmode="numeric" value="${p.combo || ''}"></div>
      <div class="field span-2"><label for="pf-img">Foto</label><select class="select" id="pf-img">${fotos.map((f) => `<option value="assets/fotos/${f}.webp" ${p.img === `assets/fotos/${f}.webp` ? 'selected' : ''}>${f}</option>`).join('')}</select><span class="hint">En producción: subir foto (se convierte a WebP y se le quitan los metadatos).</span></div>
      </div><div class="btn-row"><button class="btn btn-primary" type="submit">Guardar</button>${id ? '<button class="btn btn-soft" type="button" id="pf-del">Eliminar</button>' : ''}</div></form>`);
    $('#pf').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#pf-name').value.trim(), price = Number($('#pf-price').value.replace(/\D/g, ''));
      if (!name || !price) { toast('Nombre y precio son obligatorios'); return; }
      Object.assign(p, { name, cat: $('#pf-cat').value, badge: $('#pf-badge').value.trim(), desc: $('#pf-desc').value.trim(), price, combo: Number($('#pf-combo').value.replace(/\D/g, '')) || null, img: $('#pf-img').value });
      if (!id) { p.id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-'); list.push(p); }
      JP.saveCatalog(list); closeAll(); toast('Producto guardado'); carta();
    });
    $('#pf-del')?.addEventListener('click', () => { JP.saveCatalog(list.filter((x) => x.id !== id)); closeAll(); toast('Producto eliminado'); carta(); });
  }

  /* ---------- Promociones y cupones ---------- */
  const PROMO_TYPE = { porcentaje: '% de descuento', valor: 'Valor fijo', envio: 'Domicilio gratis', regalo: 'Producto de regalo' };
  function promos() {
    const list = JP.promos();
    $('#view').innerHTML = `
      <div class="toolbar"><div class="note grow">Los cupones <b>visibles</b> salen en la sección de promociones del sitio; los <b>secretos</b> solo funcionan si el cliente conoce el código. El servidor valida vigencia, mínimo y usos.</div><button class="btn btn-primary btn-sm" type="button" id="add-promo">＋ Cupón</button></div>
      <section class="card"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Tipo</th><th class="num">Mínimo</th><th>Vence</th><th class="num">Usos</th><th>Visible</th><th>Activo</th></tr></thead><tbody>
      ${list.map((c, i) => `<tr><td><div class="cell-name"><div><b style="font-family:var(--font-display);font-size:20px;letter-spacing:.05em">${esc(c.code)}</b><small>${esc(c.title)}</small></div></div></td>
        <td>${PROMO_TYPE[c.type]}${c.type === 'porcentaje' ? ` · ${c.value}%` : c.type === 'valor' ? ` · ${money(c.value)}` : ''}</td>
        <td class="num">${money(c.min)}</td><td>${new Date(c.until + 'T12:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</td>
        <td class="num">${c.uses}${c.maxUses ? ` / ${c.maxUses}` : ''}</td>
        <td><label class="switch"><input type="checkbox" data-pv="${i}" ${c.visible ? 'checked' : ''} aria-label="Visible en el sitio"><span></span></label></td>
        <td><label class="switch"><input type="checkbox" data-pa="${i}" ${c.active ? 'checked' : ''} aria-label="Activo"><span></span></label></td></tr>`).join('')}
      </tbody></table></div></section>
      ${(() => { const leads = JP.leads(); return `<section class="card"><div class="card-head"><div><h2>Clientes captados con el aviso de bienvenida</h2><p>Con autorización de datos; sirven para enviar promociones</p></div><span class="muted">${leads.length}</span></div>${leads.length ? `<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Celular</th><th>Cupón</th><th>Fecha</th></tr></thead><tbody>${leads.slice().reverse().map((l) => `<tr><td>${esc(l.name)}</td><td>${l.phone.slice(0, 3)} ••• ${l.phone.slice(-4)}</td><td>${esc(l.coupon)}</td><td>${fmtDate(l.at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aún nadie. Activa el modo "Aviso centrado" con un evento que capte datos.</p>'}</section>`; })()}`;
    $$('[data-pv]').forEach((s) => s.addEventListener('change', () => { const l = JP.promos(); l[s.dataset.pv].visible = s.checked; JP.savePromos(l); toast(s.checked ? 'Visible en el sitio' : 'Ahora es secreto'); }));
    $$('[data-pa]').forEach((s) => s.addEventListener('change', () => { const l = JP.promos(); l[s.dataset.pa].active = s.checked; JP.savePromos(l); toast(s.checked ? 'Cupón activo' : 'Cupón pausado'); }));
    $('#add-promo').addEventListener('click', () => {
      openModal('Nuevo cupón', `<form class="form" id="cf" novalidate><div class="form-2">
        <div class="field"><label for="cf-code">Código <span class="req">*</span></label><input class="input" id="cf-code" style="text-transform:uppercase" placeholder="BARRIL10"></div>
        <div class="field"><label for="cf-type">Tipo</label><select class="select" id="cf-type">${Object.entries(PROMO_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label for="cf-val">Valor (% o $)</label><input class="input" id="cf-val" inputmode="numeric"></div>
        <div class="field"><label for="cf-min">Pedido mínimo</label><input class="input" id="cf-min" inputmode="numeric" value="30000"></div>
        <div class="field span-2"><label for="cf-title">Texto para el cliente <span class="req">*</span></label><input class="input" id="cf-title" placeholder="10% en tu primer pedido"></div>
        <div class="field"><label for="cf-until">Vence</label><input class="input" id="cf-until" type="date" value="2026-12-31"></div>
        <div class="field"><label for="cf-max">Usos máximos (vacío = sin límite)</label><input class="input" id="cf-max" inputmode="numeric"></div>
        <div class="field span-2"><label>Días y horas</label><div class="chips">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<label class="chip-check"><input type="checkbox" checked> ${d}</label>`).join('')}</div></div>
        <label class="check span-2"><input type="checkbox" id="cf-vis" checked> Mostrar en el sitio</label>
        <label class="check span-2"><input type="checkbox" checked> Un uso por celular</label>
      </div><button class="btn btn-primary btn-block" type="submit">Crear cupón</button></form>`);
      $('#cf').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = $('#cf-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length < 4 || !$('#cf-title').value.trim()) { toast('Código (mín. 4) y texto son obligatorios'); return; }
        const l = JP.promos();
        if (l.some((c) => c.code === code)) { toast('Ese código ya existe'); return; }
        l.push({ code, type: $('#cf-type').value, value: Number($('#cf-val').value.replace(/\D/g, '')) || 0, min: Number($('#cf-min').value.replace(/\D/g, '')) || 0, visible: $('#cf-vis').checked, active: true, title: $('#cf-title').value.trim(), detail: '', until: $('#cf-until').value, uses: 0, maxUses: Number($('#cf-max').value) || null });
        JP.savePromos(l); closeAll(); toast(`Cupón ${code} creado`); promos();
      });
    });
  }

  /* ---------- Eventos y banners ---------- */
  function eventos() {
    const list = JP.events();
    const st = JP.settings();
    const promosList = JP.promos();
    const MODES = [['completa', 'Pantalla completa', 'Foto grande del evento con barra de carga. Máximo impacto.'], ['aviso', 'Aviso centrado', 'Ventana pequeña sobre el sitio; si el evento capta datos (nombre y celular), entrega un cupón.'], ['ninguna', 'Nada', 'El sitio abre directo.']];
    $('#view').innerHTML = `
      <section class="card"><div class="card-head"><div><h2>Al abrir la página por primera vez</h2><p>Se muestra una vez por visita con el evento marcado como "Bienvenida"</p></div></div>
        <div class="modes">${MODES.map(([k, l, d]) => `<label class="mode ${st.introMode === k ? 'is-on' : ''}"><input type="radio" name="intro-mode" value="${k}" ${st.introMode === k ? 'checked' : ''}><b>${l}</b><small>${d}</small>${k !== 'ninguna' ? `<a href="index.html?intro=${k}" target="_blank" rel="noopener">Ver ejemplo ↗</a>` : ''}</label>`).join('')}</div></section>
      <div class="toolbar"><div class="note grow">Cada evento puede salir en tres lugares: <b>bienvenida</b> (al abrir), <b>franja</b> (cinta animada bajo el inicio) y <b>sección</b> de eventos. Solo un evento de bienvenida a la vez.</div><button class="btn btn-primary btn-sm" type="button" id="add-ev">＋ Evento</button></div>
      <div class="grid-2">${list.map((ev, i) => `<article class="ev-card"><img src="${ev.img}" alt="">
        <div><span class="tag">${esc(ev.kicker)}</span><h3 style="margin-top:6px">${esc(ev.title)}</h3><p>${esc(ev.text)}</p>
          <div class="chips">${[['intro', 'Bienvenida'], ['strip', 'Franja'], ['section', 'Sección'], ['capture', 'Capta datos (cupón)'], ['active', 'Activo']].map(([k, l]) => `<label class="chip-check"><input type="checkbox" data-ev="${i}" data-k="${k}" ${ev[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
          ${ev.capture ? `<div class="field" style="margin-top:8px"><label for="evc-${i}">Cupón que entrega</label><select class="select" id="evc-${i}" data-ev-coupon="${i}">${promosList.map((c) => `<option ${c.code === ev.couponCode ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></div>` : ''}
          <p class="muted" style="margin:8px 0 0;font-size:12px">${ev.from} → ${ev.to}</p></div></article>`).join('')}</div>`;
    $$('input[name="intro-mode"]').forEach((r) => r.addEventListener('change', () => { const x = JP.settings(); x.introMode = r.value; JP.saveSettings(x); toast(`Bienvenida: ${MODES.find((m) => m[0] === r.value)[1]}`); eventos(); }));
    $$('[data-ev]').forEach((c) => c.addEventListener('change', () => {
      const l = JP.events();
      if (c.dataset.k === 'intro' && c.checked) l.forEach((e) => (e.intro = false));
      l[c.dataset.ev][c.dataset.k] = c.checked;
      if (c.dataset.k === 'capture' && c.checked && !l[c.dataset.ev].couponCode) l[c.dataset.ev].couponCode = JP.promos()[0]?.code;
      JP.saveEvents(l); toast('Evento actualizado'); eventos();
    }));
    $$('[data-ev-coupon]').forEach((sel) => sel.addEventListener('change', () => { const l = JP.events(); l[sel.dataset.evCoupon].couponCode = sel.value; JP.saveEvents(l); toast(`Entrega el cupón ${sel.value}`); }));
    $('#add-ev').addEventListener('click', () => {
      openModal('Nuevo evento o banner', `<form class="form" id="ef" novalidate><div class="form-2">
        <div class="field span-2"><label for="ef-title">Título <span class="req">*</span></label><input class="input" id="ef-title" placeholder="Noche de costillas"></div>
        <div class="field"><label for="ef-kicker">Fecha visible</label><input class="input" id="ef-kicker" placeholder="Viernes 21 de noviembre"></div>
        <div class="field"><label for="ef-img">Imagen</label><select class="select" id="ef-img">${['fuego', 'brasas', 'humo', 'costillas', 'burger-doble'].map((f) => `<option value="assets/fotos/${f}.webp">${f}</option>`).join('')}</select></div>
        <div class="field span-2"><label for="ef-text">Texto</label><textarea class="textarea" id="ef-text"></textarea></div>
        <div class="field"><label for="ef-cta">Botón</label><input class="input" id="ef-cta" value="Pedir ahora"></div>
        <div class="field"><label for="ef-href">Lleva a</label><select class="select" id="ef-href"><option value="#carta">Carta</option><option value="#promos">Promociones</option><option value="#tour">Eventos privados</option></select></div>
        <div class="field"><label for="ef-from">Desde</label><input class="input" id="ef-from" type="date" value="2026-11-01"></div>
        <div class="field"><label for="ef-to">Hasta</label><input class="input" id="ef-to" type="date" value="2026-11-30"></div>
        <div class="field span-2"><label>Dónde sale</label><div class="chips"><label class="chip-check"><input type="checkbox" id="ef-intro"> Bienvenida</label><label class="chip-check"><input type="checkbox" id="ef-strip" checked> Franja</label><label class="chip-check"><input type="checkbox" id="ef-section" checked> Sección</label><label class="chip-check"><input type="checkbox" id="ef-capture"> Capta datos y entrega cupón</label></div></div>
      </div><button class="btn btn-primary btn-block" type="submit">Crear evento</button></form>`);
      $('#ef').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!$('#ef-title').value.trim()) { toast('El título es obligatorio'); return; }
        const l = JP.events();
        if ($('#ef-intro').checked) l.forEach((x) => (x.intro = false));
        l.unshift({ id: 'ev-' + NOW(), title: $('#ef-title').value.trim(), kicker: $('#ef-kicker').value.trim() || 'Nuevo', text: $('#ef-text').value.trim(), img: $('#ef-img').value, cta: $('#ef-cta').value.trim() || 'Ver', href: $('#ef-href').value, intro: $('#ef-intro').checked, strip: $('#ef-strip').checked, section: $('#ef-section').checked, capture: $('#ef-capture').checked, couponCode: 'BIENVENIDA10', active: true, from: $('#ef-from').value, to: $('#ef-to').value });
        JP.saveEvents(l); closeAll(); toast('Evento creado'); eventos();
      });
    });
  }

  /* ---------- Editar página ---------- */
  const SECTION_LABEL = { arsenal: 'Arsenal pesado (destacados)', carta: 'Carta completa', promos: 'Promociones', eventos: 'Eventos y novedades', tour: 'JP on Tour (eventos privados)', resenas: 'Prueba social', cobertura: 'Domicilios / ubicación' };
  function sitio() {
    const s = JP.settings();
    $('#view').innerHTML = `
      <div class="grid-2">
        <section class="card"><div class="card-head"><div><h2>Inicio</h2><p>Textos grandes de la portada</p></div></div>
          <form class="form" id="hero-f"><div class="field"><label for="h-title">Titular</label><input class="input" id="h-title" value="${esc(s.hero.title)}"></div>
          <div class="field"><label for="h-kicker">Antetítulo</label><input class="input" id="h-kicker" value="${esc(s.hero.kicker)}"></div>
          <div class="field"><label for="h-text">Texto</label><textarea class="textarea" id="h-text">${esc(s.hero.text)}</textarea></div>
          <button class="btn btn-soft btn-sm" type="submit">Guardar borrador</button></form></section>
        <section class="card"><div class="card-head"><div><h2>Canales de pedido</h2><p>Rappi y DiDi están construidos y ocultos hasta que los actives</p></div></div>
          <div class="rows">${['rappi', 'didi'].map((k) => `<div class="row"><div style="flex:1"><b>${k === 'rappi' ? 'Rappi' : 'DiDi Food'}</b><input class="input" style="margin-top:6px" data-ch-url="${k}" value="${esc(s.channels[k].url)}" aria-label="Enlace de ${k}"></div><div class="right"><label class="switch"><input type="checkbox" data-ch="${k}" ${s.channels[k].visible ? 'checked' : ''} aria-label="Mostrar ${k}"><span></span></label></div></div>`).join('')}
          <div class="row"><div style="flex:1"><b>WhatsApp del negocio</b><input class="input" style="margin-top:6px" id="wa-num" value="${esc(s.whatsapp)}" inputmode="numeric" aria-label="Número de WhatsApp"></div></div></div></section>
      </div>
      <section class="card"><div class="card-head"><div><h2>Secciones visibles</h2><p>Apaga una sección sin borrar su contenido</p></div></div>
        <div class="rows">${Object.entries(SECTION_LABEL).map(([k, l]) => `<div class="row"><b>${l}</b><label class="switch"><input type="checkbox" data-sec="${k}" ${s.sections[k] ? 'checked' : ''} aria-label="${l}"><span></span></label></div>`).join('')}</div></section>
      <div class="toolbar"><span class="grow muted">En producción, <b>Publicar</b> regenera el sitio en Vercel (~1 min). En el mockup los cambios se ven al instante en la pestaña del sitio.</span><button class="btn btn-primary" type="button" id="publish">Publicar cambios</button></div>`;
    const save = (fn, msg) => { const st = JP.settings(); fn(st); JP.saveSettings(st); if (msg) toast(msg); };
    $('#hero-f').addEventListener('submit', (e) => { e.preventDefault(); save((st) => { st.hero.title = $('#h-title').value.trim() || 'JP Smoke'; st.hero.kicker = $('#h-kicker').value.trim(); st.hero.text = $('#h-text').value.trim(); }, 'Inicio guardado'); });
    $$('[data-ch]').forEach((c) => c.addEventListener('change', () => save((st) => (st.channels[c.dataset.ch].visible = c.checked), `${c.dataset.ch === 'rappi' ? 'Rappi' : 'DiDi'} ${c.checked ? 'visible en el sitio' : 'oculto'}`)));
    $$('[data-ch-url]').forEach((i) => i.addEventListener('change', () => { if (!/^https:\/\//.test(i.value)) { toast('El enlace debe empezar por https://'); return; } save((st) => (st.channels[i.dataset.chUrl].url = i.value.trim()), 'Enlace guardado'); }));
    $('#wa-num').addEventListener('change', (e) => { const v = e.target.value.replace(/\D/g, ''); if (!/^573\d{9}$/.test(v)) { toast('Formato: 573001234567'); return; } save((st) => (st.whatsapp = v), 'WhatsApp actualizado'); });
    $$('[data-sec]').forEach((c) => c.addEventListener('change', () => save((st) => (st.sections[c.dataset.sec] = c.checked), c.checked ? 'Sección visible' : 'Sección oculta')));
    $('#publish').addEventListener('click', () => toast('Publicado. El sitio se actualiza en ~1 minuto ✔'));
  }

  /* ---------- Clientes ---------- */
  function clientes() {
    const orders = JP.orders();
    const m = {};
    orders.forEach((o) => {
      const c = m[o.customer.phone] = m[o.customer.phone] || { phone: o.customer.phone, name: o.customer.name, zone: o.customer.zone, n: 0, total: 0, last: 0, cancel: 0 };
      if (valid(o)) { c.n += 1; c.total += o.total; } else c.cancel += 1;
      c.last = Math.max(c.last, o.at);
    });
    const list = Object.values(m).sort((a, b) => b.total - a.total);
    $('#view').innerHTML = `
      <div class="note">Datos personales: solo administrador y operador los ven (RLS). Ningún visitante del sitio puede consultarlos. El celular se muestra completo solo al abrir un pedido.</div>
      <section class="card"><div class="card-head"><h2>${list.length} clientes</h2><input class="input" style="max-width:260px;min-height:40px" id="c-q" placeholder="Buscar nombre o celular" aria-label="Buscar cliente"></div>
      <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Localidad</th><th class="num">Pedidos</th><th class="num">Total</th><th>Último</th><th>Estado</th></tr></thead><tbody id="c-body"></tbody></table></div></section>`;
    const draw = (q = '') => {
      $('#c-body').innerHTML = list.filter((c) => !q || (c.name + c.phone).toLowerCase().includes(q.toLowerCase())).slice(0, 60).map((c) => `<tr>
        <td><div class="cell-name"><span class="avatar">${esc(c.name[0])}</span><div><b>${esc(c.name)}</b><small>${c.phone.slice(0, 3)} ••• ${c.phone.slice(-4)}</small></div></div></td>
        <td>${esc(c.zone)}</td><td class="num">${c.n}</td><td class="num">${money(c.total)}</td><td>${fmtDate(c.last)}</td>
        <td>${c.n >= 2 ? '<span class="st st-entregado">Confiable</span>' : '<span class="st">Nuevo</span>'}</td></tr>`).join('');
    };
    draw();
    $('#c-q').addEventListener('input', (e) => draw(e.target.value));
  }

  /* ---------- Ajustes y seguridad ---------- */
  const LEVELS = {
    basica: { name: 'Básica', desc: 'Solo frena robots. Úsala si casi nunca te llegan pedidos raros.', phone: 6, ip: 20, secs: 2 },
    recomendada: { name: 'Recomendada', desc: 'Frena robots y a quien pide muchas veces seguidas. Tus clientes reales no notan nada.', phone: 3, ip: 10, secs: 4 },
    estricta: { name: 'Estricta', desc: 'Para rachas de pedidos de broma: el primer pedido de un número nuevo espera a que lo revises.', phone: 2, ip: 5, secs: 6 },
  };
  function ajustes() {
    const s = JP.settings();
    const lvl = LEVELS[s.security.level] || LEVELS.recomendada;
    $('#view').innerHTML = `
      <div class="grid-2">
        <section class="card"><div class="card-head"><div><h2>🛡️ Protección de pedidos</h2><p>Para que no te lleguen pedidos falsos, de broma o de robots</p></div></div>
          <div class="shield"><b>23</b><span>pedidos falsos frenados esta semana<br><small class="muted">18 de robots · 4 repetidos del mismo número · 1 de un número que bloqueaste</small></span></div>
          <div class="modes">${Object.entries(LEVELS).map(([k, v]) => `<label class="mode ${s.security.level === k ? 'is-on' : ''}"><input type="radio" name="sec-level" value="${k}" ${s.security.level === k ? 'checked' : ''}><b>${v.name}</b><small>${v.desc}</small></label>`).join('')}</div>
          <details class="tech" open><summary>Qué hace por ti</summary>
            <ul><li><b>Detecta robots</b> que intentan llenar pedidos solos y los frena. Tus clientes no tienen que hacer nada.</li><li><b>Frena pedidos repetidos:</b> un mismo número puede hacer hasta ${lvl.phone} pedidos por hora.</li><li><b>Nadie cambia tus precios:</b> el total siempre se calcula con tu carta, tus cupones y tus zonas.</li><li><b>Solo pedidos que puedes atender:</b> dentro de tus zonas y tu horario.</li><li><b>Bloquea bromistas:</b> si cancelas un pedido como "Pedido falso", ese número ya no puede pedir.</li></ul></details>
          <details class="tech"><summary>Detalle técnico (para soporte)</summary><ul><li>Cloudflare Turnstile validado en la función del servidor.</li><li>Límite por celular ${lvl.phone}/h y por IP ${lvl.ip}/h; tiempo mínimo de llenado ${lvl.secs} s; campo trampa.</li><li>Precios, cupones, zona y horario recalculados en la Edge Function <code>crear-pedido</code>.</li></ul></details></section>
        <section class="card"><div class="card-head"><div><h2>Medios de pago</h2><p>Lo que el cliente puede elegir al pedir</p></div></div>
          <div class="rows">${s.payments.map((m, i) => `<div class="row"><div><b>${esc(m.label)}</b><small>${m.cash ? 'Pide "¿con cuánto pagas?"' : ''}</small></div><div class="right"><button class="icon-btn" type="button" data-pay-del="${i}" aria-label="Quitar ${esc(m.label)}">🗑</button><label class="switch"><input type="checkbox" data-pay="${i}" ${m.active ? 'checked' : ''} aria-label="${esc(m.label)} disponible"><span></span></label></div></div>`).join('')}</div>
          <form class="coupon-row" id="pay-add" style="display:flex;gap:8px;margin-top:12px"><input class="input" id="pay-new" placeholder="Ej. Bold, Llave Bre-B" aria-label="Nuevo medio de pago"><button class="btn btn-soft" type="submit">Agregar</button></form>
          <p class="hint" style="margin:10px 0 0">¿Hoy no hay datáfono? Apágalo y desaparece del pedido al instante.</p></section>
      </div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><div><h2>Zonas de domicilio</h2><p>Costo y cobertura</p></div></div>
          <div class="rows">${s.zones.map((z, i) => `<div class="row"><b>${esc(z.name)}</b><div class="right"><input class="input price-in" data-zone-fee="${i}" value="${z.fee}" inputmode="numeric" aria-label="Costo ${esc(z.name)}"><label class="switch"><input type="checkbox" data-zone="${i}" ${z.active ? 'checked' : ''} aria-label="Activa"><span></span></label></div></div>`).join('')}</div></section>
        <section class="card"><div class="card-head"><div><h2>Cuentas del equipo</h2><p>Solo el administrador crea cuentas</p></div><button class="btn btn-soft btn-sm" type="button" onclick="this.textContent='Invitación enviada'">＋ Invitar</button></div>
          <div class="rows">
            <div class="row"><div><b>Admin JP</b><small>Administrador · todo el panel</small></div><span class="st st-entregado">2 pasos</span></div>
            <div class="row"><div><b>Operador</b><small>Operador · solo Resumen y Pedidos (sin dinero)</small></div><span class="st">Activo</span></div>
          </div>
          <div class="rows" style="margin-top:14px">${s.hours.map(([d, h]) => `<div class="row"><b>${esc(d)}</b><span>${esc(h)}</span></div>`).join('')}<div class="row"><b>Pedido mínimo</b><span>${money(s.delivery.min)}</span></div></div>
          <button class="btn btn-soft btn-sm" type="button" id="reset" style="margin-top:14px">Restablecer datos del mockup</button></section>
      </div>`;
    const save = (fn, msg = 'Guardado') => { const st = JP.settings(); fn(st); JP.saveSettings(st); toast(msg); };
    $$('input[name="sec-level"]').forEach((r) => r.addEventListener('change', () => { const v = LEVELS[r.value]; save((st) => Object.assign(st.security, { level: r.value, maxPerHourPhone: v.phone, maxPerHourIp: v.ip, minFillSeconds: v.secs }), `Protección ${v.name}`); ajustes(); }));
    $$('[data-pay]').forEach((c) => c.addEventListener('change', () => save((st) => (st.payments[c.dataset.pay].active = c.checked), c.checked ? 'Medio de pago disponible' : 'Medio de pago oculto en el pedido')));
    $$('[data-pay-del]').forEach((b) => b.addEventListener('click', () => { save((st) => st.payments.splice(Number(b.dataset.payDel), 1), 'Medio de pago quitado'); ajustes(); }));
    $('#pay-add').addEventListener('submit', (e) => { e.preventDefault(); const label = $('#pay-new').value.trim(); if (label.length < 2) return; save((st) => st.payments.push({ id: label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-'), label, active: true }), `${label} agregado`); ajustes(); });
    $$('[data-zone]').forEach((c) => c.addEventListener('change', () => save((st) => (st.zones[c.dataset.zone].active = c.checked))));
    $$('[data-zone-fee]').forEach((i) => i.addEventListener('change', () => save((st) => (st.zones[i.dataset.zoneFee].fee = Number(i.value.replace(/\D/g, '')) || 0))));
    $('#reset').addEventListener('click', () => { JP.reset(); seenCodes = new Set(JP.orders().map((o) => o.code)); toast('Datos restablecidos'); go('ajustes'); });
  }

  /* ---------- Pedido nuevo desde el sitio (otra pestaña) ---------- */
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .18].forEach((d) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.15, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + d + .15); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .16); });
    } catch { /* sin audio */ }
  }
  addEventListener('storage', (e) => {
    if (e.key === JP.KEYS.dir) { document.documentElement.dataset.direccion = JP.direction(); syncDir(); return; }
    if (e.key !== JP.KEYS.orders || $('#app').hidden) return;
    const fresh = JP.orders().filter((o) => !seenCodes.has(o.code));
    if (fresh.length) {
      beep();
      fresh.forEach((o) => {
        toast(`🔥 Pedido nuevo ${o.code} por ${CHANNEL[o.channel]} · ${money(o.total)}`);
        try { if (Notification.permission === 'granted') new Notification(`Pedido nuevo ${o.code}`, { body: `${o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')} · ${money(o.total)}`, icon: 'assets/favicon.svg', tag: o.code }); } catch { /* sin notificaciones */ }
      });
    }
    renderNav();
    if (['pedidos', 'resumen'].includes(view)) go(view);
  });
})();
