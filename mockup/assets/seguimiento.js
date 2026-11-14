/* JP Smoke · seguimiento del pedido por enlace único (mockup).
   En producción: la Edge Function seguir-pedido recibe código + token y devuelve solo estado, horas y resumen;
   la página se suscribe a cambios y nunca recibe el celular ni la dirección completa. */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { money } = JP;
  const params = new URLSearchParams(location.search);
  const code = params.get('c');
  const token = params.get('t');
  const settings = JP.settings();
  const time = (t) => new Date(t).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  const HINT = {
    nuevo: 'El parrillero ya lo vio. En un momento lo confirma.',
    confirmado: 'Confirmado. Tu pedido entra al barril en breve.',
    en_cocina: 'Tu pedido está en el barril tomando humo.',
    en_camino: 'Va en camino. Ten listo el pago.',
    entregado: '¡Buen provecho! Gracias por pedir en JP Smoke.',
  };
  $('#logo').innerHTML = JP.logoSvg;
  let lastStatus = null;

  function render() {
    const o = JP.orders().find((x) => x.code === code && x.token && x.token === token);
    if (!o) {
      $('#track-main').innerHTML = `<section class="track-hero"><h1 class="display track-status" style="font-size:56px">No encontrado</h1>
        <p>El enlace no es válido o ya venció. Búscalo con el código y los últimos 4 dígitos de tu celular.</p>
        <a class="btn btn-primary" href="index.html" style="justify-self:start">Ir a la página</a></section>`;
      return;
    }
    if (lastStatus && lastStatus !== o.status) {
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = `Tu pedido ahora está: ${o.status === 'cancelado' ? 'Cancelado' : Object.fromEntries(JP.STATES)[o.status]}`;
      $('#toasts').append(t); setTimeout(() => t.remove(), 3500);
    }
    lastStatus = o.status;
    const cancelled = o.status === 'cancelado';
    const idx = JP.STATES.findIndex(([k]) => k === o.status);
    const log = Object.fromEntries((o.log || []).map((l) => [l.status, l.at]));
    log.nuevo = o.at;
    const pay = settings.payments.find((m) => m.id === o.pay)?.label || o.pay;
    const addr = o.customer.address.replace(/(#\s*)[\d\s-]+/, '$1···');
    document.title = `${cancelled ? 'Cancelado' : JP.STATES[idx][1]} · ${o.code} · JP Smoke`;
    $('#track-main').className = 'track' + (cancelled ? ' cancelled' : '');
    $('#track-main').innerHTML = `
      <section class="track-hero">
        <p class="code">Pedido ${esc(o.code)}</p>
        <h1 class="display track-status">${cancelled ? 'Cancelado' : esc(JP.STATES[idx][1])}</h1>
        <p>${cancelled ? `Motivo: ${esc(o.cancelReason || 'sin detalle')}. Si fue un error, escríbenos.` : esc(HINT[o.status])}</p>
        ${!cancelled && o.status !== 'entregado' ? `<p><b style="color:var(--text)">Entrega estimada:</b> ${esc(settings.delivery.eta)} desde las ${time(o.at)}</p>` : ''}
      </section>
      ${cancelled ? '' : `<section class="track-card"><h2>Estado</h2><ol class="steps-v">${JP.STATES.map(([k, l], i) => `<li class="${i <= idx ? 'is-done' : ''} ${i === idx ? 'now' : ''}"><span><b>${l}</b></span><time>${log[k] ? time(log[k]) : ''}</time></li>`).join('')}</ol></section>`}
      <section class="track-card"><h2>Tu pedido</h2><div class="track-lines">
        ${o.items.map((i) => `<div><span>${i.qty} × ${esc(i.name)}${i.combo ? ' (combo)' : ''}</span><span>${money(i.unit * i.qty)}</span></div>`).join('')}
        <div class="muted"><span>Domicilio</span><span>${o.fee ? money(o.fee) : 'Gratis'}</span></div>
        ${o.discount ? `<div class="muted"><span>Cupón ${esc(o.coupon)}</span><span>−${money(o.discount)}</span></div>` : ''}
        <div class="tot"><span>Total</span><span>${money(o.total)}</span></div></div>
        <p class="muted" style="margin:0;font-size:14px">${esc(addr)}, ${esc(o.customer.barrio)} · Pago: ${esc(pay)}</p></section>
      <p class="track-note">Guarda este enlace: es único para tu pedido. Se actualiza solo, no tienes que recargar.</p>`;
  }
  render();
  // Cambios hechos en el panel (en producción: suscripción en tiempo real)
  addEventListener('storage', (e) => { if (e.key === JP.KEYS.orders) render(); });
  setInterval(render, 5000);
})();
