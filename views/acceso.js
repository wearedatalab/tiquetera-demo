/* Control de acceso: escáner de la puerta + consola del API (POST /api/v1/accesos).
   Lo usa el personal de puerta en el celular (tema oscuro). Cada lectura —cámara real con jsQR,
   simulada o digitada— llama a Store.validateAccess y muestra la respuesta a pantalla completa. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;
  const D = window.DATA;

  const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  const SCAN_MS = 700;      // animación de lectura simulada
  const SHOW_MS = 2600;     // tiempo en pantalla del resultado
  const ROWS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const calls = [];         // llamadas al API hechas desde este equipo (sesión), para la consola

  const ST = {
    200: { tone: 'ok', http: 'OK', tag: 'Acceso permitido', ico: 'checkCircle' },
    409: { tone: 'warn', http: 'Conflict', tag: 'Ya ingresó', ico: 'alert' },
    404: { tone: 'bad', http: 'Not Found', tag: 'No válida', ico: 'xCircle' },
    422: { tone: 'bad', http: 'Unprocessable Entity', tag: 'Otro evento', ico: 'calendar' },
    410: { tone: 'bad', http: 'Gone', tag: 'Anulada', ico: 'x' }
  };
  const stOf = (s) => ST[s] || ST[404];

  const MODES = {
    idle: ['Listo para leer', 'Usa la cámara, simula una lectura o digita el código'],
    camera: ['Cámara activa', 'Apunta al QR de la boleta'],
    scan: ['Leyendo…', 'Consultando POST /api/v1/accesos'],
    result: ['Respuesta recibida', '']
  };

  /* ---------------- Utilidades ---------------- */
  const curEvent = () => { const id = Store.state.ui.accessEventId; return id && Store.event(id) ? id : D.events[0].id; };
  const curGate = () => (D.gates.includes(Store.state.ui.gate) ? Store.state.ui.gate : D.gates[0]);
  const gateParts = (g) => { const p = String(g || '').split(' · '); return [p[0] || '', p[1] || '']; };
  const hhmm = (clock) => String(clock || '').slice(0, 5);
  const typeLabel = (t) => (t && t.type === 'cortesia' ? 'Cortesía' : 'Venta');
  const isDesk = () => matchMedia('(min-width: 1024px)').matches;
  const srCount = (n) => (n === 1 ? ' ingreso registrado' : ' ingresos registrados');

  /* Saludo neutro: el nombre llega del checkout y no permite deducir el género. */
  const ORG_RX = /^(revista|patrocin|empresa|emisora|prensa|fundaci|agencia|productora|alcald|canal|radio|club|colegio|universidad|grupo|equipo|invitad|medios|comit)/i;
  function greet(name) {
    const first = String(name || '').trim().split(/\s+/)[0] || '';
    return !first || ORG_RX.test(first) ? 'Les damos la bienvenida' : 'Te damos la bienvenida';
  }

  function sampleSeat(op, r) {
    const idx = Math.floor(r() * Math.max(1, op.sold));
    return ROWS[Math.floor(idx / op.perRow) % ROWS.length] + '-' + ((idx % op.perRow) + 1);
  }
  function fakeCode() {
    let c;
    do { c = 'AFR-' + UI.code(4) + '-' + UI.code(4); } while (Store.state.tickets.some((t) => t.code === c));
    return c;
  }
  function formatCode(v) {
    const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return '';
    if ('AFR'.startsWith(s)) return s;
    if (s.startsWith('AFR')) { const r = s.slice(3, 11); return 'AFR-' + r.slice(0, 4) + (r.length > 4 ? '-' + r.slice(4) : ''); }
    return s.slice(0, 13);
  }

  /* Muestras para la simulación (rodeo local: la semilla de la base no trae boletas para todos los
     eventos ni QR para las cortesías sembradas). Coherente con los cupos: las cortesías sembradas ya
     descontaron su cupo y las boletas de muestra representan sillas ya vendidas. */
  function ensureSamples(eventId) {
    const S = Store.state;
    let changed = false;
    S.courtesies.forEach((c) => {
      if (c.codes && c.codes.length) return;
      const op = Store.option(c.eventId, c.optionId);
      if (!op) return;
      c.codes = [];
      for (let i = 0; i < c.qty; i++) {
        const t = Store.issueTicket({ eventId: c.eventId, optionId: c.optionId, seatId: op.seating === 'numerada' ? sampleSeat(op, Math.random) : null, holder: c.name, type: 'cortesia' });
        t.issuedAt = c.createdAt || t.issuedAt;
        c.codes.push(t.code);
      }
      changed = true;
    });
    const ops = Store.options(eventId).filter((o) => o.sold > 0);
    if (ops.length) {
      const r = UI.rng('acceso-muestra|' + eventId);
      const mine = S.tickets.filter((t) => t.eventId === eventId && t.seeded);
      const taken = new Set(mine.map((t) => t.holder));
      const people = D.people.filter((n) => !taken.has(n));
      let need = Math.max(0, 3 - mine.filter((t) => t.status !== 'void').length);
      while (need-- > 0 && people.length) {
        const holder = people.splice(Math.floor(r() * people.length), 1)[0];
        const op = ops[Math.floor(r() * ops.length)];
        const t = Store.issueTicket({ eventId, optionId: op.id, seatId: op.seating === 'numerada' ? sampleSeat(op, r) : null, holder, type: 'venta', price: op.price });
        Object.assign(t, { seeded: true, issuedAt: Date.now() - 864e5 * (2 + Math.floor(r() * 9)) });
        changed = true;
      }
      if (!S.tickets.some((t) => t.eventId === eventId && t.status === 'void')) {
        const holder = people.length ? people[Math.floor(r() * people.length)] : D.people[D.people.length - 1];
        const op = ops[Math.floor(r() * ops.length)];
        const t = Store.issueTicket({ eventId, optionId: op.id, seatId: op.seating === 'numerada' ? sampleSeat(op, r) : null, holder, type: 'venta', price: op.price });
        Object.assign(t, { seeded: true, status: 'void', voidReason: 'Reembolso', issuedAt: Date.now() - 864e5 * 6 });
        changed = true;
      }
    }
    if (changed) Store.save();
  }

  /* ---------------- Resaltado de JSON ---------------- */
  const punct = (x) => esc(x).replace(/([{}[\],])/g, '<span class="ac-p">$1</span>');
  function hl(obj) {
    const s = JSON.stringify(obj, null, 2);
    const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      out += punct(s.slice(last, m.index));
      if (m[1]) out += m[2] ? `<span class="ac-k">${esc(m[1])}</span><span class="ac-p">${esc(m[2])}</span>` : `<span class="ac-s">${esc(m[1])}</span>`;
      else if (m[3]) out += `<span class="ac-b">${m[3]}</span>`;
      else out += `<span class="ac-n">${m[0]}</span>`;
      last = re.lastIndex;
    }
    return out + punct(s.slice(last));
  }
  /* Una línea de bloque por línea de JSON, con sangría colgante: si un valor largo se parte,
     la continuación queda alineada con su clave y no salta a la columna 0. */
  function codeLines(obj) {
    const raw = JSON.stringify(obj, null, 2).split('\n');
    return hl(obj).split('\n').map((h, i) => {
      const ind = ((raw[i] || '').match(/^ */) || [''])[0].length;
      return `<span class="ac-ln" style="--i:${ind}">${h.replace(/^ +/, '')}</span>`;
    }).join('');
  }
  // La línea «POST /api/v1/accesos» se oculta en escritorio: allí ya la muestra el encabezado fijo de la consola.
  const reqHead = () => '<span class="ac-ln ac-rl"><span class="ac-m">POST</span> <span class="ac-u">/api/v1/accesos</span></span>'
    + '<span class="ac-ln ac-auth"><span class="ac-hk">Authorization:</span> Bearer <span class="ac-mask">disp_puerta_••••••</span></span>';

  const legendHtml = () => `<ul class="ac-codes" aria-label="Códigos de respuesta">
      ${[[200, 'Permitido'], [409, 'Ya ingresó'], [404, 'No válida'], [422, 'Otro evento'], [410, 'Anulada']].map(([c, l]) => `<li data-tone="${stOf(c).tone}"><i></i><b>${c}</b>${l}</li>`).join('')}
    </ul>`;

  function chipHtml(call) {
    if (!call) return '<span class="ac-chip">Sin llamadas</span>';
    if (call.pending) return '<span class="ac-chip is-pending">En curso…</span>';
    const s = stOf(call.status);
    return `<span class="ac-chip" data-tone="${s.tone}">${call.status} · ${call.ms} ms</span>`;
  }

  function callHtml(call, latest = true) {
    if (!call) {
      const req = { codigo: 'AFR-XXXX-XXXX', evento: curEvent(), puerta: curGate(), firma: 'XXXXXX' };
      return `<div class="ac-code-sec">
          <p class="ac-code-label">Petición</p>
          <pre class="ac-code mono is-template">${reqHead()}${codeLines(req)}</pre>
        </div>
        <div class="ac-code-sec ac-resp">
          <p class="ac-code-label">Respuesta</p>
          <p class="ac-wait">Esperando la primera lectura. Si la boleta es válida, el API responde 200 y la marca como usada en ese mismo instante: un segundo intento con el mismo QR devuelve 409, en cualquier puerta.</p>
        </div>
        ${legendHtml()}`;
    }
    const s = stOf(call.status);
    const resp = call.pending
      ? `<p class="ac-wait"><span class="ac-dots" aria-hidden="true"><i></i><i></i><i></i></span>Esperando respuesta…</p>`
      : `<pre class="ac-code mono"><span class="ac-ln ac-st" data-tone="${s.tone}">HTTP/1.1 ${call.status} ${s.http}</span>${codeLines(call.body)}</pre>`;
    const hist = latest ? '' : `<div class="ac-hist" role="note">
        ${icon('clock', 15)}<span>Estás viendo la llamada de las <b class="mono">${fmt.clock(call.at)}</b>, no la más reciente.</span>
        <button type="button" class="ac-hist-btn" data-ac-latest>Ver la última</button>
      </div>`;
    return `${hist}<div class="ac-code-sec">
        <p class="ac-code-label">Petición <span class="ac-code-time mono">${call.at ? fmt.clock(call.at) : 'ahora'}</span></p>
        <pre class="ac-code mono">${reqHead()}${codeLines(call.request.cuerpo)}</pre>
      </div>
      <div class="ac-code-sec ac-resp" data-ac-resp>
        <p class="ac-code-label">Respuesta ${call.pending ? '' : `<span class="ac-code-time mono">${call.ms} ms · application/json</span>`}</p>
        ${resp}
      </div>`;
  }

  /* ---------------- Bitácora ---------------- */
  /* Evento en el que estaba el escáner al hacer la lectura. Store guarda en entry.eventId el evento
     de la boleta (en un 422 es otro), así que cada lectura de esta vista se marca con scanEventId.
     Las lecturas antiguas sin marca: 200/409/410/404 comparten evento; un 422 sin marca se omite. */
  const scanEventOf = (a) => a.scanEventId || (a.status === 422 ? null : a.eventId);
  function logData(eventId) {
    const S = Store.state;
    const local = S.accesses.filter((a) => scanEventOf(a) === eventId).map((a) => Object.assign({}, a));
    const seen = new Set(S.accesses.filter((a) => a.status === 200).map((a) => a.code));
    const remote = [];
    S.tickets.forEach((t) => {
      if (t.eventId === eventId && t.status === 'used' && t.usedAt && !seen.has(t.code)) {
        remote.push({ at: t.usedAt, code: t.code, status: 200, gate: t.gate, eventId: t.eventId, holder: t.holder, label: Store.ticketLabel(t), type: t.type, remote: true });
      }
    });
    const all = local.concat(remote).sort((a, b) => b.at - a.at);
    return { list: all.slice(0, 16), local: local.length, total: all.length };
  }
  function logRow(a, selAt) {
    const s = stOf(a.status);
    const call = !a.remote && calls.find((c) => c.at === a.at && c.code === a.code);
    const sel = call && selAt != null && a.at === selAt;
    const who = a.holder ? esc(a.holder) : `<span class="mono">${esc(a.code || '—')}</span>`;
    let what;
    switch (a.status) {
      case 200: what = esc(a.label || 'Ingreso registrado'); break;
      case 409: what = 'Intento repetido'; break;
      case 422: { const ev = Store.event(a.eventId); what = 'Boleta de ' + esc(ev ? ev.title : 'otro evento'); break; }
      case 410: what = 'Boleta anulada'; break;
      default: what = a.holder ? 'QR alterado · firma inválida' : 'Código no reconocido';
    }
    const tag = call ? 'button' : 'div';
    return `<li><${tag} class="ac-log-row${sel ? ' is-sel' : ''}" data-tone="${s.tone}" ${call ? `type="button" data-call="${a.at}"` : ''}${sel ? ' aria-current="true"' : ''}>
      <span class="ac-log-code mono">${a.status}</span>
      <span class="ac-log-body">
        <span class="ac-log-who">${who}</span>
        <span class="ac-log-what">${what}</span>
        <span class="ac-log-gate">${esc(a.gate || 'Sin puerta')}${a.remote ? ' · otro equipo' : ''}</span>
      </span>
      <span class="ac-log-time mono">${fmt.clock(a.at)}${call ? `<span class="ac-log-see">${icon('code', 14)}<span class="sr-only">Ver la llamada al API</span></span>` : ''}</span>
    </${tag}></li>`;
  }
  function logHtml(eventId, selAt, data) {
    const { list } = data || logData(eventId);
    if (!list.length) return `<li class="ac-log-empty">${icon('door', 22)}<span>Aún no hay lecturas de este evento en este equipo. Simula una para empezar el turno.</span></li>`;
    return list.map((a) => logRow(a, selAt)).join('');
  }
  function logLabel(d) {
    if (!d.total) return 'Turno nuevo';
    return d.local ? fmt.plural(d.local, 'lectura', 'lecturas') : fmt.plural(d.total, 'registro', 'registros');
  }

  /* ---------------- Resultado a pantalla completa ---------------- */
  function stubHtml(t, { showHolder = true, ev = null } = {}) {
    const parts = String(t.code).split('-');
    return `<div class="stub-wrap ac-res-stubw"><div class="stub ac-res-stub">
      <div class="ac-res-stub-l">
        ${ev ? `<span class="eyebrow">${esc(ev.title)}</span>` : ''}
        ${showHolder ? `<span class="ac-res-holder">${esc(t.holder)}</span>` : ''}
        <span class="ac-res-loc">${esc(Store.ticketLabel(t))}</span>
        <span class="ac-res-type ${t.type === 'cortesia' ? 'is-court' : ''}">${typeLabel(t)}</span>
      </div>
      <div class="ac-res-stub-r mono" aria-label="Código ${esc(t.code)}"><span>${esc(parts[0] + '-' + (parts[1] || ''))}</span><span>${esc(parts[2] || '')}</span></div>
    </div></div>`;
  }
  function resultHtml(res, p, gate, switched) {
    const s = stOf(res.status), t = res.ticket, b = res.body || {};
    let title = '', sub = '', note = '', extra = '';
    if (res.status === 200) {
      title = `<span class="ac-res-greet">${greet(t.holder)},</span>${esc(t.holder)}`;
      sub = `Ingreso registrado a las ${esc(hhmm(b.ingreso && b.ingreso.hora))} · ${esc(gate)}`;
      extra = stubHtml(t, { showHolder: false });
    } else if (res.status === 409) {
      const ing = b.ingreso || {};
      title = `Ya ingresó a las ${esc(hhmm(ing.hora))}`;
      sub = `por <b>${esc(ing.puerta || 'otra puerta')}</b>`;
      note = 'No permitas un segundo ingreso. Si la persona insiste, llama a supervisión.';
      extra = stubHtml(t);
    } else if (res.status === 422) {
      const ev = Store.event(t.eventId);
      title = 'Boleta de otro evento';
      sub = `Es para <b>${esc(ev.title)}</b> · ${esc(fmt.dateLong(ev.date))} · ${esc(Store.venueOf(ev.id).name)}`;
      note = 'Indícale a la persona la fecha y el lugar de su evento.';
      extra = stubHtml(t, { ev });
    } else if (res.status === 410) {
      title = 'Boleta anulada';
      sub = 'Se anuló por reembolso o cambio de titular.';
      note = 'Envía a la persona a taquilla.';
      extra = stubHtml(t);
    } else {
      const altered = p.sig && Store.state.tickets.some((x) => x.code === p.code);
      title = 'Boleta no válida';
      sub = altered ? 'El QR fue alterado: la firma no coincide con la boleta emitida.' : 'El código no corresponde a ninguna boleta emitida.';
      note = 'No permitas el ingreso.';
      extra = `<p class="ac-res-code mono">${esc(p.code || 'Sin código')}</p>`;
    }
    const swEv = switched && Store.event(switched);
    return `<div class="ac-res-in">
        ${swEv ? `<p class="ac-res-switch">${icon('refresh', 15)}<span>Escáner cambiado a <b>${esc(swEv.title)}</b>, el evento de esta boleta</span></p>` : ''}
        <div class="ac-res-head">
          <span class="ac-res-ico">${icon(s.ico, 60)}</span>
          <p class="ac-res-tag mono">${esc(s.tag)} · HTTP ${res.status} · ${res.ms} ms</p>
        </div>
        <h2 class="ac-res-title">${title}</h2>
        <p class="ac-res-sub">${sub}</p>
        ${note ? `<p class="ac-res-note">${icon('door', 18)}<span>${esc(note)}</span></p>` : ''}
        <div class="ac-res-foot">
          ${extra}
          <button class="ac-res-next" type="button" data-ac-next>Siguiente lectura ${icon('arrow', 18)}</button>
        </div>
      </div>
      <span class="ac-res-timer" aria-hidden="true"><i></i></span>`;
  }

  /* ---------------- Hoja «Simular lectura» ---------------- */
  function ticketChip(t) {
    if (t.status === 'used') return `<span class="badge badge-warn">Ingresó ${esc(hhmm(fmt.clock(t.usedAt)))}</span>`;
    if (t.status === 'void') return '<span class="badge badge-bad">Anulada</span>';
    return '<span class="badge badge-ok">Sin usar</span>';
  }
  function pickHtml(payload, { name, sub, code, chip }) {
    return `<li><button class="ac-pick" type="button" data-pick="${esc(payload)}">
      <span class="ac-pick-qr" aria-hidden="true">${UI.qr(payload)}</span>
      <span class="ac-pick-body">
        <span class="ac-pick-name">${esc(name)}</span>
        <span class="ac-pick-sub">${esc(sub)}</span>
        <span class="ac-pick-code mono">${esc(code)}</span>
      </span>
      ${chip}
    </button></li>`;
  }
  function ticketPick(t, eventId) {
    const ev = Store.event(t.eventId);
    return pickHtml(t.payload, { name: t.holder, sub: Store.ticketLabel(t) + (t.eventId !== eventId ? ' · ' + ev.title : ''), code: t.code, chip: ticketChip(t) });
  }
  const statusRank = (t) => ({ valid: 0, used: 1, void: 2 })[t.status] || 0;

  function simBody(eventId) {
    const S = Store.state;
    const ev = Store.event(eventId);
    const mine = Store.myTickets().slice().sort((a, b) => (a.eventId === eventId ? 0 : 1) - (b.eventId === eventId ? 0 : 1) || statusRank(a) - statusRank(b));
    // solo las cortesías del evento del escáner, una boleta por invitado (se emiten en grupo)
    const byHolder = new Map();
    S.tickets.filter((t) => t.type === 'cortesia' && t.eventId === eventId)
      .sort((a, b) => statusRank(a) - statusRank(b))
      .forEach((t) => { if (!byHolder.has(t.holder)) byHolder.set(t.holder, t); });
    const cort = [...byHolder.values()].slice(0, 4);
    const seeded = S.tickets.filter((t) => t.seeded && t.eventId === eventId).sort((a, b) => statusRank(a) - statusRank(b)).slice(0, 6);
    const other = S.tickets.find((t) => t.eventId !== eventId && t.seeded && t.status === 'valid') || S.tickets.find((t) => t.eventId !== eventId);
    const base = seeded.find((t) => t.status === 'valid') || seeded[0];
    const fake = fakeCode();
    let forged = null;
    if (base) {
      const realSig = base.payload.split('|')[3];
      let sg; do { sg = UI.code(6); } while (sg === realSig);
      forged = `AFORO|${base.code}|${base.eventId}|${sg}`;
    }
    const group = (title, note, items) => `<section class="ac-group">
        <h3 class="ac-group-h"><span class="eyebrow">${title}</span>${note ? `<span class="ac-group-n">${note}</span>` : ''}</h3>
        <ul>${items}</ul>
      </section>`;

    return `<p class="small muted ac-sheet-lead">Elige la boleta que la persona acerca al lector. La lectura llama al API igual que la cámara y queda en la bitácora.</p>
      ${group('Tus boletas', mine.length ? fmt.plural(mine.length, 'boleta', 'boletas') : '',
        mine.length ? mine.slice(0, 6).map((t) => ticketPick(t, eventId)).join('')
          : `<li class="ac-pick-empty">${icon('ticket', 20)}<span>Aún no has comprado boletas en esta sesión. <a href="#/evento/${esc(eventId)}" data-close>Compra una</a> y su QR funcionará aquí.</span></li>`)}
      ${group('Cortesías emitidas', cort.length ? esc(ev.title) : '',
        cort.length ? cort.map((t) => ticketPick(t, eventId)).join('')
          : `<li class="ac-pick-empty">${icon('gift', 20)}<span>${esc(ev.title)} aún no tiene cortesías emitidas. <a href="#/org/promos?tab=cortesias" data-close data-org-ev="${esc(eventId)}">Emite una</a> desde el panel y su QR funcionará aquí.</span></li>`)}
      ${seeded.length ? group('Otras boletas del evento', esc(ev.title), seeded.map((t) => ticketPick(t, eventId)).join('')) : ''}
      ${other ? group('Boleta de otro evento', '', ticketPick(other, eventId)) : ''}
      ${group('Código falso', '',
        pickHtml(`AFORO|${fake}|${eventId}|${UI.code(6)}`, { name: 'Código inventado', sub: 'QR que no corresponde a ninguna boleta', code: fake, chip: '<span class="badge badge-bad">Falso</span>' }) +
        (forged ? pickHtml(forged, { name: 'QR copiado con otra firma', sub: 'Boleta real de ' + base.holder + ' alterada', code: base.code, chip: '<span class="badge badge-bad">Alterado</span>' }) : ''))}`;
  }

  /* ---------------- Vista ---------------- */
  App.view({
    id: 'acceso', path: '/acceso', role: 'access', title: 'Control de acceso',
    render() {
      const id = curEvent(), g = curGate();
      const ev = Store.event(id);
      const st = Store.eventStats(id);
      const [g1, g2] = gateParts(g);
      return `<div class="wrap-wide ac">
        <h1 class="sr-only">Escáner de acceso · ${esc(ev.title)}</h1>
        <div class="ac-layout">
          <section class="ac-main" aria-label="Escáner de boletas">
            <div class="ac-setup">
              <div class="ac-field ac-ev">
                <label for="ac-ev" class="ac-ev-l">Evento</label>
                <span class="ac-meta" id="ac-ev-meta" data-ac-meta title="${esc(metaOf(id))}">${esc(metaOf(id))}</span>
                <select id="ac-ev" class="select ac-select" data-ac-ev aria-describedby="ac-ev-meta">
                  ${D.events.map((e) => `<option value="${esc(e.id)}" ${e.id === id ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}
                </select>
              </div>
              <div class="ac-field ac-gate">
                <div class="ac-field-head"><span class="ac-lbl" id="ac-gate-l">Puerta de este equipo</span></div>
                <div class="seg ac-gates" role="group" aria-labelledby="ac-gate-l">
                  ${D.gates.map((x) => { const [a, b] = gateParts(x); return `<button type="button" data-ac-gate="${esc(x)}" class="${x === g ? 'is-on' : ''}" aria-pressed="${x === g}"><b>${esc(a)}</b><small>${esc(b)}</small></button>`; }).join('')}
                </div>
              </div>
              <div class="ac-count" data-ac-count>
                <span class="ac-count-l" aria-hidden="true">Ingresos registrados</span>
                <span class="ac-count-v"><span class="ac-count-n" aria-live="polite" aria-atomic="true"><b class="mono num" data-ac-n>${fmt.num(Store.accessCount(id))}</b><span class="sr-only" data-ac-n-sr>${srCount(Store.accessCount(id))}</span></span> <span data-ac-m>de ${fmt.num(st.sold + st.courtesy)}</span></span>
              </div>
            </div>

            <div class="ac-stage" data-ac-stage>
              <div class="ac-viewer" data-ac-viewer data-state="idle">
                <video class="ac-video" playsinline muted autoplay hidden></video>
                <div class="ac-hud" aria-hidden="true">
                  <span class="ac-mode"><i></i><span data-ac-mode>${MODES.idle[0]}</span></span>
                  <span data-ac-hud-gate>${esc(g1)}${g2 ? ' · ' + esc(g2) : ''}</span>
                </div>
                <div class="ac-target" aria-hidden="true">
                  <div class="ac-ghost">${UI.qr('AFORO|DEMO-AFORO|lector|000000', { dark: 'currentColor', light: 'transparent' })}</div>
                  <div class="ac-card" data-ac-card hidden></div>
                  <span class="ac-corner tl"></span><span class="ac-corner tr"></span><span class="ac-corner bl"></span><span class="ac-corner br"></span>
                  <span class="ac-sweep"></span>
                </div>
                <p class="ac-hint" data-ac-hint>${MODES.idle[1]}</p>
              </div>
              <div class="ac-result" data-ac-result role="status" hidden></div>
            </div>

            <div class="ac-actions">
              <button class="btn btn-primary btn-lg" type="button" data-ac-cam>${icon('camera', 20)}<span data-ac-cam-l>Usar cámara</span></button>
              <button class="btn btn-ink btn-lg" type="button" data-ac-sim>${icon('qr', 20)}<span>Simular lectura</span></button>
              <button class="btn btn-line btn-lg" type="button" data-ac-type>${icon('keyboard', 20)}<span>Digitar código</span></button>
            </div>
          </section>

          <aside class="ac-side" aria-label="Llamada al API y bitácora">
            <section class="ac-api" data-ac-api>
              <button class="ac-api-toggle" type="button" aria-expanded="false" aria-controls="ac-api-body" data-ac-api-toggle>
                ${icon('code', 18)}<span class="ac-api-tl" data-ac-api-tl>Ver llamada al API</span>
                <span data-ac-api-chip>${chipHtml(calls[0])}</span>
                ${icon('down', 18, 'ac-chev')}
              </button>
              <header class="ac-api-head">
                <div>
                  <p class="eyebrow" data-ac-api-eb>Consola del API</p>
                  <p class="ac-api-ep mono"><span class="ac-m">POST</span> /api/v1/accesos</p>
                </div>
                <span data-ac-api-chip2>${chipHtml(calls[0])}</span>
              </header>
              <div class="ac-api-body" id="ac-api-body" data-ac-api-body>${callHtml(calls[0])}</div>
            </section>

            <section class="ac-log" aria-labelledby="ac-log-h">
              <header class="ac-log-head">
                <h2 class="h3" id="ac-log-h">Bitácora de ingresos</h2>
                <span class="eyebrow" data-ac-log-n></span>
              </header>
              <ol class="ac-log-list" data-ac-log>${logHtml(id, null)}</ol>
            </section>
          </aside>
        </div>
      </div>`;
    },

    mount(root, params, ctx, query) {
      const el = root.querySelector('.ac');
      if (!el) return;
      const $ = (s) => el.querySelector(s);
      const stage = $('[data-ac-stage]'), viewer = $('[data-ac-viewer]'), video = $('.ac-video'), card = $('[data-ac-card]');
      const modeEl = $('[data-ac-mode]'), hintEl = $('[data-ac-hint]'), hudGate = $('[data-ac-hud-gate]');
      const resEl = $('[data-ac-result]'), camBtn = $('[data-ac-cam]'), simBtn = $('[data-ac-sim]'), typeBtn = $('[data-ac-type]');
      const api = $('[data-ac-api]'), apiBody = $('[data-ac-api-body]'), apiToggle = $('[data-ac-api-toggle]');
      const chip1 = $('[data-ac-api-chip]'), chip2 = $('[data-ac-api-chip2]');
      const logEl = $('[data-ac-log]'), logN = $('[data-ac-log-n]'), countEl = $('[data-ac-count]');
      const sel = $('[data-ac-ev]'), metaEl = $('[data-ac-meta]');

      let alive = true, busy = false, resultOpen = false, closeT = 0, hideT = 0, lastTrigger = null, sheet = null;
      const timers = new Set();
      const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; };

      ensureSamples(curEvent());

      /* ---- Estado del visor ---- */
      function setMode(mode) {
        viewer.dataset.state = mode;
        modeEl.textContent = MODES[mode][0];
        hintEl.textContent = MODES[mode][1];
      }
      function showCard(payload, code, source) {
        if (source === 'camara') { card.hidden = true; card.innerHTML = ''; return; }
        card.classList.toggle('is-typed', source === 'typed');
        card.innerHTML = source === 'typed'
          ? `${icon('keyboard', 22)}<span class="mono">${esc(code)}</span>`
          : UI.qr(payload);
        card.hidden = false;
      }

      /* ---- Contador y bitácora ---- */
      const nEl = countEl.querySelector('[data-ac-n]'), mEl = countEl.querySelector('[data-ac-m]'), nSr = countEl.querySelector('[data-ac-n-sr]');
      // el verde del número dura solo lo que dura el salto (va en los keyframes); luego se quita la clase
      nEl.addEventListener('animationend', () => countEl.classList.remove('is-bump'));
      function updateCount(bump) {
        const id = curEvent(), st = Store.eventStats(id);
        const n = Store.accessCount(id);
        const nTxt = fmt.num(n), mTxt = 'de ' + fmt.num(st.sold + st.courtesy);
        if (nEl.textContent !== nTxt) {
          nEl.textContent = nTxt;
          nSr.textContent = srCount(n);
          if (bump) { countEl.classList.remove('is-bump'); void countEl.offsetWidth; countEl.classList.add('is-bump'); }
          else countEl.classList.remove('is-bump');
        }
        if (mEl.textContent !== mTxt) mEl.textContent = mTxt;
      }
      // M (vendidas + cortesías) cambia con las ventas simuladas: se actualiza como máximo una vez por segundo
      let mT = 0;
      const refreshCount = () => { if (!mT) mT = later(1000, () => { mT = 0; updateCount(false); }); };
      ctx.sub('sale', (e) => { if (!e || e.eventId === curEvent()) refreshCount(); });
      ctx.sub('courtesy', (c) => { if (!c || c.eventId === curEvent()) refreshCount(); });

      let selAt = null; // lectura antigua elegida en la bitácora (null = la más reciente)
      function markSel() {
        logEl.querySelectorAll('[data-call]').forEach((b) => {
          const on = selAt != null && b.dataset.call === String(selAt);
          b.classList.toggle('is-sel', on);
          if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        });
      }
      function renderLog() {
        const d = logData(curEvent());
        logEl.innerHTML = logHtml(curEvent(), selAt, d);
        logN.textContent = logLabel(d);
      }
      renderLog();

      /* ---- Consola del API ---- */
      const ebEl = $('[data-ac-api-eb]'), tlEl = $('[data-ac-api-tl]');
      function apiTitle() {
        const open = api.classList.contains('is-open');
        const old = selAt != null ? 'Llamada de las ' + fmt.clock(selAt) : '';
        ebEl.textContent = old || 'Consola del API';               // escritorio: encabezado fijo
        tlEl.textContent = open ? 'Llamada al API' : 'Ver llamada al API'; // celular: el aviso va dentro del cuerpo
      }
      function renderCall(call, fresh) {
        const latest = !call || call.pending || call === calls[0];
        selAt = latest ? null : call.at;
        apiBody.innerHTML = callHtml(call, latest);
        chip1.innerHTML = chipHtml(call);
        chip2.innerHTML = chipHtml(call);
        apiTitle();
        markSel();
        if (fresh && !call.pending) {
          const r = apiBody.querySelector('[data-ac-resp]');
          if (r) r.classList.add('flash');
          // en escritorio la consola es un panel fijo: deja a la vista la respuesta recién llegada
          // (si es una llamada antigua, arriba: ahí está el aviso con «Ver la última»)
          if (isDesk()) {
            if (latest && apiBody.scrollHeight > apiBody.clientHeight) apiBody.scrollTo({ top: apiBody.scrollHeight, behavior: 'smooth' });
            else apiBody.scrollTop = 0;
          }
          [chip1, chip2].forEach((c) => { c.classList.remove('ac-chip-pop'); void c.offsetWidth; c.classList.add('ac-chip-pop'); });
        }
      }
      function setApiOpen(open) {
        api.classList.toggle('is-open', open);
        apiToggle.setAttribute('aria-expanded', String(open));
        apiTitle();
      }
      apiToggle.addEventListener('click', () => setApiOpen(!api.classList.contains('is-open')));
      apiBody.addEventListener('click', (e) => { if (e.target.closest('[data-ac-latest]') && calls[0]) renderCall(calls[0], true); });

      /* ---- Lectura ---- */
      function read(text, source, trigger, opts = {}) {
        if (busy || !alive) return false;
        busy = true;
        lastTrigger = trigger || null;
        const eventId = curEvent(), gate = curGate();
        const p = Store.parseCode(text);
        const cuerpo = { codigo: p.code, evento: eventId, puerta: gate };
        if (p.sig) cuerpo.firma = p.sig;
        renderCall({ pending: true, request: { cuerpo } });
        showCard(text, p.code, source);
        setMode('scan');
        later(source === 'camara' ? 240 : SCAN_MS, () => {
          const res = Store.validateAccess(text, { eventId, gate });
          const entry = Store.state.accesses[0];
          // la bitácora filtra por el evento en el que estaba el escáner (en un 422 entry.eventId es el de la boleta)
          if (entry) { entry.scanEventId = eventId; Store.save(); }
          const call = { at: entry ? entry.at : Date.now(), code: p.code, status: res.status, ms: res.ms, request: res.request, body: res.body };
          calls.unshift(call);
          if (calls.length > 40) calls.length = 40;
          renderCall(call, true);
          showResult(res, p, gate, opts.switched);
          renderLog();
          updateCount(true);
        });
        return true;
      }

      function showResult(res, p, gate, switched) {
        const s = stOf(res.status);
        clearTimeout(hideT);
        resEl.classList.remove('is-out');
        resEl.dataset.tone = s.tone;
        resEl.innerHTML = resultHtml(res, p, gate, switched);
        resEl.hidden = false;
        resultOpen = true;
        setMode('result');
        try { if (navigator.vibrate) navigator.vibrate(s.tone === 'ok' ? 90 : [70, 50, 70]); } catch (e) { /* sin vibración */ }
        const next = resEl.querySelector('[data-ac-next]');
        if (next) next.focus({ preventScroll: true });
        clearTimeout(closeT);
        closeT = later(SHOW_MS, closeResult);
      }
      function closeResult() {
        if (!resultOpen) return;
        resultOpen = false;
        clearTimeout(closeT);
        const hadFocus = resEl.contains(document.activeElement);
        resEl.classList.add('is-out');
        hideT = later(180, () => { resEl.hidden = true; resEl.classList.remove('is-out'); resEl.innerHTML = ''; });
        card.hidden = true; card.innerHTML = '';
        busy = false;
        setMode(cam.stream ? 'camera' : 'idle');
        if (hadFocus && lastTrigger) lastTrigger.focus({ preventScroll: true });
      }
      resEl.addEventListener('click', closeResult);
      const onKey = (e) => { if (e.key === 'Escape' && resultOpen) closeResult(); };
      document.addEventListener('keydown', onKey);

      function revealStage() {
        const r = stage.getBoundingClientRect();
        const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--demo-h')) + 60;
        if (r.top < top || r.bottom > innerHeight) stage.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }

      /* ---- Cámara real (jsQR) ---- */
      const cam = { stream: null, raf: 0, last: 0, text: '', at: 0, starting: false };
      const canvas = document.createElement('canvas');
      let c2d = null;
      function setCamBtn(state) {
        const l = camBtn.querySelector('[data-ac-cam-l]');
        camBtn.disabled = state === 'loading';
        camBtn.classList.toggle('btn-primary', state !== 'on');
        camBtn.classList.toggle('btn-line', state === 'on');
        camBtn.querySelector('.ico').outerHTML = icon(state === 'on' ? 'x' : 'camera', 20);
        l.textContent = state === 'on' ? 'Detener cámara' : state === 'loading' ? 'Abriendo cámara…' : 'Usar cámara';
      }
      function hintSim() {
        simBtn.classList.remove('is-hint'); void simBtn.offsetWidth; simBtn.classList.add('is-hint');
        later(3600, () => simBtn.classList.remove('is-hint'));
      }
      function camFail(name) {
        const msg = {
          NotAllowedError: 'No tenemos permiso para usar la cámara. Actívalo en el navegador o prueba con «Simular lectura».',
          SecurityError: 'El navegador bloqueó la cámara en esta página. Prueba con «Simular lectura».',
          NotFoundError: 'No encontramos una cámara en este equipo. Prueba con «Simular lectura».',
          OverconstrainedError: 'No encontramos una cámara compatible en este equipo. Prueba con «Simular lectura».',
          NotReadableError: 'Otra aplicación está usando la cámara. Ciérrala o prueba con «Simular lectura».',
          unsupported: 'Este navegador no permite abrir la cámara aquí. Prueba con «Simular lectura».',
          script: 'No pudimos cargar el lector de QR. Revisa la conexión o prueba con «Simular lectura».'
        }[name] || 'No pudimos abrir la cámara. Prueba con «Simular lectura».';
        UI.toast(msg, { type: 'warn', timeout: 5200 });
        hintSim();
      }
      async function startCamera() {
        if (cam.stream || cam.starting) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camFail('unsupported'); return; }
        cam.starting = true; setCamBtn('loading');
        try { await UI.loadScript(JSQR_URL); }
        catch (e) { cam.starting = false; if (alive) { setCamBtn('off'); camFail('script'); } return; }
        if (!alive) { cam.starting = false; return; }
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        } catch (e) {
          cam.starting = false;
          if (alive) { setCamBtn('off'); camFail(e && e.name); }
          return;
        }
        cam.starting = false;
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        cam.stream = stream;
        video.srcObject = stream;
        video.hidden = false;
        try { await video.play(); } catch (e) { /* autoplay: se reproduce al primer gesto */ }
        viewer.dataset.cam = '1';
        if (!busy) setMode('camera');
        setCamBtn('on');
        UI.toast('Cámara activa: acerca el QR de la boleta al recuadro.', { type: 'ok' });
        loop();
      }
      function loop() {
        cam.raf = requestAnimationFrame(loop);
        const t = performance.now();
        if (t - cam.last < 140 || !window.jsQR || video.readyState < 2) return;
        cam.last = t;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        const k = Math.min(1, 640 / Math.max(vw, vh));
        const w = Math.round(vw * k), h = Math.round(vh * k);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; c2d = null; }
        c2d = c2d || canvas.getContext('2d', { willReadFrequently: true });
        c2d.drawImage(video, 0, 0, w, h);
        let found = null;
        try { found = window.jsQR(c2d.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); } catch (e) { found = null; }
        /* Presencia: el mismo QR no se vuelve a leer mientras siga frente a la cámara;
           hay que retirarlo (≈1,2 s sin verlo) para que cuente como un intento nuevo. */
        const now = Date.now();
        if (found && found.data) {
          if (found.data === cam.text) { cam.at = now; return; }
          if (busy) return;
          cam.text = found.data; cam.at = now;
          read(found.data, 'camara', camBtn);
        } else if (cam.text && now - cam.at > 1200) {
          cam.text = '';
        }
      }
      function stopCamera() {
        cancelAnimationFrame(cam.raf);
        if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
        cam.stream = null;
        video.srcObject = null;
        video.hidden = true;
        delete viewer.dataset.cam;
        if (alive) { setCamBtn('off'); if (!busy) setMode('idle'); }
      }

      /* ---- Hojas ---- */
      function openSim() {
        if (busy && !resultOpen) return;
        if (resultOpen) closeResult();
        const id = curEvent();
        ensureSamples(id);
        sheet = UI.sheet({ title: 'Simular lectura', cls: 'ac-sheet', body: simBody(id), onClose: () => { sheet = null; } });
        sheet.el.addEventListener('click', (e) => {
          // «Emite una»: el panel abre en el mismo evento del escáner
          const org = e.target.closest('[data-org-ev]');
          if (org) { Store.state.ui.orgEventId = org.dataset.orgEv; Store.save(); return; }
          const b = e.target.closest('[data-pick]');
          if (!b) return;
          const payload = b.dataset.pick;
          sheet.close();
          revealStage();
          later(300, () => read(payload, 'sim', simBtn));
        });
      }
      function openType() {
        if (busy && !resultOpen) return;
        if (resultOpen) closeResult();
        const id = curEvent();
        ensureSamples(id);
        const sample = Store.state.tickets.find((t) => t.eventId === id && t.status === 'valid');
        const s = UI.sheet({
          title: 'Digitar código', cls: 'ac-sheet ac-sheet-type',
          body: `<form class="ac-type" data-ac-form novalidate>
              <div class="field">
                <label for="ac-code">Código impreso debajo del QR</label>
                <input id="ac-code" class="input input-mono ac-type-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="13" placeholder="AFR-XXXX-XXXX" aria-describedby="ac-code-hint ac-code-err">
                <p class="hint" id="ac-code-hint">Para cuando el QR no se deja leer: pantalla rota, poco brillo o boleta impresa arrugada.</p>
                <p class="error" id="ac-code-err" data-ac-err hidden></p>
              </div>
              ${sample ? `<div class="ac-type-sample"><span class="small muted">¿Sin boleta a mano? Usa este código de ejemplo:</span><button type="button" class="ac-type-fill mono" data-fill="${esc(sample.code)}" aria-label="Usar el código de ejemplo ${esc(sample.code)}">${esc(sample.code)}</button></div>` : ''}
            </form>`,
          actions: `<button class="btn btn-line" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" data-ac-submit>${icon('send', 18)}Validar</button>`
        });
        const input = s.el.querySelector('#ac-code'), err = s.el.querySelector('[data-ac-err]');
        const setErr = (m) => { err.innerHTML = m ? esc(m).replace('AFR-XXXX-XXXX', '<span class="mono ac-nowrap">AFR-XXXX-XXXX</span>') : ''; err.hidden = !m; input.classList.toggle('is-invalid', !!m); input.setAttribute('aria-invalid', m ? 'true' : 'false'); };
        input.addEventListener('input', () => { const v = formatCode(input.value); if (v !== input.value) input.value = v; if (!err.hidden) setErr(''); });
        const submit = () => {
          const v = formatCode(input.value);
          if (!/^AFR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v)) { setErr('Escribe el código completo con el formato AFR-XXXX-XXXX.'); input.focus(); return; }
          s.close();
          revealStage();
          later(300, () => read(v, 'typed', typeBtn));
        };
        s.el.querySelector('[data-ac-form]').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
        s.el.querySelector('[data-ac-submit]').addEventListener('click', submit);
        const fill = s.el.querySelector('[data-fill]');
        if (fill) fill.addEventListener('click', () => { input.value = fill.dataset.fill; setErr(''); input.focus(); });
        sheet = s;
      }

      /* ---- Controles ---- */
      function setEvent(id) {
        Store.state.ui.accessEventId = id; Store.save();
        if (sel.value !== id) sel.value = id;
        metaEl.textContent = metaOf(id);
        metaEl.title = metaOf(id);
        el.querySelector('h1').textContent = 'Escáner de acceso · ' + Store.event(id).title;
        ensureSamples(id);
        updateCount(false);
        renderLog();
        if (!calls.length) renderCall(null);
      }
      sel.addEventListener('change', () => setEvent(sel.value));
      el.querySelector('.ac-gates').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ac-gate]');
        if (!b) return;
        Store.state.ui.gate = b.dataset.acGate; Store.save();
        el.querySelectorAll('[data-ac-gate]').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
        hudGate.textContent = b.dataset.acGate;
        if (!calls.length) renderCall(null);
      });
      camBtn.addEventListener('click', () => { if (cam.stream) stopCamera(); else startCamera(); });
      simBtn.addEventListener('click', openSim);
      typeBtn.addEventListener('click', openType);
      logEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-call]');
        if (!b) return;
        const call = calls.find((c) => String(c.at) === b.dataset.call);
        if (!call) return;
        renderCall(call, true);
        if (!isDesk()) { setApiOpen(true); api.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      });

      ctx.onLeave(() => {
        alive = false;
        timers.forEach(clearTimeout); timers.clear();
        document.removeEventListener('keydown', onKey);
        stopCamera();
        if (sheet) sheet.close();
      });

      /* ---- ?code= desde «Probar en la puerta»: una sola validación automática ---- */
      const qcode = query && query.get('code');
      if (qcode) {
        history.replaceState(null, '', '#/acceso');
        const p = Store.parseCode(qcode);
        const t = Store.state.tickets.find((x) => x.code === p.code);
        // si la boleta es de otro evento, el escáner cambia y el aviso va dentro del propio resultado (no un toast encima)
        let switched = null;
        if (t && t.eventId !== curEvent()) { setEvent(t.eventId); switched = t.eventId; }
        later(380, () => { revealStage(); read(t ? t.payload : qcode, 'sim', null, { switched }); });
      }
    }
  });

  function metaOf(id) {
    const ev = Store.event(id);
    return `${fmt.date(ev.date)} · abre ${ev.doors} · ${Store.venueOf(id).name}`;
  }
})();
