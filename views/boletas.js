/* Boletas emitidas (éxito de la compra), «Mis boletas» y centro de avisos.
   Rutas: /boletas/:orderId · /boletas · /avisos. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;
  const D = window.DATA;

  const orderOf = (id) => Store.state.orders.find((o) => o.id === id) || null;
  const gwName = (id) => (D.gateways.find((g) => g.id === id) || { name: id }).name;
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const qtyTxt = (n) => (n === 1 ? '1 boleta' : fmt.num(n) + ' boletas');
  /* Horas y fechas sin cortes de línea internos («7:30 p.» / «m.»). */
  const nb = (s) => String(s).replace(/\s/g, ' ');
  const time = (iso) => nb(fmt.time(iso));
  const when = (ev) => `${nb(fmt.date(ev.date))} · ${time(ev.date)}`;
  /* #view no se reemplaza entre vistas: todo listener delegado en root se quita al salir
     (el router renderiza dos veces en App.go y cada montaje sumaría otro listener). */
  const delegate = (root, ctx, type, fn) => {
    root.addEventListener(type, fn);
    ctx.onLeave(() => root.removeEventListener(type, fn));
  };
  const seatParts = (t) => {
    if (!t.seatId) return null;
    const [row, n] = String(t.seatId).split('-');
    return { row, n };
  };
  const statusTxt = (t) => (t.status === 'used' ? `Usada a las ${time(t.usedAt)}` : t.status === 'void' ? 'Anulada' : 'Válida');
  const CH = {
    email: { icon: 'mail', label: 'Correo' },
    whatsapp: { icon: 'chat', label: 'WhatsApp' },
    push: { icon: 'bell', label: 'En la app' },
    sms: { icon: 'phone', label: 'SMS' }
  };
  const chOf = (c) => CH[c] || CH.push;
  const chKey = (c) => (CH[c] ? c : 'push');
  /* Algunos avisos de chat llegan con la marca como título: le damos uno legible. */
  const noteTitle = (n) => {
    const t = String(n.title || '').trim();
    if (t && t.toLowerCase() !== 'aforo') return t;
    if (/listo/i.test(n.body || '')) return 'Tus boletas están listas';
    return chKey(n.channel) === 'whatsapp' ? 'Mensaje por WhatsApp' : 'Aviso de aforo';
  };

  /* ---------------- Boleta vertical con QR ---------------- */
  function stubHTML(t, i, n, ev) {
    const v = Store.venueOf(ev.id);
    const op = Store.option(t.eventId, t.optionId) || { name: 'Boleta', color: 'var(--accent)' };
    const sp = seatParts(t);
    const used = t.status === 'used';
    return `<article class="bl-tk" data-tk="${esc(t.code)}">
      <div class="stub-wrap">
        <div class="stub stub-v bl-stub${used ? ' is-used' : ''}" role="group" aria-label="Boleta ${i + 1} de ${n}: ${esc(Store.ticketLabel(t))}">
          <div class="bl-stub-top" data-top>
            <div class="bl-stub-poster">
              <img src="${esc(ev.img)}" alt="" decoding="async">
              <span class="bl-stub-cat">${esc(ev.category)}</span>
              <span class="bl-stub-n">${String(i + 1).padStart(2, '0')}<span>/${String(n).padStart(2, '0')}</span></span>
            </div>
            <div class="bl-stub-body">
              <h3 class="bl-stub-title">${esc(ev.title)}</h3>
              <p class="bl-stub-when">${esc(when(ev))} <span class="faint">· Puertas ${esc(nb(ev.doors))}</span></p>
              <p class="bl-stub-where">${icon('pin', 14)}${esc(v.name)} · ${esc(v.city)}</p>
              <div class="bl-seat${sp ? '' : ' is-general'}">
                <div class="bl-seat-loc"><span class="bl-k">Localidad</span><span class="bl-v"><i class="dot" style="--c:${esc(op.color)}" aria-hidden="true"></i>${esc(op.name)}</span></div>
                ${sp
                  ? `<div><span class="bl-k">Fila</span><span class="bl-v mono">${esc(sp.row)}</span></div><div><span class="bl-k">Silla</span><span class="bl-v mono">${esc(sp.n)}</span></div>`
                  : '<div><span class="bl-k">Ingreso</span><span class="bl-v">Sin silla</span></div>'}
              </div>
              <p class="bl-holder"><span class="bl-k">Titular</span><span>${esc(t.holder)}</span></p>
            </div>
          </div>
          <div class="bl-stub-qrbox">
            <div class="bl-stub-qr">${UI.qr(t.payload)}</div>
            <p class="bl-code">${esc(t.code)}</p>
            <p class="bl-valid" data-tk-status>${used ? icon('checkCircle', 14) + esc(statusTxt(t)) : icon('ticket', 14) + 'Válida para un ingreso'}</p>
          </div>
        </div>
      </div>
      <div class="bl-tk-acts">
        <button type="button" class="btn btn-ink btn-block" data-wallet="${esc(t.code)}">${icon('wallet', 18)}Agregar a la billetera</button>
        <div class="bl-tk-more">
          <button type="button" class="bl-act" data-send="${esc(t.code)}">${icon('send', 17)}Enviar a otra persona</button>
        </div>
        ${n === 1 ? `<div class="bl-door">
            <p class="eyebrow">Así funciona en la puerta</p>
            <ol class="bl-door-list">
              <li><span><b>Muestras el QR</b> desde el celular o impreso.</span></li>
              <li><span><b>En la puerta lo escanean</b> y tu ingreso queda registrado en segundos.</span></li>
              <li><span><b>Entra una persona.</b> Si el mismo código se vuelve a leer, aparece «Ya ingresó».</span></li>
            </ol>
          </div>` : ''}
      </div>
    </article>`;
  }

  /* El dentado de la boleta cae justo entre la información y el QR. */
  function fitTears(root, ctx) {
    const fit = () => root.querySelectorAll('.bl-stub').forEach((s) => {
      const top = s.querySelector('[data-top]');
      if (top && top.offsetHeight) s.style.setProperty('--tear', top.offsetHeight + 'px');
    });
    fit();
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(fit);
      root.querySelectorAll('.bl-stub [data-top]').forEach((t) => ro.observe(t));
      ctx.onLeave(() => ro.disconnect());
    } else {
      window.addEventListener('resize', fit);
      ctx.onLeave(() => window.removeEventListener('resize', fit));
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }

  /* Sello de taquilla (SVG con texto en arco). */
  function stampSVG() {
    return `<svg viewBox="0 0 140 140" role="img" aria-label="Pago aprobado">
      <defs><path id="bl-arc" d="M70,70 m-53,0 a53,53 0 1,1 106,0 a53,53 0 1,1 -106,0"/></defs>
      <circle cx="70" cy="70" r="67" fill="none" stroke="currentColor" stroke-width="3"/>
      <circle cx="70" cy="70" r="62" fill="none" stroke="currentColor" stroke-width="1"/>
      <circle cx="70" cy="70" r="41" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <text font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="700" letter-spacing="2" fill="currentColor" textLength="330" lengthAdjust="spacing"><textPath href="#bl-arc">PAGO APROBADO · QR ÚNICO · AFORO ·</textPath></text>
      <path d="m53 71 11.5 11.5L88 59" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function sendSheet(t, o) {
    const label = Store.ticketLabel(t);
    const s = UI.sheet({
      title: 'Enviar a otra persona',
      body: `<form class="bl-send" data-send-form novalidate>
          <div class="bl-send-tk"><span class="bl-send-qr">${UI.qr(t.payload)}</span><span><b>${esc(label)}</b><span class="mono">${esc(t.code)}</span></span></div>
          <p class="small muted">Le llega la boleta con su QR por correo. Cada código sigue permitiendo un solo ingreso.</p>
          <div class="field"><label for="bl-send-name">Nombre</label><input id="bl-send-name" class="input" autocomplete="off" placeholder="Quién va a usar la boleta"></div>
          <div class="field"><label for="bl-send-mail">Correo</label><input id="bl-send-mail" class="input" type="email" inputmode="email" autocomplete="off" spellcheck="false" placeholder="nombre@correo.co" aria-describedby="bl-send-err"><p class="error" id="bl-send-err" data-err hidden>Escribe un correo válido.</p></div>
          <p class="tiny faint bl-send-note">${icon('info', 14)}Envío simulado: en el demo no sale ningún correo.</p>
        </form>`,
      actions: `<button type="button" class="btn btn-line" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-send-go>${icon('send', 17)}Enviar boleta</button>`
    });
    const f = s.el.querySelector('[data-send-form]');
    const mail = s.el.querySelector('#bl-send-mail');
    const err = s.el.querySelector('[data-err]');
    const go = () => {
      const v = mail.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { err.hidden = false; mail.classList.add('is-invalid'); mail.focus(); return; }
      const who = s.el.querySelector('#bl-send-name').value.trim();
      Store.notify({ channel: 'email', orderId: o.id, title: 'Boleta enviada' + (who ? ' a ' + who : ''), body: `Enviamos la boleta ${t.code} (${label}) a ${v}.` });
      s.close();
      UI.toast(`Enviamos la boleta a <b>${esc(v)}</b> (simulado).`, { type: 'ok', html: true });
    };
    mail.addEventListener('input', () => { err.hidden = true; mail.classList.remove('is-invalid'); });
    f.addEventListener('submit', (e) => { e.preventDefault(); go(); });
    s.el.querySelector('[data-send-go]').addEventListener('click', go);
  }

  function bindTicketActions(root, ctx) {
    delegate(root, ctx, 'click', (e) => {
      const w = e.target.closest('[data-wallet]');
      if (w) {
        UI.toast(`Boleta ${w.dataset.wallet} agregada a la billetera del celular (simulado).`, { type: 'ok', icon: 'wallet' });
        return;
      }
      const sd = e.target.closest('[data-send]');
      if (sd) {
        const t = Store.state.tickets.find((x) => x.code === sd.dataset.send);
        const o = t && orderOf(t.orderId); // la orden sale de la boleta, no de un cierre viejo
        if (t && o) sendSheet(t, o);
      }
    });
  }

  /* ---------------- Vistas previas de notificaciones ---------------- */
  function mailHTML(o, ev, tickets, n) {
    const qty = tickets.length;
    const title = n ? n.title : 'Compra confirmada · ' + ev.title;
    const body = n ? n.body : `Hola ${firstName(o.buyer.name)}, adjuntamos ${qty === 1 ? 'tu boleta' : 'tus ' + qty + ' boletas'} con código QR único. Orden ${o.id}.`;
    const shown = tickets.slice(0, 3);
    return `<figure class="bl-mail" aria-label="Vista previa del correo de confirmación">
      <div class="bl-mail-bar"><span class="bl-mail-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Bandeja de entrada</span><span class="bl-mail-ch">${icon('mail', 14)}Correo</span></div>
      <div class="bl-mail-head">
        <span class="bl-logo-av">${UI.logo(20)}</span>
        <div class="bl-mail-from">
          <p><b>aforo · Boletas</b> <span class="faint">&lt;boletas@aforo.co&gt;</span></p>
          <p class="faint ck-ellipsis">Para: ${esc(o.buyer.email)}</p>
        </div>
        <time class="bl-mail-time">${esc(time(n ? n.at : o.paidAt))}</time>
      </div>
      <p class="bl-mail-subj">${esc(title)}</p>
      <div class="bl-mail-body">
        <p>${esc(body)}</p>
        <ul class="bl-mail-tks">
          ${shown.map((t) => `<li class="bl-mail-tk"><span class="bl-mini-qr">${UI.qr(t.payload)}</span><span class="bl-mail-tk-t"><b>${esc(Store.ticketLabel(t))}</b><span class="mono">${esc(t.code)}</span></span></li>`).join('')}
          ${qty > shown.length ? `<li class="bl-mail-more">y ${qty - shown.length} más en el adjunto</li>` : ''}
        </ul>
        <span class="bl-mail-btn">Ver mis boletas</span>
        <p class="bl-mail-foot">Presenta el QR desde el celular o impreso. Cada código permite un solo ingreso.</p>
      </div>
    </figure>`;
  }

  function chatHTML(o, ev, tickets, n) {
    const qty = tickets.length;
    const body = n ? n.body : `¡Listo! ${qty === 1 ? 'Tu boleta' : 'Tus ' + qty + ' boletas'} para ${ev.title} ${qty === 1 ? 'está' : 'están'} en «Mis boletas». Presenta el QR en la puerta.`;
    const at = time(n ? n.at : o.paidAt);
    return `<figure class="bl-chat" aria-label="Vista previa del mensaje por WhatsApp">
      <div class="bl-chat-head">
        <span class="bl-logo-av">${UI.logo(18)}</span>
        <div class="bl-chat-who"><p class="bl-chat-name">aforo</p><p class="bl-chat-sub">Avisos de tu compra</p></div>
        <span class="bl-chat-ch">${icon('chat', 14)}WhatsApp</span>
      </div>
      <div class="bl-chat-body">
        <span class="bl-chat-day">Hoy</span>
        <div class="bl-bubble"><p>${esc(body)}</p><time>${esc(at)}</time></div>
        <div class="bl-bubble bl-bubble-card">
          <span class="bl-mini-qr">${UI.qr(tickets[0].payload)}</span>
          <span class="bl-bubble-card-t"><b>${esc(ev.title)}</b><span>${esc(qtyTxt(qty))} · ${esc(fmt.date(ev.date))}</span><span class="bl-bubble-link">Abrir mis boletas</span></span>
          <time>${esc(at)}</time>
        </div>
      </div>
    </figure>`;
  }

  function trailHTML(notes) {
    if (!notes.length) return '';
    return `<ol class="bl-trail" aria-label="Avisos de esta orden">
      ${notes.map((n) => `<li class="bl-trail-i">
          <span class="bl-ch-ico ch-${chKey(n.channel)}">${icon(chOf(n.channel).icon, 15)}</span>
          <span class="bl-trail-t">${esc(noteTitle(n))}</span>
          <span class="bl-trail-m">${esc(chOf(n.channel).label)} · ${esc(time(n.at))}</span>
        </li>`).join('')}
    </ol>`;
  }

  /* ---------------- /boletas/:orderId ---------------- */
  function orderMissing() {
    return `<div class="wrap empty-page bl-nf">
      <p class="eyebrow">Boletas</p>
      <h1 class="h1">No encontramos esa orden</h1>
      <p class="muted">Puede que sea de otra sesión del demo. Tus compras de esta sesión están en «Mis boletas».</p>
      <div class="bl-empty-btns"><a class="btn btn-primary" href="#/boletas">Ver mis boletas</a><a class="btn btn-line" href="#/">Ir a la cartelera</a></div>
    </div>`;
  }

  function orderPageHTML(o) {
    const ev = Store.event(o.eventId);
    const v = Store.venueOf(ev.id);
    const tickets = Store.ticketsFor(o.id);
    const notes = Store.state.notifications.filter((n) => n.orderId === o.id).slice().reverse();
    const mail = notes.slice().reverse().find((n) => n.channel === 'email' && /confirmada/i.test(n.title)) || null;
    const chat = notes.slice().reverse().find((n) => n.channel === 'whatsapp') || null;
    const qty = tickets.length;
    return `<div class="wrap bl">
      <header class="bl-hero">
        <p class="eyebrow bl-hero-eb"><span class="bl-ok-dot" aria-hidden="true"></span>Compra confirmada<span aria-hidden="true">·</span><span>Orden <span class="mono">${esc(o.id)}</span></span></p>
        <div class="bl-hero-txt">
          <h1 class="display-2 bl-hero-t">¡Listo, ${esc(firstName(o.buyer.name))}!</h1>
          <p class="lead bl-hero-lead">Te enviamos el detalle por correo y WhatsApp.</p>
        </div>
        <p class="bl-hero-meta">${esc(qtyTxt(qty))} · ${esc(ev.title)} · ${esc(when(ev))} · ${esc(v.name)}</p>
        <div class="bl-stamp">${stampSVG()}</div>
      </header>

      <div class="bl-layout${qty >= 3 ? ' is-many' : ''}">
          <section class="bl-tks-sec" aria-labelledby="bl-tks-t">
            <div class="bl-sec-head">
              <h2 class="h2" id="bl-tks-t">${qty === 1 ? 'Tu boleta' : 'Tus ' + qty + ' boletas'}</h2>
              <p class="small muted">${qty === 1 ? 'Su QR es único: permite un solo ingreso.' : 'Cada una con su QR: entra una persona por código.'}</p>
            </div>
            <div class="bl-tickets${qty === 1 ? ' is-one' : ''}">
              ${tickets.map((t, i) => stubHTML(t, i, qty, ev)).join('')}
            </div>
          </section>

          <section class="bl-notes" aria-labelledby="bl-notes-t">
            <div class="bl-sec-head">
              <h2 class="h2" id="bl-notes-t">Así te llegaron las notificaciones</h2>
              <a class="bl-link" href="#/avisos">Ver todos los avisos ${icon('arrow', 16)}</a>
            </div>
            <div class="bl-mocks">
              ${mailHTML(o, ev, tickets, mail)}
              ${chatHTML(o, ev, tickets, chat)}
            </div>
            ${trailHTML(notes)}
          </section>

        <aside class="bl-aside">
          <section class="panel bl-order" aria-labelledby="bl-order-t">
            <h2 class="eyebrow" id="bl-order-t">Resumen de la orden</h2>
            <dl class="kv">
              <div><dt>Orden</dt><dd class="mono">${esc(o.id)}</dd></div>
              <div><dt>Pagada</dt><dd>${esc(nb(fmt.date(o.paidAt)))} · ${esc(time(o.paidAt))}</dd></div>
              <div><dt>Pasarela</dt><dd>${esc(gwName(o.gateway))}</dd></div>
              <div><dt>Método</dt><dd>${esc(o.method)}</dd></div>
              <div><dt>Referencia</dt><dd class="mono">${esc(o.ref)}</dd></div>
              <div><dt>Cupón</dt><dd>${o.coupon ? `<span class="mono">${esc(o.coupon)}</span> · −${fmt.cop(o.discount)}` : '<span class="faint">Sin cupón</span>'}</dd></div>
            </dl>
            <div class="perf" aria-hidden="true"></div>
            <dl class="kv">
              <div><dt>Boletas</dt><dd>${fmt.cop(o.subtotal)}</dd></div>
              ${o.discount ? `<div><dt>Descuento</dt><dd class="ok-txt">−${fmt.cop(o.discount)}</dd></div>` : ''}
              <div><dt>Cargo por servicio</dt><dd>${fmt.cop(o.fee)}</dd></div>
              <div class="kv-total"><dt>Total pagado</dt><dd>${fmt.cop(o.total)}</dd></div>
            </dl>
          </section>
          <div class="bl-aside-btns">
            <a class="btn btn-line btn-block" href="#/boletas">${icon('ticket', 18)}Ver todas mis boletas</a>
            <a class="btn btn-ghost btn-block" href="#/">Seguir comprando</a>
          </div>
        </aside>
      </div>
    </div>`;
  }

  App.view({
    id: 'boleta', path: '/boletas/:orderId', role: 'buyer', title: 'Tus boletas',
    render(p) {
      const o = orderOf(p.orderId);
      if (!o) return orderMissing();
      if (o.status !== 'paid') return '<div class="wrap bl"><p class="muted">Abriendo el estado del pago…</p></div>';
      return orderPageHTML(o);
    },
    mount(root, p, ctx) {
      const o = orderOf(p.orderId);
      if (!o) return;
      if (o.status !== 'paid') { ctx.later(40, () => App.go('/pago/' + o.id, { replace: true })); return; }
      fitTears(root, ctx);
      bindTicketActions(root, ctx);
      // Si una boleta registra ingreso (vista de acceso en otra pestaña del demo), se refleja aquí.
      ctx.sub('access', () => {
        Store.ticketsFor(o.id).forEach((t) => {
          const el = root.querySelector(`[data-tk="${t.code}"]`);
          if (!el || t.status !== 'used') return;
          el.querySelector('.bl-stub').classList.add('is-used');
          el.querySelector('[data-tk-status]').innerHTML = icon('checkCircle', 14) + esc(statusTxt(t));
        });
      });
    }
  });

  /* ---------------- /boletas (Mis boletas) ---------------- */
  function rowHTML(t) {
    const op = Store.option(t.eventId, t.optionId) || { name: 'Boleta', color: 'var(--accent)' };
    const sp = seatParts(t);
    const used = t.status === 'used';
    return `<li class="stub-wrap bl-row-wrap">
      <button type="button" class="stub bl-row${used ? ' is-used' : ''}" data-open="${esc(t.code)}" aria-label="Ver el QR de ${esc(Store.ticketLabel(t))}, ${esc(statusTxt(t))}">
        <span class="bl-row-main">
          <span class="bl-row-loc"><i class="dot" style="--c:${esc(op.color)}" aria-hidden="true"></i>${esc(op.name)}</span>
          <span class="bl-row-seat">${sp ? `Fila <b>${esc(sp.row)}</b> · Silla <b>${esc(sp.n)}</b>` : 'Acceso general'}</span>
          <span class="bl-row-foot"><span class="bl-row-code">${esc(t.code)}</span><span class="badge ${used ? '' : 'badge-ok'} bl-row-st" data-st>${esc(statusTxt(t))}</span></span>
        </span>
        <span class="bl-row-side"><span class="bl-row-qr">${UI.qr(t.payload)}</span><span class="bl-row-open">${icon('qr', 13)}Ver QR</span></span>
      </button>
    </li>`;
  }

  function groupHTML(g) {
    const ev = g.ev;
    const v = Store.venueOf(ev.id);
    const used = g.tickets.filter((t) => t.status === 'used').length;
    return `<section class="bl-group" aria-labelledby="bl-g-${esc(ev.id)}">
      <header class="bl-ghead">
        <img class="bl-ghead-img" src="${esc(ev.img)}" alt="" decoding="async" loading="lazy">
        <div class="bl-ghead-txt">
          <p class="eyebrow">${esc(ev.category)}</p>
          <h2 class="bl-ghead-t" id="bl-g-${esc(ev.id)}">${esc(ev.title)}</h2>
          <p class="bl-ghead-m">${esc(when(ev))}</p>
          <p class="bl-ghead-m">${esc(v.name)} · ${esc(v.city)}</p>
          <p class="bl-ghead-n">${esc(qtyTxt(g.tickets.length))}${used ? ` · ${used} ${used === 1 ? 'usada' : 'usadas'}` : ''}</p>
        </div>
      </header>
      <ul class="bl-rows">${g.tickets.map(rowHTML).join('')}</ul>
    </section>`;
  }

  function mineHTML() {
    const list = Store.myTickets().slice().reverse(); // la tienda guarda la más nueva primero: así quedan en orden de emisión
    if (!list.length) {
      return `<div class="wrap bl-empty">
        <div class="bl-empty-art" aria-hidden="true">
          <div class="stub stub-v bl-ghost"><span class="bl-ghost-qr"></span><i></i><i></i></div>
        </div>
        <div class="bl-empty-txt">
          <p class="eyebrow">Mis boletas</p>
          <h1 class="h1">Aún no tienes boletas</h1>
          <p class="lead">Cuando compres, aquí aparecen tus boletas con su QR único, listas para mostrar en la puerta. También te llegan por correo y WhatsApp.</p>
          <div class="bl-empty-btns"><a class="btn btn-primary btn-lg" href="#/">Ver la cartelera ${icon('arrow', 18)}</a></div>
        </div>
      </div>`;
    }
    const map = new Map();
    list.forEach((t) => {
      if (!map.has(t.eventId)) map.set(t.eventId, { ev: Store.event(t.eventId), tickets: [] });
      map.get(t.eventId).tickets.push(t);
    });
    const groups = Array.from(map.values()).sort((a, b) => new Date(a.ev.date) - new Date(b.ev.date));
    return `<div class="wrap bl-mine">
      <header class="bl-mine-head">
        <p class="eyebrow">Tu billetera de boletas</p>
        <h1 class="h1">Mis boletas</h1>
        <p class="muted">${esc(qtyTxt(list.length))} en ${groups.length === 1 ? '1 evento' : groups.length + ' eventos'}. Toca una para ver el QR en grande.</p>
      </header>
      <div class="bl-groups">${groups.map(groupHTML).join('')}</div>
    </div>`;
  }

  function qrSheet(code) {
    const t = Store.state.tickets.find((x) => x.code === code);
    if (!t) return;
    const ev = Store.event(t.eventId);
    const used = t.status === 'used';
    const order = t.orderId ? orderOf(t.orderId) : null;
    UI.sheet({
      title: ev.title,
      cls: 'bl-qs-sheet',
      body: `<div class="bl-qs${used ? ' is-used' : ''}">
          <p class="bl-qs-when">${esc(when(ev))} · ${esc(Store.venueOf(ev.id).name)}</p>
          <div class="bl-qs-qr">${UI.qr(t.payload)}</div>
          <p class="bl-qs-code">${esc(t.code)}</p>
          <p class="bl-qs-label">${esc(Store.ticketLabel(t))}</p>
          <p class="bl-qs-holder">Titular: ${esc(t.holder)}</p>
          <span class="badge ${used ? '' : 'badge-ok'}">${esc(statusTxt(t))}</span>
          <p class="bl-qs-tip">${used ? 'Esta boleta ya registró su ingreso' + (t.gate ? ' por ' + esc(t.gate) : '') + '.' : 'Sube el brillo de la pantalla al presentarla en la puerta.'}</p>
        </div>`,
      actions: order ? `<a class="btn btn-line" href="#/boletas/${esc(order.id)}" data-close>Ver la orden</a>` : ''
    });
  }

  App.view({
    id: 'boletas', path: '/boletas', role: 'buyer', title: 'Mis boletas',
    render() { return mineHTML(); },
    mount(root, p, ctx) {
      delegate(root, ctx, 'click', (e) => {
        const b = e.target.closest('[data-open]');
        if (b) qrSheet(b.dataset.open);
      });
      ctx.sub('access', () => {
        root.querySelectorAll('[data-open]').forEach((b) => {
          const t = Store.state.tickets.find((x) => x.code === b.dataset.open);
          if (!t || t.status !== 'used' || b.classList.contains('is-used')) return;
          b.classList.add('is-used');
          const st = b.querySelector('[data-st]');
          st.textContent = statusTxt(t);
          st.classList.remove('badge-ok');
        });
      });
      // Diferido: re-renderizar dentro de Store.emit re-suscribiría en el mismo recorrido.
      let queued = false;
      ctx.sub('ticket', () => { if (queued) return; queued = true; setTimeout(() => App.rerender(), 0); });
    }
  });

  /* ---------------- /avisos ---------------- */
  let avFilter = 'all';
  const FILTERS = [['all', 'Todos', null], ['email', 'Correo', 'mail'], ['whatsapp', 'WhatsApp', 'chat'], ['push', 'En la app', 'bell']];

  function noteLink(n) {
    if (!n.orderId) return '';
    const o = orderOf(n.orderId);
    if (!o) return '';
    if (o.status === 'paid') return `<a class="bl-av-link" href="#/boletas/${esc(o.id)}">Ver boletas ${icon('arrow', 15)}</a>`;
    const h = Store.myHold();
    if (o.status === 'pending' && h && h.orderId === o.id) return `<a class="bl-av-link" href="#/pago/${esc(o.id)}">Volver a la pasarela ${icon('arrow', 15)}</a>`;
    if (o.status === 'failed' && h && !h.orderId) return `<a class="bl-av-link" href="#/checkout">Intentar de nuevo ${icon('arrow', 15)}</a>`;
    return '';
  }

  function itemHTML(n, unread) {
    const c = chOf(n.channel);
    const isNew = unread.has(n.id);
    // Las cortesías las emite el organizador: el aviso es el correo que recibió el invitado.
    const toGuest = /^cortes[ií]a enviada/i.test(String(n.title || ''));
    return `<li class="bl-av-item${isNew ? ' is-new' : ''}" data-id="${esc(n.id)}">
      <span class="bl-ch-ico bl-av-ico ch-${chKey(n.channel)}" aria-hidden="true">${icon(c.icon, 19)}</span>
      <div class="bl-av-body">
        <p class="bl-av-meta"><span>${esc(c.label)}${toGuest ? ' al invitado' : ''}</span><time data-at="${n.at}" datetime="${new Date(n.at).toISOString()}">${esc(fmt.ago(n.at))}</time></p>
        <p class="bl-av-title">${isNew ? '<span class="sr-only">Nuevo: </span>' : ''}${esc(noteTitle(n))}</p>
        <p class="bl-av-text">${esc(n.body)}</p>
        ${noteLink(n)}
      </div>
      <span class="bl-av-dot" aria-hidden="true"></span>
    </li>`;
  }

  function listHTML(unread) {
    const all = Store.state.notifications;
    const list = avFilter === 'all' ? all : all.filter((n) => chKey(n.channel) === avFilter);
    if (!list.length) {
      return `<div class="bl-av-none">${icon('filter', 26)}<p class="strong">No hay avisos por este canal</p><p class="small muted">Prueba con «Todos».</p></div>`;
    }
    return `<ul class="bl-av-ul">${list.map((n) => itemHTML(n, unread)).join('')}</ul>`;
  }

  function filtersHTML() {
    const all = Store.state.notifications;
    return FILTERS.map(([k, label, ic]) => {
      const n = k === 'all' ? all.length : all.filter((x) => chKey(x.channel) === k).length;
      return `<button type="button" class="chip bl-av-chip${avFilter === k ? ' is-on' : ''}" data-f="${k}" aria-pressed="${avFilter === k}">${ic ? icon(ic, 16) : ''}<span>${label}</span><span class="bl-av-count">${n}</span></button>`;
    }).join('');
  }

  function avisosHTML(unread) {
    const all = Store.state.notifications;
    if (!all.length) {
      return `<div class="wrap bl-empty bl-av-empty">
        <div class="bl-empty-art" aria-hidden="true">
          <div class="bl-ghost-bell">${icon('bell', 44)}</div>
        </div>
        <div class="bl-empty-txt">
          <p class="eyebrow">Centro de avisos</p>
          <h1 class="h1">Todavía no tienes avisos</h1>
          <p class="lead">Te escribimos por correo, WhatsApp y notificación en la app en cada paso: reserva, pago, confirmación y vencimiento.</p>
          <div class="bl-empty-btns"><a class="btn btn-primary btn-lg" href="#/">Ir a la cartelera ${icon('arrow', 18)}</a></div>
        </div>
      </div>`;
    }
    return `<div class="wrap bl-av">
      <aside class="bl-av-side">
        <p class="eyebrow">Centro de avisos</p>
        <h1 class="h1">Avisos</h1>
        <p class="bl-av-lead">Correo, WhatsApp y notificación en la app en cada paso: reserva, pago, confirmación y vencimiento.</p>
        <ul class="bl-av-steps" aria-label="Pasos que generan avisos">
          <li><span>Reserva</span></li><li><span>Pago</span></li><li><span>Confirmación</span></li><li><span>Vencimiento</span></li>
        </ul>
        <div class="bl-av-filters" role="group" aria-label="Filtrar por canal" data-filters>${filtersHTML()}</div>
      </aside>
      <section class="bl-av-main" aria-label="Lista de avisos" data-list>${listHTML(unread)}</section>
    </div>`;
  }

  /* Los no leídos se capturan antes de marcarlos. App.go puede renderizar dos veces seguidas
     (llamada directa + hashchange), así que el conjunto se conserva unos segundos. */
  let avUnread = new Set();
  let avAt = 0;
  App.view({
    id: 'avisos', path: '/avisos', role: 'buyer', title: 'Avisos',
    render() {
      if (Date.now() - avAt > 2500) avUnread = new Set();
      Store.state.notifications.forEach((n) => { if (!n.read) avUnread.add(n.id); });
      return avisosHTML(avUnread);
    },
    mount(root, p, ctx) {
      avAt = Date.now();
      const unread = avUnread;
      let queued = false; // re-render diferido (fuera de Store.emit)
      Store.markAllRead();
      App.refreshBadges();
      const paint = () => {
        const f = root.querySelector('[data-filters]');
        const l = root.querySelector('[data-list]');
        if (!f || !l) { if (!queued) { queued = true; setTimeout(() => App.rerender(), 0); } return; }
        f.innerHTML = filtersHTML();
        l.innerHTML = listHTML(unread);
      };
      delegate(root, ctx, 'click', (e) => {
        const b = e.target.closest('[data-f]');
        if (!b) return;
        avFilter = b.dataset.f;
        paint();
        const nb = root.querySelector(`[data-f="${avFilter}"]`);
        if (nb) nb.focus({ preventScroll: true });
      });
      ctx.sub('notify', (n) => {
        if (!n) return; // markAllRead
        unread.add(n.id);
        Store.markAllRead();
        App.refreshBadges();
        paint();
      });
      ctx.every(20000, () => {
        root.querySelectorAll('time[data-at]').forEach((t) => { t.textContent = fmt.ago(Number(t.dataset.at)); });
      });
    }
  });
})();
