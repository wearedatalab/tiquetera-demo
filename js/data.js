/* Datos del demo «aforo» — plataforma de tiquetería (COT-2026-51).
   Los eventos NO usan un plano estandarizado: el organizador sube una imagen con las
   ubicaciones (cada una con su propio estilo) y al lado define las opciones de compra.
   Todo es ficticio: recintos, artistas, precios y compradores. */
(function () {
  'use strict';

  const C = { magenta: '#E0418F', violet: '#7B5CFF', teal: '#0FA3A3', blue: '#2F7BFF', green: '#22A06B', gold: '#C9A227', coral: '#FF7A45', slate: '#64748B' };

  const venues = {
    'teatro-esfera': { id: 'teatro-esfera', name: 'Teatro Esfera', type: 'Teatro', city: 'Bogotá', address: 'Cra. 7 # 22-47, La Macarena' },
    'arena-capital': { id: 'arena-capital', name: 'Arena Capital', type: 'Arena multipropósito', city: 'Bogotá', address: 'Av. Calle 63 # 59-20, Salitre' },
    'coliseo-sol': { id: 'coliseo-sol', name: 'Coliseo del Sol', type: 'Coliseo cubierto', city: 'Bogotá', address: 'Calle 26 # 60-11, Teusaquillo' }
  };

  /* Opción de compra (localidad):
     seating 'numerada' → la silla se asigna automáticamente al confirmar el pago (fila/silla por orden de compra)
     seating 'general'  → acceso general, sin silla.
     soldPct = ocupación base al abrir el demo; la simulación y las compras la mueven. */
  const events = [
    {
      id: 'cumbia-electrica', title: 'Cumbia Eléctrica', artist: 'Los Vientos del Sur', category: 'Concierto',
      venueId: 'arena-capital', date: '2026-11-14T20:00:00-05:00', doors: '6:30 p. m.', duration: '2 h 30 min', age: '+14',
      img: 'img/ev-cumbia.jpg', mapImg: 'img/mapa-cumbia.jpg', featured: true, courtesyQuota: 80,
      blurb: 'La gira «Corriente» llega a Bogotá: dos horas de cumbia con sintetizadores, acordeón y una puesta en escena de luces que convierte la arena en pista.',
      options: [
        { id: 'platino', name: 'Platino', note: 'De pie, frente a la tarima', seating: 'general', price: 340000, capacity: 300, soldPct: 0.97, color: C.coral },
        { id: 'vip', name: 'VIP', note: 'De pie, zona central con barra', seating: 'general', price: 240000, capacity: 600, soldPct: 0.62, color: C.magenta },
        { id: 'general', name: 'General', note: 'De pie, zona posterior', seating: 'general', price: 120000, capacity: 1800, soldPct: 0.41, color: C.violet },
        { id: 'preferencial', name: 'Gradería Preferencial', note: 'Silla numerada, vista frontal', seating: 'numerada', perRow: 26, price: 180000, capacity: 416, soldPct: 0.66, color: C.blue },
        { id: 'lateral', name: 'Gradería Lateral', note: 'Silla numerada, vista lateral', seating: 'numerada', perRow: 26, price: 150000, capacity: 416, soldPct: 0.58, color: C.teal }
      ]
    },
    {
      id: 'sinfonia-andes', title: 'Sinfonía de los Andes', artist: 'Orquesta Sinfónica Juvenil Aurora', category: 'Música clásica',
      venueId: 'teatro-esfera', date: '2026-11-20T19:30:00-05:00', doors: '6:45 p. m.', duration: '1 h 50 min', age: 'Todo público',
      img: 'img/ev-sinfonia.jpg', mapImg: 'img/mapa-sinfonia.jpg', courtesyQuota: 40,
      blurb: 'Un programa que viaja de Dvořák a los bambucos sinfónicos, interpretado por setenta músicos menores de 25 años.',
      options: [
        { id: 'platea-pref', name: 'Platea Preferencial', note: 'Filas A a J, silla numerada', seating: 'numerada', perRow: 18, price: 120000, capacity: 180, soldPct: 0.72, color: C.gold },
        { id: 'platea', name: 'Platea General', note: 'Filas K a T, silla numerada', seating: 'numerada', perRow: 22, price: 85000, capacity: 220, soldPct: 0.48, color: C.magenta },
        { id: 'balcon', name: 'Balcón', note: 'Segundo piso, silla numerada', seating: 'numerada', perRow: 24, price: 55000, capacity: 96, soldPct: 0.35, color: C.teal },
        { id: 'estudiantes', name: 'Estudiantes', note: 'Balcón, presentando carné vigente', seating: 'numerada', perRow: 20, price: 35000, capacity: 40, soldPct: 0.9, color: C.blue }
      ]
    },
    {
      id: 'bogota-principiantes', title: 'Bogotá no es para principiantes', artist: 'Stand-up de Mariana Ríos', category: 'Comedia',
      venueId: 'teatro-esfera', date: '2026-11-26T20:30:00-05:00', doors: '7:45 p. m.', duration: '1 h 30 min', age: '+16',
      img: 'img/ev-standup.jpg', mapImg: 'img/mapa-standup.jpg', courtesyQuota: 30,
      blurb: 'Trancones, aguaceros a las tres de la tarde y el arte de pedir un domicilio: hora y media de comedia sobre sobrevivir a la capital.',
      options: [
        { id: 'primera-fila', name: 'Primera fila + foto', note: 'Fila A y foto con Mariana al final', seating: 'numerada', perRow: 20, price: 150000, capacity: 20, soldPct: 0.85, color: C.coral },
        { id: 'platea', name: 'Platea', note: 'Silla numerada', seating: 'numerada', perRow: 22, price: 85000, capacity: 260, soldPct: 0.86, color: C.magenta },
        { id: 'balcon', name: 'Balcón', note: 'Silla numerada, segundo piso', seating: 'numerada', perRow: 24, price: 55000, capacity: 96, soldPct: 0.52, color: C.violet }
      ]
    },
    {
      id: 'final-baloncesto', title: 'Final Liga Capital de Baloncesto', artist: 'Cóndores vs. Titanes', category: 'Deportes',
      venueId: 'coliseo-sol', date: '2026-11-29T17:00:00-05:00', doors: '3:30 p. m.', duration: '2 h', age: 'Todo público',
      img: 'img/ev-baloncesto.jpg', mapImg: 'img/mapa-baloncesto.jpg', courtesyQuota: 60,
      blurb: 'El quinto partido de la serie define al campeón. Coliseo en configuración deportiva: la cancha no se vende y las tribunas quedan numeradas.',
      options: [
        { id: 'palco', name: 'Palco Occidental', note: 'A ras de cancha, silla numerada', seating: 'numerada', perRow: 12, price: 140000, capacity: 48, soldPct: 0.8, color: C.coral },
        { id: 'occidental', name: 'Tribuna Occidental', note: 'Silla numerada', seating: 'numerada', perRow: 30, price: 70000, capacity: 180, soldPct: 0.68, color: C.magenta },
        { id: 'oriental', name: 'Tribuna Oriental', note: 'Silla numerada', seating: 'numerada', perRow: 30, price: 55000, capacity: 180, soldPct: 0.55, color: C.violet },
        { id: 'norte-sur', name: 'Tribunas Norte y Sur', note: 'Detrás de los aros, silla numerada', seating: 'numerada', perRow: 20, price: 40000, capacity: 200, soldPct: 0.45, color: C.teal }
      ]
    },
    {
      id: 'selva-sonora', title: 'Selva Sonora Festival', artist: 'Nueve artistas de electrónica latina', category: 'Festival',
      venueId: 'arena-capital', date: '2026-12-05T16:00:00-05:00', doors: '2:00 p. m.', duration: '8 h', age: '+18',
      img: 'img/ev-selva.jpg', mapImg: 'img/mapa-selva.jpg', courtesyQuota: 120,
      blurb: 'Ocho horas de house, cumbia digital y techno tropical bajo una selva de luces. Preventa 2 activa hasta agotar existencias.',
      options: [
        { id: 'backstage', name: 'Backstage Experience', note: 'Plataforma junto a la cabina + barra libre', seating: 'general', price: 520000, capacity: 120, soldPct: 0.5, color: C.gold },
        { id: 'vip', name: 'VIP', note: 'De pie, zona elevada', seating: 'general', price: 340000, capacity: 600, soldPct: 0.3, color: C.magenta },
        { id: 'preventa', name: 'General · Preventa 2', note: 'Precio de preventa por tiempo limitado', seating: 'general', price: 160000, capacity: 500, soldPct: 0.94, color: C.green },
        { id: 'general', name: 'General', note: 'De pie, toda la pista', seating: 'general', price: 180000, capacity: 2400, soldPct: 0.22, color: C.teal }
      ]
    },
    {
      id: 'salsa-brava', title: 'Noche de Salsa Brava', artist: 'Orquesta La Clave Mayor', category: 'Concierto',
      venueId: 'coliseo-sol', date: '2026-12-12T21:00:00-05:00', doors: '7:30 p. m.', duration: '3 h', age: '+18',
      img: 'img/ev-salsa.jpg', mapImg: 'img/mapa-salsa.jpg', courtesyQuota: 50,
      blurb: 'El mismo coliseo, otra configuración: la cancha se vuelve pista de baile con escenario al norte y mesas alrededor.',
      options: [
        { id: 'mesas', name: 'Mesa preferencial', note: 'Mesa para 4, precio por silla', seating: 'numerada', perRow: 8, price: 180000, capacity: 96, soldPct: 0.6, color: C.gold },
        { id: 'pista', name: 'Pista de baile', note: 'De pie, frente al escenario', seating: 'general', price: 90000, capacity: 600, soldPct: 0.35, color: C.coral },
        { id: 'occidental', name: 'Tribuna Occidental', note: 'Silla numerada', seating: 'numerada', perRow: 30, price: 120000, capacity: 180, soldPct: 0.5, color: C.magenta },
        { id: 'oriental', name: 'Tribuna Oriental', note: 'Silla numerada', seating: 'numerada', perRow: 30, price: 100000, capacity: 180, soldPct: 0.4, color: C.violet }
      ]
    }
  ];

  const gateways = [
    { id: 'payu', name: 'PayU', note: 'Tarjeta, PSE, Nequi y efectivo', methods: ['Tarjeta', 'PSE', 'Nequi', 'Efectivo'] },
    { id: 'mercadopago', name: 'Mercado Pago', note: 'Tarjeta, PSE y saldo en cuenta', methods: ['Tarjeta', 'PSE', 'Saldo'] },
    { id: 'epayco', name: 'ePayco', note: 'Tarjeta, PSE y Daviplata', methods: ['Tarjeta', 'PSE', 'Daviplata'] }
  ];

  const coupons = [
    { code: 'AFORO10', label: 'Lanzamiento de la plataforma', type: 'pct', value: 10, limit: 500, used: 214, active: true, eventIds: null, until: '2026-12-31' },
    { code: 'PREVENTA15', label: 'Preventa Selva Sonora', type: 'pct', value: 15, limit: 300, used: 288, active: true, eventIds: ['selva-sonora'], until: '2026-11-30' },
    { code: 'CUMBIA20K', label: 'Aliado: emisora', type: 'fixed', value: 20000, limit: 150, used: 61, active: true, eventIds: ['cumbia-electrica'], until: '2026-11-13' },
    { code: 'ESTUDIANTE', label: 'Estudiantes con carné', type: 'pct', value: 25, limit: 120, used: 120, active: true, eventIds: ['sinfonia-andes'], until: '2026-11-19' },
    { code: 'NAVIDAD', label: 'Campaña diciembre', type: 'pct', value: 12, limit: 400, used: 0, active: false, eventIds: null, until: '2026-12-24' }
  ];

  const people = [
    'Laura Méndez', 'Andrés Rojas', 'Camila Duarte', 'Santiago Pérez', 'Valentina Gómez', 'Julián Castro',
    'Daniela Herrera', 'Felipe Moreno', 'Mariana López', 'Sebastián Ruiz', 'Natalia Vargas', 'Tomás Cárdenas',
    'Sara Jiménez', 'Nicolás Ortiz', 'Paula Sánchez', 'David Ramírez', 'Isabella Torres', 'Juan Pablo Díaz'
  ];

  window.DATA = {
    brand: { name: 'aforo', tagline: 'Boletería en línea sin doble venta' },
    quote: { code: 'COT-2026-51' },
    colors: C,
    venues,
    events,
    gateways,
    coupons,
    people,
    serviceFee: 0.08,
    holdSeconds: 480,
    maxPerOrder: 6,
    demoBuyer: { name: 'Carolina Restrepo', email: 'carolina.restrepo@correo.co', phone: '300 555 0142', doc: 'CC 1.020.456.789' },
    gates: ['Puerta 1 · Norte', 'Puerta 2 · VIP', 'Puerta 3 · Graderías']
  };
})();
