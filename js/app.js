/* Shell del demo: barra de demo (cambio de rol), cabeceras por rol, router por hash
   y registro de vistas. Las vistas viven en views/*.js y se registran con App.view(). */
(function () {
  'use strict';
  const { esc, icon, wordmark, fmt } = UI;
  const D = window.DATA;

  const ROLES = {
    buyer: { label: 'Comprador', short: 'Comprar', icon: 'ticket', home: '/', theme: 'light' },
    org: { label: 'Organizador', short: 'Organizar', icon: 'chart', home: '/org', theme: 'dark' },
    access: { label: 'Control de acceso', short: 'Acceso', icon: 'scan', home: '/acceso', theme: 'dark' },
    guide: { label: 'Guía del demo', short: 'Guía', icon: 'listCheck', home: '/guia', theme: 'light' }
  };
  const ORG_TABS = [
    { path: '/org', label: 'Ventas', icon: 'chart' },
    { path: '/org/reservas', label: 'Reservas', icon: 'timer' },
    { path: '/org/promos', label: 'Cortesías y cupones', short: 'Promos', icon: 'gift' },
    { path: '/org/espacios', label: 'Espacios', icon: 'layers' }
  ];

  /* ---------------- Registro de vistas ---------------- */
  const views = [];
  function view(def) {
    const keys = [];
    const re = new RegExp('^' + def.path.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    views.push(Object.assign({ role: 'buyer', title: '' }, def, { re, keys }));
  }
  function match(path) {
    for (const v of views) {
      const m = path.match(v.re);
      if (m) {
        const params = {};
        v.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { v, params };
      }
    }
    return null;
  }

  /* ---------------- Contexto de montaje (limpieza automática) ---------------- */
  let cleanups = [];
  function makeCtx() {
    return {
      sub(type, fn) { cleanups.push(Store.on(type, fn)); },
      every(ms, fn) { const t = setInterval(fn, ms); cleanups.push(() => clearInterval(t)); return t; },
      later(ms, fn) { const t = setTimeout(fn, ms); cleanups.push(() => clearTimeout(t)); return t; },
      onLeave(fn) { cleanups.push(fn); }
    };
  }
  function runCleanups() { cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); cleanups = []; }

  /* ---------------- Router ---------------- */
  let current = { path: null, v: null, params: {} };
  const getPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const query = () => new URLSearchParams((location.hash.split('?')[1]) || '');

  function go(path, { replace = false } = {}) {
    const h = '#' + path;
    if (replace) { history.replaceState(null, '', h); render(); return; }
    if (location.hash !== h) { location.hash = h; return; } // el evento hashchange renderiza una sola vez
    render();
  }

  function render() {
    const path = getPath();
    const m = match(path);
    const prev = current;
    runCleanups();
    const viewEl = document.getElementById('view');
    if (!m) {
      current = { path, v: null, params: {} };
      setChrome('buyer', path);
      viewEl.innerHTML = notFound(path);
      return;
    }
    current = { path, v: m.v, params: m.params };
    setChrome(m.v.role, path);
    document.title = (m.v.title ? (typeof m.v.title === 'function' ? m.v.title(m.params) : m.v.title) + ' · ' : '') + 'aforo · demo tiquetera';
    try {
      viewEl.innerHTML = m.v.render(m.params, query()) || '';
      viewEl.className = 'view view-' + m.v.id;
      if (m.v.mount) {
        const c = m.v.mount(viewEl, m.params, makeCtx(), query());
        if (typeof c === 'function') cleanups.push(c);
      }
    } catch (e) {
      console.error(e);
      viewEl.innerHTML = `<div class="wrap empty"><p class="eyebrow">Error en la vista</p><p>${esc(e.message)}</p></div>`;
    }
    if (!prev.v || prev.v.id !== m.v.id || prev.path !== path) {
      if (!(m.v.keepScroll && prev.v && prev.v.id === m.v.id)) window.scrollTo(0, 0);
    }
    const h1 = viewEl.querySelector('h1');
    if (h1 && prev.path) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  function rerender() { render(); }

  function notFound(path) {
    return `<div class="wrap empty-page">
      <p class="eyebrow">Vista no disponible</p>
      <h1 class="h1">Esta pantalla aún no está en el demo</h1>
      <p class="muted">Ruta: <span class="mono">${esc(path)}</span></p>
      <a class="btn btn-primary" href="#/">Ir a la cartelera</a>
    </div>`;
  }

  /* ---------------- Chrome por rol ---------------- */
  let chromeRole = null;
  function setChrome(role, path) {
    const r = ROLES[role] || ROLES.buyer;
    const app = document.getElementById('app');
    app.dataset.role = role;
    document.documentElement.dataset.theme = r.theme;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', r.theme === 'dark' ? '#0F0D18' : '#F6F2EA');
    // Barra de demo
    document.querySelectorAll('#demo-bar [data-role-btn]').forEach((b) => {
      const on = b.dataset.roleBtn === role;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    if (chromeRole !== role) {
      chromeRole = role;
      document.getElementById('chrome-top').innerHTML = topFor(role);
      document.getElementById('chrome-nav').innerHTML = role === 'org' ? orgNav() : '';
    }
    // Pestaña activa del organizador
    document.querySelectorAll('#chrome-nav [data-tab]').forEach((a) => {
      const on = a.dataset.tab === path || (a.dataset.tab !== '/org' && path.startsWith(a.dataset.tab));
      a.classList.toggle('is-on', on);
      a.setAttribute('aria-current', on ? 'page' : 'false');
    });
    document.querySelectorAll('#chrome-top [data-nav]').forEach((a) => a.classList.toggle('is-on', a.dataset.nav === path));
    refreshBadges();
    refreshHoldPill();
  }

  function topFor(role) {
    if (role === 'org') {
      return `<div class="top top-org">
        <div class="top-in wrap-wide">
          <a class="top-brand" href="#/org" aria-label="Panel del organizador">${wordmark(24)}<span class="top-tag">Organizador</span></a>
          <label class="top-select">
            <span class="sr-only">Evento</span>
            ${icon('calendar', 16)}
            <select data-org-event aria-label="Evento a controlar">${D.events.map((e) => `<option value="${e.id}" ${e.id === orgEvent() ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select>
            ${icon('down', 16)}
          </label>
        </div>
      </div>`;
    }
    if (role === 'access') {
      return `<div class="top top-access">
        <div class="top-in wrap-wide">
          <a class="top-brand" href="#/acceso" aria-label="Control de acceso">${wordmark(24)}<span class="top-tag">Acceso</span></a>
          <span class="top-status"><span class="dot-live"></span>En línea</span>
        </div>
      </div>`;
    }
    if (role === 'guide') {
      return `<div class="top top-buyer">
        <div class="top-in wrap-wide">
          <a class="top-brand" href="#/" aria-label="aforo, ir a la cartelera">${wordmark(26)}</a>
          <a class="btn btn-sm btn-ink" href="#/">Abrir la tienda ${icon('arrow', 16)}</a>
        </div>
      </div>`;
    }
    return `<div class="top top-buyer">
      <div class="top-in wrap-wide">
        <a class="top-brand" href="#/" aria-label="aforo, ir a la cartelera">${wordmark(26)}</a>
        <nav class="top-links" aria-label="Principal">
          <a href="#/" data-nav="/">Cartelera</a>
          <a href="#/boletas" data-nav="/boletas">Mis boletas</a>
        </nav>
        <div class="top-actions">
          <a class="hold-pill" href="#/checkout" data-hold-pill hidden>${icon('timer', 16)}<span class="mono" data-hold-left>8:00</span><span class="hold-pill-qty" data-hold-qty></span></a>
          <a class="icon-btn top-mine" href="#/boletas" aria-label="Mis boletas">${icon('ticket', 21)}</a>
          <a class="icon-btn top-bell" href="#/avisos" aria-label="Notificaciones">${icon('bell', 21)}<span class="badge-dot" data-unread hidden></span></a>
        </div>
      </div>
    </div>`;
  }
  function orgNav() {
    return `<nav class="org-nav" aria-label="Panel del organizador">
      ${ORG_TABS.map((t) => `<a href="#${t.path}" data-tab="${t.path}">${icon(t.icon, 20)}<span class="org-nav-l">${t.label}</span><span class="org-nav-s">${t.short || t.label}</span></a>`).join('')}
      <div class="org-nav-foot">
        <p class="eyebrow">App del organizador</p>
        <p class="muted small">Ventas, reservas, cortesías, cupones y espacios del recinto en tiempo real.</p>
      </div>
    </nav>`;
  }

  function refreshBadges() {
    const b = document.querySelector('[data-unread]');
    if (!b) return;
    const n = Store.unread();
    b.hidden = !n;
    b.textContent = n > 9 ? '9+' : n;
  }
  function refreshHoldPill() {
    const pill = document.querySelector('[data-hold-pill]');
    if (!pill) return;
    const h = Store.myHold();
    const onCheckout = current.v && (current.v.id === 'checkout' || current.v.id === 'pago');
    pill.hidden = !h || onCheckout;
    if (!h) return;
    pill.querySelector('[data-hold-left]').textContent = fmt.mmss((h.until - Date.now()) / 1000);
    const q = Store.holdCount();
    pill.querySelector('[data-hold-qty]').textContent = q + (q === 1 ? ' boleta' : ' boletas');
    pill.setAttribute('aria-label', `Reserva activa: ${q} ${q === 1 ? 'boleta' : 'boletas'}, expira en ${fmt.mmss((h.until - Date.now()) / 1000)}. Ir a pagar`);
    pill.classList.toggle('is-urgent', h.until - Date.now() < 60000);
  }

  /* ---------------- Organizador: evento activo ---------------- */
  function orgEvent() { return Store.state.ui.orgEventId || D.events[0].id; }
  function setOrgEvent(id) {
    Store.state.ui.orgEventId = id; Store.save();
    const sel = document.querySelector('[data-org-event]');
    if (sel && sel.value !== id) sel.value = id;
    Store.emit('org-event', id);
    rerender();
  }

  /* ---------------- Arranque ---------------- */
  function bootChrome() {
    document.getElementById('demo-bar').innerHTML = `
      <div class="demo-in wrap-wide">
        <a class="demo-brand" href="#/guia" aria-label="Guía del demo">${UI.logo(20)}<span class="demo-tag">Demo</span><span class="demo-ref">${esc(D.quote.code)}</span></a>
        <nav class="demo-roles" aria-label="Cambiar de vista">
          ${['buyer', 'org', 'access'].map((k) => `<a href="#${ROLES[k].home}" data-role-btn="${k}">${icon(ROLES[k].icon, 16)}<span class="dr-l">${ROLES[k].label}</span><span class="dr-s">${ROLES[k].short}</span></a>`).join('')}
        </nav>
        <a class="demo-guide" href="#/guia" data-role-btn="guide" aria-label="Guía del demo">${icon('listCheck', 17)}<span class="dg-l">Guía</span></a>
      </div>`;

    document.addEventListener('change', (e) => {
      const s = e.target.closest('[data-org-event]');
      if (s) setOrgEvent(s.value);
    });
    // Navegación por data-go en elementos que no son enlaces
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g && !g.closest('a[href]')) { e.preventDefault(); go(g.dataset.go); }
    });

    Store.on('notify', refreshBadges);
    Store.on('hold', refreshHoldPill);
    Store.on('hold-expired', () => UI.toast('Tu reserva expiró y liberamos las boletas apartadas.', { type: 'warn', timeout: 5200 }));
    Store.on('reset', () => { chromeRole = null; render(); });
    setInterval(refreshHoldPill, 1000);
    window.addEventListener('hashchange', render);
    Store.sim.start();
    render();
  }

  window.App = { view, go, rerender, render, ROLES, ORG_TABS, orgEvent, setOrgEvent, get current() { return current; }, query, refreshBadges };
  document.addEventListener('DOMContentLoaded', bootChrome);
})();
