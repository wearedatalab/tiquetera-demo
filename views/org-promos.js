/* Organizador · Cortesías y cupones (/org/promos?tab=cortesias|cupones).
   Cortesías: el cupo del evento como una tira de boletas (una por cortesía), emisión con QR
   único que funciona en la puerta y registro de envíos con su estado de ingreso.
   Cupones: lista con usos, alcance, vigencia, estado e interruptor; creación en hoja y prueba
   del código tal como lo valida el checkout del comprador. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;

  const MINUS = '−';
  const REASONS = ['Prensa', 'Patrocinio', 'Artista', 'Invitado especial'];
  const MAX_QTY = 10;
  const ROWS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const SAMPLE_GUESTS = [
    ['Daniel Ospina', 'daniel.ospina@revistaescena.co', 'Prensa'],
    ['Lucía Arango', 'lucia.arango@marcaaliada.co', 'Patrocinio'],
    ['Manuel Quintero', 'manuel.quintero@management.co', 'Artista'],
    ['Gabriela Salazar', 'gabriela.salazar@correo.co', 'Invitado especial']
  ];
  let guestIdx = 0;
  let lastCreated = null;   // último cupón creado en esta sesión (muestra el enlace al checkout)
  let freshCode = null;     // cupón recién guardado (resalta su fila una vez)
  const openSheets = new Set(); // hojas abiertas desde esta vista: se cierran al salir de ella
  function trackSheet(opts) {
    let s = null;
    const onClose = opts.onClose;
    s = UI.sheet(Object.assign({}, opts, { onClose: () => { openSheets.delete(s); if (onClose) onClose(); } }));
    openSheets.add(s);
    return s;
  }

  /* ---------------- Fechas (siempre en hora de Bogotá) ---------------- */
  const todayYMD = () => new Date().toLocaleDateString('en-CA', { timeZone: UI.TZ });
  const ymdIso = (ymd) => ymd + 'T12:00:00-05:00';
  function shortYMD(ymd) {
    const iso = ymdIso(ymd);
    const y = ymd.slice(0, 4);
    return fmt.day(iso) + ' ' + fmt.month(iso) + (y !== todayYMD().slice(0, 4) ? ' ' + y : '');
  }
  const daysTo = (ymd) => Math.ceil((new Date(ymd + 'T23:59:59-05:00').getTime() - Date.now()) / 864e5);
  /* «hoy · 3:40 p. m.», «ayer · …» o «16 oct · …» (fecha visible también en pantallas táctiles). */
  function whenOf(ts) {
    const iso = new Date(ts).toISOString();
    const ymd = new Date(ts).toLocaleDateString('en-CA', { timeZone: UI.TZ });
    const today = todayYMD();
    const yest = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: UI.TZ });
    const day = ymd === today ? 'hoy' : ymd === yest ? 'ayer' : fmt.day(iso) + ' ' + fmt.month(iso);
    return day + ' · ' + fmt.time(iso);
  }

  /* ---------------- Cortesías ---------------- */
  /* Más reciente primero (la semilla no garantiza el orden del arreglo). */
  const courtesiesOf = (evId) => Store.state.courtesies.filter((c) => c.eventId === evId).sort((x, y) => y.createdAt - x.createdAt);
  const usedOf = (evId) => courtesiesOf(evId).reduce((a, c) => a + c.qty, 0);
  const optColor = (evId, optId) => { const o = Store.option(evId, optId); return o ? o.color : 'var(--courtesy)'; };
  function ticketsOf(c) {
    if (!c.codes || !c.codes.length) return [];
    const byCode = new Map(Store.state.tickets.map((t) => [t.code, t]));
    return c.codes.map((k) => byCode.get(k)).filter(Boolean);
  }
  const ingressOf = (c) => ticketsOf(c).filter((t) => t.status === 'used').length;

  /* Rodeo local: las cortesías de la semilla llegan sin boletas (codes: []), así que sus filas no
     tendrían QR hasta que alguien abriera /acceso. Se emiten aquí una sola vez (mismo criterio que la
     vista de acceso: su cupo ya estaba descontado), para que el registro se vea igual desde el inicio. */
  function ensureCourtesyTickets() {
    let changed = false;
    Store.state.courtesies.forEach((c) => {
      if (c.codes && c.codes.length) return;
      const op = Store.option(c.eventId, c.optionId);
      if (!op) return;
      c.codes = [];
      for (let i = 0; i < c.qty; i++) {
        let seatId = null;
        if (op.seating === 'numerada') {
          const idx = (op.seatCursor = op.seatCursor || 0); op.seatCursor++;
          seatId = ROWS[Math.floor(idx / op.perRow) % ROWS.length] + '-' + ((idx % op.perRow) + 1);
        }
        const t = Store.issueTicket({ eventId: c.eventId, optionId: c.optionId, seatId, holder: c.name, type: 'cortesia' });
        t.issuedAt = c.createdAt || t.issuedAt;
        c.codes.push(t.code);
      }
      changed = true;
    });
    if (changed) Store.save();
  }

  function defaultOption(evId) {
    const opts = Store.options(evId);
    let best = null, bestFree = -1;
    opts.forEach((o) => { const f = Store.optionStats(evId, o.id).free; if (f > bestFree) { best = o; bestFree = f; } });
    return best;
  }
  /* Texto del select con la misma disponibilidad que ve el comprador (ámbar = otras personas pagando). */
  function optText(o, s) {
    let tail = '';
    if (s.status === 'process') tail = ` · agotado por ahora (${fmt.num(s.held)} en proceso)`;
    else if (s.status === 'soldout' || s.free <= 0) tail = ' · agotado';
    else if (s.status === 'low') tail = ` · últimas ${fmt.num(s.free)}`;
    return `${o.name} · ${fmt.cop(o.price)}${tail}`;
  }
  const toneOf = (a) => (a.cls === 'is-low' || a.cls === 'is-process' ? 'warn-txt' : a.cls === 'is-soldout' || a.cls === 'is-off' ? 'faint' : '');
  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  function quotaTxt(used, quota) {
    const left = Math.max(0, quota - used);
    return `<span class="pr-nw"><b class="num">${fmt.num(used)}</b> de ${fmt.num(quota)} usadas</span><span class="pr-sep"> · </span><span class="pr-nw pr-left">quedan <b class="num">${fmt.num(left)}</b></span>`;
  }

  function rollHTML(quota) {
    let html = '';
    for (let g = 0; g < Math.ceil(quota / 10); g++) {
      html += '<span class="pr-grp">';
      for (let i = g * 10; i < Math.min(quota, g * 10 + 10); i++) html += '<i class="pr-pip"></i>';
      html += '</span>';
    }
    return html;
  }

  /* Pinta la tira: usadas (color de su opción, en orden de emisión), por emitir (la cantidad del formulario) y libres. */
  function paintRoll(roll, evId, pv, color, newRange) {
    if (!roll) return;
    const seq = [];
    courtesiesOf(evId).slice().reverse().forEach((c) => {
      const col = optColor(evId, c.optionId);
      for (let i = 0; i < c.qty; i++) seq.push(col);
    });
    const pips = roll.querySelectorAll('.pr-pip');
    const used = Math.min(seq.length, pips.length);
    pips.forEach((p, i) => {
      let cls = 'pr-pip', c = null;
      if (i < used) {
        cls += ' is-used'; c = seq[i];
        if (newRange && i >= newRange[0] && i < newRange[1]) { cls += ' is-new'; p.style.setProperty('--d', ((i - newRange[0]) * 45) + 'ms'); }
      } else if (i < used + pv) { cls += ' is-next'; c = color; }
      if (p.className !== cls) p.className = cls;
      if (c) p.style.setProperty('--c', c); else p.style.removeProperty('--c');
    });
    roll.setAttribute('aria-label', `${used} de ${pips.length} cortesías usadas`);
  }

  function legendHTML(evId, pv, color) {
    const ev = Store.event(evId);
    const counts = {};
    courtesiesOf(evId).forEach((c) => { counts[c.optionId] = (counts[c.optionId] || 0) + c.qty; });
    const left = Math.max(0, ev.courtesyQuota - usedOf(evId));
    const items = Store.options(evId, true).filter((o) => counts[o.id])
      .map((o) => `<li><i class="pr-mk" style="--c:${o.color}"></i>${esc(o.name)} <b class="num">${fmt.num(counts[o.id])}</b></li>`);
    Object.keys(counts).forEach((k) => { if (!Store.option(evId, k)) items.push(`<li><i class="pr-mk"></i>Opción retirada <b class="num">${fmt.num(counts[k])}</b></li>`); });
    if (pv > 0) items.push(`<li class="pr-lg-next"><i class="pr-mk is-next" style="--c:${color}"></i>Por emitir <b class="num">${fmt.num(pv)}</b></li>`);
    items.push(`<li><i class="pr-mk is-free"></i>Libres <b class="num">${fmt.num(Math.max(0, left - pv))}</b></li>`);
    return items.join('');
  }

  const inTxt = (inn, qty) => `${inn} de ${qty} ${inn === 1 ? 'ingresó' : 'ingresaron'}`;
  function logRow(c, isNew) {
    const o = Store.option(c.eventId, c.optionId);
    const inn = ingressOf(c);
    const hasTk = ticketsOf(c).length > 0;
    return `<li class="pr-log-row ${isNew ? 'flash' : ''}" data-id="${esc(c.id)}" style="--oc:${o ? o.color : 'var(--courtesy)'}">
      <span class="pr-log-qty" aria-hidden="true"><b class="num">${fmt.num(c.qty)}</b><small>${c.qty === 1 ? 'boleta' : 'boletas'}</small></span>
      <div class="pr-log-body">
        <p class="pr-log-name ellipsis">${esc(c.name)}</p>
        <p class="pr-log-sub ellipsis"><span class="pr-reason">${esc(c.reason)}</span><span aria-hidden="true"> · </span>${esc(o ? o.name : 'Opción retirada')}<span class="sr-only">, ${c.qty === 1 ? '1 boleta' : c.qty + ' boletas'}</span></p>
        <div class="pr-log-meta">
          <time datetime="${new Date(c.createdAt).toISOString()}"><span data-when>${esc(whenOf(c.createdAt))}</span><span class="pr-ago" data-ago> · ${esc(fmt.ago(c.createdAt))}</span></time>
          <span class="pr-in ${inn ? 'is-in' : ''}" data-in>${icon('door', 13)}<span data-in-t>${inTxt(inn, c.qty)}</span></span>
        </div>
      </div>
      ${hasTk ? `<button type="button" class="pr-log-btn" data-view="${esc(c.id)}" aria-label="Ver las boletas de ${esc(c.name)}">${icon('qr', 20)}</button>` : ''}
    </li>`;
  }
  function logHTML(evId, newId) {
    const list = courtesiesOf(evId);
    if (!list.length) {
      return `<li class="pr-empty">${icon('gift', 28)}<p class="strong">Aún no hay cortesías para este evento</p><p class="small">Las que emitas aparecen aquí, con cuántos invitados ya entraron.</p></li>`;
    }
    return list.map((c) => logRow(c, c.id === newId)).join('');
  }
  const logCount = (evId) => {
    const list = courtesiesOf(evId);
    return list.length ? `${fmt.plural(list.length, 'envío', 'envíos')} · ${fmt.plural(usedOf(evId), 'boleta', 'boletas')}` : 'Sin envíos';
  };

  /* ---------------- Cupones ---------------- */
  function couponState(cp) {
    const expired = cp.until && new Date(cp.until + 'T23:59:59-05:00').getTime() < Date.now();
    if (expired) return { key: 'vencido', label: 'Vencido', badge: 'badge-bad' };
    if (cp.used >= cp.limit) return { key: 'agotado', label: 'Agotado', badge: 'badge-warn' };
    if (!cp.active) return { key: 'inactivo', label: 'Inactivo', badge: 'badge-line' };
    return { key: 'activo', label: 'Activo', badge: 'badge-ok' };
  }
  const couponValue = (cp) => (cp.type === 'pct' ? `${MINUS}${fmt.num(cp.value)} %` : `${MINUS}${fmt.cop(cp.value)}`);
  const couponScope = (cp) => (cp.eventIds && cp.eventIds.length
    ? cp.eventIds.map((id) => (Store.event(id) ? Store.event(id).title : id)).join(', ')
    : 'Todos los eventos');
  const activeCoupons = () => Store.state.coupons.filter((c) => couponState(c).key === 'activo').length;

  function couponHTML(cp, evId) {
    const s = couponState(cp);
    const pct = cp.limit ? Math.min(1, cp.used / cp.limit) : 0;
    const left = cp.until ? daysTo(cp.until) : null;
    const soon = s.key === 'activo' && left != null && left <= 14;
    const target = cp.eventIds && cp.eventIds.length ? cp.eventIds[0] : evId;
    const tryLink = lastCreated === cp.code && s.key === 'activo';
    return `<li class="stub-wrap pr-cp is-${s.key}${freshCode === cp.code ? ' is-fresh' : ''}" data-code="${esc(cp.code)}">
      <article class="stub pr-cp-stub" aria-label="Cupón ${esc(cp.code)}, ${esc(s.label)}">
        <div class="pr-cp-l">
          <div class="pr-cp-top"><span class="pr-cp-code">${esc(cp.code)}</span><span class="badge ${s.badge}">${s.label}</span></div>
          <p class="pr-cp-label ellipsis">${esc(cp.label || 'Sin descripción')}</p>
          <div class="pr-cp-use">
            <div class="progress" style="--p:${(pct * 100).toFixed(1)}%;--c:${pct >= 1 ? 'var(--warn)' : 'var(--accent)'}" role="img" aria-label="${fmt.num(cp.used)} de ${fmt.num(cp.limit)} usos"><i></i></div>
            <span class="pr-cp-uses"><b class="num">${fmt.num(cp.used)}</b>/${fmt.num(cp.limit)} usos</span>
          </div>
          <p class="pr-cp-meta">
            <span class="pr-cp-scope">${icon(cp.eventIds ? 'ticket' : 'layers', 14)}<span class="ellipsis">${esc(couponScope(cp))}</span></span>
            <span class="pr-cp-until ${soon ? 'warn-txt' : ''}">${icon('calendar', 14)}${cp.until ? (soon ? (left <= 0 ? 'vence hoy' : `vence en ${fmt.plural(left, 'día', 'días')}`) : 'hasta el ' + esc(shortYMD(cp.until))) : 'sin vencimiento'}</span>
          </p>
          ${tryLink ? `<a class="pr-cp-try" href="#/evento/${esc(target)}">Pruébalo en el checkout ${icon('arrow', 15)}</a>` : ''}
        </div>
        <div class="pr-cp-r">
          <p class="pr-cp-val ${cp.type === 'fixed' ? 'is-fixed' : ''}">${couponValue(cp)}</p>
          <p class="pr-cp-kind">${cp.type === 'pct' ? 'porcentaje' : 'valor fijo'}</p>
          <label class="pr-sw">
            <span class="switch"><input type="checkbox" role="switch" data-toggle="${esc(cp.code)}" ${cp.active ? 'checked' : ''} aria-label="Cupón ${esc(cp.code)} habilitado"><span></span></span>
            <span class="pr-sw-t" aria-hidden="true">${cp.active ? 'Encendido' : 'Apagado'}</span>
          </label>
        </div>
      </article>
    </li>`;
  }
  function couponsListHTML(evId) {
    const list = Store.state.coupons;
    if (!list.length) {
      return `<li class="pr-empty">${icon('tag', 28)}<p class="strong">Aún no hay cupones</p><p class="small">Crea el primero: funciona de inmediato en el checkout.</p></li>`;
    }
    return list.map((cp) => couponHTML(cp, evId)).join('');
  }
  const couponSum = () => {
    const uses = Store.state.coupons.reduce((a, c) => a + c.used, 0);
    return `${fmt.plural(activeCoupons(), 'activo', 'activos')} de ${fmt.num(Store.state.coupons.length)} · ${fmt.plural(uses, 'uso', 'usos')} en total`;
  };

  /* Compra de ejemplo para la prueba del código y la vista previa del descuento.
     Criterio estable (no depende del cupo en vivo): la opción habilitada de mayor capacidad, la más típica. */
  function sampleOf(evId) {
    const opts = Store.options(evId);
    if (!opts.length) return null;
    const o = opts.reduce((a, b) => (b.capacity > a.capacity ? b : a), opts[0]);
    return { opt: o, qty: 2, subtotal: o.price * 2 };
  }
  const discountOf = (type, value, subtotal) => (type === 'pct' ? Math.round((subtotal * value) / 100) : Math.min(subtotal, value));

  const normCode = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, '');
  const codeExists = (c) => Store.state.coupons.some((x) => x.code === c);
  /* nth = cuántas veces se pidió «otro código». Primero la raíz (CUMBIA20K) y luego sufijos
     numéricos legibles (CUMBIA20K2, CUMBIA15-2…) antes de recurrir a letras al azar. */
  function suggestCode(evId, scope, type, value, nth = 0) {
    const base = scope === 'all' ? 'AFORO' : evId.split('-')[0].toUpperCase().slice(0, 8);
    const v = Math.round(Number(value) || 0);
    const suf = type === 'pct' ? String(v || '') : (v >= 1000 ? Math.round(v / 1000) + 'K' : String(v || ''));
    const root = (base + suf).slice(0, 16);
    const stem = root.slice(0, 13) + (/\d$/.test(root.slice(0, 13)) ? '-' : '');
    const cands = [root];
    for (let k = 2; k <= 99; k++) cands.push(stem + k);
    const free = cands.filter((c) => c.length <= 16 && !codeExists(c));
    if (free.length) return free[nth % free.length];
    let c, i = 0;
    do { c = root.slice(0, 13) + UI.code(2); i++; } while (codeExists(c) && i < 20);
    return c;
  }

  /* ---------------- Marcado de la vista ---------------- */
  function headHTML(evId, tab) {
    const ev = Store.event(evId);
    const tabA = (id, label, ic, n, nAttr) => `<a href="#/org/promos?tab=${id}" id="pr-t-${id}" role="tab" data-pr-tab="${id}" aria-controls="pr-tab-${id}" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}" class="${tab === id ? 'is-on' : ''}">${icon(ic, 17)}<span>${label}</span><span class="pr-tab-n" ${nAttr}>${n}</span></a>`;
    return `<header class="pr-head">
      <div class="pr-head-txt">
        <p class="eyebrow">${esc(ev.title)} · <span class="pr-nw">${esc(fmt.date(ev.date))}</span></p>
        <h1 class="h1">Cortesías y cupones</h1>
      </div>
      <div class="seg pr-tabs" role="tablist" aria-label="Promociones">
        ${tabA('cortesias', 'Cortesías', 'gift', `${fmt.num(usedOf(evId))}/${fmt.num(ev.courtesyQuota)}`, 'data-n-cort')}
        ${tabA('cupones', 'Cupones', 'tag', fmt.num(activeCoupons()), 'data-n-cp')}
      </div>
    </header>`;
  }

  function cortesiasHTML(evId) {
    const ev = Store.event(evId);
    const quota = ev.courtesyQuota, used = usedOf(evId);
    const opts = Store.options(evId);
    const def = defaultOption(evId);
    return `
    <section class="panel pr-quota" aria-labelledby="pr-quota-t">
      <div class="pr-quota-txt">
        <p class="eyebrow" id="pr-quota-t">Cupo de cortesías del evento</p>
        <p class="pr-quota-big" aria-live="polite" data-quota-txt>${quotaTxt(used, quota)}</p>
        <p class="pr-quota-note">Cada cortesía descuenta cupo de la opción que elijas, igual que una venta: nunca se cruza con una compra.</p>
      </div>
      <div class="pr-quota-viz">
        <div class="pr-roll" data-roll role="img" aria-label="${used} de ${quota} cortesías usadas">${rollHTML(quota)}</div>
        <ul class="pr-legend" data-legend></ul>
      </div>
    </section>

    <div class="pr-cols">
      <form class="panel pr-form" data-cform novalidate aria-labelledby="pr-form-t">
        <div class="pr-form-head">
          <h2 class="h3" id="pr-form-t">Emitir cortesía</h2>
          <button type="button" class="pr-sample" data-sample>${icon('sparkle', 16)}<span>Datos de ejemplo</span></button>
          <p class="small muted">El invitado recibe sus boletas con QR único por correo.</p>
        </div>
        <p class="pr-lock" data-lock role="status" hidden>${icon('lock', 18)}<span data-lock-t></span></p>
        <fieldset class="pr-fields" data-fields>
        <legend class="sr-only">Datos de la cortesía</legend>
        <div class="pr-fgrid">
          <div class="field">
            <label for="pr-name">Nombre del invitado</label>
            <input id="pr-name" name="name" class="input" autocomplete="off" placeholder="Ej.: Daniel Ospina" maxlength="60">
            <p class="error" data-err="name" hidden></p>
          </div>
          <div class="field">
            <label for="pr-email">Correo</label>
            <input id="pr-email" name="email" type="email" class="input" inputmode="email" autocomplete="off" placeholder="nombre@correo.co" maxlength="80">
            <p class="error" data-err="email" hidden></p>
          </div>
        </div>
        <div class="field">
          <div class="pr-opt-l">
            <label for="pr-opt" class="pr-label">Opción de compra</label>
            <button type="button" class="pr-locbtn" data-locmap-zoom="${esc(evId)}" aria-label="Ver la imagen de ubicaciones del evento">${icon('pin', 16)}<span>Ver ubicaciones</span></button>
          </div>
          ${opts.length
            ? `<select id="pr-opt" class="select" data-opt>${opts.map((o) => { const s = Store.optionStats(evId, o.id); return `<option value="${esc(o.id)}" ${def && def.id === o.id ? 'selected' : ''} ${s.free <= 0 ? 'disabled' : ''}>${esc(optText(o, s))}</option>`; }).join('')}</select>`
            : `<select id="pr-opt" class="select" data-opt disabled><option>Sin opciones habilitadas</option></select>`}
          <p class="hint" data-opt-hint></p>
        </div>
        <div class="pr-qty">
          <div>
            <span class="pr-label" id="pr-qty-l">Cantidad</span>
            <p class="hint">Hasta ${MAX_QTY} boletas por envío</p>
          </div>
          <div class="stepper" role="group" aria-labelledby="pr-qty-l">
            <button type="button" data-step="-1" aria-label="Quitar una boleta">${icon('minus', 18)}</button>
            <output data-qty aria-live="polite">1</output>
            <button type="button" data-step="1" aria-label="Agregar una boleta">${icon('plus', 18)}</button>
          </div>
        </div>
        <fieldset class="pr-reasons">
          <legend class="pr-label">Motivo</legend>
          <div class="pr-chips">${REASONS.map((r) => `<button type="button" class="chip" data-reason="${esc(r)}" aria-pressed="false">${esc(r)}</button>`).join('')}</div>
        </fieldset>
        </fieldset>
        <div class="perf" aria-hidden="true"></div>
        <div class="pr-sum" data-sum></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-submit>${icon('send', 18)} Emitir y enviar</button>
      </form>

      <div class="pr-side">
        <section class="panel pr-log" aria-labelledby="pr-log-t">
          <div class="pr-log-head">
            <h2 class="h3" id="pr-log-t">Cortesías emitidas</h2>
            <span class="pr-log-n mono" data-log-n>${logCount(evId)}</span>
          </div>
          <ul class="pr-log-list" data-log>${logHTML(evId)}</ul>
        </section>
        <section class="panel pr-loc" aria-labelledby="pr-loc-t">
          <div class="pr-loc-in">
            <div class="pr-loc-head">
              <p class="eyebrow" id="pr-loc-t">Ubicaciones del evento</p>
              <p class="small muted">La imagen que publicaste en Espacios: cada opción de compra es una de sus zonas.</p>
              <p class="tiny faint">En las numeradas, la fila y la silla se asignan al emitir.</p>
            </div>
            <div data-locfig>${LocMap.figure(evId, { caption: false, cls: 'pr-loc-fig' })}</div>
          </div>
        </section>
      </div>
    </div>`;
  }

  function cuponesHTML(evId) {
    const ev = Store.event(evId);
    const sample = sampleOf(evId);
    return `
    <div class="pr-cp-grid">
      <div class="pr-cp-side">
        <div class="panel pr-cp-cta">
          <p class="pr-cp-note">${icon('zap', 18)}<span>Un cupón creado aquí funciona de inmediato en el checkout del comprador.</span></p>
          <button type="button" class="btn btn-primary btn-block" data-new-coupon>${icon('plus', 18)} Crear cupón</button>
          <p class="pr-cp-sum mono" data-cp-sum>${couponSum()}</p>
        </div>
        <div class="panel pr-cp-test">
          <p class="eyebrow">Prueba un código</p>
          <p class="small muted">${sample ? `Así lo valida el checkout de ${esc(ev.title)}, con una compra de ejemplo de 2 × ${esc(sample.opt.name)} (${fmt.cop(sample.subtotal)}).` : 'Este evento no tiene opciones de compra habilitadas.'}</p>
          <form class="pr-test-form" data-test novalidate>
            <label class="sr-only" for="pr-test-in">Código del cupón</label>
            <input id="pr-test-in" class="input input-mono" placeholder="AFORO10" autocomplete="off" spellcheck="false" maxlength="16" ${sample ? '' : 'disabled'}>
            <button type="submit" class="btn btn-ink" ${sample ? '' : 'disabled'}>Probar</button>
          </form>
          <div class="pr-test-out" data-test-out aria-live="polite"></div>
          <a class="pr-cp-link" href="#/evento/${esc(evId)}">Abrir la compra de ${esc(ev.title)} ${icon('arrow', 15)}</a>
        </div>
      </div>

      <section class="pr-cp-main" aria-labelledby="pr-cp-t">
        <div class="pr-cp-head">
          <h2 class="h3" id="pr-cp-t">Cupones de la cuenta</h2>
          <p class="small muted">Cada uno aplica según su alcance y vigencia.</p>
        </div>
        <ul class="pr-cp-list" data-cp-list>${couponsListHTML(evId)}</ul>
      </section>
    </div>`;
  }

  /* ---------------- Hoja con las boletas emitidas ---------------- */
  function tkHTML(t, i, n, ev) {
    const used = t.status === 'used';
    return `<div class="stub-wrap pr-tk-wrap"><article class="stub pr-tk" style="--oc:${optColor(t.eventId, t.optionId)}">
      <div class="pr-tk-main">
        <p class="pr-tk-eye"><span class="pr-tk-tag">Cortesía</span><span class="mono">${i + 1} de ${n}</span></p>
        <p class="pr-tk-ev">${esc(ev.title)}</p>
        <p class="pr-tk-loc">${esc(Store.ticketLabel(t))}</p>
        <p class="pr-tk-who">${esc(t.holder)} · ${esc(fmt.date(ev.date))}</p>
        <p class="pr-tk-code mono">${esc(t.code)}</p>
      </div>
      <div class="pr-tk-side">
        ${UI.qr(t.payload, { cls: 'pr-tk-qr' })}
        ${used ? `<span class="pr-tk-used">${icon('check', 13)}Ya ingresó</span>` : `<a class="pr-tk-try" href="#/acceso?code=${encodeURIComponent(t.code)}" data-try="${esc(t.code)}" aria-label="Probar en la puerta la boleta ${esc(t.code)}">Probar ${icon('arrow', 13)}</a>`}
      </div>
    </article></div>`;
  }

  function openTickets(c, tickets, fresh, onClose) {
    if (!tickets.length) return;
    const ev = Store.event(c.eventId);
    const n = tickets.length;
    const firstValid = tickets.find((t) => t.status !== 'used');
    const what = n === 1 ? 'la boleta' : `las ${n} boletas`;
    const body = `
      <p class="pr-sent">${icon('mail', 18)}<span>${fresh
        ? `Enviamos ${what} a <b>${esc(c.email)}</b>. ${n === 1 ? 'Tiene' : 'Cada una tiene'} un QR único y ya funciona en la puerta.`
        : `Enviadas a <b>${esc(c.email)}</b> ${esc(fmt.ago(c.createdAt))} · ${esc(c.reason)}.`}</span></p>
      <div class="pr-tks">${tickets.map((t, i) => tkHTML(t, i, n, ev)).join('')}</div>`;
    const actions = `<button type="button" class="btn btn-line" data-close>Listo</button>${firstValid
      ? `<a class="btn btn-primary" href="#/acceso?code=${encodeURIComponent(firstValid.code)}" data-try="${esc(firstValid.code)}">${icon('scan', 18)} Probar en la puerta</a>`
      : ''}`;
    const title = fresh ? (n === 1 ? 'Cortesía emitida' : `${n} cortesías emitidas`) : `Boletas de ${c.name}`;
    const s = trackSheet({ title, body, actions, wide: n > 1, cls: 'pr-sheet pr-sheet-tk', onClose });
    s.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-try]');
      if (!a) return;
      // La puerta valida contra el evento activo de acceso: lo alineamos con el de esta cortesía.
      try { Store.state.ui.accessEventId = c.eventId; Store.save(); } catch (err) { /* sin persistencia */ }
      s.close();
    });
    return s;
  }

  /* ---------------- Montaje: pestañas ---------------- */
  function mountTabs(root) {
    const tabs = [...root.querySelectorAll('[data-pr-tab]')];
    const select = (t, focus) => {
      tabs.forEach((a) => {
        const on = a.dataset.prTab === t;
        a.classList.toggle('is-on', on);
        a.setAttribute('aria-selected', String(on));
        a.tabIndex = on ? 0 : -1;
        if (on && focus) a.focus();
      });
      root.querySelectorAll('[data-pr-panel]').forEach((p) => { p.hidden = p.dataset.prPanel !== t; });
      try { history.replaceState(null, '', '#/org/promos?tab=' + t); } catch (e) { /* */ }
    };
    tabs.forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); select(a.dataset.prTab); });
      a.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = tabs.indexOf(a);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        select(next.dataset.prTab, true);
      });
    });
  }

  /* ---------------- Montaje: cortesías ---------------- */
  function mountCortesias(root, evId, ctx) {
    const ev = Store.event(evId);
    const form = root.querySelector('[data-cform]');
    if (!form) return;
    const $ = (s) => form.querySelector(s);
    const roll = root.querySelector('[data-roll]');
    const legend = root.querySelector('[data-legend]');
    const quotaEl = root.querySelector('[data-quota-txt]');
    const logEl = root.querySelector('[data-log]');
    const logN = root.querySelector('[data-log-n]');
    const tabN = root.querySelector('[data-n-cort]');
    const sel = $('[data-opt]'), qtyEl = $('[data-qty]'), hint = $('[data-opt-hint]'), sum = $('[data-sum]'), submit = $('[data-submit]');
    const nameIn = $('#pr-name'), mailIn = $('#pr-email');
    const minus = $('[data-step="-1"]'), plus = $('[data-step="1"]');
    const fields = $('[data-fields]'), sampleBtn = $('[data-sample]'), lock = $('[data-lock]'), lockT = $('[data-lock-t]');
    const locFig = root.querySelector('[data-locfig]');
    const hasOpts = Store.options(evId).length > 0;
    const st = { optionId: hasOpts ? sel.value : null, qty: 1, reason: 'Invitado especial' };
    let issuing = false;
    let lastLegend = '';
    let pop = null; // { range:[desde, hasta), until }: boletas recién emitidas que terminan su animación

    const left = () => Math.max(0, ev.courtesyQuota - usedOf(evId));
    const free = () => (st.optionId && Store.option(evId, st.optionId) ? Store.optionStats(evId, st.optionId).free : 0);
    const maxQty = () => Math.min(MAX_QTY, left(), free());

    function paintReasons() {
      form.querySelectorAll('[data-reason]').forEach((b) => {
        const on = b.dataset.reason === st.reason;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }

    const setHTML = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };

    function paint(newRange) {
      if (newRange) pop = { range: newRange, until: Date.now() + 1600 };
      const range = pop && Date.now() < pop.until ? pop.range : null;
      if (pop && !range) pop = null;
      const o = st.optionId ? Store.option(evId, st.optionId) : null;
      const quotaLeft = left();
      const max = maxQty();
      if (st.qty > max) st.qty = Math.max(1, max);
      if (st.qty < 1) st.qty = 1;
      const canIssue = !!o && quotaLeft > 0 && max >= 1;
      // Cupo agotado (o sin opciones): el formulario queda bloqueado, no invita a escribir lo que no se puede enviar.
      const locked = !hasOpts || quotaLeft <= 0;
      fields.disabled = locked;
      sampleBtn.disabled = locked;
      lock.hidden = !locked;
      if (locked) lockT.textContent = !hasOpts
        ? 'Este evento no tiene opciones de compra habilitadas. Agrégalas en Espacios para emitir cortesías.'
        : `Cupo agotado: ya se emitieron las ${fmt.num(ev.courtesyQuota)} cortesías de este evento.`;
      qtyEl.textContent = canIssue ? st.qty : 0;
      minus.disabled = !canIssue || st.qty <= 1;
      plus.disabled = !canIssue || st.qty >= max;
      const pv = canIssue ? st.qty : 0;
      const color = o ? o.color : 'var(--courtesy)';
      paintRoll(roll, evId, pv, color, range);
      const lg = legendHTML(evId, pv, color);
      if (lg !== lastLegend) { legend.innerHTML = lg; lastLegend = lg; }
      if (o) {
        const s = Store.optionStats(evId, o.id);
        const a = LocMap.availability(s);
        setHTML(hint, `Referencia ${fmt.cop(o.price)} c/u · ${esc(LocMap.seatingLabel(o))}${o.seating === 'numerada' ? ' (se asigna al emitir)' : ''} · <span class="pr-nw ${toneOf(a)}">${esc(lowerFirst(a.text))}</span>`);
      } else hint.textContent = 'Agrega opciones de compra en Espacios para poder emitir cortesías.';
      let sumHTML;
      if (!quotaLeft) sumHTML = `<p class="pr-sum-main warn-txt">${icon('alert', 16)} Sin cupo de cortesías para emitir.</p>`;
      else if (!o) sumHTML = `<p class="pr-sum-main">Este evento no tiene opciones de compra habilitadas.</p>`;
      else if (!free()) {
        const s = Store.optionStats(evId, o.id);
        sumHTML = s.status === 'process'
          ? `<p class="pr-sum-main warn-txt">${icon('timer', 16)} Agotado por ahora: otras personas están pagando ${s.held === 1 ? 'la última boleta' : 'las últimas ' + fmt.num(s.held)} de ${esc(o.name)}.</p><p class="pr-sum-sub">Si esas reservas vencen, el cupo se libera. Mientras tanto, elige otra opción.</p>`
          : `<p class="pr-sum-main warn-txt">${icon('alert', 16)} No queda cupo libre en ${esc(o.name)}. Elige otra opción.</p>`;
      } else sumHTML = `<p class="pr-sum-main">Usará <b class="num">${st.qty}</b> del cupo · quedarán <b class="num">${quotaLeft - st.qty}</b></p><p class="pr-sum-sub">Valor de referencia ${fmt.cop(o.price * st.qty)} · el invitado no paga</p>`;
      setHTML(sum, sumHTML);
      submit.disabled = !canIssue;
    }

    function refreshSelect() {
      if (!hasOpts) return;
      [...sel.options].forEach((op) => {
        const o = Store.option(evId, op.value);
        if (!o) return;
        const s = Store.optionStats(evId, o.id);
        const txt = optText(o, s);
        if (op.textContent !== txt) op.textContent = txt;
        op.disabled = s.free <= 0 && op.value !== sel.value;
      });
    }

    /* Registro: se reescribe solo si cambian las filas (nueva cortesía); los refrescos periódicos y los
       ingresos tocan únicamente la hora relativa y el estado de ingreso, así el foco no se pierde. */
    const logIds = () => courtesiesOf(evId).map((c) => c.id).join('|');
    function renderLog(newId) {
      const ids = logIds();
      if (!newId && logEl.dataset.ids === ids) { patchLog(); return; }
      const a = document.activeElement;
      const focusId = a && logEl.contains(a) && a.dataset ? a.dataset.view : null;
      logEl.innerHTML = logHTML(evId, newId);
      logEl.dataset.ids = ids;
      if (focusId) { const b = logEl.querySelector(`[data-view="${CSS.escape(focusId)}"]`); if (b) b.focus({ preventScroll: true }); }
    }
    function patchLog() {
      const byId = new Map(Store.state.courtesies.map((c) => [c.id, c]));
      logEl.querySelectorAll('.pr-log-row').forEach((row) => {
        const c = byId.get(row.dataset.id);
        if (!c) return;
        const ago = row.querySelector('[data-ago]'), when = row.querySelector('[data-when]');
        const inEl = row.querySelector('[data-in]'), inT = row.querySelector('[data-in-t]');
        const tAgo = ' · ' + fmt.ago(c.createdAt), tWhen = whenOf(c.createdAt);
        if (ago && ago.textContent !== tAgo) ago.textContent = tAgo;
        if (when && when.textContent !== tWhen) when.textContent = tWhen;
        const inn = ingressOf(c), tIn = inTxt(inn, c.qty);
        if (inT && inT.textContent !== tIn) inT.textContent = tIn;
        if (inEl) inEl.classList.toggle('is-in', inn > 0);
      });
    }
    logEl.dataset.ids = logIds();

    function refreshAll(newId, newRange) {
      const used = usedOf(evId);
      quotaEl.innerHTML = quotaTxt(used, ev.courtesyQuota);
      if (tabN) tabN.textContent = `${fmt.num(used)}/${fmt.num(ev.courtesyQuota)}`;
      renderLog(newId);
      logN.textContent = logCount(evId);
      refreshSelect();
      paint(newRange);
    }

    const setErr = (k, msg) => {
      const p = form.querySelector(`[data-err="${k}"]`);
      const inp = k === 'name' ? nameIn : mailIn;
      p.textContent = msg; p.hidden = !msg;
      inp.classList.toggle('is-invalid', !!msg);
      inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) { p.id = 'pr-err-' + k; inp.setAttribute('aria-describedby', p.id); } else inp.removeAttribute('aria-describedby');
    };

    if (hasOpts) sel.addEventListener('change', () => { st.optionId = sel.value; paint(); });
    minus.addEventListener('click', () => { st.qty = Math.max(1, st.qty - 1); paint(); });
    plus.addEventListener('click', () => {
      const max = maxQty();
      if (st.qty >= max) {
        UI.toast(st.qty >= MAX_QTY ? `Máximo ${MAX_QTY} boletas por envío.`
          : max === left() ? `Solo quedan ${max} cortesías en el cupo de este evento.` : `Solo quedan ${max} disponibles para esta opción.`, { type: 'warn' });
        return;
      }
      st.qty += 1; paint();
    });
    form.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => { st.reason = b.dataset.reason; paintReasons(); }));
    nameIn.addEventListener('input', () => setErr('name', ''));
    mailIn.addEventListener('input', () => setErr('email', ''));
    sampleBtn.addEventListener('click', () => {
      const [n, m, r] = SAMPLE_GUESTS[guestIdx++ % SAMPLE_GUESTS.length];
      nameIn.value = n; mailIn.value = m; st.reason = r;
      setErr('name', ''); setErr('email', '');
      paintReasons();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameIn.value.trim().replace(/\s+/g, ' ');
      const email = mailIn.value.trim();
      const eName = name.length < 3 ? 'Escribe el nombre del invitado.' : '';
      const eMail = !email ? 'Escribe el correo al que enviaremos las boletas.' : (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? '' : 'Revisa el correo: parece incompleto.');
      setErr('name', eName); setErr('email', eMail);
      if (eName || eMail) { (eName ? nameIn : mailIn).focus(); return; }
      const before = usedOf(evId);
      issuing = true;
      const r = Store.issueCourtesy({ eventId: evId, optionId: st.optionId, qty: st.qty, name, email, reason: st.reason });
      issuing = false;
      if (!r.ok) { UI.toast(r.msg, { type: 'bad' }); refreshSelect(); paint(); return; }
      refreshAll(r.courtesy.id, [before, before + r.courtesy.qty]);
      openTickets(r.courtesy, r.tickets, true);
      nameIn.value = ''; mailIn.value = '';
      st.qty = 1;
      paint();
    });

    logEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b) return;
      const c = Store.state.courtesies.find((x) => x.id === b.dataset.view);
      if (c) openTickets(c, ticketsOf(c), false);
    });

    // La disponibilidad se mueve sola (simulación): refrescos puntuales, como mucho una vez por segundo.
    let dirty = false;
    ctx.sub('option', (p) => { if (p && p.eventId === evId) dirty = true; });
    ctx.sub('config', (p) => {
      if (!p || p.eventId !== evId) return;
      dirty = true;
      if (p.mapImg && locFig) locFig.innerHTML = LocMap.figure(evId, { caption: false, cls: 'pr-loc-fig' });
    });
    ctx.every(1000, () => { if (!dirty) return; dirty = false; refreshSelect(); paint(); });
    ctx.sub('courtesy', (c) => { if (!issuing && c && c.eventId === evId) refreshAll(); });
    ctx.sub('access', () => renderLog());
    ctx.every(30000, () => renderLog()); // «hace N min»

    paintReasons();
    paint();
  }

  /* ---------------- Montaje: cupones ---------------- */
  function openCouponSheet(evId, sample) {
    const ev = Store.event(evId);
    const minD = todayYMD();
    const evDay = ev.date.slice(0, 10);
    const defUntil = evDay >= minD ? evDay : minD;
    const f = { type: 'pct', scope: 'event', touched: false, nth: 0 };
    const body = `<form class="pr-cf" id="pr-cf" novalidate>
      <div class="field">
        <label for="pr-cf-code">Código</label>
        <div class="input-group">
          <input id="pr-cf-code" class="input input-mono" maxlength="16" autocomplete="off" spellcheck="false" autocapitalize="characters" value="${esc(suggestCode(evId, 'event', 'pct', 15))}">
          <button type="button" class="btn btn-line pr-cf-regen" data-regen aria-label="Sugerir otro código">${icon('refresh', 18)}</button>
        </div>
        <p class="hint">Lo sugerimos a partir del evento y el descuento. Puedes cambiarlo.</p>
        <p class="error" data-err="code" hidden></p>
      </div>
      <div class="field">
        <span class="label" id="pr-cf-type-l">Tipo de descuento</span>
        <div class="seg pr-cf-seg" role="group" aria-labelledby="pr-cf-type-l">
          <button type="button" data-type="pct" class="is-on" aria-pressed="true">${icon('percent', 16)} Porcentaje</button>
          <button type="button" data-type="fixed" aria-pressed="false">${icon('tag', 16)} Valor fijo</button>
        </div>
      </div>
      <div class="pr-cf-row">
        <div class="field">
          <label for="pr-cf-val">Valor</label>
          <div class="pr-affix" data-affix>
            <input id="pr-cf-val" class="input num" type="number" inputmode="numeric" min="1" max="90" step="1" value="15">
            <span class="pr-affix-t" data-affix-t aria-hidden="true">%</span>
          </div>
          <p class="error" data-err="val" hidden></p>
        </div>
        <div class="field">
          <label for="pr-cf-limit">Límite de usos</label>
          <input id="pr-cf-limit" class="input num" type="number" inputmode="numeric" min="1" step="1" value="100">
          <p class="error" data-err="limit" hidden></p>
        </div>
      </div>
      <div class="field">
        <span class="label" id="pr-cf-scope-l">Alcance</span>
        <div class="seg pr-cf-seg" role="group" aria-labelledby="pr-cf-scope-l">
          <button type="button" data-scope="event" class="is-on" aria-pressed="true">${icon('ticket', 16)} Solo este evento</button>
          <button type="button" data-scope="all" aria-pressed="false">${icon('layers', 16)} Todos los eventos</button>
        </div>
        <p class="hint" data-scope-hint>Aplica solo a ${esc(ev.title)}.</p>
      </div>
      <div class="pr-cf-row">
        <div class="field">
          <label for="pr-cf-until">Vigente hasta</label>
          <input id="pr-cf-until" class="input" type="date" min="${minD}" value="${defUntil}">
          <p class="error" data-err="until" hidden></p>
        </div>
        <div class="field">
          <label for="pr-cf-label">Nombre interno <span class="faint">(opcional)</span></label>
          <input id="pr-cf-label" class="input" maxlength="48" autocomplete="off" placeholder="Ej.: Aliado emisora">
        </div>
      </div>
      ${sample ? `<p class="pr-cf-preview" data-preview aria-live="polite"></p>` : ''}
    </form>`;
    const actions = `<button type="button" class="btn btn-line" data-close>Cancelar</button><button type="submit" form="pr-cf" class="btn btn-primary">${icon('check', 18)} Guardar cupón</button>`;
    const s = trackSheet({ title: 'Crear cupón', body, actions, cls: 'pr-sheet pr-sheet-cf' });
    const el = s.el;
    const q = (x) => el.querySelector(x);
    const codeIn = q('#pr-cf-code'), valIn = q('#pr-cf-val'), limIn = q('#pr-cf-limit'), untilIn = q('#pr-cf-until'), labelIn = q('#pr-cf-label');
    const affix = q('[data-affix]'), affixT = q('[data-affix-t]'), preview = q('[data-preview]'), scopeHint = q('[data-scope-hint]');

    const setErr = (k, msg) => {
      const p = q(`[data-err="${k}"]`);
      const inp = { code: codeIn, val: valIn, limit: limIn, until: untilIn }[k];
      p.textContent = msg || ''; p.hidden = !msg;
      inp.classList.toggle('is-invalid', !!msg);
      inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) { p.id = 'pr-cf-err-' + k; inp.setAttribute('aria-describedby', p.id); } else inp.removeAttribute('aria-describedby');
    };
    // Cambiar tipo, valor o alcance vuelve a la raíz del código; «otro código» avanza al siguiente sufijo libre.
    const suggest = (next) => {
      if (f.touched && !next) return;
      f.nth = next ? f.nth + 1 : 0;
      codeIn.value = suggestCode(evId, f.scope, f.type, valIn.value, f.nth);
    };
    function paintPreview() {
      if (!preview || !sample) return;
      const v = Number(valIn.value);
      const ok = f.type === 'pct' ? v >= 1 && v <= 90 : v >= 1000;
      if (!ok) { preview.innerHTML = `${icon('info', 16)}<span>Escribe un valor para ver el descuento de ejemplo.</span>`; return; }
      const d = discountOf(f.type, Math.round(v), sample.subtotal);
      preview.innerHTML = `${icon('info', 16)}<span>Ejemplo: en 2 × ${esc(sample.opt.name)} (${fmt.cop(sample.subtotal)}) el comprador ahorra <b>${fmt.cop(d)}</b>.</span>`;
    }
    function setType(t) {
      if (f.type === t) return;
      f.type = t;
      el.querySelectorAll('[data-type]').forEach((b) => { const on = b.dataset.type === t; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      affix.classList.toggle('is-pre', t === 'fixed');
      affixT.textContent = t === 'fixed' ? '$' : '%';
      if (t === 'fixed') { valIn.min = '1000'; valIn.max = '5000000'; valIn.step = '1000'; valIn.value = '20000'; }
      else { valIn.min = '1'; valIn.max = '90'; valIn.step = '1'; valIn.value = '15'; }
      setErr('val', '');
      suggest(); paintPreview();
    }
    function setScope(sc) {
      f.scope = sc;
      el.querySelectorAll('[data-scope]').forEach((b) => { const on = b.dataset.scope === sc; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      scopeHint.textContent = sc === 'all' ? 'Aplica a cualquier evento de la cuenta.' : `Aplica solo a ${ev.title}.`;
      suggest();
    }
    el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
    el.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => setScope(b.dataset.scope)));
    q('[data-regen]').addEventListener('click', () => { f.touched = false; suggest(true); setErr('code', ''); });
    codeIn.addEventListener('input', () => { f.touched = true; setErr('code', ''); });
    valIn.addEventListener('input', () => { setErr('val', ''); suggest(); paintPreview(); });
    limIn.addEventListener('input', () => setErr('limit', ''));
    untilIn.addEventListener('input', () => setErr('until', ''));
    paintPreview();

    q('#pr-cf').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = normCode(codeIn.value);
      const v = Number(valIn.value);
      const lim = Number(limIn.value);
      const errs = {};
      if (!/^[A-Z0-9][A-Z0-9-]{2,15}$/.test(code)) errs.code = 'Usa de 3 a 16 letras o números, sin espacios.';
      else if (codeExists(code)) errs.code = 'Ya existe un cupón con ese código.';
      if (f.type === 'pct' && !(Number.isInteger(v) && v >= 1 && v <= 90)) errs.val = 'Escribe un porcentaje entero entre 1 y 90.';
      if (f.type === 'fixed' && !(v >= 1000 && v <= 5000000)) errs.val = 'Escribe un valor desde $1.000.';
      if (!(Number.isInteger(lim) && lim >= 1 && lim <= 100000)) errs.limit = 'Escribe un límite de al menos 1 uso.';
      if (!untilIn.value || untilIn.value < minD) errs.until = 'La vigencia no puede ser anterior a hoy.';
      ['code', 'val', 'limit', 'until'].forEach((k) => setErr(k, errs[k]));
      const firstBad = ['code', 'val', 'limit', 'until'].find((k) => errs[k]);
      if (firstBad) { ({ code: codeIn, val: valIn, limit: limIn, until: untilIn })[firstBad].focus(); return; }
      lastCreated = code; freshCode = code;
      const cp = Store.upsertCoupon({
        code, label: labelIn.value.trim() || 'Creado desde el panel', type: f.type, value: Math.round(v), limit: lim,
        used: 0, active: true, eventIds: f.scope === 'all' ? null : [evId], until: untilIn.value
      });
      freshCode = null;
      s.close();
      const target = cp.eventIds ? cp.eventIds[0] : evId;
      UI.toast(`Cupón <b>${esc(cp.code)}</b> activo. Pruébalo en el checkout. <a class="pr-toast-link" href="#/evento/${esc(target)}">Ir al evento</a>`, { type: 'ok', html: true, timeout: 7000 });
    });
    return s;
  }

  function mountCupones(root, evId, ctx) {
    const panel = root.querySelector('[data-pr-panel="cupones"]');
    if (!panel) return;
    const list = panel.querySelector('[data-cp-list]');
    const sumEl = panel.querySelector('[data-cp-sum]');
    const tabN = root.querySelector('[data-n-cp]');
    const sample = sampleOf(evId); // una sola compra de ejemplo por evento: la prueba y la hoja dicen lo mismo

    panel.querySelector('[data-new-coupon]').addEventListener('click', () => openCouponSheet(evId, sample));

    list.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-toggle]');
      if (!inp) return;
      const cp = Store.toggleCoupon(inp.dataset.toggle);
      if (!cp) return;
      const s = couponState(cp);
      if (!cp.active) UI.toast(`Cupón ${cp.code} apagado: el checkout ya no lo acepta.`, { type: 'info' });
      else if (s.key === 'activo') UI.toast(`Cupón ${cp.code} encendido: ya funciona en el checkout.`, { type: 'ok' });
      else UI.toast(`Cupón ${cp.code} encendido, pero está ${s.label.toLowerCase()}: no se aplicará.`, { type: 'warn' });
    });

    ctx.sub('coupon', (cp) => {
      if (!cp) return;
      const node = list.querySelector(`[data-code="${CSS.escape(cp.code)}"]`);
      const hadFocus = !!(node && node.contains(document.activeElement));
      if (node) {
        node.insertAdjacentHTML('afterend', couponHTML(cp, evId));
        const fresh = node.nextElementSibling;
        node.remove();
        if (hadFocus) { const i = fresh.querySelector('[data-toggle]'); if (i) i.focus({ preventScroll: true }); }
      } else {
        list.innerHTML = couponsListHTML(evId);
      }
      if (cp.code === freshCode) {
        const n = list.querySelector(`[data-code="${CSS.escape(cp.code)}"]`);
        if (n) ctx.later(320, () => n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      }
      sumEl.textContent = couponSum();
      if (tabN) tabN.textContent = fmt.num(activeCoupons());
    });

    const tf = panel.querySelector('[data-test]');
    const out = panel.querySelector('[data-test-out]');
    tf.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!sample) return;
      const raw = tf.querySelector('input').value;
      if (!raw.trim()) { out.innerHTML = `<p class="pr-test-bad">${icon('alert', 16)}<span>Escribe un código para probarlo.</span></p>`; return; }
      const r = Store.validateCoupon(raw, evId, sample.subtotal);
      if (!r.ok) { out.innerHTML = `<p class="pr-test-bad">${icon('xCircle', 16)}<span>${esc(r.error || 'No se pudo validar.')}</span></p>`; return; }
      out.innerHTML = `<div class="pr-test-ok">
        <p>${icon('checkCircle', 16)}<span><b class="mono">${esc(r.coupon.code)}</b> aplica en este evento.</span></p>
        <dl class="kv pr-test-kv">
          <div><dt>Subtotal de ejemplo</dt><dd>${fmt.cop(sample.subtotal)}</dd></div>
          <div><dt>Descuento${r.coupon.type === 'pct' ? ' del ' + fmt.num(r.coupon.value) + ' %' : ' fijo'}</dt><dd class="ok-txt">${MINUS}${fmt.cop(r.discount)}</dd></div>
          <div class="kv-total"><dt>Total antes del cargo por servicio</dt><dd>${fmt.cop(sample.subtotal - r.discount)}</dd></div>
        </dl>
      </div>`;
    });
  }

  /* ---------------- Vista ---------------- */
  App.view({
    id: 'promos', path: '/org/promos', role: 'org', title: 'Cortesías y cupones',
    render(params, query) {
      const evId = App.orgEvent();
      if (!Store.event(evId)) return `<div class="wrap-wide pr-wrap"><p class="pr-empty">Elige un evento.</p></div>`;
      ensureCourtesyTickets();
      const tab = query.get('tab') === 'cupones' ? 'cupones' : 'cortesias';
      return `<div class="wrap-wide pr-wrap">
        ${headHTML(evId, tab)}
        <section class="pr-panel" id="pr-tab-cortesias" role="tabpanel" aria-labelledby="pr-t-cortesias" data-pr-panel="cortesias" ${tab !== 'cortesias' ? 'hidden' : ''}>${cortesiasHTML(evId)}</section>
        <section class="pr-panel" id="pr-tab-cupones" role="tabpanel" aria-labelledby="pr-t-cupones" data-pr-panel="cupones" ${tab !== 'cupones' ? 'hidden' : ''}>${cuponesHTML(evId)}</section>
      </div>`;
    },
    mount(root, params, ctx) {
      const evId = App.orgEvent();
      if (!Store.event(evId)) return;
      mountTabs(root);
      mountCortesias(root, evId, ctx);
      mountCupones(root, evId, ctx);
      ctx.onLeave(() => {
        lastCreated = null;
        [...openSheets].forEach((s) => s.close());
      });
    }
  });
})();
