/* Control de reservas y procesos en curso (organizador): reglas de vencimiento, embudo por etapa,
   lista en vivo de quién tiene cupo apartado (con cuenta regresiva y opción de liberar), cupo libre
   vs. en proceso por opción de compra y órdenes recientes del evento. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;
  const D = window.DATA;

  const SHORT = ['Eligiendo', 'Datos', 'Pasarela', 'Pago'];
  const STATUS = {
    pending: ['Pendiente', 'badge-warn'], paid: ['Pagada', 'badge-ok'], failed: ['Rechazada', 'badge-bad'],
    expired: ['Vencida', ''], cancelled: ['Cancelada', 'badge-line']
  };
  const HOLD_MIN = Math.round(D.holdSeconds / 60);

  const sidCode = (sid) => (sid === 'me' ? 'TÚ' : String(sid).slice(-4).toUpperCase());
  /* Etapa en vivo: la reserva avanza sola con el tiempo que lleva (eligiendo → datos → pasarela →
     confirmando) y nunca retrocede. Se calcula a partir de su inicio y su vencimiento, así que se
     mantiene igual al salir y volver a la vista. La reserva propia usa la etapa real. */
  function stageOf(h) {
    const base = Math.max(0, Store.STAGES.indexOf(h.stage));
    if (h.mine || !h.startedAt) return base;
    const total = h.until - h.startedAt;
    if (total <= 0) return base;
    const frac = (Date.now() - h.startedAt) / total;
    return Math.min(3, Math.max(base, Math.floor(frac * 4)));
  }
  const stageName = (h) => Store.STAGES[stageOf(h)];
  function gatewayOf(h) {
    if (h.mine) {
      const hold = Store.state.hold;
      const o = hold && hold.orderId && Store.state.orders.find((x) => x.id === hold.orderId);
      const g = o && D.gateways.find((x) => x.id === o.gateway);
      return g ? g.name : null;
    }
    return stageOf(h) >= 2 ? h.gateway : null;
  }
  function itemsOf(evId, h) {
    const items = h.items && h.items.length ? h.items : [{ optionId: h.optionId, qty: h.qty }];
    return items.map((it) => ({ o: Store.option(evId, it.optionId), qty: it.qty })).filter((x) => x.o);
  }
  /* Mientras elige es anónimo; al llenar sus datos ya se ve su nombre abreviado. */
  const who = (h) => (h.mine ? h.buyer : stageOf(h) === 0 ? 'Anónimo' : h.buyer);
  const rowKey = (h) => stageOf(h) + '|' + (gatewayOf(h) || '') + '|' + who(h);

  /* La simulación se concentra en el evento que se controla; suelta el foco con pocos cupos. */
  function focusSim(ctx, evId) {
    const apply = () => {
      const st = Store.eventStats(evId);
      Store.sim.focus(st.free > Math.max(40, Math.round(st.capacity * 0.05)) ? evId : null);
    };
    apply();
    ctx.every(5000, apply);
    ctx.onLeave(() => Store.sim.focus(null));
  }

  /* ---------------- Bloques ---------------- */
  function rulesHTML() {
    return `<ol class="rs-rules" aria-label="Reglas de las reservas">
      <li><span class="rs-rule-ico">${icon('timer', 18)}</span><span class="rs-rule-k mono">${HOLD_MIN}:00</span><span class="rs-rule-t">Hasta ${HOLD_MIN} min eligiendo boletas y llenando datos</span></li>
      <li><span class="rs-rule-ico">${icon('card', 18)}</span><span class="rs-rule-k mono">10:00</span><span class="rs-rule-t">10 min en la pasarela para completar el pago</span></li>
      <li><span class="rs-rule-ico">${icon('refresh', 18)}</span><span class="rs-rule-k mono">0:00</span><span class="rs-rule-t">Al vencer, las boletas vuelven solas al cupo libre</span></li>
    </ol>`;
  }

  function funnelHTML() {
    return `<section class="rs-funnel" aria-labelledby="rs-funnel-t">
      <h2 class="sr-only" id="rs-funnel-t">Reservas por etapa</h2>
      <ol class="rs-fun">${Store.STAGES.map((s, i) => `
        <li class="rs-fs" data-stage="${i}" style="--k:${i}">
          <span class="rs-fs-n mono" data-f="n">0</span>
          <span class="rs-fs-l"><span class="rs-long">${esc(s)}</span><span class="rs-short">${esc(SHORT[i])}</span></span>
          <span class="rs-fs-b mono" data-f="b">0 boletas</span>
        </li>`).join('')}
      </ol>
    </section>`;
  }

  function stageHTML(h) {
    const si = stageOf(h);
    return `<span class="sr-only">Etapa: </span><span class="rs-steps" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i < si ? 'is-done' : i === si ? 'is-now' : ''}"></i>`).join('')}</span><span class="rs-stage-l"><span class="rs-st-l">${esc(Store.STAGES[si])}</span><span class="rs-st-s" aria-hidden="true">${esc(SHORT[si])}</span></span>`;
  }
  function gwHTML(h) {
    const g = gatewayOf(h);
    return `<span class="sr-only">Pasarela: </span>${g ? esc(g) : '<span class="faint">Sin elegir</span>'}`;
  }
  function whoHTML(h) {
    return `<span class="rs-who">${h.mine ? `<span class="rs-me" aria-hidden="true"></span>` : ''}${esc(who(h))}</span>
        <span class="rs-sid mono">${h.mine ? 'Este navegador' : '#' + esc(sidCode(h.sid))}</span>`;
  }
  function rowHTML(evId, h) {
    const items = itemsOf(evId, h);
    const first = items[0];
    return `<li class="rs-row${h.mine ? ' is-mine' : ''}" data-sid="${esc(h.sid)}" data-key="${esc(rowKey(h))}" style="--oc:${esc(first ? first.o.color : 'var(--text-3)')}">
      <div class="rs-c-who" data-f="who">${whoHTML(h)}</div>
      <div class="rs-c-opt">
        <span class="rs-sw" aria-hidden="true"></span>
        <span class="rs-opt-t"><span class="sr-only">Opción: </span>${items.map((x) => `<span class="rs-it"><b>${esc(x.o.name)}</b> <span class="mono">× ${x.qty}</span></span>`).join('')}</span>
      </div>
      <div class="rs-c-stage" data-f="stage">${stageHTML(h)}</div>
      <div class="rs-c-gw" data-f="gw">${gwHTML(h)}</div>
      <div class="rs-c-time"><span class="sr-only">Vence en </span><span class="rs-time mono" data-f="time" title="Tiempo restante de la reserva">—</span></div>
      <div class="rs-c-act">${h.mine
        ? `<a class="btn btn-sm btn-line rs-act" href="#/checkout">${icon('card', 16)}Ir al pago</a>`
        : `<button class="btn btn-sm btn-line rs-act rs-free" type="button" data-release="${esc(h.sid)}">${icon('refresh', 16)}Liberar<span class="sr-only"> la reserva #${esc(sidCode(h.sid))}</span></button>`}</div>
    </li>`;
  }

  function optRow(s) {
    const o = s.option;
    return `<li class="rs-or" data-opt="${esc(o.id)}" style="--oc:${esc(o.color)}">
      <div class="rs-or-h"><span class="rs-sw" aria-hidden="true"></span><b class="rs-or-name">${esc(o.name)}</b><span class="opt-avail" data-f="avail"></span></div>
      <div class="rs-stack" aria-hidden="true"><i class="rs-s-sold" data-f="sold"></i><i class="rs-s-proc" data-f="proc"></i></div>
      <p class="rs-or-n mono"><span data-f="free"></span><span data-f="procn"></span><span class="faint" data-f="soldn"></span></p>
    </li>`;
  }

  function ordersHTML(evId) {
    const list = Store.state.orders.filter((o) => o.eventId === evId).slice(0, 8);
    if (!list.length) {
      return `<div class="rs-empty">
        ${icon('listCheck', 26)}
        <p class="small">Aún no hay órdenes de esta sesión para este evento. Compra como cliente y la orden aparecerá aquí con su estado.</p>
        <a class="btn btn-sm btn-line" href="#/evento/${esc(evId)}">Comprar como cliente ${icon('arrow', 16)}</a>
      </div>`;
    }
    return `<ul class="rs-ord-list">${list.map((o) => {
      const [label, cls] = STATUS[o.status] || [o.status, ''];
      const qty = o.items.reduce((a, i) => a + i.qty, 0);
      const gw = D.gateways.find((g) => g.id === o.gateway);
      return `<li class="rs-ord">
        <div class="rs-ord-b">
          <p class="rs-ord-t"><span class="mono">${esc(o.id)}</span><span class="badge ${cls}">${esc(label)}</span></p>
          <p class="rs-ord-s">${esc(o.buyer && o.buyer.name ? o.buyer.name : 'Comprador')} · ${fmt.plural(qty, 'boleta', 'boletas')}${gw ? ' · ' + esc(gw.name) : ''}</p>
        </div>
        <div class="rs-ord-m"><b class="mono">${fmt.cop(o.total)}</b><span class="tiny faint">${esc(fmt.ago(o.createdAt))}</span></div>
      </li>`;
    }).join('')}</ul>`;
  }

  /* ---------------- Vista ---------------- */
  App.view({
    id: 'reservas', path: '/org/reservas', role: 'org', title: 'Reservas en curso',
    render() {
      const evId = App.orgEvent();
      const ev = Store.event(evId);
      const st = Store.eventStats(evId);
      return `<div class="wrap rs">
        <header class="rs-head">
          <div class="rs-head-txt">
            <p class="eyebrow">Control de reservas · ${esc(ev.title)}</p>
            <h1 class="h1">Reservas y procesos en curso</h1>
            <p class="muted rs-lead">Cada compra aparta su cupo mientras la persona paga. Ese cupo queda bloqueado: nadie más puede tomarlo hasta que se pague o venza.</p>
          </div>
          ${rulesHTML()}
        </header>

        ${funnelHTML()}

        <div class="rs-main">
          <section class="panel rs-live" aria-labelledby="rs-live-t">
            <div class="panel-head">
              <div>
                <p class="eyebrow"><span class="dot-live"></span> En vivo</p>
                <h2 class="h3" id="rs-live-t">Quién tiene cupo apartado</h2>
              </div>
              <p class="rs-count mono" data-rs-count></p>
            </div>
            <div class="rs-thead" aria-hidden="true">
              <span>Comprador</span><span><span class="rs-th-l">Opción × cantidad</span><span class="rs-th-s">Opción</span></span><span>Etapa</span><span>Pasarela</span><span>Vence en</span><span></span>
            </div>
            <ol class="rs-list" data-rs-list></ol>
            <div class="rs-empty" data-rs-empty hidden>
              ${icon('timer', 26)}
              <p class="small">No hay reservas activas en este momento. Cuando alguien aparte boletas aparecerá aquí con su cuenta regresiva.</p>
            </div>
          </section>

          <div class="rs-side">
            <section class="panel rs-opts" aria-labelledby="rs-opts-t">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Por opción de compra</p>
                  <h2 class="h3" id="rs-opts-t">Cupo libre vs. en proceso</h2>
                </div>
              </div>
              <ul class="rs-key" aria-hidden="true">
                <li><i class="rs-k-sold"></i>Vendido</li><li><i class="rs-k-proc"></i>En proceso</li><li><i class="rs-k-free"></i>Libre</li>
              </ul>
              <ul class="rs-or-list" data-rs-opts>${st.byOption.map(optRow).join('')}</ul>
              <p class="rs-note tiny muted">${icon('lock', 14)}<span>Lo que está en proceso no se puede vender a nadie más. Si la reserva vence, vuelve al cupo libre sin intervención.</span></p>
            </section>

            <section class="panel rs-orders" aria-labelledby="rs-ord-t">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Esta sesión</p>
                  <h2 class="h3" id="rs-ord-t">Órdenes recientes</h2>
                </div>
              </div>
              <div data-rs-orders>${ordersHTML(evId)}</div>
            </section>
          </div>
        </div>
      </div>`;
    },

    mount(root, params, ctx) {
      const evId = App.orgEvent();
      focusSim(ctx, evId);
      const list = root.querySelector('[data-rs-list]');
      const empty = root.querySelector('[data-rs-empty]');
      const count = root.querySelector('[data-rs-count]');
      const optsEl = root.querySelector('[data-rs-opts]');
      const ordersEl = root.querySelector('[data-rs-orders]');
      const stages = [...root.querySelectorAll('.rs-fs')];
      let holds = [];
      let dirty = true, ordersDirty = false;

      function refreshList() {
        holds = Store.activeHolds(evId);
        const keep = new Set(holds.map((h) => h.sid));
        [...list.children].forEach((li) => {
          if (!keep.has(li.dataset.sid) && !li.classList.contains('is-out')) {
            li.classList.add('is-out');
            setTimeout(() => li.remove(), 320);
          }
        });
        let prev = null;
        holds.forEach((h) => {
          let li = list.querySelector(`[data-sid="${CSS.escape(h.sid)}"]:not(.is-out)`);
          if (!li) {
            const t = document.createElement('template');
            t.innerHTML = rowHTML(evId, h).trim();
            li = t.content.firstElementChild;
            li.classList.add('rise');
            li.addEventListener('animationend', () => li.classList.remove('rise'), { once: true });
          }
          const want = prev ? prev.nextElementSibling : list.firstElementChild;
          if (want !== li) list.insertBefore(li, want);
          prev = li;
        });
        empty.hidden = holds.length > 0;
        const tickets = holds.reduce((a, h) => a + (h.qty || 0), 0);
        count.textContent = holds.length
          ? `${fmt.plural(holds.length, 'reserva', 'reservas')} · ${fmt.plural(tickets, 'boleta bloqueada', 'boletas bloqueadas')}`
          : 'Sin reservas activas';
      }

      function refreshFunnel() {
        const n = [0, 0, 0, 0], b = [0, 0, 0, 0];
        const t = Date.now();
        holds.forEach((h) => { if (h.until <= t) return; const i = stageOf(h); n[i]++; b[i] += h.qty || 0; });
        stages.forEach((el, i) => {
          el.querySelector('[data-f="n"]').textContent = fmt.num(n[i]);
          el.querySelector('[data-f="b"]').textContent = fmt.plural(b[i], 'boleta', 'boletas');
          el.classList.toggle('is-zero', n[i] === 0);
        });
      }

      function refreshOpts() {
        const st = Store.eventStats(evId);
        const rows = [...optsEl.children];
        const same = rows.length === st.byOption.length && rows.every((r, i) => r.dataset.opt === st.byOption[i].option.id);
        if (!same) optsEl.innerHTML = st.byOption.map(optRow).join('');
        st.byOption.forEach((s) => {
          const row = optsEl.querySelector(`[data-opt="${CSS.escape(s.option.id)}"]`);
          if (!row) return;
          const f = (k) => row.querySelector(`[data-f="${k}"]`);
          const a = LocMap.availability(s);
          const av = f('avail');
          av.className = 'opt-avail ' + a.cls;
          av.textContent = a.short;
          av.title = a.text;
          const cap = s.capacity || 1, proc = s.held + s.mine;
          f('sold').style.width = ((s.occupied / cap) * 100).toFixed(2) + '%';
          f('proc').style.width = ((proc / cap) * 100).toFixed(2) + '%';
          f('proc').classList.toggle('is-some', proc > 0);
          f('free').textContent = `${fmt.num(s.free)} ${s.free === 1 ? 'libre' : 'libres'}`;
          f('procn').textContent = `${fmt.num(proc)} en proceso`;
          f('procn').className = proc ? 'warn-txt' : 'faint';
          f('soldn').textContent = `${fmt.num(s.occupied)} / ${fmt.num(s.capacity)}`;
        });
      }

      /* Cada segundo: cuenta regresiva y, si la reserva cambió de etapa, sus celdas (no la lista entera). */
      function tickRows() {
        const t = Date.now();
        holds.forEach((h) => {
          const li = list.querySelector(`[data-sid="${CSS.escape(h.sid)}"]:not(.is-out)`);
          if (!li) return;
          const left = Math.max(0, (h.until - t) / 1000);
          const total = Math.max(1, (h.until - (h.startedAt || t)) / 1000);
          const el = li.querySelector('[data-f="time"]');
          el.textContent = fmt.mmss(left);
          el.classList.toggle('is-warn', left < 120 && left >= 60);
          el.classList.toggle('is-bad', left < 60);
          li.style.setProperty('--left', Math.min(1, left / total).toFixed(3));
          const key = rowKey(h);
          if (li.dataset.key !== key) {
            li.dataset.key = key;
            li.querySelector('[data-f="who"]').innerHTML = whoHTML(h);
            li.querySelector('[data-f="stage"]').innerHTML = stageHTML(h);
            li.querySelector('[data-f="gw"]').innerHTML = gwHTML(h);
            li.classList.remove('is-step'); void li.offsetWidth; li.classList.add('is-step');
          }
        });
      }

      function refresh() {
        if (dirty) { dirty = false; refreshList(); refreshOpts(); }
        if (ordersDirty) { ordersDirty = false; ordersEl.innerHTML = ordersHTML(evId); }
        tickRows();
        refreshFunnel();
      }

      const mark = (e) => { if (!e || !e.eventId || e.eventId === evId) dirty = true; };
      ctx.sub('holds', mark);
      ctx.sub('option', mark);
      ctx.sub('hold', () => { dirty = true; });
      ctx.sub('order', () => { ordersDirty = true; dirty = true; });
      ctx.every(1000, refresh);
      ctx.every(15000, () => { ordersDirty = true; }); // refresca «hace N min»
      refresh();

      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-release]');
        if (!b) return;
        const sid = b.dataset.release;
        const h = Store.activeHolds(evId).find((x) => x.sid === sid);
        if (!h) { UI.toast('Esa reserva ya había terminado.', { type: 'info' }); dirty = true; return; }
        const items = itemsOf(evId, h);
        const what = items.map((x) => `${fmt.plural(x.qty, 'boleta', 'boletas')} de ${x.o.name}`).join(', ');
        const s = UI.sheet({
          title: 'Liberar esta reserva',
          body: `<div class="rs-sheet">
            <div class="rs-sheet-row" style="--oc:${esc(items[0] ? items[0].o.color : 'var(--text-3)')}">
              <span class="rs-sw" aria-hidden="true"></span>
              <div><p class="strong">${esc(what)}</p><p class="small muted">${esc(who(h))} · #${esc(sidCode(h.sid))} · ${esc(stageName(h))}</p></div>
            </div>
            <p class="small muted">${h.qty === 1 ? 'La boleta vuelve' : `Las ${fmt.num(h.qty)} boletas vuelven`} al cupo libre de inmediato y cualquier otra persona puede comprarlas. A quien la tenía apartada se le avisa que su reserva terminó.</p>
          </div>`,
          actions: `<button class="btn btn-line" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" data-rs-confirm>${icon('refresh', 18)}Liberar ${fmt.plural(h.qty, 'boleta', 'boletas')}</button>`
        });
        s.el.querySelector('[data-rs-confirm]').addEventListener('click', () => {
          const still = Store.activeHolds(evId).some((x) => x.sid === sid);
          if (still) {
            Store.releaseOther(sid);
            UI.toast(`Reserva liberada: ${what} ${h.qty === 1 ? 'volvió' : 'volvieron'} al cupo libre.`, { type: 'ok' });
          } else {
            UI.toast('Esa reserva ya había terminado.', { type: 'info' });
          }
          dirty = true;
          s.close();
          refresh();
        });
      });
    }
  });
})();
