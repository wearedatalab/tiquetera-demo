/* Guía del demo: cada módulo de la cotización COT-2026-51 → dónde se ve en el demo. */
(function () {
  'use strict';
  const { esc, icon, fmt } = UI;
  const D = window.DATA;

  const ITEMS = [
    { t: 'Venta de boletería en línea sin doble venta', d: 'Lo que eliges queda apartado a tu nombre con cuenta regresiva y el cupo libre descuenta lo que otras personas están pagando en ese momento: nunca se vende dos veces el mismo cupo. En las opciones numeradas la silla se asigna al confirmar el pago.', links: [['Comprar boletas', '/evento/bogota-principiantes'], ['Ver reservas en curso', '/org/reservas']] },
    { t: 'Página web para la compra de boletería', d: 'Cartelera, ficha del evento con su imagen de ubicaciones y, al lado, las opciones de compra. Compra en tres pasos, pensada primero para celular.', links: [['Abrir la cartelera', '/']] },
    { t: 'Aplicación móvil para listar y controlar las ventas', d: 'Panel del organizador con ventas en vivo, ocupación por zona y recaudo. En celular funciona como app con pestañas.', links: [['Panel de ventas', '/org']] },
    { t: 'Método del API para registrar el ingreso', d: 'El escáner de la puerta llama a POST /api/v1/accesos y muestra la petición y la respuesta: 200 permitido, 409 ya ingresó, 404 no válida.', links: [['Abrir el escáner', '/acceso']] },
    { t: 'QR único por boleta', d: 'Cada boleta lleva un código y una firma propios. El QR es real: puedes escanearlo desde otro celular en la vista de acceso.', links: [['Mis boletas', '/boletas']] },
    { t: 'Recaudo por pasarela de pago', d: 'Checkout con PayU, Mercado Pago o ePayco (simulados): tarjeta, PSE o billetera, y confirmación por webhook antes de emitir las boletas.', links: [['Ir a pagar una compra', '/evento/cumbia-electrica']] },
    { t: 'Interfaces de espacios para administrador y comprador', d: 'Los eventos no usan un plano estándar: el organizador sube la imagen de ubicaciones de cada evento y al lado define las opciones de compra con precio y cupo. El comprador ve las dos cosas juntas.', links: [['Configurar ubicaciones', '/org/espacios'], ['Vista del comprador', '/evento/salsa-brava']] },
    { t: 'Arquitectura que escala: mil ventas en 10 minutos', d: 'Simulación de un pico de demanda con cola virtual, instancias que escalan y cero dobles ventas.', links: [['Simular el pico', '/org?pico=1']] },
    { t: 'Control de reservas y procesos en curso', d: 'Lista en vivo de quién tiene boletas apartadas, en qué paso va y cuánto le queda. El organizador puede liberar una reserva.', links: [['Reservas en curso', '/org/reservas']] },
    { t: 'Control de cortesías', d: 'Cupo de cortesías por evento, emisión por zona y envío al invitado con QR válido en la puerta.', links: [['Emitir una cortesía', '/org/promos?tab=cortesias']] },
    { t: 'Cupones de descuento', d: 'Cupones por porcentaje o valor fijo, con límite de usos, vigencia y eventos. Un cupón creado aquí funciona de inmediato en el checkout.', links: [['Ver cupones', '/org/promos?tab=cupones']] },
    { t: 'Notificaciones de compra y proceso', d: 'Reserva creada, pago en proceso, compra confirmada, reserva vencida: por correo, WhatsApp y notificación en la app.', links: [['Ver notificaciones', '/avisos']] }
  ];

  App.view({
    id: 'guia', path: '/guia', role: 'guide', title: 'Guía del demo',
    render() {
      return `<div class="wrap">
        <section class="guide-hero">
          <p class="eyebrow">Demo navegable · ${esc(D.quote.code)}</p>
          <h1 class="display-2" style="margin-top:10px">Plataforma de boletería: lo clave, para recorrer en diez minutos</h1>
          <p class="lead">Esta demo muestra cada módulo de la cotización con datos ficticios y sin servidor. «aforo» es un nombre de ejemplo. Usa la barra superior para cambiar entre comprador, organizador y control de acceso: todo comparte el mismo inventario, así que una compra aparece en el panel y su QR funciona en la puerta.</p>
          <div class="guide-meta">
            <span class="badge badge-ink">${D.events.length} eventos</span>
            <span class="badge">${Object.keys(D.venues).length} recintos configurables</span>
            <span class="badge">Pagos simulados</span>
            <span class="badge">Celular primero</span>
          </div>
        </section>
        <ol class="guide-list">
          ${ITEMS.map((it) => `<li class="guide-item">
            <div class="guide-txt"><h2>${esc(it.t)}</h2><p>${esc(it.d)}</p></div>
            <div class="guide-links">${it.links.map(([l, p], i) => `<a class="btn btn-sm ${i === 0 ? 'btn-ink' : 'btn-line'}" href="#${p}">${esc(l)} ${i === 0 ? icon('arrow', 16) : ''}</a>`).join('')}</div>
          </li>`).join('')}
        </ol>
        <div class="guide-foot">
          <p class="muted small">Recorrido sugerido: compra 2 sillas → paga → abre «Mis boletas» → pasa a Acceso y registra el ingreso → mira el panel de ventas.</p>
          <button class="btn btn-sm btn-line" data-reset>${icon('refresh', 16)} Reiniciar datos del demo</button>
        </div>
      </div>`;
    },
    mount(root) {
      root.querySelector('[data-reset]').addEventListener('click', () => {
        Store.reset();
        UI.toast('Datos del demo reiniciados.', { type: 'ok' });
      });
    }
  });
})();
