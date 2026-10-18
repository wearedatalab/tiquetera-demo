/* UI compartida: formato, íconos, toasts, hojas (sheet), QR, utilidades. */
(function () {
  'use strict';

  const TZ = 'America/Bogota';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const nf = new Intl.NumberFormat('es-CO');
  const fmt = {
    num: (n) => nf.format(Math.round(n || 0)),
    cop: (n) => '$' + nf.format(Math.round(n || 0)),
    /* "$1,2 M" para cifras grandes en tableros */
    copShort: (n) => {
      const v = Math.round(n || 0);
      if (v >= 1e9) return '$' + (v / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' mil M';
      if (v >= 1e6) return '$' + (v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M';
      return '$' + nf.format(v);
    },
    pct: (x, d = 0) => (Math.round((x || 0) * 100 * 10 ** d) / 10 ** d).toLocaleString('es-CO') + ' %',
    /* "sáb 14 nov" */
    date: (iso) => new Date(iso).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }).replace(/\./g, '').replace(',', ''),
    /* "sábado 14 de noviembre" */
    dateLong: (iso) => new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).replace(',', ''),
    day: (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', timeZone: TZ }),
    month: (iso) => new Date(iso).toLocaleDateString('es-CO', { month: 'short', timeZone: TZ }).replace('.', ''),
    weekday: (iso) => new Date(iso).toLocaleDateString('es-CO', { weekday: 'short', timeZone: TZ }).replace('.', ''),
    /* "8:00 p. m." */
    time: (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: TZ }),
    /* "14:32:05" para bitácoras */
    clock: (ts) => new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TZ }),
    mmss: (sec) => {
      sec = Math.max(0, Math.ceil(sec));
      return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    },
    /* "hace 2 min" */
    ago: (ts) => {
      const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (s < 10) return 'ahora';
      if (s < 60) return 'hace ' + s + ' s';
      const m = Math.round(s / 60);
      if (m < 60) return 'hace ' + m + ' min';
      const h = Math.round(m / 60);
      if (h < 24) return 'hace ' + h + ' h';
      return 'hace ' + Math.round(h / 24) + ' d';
    },
    plural: (n, one, many) => fmt.num(n) + ' ' + (n === 1 ? one : many)
  };

  /* Íconos de trazo (24×24, stroke currentColor). */
  const P = {
    ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M14 6v2M14 11v2M14 16v2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M12 2v3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
    scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12Z"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    bars: '<path d="M6 20V10M12 20V4M18 20v-7"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    bank: '<path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/>',
    wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><circle cx="16.5" cy="13.5" r="1.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="4"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    listCheck: '<path d="M11 6h10M11 12h10M11 18h10"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
    seat: '<path d="M6 11V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v5"/><path d="M4 11h16v5H4zM6 16v4M18 16v4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    door: '<path d="M4 21h16M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M14 12h.01"/>',
    filter: '<path d="M3 5h18l-7 9v6l-4-2v-4L3 5Z"/>',
    flame: '<path d="M12 22c4 0 7-2.7 7-7 0-4-3-6.5-4-9-1.5 2-2.5 3-4 3 0-2 .5-4 1-6-4 2-7 6.5-7 12 0 4.3 3 7 7 7Z"/>',
    queue: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M3 18h18"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="M7 4v16l13-8L7 4Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    external: '<path d="M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    code: '<path d="m8 16-4-4 4-4M16 8l4 4-4 4M14 4l-4 16"/>'
  };
  const icon = (name, size = 20, cls = '') =>
    `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;

  /* Marca: boleta con muesca + punto (silla). */
  const logo = (size = 26) =>
    `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M6 4h20a2 2 0 0 1 2 2v6.2a3.8 3.8 0 0 0 0 7.6V26a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6.2a3.8 3.8 0 0 0 0-7.6V6a2 2 0 0 1 2-2Z"/><circle cx="16" cy="16" r="4.2" fill="var(--accent)"/></svg>`;
  const wordmark = (size = 26) =>
    `<span class="wordmark">${logo(size)}<span class="wordmark-txt">aforo</span></span>`;

  /* PRNG con semilla (mulberry32) y hash de texto, para que el demo sea determinista. */
  const hash = (str) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const rng = (seed) => {
    let a = typeof seed === 'string' ? hash(seed) : seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

  const B32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const code = (n = 4, r = Math.random) => Array.from({ length: n }, () => B32[Math.floor(r() * B32.length)]).join('');
  const uid = (prefix = 'id') => prefix + '-' + Date.now().toString(36) + code(4).toLowerCase();

  /* ---------- Toasts ---------- */
  function toast(msg, opts = {}) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const type = opts.type || 'info';
    const ic = opts.icon || ({ ok: 'checkCircle', warn: 'alert', bad: 'xCircle', info: 'info' })[type];
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'bad' ? 'alert' : 'status');
    el.innerHTML = icon(ic, 18) + `<div class="toast-txt">${opts.html ? msg : esc(msg)}</div>`;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const t = setTimeout(close, opts.timeout || 3600);
    function close() {
      clearTimeout(t);
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 260);
    }
    el.addEventListener('click', close);
    return close;
  }

  /* ---------- Hoja inferior (móvil) / modal centrado (escritorio) ----------
     sheet({ title, body: html, actions: html, onClose, wide }) → { el, close } */
  function sheet(opts = {}) {
    const root = document.getElementById('sheet-root');
    const wrap = document.createElement('div');
    wrap.className = 'sheet-layer';
    wrap.innerHTML = `
      <div class="sheet-backdrop" data-close></div>
      <section class="sheet ${opts.wide ? 'sheet-wide' : ''} ${opts.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || 'Detalle')}">
        <div class="sheet-grip" aria-hidden="true"></div>
        <header class="sheet-head">
          <h2 class="h3">${esc(opts.title || '')}</h2>
          <button class="icon-btn" data-close aria-label="Cerrar">${icon('x', 20)}</button>
        </header>
        <div class="sheet-body">${opts.body || ''}</div>
        ${opts.actions ? `<footer class="sheet-foot">${opts.actions}</footer>` : ''}
      </section>`;
    root.appendChild(wrap);
    document.body.classList.add('has-sheet');
    requestAnimationFrame(() => wrap.classList.add('is-in'));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    let closed = false;
    function close() {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey);
      wrap.classList.remove('is-in');
      setTimeout(() => {
        wrap.remove();
        if (!root.children.length) document.body.classList.remove('has-sheet');
      }, 260);
      opts.onClose && opts.onClose();
    }
    const first = wrap.querySelector('.sheet-body input, .sheet-body button, .sheet-foot button');
    setTimeout(() => (first || wrap.querySelector('.sheet')).focus && (first || wrap.querySelector('.sheet')).focus({ preventScroll: true }), 60);
    return { el: wrap.querySelector('.sheet'), close };
  }

  /* ---------- QR ----------
     Usa qrcode-generator (cdnjs) si cargó; si no, dibuja un patrón determinista
     con los tres marcadores de posición (sirve visualmente, no se escanea). */
  function qr(text, opts = {}) {
    const dark = opts.dark || '#14121F';
    const light = opts.light || '#FFFFFF';
    const cls = opts.cls || '';
    let n, isDark;
    if (window.qrcode) {
      try {
        const q = window.qrcode(0, 'M');
        q.addData(text);
        q.make();
        n = q.getModuleCount();
        isDark = (r, c) => q.isDark(r, c);
      } catch (e) { n = 0; }
    }
    if (!n) {
      n = 29;
      const r = rng(text);
      const finder = (rr, cc) => {
        const inBox = (r0, c0) => rr >= r0 && rr < r0 + 7 && cc >= c0 && cc < c0 + 7;
        const box = inBox(0, 0) ? [0, 0] : inBox(0, n - 7) ? [0, n - 7] : inBox(n - 7, 0) ? [n - 7, 0] : null;
        if (!box) return null;
        const y = rr - box[0], x = cc - box[1];
        return (y === 0 || y === 6 || x === 0 || x === 6) || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
      };
      const grid = [];
      for (let y = 0; y < n; y++) { grid[y] = []; for (let x = 0; x < n; x++) { const f = finder(y, x); grid[y][x] = f === null ? r() > 0.52 : f; } }
      isDark = (y, x) => grid[y][x];
    }
    const pad = 2, size = n + pad * 2;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (isDark(y, x)) d += `M${x + pad} ${y + pad}h1v1h-1z`;
    return `<svg class="qr ${cls}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Código QR de la boleta"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  }

  /* Cuenta regresiva: actualiza el texto de el cada segundo. Devuelve stop(). */
  function countdown(el, until, onEnd) {
    let done = false;
    const tick = () => {
      const left = (until - Date.now()) / 1000;
      if (el) el.textContent = fmt.mmss(left);
      if (left <= 0 && !done) { done = true; clearInterval(t); onEnd && onEnd(); }
    };
    const t = setInterval(tick, 1000);
    tick();
    return () => clearInterval(t);
  }

  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* Número que cuenta hasta su valor (para cifras que cambian en vivo). */
  function tween(el, to, { dur = 600, format = fmt.num } = {}) {
    if (!el) return;
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = format(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = clamp((t - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  window.UI = { esc, fmt, icon, logo, wordmark, hash, rng, pick, code, uid, toast, sheet, qr, countdown, loadScript, sleep, clamp, tween, TZ };
})();
