/* Checkout (datos del comprador, cupón y pasarela) y pasarela de pagos simulada.
   Rutas: /checkout · /pago/:orderId. Los ids 'checkout' y 'pago' son exactos: app.js
   oculta el reloj de la cabecera en ellos porque aquí el reloj va dentro de la vista. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;
  const D = window.DATA;

  /* Borrador en memoria: sobrevive a ir y volver de la pasarela (p. ej. tras un rechazo). */
  const draft = {
    buyer: Object.assign({}, D.demoBuyer),
    coupon: '',
    gateway: D.gateways[0].id,
    method: D.gateways[0].methods[0],
    terms: false,
    touched: false // el comprador cambió algo en esta carga de la página
  };
  /* Tras recargar la página el borrador en memoria se pierde: si el comprador no ha tocado nada,
     lo recuperamos del último pago cancelado o rechazado de esta misma reserva. */
  function hydrateDraft(h) {
    if (draft.touched) return;
    const since = (h.startedAt || 0) - 1000;
    const last = Store.state.orders.find((o) => o.eventId === h.eventId && (o.status === 'cancelled' || o.status === 'failed') && o.createdAt >= since);
    if (!last) return;
    draft.buyer = Object.assign({}, D.demoBuyer, last.buyer);
    draft.gateway = last.gateway;
    draft.method = last.method;
    draft.coupon = last.coupon || '';
    draft.terms = true; // ya los aceptó al abrir ese pago
  }

  /* Re-renderizar o navegar dentro de un Store.emit haría que la suscripción de la vista nueva
     se ejecute en el mismo recorrido del Set (bucle). Desde suscripciones, siempre diferido y una vez. */
  const deferOnce = () => {
    let queued = false;
    return (fn) => { if (queued) return; queued = true; setTimeout(fn, 0); };
  };

  const FEE_PCT = Math.round(D.serviceFee * 100);
  const gwOf = (id) => D.gateways.find((g) => g.id === id) || D.gateways[0];
  const orderOf = (id) => Store.state.orders.find((o) => o.id === id) || null;
  const qtyTxt = (n) => (n === 1 ? '1 boleta' : fmt.num(n) + ' boletas');
  const seatTxt = (seating) => (seating === 'numerada' ? 'Silla numerada (se asigna al pagar)' : 'Acceso general');
  const offTxt = (cp) => (cp.type === 'pct' ? `−${cp.value} %` : '−' + fmt.cop(cp.value));
  /* Horas y fechas sin cortes de línea internos («7:30 p.» / «m.»). */
  const nb = (s) => String(s).replace(/\s/g, ' ');
  const time = (iso) => nb(fmt.time(iso));
  const when = (ev) => `${nb(fmt.date(ev.date))} · ${time(ev.date)}`;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Desplaza lo justo para que el elemento (más `room` px que van a aparecer debajo) quede a la
     vista, sin meter su borde superior bajo la cabecera fija. En celular la pasarela es larga. */
  function reveal(el, { room = 0 } = {}) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const topLimit = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 116;
    const bottomLimit = innerHeight - 12;
    let dy = Math.max(0, r.bottom + room - bottomLimit);
    if (r.top - dy < topLimit) dy = r.top - topLimit;
    if (Math.abs(dy) < 4) return;
    window.scrollBy({ top: dy, behavior: reduced() ? 'auto' : 'smooth' });
  }

  const METHOD = {
    Tarjeta: { icon: 'card', note: 'Escribes los datos de la tarjeta en la pasarela, nunca en aforo.' },
    PSE: { icon: 'bank', note: 'Eliges tu banco en la pasarela y autorizas el débito desde tu cuenta.' },
    Nequi: { icon: 'phone', note: 'Apruebas el cobro con una notificación en la app de Nequi.' },
    Daviplata: { icon: 'phone', note: 'Confirmas el pago con tu clave de Daviplata.' },
    Saldo: { icon: 'wallet', note: 'Pagas con el saldo disponible en tu cuenta.' },
    Efectivo: { icon: 'pin', note: 'Recibes un código para pagar en un punto autorizado antes de que venza la reserva.' }
  };
  const mInfo = (m) => METHOD[m] || { icon: 'card', note: '' };

  const RULES = {
    name: (v) => (v.trim().split(/\s+/).filter(Boolean).length >= 2 ? '' : 'Escribe tu nombre y apellido.'),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Revisa el correo: ahí te llegan las boletas.'),
    phone: (v) => (v.replace(/\D/g, '').length >= 10 ? '' : 'Escribe un celular de 10 dígitos.'),
    doc: (v) => (v.replace(/[^0-9A-Za-z]/g, '').length >= 5 ? '' : 'Escribe tu número de documento.')
  };

  /* ---------------- Piezas compartidas ---------------- */

  function headHTML(ev, title, step) {
    const st = (n, label) => {
      const cls = n < step ? 'is-done' : n === step ? 'is-on' : '';
      return `<li class="${cls}" ${n === step ? 'aria-current="step"' : ''}>${n < step ? icon('check', 14) : `<span>0${n}</span>`}${label}</li>`;
    };
    return `<div class="ck-top">
        ${ev ? `<a class="ck-back" href="#/evento/${esc(ev.id)}">${icon('left', 18)}Volver al evento</a>` : '<span></span>'}
        <ol class="ck-steps" aria-label="Pasos de la compra">${st(1, 'Elegir')}${st(2, 'Tus datos')}${st(3, 'Pago')}</ol>
      </div>
      <h1 class="h1 ck-title">${esc(title)}</h1>`;
  }

  /* Reloj de la reserva: banda oscura con tiempo grande y barra que se encoge. */
  function clockState(h) {
    const left = Math.max(0, (h.until - Date.now()) / 1000);
    const start = h.startedAt || h.until - D.holdSeconds * 1000;
    const total = Math.max(1, (h.until - start) / 1000);
    return { left, frac: Math.min(1, left / total), urgent: left < 60 };
  }
  function clockHTML(h, title, sub) {
    const st = clockState(h);
    return `<section class="ck-clock${st.urgent ? ' is-urgent' : ''}" data-clock role="timer" aria-label="Tiempo restante de la reserva">
      <span class="ck-clock-ico" aria-hidden="true">${icon('timer', 22)}</span>
      <div class="ck-clock-txt">
        <p class="ck-clock-t">${esc(title)}<span class="sr-only"> · </span></p>
        <p class="ck-clock-s">${esc(sub)}</p>
      </div>
      <p class="ck-clock-left" data-clock-left>${fmt.mmss(st.left)}</p>
      <span class="ck-clock-bar" aria-hidden="true"><i data-clock-bar style="width:${(st.frac * 100).toFixed(2)}%"></i></span>
    </section>`;
  }
  function tickClock(root, h) {
    const st = clockState(h);
    root.querySelectorAll('[data-clock-left]').forEach((el) => { el.textContent = fmt.mmss(st.left); });
    const bar = root.querySelector('[data-clock-bar]');
    if (bar) bar.style.width = (st.frac * 100).toFixed(2) + '%';
    const c = root.querySelector('[data-clock]');
    if (c) c.classList.toggle('is-urgent', st.urgent);
    root.querySelectorAll('[data-dock-left]').forEach((el) => el.classList.toggle('is-urgent', st.urgent));
  }

  const lineHTML = (l) => `<li class="ck-line">
      <span class="dot" style="--c:${esc(l.color || 'var(--accent)')}" aria-hidden="true"></span>
      <span class="ck-line-name">${esc(l.name)} <span class="ck-line-x">× ${l.qty}</span></span>
      <span class="ck-line-amt">${fmt.cop(l.amount)}</span>
      <span class="ck-line-seat">${seatTxt(l.seating)}${l.qty > 1 ? ` · ${fmt.cop(l.price)} c/u` : ''}</span>
    </li>`;

  function couponHTML() {
    return `<div class="ck-cp" data-cp>
      <div data-cp-edit>
        <label class="ck-cp-label" for="ck-cp-in">${icon('tag', 15)}Cupón de descuento</label>
        <div class="input-group">
          <input id="ck-cp-in" class="input input-mono" data-cp-in placeholder="Código de cupón" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" aria-describedby="ck-cp-err">
          <button type="button" class="btn btn-line" data-cp-apply>Aplicar</button>
        </div>
        <p class="ck-cp-err" id="ck-cp-err" data-cp-err role="alert" hidden></p>
        <button type="button" class="ck-cp-try" data-cp-try>Prueba con <b class="mono">AFORO10</b></button>
      </div>
      <div class="ck-cp-on" data-cp-on hidden>
        <span class="ck-cp-badge">${icon('tag', 15)}<span data-cp-badge></span><button type="button" class="ck-cp-x" data-cp-remove aria-label="Quitar cupón">${icon('x', 16)}</button></span>
        <span class="ck-cp-desc" data-cp-desc></span>
      </div>
    </div>`;
  }

  /* Resumen tipo boleta. s = { lines, qty, subtotal, discount, fee, total, couponCode } */
  function summaryHTML(ev, s, opts = {}) {
    const v = Store.venueOf(ev.id);
    return `<div class="panel ck-ticket">
      <div class="ck-tk-head">
        <img class="ck-tk-poster" src="${esc(ev.img)}" alt="" decoding="async">
        <div class="ck-tk-info">
          <p class="eyebrow">${esc(ev.category)}</p>
          <h2 class="ck-tk-title">${esc(ev.title)}</h2>
          <p class="ck-tk-meta"><span>${esc(when(ev))}</span><span>${esc(v.name)} · ${esc(v.city)}</span></p>
        </div>
      </div>
      <div class="ck-tk-links">
        <button type="button" class="ck-tk-link" data-locmap-zoom="${esc(ev.id)}">${icon('layers', 15)}Ver ubicaciones</button>
        ${opts.change ? `<a class="ck-tk-link ck-tk-change" href="#/evento/${esc(ev.id)}">${icon('edit', 15)}Cambiar</a>` : ''}
      </div>
      <div class="perf" aria-hidden="true"></div>
      <p class="eyebrow ck-tk-eb">Tu compra</p>
      <ul class="ck-lines">${s.lines.map(lineHTML).join('')}</ul>
      ${opts.coupon ? couponHTML() : ''}
      <div class="perf" aria-hidden="true"></div>
      <dl class="kv ck-kv">
        <div><dt>Subtotal · ${qtyTxt(s.qty)}</dt><dd data-k="subtotal">${fmt.cop(s.subtotal)}</dd></div>
        <div class="ck-kv-disc" data-k-row="discount" ${s.discount ? '' : 'hidden'}><dt>Cupón <span class="mono" data-k="code">${esc(s.couponCode || '')}</span></dt><dd data-k="discount">−${fmt.cop(s.discount)}</dd></div>
        <div><dt>Cargo por servicio (${FEE_PCT} %)</dt><dd data-k="fee">${fmt.cop(s.fee)}</dd></div>
        <div class="kv-total"><dt>Total</dt><dd data-k="total">${fmt.cop(s.total)}</dd></div>
      </dl>
      ${opts.cta || ''}
    </div>`;
  }
  const fromQuote = (q) => ({ lines: q.lines, qty: q.qty, subtotal: q.subtotal, discount: q.discount, fee: q.fee, total: q.total, couponCode: q.coupon ? q.coupon.code : '' });
  const fromOrder = (o) => ({ lines: o.lines, qty: o.items.reduce((a, i) => a + i.qty, 0), subtotal: o.subtotal, discount: o.discount, fee: o.fee, total: o.total, couponCode: o.coupon || '' });

  /* ---------------- CHECKOUT ---------------- */

  function emptyHTML() {
    const mine = Store.myTickets().length;
    return `<div class="wrap ck-empty">
      <div class="ck-empty-art" aria-hidden="true">
        <div class="stub ck-ghost ck-ghost-a"><i></i><i></i><i></i></div>
        <div class="stub ck-ghost ck-ghost-b"><span class="mono">0</span><span>boletas<br>apartadas</span></div>
      </div>
      <div class="ck-empty-txt">
        <p class="eyebrow">Checkout</p>
        <h1 class="h1">No tienes boletas apartadas</h1>
        <p class="lead">Elige un evento y la cantidad de boletas: quedan apartadas a tu nombre por ${Math.round(D.holdSeconds / 60)} minutos mientras pagas, y nadie más puede comprarlas.</p>
        <div class="ck-empty-btns">
          <a class="btn btn-primary btn-lg" href="#/">Ir a la cartelera ${icon('arrow', 18)}</a>
          ${mine ? `<a class="btn btn-line btn-lg" href="#/boletas">${icon('ticket', 18)}Mis boletas</a>` : ''}
        </div>
        <button type="button" class="ck-demo-link" data-demo-hold>${icon('sparkle', 15)}Solo quiero ver el pago: aparta 2 boletas de ejemplo</button>
      </div>
    </div>`;
  }

  function pendingHTML(h, o) {
    const ev = Store.event(o.eventId);
    const g = gwOf(o.gateway);
    return `<div class="wrap ck">
      ${headHTML(ev, 'Tienes un pago en curso', 3)}
      <div class="ck-grid is-pending">
        <div class="ck-area-clock">${clockHTML(h, 'Tus boletas están apartadas', 'Mientras el pago siga abierto, nadie más puede comprarlas.')}</div>
        <aside class="ck-sum" aria-label="Resumen de la compra">${summaryHTML(ev, fromOrder(o), {})}</aside>
        <div class="ck-form">
          <section class="ck-sec ck-pending">
            <span class="ck-pending-ico" aria-hidden="true">${icon('lock', 22)}</span>
            <h2 class="h2">Dejaste abierto el pago en ${esc(g.name)}</h2>
            <p class="muted">Orden <span class="mono">${esc(o.id)}</span> · ${esc(o.method)} · ${fmt.cop(o.total)}. Vuelve a la pasarela para terminarlo, o cancélalo si quieres cambiar algo.</p>
            <div class="ck-pending-btns">
              <a class="btn btn-primary btn-lg" href="#/pago/${esc(o.id)}">Volver a la pasarela ${icon('arrow', 18)}</a>
              <button type="button" class="btn btn-line btn-lg" data-cancel-pay>Cancelar pago</button>
            </div>
            <p class="tiny faint">Si cancelas, tus boletas siguen apartadas hasta que se acabe el tiempo.</p>
          </section>
        </div>
      </div>
    </div>`;
  }

  const field = (k, label, type, ac, extra = '') => `<div class="field ck-field" data-field="${k}">
      <label for="ck-${k}">${label}</label>
      <input id="ck-${k}" class="input" name="${k}" type="${type}" autocomplete="${ac}" value="${esc(draft.buyer[k] || '')}" aria-describedby="ck-${k}-err" ${extra}>
      <p class="error" id="ck-${k}-err" data-err hidden></p>
    </div>`;

  function methodsHTML(g) {
    if (!g.methods.includes(draft.method)) draft.method = g.methods[0];
    return `<legend>Método de pago con ${esc(g.name)}</legend>
      <div class="ck-mchips">${g.methods.map((m) => `<label class="ck-mchip${m === draft.method ? ' is-on' : ''}">
          <input type="radio" name="method" value="${esc(m)}" ${m === draft.method ? 'checked' : ''}>${icon(mInfo(m).icon, 17)}<span>${esc(m)}</span>
        </label>`).join('')}</div>
      <p class="ck-mnote" data-mnote>${icon('info', 16)}<span>${esc(mInfo(draft.method).note)}</span></p>`;
  }

  const payBtn = (total, extraCls = '', attrs = '') =>
    `<button type="submit" class="btn btn-primary btn-lg ck-pay ${extraCls}" data-pay ${attrs}>${icon('lock', 18)}<span data-pay-txt>Pagar <span data-pay-amt>${fmt.cop(total)}</span></span></button>`;

  function formHTML(h) {
    const ev = Store.event(h.eventId);
    hydrateDraft(h);
    let q = Store.quote(draft.coupon);
    if (draft.coupon && !q.coupon) { draft.coupon = ''; q = Store.quote(''); }
    const g = gwOf(draft.gateway);
    const cta = `<div class="ck-cta">
        ${payBtn(q.total, 'btn-block', 'form="ck-form"')}
        <p class="ck-secure">${icon('shield', 15)}<span>Pago simulado con <b data-gw-name>${esc(g.name)}</b>: no se hace ningún cobro.</span></p>
      </div>`;
    return `<div class="wrap ck has-dock">
      ${headHTML(ev, 'Confirma y paga', 2)}
      <div class="ck-grid">
        <div class="ck-area-clock">${clockHTML(h, 'Tus boletas están apartadas', 'Nadie más puede comprarlas mientras pagas. Si el tiempo se acaba, se liberan.')}</div>
        <aside class="ck-sum" aria-label="Resumen de la compra">${summaryHTML(ev, fromQuote(q), { change: true, coupon: true, cta })}</aside>
        <form class="ck-form" id="ck-form" novalidate>
          <section class="ck-sec" aria-labelledby="ck-s1">
            <header class="ck-sec-head"><span class="ck-num">01</span><h2 class="h3" id="ck-s1">Tus datos</h2><span class="badge badge-warn ck-sample">Datos de ejemplo</span></header>
            <p class="ck-sec-sub">Las boletas llegan a este correo y, por WhatsApp, a este celular.</p>
            <div class="ck-fields">
              ${field('name', 'Nombre completo', 'text', 'name')}
              ${field('email', 'Correo', 'email', 'email', 'inputmode="email" spellcheck="false"')}
              ${field('phone', 'Celular', 'tel', 'tel', 'inputmode="tel"')}
              ${field('doc', 'Documento de identidad', 'text', 'off', 'spellcheck="false"')}
            </div>
          </section>

          <section class="ck-sec" aria-labelledby="ck-s2">
            <header class="ck-sec-head"><span class="ck-num">02</span><h2 class="h3" id="ck-s2">Pasarela de pago</h2></header>
            <p class="ck-sec-sub">Pagas en la pasarela que elijas; aforo recibe su confirmación y emite tus boletas.</p>
            <div class="ck-gws" role="radiogroup" aria-labelledby="ck-s2">
              ${D.gateways.map((x) => `<label class="ck-gw${x.id === g.id ? ' is-on' : ''}">
                  <input type="radio" name="gateway" value="${esc(x.id)}" ${x.id === g.id ? 'checked' : ''}>
                  <span class="ck-gw-radio" aria-hidden="true"></span>
                  <span class="ck-gw-body"><span class="ck-gw-name">${esc(x.name)}</span><span class="ck-gw-note">${esc(x.note)}</span></span>
                </label>`).join('')}
            </div>
            <fieldset class="ck-methods" data-methods>${methodsHTML(g)}</fieldset>
          </section>

          <section class="ck-sec ck-legal" aria-label="Términos y tratamiento de datos">
            <label class="ck-check">
              <input type="checkbox" name="terms" data-terms ${draft.terms ? 'checked' : ''} aria-describedby="ck-terms-err">
              <span>Acepto los <button type="button" class="ck-link" data-terms-open>términos de compra</button> y autorizo el tratamiento de mis datos personales conforme a la Ley 1581 de 2012.</span>
            </label>
            <p class="error ck-terms-err" id="ck-terms-err" data-terms-err hidden>Acepta los términos para continuar.</p>
          </section>

          <div class="dock ck-dock">
            <div class="dock-in">
              <div class="ck-dock-meta">
                <span class="ck-dock-qty">${qtyTxt(q.qty)} · apartadas</span>
                <span class="ck-dock-left" data-dock-left>${icon('timer', 15)}<span data-clock-left>${fmt.mmss((h.until - Date.now()) / 1000)}</span></span>
              </div>
              ${payBtn(q.total)}
            </div>
          </div>
        </form>
      </div>
    </div>`;
  }

  function openTerms() {
    UI.sheet({
      title: 'Términos de compra',
      body: `<ul class="ck-terms">
          <li><b>Reserva temporal.</b> Las boletas quedan apartadas a tu nombre por ${Math.round(D.holdSeconds / 60)} minutos; si no pagas, se liberan para otras personas.</li>
          <li><b>Sillas numeradas.</b> La fila y la silla se asignan solas al confirmar el pago, en orden de compra.</li>
          <li><b>QR único.</b> Cada boleta lleva un código firmado que permite un solo ingreso.</li>
          <li><b>Cargo por servicio.</b> ${FEE_PCT} % sobre el valor de las boletas después de descuentos.</li>
          <li><b>Tratamiento de datos (Ley 1581 de 2012).</b> Usamos tu nombre, correo, celular y documento solo para emitir y enviar tus boletas y validar tu ingreso. Puedes consultar, actualizar o pedir que borremos tus datos cuando quieras.</li>
        </ul>
        <p class="tiny faint ck-terms-note">Texto de ejemplo para el demo.</p>`,
      actions: '<button type="button" class="btn btn-ink" data-close>Entendido</button>'
    });
  }

  function mountForm(root, ctx, h) {
    const eventId = h.eventId;
    const form = root.querySelector('#ck-form');
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => Array.from(root.querySelectorAll(s));
    let applied = draft.coupon;
    let busy = false;

    const setK = (k, v) => $$(`[data-k="${k}"]`).forEach((el) => { el.textContent = v; });
    function paint() {
      const q = Store.quote(applied);
      if (!q) return;
      setK('subtotal', fmt.cop(q.subtotal));
      setK('fee', fmt.cop(q.fee));
      setK('total', fmt.cop(q.total));
      const row = $('[data-k-row="discount"]');
      row.hidden = !q.discount;
      if (q.discount) { setK('discount', '−' + fmt.cop(q.discount)); setK('code', q.coupon.code); }
      $$('[data-pay-amt]').forEach((el) => { el.textContent = fmt.cop(q.total); });
    }

    /* --- Cupón --- */
    const cpIn = $('[data-cp-in]');
    const cpErr = $('[data-cp-err]');
    function showApplied(cp, discount) {
      $('[data-cp-edit]').hidden = true;
      $('[data-cp-on]').hidden = false;
      $('[data-cp-badge]').textContent = `${cp.code} · ${offTxt(cp)}`;
      $('[data-cp-desc]').textContent = `${cp.label || 'Cupón aplicado'} · ahorras ${fmt.cop(discount)}`;
    }
    function showEdit() {
      $('[data-cp-edit]').hidden = false;
      $('[data-cp-on]').hidden = true;
    }
    function cpError(msg) {
      cpErr.textContent = msg;
      cpErr.hidden = !msg;
      cpIn.classList.toggle('is-invalid', !!msg);
    }
    function applyCoupon(raw) {
      const c = String(raw || '').trim().toUpperCase();
      if (!c) { cpError('Escribe el código del cupón.'); cpIn.focus(); return; }
      const q = Store.quote(c);
      if (q && q.coupon) {
        applied = draft.coupon = q.coupon.code;
        draft.touched = true;
        cpError('');
        cpIn.value = '';
        showApplied(q.coupon, q.discount);
        paint();
        UI.toast(`Cupón ${q.coupon.code} aplicado: ahorras ${fmt.cop(q.discount)}.`, { type: 'ok' });
        const x = $('[data-cp-remove]');
        if (x) x.focus({ preventScroll: true });
      } else {
        cpError((q && q.couponError) || 'Ese cupón no existe.');
      }
    }
    if (applied) {
      const q = Store.quote(applied);
      if (q && q.coupon) showApplied(q.coupon, q.discount);
    }
    $('[data-cp-apply]').addEventListener('click', () => applyCoupon(cpIn.value));
    $('[data-cp-try]').addEventListener('click', () => { cpIn.value = 'AFORO10'; applyCoupon('AFORO10'); });
    cpIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(cpIn.value); } });
    cpIn.addEventListener('input', () => { if (!cpErr.hidden) cpError(''); });
    $('[data-cp-remove]').addEventListener('click', () => {
      applied = draft.coupon = '';
      draft.touched = true;
      showEdit();
      paint();
      cpIn.focus();
    });

    /* Cualquier cambio del comprador manda sobre lo recuperado de un pago anterior. */
    const touch = () => { draft.touched = true; };
    form.addEventListener('input', touch);
    form.addEventListener('change', touch);

    /* --- Pasarela y método --- */
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'gateway') {
        draft.gateway = t.value;
        const g = gwOf(t.value);
        $$('.ck-gw').forEach((l) => l.classList.toggle('is-on', l.querySelector('input').checked));
        $('[data-methods]').innerHTML = methodsHTML(g);
        $$('[data-gw-name]').forEach((el) => { el.textContent = g.name; });
      } else if (t.name === 'method') {
        draft.method = t.value;
        $$('.ck-mchip').forEach((l) => l.classList.toggle('is-on', l.querySelector('input').checked));
        const n = $('[data-mnote] span');
        if (n) n.textContent = mInfo(t.value).note;
      } else if (t.name === 'terms') {
        draft.terms = t.checked;
        if (t.checked) $('[data-terms-err]').hidden = true;
      }
    });

    /* --- Datos del comprador --- */
    function check(k, show) {
      const inp = $('#ck-' + k);
      const msg = RULES[k](inp.value);
      const err = inp.parentElement.querySelector('[data-err]');
      if (show || !msg) {
        err.textContent = msg;
        err.hidden = !msg;
        inp.classList.toggle('is-invalid', !!msg);
        inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
      }
      return msg;
    }
    Object.keys(RULES).forEach((k) => {
      const inp = $('#ck-' + k);
      inp.addEventListener('input', () => {
        draft.buyer[k] = inp.value;
        if (inp.classList.contains('is-invalid')) check(k, false);
      });
      inp.addEventListener('blur', () => { if (inp.value) check(k, true); });
    });

    $('[data-terms-open]').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openTerms(); });

    /* --- Pagar --- */
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      let first = null;
      Object.keys(RULES).forEach((k) => { if (check(k, true) && !first) first = $('#ck-' + k); });
      const terms = $('[data-terms]');
      if (!terms.checked) { $('[data-terms-err]').hidden = false; if (!first) first = terms; }
      if (first) {
        (first.closest('.field, .ck-legal') || first).scrollIntoView({ block: 'center', behavior: 'smooth' });
        first.focus({ preventScroll: true });
        UI.toast(first === terms ? 'Acepta los términos para continuar.' : 'Revisa los datos marcados para continuar.', { type: 'warn' });
        return;
      }
      const b = draft.buyer;
      draft.touched = true;
      const order = Store.createOrder({
        buyer: { name: b.name.trim(), email: b.email.trim(), phone: b.phone.trim(), doc: b.doc.trim() },
        coupon: applied || null, gateway: draft.gateway, method: draft.method
      });
      if (!order) {
        UI.toast('Tu reserva ya no está activa. Vuelve a elegir tus boletas.', { type: 'warn' });
        App.go('/evento/' + eventId);
        return;
      }
      busy = true;
      $$('[data-pay]').forEach((btn) => {
        btn.disabled = true;
        btn.classList.add('is-busy');
        btn.querySelector('[data-pay-txt]').textContent = `Abriendo ${gwOf(order.gateway).name}…`;
      });
      ctx.later(520, () => App.go('/pago/' + order.id));
    });

    /* --- Reloj y vencimiento --- */
    ctx.every(1000, () => {
      const hh = Store.myHold(); // si venció, la tienda la libera y emite 'hold' (null)
      if (hh) tickClock(root, hh);
    });
    const later = deferOnce();
    ctx.sub('hold', (hh) => {
      if (hh || busy) return;
      if (Date.now() >= h.until - 1500) later(() => App.go('/evento/' + eventId)); // venció: app.js muestra el aviso
      else later(() => App.rerender());
    });
  }

  App.view({
    id: 'checkout', path: '/checkout', role: 'buyer', title: 'Confirma y paga',
    render() {
      const h = Store.myHold();
      if (!h) return emptyHTML();
      if (h.orderId) {
        const o = orderOf(h.orderId);
        if (o && o.status === 'pending') return pendingHTML(h, o);
      }
      return formHTML(h);
    },
    mount(root, params, ctx) {
      const h = Store.myHold();
      if (!h) {
        const b = root.querySelector('[data-demo-hold]');
        if (b) b.addEventListener('click', () => {
          const r = Store.setQty('bogota-principiantes', 'platea', 2);
          if (!r.ok) {
            const r2 = Store.setQty('cumbia-electrica', 'general', 2);
            if (!r2.ok) { UI.toast(r.msg || r2.msg, { type: 'warn' }); return; }
          }
          UI.toast('Apartamos 2 boletas de ejemplo.', { type: 'ok' });
          App.rerender();
        });
        return;
      }
      if (h.orderId && (orderOf(h.orderId) || {}).status === 'pending') {
        root.querySelector('[data-cancel-pay]').addEventListener('click', () => {
          Store.cancelPayment();
          UI.toast('Cancelaste el pago. Tus boletas siguen apartadas.', { type: 'info' });
          App.rerender();
        });
        ctx.every(1000, () => { const hh = Store.myHold(); if (hh) tickClock(root, hh); });
        const later = deferOnce();
        ctx.sub('hold', (hh) => {
          if (hh) return;
          if (Date.now() >= h.until - 1500) later(() => App.go('/evento/' + h.eventId));
          else later(() => App.rerender());
        });
        return;
      }
      mountForm(root, ctx, h);
    }
  });

  /* ---------------- PASARELA SIMULADA ---------------- */

  const REDIRECT_S = 3; // segundos con el resultado a la vista antes de abrir las boletas

  function stepsFor(o) {
    const g = gwOf(o.gateway);
    const n = o.items.reduce((a, i) => a + i.qty, 0);
    const auth = UI.hash(o.id + '|auth').toString(36).slice(0, 6).toUpperCase();
    return [
      { t: `Conectando con ${g.name}`, d: 'Abriendo una sesión cifrada con la pasarela', done: `Sesión segura abierta con ${g.name}` },
      { t: 'Autorizando con el banco', d: 'Esperando la respuesta del banco…', wait: 'Esperando la respuesta del banco · en el demo la eliges tú', done: `Aprobada · autorización ${auth}`, fail: 'Rechazada por el banco · fondos insuficientes', skip: 'Sin respuesta: la reserva venció' },
      { t: 'Confirmación recibida por webhook', d: 'POST /api/v1/pagos/webhook', done: 'POST /api/v1/pagos/webhook · 200 OK', skip: 'No hubo confirmación' },
      { t: 'Emitiendo boletas con QR único', d: `${qtyTxt(n)} · un código firmado por boleta`, done: `${n === 1 ? '1 QR emitido' : n + ' QR emitidos'} · listas en «Mis boletas»`, skip: 'No se emitieron boletas' }
    ];
  }
  const payload = (o, estado) => `POST /api/v1/pagos/webhook
{
  "pasarela": "${o.gateway}",
  "referencia": "${o.ref}",
  "orden": "${o.id}",
  "estado": "${estado}",
  "valor": ${o.total},
  "moneda": "COP"
}`;

  function stepHTML(s, i, state, detail) {
    return `<li class="ck-step" data-step="${i}" data-state="${state}">
      <span class="ck-mark" aria-hidden="true">${icon('check', 16, 'ck-i-ok')}${icon('x', 16, 'ck-i-bad')}</span>
      <div class="ck-step-txt">
        <p class="ck-step-t">${esc(s.t)}</p>
        <p class="ck-step-d" data-d>${esc(detail || s.d)}</p>
        ${i === 2 ? '<pre class="ck-code" data-code hidden></pre>' : ''}
      </div>
    </li>`;
  }

  function outcomeHTML(kind, o, h) {
    const ev = Store.event(o.eventId);
    if (kind === 'failed') {
      return `<div class="ck-result is-bad">
        <span class="ck-result-ico">${icon('xCircle', 26)}</span>
        <div>
          <p class="ck-result-t">El banco rechazó el pago</p>
          <p class="ck-result-p">No se hizo ningún cobro. ${h ? `Tus boletas siguen apartadas hasta las ${esc(time(h.until))}: inténtalo con otro método o pasarela.` : 'La reserva ya venció y liberamos las boletas.'}</p>
          <div class="ck-result-btns">${h ? `<a class="btn btn-primary" href="#/checkout">${icon('refresh', 17)}Intentar de nuevo</a>` : `<a class="btn btn-primary" href="#/evento/${esc(ev.id)}">Volver al evento</a>`}</div>
        </div>
      </div>`;
    }
    if (kind === 'cancelled') {
      return `<div class="ck-result">
        <span class="ck-result-ico">${icon('info', 26)}</span>
        <div>
          <p class="ck-result-t">Cancelaste este pago</p>
          <p class="ck-result-p">No se hizo ningún cobro.${h ? ' Tus boletas siguen apartadas.' : ''}</p>
          <div class="ck-result-btns">${h ? '<a class="btn btn-primary" href="#/checkout">Volver al checkout</a>' : `<a class="btn btn-primary" href="#/evento/${esc(ev.id)}">Volver al evento</a>`}</div>
        </div>
      </div>`;
    }
    if (kind === 'expired') {
      return `<div class="ck-result is-warn">
        <span class="ck-result-ico">${icon('timer', 26)}</span>
        <div>
          <p class="ck-result-t">La reserva venció antes de terminar el pago</p>
          <p class="ck-result-p">No se hizo ningún cobro y liberamos las boletas para que otras personas puedan comprarlas.</p>
          <div class="ck-result-btns"><a class="btn btn-primary" href="#/evento/${esc(ev.id)}">Elegir de nuevo</a></div>
        </div>
      </div>`;
    }
    return `<div class="ck-result is-ok">
        <span class="ck-result-ico">${icon('checkCircle', 26)}</span>
        <div>
          <p class="ck-result-t">Pago aprobado</p>
          <p class="ck-result-p">Tus boletas ya tienen su QR único. Te llevamos a ellas en <span class="mono" data-redir>${REDIRECT_S}</span>&nbsp;s.</p>
          <div class="ck-result-btns"><a class="btn btn-ink" href="#/boletas/${esc(o.id)}">${icon('ticket', 17)}Ver mis boletas</a></div>
        </div>
      </div>`;
  }

  function payNotFound() {
    return `<div class="wrap empty-page ck-nf">
      <p class="eyebrow">Pasarela de pagos</p>
      <h1 class="h1">No encontramos ese pago</h1>
      <p class="muted">Puede que la orden sea de otra sesión del demo o que el enlace esté incompleto.</p>
      <div class="ck-empty-btns"><a class="btn btn-primary" href="#/">Ir a la cartelera</a><a class="btn btn-line" href="#/checkout">Ir al checkout</a></div>
    </div>`;
  }

  /* Estado visible de la orden en la pasarela. */
  function payState(o) {
    const h = Store.myHold();
    if (o.status === 'pending') return h && h.orderId === o.id ? 'live' : 'expired';
    return o.status; // failed · cancelled · expired · paid
  }

  function payHTML(o) {
    const ev = Store.event(o.eventId);
    const g = gwOf(o.gateway);
    const h = Store.myHold();
    const state = payState(o);
    const S = stepsFor(o);
    const n = o.items.reduce((a, i) => a + i.qty, 0);
    const plan = {
      live: [['active'], ['pending'], ['pending'], ['pending']],
      failed: [['done', S[0].done], ['fail', S[1].fail], ['done', S[2].done], ['skip', S[3].skip]],
      cancelled: [['done', S[0].done], ['skip', 'Cancelado por el comprador'], ['skip', S[2].skip], ['skip', S[3].skip]],
      expired: [['done', S[0].done], ['skip', S[1].skip], ['skip', S[2].skip], ['skip', S[3].skip]],
      paid: [['done', S[0].done], ['done', S[1].done], ['done', S[2].done], ['done', S[3].done]]
    }[state] || [];
    const showClock = h && (state === 'live' || ((state === 'failed' || state === 'cancelled') && !h.orderId && h.eventId === o.eventId));
    return `<div class="wrap ck ck-pay-page" data-pay-state="${state}">
      ${headHTML(state === 'live' ? null : ev, state === 'live' ? 'Completa el pago' : 'Estado del pago', 3)}
      <div class="ck-paygrid">
        <div class="ck-paymain">
          ${showClock ? clockHTML(h, 'Tus boletas siguen apartadas', state === 'live' ? `Tienes hasta las ${time(h.until)} para terminar el pago.` : 'Puedes intentarlo de nuevo antes de que se acabe el tiempo.') : ''}
          <section class="ck-frame" aria-labelledby="ck-frame-t">
            <header class="ck-frame-bar">
              <span class="ck-frame-lock">${icon('lock', 16)}</span>
              <span id="ck-frame-t" class="ck-frame-name">Pasarela de pagos · ${esc(g.name)} <span class="ck-frame-sim">(simulada)</span></span>
              <span class="badge badge-line ck-frame-env">Pruebas</span>
            </header>
            <div class="ck-frame-body">
              <div class="ck-frame-top">
                <div class="ck-frame-amt">
                  <p class="eyebrow" data-amt-eb>${state === 'live' ? 'Vas a pagar' : 'Valor de la orden'}</p>
                  <p class="ck-amount">${fmt.cop(o.total)}</p>
                  <p class="ck-merchant">a <b>aforo · boletería en línea</b> por ${qtyTxt(n)} de ${esc(ev.title)}</p>
                </div>
                <dl class="kv ck-frame-kv">
                  <div><dt>Referencia</dt><dd class="mono">${esc(o.ref)}</dd></div>
                  <div><dt>Orden</dt><dd class="mono">${esc(o.id)}</dd></div>
                  <div><dt>Método</dt><dd>${esc(o.method)}</dd></div>
                  <div><dt>Comprador</dt><dd class="ck-ellipsis">${esc(o.buyer.email)}</dd></div>
                </dl>
              </div>
              <ol class="ck-tl" aria-label="Avance del pago">
                ${S.map((s, i) => stepHTML(s, i, (plan[i] || ['pending'])[0], (plan[i] || [])[1])).join('')}
              </ol>
              <div class="ck-outcome" data-outcome aria-live="polite">${state === 'live' ? '' : outcomeHTML(state, o, h && !h.orderId && h.eventId === o.eventId ? h : null)}</div>
            </div>
          </section>
        </div>
          ${state === 'live' ? `<section class="ck-demo" data-demo aria-labelledby="ck-demo-t">
              <div class="ck-demo-head">
                <span class="ck-demo-ico" aria-hidden="true">${icon('settings', 18)}</span>
                <div>
                  <p class="eyebrow" id="ck-demo-t">Controles del demo</p>
                  <p class="ck-demo-p">En producción el banco responde solo. Aquí decides tú qué contesta.</p>
                </div>
              </div>
              <div class="ck-demo-btns">
                <button type="button" class="btn btn-ok" data-approve disabled>${icon('check', 18)}Aprobar pago</button>
                <button type="button" class="btn btn-line" data-reject disabled>${icon('x', 18)}Simular rechazo</button>
              </div>
              <p class="ck-demo-sent" data-demo-sent role="status" hidden></p>
            </section>` : ''}
        <aside class="ck-payside" aria-label="Resumen de la compra">
          ${summaryHTML(ev, fromOrder(o), {})}
          ${state === 'live' ? `<div class="ck-assure">
              ${icon('shield', 20)}
              <p>Mientras pagas, tus cupos quedan bloqueados: nadie más puede comprarlos. ${o.items.some((it) => (Store.option(o.eventId, it.optionId) || {}).seating === 'numerada') ? 'La fila y la silla se asignan al confirmar el pago.' : 'El acceso es general, sin silla asignada.'}</p>
            </div>
            <button type="button" class="btn btn-ghost btn-block ck-cancel" data-cancel>${icon('x', 17)}Cancelar pago</button>` : ''}
        </aside>
      </div>
    </div>`;
  }

  App.view({
    id: 'pago', path: '/pago/:orderId', role: 'buyer', title: 'Pasarela de pagos',
    render(p) {
      const o = orderOf(p.orderId);
      if (!o) return payNotFound();
      if (o.status === 'paid') {
        return `<div class="wrap ck ck-redirect"><p class="ck-redirect-t">${icon('checkCircle', 22)}Pago aprobado. Abriendo tus boletas…</p><a class="btn btn-ink" href="#/boletas/${esc(o.id)}">Ver mis boletas</a></div>`;
      }
      return payHTML(o);
    },
    mount(root, p, ctx) {
      const id = p.orderId;
      const o = orderOf(id);
      if (!o) return;
      if (o.status === 'paid') { ctx.later(60, () => App.go('/boletas/' + id, { replace: true })); return; }

      const state = payState(o);
      ctx.every(1000, () => { const hh = Store.myHold(); if (hh) tickClock(root, hh); });
      if (state !== 'live') {
        // Tras un rechazo, si la reserva vence aquí, refrescamos el estado.
        const later = deferOnce();
        ctx.sub('hold', (hh) => { if (!hh) later(() => App.rerender()); });
        return;
      }

      const S = stepsFor(o);
      const steps = Array.from(root.querySelectorAll('.ck-step'));
      const outcome = root.querySelector('[data-outcome]');
      const demo = root.querySelector('[data-demo]');
      const bA = root.querySelector('[data-approve]');
      const bR = root.querySelector('[data-reject]');
      const cancel = root.querySelector('[data-cancel]');
      let phase = 'connecting'; // connecting → bank → resolving → done

      const setStep = (i, st, detail) => {
        const li = steps[i];
        li.dataset.state = st;
        if (detail != null) li.querySelector('[data-d]').textContent = detail;
      };
      const showCode = (estado) => {
        const pre = root.querySelector('[data-code]');
        pre.textContent = payload(o, estado);
        pre.hidden = false;
      };
      const tl = root.querySelector('.ck-tl');
      const sent = root.querySelector('[data-demo-sent]');
      /* Al responder: los controles dejan de flotar (en celular tapaban la pasarela), se marca
         la respuesta elegida y la línea de tiempo sube a la vista con espacio para el webhook. */
      const lock = (btn, label) => {
        bA.disabled = true; bR.disabled = true;
        if (cancel) cancel.hidden = true;
        btn.classList.add('is-picked');
        btn.setAttribute('aria-pressed', 'true');
        demo.classList.add('is-sent');
        sent.textContent = `Enviaste «${label}». Sigue el avance en la pasarela.`;
        sent.hidden = false;
        reveal(tl, { room: 330 });
      };

      ctx.later(1100, () => {
        setStep(0, 'done', S[0].done);
        setStep(1, 'active', S[1].wait);
        phase = 'bank';
        bA.disabled = false;
        bR.disabled = false;
      });

      bA.addEventListener('click', () => {
        if (phase !== 'bank') return;
        phase = 'resolving';
        lock(bA, 'Aprobar pago');
        setStep(1, 'done', S[1].done);
        setStep(2, 'active', 'POST /api/v1/pagos/webhook · esperando a ' + gwOf(o.gateway).name);
        ctx.later(1000, () => {
          const r = Store.confirmPayment(id, true);
          if (!r || r.status !== 'paid') { App.rerender(); return; }
          // Compra cerrada: el cupón y los términos no pasan a la siguiente compra (los datos sí).
          draft.coupon = ''; draft.terms = false; draft.touched = false;
          setStep(2, 'done', S[2].done);
          showCode('APROBADA');
          setStep(3, 'active');
          ctx.later(1200, () => {
            phase = 'done';
            setStep(3, 'done', S[3].done);
            demo.hidden = true;
            outcome.innerHTML = outcomeHTML('paid', o, null);
            reveal(outcome);
            // El resultado y el webhook quedan a la vista unos segundos; también se puede saltar.
            let left = REDIRECT_S;
            const n = outcome.querySelector('[data-redir]');
            let gone = false;
            ctx.every(1000, () => {
              left -= 1;
              if (n) n.textContent = Math.max(0, left);
              if (left <= 0 && !gone) { gone = true; App.go('/boletas/' + id); }
            });
          });
        });
      });

      bR.addEventListener('click', () => {
        if (phase !== 'bank') return;
        phase = 'resolving';
        lock(bR, 'Simular rechazo');
        setStep(1, 'fail', S[1].fail);
        setStep(2, 'active', 'POST /api/v1/pagos/webhook · esperando a ' + gwOf(o.gateway).name);
        ctx.later(900, () => {
          const r = Store.confirmPayment(id, false);
          if (!r || r.status !== 'failed') { App.rerender(); return; }
          phase = 'done';
          setStep(2, 'done', S[2].done);
          showCode('RECHAZADA');
          setStep(3, 'skip', S[3].skip);
          demo.hidden = true;
          // La página pasa a «estado del pago», igual que si se recarga esta orden.
          const page = root.querySelector('.ck-pay-page');
          if (page) page.dataset.payState = 'failed';
          const h1 = root.querySelector('.ck-title');
          if (h1) h1.textContent = 'Estado del pago';
          const eb = root.querySelector('[data-amt-eb]');
          if (eb) eb.textContent = 'Valor de la orden';
          const assure = root.querySelector('.ck-assure');
          if (assure) assure.hidden = true;
          const hh = Store.myHold();
          outcome.innerHTML = outcomeHTML('failed', o, hh);
          const c = root.querySelector('[data-clock] .ck-clock-s');
          if (c) c.textContent = 'Puedes intentarlo de nuevo antes de que se acabe el tiempo.';
          reveal(outcome);
          const btn = outcome.querySelector('.btn');
          if (btn) btn.focus({ preventScroll: true });
        });
      });

      if (cancel) cancel.addEventListener('click', () => {
        if (phase === 'resolving' || phase === 'done') return;
        phase = 'done';
        Store.cancelPayment();
        UI.toast('Cancelaste el pago. Tus boletas siguen apartadas.', { type: 'info' });
        App.go('/checkout');
      });

      // La reserva vence o el pago se cancela por fuera mientras estamos aquí.
      const later = deferOnce();
      ctx.sub('order', (x) => {
        if (!x || x.id !== id || phase === 'done') return;
        if (x.status === 'expired' || x.status === 'cancelled') { phase = 'done'; later(() => App.rerender()); }
      });
      ctx.sub('hold', (hh) => {
        if (hh || phase === 'resolving' || phase === 'done') return;
        phase = 'done';
        later(() => App.rerender());
      });
    }
  });
})();
