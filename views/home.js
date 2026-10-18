/* Cartelera (comprador): evento destacado como boleta-póster + programación como lista de boletas. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;
  const D = window.DATA;

  const CATS = [
    { id: 'todos', label: 'Todos' },
    { id: 'conciertos', label: 'Conciertos', match: (c) => c === 'Concierto' || c === 'Música clásica' },
    { id: 'teatro', label: 'Teatro y comedia', match: (c) => c === 'Comedia' || c === 'Teatro' },
    { id: 'deportes', label: 'Deportes', match: (c) => c === 'Deportes' },
    { id: 'festivales', label: 'Festivales', match: (c) => c === 'Festival' }
  ];
  const catOf = (ev) => (CATS.find((c) => c.match && c.match(ev.category)) || { id: 'otros' }).id;
  const area = (venue) => String(venue.address || '').split(',').pop().trim();
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

  /* Personas comprando ahora, sin contar mi propia reserva. */
  const othersBuying = (id) => Store.activeHolds(id).filter((h) => !h.mine).length;
  const buying = (n) => (n <= 0 ? 'Boletas disponibles ahora' : n === 1 ? '1 persona comprando ahora' : `${fmt.num(n)} personas comprando ahora`);

  /* Señal de disponibilidad de la programación: concreta, para que no aparezca en todos los eventos. */
  function signal(id) {
    const s = Store.eventStats(id);
    const opts = s.byOption;
    if (!opts.length || opts.every((o) => o.status === 'soldout' || o.status === 'off')) return { cls: 'is-soldout', text: 'Agotado' };
    if (s.pct > 0.8) return { cls: 'is-low', text: 'Últimas boletas' };
    const scarce = opts.filter((o) => o.status === 'low' || o.status === 'process');
    /* Una sola opción escasa (pocas libres o las últimas en pago): se nombra; el detalle está en la ficha. */
    if (scarce.length === 1) return { cls: 'is-low', text: `Últimas en ${scarce[0].option.name}` };
    if (scarce.length > 1) return { cls: 'is-low', text: `Últimas en ${scarce.length} opciones` };
    return { cls: 'is-ok', text: 'Disponible' };
  }

  /* Opciones de compra del destacado, en miniatura (color de la imagen de ubicaciones + escasez). */
  function optChips(id) {
    return Store.eventStats(id).byOption.map((s) => {
      const scarce = s.status === 'low' || s.status === 'process';
      const out = s.status === 'soldout' || s.status === 'off';
      const tag = out ? 'Agotado' : s.status === 'process' ? 'En proceso' : scarce ? 'Últimas' : '';
      return `<li style="--oc:${esc(s.option.color)}" class="${scarce ? 'is-scarce' : ''} ${out ? 'is-out' : ''}"><i aria-hidden="true"></i>${esc(s.option.name)}${tag ? `<span class="sr-only">, </span><b>${tag}</b>` : ''}</li>`;
    }).join('');
  }

  function hero(ev) {
    const v = Store.venueOf(ev.id);
    const n = othersBuying(ev.id);
    const href = '#/evento/' + encodeURIComponent(ev.id);
    return `<section class="hm-hero" aria-labelledby="hm-feat-title" data-hero>
      <div class="stub-wrap hm-ticket-wrap">
        <article class="stub hm-ticket">
          <a class="hm-poster" href="${href}" tabindex="-1" aria-hidden="true">
            <img src="${esc(ev.img)}" alt="" decoding="async" fetchpriority="high">
            <span class="hm-flag">${icon('flame', 14)}Destacado</span>
          </a>
          <div class="hm-head">
            <p class="hm-eyebrow">${esc(ev.category)} · ${esc(ev.artist)}</p>
            <h2 class="display-1 hm-title" id="hm-feat-title"><a href="${href}">${esc(ev.title)}</a></h2>
          </div>
          <div class="hm-talon">
            <time class="hm-date" datetime="${esc(ev.date)}">
              <span class="sr-only">${esc(cap(fmt.dateLong(ev.date)))}, ${esc(fmt.time(ev.date))}</span>
              <span class="hm-date-d" aria-hidden="true">${esc(fmt.day(ev.date))}</span>
              <span class="hm-date-mw" aria-hidden="true">
                <span class="hm-date-m">${esc(fmt.month(ev.date))}</span>
                <span class="hm-date-w">${esc(fmt.weekday(ev.date))} · ${esc(fmt.time(ev.date))}</span>
              </span>
            </time>
            <p class="hm-from"><span>desde<span class="sr-only">:</span></span><strong>${fmt.cop(Store.minPrice(ev.id))}</strong></p>
            <dl class="hm-facts">
              <div><dt>Puertas</dt><dd>${esc(ev.doors)}</dd></div>
              <div><dt>Edad</dt><dd>${esc(ev.age)}</dd></div>
              <div><dt>Duración</dt><dd>${esc(ev.duration)}</dd></div>
            </dl>
          </div>
          <div class="hm-meta">
            <p class="hm-blurb">${esc(ev.blurb)}</p>
            <div class="hm-opts">
              <p class="hm-opts-k">${Store.options(ev.id).length} opciones de compra</p>
              <ul class="hm-opts-l" data-optchips="${esc(ev.id)}">${optChips(ev.id)}</ul>
            </div>
            <p class="hm-venue">${icon('pin', 16)}<span><strong>${esc(v.name)}</strong> · ${esc(area(v))}, ${esc(v.city)}</span></p>
            <p class="hm-live ${n ? '' : 'is-calm'}" data-live="${esc(ev.id)}" data-n="${n}"><i aria-hidden="true"></i><span data-live-n>${buying(n)}</span></p>
          </div>
          <div class="hm-cta">
            <a class="btn btn-primary btn-lg btn-block" href="${href}">Comprar boletas ${icon('arrow', 18)}</a>
            <p class="hm-serial" aria-hidden="true">N.º ${esc(ev.id.slice(0, 3).toUpperCase())}-${esc(fmt.day(ev.date))}${esc(fmt.month(ev.date).toUpperCase())} · 1 persona</p>
          </div>
        </article>
      </div>
    </section>`;
  }

  /* Nombre accesible de la fila (los spans en flex se leen pegados: «desde$35.000»). */
  function rowLabel(ev, sg) {
    const v = Store.venueOf(ev.id);
    return `${ev.title}, ${ev.artist}. ${cap(fmt.dateLong(ev.date))}, ${fmt.time(ev.date)}, ${v.name}, ${area(v)}. Desde ${fmt.cop(Store.minPrice(ev.id))}. ${sg.text}.`;
  }

  function row(ev, i, feat) {
    const v = Store.venueOf(ev.id);
    const sg = signal(ev.id);
    const n = othersBuying(ev.id);
    return `<li class="hm-item rise" data-cat="${catOf(ev)}" ${feat ? 'data-feat="1"' : ''} style="animation-delay:${i * 60}ms">
      <a class="stub-wrap hm-link" href="#/evento/${encodeURIComponent(ev.id)}" aria-label="${esc(rowLabel(ev, sg))}" data-row="${esc(ev.id)}">
        <article class="stub hm-row">
          <div class="hm-row-talon" aria-hidden="true">
            <img src="${esc(ev.img)}" alt="" loading="lazy" decoding="async">
            <p class="hm-row-date">
              <span class="hm-row-d">${esc(fmt.day(ev.date))}</span>
              <span class="hm-row-m">${esc(fmt.month(ev.date))}</span>
              <span class="hm-row-w">${esc(fmt.weekday(ev.date))}</span>
              <span class="hm-row-t">${esc(fmt.time(ev.date))}</span>
            </p>
          </div>
          <div class="hm-row-body">
            <div class="hm-row-main">
              <p class="hm-row-cat">${esc(ev.category)}${feat ? ' · Destacado' : ''}</p>
              <h3 class="hm-row-title">${esc(ev.title)}</h3>
              <p class="hm-row-artist">${esc(ev.artist)}</p>
            </div>
            <p class="hm-row-venue">${icon('pin', 15)}<span><span class="hm-row-vn">${esc(v.name)}</span><span class="hm-row-va">${esc(area(v))}</span></span></p>
            <p class="hm-row-price"><span>desde</span><strong>${fmt.cop(Store.minPrice(ev.id))}</strong></p>
            <div class="hm-row-state">
              <span class="opt-avail ${sg.cls}" data-signal="${esc(ev.id)}">${esc(sg.text)}</span>
              <span class="hm-row-live" data-live="${esc(ev.id)}" data-n="${n}" ${n ? '' : 'hidden'}><i aria-hidden="true"></i><span data-live-n>${fmt.num(n)} comprando</span></span>
            </div>
            <span class="hm-row-go" aria-hidden="true">${icon('arrow', 20)}</span>
          </div>
        </article>
      </a>
    </li>`;
  }

  App.view({
    id: 'home', path: '/', role: 'buyer', title: 'Cartelera',
    render(params, query) {
      const feat = D.events.find((e) => e.featured) || D.events[0];
      const byDate = D.events.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      const qc = query && query.get('cat');
      const cur = CATS.some((c) => c.id === qc) ? qc : 'todos';
      /* El destacado cuenta en su categoría; con un filtro activo se muestra en la lista y el póster se pliega. */
      const count = (c) => (c.id === 'todos' ? D.events.length : D.events.filter((e) => catOf(e) === c.id).length);
      const all = byDate.map((e) => new Date(e.date));
      const span = fmt.month(all[0].toISOString()) + ' – ' + fmt.month(all[all.length - 1].toISOString()) + ' ' + all[0].getFullYear();

      return `<div class="wrap hm">
        <div class="hm-kick">
          <h1>Cartelera · Bogotá</h1>
          <p><span class="hm-kick-n">${D.events.length} eventos · </span>${esc(span)}</p>
        </div>

        ${hero(feat)}

        <section class="hm-prog" aria-labelledby="hm-prog-title">
          <div class="hm-prog-head">
            <div class="hm-prog-tt">
              <h2 class="h1" id="hm-prog-title">Programación</h2>
              <p class="hm-prog-sub">Cupos en tiempo real: nadie te vende lo que otra persona está pagando.</p>
            </div>
            <div class="chips hm-chips" role="group" aria-label="Filtrar por categoría">
              ${CATS.map((c) => { const k = count(c); return `<button type="button" class="chip ${c.id === cur ? 'is-on' : ''}" data-cat="${c.id}" aria-pressed="${c.id === cur}" aria-label="${esc(c.label)}, ${k} ${k === 1 ? 'evento' : 'eventos'}">${esc(c.label)}<span class="hm-chip-n" aria-hidden="true">${k}</span></button>`; }).join('')}
            </div>
          </div>
          <div class="hm-cols" aria-hidden="true">
            <span>Fecha</span>
            <span class="hm-cols-in"><span>Evento</span><span>Recinto</span><span>Precio</span><span>Disponibilidad</span><span></span></span>
          </div>
          <ol class="hm-list" data-list>
            ${byDate.map((e, i) => row(e, i, e === feat)).join('')}
          </ol>
          <p class="hm-empty" data-empty hidden>No hay eventos en esta categoría por ahora.</p>
        </section>

        <footer class="hm-foot">
          <p class="hm-trust">Cada boleta lleva un QR único que se valida una sola vez en la puerta. Nadie puede comprar la boleta que otra persona está pagando. El pago se hace en PayU, Mercado Pago o ePayco.</p>
          <div class="hm-foot-row">
            <span>Demo con datos ficticios · «aforo» es una marca de ejemplo</span>
            <a href="#/guia">Guía del demo ${icon('arrow', 15)}</a>
          </div>
        </footer>
      </div>`;
    },

    mount(root, params, ctx, query) {
      const list = root.querySelector('[data-list]');
      const empty = root.querySelector('[data-empty]');
      const heroEl = root.querySelector('[data-hero]');
      const chipsEl = root.querySelector('.hm-chips');
      const chips = chipsEl.querySelectorAll('[data-cat]');

      function applyFilter(cat, animate) {
        /* Los filtros no deben moverse bajo el dedo al plegar/desplegar el póster. */
        const before = animate ? chipsEl.getBoundingClientRect().top : 0;
        heroEl.hidden = cat !== 'todos';
        let shown = 0;
        list.querySelectorAll('.hm-item').forEach((li) => {
          const on = cat === 'todos' ? !li.dataset.feat : li.dataset.cat === cat;
          li.hidden = !on;
          if (on && animate) {
            li.classList.remove('rise'); void li.offsetWidth;
            li.style.animationDelay = shown * 60 + 'ms';
            li.classList.add('rise');
          }
          if (on) shown++;
        });
        empty.hidden = shown > 0;
        chips.forEach((b) => { const on = b.dataset.cat === cat; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
        if (animate) {
          const d = chipsEl.getBoundingClientRect().top - before;
          if (Math.abs(d) > 1) window.scrollBy(0, d);
        }
      }
      const initial = chipsEl.querySelector('.is-on');
      applyFilter(initial ? initial.dataset.cat : 'todos', false);

      chipsEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b || b.classList.contains('is-on')) return;
        const cat = b.dataset.cat;
        applyFilter(cat, true);
        try { history.replaceState(null, '', cat === 'todos' ? '#/' : '#/?cat=' + cat); } catch (err) { /* sin historial */ }
      });

      /* Señales en vivo: personas comprando y disponibilidad (máx. ~1 vez por segundo). */
      function refresh() {
        root.querySelectorAll('[data-live]').forEach((el) => {
          const n = othersBuying(el.dataset.live);
          if (String(n) === el.dataset.n) return;
          el.dataset.n = n;
          const t = el.querySelector('[data-live-n]');
          if (el.classList.contains('hm-row-live')) { el.hidden = !n; t.textContent = fmt.num(n) + ' comprando'; }
          else { t.textContent = buying(n); el.classList.toggle('is-calm', !n); }
          el.classList.remove('hm-bump'); void el.offsetWidth; el.classList.add('hm-bump');
        });
        root.querySelectorAll('[data-signal]').forEach((el) => {
          const sg = signal(el.dataset.signal);
          if (el.textContent !== sg.text) {
            el.textContent = sg.text; el.className = 'opt-avail ' + sg.cls;
            const a = el.closest('[data-row]');
            if (a) a.setAttribute('aria-label', rowLabel(Store.event(a.dataset.row), sg));
          }
        });
        root.querySelectorAll('[data-optchips]').forEach((ul) => {
          const html = optChips(ul.dataset.optchips);
          if (ul.dataset.h !== html) { ul.dataset.h = html; ul.innerHTML = html; }
        });
      }
      let t = null, last = 0;
      const soon = () => {
        if (t) return;
        const wait = Math.max(0, 1000 - (Date.now() - last));
        t = setTimeout(() => { t = null; last = Date.now(); refresh(); }, wait);
      };
      ctx.sub('holds', soon);
      ctx.sub('option', soon);
      ctx.every(2000, soon);
      ctx.onLeave(() => clearTimeout(t));
    }
  });
})();
