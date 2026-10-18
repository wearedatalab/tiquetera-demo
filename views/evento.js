/* Ficha del evento (comprador): imagen de ubicaciones que subió el organizador + opciones de compra al lado.
   Sin plano generado ni selección silla por silla: se elige cantidad por opción y el cupo se aparta en vivo. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;
  const D = window.DATA;
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const boletas = (n) => (n === 1 ? '1 boleta' : fmt.num(n) + ' boletas');
  /* Personas comprando ahora, sin contar mi propia reserva. */
  const othersBuying = (id) => Store.activeHolds(id).filter((h) => !h.mine).length;
  const buying = (n) => (n <= 0 ? 'Nadie más comprando en este momento' : n === 1 ? '1 persona comprando ahora' : `${fmt.num(n)} personas comprando ahora`);

  function splitAddress(v) {
    const a = String(v.address || '');
    const i = a.lastIndexOf(',');
    return i < 0 ? { street: '', area: a.trim() } : { street: a.slice(0, i).trim(), area: a.slice(i + 1).trim() };
  }

  function ageText(age) {
    const m = /\+(\d+)/.exec(age || '');
    return m ? `Solo mayores de ${m[1]} años. Lleva tu documento de identidad: te lo pueden pedir en la puerta` : 'Apto para todo público. Los menores de 12 años entran con un adulto';
  }

  function notFound(id) {
    return `<div class="wrap empty-page">
      <p class="eyebrow">Evento no encontrado</p>
      <h1 class="h1">Este evento no está en la cartelera</h1>
      <p class="muted">Código: <span class="mono">${esc(id)}</span></p>
      <a class="btn btn-primary" href="#/">${icon('left', 18)} Volver a la cartelera</a>
    </div>`;
  }

  /* Disponibilidad en dos partes: cupo («Últimas 9») y, en ámbar, lo que otras personas están pagando. */
  function availParts(st) {
    const av = LocMap.availability(st);
    const i = av.text.indexOf(' · ');
    let main = i < 0 ? av.text : av.text.slice(0, i);
    const proc = i < 0 ? '' : av.text.slice(i + 3);
    if (st.status === 'low' && st.free === 1) main = 'Queda 1'; // «Últimas 1» no suena bien
    return { cls: av.cls, main, proc, key: av.cls + '|' + main + '|' + proc };
  }
  const availHtml = (p) => `<span class="ev-av-m">${esc(p.main)}</span>${p.proc ? `<span class="sr-only">, </span><span class="ev-proc">${esc(p.proc)}</span>` : ''}`;

  function optRow(id, o) {
    const st = Store.optionStats(id, o.id);
    const p = availParts(st);
    const q = Store.myQty(id, o.id);
    return `<div class="opt ev-opt" style="--oc:${esc(o.color)}" data-opt="${esc(o.id)}">
      <span class="opt-swatch" aria-hidden="true"></span>
      <div class="opt-body">
        <p class="ev-seat">${icon(o.seating === 'numerada' ? 'seat' : 'users', 13)}${esc(LocMap.seatingLabel(o))}</p>
        <p class="opt-name">${esc(o.name)}</p>
        <p class="opt-note">${esc(o.note)}</p>
      </div>
      <div class="opt-side">
        <p class="opt-price">${fmt.cop(o.price)}</p>
        <div class="stepper" role="group" aria-label="Cantidad de ${esc(o.name)}">
          <button type="button" data-dec aria-label="Quitar una boleta de ${esc(o.name)}" ${q ? '' : 'disabled'}>${icon('minus', 18)}</button>
          <output data-qty aria-label="Boletas de ${esc(o.name)}">${q}</output>
          <button type="button" data-inc aria-label="Agregar una boleta de ${esc(o.name)}" ${st.free > 0 ? '' : 'aria-disabled="true" class="is-off"'}>${icon('plus', 18)}</button>
        </div>
      </div>
      <p class="opt-avail ${p.cls}" data-avail data-k="${esc(p.key)}">${availHtml(p)}</p>
    </div>`;
  }

  /* Boleta de muestra: código y QR derivados del evento (no es una boleta real). */
  function sampleTicket(ev) {
    const r = UI.rng('muestra|' + ev.id);
    const c = 'AFR-' + UI.code(4, r) + '-' + UI.code(4, r);
    const qr = UI.qr(`AFORO|${c}|${ev.id}|MUESTRA`, { dark: '#14121F', light: '#FFFFFF' });
    return `<div class="stub-wrap ev-sample" aria-hidden="true">
      <div class="stub ev-sample-stub">
        <div class="ev-sample-main">
          <p class="ev-sample-k">aforo · boleta de muestra</p>
          <p class="ev-sample-t">${esc(ev.title)}</p>
          <p class="ev-sample-s">${esc(cap(fmt.date(ev.date)))} · ${esc(fmt.time(ev.date))}</p>
          <p class="ev-sample-c">${esc(c)}</p>
        </div>
        <div class="ev-sample-qr">${qr}</div>
      </div>
    </div>`;
  }

  App.view({
    id: 'evento', path: '/evento/:id', role: 'buyer',
    title: (p) => (Store.event(p.id) || {}).title || 'Evento',

    render(p) {
      const ev = Store.event(p.id);
      if (!ev) return notFound(p.id);
      const v = Store.venueOf(ev.id);
      const addr = splitAddress(v);
      const opts = Store.options(ev.id);
      const numbered = opts.some((o) => o.seating === 'numerada');
      const n = othersBuying(ev.id);
      const when = cap(fmt.dateLong(ev.date));
      const from = fmt.cop(Store.minPrice(ev.id));

      return `
      <header class="ev-head">
        <div class="ev-head-bg" aria-hidden="true"><img src="${esc(ev.img)}" alt="" decoding="async" fetchpriority="high"></div>
        <div class="wrap ev-head-in">
          <a class="ev-back" href="#/">${icon('left', 18)}<span>Cartelera</span></a>
          <div class="ev-head-grid">
            <div class="ev-head-txt">
              <p class="ev-kicker">${esc(ev.category)} · ${esc(v.name)}</p>
              <h1 class="display-2 ev-title">${esc(ev.title)}</h1>
              <p class="ev-artist">${esc(ev.artist)}</p>
              <p class="ev-when">${icon('calendar', 18)}<span><strong>${esc(when)}</strong> · ${esc(fmt.time(ev.date))}</span></p>
              <p class="ev-where">${icon('pin', 18)}<span><strong>${esc(v.name)}</strong> · ${addr.street ? `<span class="ev-street">${esc(addr.street)}, </span>` : ''}${esc(addr.area)}, ${esc(v.city)}</span></p>
              <ul class="ev-tags" aria-label="Datos del evento">
                <li><span class="ev-tag-k">Puertas</span> <span class="ev-tag-v">${esc(ev.doors)}</span></li>
                <li><span class="ev-tag-k">Edad</span> <span class="ev-tag-v">${esc(ev.age)}</span></li>
                <li><span class="ev-tag-k">Duración</span> <span class="ev-tag-v">${esc(ev.duration)}</span></li>
              </ul>
              <div class="ev-head-act">
                <p class="ev-live ${n ? '' : 'is-calm'}" data-live data-n="${n}"><i aria-hidden="true"></i><span data-live-n>${esc(buying(n))}</span></p>
                <button type="button" class="btn btn-primary btn-lg ev-jump" data-jump aria-label="Elegir boletas, desde ${esc(from)}">Elegir boletas<span class="ev-jump-p" aria-hidden="true">desde ${esc(from)}</span>${icon('down', 18)}</button>
              </div>
            </div>
            <figure class="ev-poster"><img src="${esc(ev.img)}" alt="Póster de ${esc(ev.title)}" decoding="async"></figure>
          </div>
        </div>
      </header>

      <section class="wrap ev-buy" aria-labelledby="ev-buy-title">
        <div class="ev-buy-head">
          <p class="eyebrow">Elige tus boletas</p>
          <h2 class="h1" id="ev-buy-title" tabindex="-1">Ubicaciones y precios</h2>
          <p class="ev-buy-sub">Cada organizador publica su propia imagen de ubicaciones. Ubica tu zona por el color y elige cuántas boletas quieres en la lista.</p>
        </div>
        <div class="ev-buy-grid">
          <div class="ev-map">
            ${LocMap.figure(ev.id, { cls: 'ev-figure', zoom: false, caption: false })}
            <div class="ev-figbar">
              <p class="ev-figcap">${icon('info', 14)}<span>Imagen publicada por el organizador<span class="ev-figcap-x">: ubica tu zona por el color</span></span></p>
              <button type="button" class="btn btn-sm btn-line ev-zoom" data-locmap-zoom="${esc(ev.id)}" aria-label="Ampliar la imagen de ubicaciones">${icon('search', 16)}<span>Ampliar</span></button>
            </div>
            <div class="ev-key">
              <p class="ev-key-k">Cómo leer el cupo</p>
              <dl>
                <div><dt><i class="is-ok" aria-hidden="true"></i>Quedan</dt><dd>Cupo libre en este momento.</dd></div>
                <div><dt><i class="is-low" aria-hidden="true"></i>Últimas</dt><dd>Quedan pocas boletas en esa opción.</dd></div>
                <div><dt><i class="is-proc" aria-hidden="true"></i>En proceso</dt><dd>Otras personas las están pagando. Si su reserva vence, se liberan.</dd></div>
                <div><dt><i class="is-out" aria-hidden="true"></i>Agotado</dt><dd>No queda cupo para vender.</dd></div>
              </dl>
            </div>
          </div>
          <div class="ev-side">
            <div class="ev-notice-slot" data-notice></div>
            <div class="ev-opts-head">
              <h3 class="h3">Opciones de compra</h3>
              <span class="ev-max" data-max>Máx. ${D.maxPerOrder} por compra</span>
            </div>
            <div class="ev-scroll-box" data-scrollbox>
              <div class="ev-scroll" data-scroll>
                <p class="ev-rt"><i aria-hidden="true"></i>El cupo descuenta en tiempo real lo que otras personas están pagando: no se vende dos veces la misma boleta.</p>
                <div class="opt-list ev-opts" data-opts>
                  ${opts.map((o) => optRow(ev.id, o)).join('')}
                </div>
                ${numbered ? `<p class="ev-seatnote">${icon('seat', 16)}<span>En las opciones numeradas, la fila y la silla se asignan al confirmar el pago.</span></p>` : ''}
              </div>
            </div>
            <p class="sr-only" aria-live="polite" data-sum-sr></p>
            <div class="ev-sum" data-sum></div>
          </div>
        </div>
      </section>

      <section class="wrap ev-more" aria-label="Información del evento">
        <div class="ev-about">
          <p class="eyebrow">Sobre el evento</p>
          <p class="ev-blurb">${esc(ev.blurb)}</p>
        </div>
        <div class="ev-before">
          <h2 class="h2">Antes de ir</h2>
          <dl class="ev-dl">
            <div><dt>${icon('door', 18)}Puertas</dt><dd>Abren a las ${esc(ev.doors)} · el evento empieza a las ${esc(fmt.time(ev.date))}</dd></div>
            <div><dt>${icon('user', 18)}Edad</dt><dd>${esc(ageText(ev.age))}</dd></div>
            <div><dt>${icon('clock', 18)}Duración</dt><dd>${esc(ev.duration)} aproximadamente</dd></div>
            <div><dt>${icon('pin', 18)}Dirección</dt><dd>${esc(v.name)} · ${esc(v.address)}, ${esc(v.city)}</dd></div>
          </dl>
        </div>
        <div class="ev-howto">
          <h2 class="h2">Tu boleta</h2>
          ${sampleTicket(ev)}
          <p class="ev-howto-txt">Llega a tu correo y queda guardada en «Mis boletas». Cada una lleva un <strong>QR único con firma</strong>: en la puerta se valida una sola vez, así que una captura reenviada no sirve para entrar dos veces.</p>
        </div>
      </section>

      <div class="dock ev-dock" data-dock hidden></div>`;
    },

    mount(root, p, ctx) {
      const id = p.id;
      const ev = Store.event(id);
      if (!ev) return;
      Store.sim.focus(id);
      ctx.onLeave(() => Store.sim.focus(null));

      const optsEl = root.querySelector('[data-opts]');
      const noticeEl = root.querySelector('[data-notice]');
      const sumEl = root.querySelector('[data-sum]');
      const srEl = root.querySelector('[data-sum-sr]');
      const dockEl = root.querySelector('[data-dock]');
      const maxEl = root.querySelector('[data-max]');
      const liveEl = root.querySelector('[data-live]');
      const scrollEl = root.querySelector('[data-scroll]');
      const boxEl = root.querySelector('[data-scrollbox]');
      const titleEl = root.querySelector('#ev-buy-title');
      const rowEl = (optId) => optsEl.querySelector(`[data-opt="${CSS.escape(optId)}"]`);
      const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

      /* Cabecera → bloque de compra (el router usa el hash, así que no sirve un ancla #id).
         En escritorio se alinea el panel completo (imagen + opciones + resumen) bajo la cabecera fija. */
      const gridEl = root.querySelector('.ev-buy-grid');
      const panelMQ = matchMedia('(min-width: 1024px) and (min-height: 720px)');
      root.querySelector('[data-jump]').addEventListener('click', () => {
        (panelMQ.matches ? gridEl : titleEl).scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        titleEl.focus({ preventScroll: true });
      });
      /* Tocar la imagen también la amplía (el botón «Ampliar» es la vía accesible). */
      const frame = root.querySelector('.ev-figure .locmap-frame');
      if (frame) frame.addEventListener('click', () => LocMap.zoom(id));

      /* Escritorio: la lista se desplaza dentro del panel; sombra inferior si hay más opciones abajo. */
      const hint = () => {
        const more = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop > 6;
        boxEl.classList.toggle('is-more', more);
      };
      scrollEl.addEventListener('scroll', hint, { passive: true });
      if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(hint);
        ro.observe(scrollEl); ro.observe(optsEl);
        ctx.onLeave(() => ro.disconnect());
      } else {
        window.addEventListener('resize', hint);
        ctx.onLeave(() => window.removeEventListener('resize', hint));
      }

      /* ¿Puedo elegir aquí? No si hay reserva de otro evento o un pago en curso. */
      function lockState() {
        const h = Store.myHold();
        if (h && h.eventId !== id) return 'other';
        if (h && h.eventId === id && h.orderId) return 'paying';
        return null;
      }
      const atMax = () => { const h = Store.myHold(); return !!h && h.eventId === id && Store.holdCount() >= D.maxPerOrder; };

      /* ---------- Filas ---------- */
      function updateRow(optId, force) {
        const el = rowEl(optId);
        if (!el) return;
        const st = Store.optionStats(id, optId);
        const pa = availParts(st);
        const q = Store.myQty(id, optId);
        const lock = lockState();
        const a = el.querySelector('[data-avail]');
        if (a.dataset.k !== pa.key) {
          a.dataset.k = pa.key;
          a.innerHTML = availHtml(pa);
          a.className = 'opt-avail ' + pa.cls;
          if (!force) { a.classList.remove('ev-tick'); void a.offsetWidth; a.classList.add('ev-tick'); }
        }
        const out = el.querySelector('[data-qty]');
        if (out.textContent !== String(q)) out.textContent = q;
        /* Sin cupo o en el máximo, el «+» se ve apagado pero sigue respondiendo: al tocarlo,
           setQty explica por qué no se puede (agotado, en proceso, máximo) y la fila se sacude. */
        const inc = el.querySelector('[data-inc]');
        const noRoom = !lock && (st.free <= 0 || atMax());
        inc.disabled = !!lock;
        inc.classList.toggle('is-off', noRoom);
        if (noRoom) inc.setAttribute('aria-disabled', 'true'); else inc.removeAttribute('aria-disabled');
        el.querySelector('[data-dec]').disabled = !!lock || q <= 0;
        el.classList.toggle('is-picked', q > 0);
        el.classList.toggle('is-unavailable', q === 0 && (st.status === 'soldout' || st.status === 'process' || st.status === 'off'));
      }
      function updateMax() {
        const full = !lockState() && atMax();
        maxEl.textContent = full ? `Llegaste al máximo de ${D.maxPerOrder}` : `Máx. ${D.maxPerOrder} por compra`;
        maxEl.classList.toggle('is-full', full);
      }
      const allRows = (force) => { Store.options(id).forEach((o) => updateRow(o.id, force)); updateMax(); };

      /* Máximo ~1 actualización por segundo por fila cuando la cambian otras personas. */
      const lastAt = {}, timers = {};
      function queueRow(optId) {
        const dt = Date.now() - (lastAt[optId] || 0);
        if (dt >= 1000) { lastAt[optId] = Date.now(); updateRow(optId); return; }
        if (timers[optId]) return;
        timers[optId] = setTimeout(() => { timers[optId] = null; lastAt[optId] = Date.now(); updateRow(optId); }, 1000 - dt);
      }
      ctx.onLeave(() => Object.keys(timers).forEach((k) => clearTimeout(timers[k])));

      function reject(optId) {
        const el = rowEl(optId);
        if (!el) return;
        el.classList.remove('ev-reject'); void el.offsetWidth; el.classList.add('ev-reject');
        clearTimeout(el._rj);
        el._rj = setTimeout(() => el.classList.remove('ev-reject'), 1400);
      }

      optsEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-inc], [data-dec]');
        if (!b || b.disabled) return;
        const el = b.closest('[data-opt]');
        const optId = el.dataset.opt;
        const cur = Store.myQty(id, optId);
        const next = b.hasAttribute('data-inc') ? cur + 1 : cur - 1;
        const hadHold = !!Store.myHold();
        const r = Store.setQty(id, optId, next);
        if (!r.ok) {
          UI.toast(r.msg, { type: 'warn' });
          reject(optId);
          if (r.reason === 'otro-evento' || r.reason === 'en-pago') renderNotice();
          return;
        }
        lastAt[optId] = Date.now();
        updateRow(optId, true);
        if (!hadHold && Store.myHold()) UI.toast(`Apartamos tus boletas por ${Math.round(D.holdSeconds / 60)} minutos mientras completas la compra.`, { type: 'ok' });
      });

      /* ---------- Aviso: reserva en otro evento / pago en curso ---------- */
      let noticeHtml = '';
      function renderNotice() {
        const h = Store.myHold();
        const lock = lockState();
        let html = '';
        if (lock === 'other') {
          const other = Store.event(h.eventId);
          html = `<div class="ev-notice" role="status">
            <p class="ev-notice-t">${icon('timer', 18)}<span>Tienes ${boletas(Store.holdCount())} apartadas para <strong>${esc(other.title)}</strong>.</span></p>
            <p class="ev-notice-d">Solo puedes tener una reserva a la vez. Termina esa compra o libérala para elegir aquí.</p>
            <div class="ev-notice-a">
              <a class="btn btn-sm btn-ink" href="#/checkout">Ir a pagar ${icon('arrow', 16)}</a>
              <button type="button" class="btn btn-sm btn-line" data-release>Liberarla</button>
            </div>
          </div>`;
        } else if (lock === 'paying') {
          html = `<div class="ev-notice" role="status">
            <p class="ev-notice-t">${icon('card', 18)}<span>Tienes un pago en curso para este evento.</span></p>
            <p class="ev-notice-d">Tus boletas siguen apartadas. Termina el pago en la pasarela o cancélalo para cambiar las cantidades.</p>
            <div class="ev-notice-a">
              <a class="btn btn-sm btn-ink" href="#/pago/${encodeURIComponent(h.orderId)}">Ir a la pasarela ${icon('arrow', 16)}</a>
              <button type="button" class="btn btn-sm btn-line" data-cancel-pay>Cancelar el pago</button>
            </div>
          </div>`;
        }
        if (html === noticeHtml) return; // sin cambios: no re-anunciar el role="status"
        noticeHtml = html;
        noticeEl.innerHTML = html;
      }
      /* El botón pulsado desaparece: el foco pasa al primer «+» disponible. */
      const focusAfterNotice = () => {
        const b = optsEl.querySelector('[data-inc]:not([disabled])');
        (b || titleEl).focus();
      };
      noticeEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-release]')) {
          Store.clearHold();
          UI.toast('Liberamos tu reserva. Ya puedes elegir boletas aquí.', { type: 'ok' });
          focusAfterNotice();
        } else if (e.target.closest('[data-cancel-pay]')) {
          Store.cancelPayment();
          UI.toast('Cancelaste el pago. Tus boletas siguen apartadas.', { type: 'info' });
          focusAfterNotice();
        }
      });

      /* ---------- Resumen de la compra (boleta en escritorio, dock en celular) ---------- */
      let stops = [];
      let srText = '';
      function announce(text) {
        if (text === srText) return;
        srText = text;
        srEl.textContent = text;
      }
      function renderSummary() {
        stops.forEach((s) => s()); stops = [];
        const h = Store.myHold();
        const mine = h && h.eventId === id;
        const q = mine ? Store.quote() : null;

        if (!q || !q.lines.length) {
          sumEl.innerHTML = `<div class="panel ev-sum-card is-empty">
            <p class="ev-sum-k">Tu compra</p>
            <p class="ev-sum-empty">Aún no has elegido boletas.</p>
            <p class="ev-sum-help">Usa <span class="ev-kbd" aria-hidden="true">+</span><span class="sr-only">el botón agregar</span> en cada opción. Las apartamos a tu nombre por ${Math.round(D.holdSeconds / 60)} minutos mientras pagas.</p>
            <span class="btn btn-primary btn-block is-disabled ev-sum-go" aria-disabled="true">Continuar</span>
          </div>`;
          dockEl.hidden = true; dockEl.innerHTML = '';
          root.classList.remove('has-dock');
          document.body.classList.remove('ev-docked');
          announce(srText ? 'Ya no tienes boletas apartadas en este evento.' : '');
          return;
        }

        const paying = !!h.orderId;
        const go = paying ? '#/pago/' + encodeURIComponent(h.orderId) : '#/checkout';
        const cta = paying ? 'Ir a la pasarela' : 'Continuar · ' + fmt.cop(q.total);
        sumEl.innerHTML = `<div class="panel ev-sum-card is-live">
          <div class="ev-sum-top">
            <p class="ev-sum-k">Tu compra · ${boletas(q.qty)}</p>
            <span class="ev-cd" title="Tiempo que quedan apartadas">${icon('timer', 15)}<span class="mono" role="timer" data-cd>—</span></span>
          </div>
          <ul class="ev-sum-lines">
            ${q.lines.map((l) => `<li style="--oc:${esc(l.color)}"><i aria-hidden="true"></i><span class="ev-sum-n">${esc(l.name)} <span class="mono">× ${l.qty}</span></span><span class="mono">${fmt.cop(l.amount)}</span></li>`).join('')}
          </ul>
          <div class="perf"></div>
          <p class="ev-sum-total"><span>Total<small>Incluye servicio (${Math.round(D.serviceFee * 100)} %): ${fmt.cop(q.fee)}</small></span><strong>${fmt.cop(q.total)}</strong></p>
          <a class="btn btn-primary btn-lg btn-block ev-sum-go" href="${go}" title="${paying ? 'Tienes un pago en curso en la pasarela' : 'Si el tiempo se acaba, las boletas vuelven a quedar libres para otras personas'}">${esc(cta)} ${icon('arrow', 18)}</a>
        </div>`;

        dockEl.innerHTML = `<div class="dock-in">
          <div class="ev-dock-info">
            <p class="ev-dock-q">${boletas(q.qty)} · <span>${esc(q.lines.map((l) => l.name + ' ×' + l.qty).join(', '))}</span></p>
            <p class="ev-dock-t">${icon('timer', 14)}Apartadas <span class="mono" role="timer" data-cd>—</span></p>
          </div>
          <a class="btn btn-primary ev-dock-go" href="${go}">${esc(cta)}</a>
        </div>`;
        dockEl.hidden = false;
        root.classList.add('has-dock');
        document.body.classList.add('ev-docked'); // en celular oculta el reloj duplicado de la cabecera

        root.querySelectorAll('[data-cd]').forEach((el) => stops.push(UI.countdown(el, h.until, null)));
        const urgent = () => root.querySelectorAll('.ev-cd, .ev-dock-t').forEach((el) => el.classList.toggle('is-urgent', h.until - Date.now() < 60000));
        urgent();
        const ut = setInterval(urgent, 1000);
        stops.push(() => clearInterval(ut));

        announce(`${boletas(q.qty)} apartadas: ${q.lines.map((l) => l.name + ' por ' + l.qty).join(', ')}. Total ${fmt.cop(q.total)}.`);
      }
      ctx.onLeave(() => { stops.forEach((s) => s()); stops = []; root.classList.remove('has-dock'); document.body.classList.remove('ev-docked'); });

      /* ---------- Personas comprando ahora (sin contarme) ---------- */
      function refreshLive() {
        const n = othersBuying(id);
        if (String(n) === liveEl.dataset.n) return;
        liveEl.dataset.n = n;
        liveEl.querySelector('[data-live-n]').textContent = buying(n);
        liveEl.classList.toggle('is-calm', !n);
        liveEl.classList.remove('ev-bump'); void liveEl.offsetWidth; liveEl.classList.add('ev-bump');
      }
      let lt = null, lLast = 0;
      const liveSoon = () => {
        if (lt) return;
        lt = setTimeout(() => { lt = null; lLast = Date.now(); refreshLive(); }, Math.max(0, 1000 - (Date.now() - lLast)));
      };
      ctx.onLeave(() => clearTimeout(lt));

      /* ---------- Suscripciones ---------- */
      ctx.sub('option', (e) => { if (e && e.eventId === id) queueRow(e.optionId); });
      ctx.sub('holds', (e) => { if (!e || e.eventId === id) liveSoon(); });
      ctx.sub('hold', () => { renderNotice(); renderSummary(); allRows(true); liveSoon(); });
      ctx.sub('hold-expired', () => { renderNotice(); renderSummary(); allRows(true); });
      /* El organizador cambió la imagen u opciones: re-render diferido y único.
         (Re-renderizar dentro del emit agrega un suscriptor nuevo al Set que se está recorriendo → bucle.) */
      let rerendering = false;
      ctx.sub('config', (e) => {
        if (!e || e.eventId !== id || rerendering) return;
        rerendering = true;
        ctx.later(0, () => App.rerender());
      });
      ctx.every(2000, liveSoon);

      renderNotice();
      renderSummary();
      allRows(true);
      hint();
    }
  });
})();
