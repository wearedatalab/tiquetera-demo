/* Shell de la tienda: cabecera del comprador, router por hash y registro de vistas.
   Las vistas viven en views/*.js y se registran con App.view(). */
(function () {
  'use strict';
  const { esc, icon, wordmark, fmt } = UI;

  /* ---------------- Registro de vistas ---------------- */
  const views = [];
  function view(def) {
    const keys = [];
    const re = new RegExp('^' + def.path.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    views.push(Object.assign({ title: '' }, def, { re, keys }));
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
    if (!m) { go('/', { replace: true }); return; } // rutas que no existen vuelven a la cartelera
    const prev = current;
    if (prev.path !== path) UI.closeSheets();
    runCleanups();
    const viewEl = document.getElementById('view');
    current = { path, v: m.v, params: m.params };
    setNav(path);
    document.title = (m.v.title ? (typeof m.v.title === 'function' ? m.v.title(m.params) : m.v.title) + ' · ' : '') + 'aforo · boletería en línea';
    try {
      viewEl.innerHTML = m.v.render(m.params, query()) || '';
      viewEl.className = 'view view-' + m.v.id;
      if (m.v.mount) {
        const c = m.v.mount(viewEl, m.params, makeCtx(), query());
        if (typeof c === 'function') cleanups.push(c);
      }
    } catch (e) {
      console.error(e);
      viewEl.innerHTML = `<div class="wrap empty"><p class="eyebrow">Algo salió mal</p><p>${esc(e.message)}</p></div>`;
    }
    if (!prev.v || prev.v.id !== m.v.id || prev.path !== path) {
      if (!(m.v.keepScroll && prev.v && prev.v.id === m.v.id)) window.scrollTo(0, 0);
    }
    const h1 = viewEl.querySelector('h1');
    if (h1 && prev.path) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  function rerender() { render(); }

  /* ---------------- Cabecera ---------------- */
  function header() {
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
  function setNav(path) {
    document.querySelectorAll('#chrome-top [data-nav]').forEach((a) => {
      const on = a.dataset.nav === path;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    refreshBadges();
    refreshHoldPill();
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

  /* ---------------- Arranque ---------------- */
  function boot() {
    document.getElementById('chrome-top').innerHTML = header();
    // Navegación por data-go en elementos que no son enlaces
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g && !g.closest('a[href]')) { e.preventDefault(); go(g.dataset.go); }
    });
    Store.on('notify', refreshBadges);
    Store.on('hold', refreshHoldPill);
    Store.on('hold-expired', () => UI.toast('Tu reserva expiró y liberamos las boletas apartadas.', { type: 'warn', timeout: 5200 }));
    Store.on('reset', render);
    setInterval(refreshHoldPill, 1000);
    window.addEventListener('hashchange', render);
    Store.sim.start();
    render();
  }

  window.App = { view, go, rerender, render, get current() { return current; }, query, refreshBadges };
  document.addEventListener('DOMContentLoaded', boot);
})();
