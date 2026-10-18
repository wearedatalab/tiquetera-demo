/* Espacios (organizador): la imagen de ubicaciones que sube el organizador y, al lado,
   las opciones de compra (localidades) con color, tipo, precio y cupo.
   Los eventos no están estandarizados: no hay plano generado ni selección silla por silla.
   Módulos: «configuración de espacios dentro de los recintos» + «interfaces para mostrar
   los espacios al administrador y al usuario final». */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;
  const D = window.DATA;

  const MAX_W = 1400;      // ancho máximo de la imagen subida
  const QUALITY = 0.82;    // calidad JPEG
  const DEBOUNCE = 380;

  const COLOR_NAMES = { magenta: 'Magenta', violet: 'Violeta', teal: 'Turquesa', blue: 'Azul', green: 'Verde', gold: 'Dorado', coral: 'Coral', slate: 'Gris pizarra' };
  const PALETTE = Object.keys(D.colors).map((k) => ({ key: k, hex: D.colors[k], name: COLOR_NAMES[k] || k }));
  const VENUE_NOTES = {
    'coliseo-sol': 'La cancha del partido es la pista de baile de la noche de salsa. Mismo coliseo, otra imagen y otras opciones de compra.',
    'teatro-esfera': 'La sinfonía vende platea, balcón y un cupo para estudiantes; el stand-up suma una primera fila con foto. Cada uno sube su imagen.',
    'arena-capital': 'El concierto tiene tarima y graderías numeradas; el festival abre toda la pista y agrega backstage. Cada uno sube su imagen.'
  };
  const SEAT_HINT = {
    numerada: 'La fila y la silla se asignan solas, en orden, al confirmar el pago.',
    general: 'Sin silla asignada: la boleta da acceso a la zona.'
  };

  /* Íconos propios (mismo trazo que UI.icon). */
  const svg = (d, s = 20) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'
  };

  const sameHex = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const seatShort = (o) => (o.seating === 'numerada' ? 'Silla numerada' : 'Acceso general');
  const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const parseNum = (v) => {
    if (v === '' || v == null) return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : null;
  };

  /* Aforo habilitado = suma de cupos de las opciones habilitadas. */
  function totals(id) {
    const all = Store.options(id, true);
    const on = all.filter((o) => o.enabled);
    let cap = 0, occ = 0;
    on.forEach((o) => { cap += o.capacity; occ += o.sold + o.courtesy; });
    return { all, on, cap, occ, pct: cap ? occ / cap : 0 };
  }

  /* Piso del cupo: lo emitido (vendidas + cortesías) más lo que se está pagando ahora mismo
     (reservas de otras personas y la mía). Bajar de ahí dejaría boletas en proceso sin cupo. */
  function capFloor(id, optId) {
    const o = Store.option(id, optId);
    if (!o) return null;
    const st = Store.optionStats(id, optId);
    const emitted = o.sold + o.courtesy;
    const proc = st.held + st.mine;
    return { o, st, emitted, proc, min: emitted + proc };
  }
  function capHint(f) {
    const o = f.o;
    const parts = [`vendidas ${fmt.num(o.sold)}${o.courtesy ? ` + ${fmt.num(o.courtesy)} cortesías` : ''}`];
    if (f.proc) parts.push(`${fmt.num(f.proc)} en proceso`);
    parts.push(`mínimo ${fmt.num(f.min)}`);
    return parts.join(' · ');
  }
  function capErr(f) {
    const m = fmt.num(f.min);
    if (!f.min) return 'El cupo no puede ser negativo.';
    if (f.proc && f.emitted) return `No puede bajar de ${m}: hay ${fmt.num(f.emitted)} emitidas y ${fmt.num(f.proc)} en proceso.`;
    if (f.proc) return `No puede bajar de ${m}: hay ${fmt.plural(f.proc, 'boleta', 'boletas')} en proceso de pago.`;
    return `No puede bajar de ${m}: ya hay ${fmt.plural(f.emitted, 'boleta emitida', 'boletas emitidas')}.`;
  }

  const distHTML = (on) => on.map((o) => `<i data-d="${esc(o.id)}" style="--c:${esc(o.color)};--w:${o.capacity}" title="${esc(o.name)} · ${fmt.num(o.capacity)}"></i>`).join('');

  const pctW = (n, c) => Math.min(100, (n / (c || 1)) * 100).toFixed(2) + '%';
  const meterHTML = (st) => `<i class="es-m-sold" style="width:${pctW(st.sold, st.capacity)}"></i><i class="es-m-cort" style="width:${pctW(st.courtesy, st.capacity)}"></i><i class="es-m-held" style="width:${pctW(st.held + st.mine, st.capacity)}"></i>`;

  function statHTML(o, st) {
    const parts = [`vendidas ${fmt.num(st.sold)}`];
    if (st.courtesy) parts.push(`${fmt.num(st.courtesy)} cortesías`);
    const h = st.held + st.mine;
    if (!o.enabled) {
      if (h) parts.push(`<span class="es-held">${fmt.num(h)} terminando su pago</span>`);
      parts.push('oculta en la tienda');
    } else {
      if (h) parts.push(`<span class="es-held">${fmt.num(h)} en proceso</span>`);
      parts.push(`quedan ${fmt.num(st.free)}`);
    }
    return parts.join(' · ');
  }

  /* ---------- Fila editable (acordeón) ---------- */
  function rowHTML(id, o, open, isNew) {
    const f = capFloor(id, o.id);
    const st = f.st;
    const k = 'es-' + o.id;
    return `<li class="es-opt ${o.enabled ? '' : 'is-off'} ${open ? 'is-open' : ''}" data-opt="${esc(o.id)}" style="--oc:${esc(o.color)}">
      <div class="es-opt-head">
        <span class="es-opt-name"><span data-h-name>${esc(o.name)}</span>${isNew ? '<span class="badge badge-accent">Nueva</span>' : ''}</span>
        <span class="es-opt-price" data-h-price>${fmt.cop(o.price)}</span>
        <span class="es-opt-meta" data-h-meta>${seatShort(o)} · ${fmt.num(o.capacity)} cupos</span>
        <label class="es-onoff">
          <span class="es-onoff-t" data-h-on aria-hidden="true">${o.enabled ? 'En venta' : 'Oculta'}</span>
          <span class="switch"><input type="checkbox" data-k="enabled" ${o.enabled ? 'checked' : ''} aria-label="${esc(o.name)}: a la venta en la tienda"><span></span></span>
        </label>
        <span class="es-meter" data-h-meter aria-hidden="true">${meterHTML(st)}</span>
        <span class="es-opt-l4">
          <span class="es-opt-stat" data-h-stat>${statHTML(o, st)}</span>
          <span class="es-opt-edit" aria-hidden="true"><span data-h-edit>${open ? 'Cerrar' : 'Editar'}</span>${icon('down', 16)}</span>
        </span>
        <button class="es-opt-tg" type="button" aria-expanded="${open}" aria-controls="${esc(k)}-body" aria-label="Editar ${esc(o.name)}"></button>
      </div>
      <div class="es-opt-body" id="${esc(k)}-body" ${open ? '' : 'hidden'}>
        <div class="es-fields">
          ${isNew ? `<p class="es-newnote" id="${esc(k)}-new" data-newnote ${o.enabled ? 'hidden' : ''}>${icon('info', 16)}<span>Nace oculta: ponle nombre, precio y cupo, y actívala para venderla.</span></p>` : ''}
          <fieldset class="es-f-color">
            <legend class="es-lbl">Color en la imagen</legend>
            <div class="es-sws">
              ${PALETTE.map((p) => `<label class="es-sw" style="--c:${p.hex}" title="${esc(p.name)}"><input type="radio" name="${esc(k)}-color" value="${p.hex}" data-k="color" ${sameHex(p.hex, o.color) ? 'checked' : ''}><span class="es-sw-dot" aria-hidden="true"></span><span class="sr-only">${esc(p.name)}</span></label>`).join('')}
            </div>
            <p class="es-hint">Usa el color de la zona en tu imagen: así el comprador la ubica de un vistazo.</p>
          </fieldset>
          <div class="field">
            <label for="${esc(k)}-name">Nombre</label>
            <input class="input" id="${esc(k)}-name" data-k="name" value="${esc(o.name)}" maxlength="40" autocomplete="off" spellcheck="false"${isNew ? ` aria-describedby="${esc(k)}-new"` : ''}>
            <p class="error" data-err-name hidden>Ponle un nombre a la opción.</p>
          </div>
          <div class="field">
            <label for="${esc(k)}-note">Nota para el comprador</label>
            <input class="input" id="${esc(k)}-note" data-k="note" value="${esc(o.note)}" maxlength="70" placeholder="Ej.: De pie, frente a la tarima" autocomplete="off">
          </div>
          <div class="field">
            <span class="label" id="${esc(k)}-seat">Tipo de ubicación</span>
            <div class="seg es-seat" role="group" aria-labelledby="${esc(k)}-seat">
              <button type="button" data-seat="numerada" class="${o.seating === 'numerada' ? 'is-on' : ''}" aria-pressed="${o.seating === 'numerada'}">${icon('seat', 16)}Silla numerada</button>
              <button type="button" data-seat="general" class="${o.seating === 'general' ? 'is-on' : ''}" aria-pressed="${o.seating === 'general'}">${icon('users', 16)}Acceso general</button>
            </div>
            <p class="es-hint" data-seat-hint>${SEAT_HINT[o.seating] || ''}</p>
          </div>
          <div class="es-two">
            <div class="field">
              <label for="${esc(k)}-price">Precio por boleta</label>
              <div class="es-money"><span class="es-money-s" aria-hidden="true">$</span><input class="input" id="${esc(k)}-price" type="number" inputmode="numeric" min="0" max="50000000" step="1000" data-k="price" value="${o.price}"></div>
              <p class="es-hint">En la tienda: <b data-price-fmt>${fmt.cop(o.price)}</b></p>
            </div>
            <div class="field">
              <label for="${esc(k)}-cap">Cupo</label>
              <input class="input" id="${esc(k)}-cap" type="number" inputmode="numeric" min="${f.min}" max="100000" step="1" data-k="capacity" value="${o.capacity}">
              <p class="es-hint" data-cap-hint>${capHint(f)}</p>
              <p class="error" data-err-cap hidden></p>
            </div>
          </div>
          <div class="es-opt-foot">
            <button class="btn btn-sm btn-ghost es-del" type="button" data-del>${icon('trash', 16)}Borrar opción</button>
          </div>
        </div>
      </div>
    </li>`;
  }

  /* ---------- Vista del comprador: mismo marcado .opt de la tienda (evento.js), sin steppers ---------- */
  function availHTML(av) {
    const i = av.text.indexOf(' · ');
    if (i < 0) return `<span>${esc(av.text)}</span>`;
    return `<span>${esc(av.text.slice(0, i))}</span><span class="es-pv-proc">${esc(av.text.slice(i + 3))}</span>`;
  }
  function pvOptHTML(id, o) {
    const st = Store.optionStats(id, o.id);
    const av = LocMap.availability(st);
    const un = st.status === 'soldout' || st.status === 'process' || st.status === 'off';
    return `<div class="opt es-pv-opt ${un ? 'is-unavailable' : ''}" style="--oc:${esc(o.color)}">
      <span class="opt-swatch" aria-hidden="true"></span>
      <div class="opt-body">
        <p class="es-pv-seat">${icon(o.seating === 'numerada' ? 'seat' : 'users', 13)}${esc(LocMap.seatingLabel(o))}</p>
        <p class="opt-name">${esc(o.name)}</p>
        <p class="opt-note">${esc(o.note)}</p>
        <p class="opt-avail ${av.cls}">${availHTML(av)}</p>
      </div>
      <div class="opt-side">
        <p class="opt-price">${fmt.cop(o.price)}</p>
      </div>
    </div>`;
  }
  function pvListHTML(id) {
    const list = Store.options(id);
    if (!list.length) return `<div class="es-pv-empty">${icon('ticket', 20)}<p>Por ahora no hay boletas a la venta.</p></div>`;
    return list.map((o) => pvOptHTML(id, o)).join('');
  }

  /* ---------- Mismo recinto, otro evento ---------- */
  function tileHTML(e, current) {
    const opts = Store.options(e.id);
    const cap = opts.reduce((a, o) => a + o.capacity, 0);
    const inner = `<span class="es-tile-img"><img src="${esc(Store.mapImg(e.id))}" alt="Imagen de ubicaciones de ${esc(e.title)}" decoding="async"></span>
      <span class="es-tile-bar" aria-hidden="true">${distHTML(opts)}</span>
      <span class="es-tile-body">
        <span class="es-tile-k">${current ? 'Editando ahora' : esc(fmt.date(e.date))}</span>
        <span class="es-tile-t">${esc(e.title)}</span>
        <span class="es-tile-m">${fmt.plural(opts.length, 'opción', 'opciones')} · aforo ${fmt.num(cap)}</span>
        <span class="es-tile-lg">${opts.map((o) => `<span><i style="--c:${esc(o.color)}"></i>${esc(o.name)}</span>`).join('')}</span>
        ${current ? '' : `<span class="es-tile-go">Configurar este evento${icon('arrow', 16)}</span>`}
      </span>`;
    return current
      ? `<div class="es-tile is-current" aria-current="true">${inner}</div>`
      : `<button type="button" class="es-tile" data-switch="${esc(e.id)}">${inner}</button>`;
  }
  function sameHTML(id) {
    const vn = Store.venueOf(id);
    const list = D.events.filter((e) => e.venueId === vn.id).sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0));
    if (list.length < 2) return '';
    const tiles = list.map((e) => tileHTML(e, e.id === id));
    return list.length === 2 ? `${tiles[0]}<span class="es-vs" aria-hidden="true">≠</span>${tiles[1]}` : tiles.join('');
  }

  App.view({
    id: 'espacios', path: '/org/espacios', role: 'org', title: 'Espacios',

    render(params, query) {
      const id = App.orgEvent();
      const ev = Store.event(id);
      const vn = Store.venueOf(id);
      const t = totals(id);
      const preview = !!(query && query.get('vista') === 'comprador');
      const first = t.all[0];
      const hasSame = D.events.filter((e) => e.venueId === vn.id).length > 1;
      const when = `${cap1(fmt.dateLong(ev.date))} · ${fmt.time(ev.date)}`;
      const onSale = Store.options(id);
      const numbered = onSale.some((o) => o.seating === 'numerada');

      return `<div class="wrap-wide es-page">
        <header class="es-head">
          <div class="es-id">
            <img class="es-poster" src="${esc(ev.img)}" alt="" width="64" height="82">
            <div class="es-id-txt">
              <p class="eyebrow">Espacios del recinto · ${esc(ev.category)}</p>
              <h1 class="h1">${esc(ev.title)}</h1>
              <p class="es-when">${esc(cap1(fmt.dateLong(ev.date)))} · <span class="es-nowrap">${esc(fmt.time(ev.date))}</span></p>
            </div>
          </div>
          <div class="es-venue">
            <span class="es-venue-ico">${icon('pin', 18)}</span>
            <div class="es-venue-txt">
              <p class="es-venue-name">${esc(vn.name)}<span class="badge">${esc(vn.type)}</span></p>
              <p class="small muted">${esc(vn.address)} · ${esc(vn.city)}</p>
            </div>
          </div>
          <div class="stub-wrap es-aforo-wrap">
            <div class="stub es-aforo" data-aforo-stub>
              <div class="es-af-main">
                <p class="eyebrow">Aforo habilitado</p>
                <p class="es-af-n"><span data-aforo data-v="${t.cap}">${fmt.num(t.cap)}</span><span class="es-af-u">personas</span></p>
                <span class="es-dist" data-dist aria-hidden="true">${distHTML(t.on)}</span>
                <p class="es-af-cap">Suma de los cupos de las opciones habilitadas</p>
                <span class="sr-only" aria-live="polite" data-aforo-sr></span>
              </div>
              <div class="es-af-side">
                <p class="es-af-k" data-oncount>${t.on.length}<span>/${t.all.length}</span></p>
                <p class="es-af-l">opciones a la venta</p>
                <p class="es-af-occ" data-occ>${fmt.pct(t.pct)} ocupado</p>
              </div>
            </div>
          </div>
        </header>

        <span class="es-anchor" data-anchor aria-hidden="true"></span>
        <div class="es-modebar">
          <div class="seg" role="group" aria-label="Modo de la vista">
            <button type="button" data-mode="edit" class="${preview ? '' : 'is-on'}" aria-pressed="${!preview}">${icon('edit', 16)}Editar</button>
            <button type="button" data-mode="preview" class="${preview ? 'is-on' : ''}" aria-pressed="${preview}">${icon('eye', 16)}Vista del comprador</button>
          </div>
          <p class="es-live"><span class="dot-live" aria-hidden="true"></span>Los cambios se publican al instante en la tienda</p>
        </div>

        <section class="es-edit" data-pane="edit" ${preview ? 'hidden' : ''} aria-label="Imagen de ubicaciones y opciones de compra">
          <div class="es-col-img">
            <div class="panel es-imgpanel" data-drop>
              <div class="es-ph">
                <h2 class="eyebrow es-ph-t">Imagen de ubicaciones</h2>
                <span class="badge badge-line" data-imgbadge>Original</span>
              </div>
              <div class="es-figbox">
                <div class="es-figslot" data-figslot>${LocMap.figure(id, { caption: false })}</div>
                <span class="es-imgmeta" data-imgmeta aria-hidden="true"></span>
                <div class="es-dropover" aria-hidden="true">${svg(IC.upload, 28)}<span>Suelta la imagen para reemplazarla</span></div>
                <div class="es-busy" data-busy hidden><span class="es-spin" aria-hidden="true"></span><span>Optimizando imagen…</span></div>
              </div>
              <p class="es-claim">${svg(IC.image, 18)}<span>Cada evento usa su propia imagen: no hace falta un plano estándar.</span></p>
              <div class="es-drop">
                <span class="es-drop-ico">${svg(IC.upload, 22)}</span>
                <div class="es-drop-txt">
                  <p class="strong"><span class="es-t-fine">Sube o arrastra aquí otra imagen</span><span class="es-t-touch">Sube otra imagen</span></p>
                  <p class="tiny faint">JPG, PNG o WebP · se ajusta a 1.400 px de ancho</p>
                </div>
                <div class="es-drop-act">
                  <button class="btn btn-sm btn-ink" type="button" data-pick>${svg(IC.upload, 16)}Cambiar imagen</button>
                  <button class="btn btn-sm btn-ghost" type="button" data-restore hidden>${svg(IC.undo, 16)}Restaurar<span class="es-hide-s"> la original</span></button>
                </div>
                <input type="file" id="es-file" accept="image/*" hidden>
              </div>
            </div>
          </div>

          <div class="es-col-opts">
            <div class="es-oh">
              <div>
                <p class="eyebrow">Junto a tu imagen</p>
                <h2 class="h2">Opciones de compra</h2>
              </div>
              <span class="badge" data-count>${t.on.length} de ${t.all.length} a la venta</span>
            </div>
            <p class="small muted es-oh-sub">Una opción por zona de tu imagen, con su precio y su cupo. El cupo nunca baja de lo vendido ni de lo que se está pagando.</p>
            <ul class="es-opts" data-opts>
              ${t.all.map((o) => rowHTML(id, o, first && o.id === first.id, false)).join('')}
            </ul>
            <button class="btn btn-line btn-block es-add" type="button" data-add>${icon('plus', 18)}Agregar opción de compra</button>
            <button class="btn btn-ghost btn-block es-to-pv" type="button" data-mode="preview">${icon('eye', 18)}Ver cómo lo ve el comprador</button>
          </div>
        </section>

        <section class="es-preview" data-pane="preview" ${preview ? '' : 'hidden'} aria-label="Así lo ve el comprador">
          <div class="es-paper">
            <div class="es-pv-url" aria-hidden="true">
              <span class="es-pv-dots"><i></i><i></i><i></i></span>
              <span class="es-pv-addr">${icon('lock', 13)}aforo · /evento/${esc(id)}</span>
            </div>
            <div class="es-pv-top">
              <div class="es-pv-id">
                <p class="eyebrow">Así lo ve el comprador</p>
                <h2 class="h2">${esc(ev.title)}</h2>
                <p class="small muted">${esc(when)} · ${esc(vn.name)}</p>
              </div>
              <a class="btn btn-primary es-pv-open" href="#/evento/${esc(id)}">Abrir en la tienda${icon('arrow', 16)}</a>
            </div>
            <div class="es-pv-grid">
              <div class="es-pv-fig" data-pvfig>${LocMap.figure(id)}</div>
              <div class="es-pv-side">
                <div class="es-pv-sh"><h3 class="h3">Opciones de compra</h3><span class="es-pv-max">Máx. ${D.maxPerOrder} por compra</span></div>
                <p class="es-pv-rt"><i aria-hidden="true"></i>El cupo descuenta en tiempo real lo que otras personas están pagando: no se vende dos veces la misma boleta.</p>
                <div class="opt-list" data-pvlist>${pvListHTML(id)}</div>
                <p class="es-pv-foot" data-pvseat ${numbered ? '' : 'hidden'}>${icon('seat', 16)}<span>En las opciones numeradas, la fila y la silla se asignan al confirmar el pago.</span></p>
              </div>
            </div>
          </div>
          <div class="es-pv-after">
            <p class="es-pv-warn" data-pvwarn ${onSale.length ? 'hidden' : ''}>${icon('alert', 18)}<span>Ninguna opción está a la venta: habilita al menos una para que el evento se pueda comprar.</span></p>
            <button class="btn btn-line es-to-ed" type="button" data-mode="edit">${icon('edit', 18)}Volver a editar</button>
          </div>
        </section>

        ${hasSame ? `<section class="es-same" aria-labelledby="es-same-t">
          <div class="es-same-head">
            <p class="eyebrow">Mismo recinto, otro evento</p>
            <h2 class="h2" id="es-same-t">${esc(vn.name)}: cada evento trae su imagen</h2>
            <p class="small muted">${esc(VENUE_NOTES[vn.id] || 'El recinto no tiene un plano fijo: cada evento sube su propia imagen y define sus opciones de compra.')}</p>
          </div>
          <div class="es-same-grid" data-same>${sameHTML(id)}</div>
        </section>` : ''}
      </div>`;
    },

    mount(view, params, ctx) {
      const id = App.orgEvent();
      // #view se reutiliza entre vistas: los listeners van en el contenedor propio (se descarta al re-renderizar).
      const root = view.querySelector('.es-page');
      const $ = (s, el = root) => el.querySelector(s);
      const $$ = (s, el = root) => Array.from(el.querySelectorAll(s));
      const listEl = $('[data-opts]');
      const imgPanel = $('[data-drop]');
      const figSlot = $('[data-figslot]');
      const fileIn = $('#es-file');
      const pvList = $('[data-pvlist]');
      let mode = $('[data-pane="preview"]').hidden ? 'edit' : 'preview';
      let pvDirty = false;
      let sheetRef = null;
      let lastCap = totals(id).cap;
      const openIds = new Set($$('.es-opt.is-open').map((li) => li.dataset.opt));
      const newIds = new Set();
      const timers = new Map();        // optId → { t, patch } (cambios con debounce)
      const dirtyStats = new Set();    // opciones con disponibilidad por refrescar (≈1 s)

      Store.sim.focus(id);
      ctx.onLeave(() => Store.sim.focus(null));

      const row = (optId) => listEl.querySelector(`.es-opt[data-opt="${CSS.escape(optId)}"]`);
      const floor = (optId) => capFloor(id, optId);
      const chromeBottom = () => { const top = document.getElementById('chrome-top'); return top ? top.getBoundingClientRect().bottom : 0; };

      /* ---------- Aplicar cambios con debounce ---------- */
      function apply(optId, patch) {
        const o = Store.option(id, optId);
        if (!o) return;
        if ('capacity' in patch) {
          // Mientras corría la pausa pudieron entrar reservas nuevas: el cupo nunca queda por debajo del piso.
          const f = floor(optId);
          if (patch.capacity < f.min) {
            patch = Object.assign({}, patch, { capacity: f.min });
            const li = row(optId), capIn = li && $('[data-k="capacity"]', li);
            if (capIn && document.activeElement !== capIn) capIn.value = f.min;
            UI.toast(`El cupo de ${o.name} quedó en ${fmt.num(f.min)}: mientras escribías entraron boletas en proceso de pago.`, { type: 'warn' });
          }
        }
        if (Object.keys(patch).length) Store.updateOption(id, optId, patch);
      }
      function queue(optId, patch) {
        const prev = timers.get(optId);
        const merged = Object.assign({}, prev ? prev.patch : {}, patch);
        if (prev) clearTimeout(prev.t);
        const t = setTimeout(() => { timers.delete(optId); apply(optId, merged); }, DEBOUNCE);
        timers.set(optId, { t, patch: merged });
      }
      function flush(onlyId) {
        Array.from(timers.keys()).forEach((k) => {
          if (onlyId && k !== onlyId) return;
          const v = timers.get(k); clearTimeout(v.t); timers.delete(k); apply(k, v.patch);
        });
      }
      ctx.onLeave(() => { flush(); if (sheetRef) sheetRef.close(); });

      /* Valida el cupo escrito contra el piso actual. → número válido, false (bajo el piso) o null (vacío). */
      function checkCap(li, input) {
        const optId = li.dataset.opt;
        const f = floor(optId);
        const n = parseNum(input.value);
        const err = $('[data-err-cap]', li);
        if (!f || n == null) return null;
        if (n < f.min) {
          err.hidden = false;
          err.textContent = capErr(f);
          input.classList.add('is-invalid');
          const p = timers.get(optId);
          if (p && 'capacity' in p.patch) delete p.patch.capacity;
          return false;
        }
        err.hidden = true; input.classList.remove('is-invalid');
        return Math.min(100000, n);
      }

      /* ---------- Refrescos puntuales ---------- */
      function refreshStats(optId) {
        const li = row(optId), f = floor(optId);
        if (!li || !f) return;
        const { o, st } = f;
        const m = $('[data-h-meter]', li).children;
        if (m.length === 3) {
          m[0].style.width = pctW(st.sold, st.capacity);
          m[1].style.width = pctW(st.courtesy, st.capacity);
          m[2].style.width = pctW(st.held + st.mine, st.capacity);
        }
        $('[data-h-stat]', li).innerHTML = statHTML(o, st);
        const capIn = $('[data-k="capacity"]', li);
        capIn.min = f.min;
        $('[data-cap-hint]', li).textContent = capHint(f);
        if (document.activeElement === capIn) checkCap(li, capIn);
        else if (!timers.has(optId) && Number(capIn.value) !== o.capacity) capIn.value = o.capacity;
      }
      function refreshHead(optId) {
        const li = row(optId), o = Store.option(id, optId);
        if (!li || !o) return;
        li.style.setProperty('--oc', o.color);
        li.classList.toggle('is-off', !o.enabled);
        $('[data-h-name]', li).textContent = o.name;
        $('[data-h-price]', li).textContent = fmt.cop(o.price);
        $('[data-h-meta]', li).textContent = `${seatShort(o)} · ${fmt.num(o.capacity)} cupos`;
        $('[data-h-on]', li).textContent = o.enabled ? 'En venta' : 'Oculta';
        const cb = $('[data-k="enabled"]', li);
        if (!sheetRef) cb.checked = o.enabled;
        cb.setAttribute('aria-label', `${o.name}: a la venta en la tienda`);
        $('.es-opt-tg', li).setAttribute('aria-label', `Editar ${o.name}`);
        const nn = $('[data-newnote]', li);
        if (nn) nn.hidden = o.enabled;
        refreshStats(optId);
      }
      function refreshDist(el, on) {
        const ids = on.map((o) => o.id).join('|');
        const cur = Array.from(el.children).map((i) => i.dataset.d).join('|');
        if (ids !== cur) { el.innerHTML = distHTML(on); return; }
        Array.from(el.children).forEach((i, n) => { i.style.setProperty('--w', on[n].capacity); i.style.setProperty('--c', on[n].color); i.title = `${on[n].name} · ${fmt.num(on[n].capacity)}`; });
      }
      function refreshTotals() {
        const t = totals(id);
        if (t.cap !== lastCap) {
          const el = $('[data-aforo]');
          UI.tween(el, t.cap);
          ctx.later(700, () => { el.textContent = fmt.num(t.cap); }); // por si rAF está pausado
          $('[data-aforo-sr]').textContent = `Aforo habilitado: ${fmt.num(t.cap)} personas`;
          const stub = $('[data-aforo-stub]');
          stub.classList.remove('is-bump'); void stub.offsetWidth; stub.classList.add('is-bump');
          lastCap = t.cap;
        }
        refreshDist($('[data-dist]'), t.on);
        $('[data-oncount]').innerHTML = `${t.on.length}<span>/${t.all.length}</span>`;
        $('[data-occ]').textContent = `${fmt.pct(t.pct)} ocupado`;
        $('[data-count]').textContent = `${t.on.length} de ${t.all.length} a la venta`;
      }
      function refreshPreview(force) {
        if (mode !== 'preview' && !force) { pvDirty = true; return; }
        pvDirty = false;
        const on = Store.options(id);
        pvList.innerHTML = pvListHTML(id);
        $('[data-pvseat]').hidden = !on.some((o) => o.seating === 'numerada');
        $('[data-pvwarn]').hidden = !!on.length;
      }
      function refreshSame() { const s = $('[data-same]'); if (s) s.innerHTML = sameHTML(id); }
      function refreshImgMeta() {
        const custom = !!Store.state.mapImg[id];
        const badge = $('[data-imgbadge]');
        badge.textContent = custom ? 'Subida por ti' : 'Original';
        badge.className = 'badge ' + (custom ? 'badge-ok' : 'badge-line');
        $('[data-restore]').hidden = !custom;
        const img = figSlot.querySelector('img');
        const meta = $('[data-imgmeta]');
        meta.textContent = '';
        if (!img) return;
        const put = () => {
          const kb = custom ? Math.round((Store.state.mapImg[id] || '').length * 0.75 / 1024) : 0;
          meta.innerHTML = `<span>${fmt.num(img.naturalWidth)} × ${fmt.num(img.naturalHeight)} px</span>` + (custom ? `<span class="es-meta-kb">&nbsp;· JPEG ${fmt.num(kb)} KB</span>` : '');
        };
        if (img.complete && img.naturalWidth) put();
        else img.addEventListener('load', put, { once: true });
      }
      function refreshFigures() {
        figSlot.innerHTML = LocMap.figure(id, { caption: false });
        $('[data-pvfig]').innerHTML = LocMap.figure(id);
        figSlot.classList.remove('is-fresh'); void figSlot.offsetWidth; figSlot.classList.add('is-fresh');
        refreshImgMeta();
        refreshSame();
      }
      function rebuildList() {
        listEl.innerHTML = Store.options(id, true).map((o) => rowHTML(id, o, openIds.has(o.id), newIds.has(o.id))).join('');
      }

      /* ---------- Suscripciones (sin re-render completo) ---------- */
      ctx.sub('option', (e) => { if (e && e.eventId === id) dirtyStats.add(e.optionId); });
      ctx.sub('config', (e) => {
        if (!e || e.eventId !== id) return;
        if (e.mapImg) { refreshFigures(); return; }
        if (e.added) { openIds.add(e.optionId); newIds.add(e.optionId); rebuildList(); }
        else if (e.removed) rebuildList();
        else if (e.optionId) refreshHead(e.optionId);
        refreshTotals();
        refreshPreview();
        refreshSame();
      });
      ctx.every(1000, () => {
        if (!dirtyStats.size) return;
        dirtyStats.forEach((optId) => refreshStats(optId));
        dirtyStats.clear();
        $('[data-occ]').textContent = `${fmt.pct(totals(id).pct)} ocupado`;
        refreshPreview();
      });

      /* ---------- Acordeón ---------- */
      function toggleRow(li, force) {
        const open = force != null ? force : !li.classList.contains('is-open');
        li.classList.toggle('is-open', open);
        $('.es-opt-tg', li).setAttribute('aria-expanded', String(open));
        $('.es-opt-body', li).hidden = !open;
        $('[data-h-edit]', li).textContent = open ? 'Cerrar' : 'Editar';
        if (open) openIds.add(li.dataset.opt); else openIds.delete(li.dataset.opt);
      }

      /* ---------- Modo: editar / vista del comprador ---------- */
      function setMode(m) {
        if (m !== 'edit' && m !== 'preview') return;
        const changed = m !== mode;
        mode = m;
        flush();
        $$('.es-modebar [data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
        $('[data-pane="edit"]').hidden = m !== 'edit';
        $('[data-pane="preview"]').hidden = m !== 'preview';
        if (m === 'preview' && (pvDirty || changed)) refreshPreview(true);
        try { history.replaceState(null, '', '#/org/espacios' + (m === 'preview' ? '?vista=comprador' : '')); } catch (err) { /* sin historial */ }
        const limit = chromeBottom();
        const y = $('[data-anchor]').getBoundingClientRect().top;
        if (y < limit) window.scrollTo({ top: window.scrollY + y - limit - 8, behavior: 'smooth' });
      }

      /* ---------- Habilitar / deshabilitar ---------- */
      function setEnabled(li, on, input) {
        const optId = li.dataset.opt;
        flush(optId);
        const o = Store.option(id, optId);
        if (!o) return;
        if (on) {
          Store.updateOption(id, optId, { enabled: true });
          UI.toast(`${o.name} quedó a la venta en la tienda.`, { type: 'ok' });
          return;
        }
        const f = floor(optId);
        if (f.emitted > 0 || f.proc > 0) {
          let ok = false;
          const lead = f.emitted
            ? 'Esta opción ya tiene boletas emitidas. Siguen siendo válidas en la puerta: solo dejas de vender nuevas y la opción desaparece de la tienda.'
            : `Hay ${fmt.plural(f.proc, 'boleta', 'boletas')} en proceso de pago en este momento: quien las está pagando puede terminar su compra. No se venden nuevas y la opción desaparece de la tienda.`;
          sheetRef = UI.sheet({
            title: `¿Deshabilitar ${o.name}?`,
            body: `<div class="es-sheet">
              <p>${esc(lead)}</p>
              <dl class="kv es-sheet-kv">
                ${f.emitted ? `<div><dt>Vendidas</dt><dd>${fmt.num(o.sold)}</dd></div>` : ''}
                ${o.courtesy ? `<div><dt>Cortesías</dt><dd>${fmt.num(o.courtesy)}</dd></div>` : ''}
                ${f.proc ? `<div><dt>Pagando en este momento</dt><dd class="warn-txt">${fmt.num(f.proc)}</dd></div>` : ''}
                ${f.emitted ? `<div class="kv-total"><dt>Recaudo de la opción</dt><dd>${fmt.cop(f.st.revenue)}</dd></div>` : ''}
              </dl>
              ${f.proc && f.emitted ? '<p class="tiny faint">Quienes están pagando ahora pueden terminar su compra.</p>' : ''}
            </div>`,
            actions: '<button class="btn btn-line" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" data-confirm>Deshabilitar</button>',
            onClose: () => {
              sheetRef = null;
              if (ok) {
                Store.updateOption(id, optId, { enabled: false });
                const n = o.sold + o.courtesy;
                UI.toast(n
                  ? `${o.name} ya no se vende. ${fmt.plural(n, 'boleta emitida sigue válida', 'boletas emitidas siguen válidas')}.`
                  : `${o.name} ya no se vende. Quien está pagando puede terminar su compra.`, { type: 'ok', timeout: 4600 });
              } else if (input && input.isConnected) {
                input.checked = true;
              }
              if (input && input.isConnected) input.focus({ preventScroll: true });
            }
          });
          sheetRef.el.querySelector('[data-confirm]').addEventListener('click', () => { ok = true; sheetRef && sheetRef.close(); });
          return;
        }
        Store.updateOption(id, optId, { enabled: false });
        UI.toast(`${o.name} quedó oculta en la tienda.`, { type: 'info' });
      }

      /* ---------- Tipo de ubicación (pide confirmación si ya hay boletas emitidas) ---------- */
      function setSeat(li, v, btn) {
        const optId = li.dataset.opt;
        flush(optId);
        const o = Store.option(id, optId);
        if (!o || o.seating === v) return;
        const commit = () => {
          $$('[data-seat]', li).forEach((x) => { const on = x.dataset.seat === v; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
          $('[data-seat-hint]', li).textContent = SEAT_HINT[v];
          Store.updateOption(id, optId, { seating: v });
        };
        const n = o.sold + o.courtesy;
        if (!n) { commit(); return; }
        let ok = false;
        const toGeneral = v === 'general';
        sheetRef = UI.sheet({
          title: toGeneral ? `¿Pasar ${o.name} a acceso general?` : `¿Numerar las sillas de ${o.name}?`,
          body: `<div class="es-sheet">
            <p>${toGeneral
              ? `${esc(fmt.plural(n, 'boleta ya emitida conserva su fila y silla', 'boletas ya emitidas conservan su fila y silla'))}. Las nuevas serán de acceso general, sin silla asignada.`
              : `${esc(fmt.plural(n, 'boleta ya emitida sigue siendo', 'boletas ya emitidas siguen siendo'))} de acceso general. Las nuevas tendrán fila y silla, asignadas al confirmar el pago.`}</p>
            <p class="tiny faint">Si tu imagen de ubicaciones muestra esa zona de otra forma, actualízala también.</p>
          </div>`,
          actions: '<button class="btn btn-line" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" data-confirm>Cambiar el tipo</button>',
          onClose: () => {
            sheetRef = null;
            if (ok && li.isConnected) {
              commit();
              UI.toast(`${o.name} ahora es ${toGeneral ? 'de acceso general' : 'con silla numerada'} para las nuevas ventas.`, { type: 'ok' });
            }
            if (btn && btn.isConnected) btn.focus({ preventScroll: true });
          }
        });
        sheetRef.el.querySelector('[data-confirm]').addEventListener('click', () => { ok = true; sheetRef && sheetRef.close(); });
      }

      /* ---------- Agregar / borrar ---------- */
      function addOption() {
        flush();
        const used = new Set(Store.options(id, true).map((o) => String(o.color).toLowerCase()));
        const pick = PALETTE.find((p) => !used.has(p.hex.toLowerCase())) || PALETTE[PALETTE.length - 1];
        // Nace oculta: no se vende hasta que el organizador la configure y la active (lo dice la nota de la fila).
        const o = Store.addOption(id, { name: 'Nueva opción', note: '', seating: 'general', price: 100000, capacity: 100, color: pick.hex, enabled: false });
        const li = row(o.id);
        if (!li) return;
        const inp = $('[data-k="name"]', li);
        // Lleva el inicio de la fila justo debajo de la cabecera fija (insignia «Nueva» e interruptor a la vista).
        window.scrollTo({ top: Math.max(0, window.scrollY + li.getBoundingClientRect().top - chromeBottom() - 12), behavior: 'smooth' });
        ctx.later(60, () => { inp.focus({ preventScroll: true }); inp.select(); });
      }
      function nudge(li) {
        const sw = $('.es-onoff', li);
        sw.classList.remove('es-nudge'); void sw.offsetWidth; sw.classList.add('es-nudge');
        ctx.later(2000, () => sw.classList.remove('es-nudge'));
      }
      function delOption(li) {
        const optId = li.dataset.opt;
        const o = Store.option(id, optId);
        if (!o) return;
        const pend = timers.get(optId);
        if (pend) { clearTimeout(pend.t); timers.delete(optId); }
        const r = Store.removeOption(id, optId);
        if (!r.ok) {
          if (pend) apply(optId, pend.patch);
          if (o.enabled) {
            UI.toast(r.msg || 'No pudimos borrar esta opción.', { type: 'warn', timeout: 5600 });
            nudge(li);
          } else {
            UI.toast(`${o.name} ya tiene boletas vendidas o en proceso y no se puede borrar. Ya está oculta en la tienda.`, { type: 'warn', timeout: 5600 });
          }
          return;
        }
        openIds.delete(optId); newIds.delete(optId);
        UI.toast(`Borraste «${o.name}».${o.enabled ? ' Ya no aparece en la tienda.' : ''}`, { type: 'ok' });
      }

      /* ---------- Imagen: subir, optimizar en canvas, restaurar ---------- */
      const busy = (on) => { $('[data-busy]').hidden = !on; imgPanel.classList.toggle('is-busy', on); };
      const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = src; });
      async function processFile(file) {
        if (!file) return;
        if (!/^image\//i.test(file.type || '')) { UI.toast('Ese archivo no es una imagen. Sube un JPG, PNG o WebP.', { type: 'bad' }); return; }
        if (file.size > 25 * 1024 * 1024) { UI.toast('La imagen pesa más de 25 MB. Expórtala más liviana e inténtalo de nuevo.', { type: 'warn' }); return; }
        busy(true);
        const url = URL.createObjectURL(file);
        try {
          const im = await loadImage(url);
          const w0 = im.naturalWidth || 1200, h0 = im.naturalHeight || 900;
          const sc = Math.min(1, MAX_W / w0);
          const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); // PNG con transparencia → fondo blanco en JPEG
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
          g.drawImage(im, 0, 0, w, h);
          const data = c.toDataURL('image/jpeg', QUALITY);
          if (!root.isConnected) return;
          Store.setMapImage(id, data);
          UI.toast(`Imagen actualizada (${fmt.num(w)} × ${fmt.num(h)} px). La tienda ya la muestra.`, { type: 'ok' });
        } catch (err) {
          UI.toast('No pudimos leer esa imagen. Prueba con otro archivo.', { type: 'bad' });
        } finally {
          URL.revokeObjectURL(url);
          busy(false);
        }
      }
      function restore() {
        Store.setMapImage(id, null);
        $('[data-pick]').focus({ preventScroll: true }); // el botón «Restaurar» se oculta: el foco no cae en body
        UI.toast('Volvimos a la imagen original del evento.', { type: 'info' });
      }

      const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
      let dragDepth = 0;
      imgPanel.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; imgPanel.classList.add('is-drag'); });
      imgPanel.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      imgPanel.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) imgPanel.classList.remove('is-drag'); });
      imgPanel.addEventListener('drop', (e) => {
        e.preventDefault(); dragDepth = 0; imgPanel.classList.remove('is-drag');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        processFile(f);
      });
      // Evita que el navegador abra el archivo si se suelta fuera del panel.
      const stopDrop = (e) => { if (hasFiles(e)) e.preventDefault(); };
      document.addEventListener('dragover', stopDrop);
      document.addEventListener('drop', stopDrop);
      ctx.onLeave(() => { document.removeEventListener('dragover', stopDrop); document.removeEventListener('drop', stopDrop); });

      /* ---------- Delegación de eventos ---------- */
      root.addEventListener('click', (e) => {
        let b;
        if ((b = e.target.closest('[data-mode]'))) { setMode(b.dataset.mode); return; }
        if ((b = e.target.closest('.es-opt-tg'))) { toggleRow(b.closest('.es-opt')); return; }
        if ((b = e.target.closest('[data-seat]'))) { setSeat(b.closest('.es-opt'), b.dataset.seat, b); return; }
        if ((b = e.target.closest('[data-del]'))) { delOption(b.closest('.es-opt')); return; }
        if (e.target.closest('[data-add]')) { addOption(); return; }
        if (e.target.closest('[data-pick]')) { fileIn.click(); return; }
        if (e.target.closest('[data-restore]')) { restore(); return; }
        if ((b = e.target.closest('[data-switch]'))) {
          const to = b.dataset.switch;
          flush();
          App.setOrgEvent(to);
          window.scrollTo(0, 0); // el contenido cambia entero: salto directo arriba
          UI.toast(`Ahora configuras ${Store.event(to).title}.`, { type: 'info' });
        }
      });

      root.addEventListener('input', (e) => {
        const t = e.target, k = t.dataset && t.dataset.k;
        if (!k || k === 'color' || k === 'enabled') return;
        const li = t.closest('.es-opt');
        if (!li) return;
        const optId = li.dataset.opt;
        if (k === 'name') {
          const v = t.value.trim();
          $('[data-err-name]', li).hidden = !!v;
          t.classList.toggle('is-invalid', !v);
          if (v) { $('[data-h-name]', li).textContent = v; queue(optId, { name: v }); }
        } else if (k === 'note') {
          queue(optId, { note: t.value.trim() });
        } else if (k === 'price') {
          const n = parseNum(t.value);
          if (n == null) return;
          const v = Math.min(50000000, Math.max(0, n));
          $('[data-price-fmt]', li).textContent = fmt.cop(v);
          $('[data-h-price]', li).textContent = fmt.cop(v);
          queue(optId, { price: v });
        } else if (k === 'capacity') {
          const v = checkCap(li, t);
          if (typeof v === 'number') queue(optId, { capacity: v });
        }
      });

      root.addEventListener('focusout', (e) => {
        const t = e.target, k = t.dataset && t.dataset.k;
        if (!k) return;
        const li = t.closest('.es-opt');
        if (!li) return;
        const optId = li.dataset.opt;
        const o = Store.option(id, optId);
        if (!o) return;
        if (k === 'name' && !t.value.trim()) {
          const p = timers.get(optId);
          t.value = (p && p.patch.name) || o.name;
          t.classList.remove('is-invalid'); $('[data-err-name]', li).hidden = true;
          $('[data-h-name]', li).textContent = t.value;
        } else if (k === 'price' && parseNum(t.value) == null) {
          t.value = o.price; $('[data-price-fmt]', li).textContent = fmt.cop(o.price);
        } else if (k === 'capacity') {
          const f = floor(optId), n = parseNum(t.value);
          const p = timers.get(optId);
          if (n == null) { t.value = o.capacity; }
          else if (n < f.min) {
            t.value = f.min;
            queue(optId, { capacity: f.min });
            UI.toast(f.proc
              ? `El cupo de ${o.name} quedó en ${fmt.num(f.min)}: lo mínimo por las boletas emitidas y las que se están pagando.`
              : `El cupo de ${o.name} quedó en ${fmt.num(f.min)}, lo mínimo por las boletas ya emitidas.`, { type: 'warn' });
          } else if (!(p && 'capacity' in p.patch) && Math.min(100000, n) !== o.capacity) {
            // El valor quedó válido después (venció una reserva) sin haberse encolado.
            queue(optId, { capacity: Math.min(100000, n) });
          }
          t.classList.remove('is-invalid'); $('[data-err-cap]', li).hidden = true;
        }
      });

      root.addEventListener('change', (e) => {
        const t = e.target;
        if (t === fileIn) { processFile(t.files && t.files[0]); t.value = ''; return; }
        const k = t.dataset && t.dataset.k;
        const li = t.closest && t.closest('.es-opt');
        if (!k || !li) return;
        if (k === 'color' && t.checked) {
          li.style.setProperty('--oc', t.value);
          Store.updateOption(id, li.dataset.opt, { color: t.value });
        } else if (k === 'enabled') {
          setEnabled(li, t.checked, t);
        }
      });

      refreshImgMeta();
    }
  });
})();
