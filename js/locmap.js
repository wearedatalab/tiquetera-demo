/* Imagen de ubicaciones del evento (la sube el organizador; no hay plano estandarizado)
   + etiquetas de disponibilidad de cada opción de compra. */
(function () {
  'use strict';
  const { esc, fmt, icon } = UI;

  /* figure(eventId, { zoom:true, caption:true, cls }) → <figure class="locmap"> con la imagen.
     Si zoom, incluye el botón [data-locmap-zoom] (ábrelo con LocMap.zoom o deja que el listener global lo haga). */
  function figure(eventId, opts = {}) {
    const ev = Store.event(eventId);
    const src = Store.mapImg(eventId);
    const zoom = opts.zoom !== false;
    return `<figure class="locmap ${opts.cls || ''}">
      <div class="locmap-frame">
        <img src="${esc(src)}" alt="Imagen de ubicaciones de ${esc(ev.title)} en ${esc(Store.venueOf(eventId).name)}" loading="lazy" decoding="async">
        ${zoom ? `<button class="locmap-zoom" type="button" data-locmap-zoom="${esc(eventId)}" aria-label="Ampliar la imagen de ubicaciones">${icon('search', 16)}<span>Ampliar</span></button>` : ''}
      </div>
      ${opts.caption !== false ? `<figcaption class="locmap-cap">${icon('info', 14)}Imagen de ubicaciones publicada por el organizador</figcaption>` : ''}
    </figure>`;
  }

  /* Hoja con la imagen a tamaño completo: toque para alternar ajustar / 2×, con desplazamiento libre. */
  function zoom(eventId) {
    const ev = Store.event(eventId);
    const s = UI.sheet({
      title: 'Ubicaciones · ' + ev.title, wide: true, cls: 'sheet-locmap',
      body: `<div class="locmap-full" data-fit="1"><img src="${esc(Store.mapImg(eventId))}" alt="Imagen de ubicaciones de ${esc(ev.title)}"></div>
             <p class="tiny faint" style="margin-top:10px">Toca la imagen para acercar o alejar.</p>`
    });
    const box = s.el.querySelector('.locmap-full');
    box.addEventListener('click', (e) => {
      const fit = box.dataset.fit === '1';
      const r = box.getBoundingClientRect();
      const fx = (e.clientX - r.left + box.scrollLeft) / box.scrollWidth, fy = (e.clientY - r.top + box.scrollTop) / box.scrollHeight;
      box.dataset.fit = fit ? '0' : '1';
      if (fit) requestAnimationFrame(() => { box.scrollLeft = fx * box.scrollWidth - r.width / 2; box.scrollTop = fy * box.scrollHeight - r.height / 2; });
    });
    return s;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-locmap-zoom]');
    if (b) { e.preventDefault(); zoom(b.dataset.locmapZoom); }
  });

  /* Disponibilidad legible de una opción: { text, cls, short } */
  function availability(st) {
    const proc = st.held ? ` · ${fmt.num(st.held)} en proceso` : '';
    switch (st.status) {
      case 'off': return { text: 'No disponible', short: 'No disponible', cls: 'is-off' };
      case 'process': return { text: `Agotado por ahora${proc}`, short: 'En proceso', cls: 'is-process' };
      case 'soldout': return { text: 'Agotado', short: 'Agotado', cls: 'is-soldout' };
      case 'low': {
        const n = st.free === 1 ? 'Queda 1' : `Últimas ${fmt.num(st.free)}`;
        return { text: n + proc, short: n, cls: 'is-low' };
      }
      default: return { text: `Quedan ${fmt.num(st.free)}${proc}`, short: `Quedan ${fmt.num(st.free)}`, cls: 'is-ok' };
    }
  }

  const seatingLabel = (o) => (o.seating === 'numerada' ? 'Silla numerada' : 'Acceso general');

  window.LocMap = { figure, zoom, availability, seatingLabel };
})();
