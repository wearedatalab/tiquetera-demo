/* Panel de ventas del organizador («app móvil para listar y controlar las ventas»):
   dial de aforo en vivo, recaudo, ventas por día, ocupación por opción de compra
   (junto a la imagen de ubicaciones que subió el organizador), ventas en vivo y
   modo pico: 1.000 ventas en 10 minutos simulados sobre el inventario real del demo.
   Lo que vende el pico queda anotado y puede devolverse al cupo (o se devuelve solo al repetir),
   para que el demo no se degrade de una presentación a otra. */
(function () {
  'use strict';
  const { esc, fmt, icon, clamp } = UI;
  const D = window.DATA;

  /* ---------------- utilidades locales ---------------- */
  /* Agrupa llamadas: ejecuta fn como máximo una vez cada `ms`. Se apaga al salir de la vista. */
  function throttled(ctx, ms, fn) {
    let last = 0, t = null, alive = true;
    ctx.onLeave(() => { alive = false; clearTimeout(t); });
    return function () {
      if (!alive || t) return;
      const wait = Math.max(0, ms - (Date.now() - last));
      t = setTimeout(() => { t = null; if (!alive) return; last = Date.now(); fn(); }, wait);
    };
  }
  /* Reparte n en proporción a los pesos (mayor residuo). */
  function split(n, w) {
    const S = w.reduce((a, b) => a + b, 0);
    if (!n || S <= 0) return w.map(() => 0);
    const raw = w.map((x) => (n * x) / S);
    const out = raw.map((x) => Math.floor(x));
    let rest = n - out.reduce((a, b) => a + b, 0);
    raw.map((x, i) => [x - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
      if (rest > 0 && w[i] > 0) { out[i]++; rest--; }
    });
    return out;
  }
  const pctTxt = (x) => fmt.pct(x, x > 0 && x < 0.1 ? 1 : 0);
  const isoNoon = (d) => d + 'T12:00:00-05:00'; // evita el corrimiento de día por zona horaria

  /* La simulación se concentra en el evento que se está controlando (como la ficha del evento),
     pero suelta el foco cuando quedan pocos cupos para no agotar los eventos que usa la guía. */
  function focusSim(ctx, evId) {
    const apply = () => {
      const st = Store.eventStats(evId);
      Store.sim.focus(st.free > Math.max(40, Math.round(st.capacity * 0.05)) ? evId : null);
    };
    apply();
    ctx.every(5000, apply);
    ctx.onLeave(() => Store.sim.focus(null));
  }

  /* ---------------- Libro del modo pico ----------------
     Store.state.ui.pico[evId] = { since, qty, amount, opts:{ optId: n } } → lo que vendió el pico.
     Vive en el estado persistido (se borra solo con Store.reset()). */
  const ledgers = () => { const ui = Store.state.ui; return (ui.pico = ui.pico || {}); };
  const ledger = (evId) => ledgers()[evId] || null;
  const ledgerQty = (evId) => { const L = ledger(evId); return L ? L.qty : 0; };
  function ledgerOpen(evId) {
    const all = ledgers();
    if (!all[evId]) all[evId] = { since: Date.now(), qty: 0, amount: 0, opts: {} };
    return all[evId];
  }
  function ledgerAdd(evId, optId, n, price) {
    const L = ledgerOpen(evId);
    L.opts[optId] = (L.opts[optId] || 0) + n;
    L.qty += n; L.amount += n * price;
  }
  /* Devuelve al cupo lo que vendió el pico: vendidas, ventas del feed marcadas como pico y el
     acumulado de hoy. Las compras reales hechas después se conservan. → boletas devueltas */
  function giveBack(evId) {
    const L = ledger(evId);
    if (!L || !L.qty) { delete ledgers()[evId]; return 0; }
    const S = Store.state;
    let back = 0;
    Object.keys(L.opts).forEach((optId) => {
      const o = Store.option(evId, optId);
      if (!o) return;
      const k = Math.min(L.opts[optId], o.sold);
      o.sold -= k; back += k;
      // el cursor de sillas solo retrocede si nadie recibió silla después del pico
      const later = S.tickets.some((t) => t.eventId === evId && t.optionId === optId && t.issuedAt >= L.since);
      if (o.seating === 'numerada' && !later) o.seatCursor = Math.max(o.sold, o.seatCursor - k);
    });
    if (S.feed[evId]) S.feed[evId] = S.feed[evId].filter((e) => !(e.bulk && e.at >= L.since));
    const t = S.today[evId];
    if (t) { t.qty = Math.max(0, t.qty - L.qty); t.amount = Math.max(0, t.amount - L.amount); }
    delete ledgers()[evId];
    Store.save();
    Object.keys(L.opts).forEach((optId) => Store.emit('option', { eventId: evId, optionId: optId }));
    return back;
  }
  /* Cupo con el que contaría un pico nuevo (lo libre + lo que devolvería primero). */
  const available = (evId) => Store.eventStats(evId).free + ledgerQty(evId);
  function bestEvent(exclude) {
    let best = null;
    D.events.forEach((e) => {
      if (e.id === exclude) return;
      const a = available(e.id);
      if (!best || a > best.a) best = { e, a };
    });
    return best;
  }
  let pendingAuto = null; // evento al que se cambió desde «Simular en …»: arranca solo al montar

  /* ---------------- Dial de aforo ---------------- */
  const DOTS = 108, ARC = 280, A0 = -ARC / 2, CX = 150, CY = 150;
  const pt = (deg, r) => { const a = (deg * Math.PI) / 180; return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; };
  const f2 = (n) => n.toFixed(2);

  function dialSVG(capacity) {
    let dots = '';
    for (let i = 0; i < DOTS; i++) {
      const deg = A0 + (ARC * i) / (DOTS - 1);
      const [x1, y1] = pt(deg, 111), [x2, y2] = pt(deg, 128);
      dots += `<line style="--i:${i}" x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}"/>`;
    }
    const [sx, sy] = pt(A0, 140), [ex, ey] = pt(A0 + ARC, 140);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => {
      const d = A0 + ARC * p, [a, b] = pt(d, 135), [c, e] = pt(d, 146);
      return `<line class="ov-tick" x1="${f2(a)}" y1="${f2(b)}" x2="${f2(c)}" y2="${f2(e)}"/>`;
    }).join('');
    const [l0x, l0y] = pt(A0, 128), [l1x, l1y] = pt(A0 + ARC, 128);
    return `<svg class="ov-dial-svg" viewBox="0 0 300 300" aria-hidden="true" focusable="false">
      <circle class="ov-perf" cx="150" cy="150" r="97"/>
      <path class="ov-scale" d="M${f2(sx)} ${f2(sy)} A140 140 0 1 1 ${f2(ex)} ${f2(ey)}"/>
      ${ticks}
      <g class="ov-dots">${dots}</g>
      <text class="ov-dial-end" x="${f2(l0x - 4)}" y="${f2(l0y + 26)}" text-anchor="middle">0</text>
      <text class="ov-dial-end" x="${f2(l1x + 4)}" y="${f2(l1y + 26)}" text-anchor="middle">${esc(fmt.num(capacity))}</text>
      <g class="ov-needle" data-ov-needle><circle cx="150" cy="10" r="5"/></g>
    </svg>`;
  }

  /* ---------------- Bloques ---------------- */
  function saleState(st) {
    if (st.free > 0) return { key: 'on', html: '<span class="dot-live"></span>A la venta' };
    if (st.held > 0) return { key: 'proc', html: `${icon('timer', 15)}Agotado por ahora` };
    return { key: 'out', html: `${icon('lock', 15)}Agotado` };
  }
  function headHTML(ev, st) {
    const v = Store.venueOf(ev.id);
    const k = saleState(st);
    return `<header class="ov-head">
      <div class="ov-poster"><img src="${esc(ev.img)}" alt="" loading="lazy" decoding="async"></div>
      <div class="ov-head-txt">
        <p class="eyebrow">Panel de ventas · ${esc(ev.category)}</p>
        <h1 class="h1">${esc(ev.title)}</h1>
        <p class="ov-meta">
          <span>${icon('calendar', 16)}${esc(fmt.dateLong(ev.date))} · ${esc(fmt.time(ev.date))}</span>
          <span>${icon('pin', 16)}${esc(v.name)}, ${esc(v.city)}</span>
        </p>
      </div>
      <div class="ov-head-act">
        <span class="ov-state ${k.key !== 'on' ? 'is-out' : ''}" data-ov-state data-k="${k.key}">${k.html}</span>
        <a class="btn btn-sm btn-line ov-buyer-link" href="#/evento/${esc(ev.id)}">${icon('eye', 16)}Ver como comprador</a>
      </div>
    </header>`;
  }

  function pulseHTML(ev, st) {
    const per = Math.max(1, Math.round(st.capacity / DOTS));
    return `<section class="panel ov-pulse" aria-labelledby="ov-pulse-t">
      <h2 class="sr-only" id="ov-pulse-t">Aforo y recaudo</h2>
      <div class="ov-pulse-in">
        <div class="ov-dial">
          <div class="ov-dial-box">
            ${dialSVG(st.capacity)}
            <div class="ov-dial-c">
              <span class="eyebrow">Aforo ocupado</span>
              <strong class="ov-dial-num num" data-ov-occ data-v="${st.occupied}">${fmt.num(st.occupied)}</strong>
              <span class="ov-dial-of mono">de ${fmt.num(st.capacity)}</span>
              <span class="ov-dial-pct mono" data-ov-pct>${pctTxt(st.pct)}</span>
            </div>
          </div>
          <ul class="ov-legend">
            <li><i class="is-occ"></i><span>Ocupado</span><b class="mono" data-ov-l="occ">${fmt.num(st.occupied)}</b></li>
            <li><i class="is-held"></i><span>En proceso</span><b class="mono" data-ov-l="held">${fmt.num(st.held)}</b></li>
            <li><i></i><span>Libre</span><b class="mono" data-ov-l="free">${fmt.num(st.free)}</b></li>
          </ul>
          <p class="ov-dial-note tiny faint">Cada punto ≈ ${fmt.num(per)} boletas · ocupado = vendidas + cortesías</p>
        </div>
        <ul class="ov-facts">
          <li class="ov-fact ov-fact-lead">
            <span class="eyebrow">Recaudo bruto</span>
            <strong class="ov-rev num" data-ov-rev data-v="${st.revenue}">${fmt.copShort(st.revenue)}</strong>
            <span class="small muted" data-ov-rev-sub>${fmt.num(st.sold)} boletas vendidas × su precio, antes de cargos</span>
          </li>
          <li class="ov-fact">
            <span class="ov-fact-k"><span>Vendidas hoy</span><span class="tiny faint" data-ov-today-amt></span></span>
            <span class="ov-fact-v mono" data-ov-today>—</span>
          </li>
          <li>
            <a class="ov-fact ov-fact-link" href="#/org/reservas">
              <span class="ov-fact-k"><span>Reservas en proceso ahora</span><span class="tiny faint" data-ov-holds-sub></span></span>
              <span class="ov-fact-v mono"><span data-ov-holds>${fmt.num(st.activeHolds)}</span>${icon('right', 18)}</span>
            </a>
          </li>
          <li class="ov-fact">
            <span class="ov-fact-k"><span>Cortesías usadas</span><span class="ov-court-bar progress" aria-hidden="true"><i data-ov-court-bar style="--p:0%;--c:var(--courtesy)"></i></span></span>
            <span class="ov-fact-v mono"><span data-ov-court>0</span><span class="faint"> / ${fmt.num(st.courtesyQuota)}</span></span>
          </li>
        </ul>
      </div>
    </section>`;
  }

  function chartBlock(evId) {
    const days = Store.salesByDay(evId);
    const max = Math.max(1, ...days.map((d) => d.qty));
    const top = Math.ceil((max * 1.12) / 10) * 10;
    const W = 630, H = 180, step = W / days.length, bw = step * 0.62;
    const bars = days.map((d, i) => {
      const h = Math.max(2, (d.qty / top) * (H - 4));
      const today = i === days.length - 1;
      const label = `${fmt.date(isoNoon(d.date))}${today ? ' (hoy)' : ''} · ${fmt.plural(d.qty, 'boleta', 'boletas')} · ${fmt.copShort(d.amount)}`;
      return `<rect class="${today ? 'is-today' : ''}" x="${f2(i * step + (step - bw) / 2)}" y="${f2(H - h)}" width="${f2(bw)}" height="${f2(h)}" rx="3"><title>${esc(label)}</title></rect>`;
    }).join('');
    const grid = [0.5, 1].map((p) => `<line class="ov-grid" x1="0" x2="${W}" y1="${f2(H - (H - 4) * p)}" y2="${f2(H - (H - 4) * p)}"/>`).join('');
    const labels = days.map((d, i) => {
      const show = i === 0 || i === 7 || i === 14 || i === days.length - 1;
      if (!show) return '<span></span>';
      return `<span class="${i === days.length - 1 ? 'is-today' : ''}">${i === days.length - 1 ? 'Hoy' : esc(fmt.day(isoNoon(d.date)) + ' ' + fmt.month(isoNoon(d.date)))}</span>`;
    }).join('');
    const total = days.reduce((a, d) => a + d.qty, 0);
    const today = days[days.length - 1];
    return {
      sig: days.map((d) => d.qty).join(','),
      total, today,
      html: `<div class="ov-chart-plot">
          <span class="ov-chart-y mono">${fmt.num(top)}</span>
          <svg class="ov-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Boletas vendidas por día en los últimos 21 días">${grid}${bars}</svg>
        </div>
        <div class="ov-chart-x mono" aria-hidden="true">${labels}</div>`
    };
  }

  function chartHTML(evId) {
    const c = chartBlock(evId);
    return `<section class="panel ov-chart" aria-labelledby="ov-chart-t">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Últimos 21 días</p>
          <h2 class="h3" id="ov-chart-t">Ventas por día</h2>
        </div>
        <div class="ov-chart-sum">
          <span class="mono"><b data-ov-ctotal>${fmt.num(c.total)}</b> boletas</span>
          <span class="ov-chart-today mono">${icon('bars', 15)}Hoy <b data-ov-ctoday>${fmt.num(c.today.qty)}</b></span>
        </div>
      </div>
      <div class="ov-chart-body" data-ov-chart data-sig="${esc(c.sig)}">${c.html}</div>
    </section>`;
  }

  function optRow(evId, s) {
    const o = s.option;
    return `<li class="ov-or" data-opt="${esc(o.id)}" style="--oc:${esc(o.color)}">
      <span class="ov-or-sw" aria-hidden="true"></span>
      <div class="ov-or-b">
        <p class="ov-or-name">${esc(o.name)}</p>
        <span class="opt-avail" data-f="avail"></span>
        <p class="ov-or-sub">${esc(LocMap.seatingLabel(o))} · ${fmt.cop(o.price)}</p>
        <div class="ov-or-bar">
          <div class="progress ov-progress" aria-hidden="true"><i data-f="occ" style="--c:var(--oc)"></i><i class="ov-pheld" data-f="held"></i></div>
          <span class="mono ov-or-pct" data-f="pct"></span>
        </div>
        <p class="ov-or-nums mono"><span data-f="sold"></span><span data-f="proc"></span></p>
        <span class="ov-or-rev mono" data-f="rev" title="Recaudo de esta opción"></span>
      </div>
    </li>`;
  }
  function optsHTML(evId, st) {
    return `<section class="panel ov-opts" aria-labelledby="ov-opts-t">
      <div class="panel-head">
        <div>
          <p class="eyebrow" data-ov-opts-n>${fmt.plural(st.byOption.length, 'opción de compra', 'opciones de compra')}</p>
          <h2 class="h3" id="ov-opts-t">Cómo va cada opción</h2>
        </div>
        <a class="btn btn-sm btn-ghost ov-edit" href="#/org/espacios">${icon('edit', 16)}<span>Editar</span></a>
      </div>
      <div class="ov-opts-in">
        <div class="ov-thumb">
          ${LocMap.figure(evId, { caption: false })}
          <p class="tiny faint">Imagen de ubicaciones que subió el organizador. Cada evento trae su propio diseño; las opciones de compra se definen al lado.</p>
        </div>
        <ul class="ov-or-list" data-ov-opts>${st.byOption.map((s) => optRow(evId, s)).join('')}</ul>
      </div>
    </section>`;
  }

  /* Las 12 ventas más recientes, en orden de hora (Store.feed guarda hasta 60). */
  const latest = (evId) => Store.feed(evId, 60).slice().sort((a, b) => b.at - a.at).slice(0, 12);
  const feedKey = (e) => `${e.at}|${e.optionId}|${e.qty}|${e.buyer}|${e.kind}`;
  function feedRow(evId, e, fresh) {
    const o = Store.option(evId, e.optionId);
    const isC = e.kind === 'cortesia';
    const lot = e.bulk && e.qty > 1; // el pico agrupa varias compras por instante
    const tags = [
      `<span class="ov-tag">${e.channel === 'app' ? 'App' : 'Web'}</span>`,
      `<span class="ov-tag ${isC ? 'is-court' : 'is-sale'}">${isC ? 'Cortesía' : 'Venta'}</span>`,
      e.bulk ? '<span class="ov-tag is-peak">Pico</span>' : '',
      e.mine ? '<span class="ov-tag is-mine">Tu compra</span>' : ''
    ].join('');
    // las ventas del pico se registran sin cargo de servicio: se muestran con él, como las demás
    const amount = e.bulk ? Math.round(e.amount * (1 + D.serviceFee)) : e.amount;
    const name = o ? o.name : 'Opción';
    const who = lot
      ? `<b>Lote de ${fmt.num(e.qty)}</b> <span class="ov-fi-x">· ${esc(name)}</span>`
      : `<b>${esc(e.buyer)}</b> <span class="ov-fi-x">${fmt.num(e.qty)} × ${esc(name)}</span>`;
    return `<li class="ov-fi${fresh ? ' rise flash' : ''}" data-k="${esc(feedKey(e))}" style="--c:${esc(o ? o.color : 'var(--text-3)')}">
      <time class="ov-fi-t mono" datetime="${new Date(e.at).toISOString()}">${fmt.clock(e.at)}</time>
      <div class="ov-fi-b">
        <p class="ov-fi-who"${lot ? ` title="${fmt.num(e.qty)} boletas vendidas en el mismo instante del pico"` : ''}>${who}</p>
        <p class="ov-fi-tags">${tags}</p>
      </div>
      <span class="ov-fi-amt mono">${isC ? 'Sin costo' : fmt.cop(amount)}</span>
    </li>`;
  }
  function feedHTML(evId) {
    const items = latest(evId);
    return `<section class="panel ov-feed" aria-labelledby="ov-feed-t">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Web y app</p>
          <h2 class="h3" id="ov-feed-t">Ventas en vivo</h2>
        </div>
        <span class="ov-live mono"><span class="dot-live"></span>En vivo</span>
      </div>
      <div class="ov-mine" data-ov-mine hidden>
        <p class="ov-mine-k">${icon('ticket', 14)}<span>Tu compra de esta sesión</span></p>
        <ol class="ov-mine-list" data-ov-mine-list></ol>
      </div>
      <ol class="ov-feed-list" data-ov-feed>${items.length ? items.map((e) => feedRow(evId, e, false)).join('') : ''}</ol>
      <p class="ov-feed-empty small muted" data-ov-feed-empty ${items.length ? 'hidden' : ''}>Aún no hay ventas registradas para este evento.</p>
      <button class="btn btn-sm btn-ghost btn-block ov-feed-more" type="button" data-ov-more aria-expanded="false">Ver las 12 más recientes ${icon('down', 16)}</button>
    </section>`;
  }

  /* ---------------- Modo pico ---------------- */
  const PK = {
    GOAL: 1000, TICKS: 100, TICK_MS: 250, SIM_SEC: 600, PER_INST: 48, MAX_INST: 12, MIN_INST: 2,
    DEMAND: [40, 95, 160, 190, 150, 120, 90, 70, 50, 35] // ventas por minuto simulado (suma 1.000)
  };
  PK.CUM = PK.DEMAND.reduce((a, d, i) => (a.push(a[i] + d), a), [0]);
  const mmss = (sec) => String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

  function picoHTML() {
    const spark = PK.DEMAND.map((d) => `<i style="--h:${Math.round((d / 190) * 100)}%"></i>`).join('');
    return `<section class="ov-pico" data-ov-pico aria-labelledby="ov-pico-t">
      <div class="ov-pk-intro">
        <div class="ov-pk-intro-txt">
          <p class="eyebrow ov-pk-eyebrow">${icon('zap', 14)}<span>Modo pico · arquitectura que escala</span></p>
          <h2 class="h2" id="ov-pico-t">1.000 ventas en 10 minutos</h2>
          <p class="muted ov-pk-lead">Abre una preventa y todos entran al tiempo. Comprimimos 10 minutos en 25 segundos: cola virtual, servidores que se suman solos y control de cupos para que ninguna boleta se venda dos veces.</p>
        </div>
        <div class="ov-pk-intro-act">
          <div class="ov-pk-spark" aria-hidden="true">${spark}</div>
          <button class="btn btn-primary ov-pk-go" type="button" data-pk-start>${icon('zap', 18)}Simular pico</button>
        </div>
        <div class="ov-pk-notes" data-pk-notes aria-live="polite"></div>
      </div>
      <div class="ov-pk-console" data-pk-console hidden>
        <div class="ov-pk-top">
          <div class="ov-pk-clock">
            <span class="eyebrow">Reloj simulado</span>
            <span class="ov-pk-time"><strong class="mono" data-pk-clock>00:00</strong><span class="mono faint">/ 10:00</span></span>
          </div>
          <div class="ov-pk-prog">
            <div class="ov-pk-prog-h">
              <span class="eyebrow">Ventas completadas</span>
              <span class="mono"><b data-pk-sold>0</b><span class="faint"> / ${fmt.num(PK.GOAL)}</span></span>
            </div>
            <div class="progress ov-pk-bar"><i data-pk-bar style="--p:0%"></i></div>
          </div>
          <span class="ov-pk-state" data-pk-state role="status">Listo</span>
        </div>

        <div class="ov-pk-end" data-pk-end hidden aria-live="polite"></div>

        <div class="ov-pk-grid">
          <div class="ov-pk-cell ov-pk-minutes">
            <div class="ov-pk-cell-h"><span class="eyebrow">Ventas por minuto</span><span class="tiny faint mono">máx. 200 / min</span></div>
            <div class="ov-pk-mins" data-pk-mins>
              ${PK.DEMAND.map((_, i) => `<div class="ov-pk-min" data-m="${i}"><span class="ov-pk-mv mono">0</span><div class="ov-pk-mt"><i></i></div><span class="ov-pk-ml mono">${i + 1}′</span></div>`).join('')}
            </div>
          </div>
          <div class="ov-pk-infra">
            <div class="ov-pk-cell">
              <div class="ov-pk-cell-h"><span class="eyebrow">Instancias activas</span><span class="mono ov-pk-val"><b data-pk-inst>2</b><span class="faint"> / ${PK.MAX_INST}</span></span></div>
              <div class="ov-pk-srvs" data-pk-srvs>${Array.from({ length: PK.MAX_INST }, (_, i) => `<span class="ov-pk-srv${i < PK.MIN_INST ? ' is-on' : ''}">${icon('server', 18)}</span>`).join('')}</div>
              <p class="tiny faint">Se suman solas cuando sube la demanda y se apagan cuando baja.</p>
            </div>
            <div class="ov-pk-cell">
              <div class="ov-pk-cell-h"><span class="eyebrow">Cola virtual</span><span class="mono ov-pk-val"><b data-pk-queue>0</b><span class="faint"> en fila</span></span></div>
              <div class="ov-pk-queue" data-pk-qseg>${'<i></i>'.repeat(30)}</div>
              <p class="tiny faint">Las personas entran por turno; nadie aparta sin cupo.</p>
            </div>
            <div class="ov-pk-cell">
              <div class="ov-pk-cell-h"><span class="eyebrow" data-pk-lat-l>Latencia ahora</span><span class="mono ov-pk-val"><b data-pk-lat>—</b><span class="faint"> ms</span></span></div>
              <svg class="ov-pk-lat" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
                <line class="ov-pk-lat-lim" x1="0" x2="200" y1="7.6" y2="7.6"/>
                <polyline data-pk-latline points=""/>
              </svg>
              <p class="tiny faint">Objetivo: por debajo de 200 ms aun en el pico.</p>
            </div>
          </div>
        </div>

        <div class="ov-pk-proof stub" data-pk-proof>
          <div class="ov-pk-proof-a">
            <span class="ov-pk-shield">${icon('shield', 30)}</span>
            <div>
              <p class="eyebrow">Comprobante de integridad</p>
              <p class="ov-pk-dbl">Dobles ventas: <b class="mono" data-pk-dbl>0</b></p>
              <p class="tiny muted" data-pk-dbl-sub>Cada venta descuenta del cupo libre en una sola operación.</p>
            </div>
          </div>
          <div class="ov-pk-proof-b">
            <p class="eyebrow">Intentos sin cupo rechazados</p>
            <p class="ov-pk-rej mono" data-pk-rej>0</p>
            <p class="tiny muted">Llegaron cuando el cupo ya estaba tomado. No se cobró nada.</p>
          </div>
        </div>
      </div>
    </section>`;
  }

  /* → { refresh } para que la vista repinte las notas del pico junto con el resto. */
  function mountPico(root, evId, ctx, autostart, onInventory) {
    const sec = root.querySelector('[data-ov-pico]');
    const $ = (s) => sec.querySelector(s);
    const ui = {
      start: $('[data-pk-start]'), notes: $('[data-pk-notes]'), console: $('[data-pk-console]'), clock: $('[data-pk-clock]'), sold: $('[data-pk-sold]'),
      bar: $('[data-pk-bar]'), state: $('[data-pk-state]'), end: $('[data-pk-end]'), inst: $('[data-pk-inst]'),
      srvs: [...sec.querySelectorAll('.ov-pk-srv')], queue: $('[data-pk-queue]'), qseg: [...sec.querySelectorAll('[data-pk-qseg] i')],
      lat: $('[data-pk-lat]'), latL: $('[data-pk-lat-l]'), latline: $('[data-pk-latline]'), dbl: $('[data-pk-dbl]'), dblSub: $('[data-pk-dbl-sub]'), rej: $('[data-pk-rej]'),
      mins: [...sec.querySelectorAll('.ov-pk-min')]
    };
    let timer = null, cool = null, s = null, notesSig = '';
    const stop = () => { clearInterval(timer); timer = null; };
    const stopCool = () => { clearInterval(cool); cool = null; };
    ctx.onLeave(() => { stop(); stopCool(); });

    function fresh() {
      return { k: 0, sold: 0, rejected: 0, perMin: PK.DEMAND.map(() => 0), queue: 0, inst: PK.MIN_INST, up: 0, down: 0, lat: [], done: false, soldOut: false, calls: 0 };
    }

    /* Notas del panel cerrado: aviso si el evento no alcanza para 1.000 y lo que dejó el último pico. */
    function paintNotes() {
      if (sec.classList.contains('is-open')) { ui.notes.hidden = true; return; } // con la consola abierta habla el resumen
      const L = ledger(evId);
      const avail = available(evId);
      let html = '';
      if (avail < PK.GOAL) {
        const best = bestEvent(evId);
        const alt = best && best.a >= PK.GOAL ? best : null;
        html += `<p class="ov-pk-note is-warn">${icon('alert', 16)}<span>${avail <= 0
          ? 'Este evento ya no tiene cupo libre: el pico no tendría qué vender.'
          : `Este evento tiene <b>${fmt.num(avail)} ${avail === 1 ? 'cupo libre' : 'cupos libres'}</b>: el pico se detendrá justo en el último.`}${alt ? ` Para ver las 1.000 completas, usa ${esc(alt.e.title)} (${fmt.num(alt.a)} libres).` : ''}</span>${alt
          ? `<button class="btn btn-sm btn-line" type="button" data-pk-switch="${esc(alt.e.id)}">${icon('zap', 15)}Simular en ${esc(alt.e.title)}</button>` : ''}</p>`;
      }
      if (L && L.qty) {
        html += `<p class="ov-pk-note">${icon('refresh', 16)}<span>El último pico dejó <b>${fmt.plural(L.qty, 'boleta vendida', 'boletas vendidas')}</b> en este evento. Al simular de nuevo vuelven primero al cupo.</span><button class="btn btn-sm btn-line" type="button" data-pk-return>Devolver al cupo</button></p>`;
      }
      if (html !== notesSig) { notesSig = html; ui.notes.innerHTML = html; }
      ui.notes.hidden = !html;
      ui.start.disabled = avail <= 0;
    }

    /* Vende `want` boletas repartidas según la demanda de cada opción; lo que llega a una opción
       sin cupo se rechaza (y esa persona elige otra opción con cupo). bulkSell nunca vende de más. */
    function sell(want) {
      if (want <= 0) return 0;
      const ops = Store.options(evId).map((o) => ({ o, st: Store.optionStats(evId, o.id) }));
      const att = split(want, ops.map((x) => x.o.capacity * (0.6 + x.st.pct)));
      const ok = ops.map((x, i) => Math.min(att[i], x.st.free));
      s.rejected += att.reduce((a, v, i) => a + (v - ok[i]), 0);
      const room = ops.map((x, i) => x.st.free - ok[i]);
      const left = Math.min(want - ok.reduce((a, b) => a + b, 0), room.reduce((a, b) => a + b, 0));
      const extra = split(Math.max(0, left), room);
      let got = 0;
      ops.forEach((x, i) => {
        const n = ok[i] + extra[i];
        if (n > 0) {
          const sold = Store.bulkSell(evId, x.o.id, n);
          if (sold) ledgerAdd(evId, x.o.id, sold, x.o.price);
          got += sold; s.calls++;
        }
      });
      return got;
    }

    function step() {
      s.k++;
      const k = s.k, m = Math.min(PK.DEMAND.length - 1, Math.floor((k - 1) / 10)), within = (((k - 1) % 10) + 1) / 10;
      const target = PK.CUM[m] + Math.round(PK.DEMAND[m] * within);
      const got = sell(target - s.sold);
      s.sold += got; s.perMin[m] += got;
      // infraestructura: llegada a la cola vs. capacidad de las instancias (escala con retraso)
      const rate = PK.DEMAND[m] * 3, cap = s.inst * PK.PER_INST;
      s.queue = Math.max(0, s.queue + (rate - cap) * 0.1);
      const tgt = clamp(Math.ceil((rate / PK.PER_INST) * 1.1), PK.MIN_INST + 1, PK.MAX_INST);
      if (tgt > s.inst) { if (++s.up >= 3) { s.inst++; s.up = 0; } } else s.up = 0;
      if (tgt < s.inst && s.queue < 5) { if (++s.down >= 4) { s.inst--; s.down = 0; } } else s.down = 0;
      const util = Math.min(rate / cap, 1.5) + s.queue / 1200;
      s.lat.push(clamp(Math.round(114 + 34 * util + (Math.random() * 8 - 4)), 120, 190));
      const free = Store.eventStats(evId).free;
      if (s.sold >= PK.GOAL || k >= PK.TICKS) finish(false);
      else if (free <= 0) finish(true);
    }

    function p95() {
      const v = [...s.lat].sort((a, b) => a - b);
      return v.length ? v[Math.ceil(0.95 * v.length) - 1] : 0;
    }
    function doubles() {
      return Store.options(evId, true).reduce((a, o) => a + Math.max(0, o.sold + o.courtesy - o.capacity), 0);
    }

    function paintInfra() {
      ui.inst.textContent = s.inst;
      ui.srvs.forEach((el, i) => el.classList.toggle('is-on', i < s.inst));
      const q = Math.round(s.queue);
      ui.queue.textContent = fmt.num(q);
      const lit = Math.min(ui.qseg.length, Math.ceil(q / 10));
      ui.qseg.forEach((el, i) => el.classList.toggle('is-on', i < lit));
    }
    function paint() {
      const simSec = Math.min(PK.SIM_SEC, s.k * (PK.SIM_SEC / PK.TICKS));
      ui.clock.textContent = mmss(simSec);
      ui.sold.textContent = fmt.num(s.sold);
      ui.bar.style.setProperty('--p', ((s.sold / PK.GOAL) * 100).toFixed(1) + '%');
      const cur = Math.min(PK.DEMAND.length - 1, Math.floor(Math.max(0, s.k - 1) / 10));
      ui.mins.forEach((el, i) => {
        const v = s.perMin[i];
        el.querySelector('i').style.height = Math.min(100, (v / 200) * 100).toFixed(1) + '%';
        el.querySelector('.ov-pk-mv').textContent = v ? fmt.num(v) : '';
        el.classList.toggle('is-now', s.k > 0 && !s.done && i === cur);
        el.classList.toggle('is-past', i < cur || (s.done && v > 0));
      });
      paintInfra();
      const last = s.lat[s.lat.length - 1];
      ui.lat.textContent = s.done ? (p95() || '—') : (last || '—');
      const pts = s.lat.slice(-40);
      ui.latline.setAttribute('points', pts.map((v, i) => `${f2((i / 39) * 200)},${f2(44 - ((v - 100) / 110) * 40)}`).join(' '));
      ui.dbl.textContent = fmt.num(doubles());
      ui.dblSub.textContent = s.sold
        ? `Comprobado en ${fmt.plural(s.sold, 'venta', 'ventas')}: ninguna opción supera su cupo.`
        : 'Cada venta descuenta del cupo libre en una sola operación.';
      ui.rej.textContent = fmt.num(s.rejected);
    }

    function setState(txt, cls) {
      ui.state.textContent = txt;
      ui.state.className = 'ov-pk-state ' + (cls || '');
    }

    /* Después de terminar, la demanda cae a cero: la cola se vacía y las instancias se apagan. */
    function coolDown() {
      stopCool();
      cool = setInterval(() => {
        s.queue = s.queue < 2 ? 0 : s.queue * 0.45;
        if (s.inst > PK.MIN_INST + 1) s.inst--;
        paintInfra();
        if (!s.queue && s.inst <= PK.MIN_INST + 1) stopCool();
      }, PK.TICK_MS + 50);
    }

    function endHTML(simSec, p, dbl) {
      const L = ledger(evId);
      const back = L ? L.qty : 0;
      const avail = available(evId);
      const best = s.soldOut ? bestEvent(evId) : null;
      const alt = best && best.a >= PK.GOAL ? best : null;
      return `
        <p class="ov-pk-sum">
          <span><b class="mono">${fmt.num(s.sold)}</b> boletas en <b class="mono">${mmss(simSec)}</b> simulados</span>
          <span class="ov-pk-sep" aria-hidden="true"></span>
          <span><b class="mono">${fmt.num(dbl)}</b> dobles ventas</span>
          <span class="ov-pk-sep" aria-hidden="true"></span>
          <span>p95 <b class="mono">${p} ms</b></span>
        </p>
        ${s.soldOut ? `<p class="small ov-pk-out">${icon('lock', 16)}<span><b>Agotado:</b> el evento se quedó sin cupo libre antes de llegar a 1.000 y el sistema dejó de vender en el último cupo disponible.</span></p>` : ''}
        <div class="ov-pk-end-row">
          <button class="btn btn-sm btn-line" type="button" data-pk-again ${avail <= 0 ? 'disabled' : ''}>${icon('refresh', 16)}Repetir</button>
          ${back ? `<button class="btn btn-sm btn-ghost" type="button" data-pk-return>${icon('ticket', 16)}Devolver ${fmt.plural(back, 'boleta', 'boletas')} al cupo</button>`
            : `<span class="ov-pk-returned">${icon('checkCircle', 16)}Inventario devuelto al cupo</span>`}
          ${alt ? `<button class="btn btn-sm btn-primary" type="button" data-pk-switch="${esc(alt.e.id)}">${icon('zap', 16)}Simular en ${esc(alt.e.title)}</button>` : ''}
          <p class="tiny faint">Esta simulación vende inventario real del demo: el dial, el gráfico y las ventas en vivo ya lo reflejan. «Repetir» devuelve primero estas boletas al cupo; para empezar de cero, <a class="ov-link" href="#/guia">reinicia los datos desde la guía</a>.</p>
        </div>`;
    }

    function finish(soldOut) {
      stop();
      s.done = true; s.soldOut = soldOut;
      ui.latL.textContent = 'Latencia p95';
      paint();
      const peak = s.perMin.indexOf(Math.max(...s.perMin));
      ui.mins.forEach((el, i) => el.classList.toggle('is-peak', i === peak && s.perMin[i] > 0));
      ui.console.classList.add('is-done');
      s.simSec = Math.min(PK.SIM_SEC, s.k * (PK.SIM_SEC / PK.TICKS));
      s.p95 = p95(); s.dbl = doubles();
      setState(soldOut ? 'Agotado' : 'Completado', soldOut ? 'is-out' : 'is-done');
      ui.end.innerHTML = endHTML(s.simSec, s.p95, s.dbl);
      ui.end.classList.toggle('is-out', soldOut);
      ui.end.hidden = false;
      coolDown();
    }

    function returnInventory() {
      const n = giveBack(evId);
      onInventory && onInventory();
      if (n) UI.toast(`${fmt.plural(n, 'boleta del pico volvió', 'boletas del pico volvieron')} al cupo libre.`, { type: 'ok' });
      if (s && s.done) ui.end.innerHTML = endHTML(s.simSec, s.p95, s.dbl);
      notesSig = '';
      paintNotes();
    }

    function run() {
      stop(); stopCool();
      const back = giveBack(evId); // el pico anterior vuelve al cupo: cada corrida parte del mismo inventario
      if (back) onInventory && onInventory();
      if (Store.eventStats(evId).free <= 0) {
        UI.toast('Este evento ya no tiene cupo libre. Reinicia los datos desde la guía para repetir el pico.', { type: 'warn', timeout: 5200 });
        paintNotes();
        return;
      }
      ledgerOpen(evId);
      s = fresh();
      sec.classList.add('is-open');
      ui.console.hidden = false;
      ui.start.hidden = true;
      ui.notes.hidden = true;
      ui.end.hidden = true; ui.end.innerHTML = '';
      ui.console.classList.remove('is-done');
      ui.mins.forEach((el) => el.classList.remove('is-peak'));
      ui.latL.textContent = 'Latencia ahora';
      setState('Simulando · ×24', 'is-run');
      paint();
      timer = setInterval(() => { step(); if (!s.done) paint(); }, PK.TICK_MS);
    }

    ui.start.addEventListener('click', () => run());
    sec.addEventListener('click', (e) => {
      if (e.target.closest('[data-pk-again]')) { run(); return; }
      if (e.target.closest('[data-pk-return]')) { returnInventory(); return; }
      const sw = e.target.closest('[data-pk-switch]');
      if (sw) {
        // el pico se muda de evento: lo que vendió aquí vuelve al cupo para no dejarlo agotado
        const n = giveBack(evId);
        if (n) UI.toast(`${fmt.plural(n, 'boleta', 'boletas')} del pico ${n === 1 ? 'volvió' : 'volvieron'} al cupo de ${Store.event(evId).title}.`, { type: 'info' });
        pendingAuto = sw.dataset.pkSwitch;
        App.setOrgEvent(sw.dataset.pkSwitch);
      }
    });

    paintNotes();
    if (autostart) {
      ctx.later(120, () => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      if (available(evId) >= PK.GOAL) {
        sec.classList.add('is-open');
        ui.console.hidden = false;
        ui.start.hidden = true;
        ui.notes.hidden = true;
        s = fresh(); paint();
        setState('Arrancando…', 'is-run');
        ctx.later(800, run);
      } else {
        sec.classList.add('is-flag'); // no alcanza para 1.000: se queda en el aviso, sin vender solo
      }
    }
    return { refresh: paintNotes };
  }

  /* ---------------- Vista ---------------- */
  App.view({
    id: 'org', path: '/org', role: 'org', title: 'Panel de ventas',
    render(params, query) {
      const evId = App.orgEvent();
      const ev = Store.event(evId);
      const st = Store.eventStats(evId);
      return `<div class="wrap ov">
        ${headHTML(ev, st)}
        <div class="ov-main">
          <div class="ov-top">
            ${pulseHTML(ev, st)}
            ${picoHTML()}
            ${feedHTML(evId)}
            ${chartHTML(evId)}
          </div>
          ${optsHTML(evId, st)}
        </div>
      </div>`;
    },
    mount(root, params, ctx, query) {
      const evId = App.orgEvent();
      // ?pico=1 se consume una sola vez: al cambiar de evento o volver atrás no se repite solo
      const fromQuery = !!(query && query.get('pico') === '1');
      if (fromQuery) { try { history.replaceState(null, '', '#/org'); } catch (e) { /* sin historial */ } }
      const autostart = fromQuery || pendingAuto === evId;
      pendingAuto = null;
      focusSim(ctx, evId);

      const q = (s) => root.querySelector(s);
      const dots = [...root.querySelectorAll('.ov-dots line')];
      const needle = q('[data-ov-needle]');
      const els = {
        occ: q('[data-ov-occ]'), pct: q('[data-ov-pct]'), lOcc: q('[data-ov-l="occ"]'), lHeld: q('[data-ov-l="held"]'), lFree: q('[data-ov-l="free"]'),
        rev: q('[data-ov-rev]'), revSub: q('[data-ov-rev-sub]'), today: q('[data-ov-today]'), todayAmt: q('[data-ov-today-amt]'), holds: q('[data-ov-holds]'), holdsSub: q('[data-ov-holds-sub]'),
        court: q('[data-ov-court]'), courtBar: q('[data-ov-court-bar]'), state: q('[data-ov-state]'),
        chart: q('[data-ov-chart]'), cTotal: q('[data-ov-ctotal]'), cToday: q('[data-ov-ctoday]'),
        opts: q('[data-ov-opts]'), optsN: q('[data-ov-opts-n]'), feed: q('[data-ov-feed]'), feedEmpty: q('[data-ov-feed-empty]'), more: q('[data-ov-more]')
      };

      function paintDial(st) {
        const occ = st.capacity ? Math.round((st.occupied / st.capacity) * DOTS) : 0;
        let held = st.capacity ? Math.round((st.held / st.capacity) * DOTS) : 0;
        if (st.held > 0) held = Math.max(1, held);
        held = Math.min(held, DOTS - occ);
        dots.forEach((l, i) => {
          l.classList.toggle('is-occ', i < occ);
          l.classList.toggle('is-held', i >= occ && i < occ + held);
        });
        needle.style.transform = `rotate(${f2(A0 + ARC * clamp(st.pct, 0, 1))}deg)`;
        UI.tween(els.occ, st.occupied);
        els.pct.textContent = pctTxt(st.pct);
        els.lOcc.textContent = fmt.num(st.occupied);
        els.lHeld.textContent = fmt.num(st.held);
        els.lFree.textContent = fmt.num(st.free);
      }

      function paintFacts(st, chart) {
        UI.tween(els.rev, st.revenue, { format: fmt.copShort, dur: 700 });
        els.revSub.textContent = `${fmt.num(st.sold)} boletas vendidas × su precio, antes de cargos`;
        const t = chart.today;
        els.today.textContent = fmt.num(t.qty);
        els.todayAmt.textContent = fmt.copShort(t.amount) + ' recaudados hoy';
        els.holds.textContent = fmt.num(st.activeHolds);
        els.holdsSub.textContent = st.held ? `${fmt.plural(st.held, 'boleta bloqueada', 'boletas bloqueadas')} mientras pagan` : 'Nadie está pagando en este momento';
        els.court.textContent = fmt.num(st.courtesyUsed);
        els.courtBar.style.setProperty('--p', (st.courtesyQuota ? Math.min(100, (st.courtesyUsed / st.courtesyQuota) * 100) : 0).toFixed(1) + '%');
        const k = saleState(st);
        if (els.state.dataset.k !== k.key) {
          els.state.dataset.k = k.key;
          els.state.classList.toggle('is-out', k.key !== 'on');
          els.state.innerHTML = k.html;
        }
      }

      function paintChart(c) {
        if (els.chart.dataset.sig !== c.sig) {
          els.chart.innerHTML = c.html;
          els.chart.dataset.sig = c.sig;
        }
        els.cTotal.textContent = fmt.num(c.total);
        els.cToday.textContent = fmt.num(c.today.qty);
      }

      function paintOpts(st) {
        const rows = [...els.opts.children];
        const same = rows.length === st.byOption.length && rows.every((r, i) => r.dataset.opt === st.byOption[i].option.id);
        if (!same) {
          els.opts.innerHTML = st.byOption.map((s) => optRow(evId, s)).join('');
          els.optsN.textContent = fmt.plural(st.byOption.length, 'opción de compra', 'opciones de compra');
        }
        st.byOption.forEach((s) => {
          const row = els.opts.querySelector(`[data-opt="${CSS.escape(s.option.id)}"]`);
          if (!row) return;
          const f = (k) => row.querySelector(`[data-f="${k}"]`);
          const a = LocMap.availability(s);
          const av = f('avail');
          av.className = 'opt-avail ' + a.cls;
          av.textContent = a.short;
          av.title = a.text;
          const occP = s.capacity ? (s.occupied / s.capacity) * 100 : 0;
          const heldP = s.capacity ? ((s.held + s.mine) / s.capacity) * 100 : 0;
          f('occ').style.setProperty('--p', occP.toFixed(2) + '%');
          f('held').style.setProperty('--p', heldP.toFixed(2) + '%');
          f('held').classList.toggle('is-some', s.held + s.mine > 0);
          f('pct').textContent = pctTxt(s.pct);
          f('sold').textContent = `${fmt.num(s.sold)} / ${fmt.num(s.capacity)} vendidas${s.courtesy ? ` · ${fmt.num(s.courtesy)} cortesías` : ''}`;
          const proc = s.held + s.mine;
          f('proc').textContent = proc ? `${fmt.num(proc)} en proceso` : 'Sin reservas';
          f('proc').classList.toggle('is-held', proc > 0);
          f('rev').textContent = fmt.copShort(s.revenue);
        });
      }

      let topAt = 0; // hora de la venta más reciente ya pintada: solo lo más nuevo entra animado
      function paintFeed() {
        const items = latest(evId);
        els.feedEmpty.hidden = items.length > 0;
        els.more.hidden = items.length <= 6;
        const first = els.feed.firstElementChild && els.feed.firstElementChild.dataset.k;
        const idx = first ? items.findIndex((e) => feedKey(e) === first) : -1;
        if (idx !== 0) {
          if (idx === -1) {
            els.feed.innerHTML = items.map((e) => feedRow(evId, e, topAt > 0 && e.at > topAt)).join('');
          } else {
            els.feed.insertAdjacentHTML('afterbegin', items.slice(0, idx).map((e) => feedRow(evId, e, true)).join(''));
            while (els.feed.children.length > 12) els.feed.lastElementChild.remove();
          }
        }
        topAt = items.length ? items[0].at : topAt;
        paintMine(items);
      }
      /* La compra hecha en esta sesión queda fija arriba del feed cuando las ventas simuladas
         la empujan fuera de lo visible (6 en celular, 12 en escritorio). */
      const mineBox = q('[data-ov-mine]'), mineList = q('[data-ov-mine-list]');
      const deskMQ = matchMedia('(min-width: 1024px)');
      function paintMine(items) {
        const m = Store.feed(evId, 60).filter((e) => e.mine).sort((a, b) => b.at - a.at)[0];
        const idx = m ? items.findIndex((e) => feedKey(e) === feedKey(m)) : -1;
        const show = !!m && (idx < 0 || idx >= (deskMQ.matches ? 12 : 6));
        mineBox.hidden = !show;
        if (!show) return;
        const k = feedKey(m);
        if (mineList.dataset.k !== k) { mineList.dataset.k = k; mineList.innerHTML = feedRow(evId, m, false); }
      }

      let pico = null;
      function refresh() {
        const st = Store.eventStats(evId);
        const c = chartBlock(evId);
        paintDial(st);
        paintFacts(st, c);
        paintChart(c);
        paintOpts(st);
        paintFeed();
        pico && pico.refresh();
      }
      // pintado inicial (sin animación de cifras)
      (function first() {
        const st = Store.eventStats(evId);
        const c = chartBlock(evId);
        paintDial(st); paintFacts(st, c); paintOpts(st); paintFeed();
      })();

      const schedule = throttled(ctx, 1000, refresh);
      const mine = (e) => !e || !e.eventId || e.eventId === evId;
      ctx.sub('sale', (e) => { if (mine(e)) schedule(); });
      ctx.sub('option', (e) => { if (mine(e)) schedule(); });
      ctx.sub('holds', (e) => { if (mine(e)) schedule(); });
      ctx.sub('courtesy', (e) => { if (mine(e)) schedule(); });
      ctx.sub('config', (e) => { if (mine(e)) schedule(); });
      ctx.sub('hold', schedule);
      ctx.every(5000, schedule); // las reservas también vencen sin evento propio

      els.more.addEventListener('click', () => {
        const open = root.querySelector('.ov-feed').classList.toggle('is-all');
        els.more.setAttribute('aria-expanded', String(open));
        els.more.innerHTML = open ? `Ver menos ${icon('up', 16)}` : `Ver las 12 más recientes ${icon('down', 16)}`;
      });

      pico = mountPico(root, evId, ctx, autostart, refresh);
    }
  });
})();
