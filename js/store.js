/* Estado del demo: opciones de compra (cupos) por evento, reservas temporales por cantidad,
   órdenes, boletas, cupones, cortesías, accesos y notificaciones. Persistido en localStorage.
   Simula a «otros compradores» para que la disponibilidad y los tableros se muevan solos.

   Sin doble venta: el cupo libre de una opción = capacidad − vendidas − cortesías − en reserva.
   Nadie puede apartar más de lo libre, y la silla (si la opción es numerada) se asigna de forma
   atómica al confirmar el pago, en orden de compra. */
(function () {
  'use strict';
  const { rng, hash, code, pick, uid } = UI;
  const KEY = 'aforo-demo-v2';
  const D = window.DATA;
  const now = () => Date.now();
  const ROWS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* ---------------- Estado persistido ---------------- */
  let S = load();
  function freshOptions() {
    const out = {};
    D.events.forEach((ev) => {
      out[ev.id] = ev.options.map((o) => {
        const sold = Math.round(o.capacity * o.soldPct);
        return { id: o.id, name: o.name, note: o.note, seating: o.seating, perRow: o.perRow || 20, price: o.price, capacity: o.capacity, color: o.color, enabled: true, sold, courtesy: 0, seatCursor: sold };
      });
    });
    return out;
  }
  function fresh() {
    return {
      v: 2,
      createdAt: now(),
      options: freshOptions(), // options[ev] = [{ id, name, note, seating, perRow, price, capacity, color, enabled, sold, courtesy, seatCursor }]
      mapImg: {},              // mapImg[ev] = dataURL subido por el organizador (reemplaza la imagen del evento)
      hold: null,              // mi reserva: { eventId, items:[{ optionId, qty }], until, orderId|null, startedAt }
      orders: [],
      tickets: [],
      coupons: JSON.parse(JSON.stringify(D.coupons)),
      courtesies: [],
      accesses: [],
      notifications: [],
      feed: {},                // feed[ev] = [{ at, qty, optionId, amount, buyer, channel, kind }]
      today: {},               // today[ev] = { qty, amount }
      ui: { orgEventId: 'cumbia-electrica', gate: D.gates[0], accessEventId: 'cumbia-electrica' }
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.v === 2) return s; }
    } catch (e) { /* almacenamiento bloqueado: el demo funciona en memoria */ }
    return null;
  }
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(S)); }
      catch (e) { // si la imagen subida no cabe, se conserva solo en memoria
        try { const copy = Object.assign({}, S, { mapImg: {} }); localStorage.setItem(KEY, JSON.stringify(copy)); } catch (e2) { /* sin persistencia */ }
      }
    }, 150);
  }

  /* ---------------- Pub/sub ---------------- */
  const subs = {};
  function on(type, fn) { (subs[type] = subs[type] || new Set()).add(fn); return () => subs[type].delete(fn); }
  /* Se itera una copia: un suscriptor que re-renderiza (y se re-suscribe) no puede crear un ciclo infinito. */
  function emit(type, payload) {
    [...(subs[type] || [])].forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
    [...(subs['*'] || [])].forEach((fn) => { try { fn(type, payload); } catch (e) { console.error(e); } });
  }

  /* ---------------- Catálogo ---------------- */
  const event = (id) => D.events.find((e) => e.id === id);
  const venue = (id) => D.venues[id];
  const venueOf = (eventId) => venue(event(eventId).venueId);
  const mapImg = (eventId) => S.mapImg[eventId] || event(eventId).mapImg;

  /* Opciones de compra del evento (all=true incluye las deshabilitadas, para el editor). */
  function options(eventId, all = false) {
    return (S.options[eventId] || []).filter((o) => all || o.enabled);
  }
  function option(eventId, optionId) { return (S.options[eventId] || []).find((o) => o.id === optionId) || null; }
  function minPrice(eventId) { const p = options(eventId).map((o) => o.price); return p.length ? Math.min(...p) : 0; }

  /* ---------------- Reservas temporales (en memoria) ---------------- */
  // pending[ev][opt] = [{ sid, by:'me'|'other', qty, until }]
  const pending = {};
  const others = new Map(); // sid → { sid, eventId, optionId, qty, buyer, stage, gateway, startedAt, until, sellP }
  const pz = (ev, o) => ((pending[ev] = pending[ev] || {})[o] = pending[ev][o] || []);

  function syncMine() {
    Object.keys(pending).forEach((ev) => Object.keys(pending[ev]).forEach((o) => { pending[ev][o] = pending[ev][o].filter((h) => h.by !== 'me'); }));
    if (!S.hold) return;
    S.hold.items.forEach((i) => pz(S.hold.eventId, i.optionId).push({ sid: 'me', by: 'me', qty: i.qty, until: S.hold.until }));
  }

  /* ---------------- Disponibilidad ---------------- */
  function optionStats(eventId, optionId) {
    const o = option(eventId, optionId);
    const st = { capacity: o.capacity, sold: Math.min(o.sold, o.capacity), courtesy: o.courtesy, held: 0, mine: 0, free: 0, price: o.price };
    const t = now();
    pz(eventId, optionId).forEach((h) => { if (h.until > t) st[h.by === 'me' ? 'mine' : 'held'] += h.qty; });
    st.free = Math.max(0, o.capacity - st.sold - st.courtesy - st.held - st.mine);
    st.occupied = st.sold + st.courtesy;
    st.pct = o.capacity ? st.occupied / o.capacity : 0;
    st.revenue = st.sold * o.price;
    // estado comercial para el comprador
    if (!o.enabled) st.status = 'off';
    else if (st.free <= 0 && st.held > 0) st.status = 'process';   // agotado por ahora: hay gente pagando
    else if (st.free <= 0) st.status = 'soldout';
    else if (st.free <= Math.max(10, o.capacity * 0.05)) st.status = 'low';
    else st.status = 'ok';
    return st;
  }

  function eventStats(eventId) {
    const byOption = options(eventId).map((o) => Object.assign({ option: o }, optionStats(eventId, o.id)));
    const sum = (k) => byOption.reduce((a, b) => a + b[k], 0);
    const ev = event(eventId);
    const courtesyUsed = S.courtesies.filter((c) => c.eventId === eventId).reduce((a, c) => a + c.qty, 0);
    return {
      capacity: sum('capacity'), sold: sum('sold'), courtesy: sum('courtesy'), held: sum('held') + sum('mine'),
      free: sum('free'), revenue: sum('revenue'), occupied: sum('occupied'),
      pct: sum('capacity') ? sum('occupied') / sum('capacity') : 0,
      byOption, courtesyQuota: ev.courtesyQuota, courtesyUsed,
      today: S.today[eventId] || { qty: 0, amount: 0 },
      activeHolds: activeHolds(eventId).length
    };
  }

  /* ---------------- Mi reserva ---------------- */
  function myHold() {
    if (S.hold && S.hold.until < now()) expireHold();
    return S.hold;
  }
  const holdCount = () => (S.hold ? S.hold.items.reduce((a, i) => a + i.qty, 0) : 0);
  const myQty = (eventId, optionId) => {
    if (!S.hold || S.hold.eventId !== eventId) return 0;
    const it = S.hold.items.find((i) => i.optionId === optionId);
    return it ? it.qty : 0;
  };

  /* Fija la cantidad que aparto de una opción (0 = quitar). → { ok, msg, reason } */
  function setQty(eventId, optionId, qty) {
    qty = Math.max(0, Math.floor(qty || 0));
    if (S.hold && S.hold.orderId) return { ok: false, reason: 'en-pago', msg: 'Tienes un pago en curso. Termínalo o cancélalo primero.' };
    if (S.hold && S.hold.eventId !== eventId && qty > 0) return { ok: false, reason: 'otro-evento', msg: 'Tienes boletas apartadas en otro evento.' };
    const cur = myQty(eventId, optionId);
    const st = optionStats(eventId, optionId);
    const otherItems = holdCount() - cur;
    if (qty > cur && qty - cur > st.free) {
      return st.held > 0 && st.free === 0
        ? { ok: false, reason: 'en-proceso', msg: `Las últimas boletas de ${option(eventId, optionId).name} las está pagando otra persona. Si su reserva vence, se liberan.` }
        : { ok: false, reason: 'sin-cupo', msg: st.free ? `Solo quedan ${st.free} en ${option(eventId, optionId).name}.` : `${option(eventId, optionId).name} está agotada.` };
    }
    if (otherItems + qty > D.maxPerOrder) return { ok: false, reason: 'maximo', msg: `Máximo ${D.maxPerOrder} boletas por compra.` };
    if (qty === 0) {
      if (S.hold) S.hold.items = S.hold.items.filter((i) => i.optionId !== optionId);
      if (S.hold && !S.hold.items.length) S.hold = null;
    } else {
      if (!S.hold) S.hold = { eventId, items: [], until: now() + D.holdSeconds * 1000, orderId: null, startedAt: now() };
      const it = S.hold.items.find((i) => i.optionId === optionId);
      if (it) it.qty = qty; else S.hold.items.push({ optionId, qty });
    }
    syncMine();
    save();
    emit('option', { eventId, optionId });
    emit('hold', S.hold);
    return { ok: true };
  }
  function clearHold(reason) {
    if (!S.hold) return;
    const h = S.hold;
    if (h.orderId) {
      const o = S.orders.find((x) => x.id === h.orderId);
      if (o && o.status === 'pending') { o.status = reason === 'expired' ? 'expired' : 'cancelled'; emit('order', o); }
    }
    S.hold = null;
    syncMine();
    save();
    h.items.forEach((it) => emit('option', { eventId: h.eventId, optionId: it.optionId }));
    emit('hold', null);
    if (reason === 'expired') notify({ channel: 'push', title: 'Tu reserva expiró', body: 'Liberamos las boletas que tenías apartadas para que otras personas puedan comprarlas.' });
  }
  function expireHold() { clearHold('expired'); emit('hold-expired', {}); }

  /* ---------------- Cupones ---------------- */
  function validateCoupon(rawCode, eventId, subtotal) {
    const c = String(rawCode || '').trim().toUpperCase();
    if (!c) return { ok: false, error: '' };
    const cp = S.coupons.find((x) => x.code === c);
    if (!cp) return { ok: false, error: 'Ese cupón no existe.' };
    if (!cp.active) return { ok: false, error: 'Este cupón está desactivado.' };
    if (cp.used >= cp.limit) return { ok: false, error: `Cupón agotado (${cp.used}/${cp.limit} usos).` };
    if (cp.until && new Date(cp.until + 'T23:59:59-05:00').getTime() < now()) return { ok: false, error: 'Este cupón está vencido.' };
    if (cp.eventIds && !cp.eventIds.includes(eventId)) return { ok: false, error: 'Este cupón no aplica para este evento.' };
    const discount = cp.type === 'pct' ? Math.round((subtotal * cp.value) / 100) : Math.min(subtotal, cp.value);
    return { ok: true, coupon: cp, discount };
  }
  function upsertCoupon(c) {
    const code = String(c.code).trim().toUpperCase();
    const i = S.coupons.findIndex((x) => x.code === code);
    const base = { label: '', type: 'pct', value: 10, limit: 100, used: 0, active: true, eventIds: null, until: '2026-12-31' };
    const next = Object.assign({}, base, i >= 0 ? S.coupons[i] : {}, c, { code });
    if (i >= 0) S.coupons[i] = next; else S.coupons.unshift(next);
    save(); emit('coupon', next);
    return next;
  }
  function toggleCoupon(code) {
    const cp = S.coupons.find((x) => x.code === code);
    if (cp) { cp.active = !cp.active; save(); emit('coupon', cp); }
    return cp;
  }

  /* ---------------- Cotización de la reserva ---------------- */
  function quote(couponCode) {
    const h = myHold();
    if (!h) return null;
    const lines = h.items.map((it) => {
      const o = option(h.eventId, it.optionId);
      return { optionId: it.optionId, name: o.name, note: o.note, seating: o.seating, qty: it.qty, price: o.price, amount: o.price * it.qty, color: o.color };
    });
    const subtotal = lines.reduce((a, l) => a + l.amount, 0);
    const cv = couponCode ? validateCoupon(couponCode, h.eventId, subtotal) : { ok: false, error: '' };
    const discount = cv.ok ? cv.discount : 0;
    const fee = Math.round(((subtotal - discount) * D.serviceFee) / 100) * 100;
    return { eventId: h.eventId, lines, qty: holdCount(), subtotal, discount, fee, total: subtotal - discount + fee, coupon: cv.ok ? cv.coupon : null, couponError: cv.ok ? '' : cv.error, until: h.until };
  }

  /* ---------------- Órdenes y pago ---------------- */
  function createOrder({ buyer, coupon, gateway, method }) {
    const h = myHold();
    if (!h) return null;
    const q = quote(coupon);
    const order = {
      id: 'ORD-' + code(6), eventId: h.eventId, items: JSON.parse(JSON.stringify(h.items)), lines: q.lines,
      buyer, coupon: q.coupon ? q.coupon.code : null, subtotal: q.subtotal, discount: q.discount, fee: q.fee, total: q.total,
      gateway, method, status: 'pending', createdAt: now(), paidAt: null, ref: String(hash(uid('ref')) % 90000000 + 10000000)
    };
    S.orders.unshift(order);
    h.orderId = order.id;
    h.until = Math.max(h.until, now() + 10 * 60 * 1000); // la pasarela tiene 10 minutos
    syncMine();
    save();
    emit('order', order); emit('hold', S.hold);
    notify({ channel: 'push', orderId: order.id, title: 'Reserva confirmada', body: `Apartamos ${q.qty === 1 ? 'tu boleta' : 'tus ' + q.qty + ' boletas'} por 10 minutos mientras completas el pago.` });
    return order;
  }
  /* El comprador cancela el pago en curso: la reserva vuelve a «eligiendo». */
  function cancelPayment() {
    if (!S.hold || !S.hold.orderId) return;
    const o = S.orders.find((x) => x.id === S.hold.orderId);
    if (o && o.status === 'pending') { o.status = 'cancelled'; emit('order', o); }
    S.hold.orderId = null; save(); emit('hold', S.hold);
  }

  function seatFor(o) {
    const idx = o.seatCursor++;
    const row = ROWS[Math.floor(idx / o.perRow) % ROWS.length];
    return row + '-' + ((idx % o.perRow) + 1);
  }

  function confirmPayment(orderId, approved = true) {
    const o = S.orders.find((x) => x.id === orderId);
    if (!o || o.status !== 'pending') return o;
    const ev = event(o.eventId);
    if (!approved) {
      o.status = 'failed';
      if (S.hold && S.hold.orderId === orderId) S.hold.orderId = null;
      save(); emit('order', o); emit('hold', S.hold);
      notify({ channel: 'email', orderId, title: 'Pago rechazado', body: `${D.gateways.find((g) => g.id === o.gateway).name} rechazó la transacción. Tus boletas siguen apartadas hasta que venza la reserva.` });
      return o;
    }
    o.status = 'paid'; o.paidAt = now();
    o.items.forEach((it) => {
      const op = option(o.eventId, it.optionId);
      op.sold += it.qty;
      for (let i = 0; i < it.qty; i++) issueTicket({ eventId: o.eventId, optionId: it.optionId, seatId: op.seating === 'numerada' ? seatFor(op) : null, holder: o.buyer.name, orderId, type: 'venta', price: op.price });
    });
    if (o.coupon) { const cp = S.coupons.find((c) => c.code === o.coupon); if (cp) cp.used++; }
    S.hold = null; syncMine();
    const qty = o.items.reduce((a, i) => a + i.qty, 0);
    pushFeed(o.eventId, { qty, optionId: o.items[0].optionId, amount: o.total, buyer: shortName(o.buyer.name), channel: 'web', kind: 'venta', mine: true });
    save();
    emit('order', o); emit('hold', null);
    o.items.forEach((it) => emit('option', { eventId: o.eventId, optionId: it.optionId }));
    emit('sale', { eventId: o.eventId, qty, amount: o.total, mine: true });
    notify({ channel: 'email', orderId, title: 'Compra confirmada · ' + ev.title, body: `Hola ${o.buyer.name.split(' ')[0]}, adjuntamos ${qty === 1 ? 'tu boleta' : 'tus ' + qty + ' boletas'} con código QR único. Orden ${o.id}.` });
    notify({ channel: 'whatsapp', orderId, title: 'aforo', body: `¡Listo! ${qty === 1 ? 'Tu boleta' : 'Tus ' + qty + ' boletas'} para ${ev.title} ${qty === 1 ? 'está' : 'están'} en «Mis boletas». Presenta el QR en la puerta.` });
    return o;
  }

  /* ---------------- Boletas ---------------- */
  const sig = (c, ev) => hash(c + '|' + ev + '|aforo-secreto').toString(36).slice(0, 6).toUpperCase();
  function issueTicket({ eventId, optionId, seatId, holder, orderId, type, price }) {
    const c = 'AFR-' + code(4) + '-' + code(4);
    const t = { code: c, payload: `AFORO|${c}|${eventId}|${sig(c, eventId)}`, eventId, optionId, seatId: seatId || null, holder, orderId: orderId || null, type, price: price || 0, status: 'valid', issuedAt: now(), usedAt: null, gate: null };
    S.tickets.unshift(t);
    emit('ticket', t);
    return t;
  }
  const ticketsFor = (orderId) => S.tickets.filter((t) => t.orderId === orderId).reverse(); // en orden de emisión
  const myTickets = () => S.tickets.filter((t) => t.orderId && S.orders.some((o) => o.id === t.orderId));
  function ticketLabel(t) {
    const o = option(t.eventId, t.optionId);
    const name = o ? o.name : 'Boleta';
    if (!t.seatId) return name + ' · Acceso general';
    const [row, n] = t.seatId.split('-');
    return `${name} · Fila ${row} · Silla ${n}`;
  }

  /* ---------------- API de acceso (POST /api/v1/accesos) ---------------- */
  function parseCode(raw) {
    const s = String(raw || '').trim();
    if (s.startsWith('AFORO|')) { const [, c, ev, sg] = s.split('|'); return { code: c, eventId: ev, sig: sg }; }
    return { code: s.toUpperCase(), eventId: null, sig: null };
  }
  function validateAccess(raw, { eventId, gate } = {}) {
    const p = parseCode(raw);
    const ms = Math.round(38 + Math.random() * 46);
    const request = { metodo: 'POST', ruta: '/api/v1/accesos', cuerpo: { codigo: p.code, evento: eventId, puerta: gate } };
    if (p.sig) request.cuerpo.firma = p.sig;
    let status, body;
    const t = S.tickets.find((x) => x.code === p.code);
    if (!t || (p.sig && p.sig !== sig(t.code, t.eventId))) {
      status = 404; body = { ok: false, error: 'BOLETA_NO_VALIDA', mensaje: 'El código no corresponde a ninguna boleta emitida.' };
    } else if (t.status === 'void') {
      status = 410; body = { ok: false, error: 'BOLETA_ANULADA', mensaje: 'La boleta fue anulada.' };
    } else if (eventId && t.eventId !== eventId) {
      status = 422; body = { ok: false, error: 'OTRO_EVENTO', mensaje: 'La boleta es de otro evento: ' + event(t.eventId).title + '.' };
    } else if (t.status === 'used') {
      status = 409; body = { ok: false, error: 'YA_INGRESO', mensaje: 'Esta boleta ya registró ingreso.', ingreso: { hora: UI.fmt.clock(t.usedAt), puerta: t.gate } };
    } else {
      t.status = 'used'; t.usedAt = now(); t.gate = gate || null;
      status = 200; body = { ok: true, boleta: { codigo: t.code, titular: t.holder, ubicacion: ticketLabel(t), tipo: t.type }, ingreso: { hora: UI.fmt.clock(t.usedAt), puerta: gate } };
    }
    const entry = { at: now(), code: p.code, status, gate, eventId: t ? t.eventId : eventId, holder: t ? t.holder : null, label: t ? ticketLabel(t) : null, type: t ? t.type : null, ms };
    S.accesses.unshift(entry); S.accesses = S.accesses.slice(0, 120);
    save(); emit('access', entry);
    return { status, ms, request, body, ticket: t || null };
  }
  const accessCount = (eventId) => S.tickets.filter((t) => t.eventId === eventId && t.status === 'used').length;

  /* ---------------- Cortesías ---------------- */
  function courtesyLeft(eventId) {
    const used = S.courtesies.filter((c) => c.eventId === eventId).reduce((a, c) => a + c.qty, 0);
    return event(eventId).courtesyQuota - used;
  }
  function issueCourtesy({ eventId, optionId, qty, name, email, reason }) {
    qty = Math.max(1, Math.min(20, Number(qty) || 1));
    if (qty > courtesyLeft(eventId)) return { ok: false, msg: `Solo quedan ${courtesyLeft(eventId)} cortesías en el cupo de este evento.` };
    const op = option(eventId, optionId);
    if (!op) return { ok: false, msg: 'Elige una opción de compra.' };
    if (optionStats(eventId, optionId).free < qty) return { ok: false, msg: `No quedan cupos suficientes en ${op.name}.` };
    op.courtesy += qty;
    const tickets = [];
    for (let i = 0; i < qty; i++) tickets.push(issueTicket({ eventId, optionId, seatId: op.seating === 'numerada' ? seatFor(op) : null, holder: name, type: 'cortesia' }));
    const c = { id: uid('cort'), eventId, optionId, qty, name, email, reason: reason || 'Invitación', createdAt: now(), codes: tickets.map((t) => t.code) };
    S.courtesies.unshift(c);
    pushFeed(eventId, { qty, optionId, amount: 0, buyer: shortName(name), channel: 'app', kind: 'cortesia' });
    save();
    emit('option', { eventId, optionId }); emit('courtesy', c);
    notify({ channel: 'email', title: 'Cortesía enviada a ' + name, body: `${qty === 1 ? 'Se emitió 1 boleta' : 'Se emitieron ' + qty + ' boletas'} de cortesía para ${event(eventId).title} (${op.name}) y se enviaron a ${email}.` });
    return { ok: true, courtesy: c, tickets };
  }

  /* ---------------- Editor: imagen de ubicaciones y opciones de compra ---------------- */
  function setMapImage(eventId, dataUrl) {
    if (dataUrl) S.mapImg[eventId] = dataUrl; else delete S.mapImg[eventId];
    save(); emit('config', { eventId, mapImg: true });
  }
  function updateOption(eventId, optionId, patch) {
    const o = option(eventId, optionId);
    if (!o) return null;
    ['name', 'note', 'seating', 'perRow', 'price', 'capacity', 'color', 'enabled'].forEach((k) => { if (k in patch) o[k] = patch[k]; });
    if (o.capacity < o.sold + o.courtesy) o.capacity = o.sold + o.courtesy; // no se puede bajar del vendido
    save();
    emit('config', { eventId, optionId, patch }); emit('option', { eventId, optionId });
    return o;
  }
  function addOption(eventId, opt) {
    const id = (opt.id || String(opt.name || 'opcion').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || uid('op');
    const unique = option(eventId, id) ? id + '-' + code(3).toLowerCase() : id;
    const o = Object.assign({ name: 'Nueva opción', note: '', seating: 'general', perRow: 20, price: 100000, capacity: 100, color: D.colors.slate, enabled: true }, opt, { id: unique, sold: 0, courtesy: 0, seatCursor: 0 });
    S.options[eventId].push(o);
    save(); emit('config', { eventId, optionId: unique, added: true });
    return o;
  }
  function removeOption(eventId, optionId) {
    const o = option(eventId, optionId);
    if (!o) return { ok: false };
    if (o.sold + o.courtesy > 0 || (pending[eventId] && (pending[eventId][optionId] || []).some((h) => h.until > now()))) {
      return { ok: false, msg: 'Esta opción ya tiene boletas vendidas o en proceso: deshabilítala en lugar de borrarla.' };
    }
    S.options[eventId] = S.options[eventId].filter((x) => x.id !== optionId);
    save(); emit('config', { eventId, optionId, removed: true });
    return { ok: true };
  }

  /* ---------------- Ventas: feed y series ---------------- */
  const shortName = (n) => { const p = String(n).split(' '); return p[0] + (p[1] ? ' ' + p[1][0] + '.' : ''); };
  function pushFeed(eventId, e) {
    const f = (S.feed[eventId] = S.feed[eventId] || []);
    f.unshift(Object.assign({ at: now() }, e));
    S.feed[eventId] = f.slice(0, 60);
    if (e.kind === 'venta') {
      const t = (S.today[eventId] = S.today[eventId] || { qty: 0, amount: 0 });
      t.qty += e.qty; t.amount += e.amount;
    }
  }
  const feed = (eventId, n = 20) => (S.feed[eventId] || []).slice(0, n);

  /* Serie diaria determinista (21 días hasta hoy). El último día suma lo vendido en la sesión. */
  function salesByDay(eventId, days = 21) {
    const r = rng('days|' + eventId);
    const st = eventStats(eventId);
    const baseTickets = Math.max(50, st.sold - (S.today[eventId] ? S.today[eventId].qty : 0));
    const w = [];
    for (let i = 0; i < days; i++) {
      const launch = Math.exp(-i / 3.2) * 3.2;
      const wd = new Date(now() - (days - 1 - i) * 864e5).getDay();
      w.push((0.6 + launch + r() * 0.7) * ((wd === 5 || wd === 6) ? 1.45 : 1));
    }
    const total = w.reduce((a, b) => a + b, 0);
    const avgPrice = st.sold ? st.revenue / st.sold : minPrice(eventId);
    return w.map((x, i) => {
      const d = new Date(now() - (days - 1 - i) * 864e5);
      let qty = Math.round((x / total) * baseTickets);
      let amount = qty * avgPrice;
      if (i === days - 1 && S.today[eventId]) { qty += S.today[eventId].qty; amount += S.today[eventId].amount; }
      return { date: d.toISOString().slice(0, 10), qty, amount };
    });
  }

  /* Vende n boletas de golpe (modo pico). Devuelve cuántas logró vender (nunca más que el cupo libre). */
  function bulkSell(eventId, optionId, n, { channel = 'web' } = {}) {
    const o = option(eventId, optionId);
    const sold = Math.max(0, Math.min(n, optionStats(eventId, optionId).free));
    if (!sold) return 0;
    o.sold += sold;
    if (o.seating === 'numerada') o.seatCursor += sold;
    pushFeed(eventId, { qty: sold, optionId, amount: sold * o.price, buyer: sold > 1 ? sold + ' compradores' : shortName(pick(D.people)), channel, kind: 'venta', bulk: true });
    save();
    emit('option', { eventId, optionId });
    emit('sale', { eventId, qty: sold, amount: sold * o.price, optionId, bulk: true });
    return sold;
  }

  /* ---------------- Notificaciones ---------------- */
  function notify({ channel = 'push', title, body, orderId = null }) {
    const n = { id: uid('ntf'), at: now(), channel, title, body, orderId, read: false };
    S.notifications.unshift(n); S.notifications = S.notifications.slice(0, 50);
    save(); emit('notify', n);
    return n;
  }
  const unread = () => S.notifications.filter((n) => !n.read).length;
  function markAllRead() { S.notifications.forEach((n) => (n.read = true)); save(); emit('notify', null); }

  /* ---------------- Reservas de otros compradores (simulación) ---------------- */
  const STAGES = ['Eligiendo boletas', 'Llenando datos', 'En la pasarela', 'Confirmando pago'];
  function activeHolds(eventId) {
    const t = now();
    const list = [];
    others.forEach((o) => { if (o.until > t && (!eventId || o.eventId === eventId)) list.push(o); });
    if (S.hold && (!eventId || S.hold.eventId === eventId)) {
      list.push({ sid: 'me', mine: true, eventId: S.hold.eventId, optionId: S.hold.items[0] && S.hold.items[0].optionId, items: S.hold.items.slice(), qty: holdCount(), buyer: 'Tú (esta sesión)', stage: S.hold.orderId ? 'En la pasarela' : 'Eligiendo boletas', gateway: null, startedAt: S.hold.startedAt || t, until: S.hold.until });
    }
    return list.sort((a, b) => a.until - b.until);
  }
  function otherHold(eventId, optionId, { qty = 1, ttl = 6000, stage } = {}) {
    const o = option(eventId, optionId);
    if (!o || !o.enabled) return null;
    const q = Math.min(qty, optionStats(eventId, optionId).free);
    if (!q) return null;
    const sid = uid('h');
    const until = now() + ttl;
    pz(eventId, optionId).push({ sid, by: 'other', qty: q, until });
    const h = { sid, eventId, optionId, qty: q, buyer: shortName(pick(D.people)), stage: stage || pick(STAGES), gateway: pick(D.gateways).name, startedAt: now(), until };
    others.set(sid, h);
    emit('option', { eventId, optionId });
    emit('holds', { eventId });
    return h;
  }
  function resolveOther(sid, sell) {
    const h = others.get(sid);
    if (!h) return;
    others.delete(sid);
    pending[h.eventId][h.optionId] = pz(h.eventId, h.optionId).filter((x) => x.sid !== sid);
    const o = option(h.eventId, h.optionId);
    if (sell && o) {
      // Los compradores simulados nunca agotan una opción: dejan un remanente que solo venden las
      // compras reales, para que el recorrido del demo funcione aunque la página lleve rato abierta.
      // (Sus reservas sí pueden tomar ese remanente un momento: así se ve «Agotado por ahora».)
      const keep = Math.max(12, Math.round(o.capacity * 0.08));
      const room = o.capacity - o.sold - o.courtesy - keep;
      const q = Math.min(h.qty, Math.max(0, room));
      if (q > 0) {
        o.sold += q; if (o.seating === 'numerada') o.seatCursor += q;
        const amount = Math.round(q * o.price * (1 + D.serviceFee));
        pushFeed(h.eventId, { qty: q, optionId: h.optionId, amount, buyer: h.buyer, channel: Math.random() < 0.7 ? 'web' : 'app', kind: 'venta' });
        save();
        emit('sale', { eventId: h.eventId, qty: q, amount, optionId: h.optionId });
      }
    }
    emit('option', { eventId: h.eventId, optionId: h.optionId });
    emit('holds', { eventId: h.eventId });
  }
  /* El organizador libera manualmente una reserva (control de reservas). */
  function releaseOther(sid) { resolveOther(sid, false); }

  const sim = {
    focusEvent: null, paused: false, timer: null,
    focus(eventId) { this.focusEvent = eventId || null; },
    start() {
      if (this.timer) return;
      const loop = () => {
        this.timer = setTimeout(loop, 1600 + Math.random() * 1800);
        if (this.paused || document.hidden) return;
        this.step();
      };
      this.timer = setTimeout(loop, 1200);
      setInterval(() => { // vencimientos
        const t = now();
        others.forEach((h) => { if (h.until <= t) resolveOther(h.sid, Math.random() < (h.sellP != null ? h.sellP : 0.72)); });
        if (S.hold && S.hold.until <= t) expireHold();
      }, 500);
    },
    step() {
      const evId = this.focusEvent && Math.random() < 0.8 ? this.focusEvent : pick(D.events).id;
      const opts = options(evId).filter((o) => optionStats(evId, o.id).free > 0);
      if (!opts.length) return;
      // las opciones casi agotadas atraen más gente: así se ve el control de cupos
      const scarce = opts.filter((o) => ['low'].includes(optionStats(evId, o.id).status));
      const op = scarce.length && Math.random() < 0.45 ? pick(scarce) : pick(opts);
      const long = Math.random() < 0.3;
      // Dejan al menos 2 cupos libres: el recorrido del demo (2 boletas) siempre se puede hacer.
      const qty = Math.min(1 + Math.floor(Math.random() * (Math.random() < 0.4 ? 4 : 2)), optionStats(evId, op.id).free - 2);
      if (qty <= 0) return;
      const h = otherHold(evId, op.id, { qty, ttl: long ? 25000 + Math.random() * 60000 : 4000 + Math.random() * 6000 });
      if (h) h.sellP = long ? 0.5 : 0.75;
    }
  };

  /* ---------------- Semilla ---------------- */
  function seed() {
    const r = rng('seed-v2');
    const seedT = (eventId, optionId, holder, used) => {
      const op = option(eventId, optionId);
      const c = 'AFR-' + code(4, r) + '-' + code(4, r);
      const seatIdx = Math.floor(r() * Math.max(1, op.sold));
      const seatId = op.seating === 'numerada' ? ROWS[Math.floor(seatIdx / op.perRow) % 26] + '-' + ((seatIdx % op.perRow) + 1) : null;
      S.tickets.push({ code: c, payload: `AFORO|${c}|${eventId}|${sig(c, eventId)}`, eventId, optionId, seatId, holder, orderId: null, type: 'venta', price: op.price, status: used ? 'used' : 'valid', issuedAt: now() - 864e5 * 3, usedAt: used ? now() - 1000 * 60 * 14 : null, gate: used ? D.gates[0] : null, seeded: true });
    };
    seedT('cumbia-electrica', 'general', 'Laura Méndez', false);
    seedT('cumbia-electrica', 'vip', 'Andrés Rojas', false);
    seedT('cumbia-electrica', 'preferencial', 'Camila Duarte', false);
    seedT('cumbia-electrica', 'lateral', 'Santiago Pérez', true);
    seedT('cumbia-electrica', 'general', 'Valentina Gómez', false);
    seedT('sinfonia-andes', 'platea-pref', 'Julián Castro', false);
    // Cortesías ya emitidas (cuentan contra el cupo).
    S.courtesies.push({ id: 'cort-prensa', eventId: 'cumbia-electrica', optionId: 'vip', qty: 6, name: 'Revista Escena', email: 'prensa@escena.co', reason: 'Prensa', createdAt: now() - 864e5 * 2, codes: [] });
    S.courtesies.push({ id: 'cort-patro', eventId: 'cumbia-electrica', optionId: 'general', qty: 10, name: 'Patrocinador principal', email: 'eventos@patrocinador.co', reason: 'Patrocinio', createdAt: now() - 864e5, codes: [] });
    option('cumbia-electrica', 'vip').courtesy += 6;
    option('cumbia-electrica', 'general').courtesy += 10;
    // Feed reciente.
    D.events.forEach((ev) => {
      const ops = options(ev.id);
      for (let i = 0; i < 9; i++) {
        const o = pick(ops, r), qty = 1 + Math.floor(r() * 3);
        (S.feed[ev.id] = S.feed[ev.id] || []).push({ at: now() - (i + 1) * (60000 + r() * 240000), qty, optionId: o.id, amount: Math.round(qty * o.price * (1 + D.serviceFee)), buyer: shortName(pick(D.people, r)), channel: r() < 0.7 ? 'web' : 'app', kind: 'venta' });
      }
    });
    save();
  }

  /* Reservas largas al arrancar: gente en la pasarela en este momento. */
  function seedHolds() {
    const plan = [
      ['cumbia-electrica', 'platino', 4, 4.2], ['cumbia-electrica', 'platino', 3, 2.6], ['cumbia-electrica', 'vip', 2, 6.1],
      ['cumbia-electrica', 'general', 4, 3.4], ['cumbia-electrica', 'preferencial', 2, 7.3], ['cumbia-electrica', 'lateral', 2, 1.4],
      ['bogota-principiantes', 'primera-fila', 2, 5.2], ['bogota-principiantes', 'platea', 2, 3.1], ['sinfonia-andes', 'estudiantes', 2, 4.4],
      ['final-baloncesto', 'palco', 3, 2.2], ['salsa-brava', 'mesas', 4, 6.6], ['selva-sonora', 'preventa', 3, 5.5]
    ];
    plan.forEach(([ev, op, qty, min]) => {
      const h = otherHold(ev, op, { qty, ttl: min * 60000, stage: pick(STAGES.slice(1)) });
      if (h) { h.sellP = 0.6; h.startedAt = now() - (8 - min) * 60000; }
    });
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* */ }
    S = fresh();
    Object.keys(pending).forEach((k) => delete pending[k]);
    others.clear();
    seed(); seedHolds();
    emit('reset', {});
  }

  /* ---------------- Arranque ---------------- */
  if (!S) { S = fresh(); seed(); }
  if (S.hold && S.hold.until < now()) S.hold = null;
  syncMine();
  seedHolds();

  window.Store = {
    get state() { return S; },
    save, on, emit,
    event, venue, venueOf, mapImg,
    options, option, minPrice,
    optionStats, eventStats,
    myHold, holdCount, myQty, setQty, clearHold, cancelPayment,
    validateCoupon, upsertCoupon, toggleCoupon,
    quote, createOrder, confirmPayment,
    ticketsFor, myTickets, ticketLabel, issueTicket,
    validateAccess, parseCode, accessCount,
    courtesyLeft, issueCourtesy,
    setMapImage, updateOption, addOption, removeOption,
    feed, salesByDay, bulkSell, shortName,
    notify, unread, markAllRead,
    activeHolds, otherHold, releaseOther,
    STAGES, sim, reset
  };
})();
