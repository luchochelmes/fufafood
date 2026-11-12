(function () {
  'use strict';

  /* ===================== panel del local (admin) ===================== */
  /* El estado real vive en Supabase (tabla app_settings, fila "main"),
     escrito por admin.js. Mientras llega (o si todavía no se cargó nunca
     nada desde el panel) el sitio arranca sin overrides, igual que antes. */
  var db = window.fufaDb;
  var ADMIN = {};

  /* ===================== DATA ===================== */
  var WA, waText, waDefault, waOrder;
  function recomputeWa() {
    WA = (ADMIN.whatsapp || '5493510000000');
    waText = function (msg) { return 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg); };
    waDefault = waText('Hola Fufa!');
    waOrder = waText('Hola Fufa! Quiero hacer un pedido.');
  }
  recomputeWa();

  var fmt = function (n) { return '$' + n.toLocaleString('es-AR'); };
  var norm = function (s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  };

  /* Catálogo real: se carga desde data-carta.json (ver init). */
  var CARTA_DATA = null;

  /* Elegidos a mano como "más pedidos" (no viene marcado en los datos reales):
     una hamburguesa top, un lomito, una pizza y una docena de empanadas. */
  var TOP_PICKS = [
    { cat: 'hamburguesas', id: 'IlNOGYezC5vWn4zWrBHc', name: 'BIG FUFA' },
    { cat: 'lomitos', id: 'fCScPT8RmMvRgWjQQ98P', name: 'ESPECIAL' },
    { cat: 'pizzas', id: 'weHYC6IEv5aIx2TZ0UdF', name: 'ESPECIAL' },
    { cat: 'empanadas', id: 'v8kx4BFNafhSc9AipQyA', name: 'DOCENA EMPANADAS MIXTAS' }
  ];

  /* Textos editoriales por categoría (no vienen en el catálogo). Los slugs
     coinciden con los de data-carta.json. */
  var CAT_META = {
    hamburguesas: { line1: 'Medallones a la plancha, armadas en el momento.', examples: 'De la simple a la cuádruple, la Big Fufa y tres veggies.' },
    lomitos: { line1: 'Pan grande y lomo a la plancha.', examples: 'Completo, especial, roquefort, cuatro quesos y de pollo.' },
    sandwiches: { line1: 'Milanesa en pan, como corresponde.', examples: 'Milanesa simple, completa, argentina y la Fufa veggie.' },
    empanadas: { line1: 'Por unidad o por docena.', examples: 'Árabes, criollas, jamón y queso, pollo. Por unidad o docena.' },
    pizzas: { line1: 'Entera o media.', examples: 'Diez gustos, de la muzza a la de champiñones. Entera o media.' },
    frituras: { line1: 'Para acompañar o para pedir solas.', examples: 'Fritas solas, con huevo, con bacon y cheddar, y aros de cebolla.' },
    extras: { line1: 'Sumale algo más a tu pedido.', examples: 'Pileta de cheddar y otros extras para acompañar.' },
    bebidas: { line1: 'Frías, como tienen que estar.', examples: 'Gaseosas, aguas y cervezas, en lata, botella o retornable.' },
    helados: { line1: 'Para cerrar.', examples: 'Palitos bombón, bombones suizo, escocés y Dubai, y tacitas combi.' },
    'tragos-solo-para-local': { line1: 'Vení a tomarlos acá.', soloLocal: true, examples: 'Fernet, gin, vodka, gancia, cinzano y vino, por medida o botella.' }
  };

  function catMin(c) {
    var min = null;
    (c.products || []).forEach(function (p) {
      if (typeof p.price === 'number' && (min === null || p.price < min)) min = p.price;
    });
    return min;
  }

  function findProduct(catSlug, name) {
    if (!CARTA_DATA) return null;
    var c = CARTA_DATA.filter(function (cc) { return cc.slug === catSlug; })[0];
    if (!c) return null;
    return c.products.filter(function (p) { return p.name === name; })[0] || null;
  }

  var ZONES_DEFAULT = [
    { name: 'Zona 1', cost: 1500, time: '25–35 min', km: 'hasta 1,5 km', radius: 1.5, barrios: ['Alta Córdoba', 'Cofico', 'General Bustos', 'Providencia'] },
    { name: 'Zona 2', cost: 2500, time: '35–45 min', km: 'de 1,5 a 3 km', radius: 3, barrios: ['Pueyrredón', 'General Paz', 'Las Margaritas', 'Villa Cabrera', 'Centro'] },
    { name: 'Zona 3', cost: 3500, time: '45–55 min', km: 'de 3 a 4,5 km', radius: 4.5, barrios: ['Juniors', 'San Martín', 'Alberdi', 'Marqués de Sobremonte'] }
  ];
  /* Coordenadas del local (Mariano Fragueiro 2706 esq. Quevedo), las mismas
     que usa el mapa del panel — centro para calcular distancias reales. */
  var CENTER_LAT = -31.3929, CENTER_LON = -64.1838;
  /* Si el panel guardó zonas propias, reemplazan por completo a las de fábrica
     (misma forma: name/cost/time/km/barrios). Las zonas apagadas no se listan. */
  var ZONES;
  function recomputeZones() {
    ZONES = (ADMIN.zones && ADMIN.zones.length)
      ? ADMIN.zones.filter(function (z) { return z.on !== false; })
      : ZONES_DEFAULT;
  }
  recomputeZones();

  /* HOURS[jsDay] = {from, to} en minutos desde las 00:00 de jsDay (getDay():
     Domingo=0..Sábado=6). Si el cierre cae en la madrugada (ej. 20:00 a
     00:30), "to" queda > 1440 (= 24:30) para poder compararlo contra los
     minutos del día siguiente sin perder los minutos (antes se guardaba
     solo la hora entera y "00:30" se truncaba a "0"). */
  function hhmmToMin(hhmm) {
    var parts = String(hhmm).split(':');
    var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10) || 0;
    return isNaN(h) ? null : h * 60 + m;
  }
  var HOURS_DEFAULT_RAW = [
    { open: false, from: '20:00', to: '00:00' },
    { open: true, from: '20:00', to: '00:00' },
    { open: true, from: '20:00', to: '00:00' },
    { open: true, from: '20:00', to: '00:00' },
    { open: true, from: '20:00', to: '00:30' },
    { open: true, from: '20:00', to: '00:30' },
    { open: true, from: '20:00', to: '00:00' }
  ];
  /* ADMIN.hours (si existe) viene con índice Lunes=0..Domingo=6, como lo usa
     el panel. getDay() nativo usa Domingo=0..Sábado=6, así que convertimos
     con jsIndex = (adminIndex + 1) % 7 antes de usarlo acá. */
  var HOURS;
  function recomputeHours() {
    var raw = (ADMIN.hours && ADMIN.hours.length === 7) ? ADMIN.hours : HOURS_DEFAULT_RAW;
    var out = {};
    raw.forEach(function (day, adminIdx) {
      if (!day || !day.open) return;
      var jsIdx = (adminIdx + 1) % 7;
      var from = hhmmToMin(day.from);
      var to = hhmmToMin(day.to);
      if (from === null || to === null) return;
      if (to <= from) to += 24 * 60;
      out[jsIdx] = { from: from, to: to };
    });
    HOURS = out;
  }
  recomputeHours();
  var DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  /* Resumen de horarios en texto, para el footer y "Comé en el local".
     Agrupa días consecutivos con el mismo horario (o ambos cerrados) en
     una sola línea, tal como vienen cargados en el panel (Lunes=0..Domingo=6). */
  var DAY_NAMES_MON = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  function fmtHourPart(hhmm) {
    var min = hhmmToMin(hhmm);
    return min === null ? hhmm : fmtClockMin(min);
  }
  function hoursSummaryRows() {
    var days = (ADMIN.hours && ADMIN.hours.length === 7) ? ADMIN.hours : HOURS_DEFAULT_RAW;
    var rows = [];
    var i = 0;
    while (i < 7) {
      var d = days[i] || { open: false };
      var sig = d.open ? ('o:' + d.from + '-' + d.to) : 'c';
      var j = i;
      while (j + 1 < 7) {
        var d2 = days[j + 1] || { open: false };
        var sig2 = d2.open ? ('o:' + d2.from + '-' + d2.to) : 'c';
        if (sig2 !== sig) break;
        j++;
      }
      var label = (i === j) ? DAY_NAMES_MON[i]
        : (j === i + 1) ? (DAY_NAMES_MON[i] + ' y ' + DAY_NAMES_MON[j]) /* 2 días seguidos: "Viernes y Sábado" lee mejor que "Viernes a Sábado" */
        : (DAY_NAMES_MON[i] + ' a ' + DAY_NAMES_MON[j]);
      rows.push({
        day: label,
        text: d.open ? ('De ' + fmtHourPart(d.from) + ' a ' + fmtHourPart(d.to)) : 'Cerrado'
      });
      i = j + 1;
    }
    return rows;
  }
  function applyHoursText() {
    var rows = hoursSummaryRows();
    var dl = document.getElementById('local-hours-dl');
    if (dl) {
      dl.innerHTML = rows.map(function (r) {
        return '<dt>' + escapeHtml(r.day) + '</dt><dd>' + escapeHtml(r.text) + '</dd>';
      }).join('');
    }
    var footer = document.getElementById('footer-hours');
    if (footer) {
      footer.innerHTML = rows.map(function (r) { return escapeHtml(r.day + ' · ' + r.text); }).join('<br>');
    }
  }

  /* ===================== helpers ===================== */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fotoFufa(label, ratio) {
    return '<div class="foto-fufa" style="aspect-ratio:' + (ratio || '4/3') + '">' +
      '<span class="foto-fufa__badge">Foto real de Fufa · ' + escapeHtml(label) + '</span>' +
      '</div>';
  }

  function renderStaticPhotos() {
    document.querySelectorAll('[data-photo-label]').forEach(function (el) {
      el.innerHTML = fotoFufa(el.getAttribute('data-photo-label'), el.getAttribute('data-photo-ratio') || '4/3');
    });
  }

  /* Si la imagen externa (Pedix/GCS) no carga, reemplazamos su contenedor
     por el placeholder "Foto real de Fufa" que ya existe en el diseño. */
  function handleProductImgError(img) {
    var wrap = img.parentElement;
    if (!wrap) return;
    var label = img.getAttribute('data-fb-label') || '';
    var ratio = img.getAttribute('data-fb-ratio') || '4/3';
    wrap.innerHTML = fotoFufa(label, ratio);
  }
  window.__ffImgErr = handleProductImgError;

  /* <img> real de producto/categoría con fallback a fotoFufa() si falla o no hay URL.
     Debe ir dentro de un contenedor que fije el tamaño/aspect-ratio (photo-wrap, etc.). */
  function productImg(url, alt, ratio, fallbackLabel, fit) {
    if (!url) return fotoFufa(fallbackLabel || alt, ratio);
    return (
      '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '" loading="lazy" ' +
      'style="width:100%;height:100%;object-fit:' + (fit || 'cover') + ';display:block" ' +
      'data-fb-label="' + escapeHtml(fallbackLabel || alt) + '" data-fb-ratio="' + escapeHtml(ratio || '4/3') + '" ' +
      'onerror="window.__ffImgErr(this)">'
    );
  }

  /* Bebidas, tragos y helados vienen con fotos de fondo transparente (botellas,
     copas) que al recortarse con "cover" dejan ver poco del producto. Para esas
     categorías mostramos la foto completa ("contain") en vez de recortada. */
  function photoFitFor(slug) {
    return (slug === 'bebidas' || slug === 'tragos-solo-para-local' || slug === 'helados') ? 'contain' : 'cover';
  }

  /* Precio con soporte de descuento: tachado el original y destacado el de oferta. */
  function priceHtml(price, priceDiscount) {
    if (typeof priceDiscount === 'number' && priceDiscount < price) {
      return '<span class="cat-items__price-old">' + fmt(price) + '</span> <span class="cat-items__price-new">' + fmt(priceDiscount) + '</span>';
    }
    return fmt(price);
  }

  /* Bloque colapsable e informativo de extras/toppings de un producto. */
  function extrasHtml(options) {
    if (!options || !options.length) return '';
    var groups = options.map(function (o) {
      if (o.rangeType === 'fixed' && o.qty && o.min) {
        var flavorItems = o.items.map(function (it) {
          return '<li class="cat-extras__item">' + escapeHtml(it.name) + '</li>';
        }).join('');
        return (
          '<div class="cat-extras__group"><p class="cat-extras__group-title">Elegís los sabores (' + o.min + ' unidades)</p>' +
          '<ul class="cat-extras__list">' + flavorItems + '</ul></div>'
        );
      }
      var items = o.items.map(function (it) {
        if (it.price > 0) {
          return (
            '<li class="cat-extras__item cat-extras__item--extra"><span>' + escapeHtml(it.name) + '</span>' +
            '<span class="cat-extras__item-price">+ ' + fmt(it.price) + '</span></li>'
          );
        }
        return '<li class="cat-extras__item">' + escapeHtml(it.name) + '</li>';
      }).join('');
      return (
        '<div class="cat-extras__group"><p class="cat-extras__group-title">' + escapeHtml(o.name || 'Opciones') + '</p>' +
        '<ul class="cat-extras__list">' + items + '</ul></div>'
      );
    }).join('');
    return '<details class="cat-extras"><summary>Ver extras y toppings</summary>' + groups + '</details>';
  }

  /* ===================== CARRITO ===================== */
  /* Carrito real: se persiste en localStorage y sobrevive recargas, pero se
     vacía al confirmar el pedido. Cada línea guarda el producto, la cantidad
     y los toppings elegidos (pagos o gratis) para poder armar el ticket de
     WhatsApp con el formato exacto que usaba Pedix. */
  var CART_KEY = 'fufaCart_v1';
  var SEQ_KEY = 'fufaOrderSeq';

  function loadCart() {
    try {
      var raw = window.localStorage.getItem(CART_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  var CART = loadCart();

  function saveCart() {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(CART)); } catch (e) { /* storage lleno o bloqueado: seguimos sin persistir */ }
    updateCartBadges();
  }

  function cartUnits() {
    return CART.reduce(function (s, l) { return s + l.qty; }, 0);
  }

  function lineToppingsTotal(line) {
    return (line.toppings || []).reduce(function (s, t) { return s + (t.price || 0); }, 0);
  }

  function linePrice(line) {
    return line.qty * (line.unitPrice + lineToppingsTotal(line));
  }

  function cartSubtotal() {
    return CART.reduce(function (s, l) { return s + linePrice(l); }, 0);
  }

  function updateCartBadges() {
    var n = cartUnits();
    document.querySelectorAll('[data-cart-badge]').forEach(function (el) {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
    var bar = document.getElementById('order-bar');
    if (bar) {
      bar.hidden = n === 0;
      var barCount = document.getElementById('order-bar-count');
      var barTotal = document.getElementById('order-bar-total');
      if (barCount) barCount.textContent = String(n);
      if (barTotal) barTotal.textContent = fmt(cartSubtotal());
    }
    if (n === 0) hideAddedToast();
    layoutBottomBars();
  }

  /* El banner de cookies, la barra "Mi pedido" y el botón de WhatsApp son
     todos elementos fijos pegados abajo — si se apilan sin coordinarse, el
     banner (que aparece primero, antes de que el cliente elija nada) tapa
     a los otros dos por completo. Acá se acomodan uno arriba del otro según
     cuáles estén visibles en ese momento. */
  function layoutBottomBars() {
    var banner = document.getElementById('cookie-banner');
    var bar = document.getElementById('order-bar');
    var wa = document.getElementById('wa-float');
    var bannerH = (banner && !banner.hidden) ? banner.getBoundingClientRect().height : 0;
    if (bar) bar.style.bottom = bannerH ? (bannerH + 'px') : '';
    if (wa) {
      var barH = (bar && !bar.hidden) ? bar.getBoundingClientRect().height : 0;
      var extra = bannerH + barH;
      wa.style.bottom = extra ? ('calc(' + extra + 'px + 16px + env(safe-area-inset-bottom))') : '';
    }
  }

  /* -------- agregado rápido (sin modal) para productos sin opciones --------
     8 de cada 10 productos de la carta no tienen toppings/sabores para elegir
     (bebidas, helados, etc.); para esos no tiene sentido abrir el modal solo
     para confirmar cantidad 1, así que se suman directo con un stepper +/-. */
  function hasOptions(p) {
    return !!(p && p.options && p.options.length);
  }

  function findSimpleCartLine(catSlug, name) {
    return CART.filter(function (l) {
      return l.catSlug === catSlug && l.name === name && (!l.toppings || !l.toppings.length);
    })[0] || null;
  }

  function cartQtyFor(catSlug, name) {
    var line = findSimpleCartLine(catSlug, name);
    return line ? line.qty : 0;
  }

  function quickAddQty(catSlug, pid, delta) {
    var c = CARTA_DATA ? CARTA_DATA.filter(function (cc) { return cc.slug === catSlug; })[0] : null;
    var p = findProductById(catSlug, pid);
    if (!c || !p) return;
    if (delta > 0 && ADMIN.receiving === false) { showToast('Pausamos los pedidos por ahora. Escribinos por WhatsApp.'); return; }
    var line = findSimpleCartLine(catSlug, p.name);
    if (delta > 0) {
      if (line) {
        line.qty++;
      } else {
        CART.push({
          id: 'l' + Date.now() + Math.random().toString(36).slice(2, 8),
          catSlug: c.slug, catName: c.name, group: p.group || '',
          name: p.name, unitPrice: p.price, qty: 1, toppings: []
        });
      }
      showAddedToast();
    } else if (line) {
      line.qty--;
      if (line.qty <= 0) CART = CART.filter(function (x) { return x !== line; });
    }
    saveCart();
  }

  function updateStepperUi(el) {
    var catSlug = el.getAttribute('data-qty-cat'), pid = el.getAttribute('data-qty-pid');
    var p = findProductById(catSlug, pid);
    if (!p) return;
    var qty = cartQtyFor(catSlug, p.name);
    var val = el.querySelector('[data-qty-val]');
    if (val) val.textContent = String(qty);
    var dec = el.querySelector('[data-qty-dec]');
    if (dec) dec.disabled = qty <= 0;
  }

  function nextOrderSeq() {
    var cur = parseInt(window.localStorage.getItem(SEQ_KEY) || '0', 10);
    if (isNaN(cur) || cur < 0) cur = 0;
    var next = cur + 1;
    try { window.localStorage.setItem(SEQ_KEY, String(next)); } catch (e) { /* sin persistencia, seguimos con next en memoria */ }
    return next;
  }

  function randOrderCode() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var s = '';
    for (var i = 0; i < 12; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
  }

  /* Fecha/hora de Argentina, formato DD/MM/AA - HH:MMhs (24hs, con ceros). */
  function argDateStr(d) {
    var parts = {};
    try {
      new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Cordoba',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    } catch (e) {
      parts = {
        day: String(d.getDate()).padStart(2, '0'),
        month: String(d.getMonth() + 1).padStart(2, '0'),
        year: String(d.getFullYear()).slice(-2),
        hour: String(d.getHours()).padStart(2, '0'),
        minute: String(d.getMinutes()).padStart(2, '0')
      };
    }
    var hh = parts.hour === '24' ? '00' : parts.hour;
    return parts.day + '/' + parts.month + '/' + parts.year + ' - ' + hh + ':' + parts.minute + 'hs';
  }

  function findProductById(catSlug, pid) {
    if (!CARTA_DATA) return null;
    var c = CARTA_DATA.filter(function (cc) { return cc.slug === catSlug; })[0];
    if (!c) return null;
    return c.products.filter(function (p) { return p.id === pid; })[0] || null;
  }

  /* -------- modal de producto: cantidad + grupos de opciones -------- */
  var MODAL = null; /* { catSlug, catName, group, product, qty, any:{gi:{name:bool}}, fixed:{gi:{name:qty}} } */
  var modalScrollY = 0;
  var modalOpenerEl = null;

  /* Bloquea el scroll del fondo mientras el modal está abierto (si no, en
     mobile se podía seguir scrolleando la página de atrás). */
  function lockBodyScroll() {
    modalScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + modalScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
  }
  function unlockBodyScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    window.scrollTo(0, modalScrollY);
  }

  /* inert saca todo lo que no sea el modal de la navegación por teclado y
     de los lectores de pantalla (antes se podía tabular al buscador o a
     links de atrás con el modal abierto). */
  function setBackgroundInert(on) {
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el.id === 'product-modal-root') return;
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }

  function trapModalFocus(e) {
    if (!MODAL) return;
    var root = document.getElementById('product-modal-root');
    if (e.key === 'Escape') { e.preventDefault(); closeProductModal(); return; }
    if (e.key !== 'Tab') return;
    var focusables = root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', trapModalFocus);

  function openProductModal(catSlug, pid) {
    var c = CARTA_DATA.filter(function (cc) { return cc.slug === catSlug; })[0];
    var p = findProductById(catSlug, pid);
    if (!c || !p) return;
    MODAL = { catSlug: c.slug, catName: c.name, group: p.group || '', product: p, qty: 1, any: {}, fixed: {}, photoIndex: 0, note: '' };
    (p.options || []).forEach(function (o, gi) {
      if (o.rangeType === 'fixed' && o.qty && o.min) {
        MODAL.fixed[gi] = {};
        o.items.forEach(function (it) { MODAL.fixed[gi][it.name] = 0; });
      } else {
        MODAL.any[gi] = {};
      }
    });
    modalOpenerEl = document.activeElement;
    renderModal();
    document.getElementById('product-modal-root').hidden = false;
    lockBodyScroll();
    setBackgroundInert(true);
    var closeBtn = document.querySelector('#product-modal-root .modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeProductModal() {
    MODAL = null;
    var root = document.getElementById('product-modal-root');
    if (root) { root.hidden = true; root.innerHTML = ''; }
    unlockBodyScroll();
    setBackgroundInert(false);
    if (modalOpenerEl && modalOpenerEl.focus) modalOpenerEl.focus();
    modalOpenerEl = null;
  }

  /* ===================== cookies (consentimiento) ===================== */
  var COOKIE_KEY = 'fufaCookieConsent_v1';
  function loadCookiePrefs() {
    try {
      var raw = window.localStorage.getItem(COOKIE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  var cookiePrefs = loadCookiePrefs(); /* null = todavía no eligió */

  function showCookieBanner() {
    var el = document.getElementById('cookie-banner');
    if (el) el.hidden = false;
    layoutBottomBars();
  }
  function hideCookieBanner() {
    var el = document.getElementById('cookie-banner');
    if (el) el.hidden = true;
    layoutBottomBars();
  }

  function openCookieModal() {
    var root = document.getElementById('cookie-modal-root');
    if (!root) return;
    var p = cookiePrefs || { necessary: true, analytics: false, marketing: false };
    root.innerHTML =
      '<div class="cookie-modal-overlay" id="cookie-modal-overlay">' +
      '<div class="cookie-modal-box" role="dialog" aria-modal="true" aria-label="Preferencias de cookies">' +
      '<h3>Preferencias</h3>' +
      '<p>Elegí qué querés permitir. Lo podés cambiar cuando quieras desde "Cookies" en el pie de página.</p>' +
      '<div class="cookie-pref"><div><p class="cookie-pref__name">Necesarias</p><p class="cookie-pref__desc">Carrito de compra y recordar tu elección. El sitio no funciona sin esto.</p></div><input type="checkbox" checked disabled aria-label="Necesarias (siempre activas)"></div>' +
      '<div class="cookie-pref"><div><p class="cookie-pref__name">Analíticas</p><p class="cookie-pref__desc">Hoy no hay ninguna instalada. Serviría a futuro para medir qué páginas se visitan más.</p></div><input type="checkbox" id="cm-analytics"' + (p.analytics ? ' checked' : '') + ' aria-label="Analíticas"></div>' +
      '<div class="cookie-pref"><div><p class="cookie-pref__name">Marketing</p><p class="cookie-pref__desc">Hoy no hay ninguna instalada. Serviría a futuro para publicidad o integraciones con redes sociales.</p></div><input type="checkbox" id="cm-marketing"' + (p.marketing ? ' checked' : '') + ' aria-label="Marketing"></div>' +
      '<div class="cookie-modal-actions">' +
      '<button type="button" class="btn btn-outline-black" data-cookie-modal-close>Cancelar</button>' +
      '<button type="button" class="btn btn-yellow" id="cookie-save-prefs">Guardar preferencias</button>' +
      '</div></div></div>';
  }
  function closeCookieModal() {
    var root = document.getElementById('cookie-modal-root');
    if (root) root.innerHTML = '';
  }
  function applyCookieChoice(prefs) {
    cookiePrefs = prefs;
    try { window.localStorage.setItem(COOKIE_KEY, JSON.stringify(prefs)); } catch (e) { /* sin consentimiento guardado, se vuelve a preguntar la próxima visita */ }
    hideCookieBanner();
    closeCookieModal();
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#cookie-accept')) { applyCookieChoice({ necessary: true, analytics: true, marketing: true }); return; }
    if (e.target.closest('#cookie-reject')) { applyCookieChoice({ necessary: true, analytics: false, marketing: false }); return; }
    if (e.target.closest('#cookie-customize') || e.target.closest('#footer-cookie-btn') || e.target.closest('#legal-open-cookie-settings')) { openCookieModal(); return; }
    if (e.target.closest('[data-cookie-modal-close]') || e.target.id === 'cookie-modal-overlay') { closeCookieModal(); return; }
    if (e.target.closest('#cookie-save-prefs')) {
      var a = document.getElementById('cm-analytics'), m = document.getElementById('cm-marketing');
      applyCookieChoice({ necessary: true, analytics: !!(a && a.checked), marketing: !!(m && m.checked) });
      return;
    }
  });

  function modalFixedOk() {
    if (!MODAL) return true;
    var ok = true;
    (MODAL.product.options || []).forEach(function (o, gi) {
      if (o.rangeType === 'fixed' && o.qty && o.min) {
        var sum = 0;
        for (var k in MODAL.fixed[gi]) sum += MODAL.fixed[gi][k];
        if (sum !== o.min) ok = false;
      }
    });
    return ok;
  }

  function modalExtrasTotal() {
    if (!MODAL) return 0;
    var total = 0;
    (MODAL.product.options || []).forEach(function (o, gi) {
      if (o.rangeType === 'fixed' && o.qty && o.min) return; /* sabores, siempre precio 0 */
      o.items.forEach(function (it) {
        if (MODAL.any[gi] && MODAL.any[gi][it.name]) total += (it.price || 0);
      });
    });
    return total;
  }

  /* El campo "image" del catálogo (el archivo original de Pedix, sin
     comprimir) pesa varios MB y es lo que hacía tardar muchísimo el modal.
     El CDN de Pedix puede devolver el mismo archivo en un tamaño más grande
     que el thumb de la lista pero igual de liviano; eso es lo que usa el
     modal. Las fotos subidas por el local (admin) no pasan por este CDN y
     quedan intactas. */
  function biggerPhoto(url) {
    if (!url || url.indexOf('cdn.pedix.app') === -1) return url;
    return url.replace(/([?&])size=\d+/, '$1size=480').replace(/([?&])quality=\d+/, '$1quality=75');
  }

  /* Mini-galería del modal: una foto grande + flechas y puntitos si el
     producto tiene más de una. Con 0 o 1 foto se muestra igual que antes
     (una sola imagen o el placeholder "Foto real de Fufa"). */
  function modalGalleryHtml(p) {
    var fit = photoFitFor(MODAL.catSlug);
    var photos = (p.photos && p.photos.length) ? p.photos : null;
    if (!photos || photos.length <= 1) {
      var single = photos ? photos[0] : biggerPhoto(p.thumb);
      return '<div class="modal-gallery photo-wrap" style="aspect-ratio:4/3">' + productImg(single, p.name, '4/3', p.name, fit) + '</div>';
    }
    var idx = MODAL.photoIndex || 0;
    if (idx < 0) idx = photos.length - 1;
    if (idx > photos.length - 1) idx = 0;
    MODAL.photoIndex = idx;
    var dots = photos.map(function (ph, i) {
      return '<button type="button" class="modal-gallery__dot' + (i === idx ? ' is-active' : '') + '" data-modal-photo-dot="' + i + '" aria-label="Ver foto ' + (i + 1) + '"></button>';
    }).join('');
    return (
      '<div class="modal-gallery photo-wrap" style="aspect-ratio:4/3">' +
      productImg(photos[idx], p.name, '4/3', p.name, fit) +
      '<button type="button" class="modal-gallery__arrow modal-gallery__arrow--prev" data-modal-photo-prev aria-label="Foto anterior">‹</button>' +
      '<button type="button" class="modal-gallery__arrow modal-gallery__arrow--next" data-modal-photo-next aria-label="Foto siguiente">›</button>' +
      '</div>' +
      '<div class="modal-gallery__dots">' + dots + '</div>'
    );
  }

  function renderModal() {
    var root = document.getElementById('product-modal-root');
    if (!root || !MODAL) return;
    var p = MODAL.product;
    var groupsHtml = (p.options || []).map(function (o, gi) {
      if (o.rangeType === 'fixed' && o.qty && o.min) {
        var sum = 0;
        for (var k in MODAL.fixed[gi]) sum += MODAL.fixed[gi][k];
        var hintClass = sum === o.min ? 'opt-group__hint is-ok' : 'opt-group__hint';
        var hintText = sum === o.min ? 'Elegiste ' + sum + ' de ' + o.min + ' ✓' : 'Elegiste ' + sum + ' de ' + o.min;
        var rows = o.items.map(function (it) {
          var count = MODAL.fixed[gi][it.name] || 0;
          return (
            '<div class="opt-row opt-row--stepper">' +
            '<span class="opt-row__name">' + escapeHtml(it.name) + '</span>' +
            '<span class="stepper">' +
            '<button type="button" data-fixed-dec data-gi="' + gi + '" data-name="' + escapeHtml(it.name) + '"' + (count <= 0 ? ' disabled' : '') + '>−</button>' +
            '<span>' + count + '</span>' +
            '<button type="button" data-fixed-inc data-gi="' + gi + '" data-name="' + escapeHtml(it.name) + '"' + (sum >= o.min ? ' disabled' : '') + '>+</button>' +
            '</span></div>'
          );
        }).join('');
        return (
          '<div class="opt-group">' +
          '<p class="opt-group__title">' + escapeHtml(o.name || 'Sabores') + ' — elegí ' + o.min + '</p>' +
          '<p class="' + hintClass + '">' + hintText + '</p>' +
          '<div class="opt-list">' + rows + '</div>' +
          '</div>'
        );
      }
      /* "Sin X" (quitar algo) no es un topping para sumar: lo mostramos aparte,
         en "Modificaciones", para no mezclarlo con la lista de agregados. */
      var rowHtml = function (it) {
        var checked = !!(MODAL.any[gi] && MODAL.any[gi][it.name]);
        var price = it.price > 0 ? '<span class="opt-row__price">+ ' + fmt(it.price) + '</span>' : '';
        return (
          '<label class="opt-row' + (checked ? ' is-checked' : '') + '">' +
          '<span class="opt-row__name">' + escapeHtml(it.name) + '</span>' +
          price +
          '<input type="checkbox" data-any-toggle data-gi="' + gi + '" data-name="' + escapeHtml(it.name) + '"' + (checked ? ' checked' : '') + '>' +
          '</label>'
        );
      };
      var mods = o.items.filter(function (it) { return /^sin\s/i.test(it.name); });
      var regular = o.items.filter(function (it) { return !/^sin\s/i.test(it.name); });
      var freeCount = regular.filter(function (it) {
        return !it.price && MODAL.any[gi] && MODAL.any[gi][it.name];
      }).length;
      var isFree = regular.length && regular.every(function (it) { return !it.price; });
      var title = o.name || 'Opciones';
      var counter = isFree ? ' <span class="opt-group__hint is-ok">(elegí 1, sin cargo' + (freeCount ? ' · elegiste ' + freeCount : '') + ')</span>' : '';
      var out = regular.length ? (
        '<div class="opt-group">' +
        '<p class="opt-group__title">' + escapeHtml(title) + counter + '</p>' +
        '<div class="opt-list">' + regular.map(rowHtml).join('') + '</div>' +
        '</div>'
      ) : '';
      if (mods.length) {
        out += (
          '<div class="opt-group">' +
          '<p class="opt-group__title">Modificaciones</p>' +
          '<div class="opt-list">' + mods.map(rowHtml).join('') + '</div>' +
          '</div>'
        );
      }
      return out;
    }).join('');

    var canAdd = modalFixedOk();
    var total = MODAL.qty * (p.price + modalExtrasTotal());
    var msg = canAdd ? '' : '<p class="modal-add-msg">Completá los sabores para poder agregarlo.</p>';
    var noteHtml = ['hamburguesas', 'lomitos', 'sandwiches'].indexOf(MODAL.catSlug) !== -1
      ? ('<label class="modal-note"><span class="modal-note__label">¿Algo que tengamos que saber de tu pedido? (opcional)</span>' +
         '<textarea id="modal-note" rows="2" placeholder="Ej: sin sal, bien cocida, alergia a X…">' + escapeHtml(MODAL.note || '') + '</textarea></label>')
      : '';

    /* Guardamos el scroll del modal antes de redibujar, porque reemplazar el
       innerHTML crea un elemento nuevo y el navegador lo arranca en scrollTop 0
       (eso es lo que hacía "saltar" la pantalla al tildar un topping). */
    var prevBox = root.querySelector('.modal-box');
    var prevScroll = prevBox ? prevBox.scrollTop : 0;

    root.innerHTML =
      '<div class="modal-overlay" id="product-modal-overlay">' +
      '<div class="modal-box" role="dialog" aria-modal="true" aria-label="Agregar ' + escapeHtml(p.name) + '">' +
      '<button type="button" class="modal-close" data-modal-close>Cerrar</button>' +
      modalGalleryHtml(p) +
      '<h3 class="modal-title">' + escapeHtml(p.name) + '</h3>' +
      '<p class="modal-price">' + priceHtml(p.price, p.priceDiscount) + '</p>' +
      (p.desc ? '<p class="modal-desc">' + escapeHtml(p.desc) + '</p>' : '') +
      groupsHtml +
      noteHtml +
      '<div class="modal-sticky-bar">' +
      '<div class="modal-qty"><span class="modal-qty-label">Cantidad</span>' +
      '<span class="stepper">' +
      '<button type="button" data-modal-qty-dec' + (MODAL.qty <= 1 ? ' disabled' : '') + '>−</button>' +
      '<span id="modal-qty-val">' + MODAL.qty + '</span>' +
      '<button type="button" data-modal-qty-inc>+</button>' +
      '</span></div>' +
      '<div class="modal-add-wrap">' + msg +
      '<button type="button" class="btn btn-yellow" id="modal-add-btn" data-modal-add' + (canAdd ? '' : ' disabled') + '>Agregar al pedido · ' + fmt(total) + '</button>' +
      '</div></div></div></div>';

    var newBox = root.querySelector('.modal-box');
    if (newBox && prevScroll) newBox.scrollTop = prevScroll;
  }

  /* Cambiar solo la cantidad (+ / -) no debería redibujar el modal entero:
     eso destruye y vuelve a crear la foto, y en mobile se ve como un
     parpadeo/zoom. Acá tocamos nada más que el número y el botón. */
  function updateModalQtyUi() {
    var root = document.getElementById('product-modal-root');
    if (!root || !MODAL) return;
    var p = MODAL.product;
    var decBtn = root.querySelector('[data-modal-qty-dec]');
    if (decBtn) decBtn.disabled = MODAL.qty <= 1;
    var valEl = document.getElementById('modal-qty-val');
    if (valEl) valEl.textContent = String(MODAL.qty);
    var addBtn = document.getElementById('modal-add-btn');
    if (addBtn && !addBtn.disabled) {
      var total = MODAL.qty * (p.price + modalExtrasTotal());
      addBtn.textContent = 'Agregar al pedido · ' + fmt(total);
    }
  }

  function addModalToCart() {
    if (!MODAL || !modalFixedOk()) return;
    var p = MODAL.product;
    var toppings = [];
    (p.options || []).forEach(function (o, gi) {
      if (o.rangeType === 'fixed' && o.qty && o.min) {
        var picks = MODAL.fixed[gi];
        for (var name in picks) {
          if (picks[name] > 0) toppings.push({ name: name, price: 0, qty: picks[name] });
        }
      } else {
        var sel = MODAL.any[gi];
        o.items.forEach(function (it) {
          if (sel[it.name]) toppings.push({ name: it.name, price: it.price || 0, qty: 1 });
        });
      }
    });
    CART.push({
      id: 'l' + Date.now() + Math.random().toString(36).slice(2, 8),
      catSlug: MODAL.catSlug, catName: MODAL.catName, group: MODAL.group,
      name: p.name, unitPrice: p.price, qty: MODAL.qty, toppings: toppings,
      note: (MODAL.note || '').trim()
    });
    saveCart();
    closeProductModal();
    showAddedToast();
  }

  var toastTimer = null;
  function toastEl() {
    var el = document.querySelector('.ff-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ff-toast';
      document.body.appendChild(el);
    }
    return el;
  }
  function showToast(text, ms) {
    var el = toastEl();
    el.classList.remove('ff-toast--action');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 1800);
  }
  /* Confirmación de "se agregó al pedido": trae un botón para ir directo
     al carrito. A diferencia de un toast normal, esta NO se cierra sola
     por tiempo — se queda hasta que el cliente la cierre a mano, vacíe el
     carrito, confirme el pedido o cambie de sección (ver hideAddedToast,
     llamado desde updateCartBadges y showPage). */
  function showAddedToast() {
    var el = toastEl();
    el.classList.add('ff-toast--action');
    el.innerHTML = '<span>Agregado al pedido ✓</span><button type="button" class="ff-toast__btn" data-open-cart>Ver pedido</button>';
    el.hidden = false;
    clearTimeout(toastTimer);
  }
  function hideAddedToast() {
    var el = document.querySelector('.ff-toast.ff-toast--action');
    if (el) el.hidden = true;
  }

  /* -------- drawer del carrito + checkout -------- */
  var DRAWER_VIEW = 'cart'; /* 'cart' | 'checkout' */
  var CHECKOUT = { tipo: 'retiro', direccion: '', pago: 'Efectivo', pagoCon: '', nombre: '', telefono: '' };
  var checkoutZone = null; /* resultado de findZone()/resolveZone() sobre CHECKOUT.direccion */
  var ZONE_PENDING = 'buscando'; /* sentinel: geocodificando la dirección, todavía no hay resultado */
  var checkoutZoneReqId = 0;

  function checkoutZoneResolved() {
    return checkoutZone && typeof checkoutZone === 'object';
  }

  function deliveryCost() {
    if (CHECKOUT.tipo !== 'delivery') return 0;
    if (checkoutZoneResolved()) return ZONES[checkoutZone.i].cost;
    return 0;
  }

  /* Si lo que escribió no matchea ningún barrio conocido (p. ej. puso
     solo la calle, sin el barrio), probamos geocodificarlo igual que el
     buscador de zona de la sección Delivery, para no obligar al cliente
     a escribir el barrio a mano. Se dispara solo al salir del campo
     (evento "change", ver más abajo) para no spamear Nominatim en cada
     tecla. */
  function resolveCheckoutZone(value) {
    var local = findZone(value);
    if (local === null || local !== -1) {
      checkoutZone = local;
      renderDrawer();
      return;
    }
    checkoutZone = ZONE_PENDING;
    renderDrawer();
    var reqId = ++checkoutZoneReqId;
    resolveZone(value).then(function (result) {
      if (reqId !== checkoutZoneReqId) return; /* el usuario ya volvió a tocar el campo */
      checkoutZone = result;
      renderDrawer();
    });
  }

  function openCart() {
    DRAWER_VIEW = 'cart';
    renderDrawer();
    document.getElementById('cart-drawer-root').hidden = false;
  }

  function closeCart() {
    var root = document.getElementById('cart-drawer-root');
    if (root) { root.hidden = true; }
  }

  function renderDrawer() {
    var root = document.getElementById('cart-drawer-root');
    if (!root) return;
    root.innerHTML = DRAWER_VIEW === 'checkout' ? drawerCheckoutHtml() : drawerCartHtml();
  }

  /* Los tragos "solo para local" no tienen sentido en un pedido de delivery
     o retiro; en vez de bloquear el agregado desde la carta (donde todavía
     no eligió el modo), avisamos acá si el carrito tiene alguno y el modo
     elegido no es "Consumo en el local". */
  function soloLocalWarningHtml() {
    if (CHECKOUT.tipo === 'local') return '';
    var hasSoloLocal = CART.some(function (l) { return (CAT_META[l.catSlug] || {}).soloLocal; });
    if (!hasSoloLocal) return '';
    return '<p class="drawer-closed-notice">Tenés tragos que solo servimos en el local — si pedís delivery o retiro, los vamos a tener que sacar del pedido.</p>';
  }

  function drawerCartHtml() {
    var body;
    if (!CART.length) {
      body = '<p class="drawer-empty">Todavía no agregaste nada. Elegí algo de la carta.</p>';
    } else {
      body = CART.map(function (l) {
        var topsLabel = l.qty > 1
          ? '<p class="cart-line__tops-label">Cada unidad lleva:</p>'
          : '';
        var tops = (l.toppings || []).length
          ? topsLabel + '<ul class="cart-line__tops">' + l.toppings.map(function (t) {
            return '<li>' + t.qty + 'x ' + escapeHtml(t.name) + (t.price > 0 ? ' (+' + fmt(t.price) + ')' : '') + '</li>';
          }).join('') + '</ul>'
          : '';
        var note = l.note ? '<p class="cart-line__note">Nota: ' + escapeHtml(l.note) + '</p>' : '';
        return (
          '<div class="cart-line" data-line="' + l.id + '">' +
          '<div class="cart-line__main"><span class="cart-line__name">' + l.qty + 'x ' + escapeHtml(l.name) + '</span>' +
          '<span class="cart-line__price">' + fmt(linePrice(l)) + '</span></div>' +
          tops + note +
          '<div class="cart-line__ctrl">' +
          '<span class="stepper">' +
          '<button type="button" data-line-dec data-id="' + l.id + '">−</button>' +
          '<span>' + l.qty + '</span>' +
          '<button type="button" data-line-inc data-id="' + l.id + '">+</button>' +
          '</span>' +
          '<button type="button" class="cart-line__remove" data-line-remove data-id="' + l.id + '">Quitar</button>' +
          '</div></div>'
        );
      }).join('');
    }
    var closedNotice = '';
    if (CART.length && !getStatus().open) {
      closedNotice = '<p class="drawer-closed-notice">Ahora estamos cerrados — igual podés armar el pedido, lo confirmamos por WhatsApp apenas abramos.</p>';
    }
    return (
      '<div class="drawer-overlay" id="cart-drawer-overlay">' +
      '<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Tu pedido">' +
      '<div class="drawer-head"><h3>Tu pedido</h3><button type="button" class="drawer-close" data-cart-close>Cerrar</button></div>' +
      (CART.length ? '<button type="button" class="drawer-clear" data-cart-clear>Vaciar carrito</button>' : '') +
      soloLocalWarningHtml() +
      closedNotice +
      '<div class="drawer-body">' + body + '</div>' +
      '<div class="drawer-foot">' +
      '<div class="drawer-total"><span>Total</span><span>' + fmt(cartSubtotal()) + '</span></div>' +
      '<button type="button" class="btn btn-yellow" data-go-checkout' + (CART.length ? '' : ' disabled') + '>Continuar</button>' +
      '</div></div></div>'
    );
  }

  function drawerCheckoutHtml() {
    var sub = cartSubtotal();
    var total = sub + deliveryCost();
    var tipo = CHECKOUT.tipo;
    var avail = availableOrderTypes();

    if (!avail.length) {
      return (
        '<div class="drawer-overlay" id="cart-drawer-overlay">' +
        '<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Terminar pedido">' +
        '<div class="drawer-head"><h3>Terminar pedido</h3><button type="button" class="drawer-close" data-cart-close>Cerrar</button></div>' +
        '<p class="drawer-empty">Por ahora no estamos tomando pedidos por la web (delivery, retiro y consumo en el local están apagados). Escribinos por WhatsApp y vemos cómo te ayudamos.</p>' +
        '<button type="button" class="checkout-back" data-cart-back>← Volver al carrito</button>' +
        '</div></div>'
      );
    }

    var labels = { delivery: 'Delivery', retiro: 'Retiro en el local', local: 'Consumo en el local' };
    var radios = avail.map(function (t) { return radioRow(t, labels[t], tipo); }).join('');

    var conditional = '';
    if (tipo === 'delivery') {
      var zoneHint = '';
      if (CHECKOUT.direccion) {
        if (checkoutZone === ZONE_PENDING) {
          zoneHint = '<p class="zone-hint">Buscando tu dirección…</p>';
        } else if (checkoutZoneResolved()) {
          zoneHint = '<p class="zone-hint ok">Llegamos · envío ' + fmt(ZONES[checkoutZone.i].cost) + '</p>';
        } else if (checkoutZone === 'not-found') {
          zoneHint = '<p class="zone-hint no">No encontramos esa dirección, revisá que esté bien escrita.</p>';
        } else if (checkoutZone === -1) {
          zoneHint = '<p class="zone-hint no">Esa dirección está fuera de zona, coordinamos el envío por WhatsApp.</p>';
        }
      }
      conditional =
        '<label class="field">Dirección (calle y altura; el barrio es opcional)' +
        '<input id="co-direccion" list="co-barrios-list" required value="' + escapeHtml(CHECKOUT.direccion) + '" placeholder="Ej: Rivera Indarte 123">' +
        '</label>' +
        '<p class="field-error" id="co-err-direccion" hidden>Falta la dirección.</p>' +
        zoneHint;
    }

    var pagoConWrap = CHECKOUT.pago === 'Efectivo'
      ? ('<label class="field" id="co-pagocon-wrap">¿Con cuánto pagás? (opcional)<input id="co-pagocon" type="number" min="0" inputmode="numeric" value="' + escapeHtml(CHECKOUT.pagoCon) + '"></label>' +
         '<p class="field-error" id="co-err-pagocon" hidden>Tiene que ser igual o mayor al total del pedido.</p>')
      : '';

    return (
      '<div class="drawer-overlay" id="cart-drawer-overlay">' +
      '<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Terminar pedido">' +
      '<div class="drawer-head"><h3>Terminar pedido</h3><button type="button" class="drawer-close" data-cart-close>Cerrar</button></div>' +
      soloLocalWarningHtml() +
      (getStatus().open ? '' : '<p class="drawer-closed-notice">Ahora estamos cerrados — igual podés mandar el pedido, lo confirmamos por WhatsApp apenas abramos.</p>') +
      '<form class="checkout-form" id="checkout-form">' +
      '<button type="button" class="checkout-back" data-cart-back>← Volver al carrito</button>' +
      '<div class="radio-group">' + radios + '</div>' +
      conditional +
      '<label class="field">Tu nombre<input id="co-nombre" required value="' + escapeHtml(CHECKOUT.nombre) + '" autocomplete="name"></label>' +
      '<p class="field-error" id="co-err-nombre" hidden>Decinos cómo te llamás.</p>' +
      '<label class="field">Teléfono<input id="co-telefono" required value="' + escapeHtml(CHECKOUT.telefono) + '" autocomplete="tel" inputmode="tel" placeholder="Ej: 3511234567"></label>' +
      '<p class="field-error" id="co-err-telefono" hidden>Falta un teléfono válido (mínimo 10 números).</p>' +
      '<label class="field">Forma de pago<select id="co-pago">' +
      ['Efectivo', 'Transferencia', 'Mercado Pago'].map(function (o) { return '<option' + (CHECKOUT.pago === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
      '</select></label>' +
      pagoConWrap +
      '<div class="checkout-total"><span>Total</span><span>' + fmt(total) + '</span></div>' +
      '<button type="submit" class="btn btn-yellow">Confirmar pedido por WhatsApp</button>' +
      '</form></div></div>'
    );
  }

  function radioRow(value, label, current) {
    return (
      '<label class="radio-row' + (current === value ? ' is-active' : '') + '">' +
      '<input type="radio" name="co-tipo" value="' + value + '"' + (current === value ? ' checked' : '') + '>' +
      escapeHtml(label) + '</label>'
    );
  }

  /* Tipos de pedido habilitados según lo que esté prendido en el panel del
     local (Delivery / Retiro / Consumo en el local). Si el dueño apaga un
     servicio, no tiene que poder elegirse acá tampoco. */
  function availableOrderTypes() {
    var s = ADMIN.services || {};
    var out = [];
    if (s.delivery !== false) out.push('delivery');
    if (s.retiro !== false) out.push('retiro');
    if (s.local !== false) out.push('local');
    return out;
  }

  function goCheckout() {
    if (!CART.length) return;
    var avail = availableOrderTypes();
    if (avail.length && avail.indexOf(CHECKOUT.tipo) === -1) CHECKOUT.tipo = avail[0];
    /* Si ya validó un barrio en la sección Delivery, no le hacemos escribirlo
       de nuevo acá: precargamos la dirección y la zona encontrada. */
    if (!CHECKOUT.direccion && currentZone && currentZone !== -1) {
      CHECKOUT.direccion = currentZone.addr || currentZone.b;
      checkoutZone = currentZone;
    }
    DRAWER_VIEW = 'checkout';
    renderDrawer();
  }

  /* Construye el mensaje de WhatsApp replicando EXACTO el formato del ticket
     que imprimía Pedix (dos copias en el local). No reordenar ni "mejorar"
     el texto: cada línea en blanco es intencional. */
  /* Agrupa el carrito por categoría/variante igual que el mensaje de
     WhatsApp. Se usa tanto para armar ese texto como para guardar el
     pedido en Supabase, así el panel puede imprimir la comanda con la
     misma estructura exacta que ve el cliente. */
  function buildOrderGroups() {
    var order = [];
    var map = {};
    CART.forEach(function (l) {
      var key = l.catSlug + '|' + l.group;
      if (!map[key]) { map[key] = { header: l.group ? l.catName + ' (' + l.group + ')' : l.catName, items: [] }; order.push(key); }
      map[key].items.push(l);
    });
    return order.map(function (key) { return map[key]; });
  }

  function buildOrderMessage(seq, code, fecha, total) {
    var lines = [];
    lines.push('¡Hola! Te paso el resumen de mi pedido');
    lines.push('');
    lines.push('Pedido: #' + seq + ' / ' + code);
    lines.push('Tienda: fufafood');
    lines.push('Fecha: ' + fecha);
    lines.push('Nombre: ' + CHECKOUT.nombre);
    lines.push('Teléfono: ' + CHECKOUT.telefono);
    lines.push('');
    lines.push('Forma de pago: ' + CHECKOUT.pago);
    lines.push('Total: ' + fmt(total));
    if (CHECKOUT.pago === 'Efectivo' && CHECKOUT.pagoCon) {
      lines.push('Pago con: ' + fmt(+CHECKOUT.pagoCon));
    }
    lines.push('');
    if (CHECKOUT.tipo === 'local') {
      lines.push('Consumo en el local');
    } else if (CHECKOUT.tipo === 'delivery') {
      lines.push('Delivery a: ' + CHECKOUT.direccion);
    } else {
      lines.push('Retira en el local');
    }
    lines.push('');
    lines.push('Mi pedido es');
    lines.push('');

    buildOrderGroups().forEach(function (g) {
      lines.push(g.header);
      g.items.forEach(function (l) {
        lines.push(l.qty + 'x ' + l.name + ': ' + fmt(linePrice(l)));
        if (l.toppings && l.toppings.length) {
          lines.push(l.qty > 1 ? '    Cada unidad lleva:' : '    Topping:');
          l.toppings.forEach(function (t) {
            lines.push('    - ' + t.qty + 'x ' + t.name + (t.price > 0 ? ' (+' + fmt(t.price) + ')' : ''));
          });
        }
        if (l.note) lines.push('    Nota: ' + l.note);
      });
      lines.push('');
    });
    lines.push('TOTAL: ' + fmt(total));
    lines.push('');
    lines.push('Espero tu respuesta para confirmar mi pedido');
    return lines.join('\n');
  }

  /* Guarda el pedido real en Supabase para que aparezca en el Kanban del
     panel, y de paso trae el número de pedido del día (lo calcula un
     trigger en el servidor — ver supabase/schema.sql — así es el mismo
     contador para todos los pedidos del local, no uno por celular, y se
     reinicia solo cada día). Devuelve una promesa con ese número (o null
     si falló, p. ej. sin conexión): el pedido se manda por WhatsApp igual,
     que es la vía que el local usa de verdad para confirmar y cocinar. */
  /* Intenta guardar hasta 3 veces (con una pequeña espera entre intentos)
     antes de darse por vencido. Esto corre DESPUÉS de abrir WhatsApp (ver
     confirmOrder), así que nunca retrasa ese paso — solo mejora las chances
     de que el pedido llegue al panel aunque haya un hipo de red puntual. */
  function insertOrderWithRetry(payload, attemptsLeft) {
    return db.from('orders').insert(payload).select('daily_seq').single().then(function (res) {
      if (res.error) throw res.error;
      return res.data ? res.data.daily_seq : null;
    }).catch(function (err) {
      if (attemptsLeft > 0) {
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(insertOrderWithRetry(payload, attemptsLeft - 1)); }, 1500);
        });
      }
      if (window.console) console.error('No se pudo guardar el pedido real', err);
      showToast('Ojo: no pudimos confirmar tu pedido en el sistema del local. Asegurate de que te respondan por WhatsApp.', 6000);
      return null;
    });
  }

  function saveRealOrder(total, code) {
    if (!db) return Promise.resolve(null);
    var itemsData = buildOrderGroups().map(function (g) {
      return {
        header: g.header,
        items: g.items.map(function (l) {
          return {
            qty: l.qty,
            name: l.name,
            price: linePrice(l),
            toppings: (l.toppings || []).map(function (t) { return { qty: t.qty, name: t.name, price: t.price }; }),
            note: l.note || ''
          };
        })
      };
    });
    var address = CHECKOUT.tipo === 'delivery' ? CHECKOUT.direccion : (CHECKOUT.tipo === 'local' ? 'Consumo en el local' : '');
    var zoneName = (CHECKOUT.tipo === 'delivery' && checkoutZoneResolved()) ? ZONES[checkoutZone.i].name : null;
    var pagoCon = (CHECKOUT.pago === 'Efectivo' && CHECKOUT.pagoCon) ? +CHECKOUT.pagoCon : null;
    return insertOrderWithRetry({
      customer_name: CHECKOUT.nombre,
      phone: CHECKOUT.telefono,
      tipo: CHECKOUT.tipo,
      address: address,
      zone: zoneName,
      code: code,
      pago_con: pagoCon,
      payment: CHECKOUT.pago,
      items: itemsData,
      total: total,
      status: 'nuevos'
    }, 2);
  }

  function markField(inputId, errId, ok) {
    var input = document.getElementById(inputId);
    var err = document.getElementById(errId);
    if (input) input.classList.toggle('is-invalid', !ok);
    if (err) err.hidden = ok;
  }

  function confirmOrder(e) {
    e.preventDefault();
    var total = cartSubtotal() + deliveryCost();
    var nombreOk = !!CHECKOUT.nombre.trim();
    var telDigits = CHECKOUT.telefono.replace(/\D/g, '');
    var telOk = telDigits.length >= 10;
    var dirOk = CHECKOUT.tipo !== 'delivery' || !!CHECKOUT.direccion.trim();
    var pagoConOk = !(CHECKOUT.pago === 'Efectivo' && CHECKOUT.pagoCon && +CHECKOUT.pagoCon < total);
    markField('co-nombre', 'co-err-nombre', nombreOk);
    markField('co-telefono', 'co-err-telefono', telOk);
    if (CHECKOUT.tipo === 'delivery') markField('co-direccion', 'co-err-direccion', dirOk);
    markField('co-pagocon', 'co-err-pagocon', pagoConOk);
    if (!nombreOk || !telOk || !dirOk || !pagoConOk) {
      var firstBad = !nombreOk ? 'co-nombre' : (!telOk ? 'co-telefono' : (!dirOk ? 'co-direccion' : 'co-pagocon'));
      var el = document.getElementById(firstBad);
      if (el) el.focus();
      return;
    }

    var code = randOrderCode();
    var fecha = argDateStr(new Date());
    /* El número que ve el cliente en el mensaje es el contador local
       (instantáneo). El panel usa su propio contador del día, calculado en
       el servidor (ver saveRealOrder) — son dos números independientes a
       propósito: abrir WhatsApp tiene que pasar YA, en el mismo tap, sin
       esperar ninguna respuesta de red. En mobile (sobre todo Safari), si
       hay cualquier espera de por medio entre el toque y la navegación, el
       navegador la bloquea y queda una pestaña en blanco rota. */
    var seq = nextOrderSeq();
    var msg = buildOrderMessage(seq, code, fecha, total);

    saveRealOrder(total, code);
    window.open(waText(msg), '_blank', 'noopener');

    CART = [];
    saveCart();
    checkoutZone = null;
    CHECKOUT = { tipo: 'retiro', direccion: '', pago: 'Efectivo', pagoCon: '', nombre: '', telefono: '' };
    closeCart();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest('[role="button"]');
    if (!el) return;
    e.preventDefault();
    el.click();
  });

  /* -------- delegación de eventos: producto, drawer y checkout -------- */
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add-product]');
    if (add) {
      e.preventDefault();
      if (ADMIN.receiving === false) { showToast('Pausamos los pedidos por ahora. Escribinos por WhatsApp.'); return; }
      var addCat = add.getAttribute('data-cat'), addPid = add.getAttribute('data-pid');
      var addProd = findProductById(addCat, addPid);
      /* Sin opciones para elegir: se agrega directo, sin pasar por el modal. */
      if (addProd && !hasOptions(addProd)) { quickAddQty(addCat, addPid, 1); }
      else { openProductModal(addCat, addPid); }
      return;
    }

    var openProd = e.target.closest('[data-open-product]');
    if (openProd) { openProductModal(openProd.getAttribute('data-cat'), openProd.getAttribute('data-pid')); return; }

    var qtyInc = e.target.closest('[data-qty-inc]');
    if (qtyInc) {
      var stepperInc = qtyInc.closest('[data-qty-pid]');
      quickAddQty(stepperInc.getAttribute('data-qty-cat'), stepperInc.getAttribute('data-qty-pid'), 1);
      updateStepperUi(stepperInc);
      return;
    }
    var qtyDec = e.target.closest('[data-qty-dec]');
    if (qtyDec) {
      var stepperDec = qtyDec.closest('[data-qty-pid]');
      quickAddQty(stepperDec.getAttribute('data-qty-cat'), stepperDec.getAttribute('data-qty-pid'), -1);
      updateStepperUi(stepperDec);
      return;
    }

    if (e.target.closest('[data-modal-close]') || e.target.id === 'product-modal-overlay') { closeProductModal(); return; }
    if (e.target.closest('[data-modal-photo-prev]')) { MODAL.photoIndex = (MODAL.photoIndex || 0) - 1; renderModal(); return; }
    if (e.target.closest('[data-modal-photo-next]')) { MODAL.photoIndex = (MODAL.photoIndex || 0) + 1; renderModal(); return; }
    var photoDot = e.target.closest('[data-modal-photo-dot]');
    if (photoDot) { MODAL.photoIndex = +photoDot.getAttribute('data-modal-photo-dot'); renderModal(); return; }
    if (e.target.closest('[data-modal-qty-inc]')) { MODAL.qty++; updateModalQtyUi(); return; }
    if (e.target.closest('[data-modal-qty-dec]')) { if (MODAL.qty > 1) MODAL.qty--; updateModalQtyUi(); return; }
    var fInc = e.target.closest('[data-fixed-inc]');
    if (fInc) {
      var gi1 = fInc.getAttribute('data-gi'), name1 = fInc.getAttribute('data-name');
      var sum1 = 0; for (var k1 in MODAL.fixed[gi1]) sum1 += MODAL.fixed[gi1][k1];
      var min1 = MODAL.product.options[gi1].min;
      if (sum1 < min1) MODAL.fixed[gi1][name1] = (MODAL.fixed[gi1][name1] || 0) + 1;
      renderModal(); return;
    }
    var fDec = e.target.closest('[data-fixed-dec]');
    if (fDec) {
      var gi2 = fDec.getAttribute('data-gi'), name2 = fDec.getAttribute('data-name');
      if (MODAL.fixed[gi2][name2] > 0) MODAL.fixed[gi2][name2]--;
      renderModal(); return;
    }
    if (e.target.closest('[data-modal-add]')) { addModalToCart(); return; }

    if (e.target.closest('[data-cart-close]') || e.target.id === 'cart-drawer-overlay') { closeCart(); return; }
    if (e.target.closest('[data-cart-clear]')) {
      if (CART.length && window.confirm('¿Vaciar todo el pedido?')) { CART = []; saveCart(); renderDrawer(); }
      return;
    }
    if (e.target.closest('[data-go-checkout]')) { goCheckout(); return; }
    if (e.target.closest('[data-cart-back]')) { DRAWER_VIEW = 'cart'; renderDrawer(); return; }
    var lineInc = e.target.closest('[data-line-inc]');
    if (lineInc) {
      var l1 = CART.filter(function (x) { return x.id === lineInc.getAttribute('data-id'); })[0];
      if (l1) { l1.qty++; saveCart(); renderDrawer(); }
      return;
    }
    var lineDec = e.target.closest('[data-line-dec]');
    if (lineDec) {
      var l2 = CART.filter(function (x) { return x.id === lineDec.getAttribute('data-id'); })[0];
      if (l2 && l2.qty > 1) { l2.qty--; saveCart(); renderDrawer(); }
      return;
    }
    var lineRm = e.target.closest('[data-line-remove]');
    if (lineRm) {
      CART = CART.filter(function (x) { return x.id !== lineRm.getAttribute('data-id'); });
      saveCart(); renderDrawer();
      return;
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.closest('[data-any-toggle]')) {
      var t = e.target, gi = t.getAttribute('data-gi'), name = t.getAttribute('data-name');
      var group = MODAL.product.options[gi];
      var isSinItem = /^sin\s/i.test(name);
      var regularItems = group.items.filter(function (it) { return !/^sin\s/i.test(it.name); });
      var isFreeGroup = regularItems.length > 0 && regularItems.every(function (it) { return !it.price; });
      /* "Topping a elección" en la descripción = 1 solo topping gratis, no
         todos los que haya. Las opciones pagas (Extras) y los "Sin X" no
         tienen este límite. */
      if (t.checked && isFreeGroup && !isSinItem) {
        regularItems.forEach(function (it) { MODAL.any[gi][it.name] = false; });
      }
      MODAL.any[gi][name] = t.checked;
      renderModal();
      return;
    }
    if (e.target.name === 'co-tipo') {
      CHECKOUT.tipo = e.target.value;
      renderDrawer();
      return;
    }
    if (e.target.id === 'co-direccion') {
      CHECKOUT.direccion = e.target.value;
      resolveCheckoutZone(e.target.value);
      return;
    }
    if (e.target.id === 'co-pago') { CHECKOUT.pago = e.target.value; renderDrawer(); return; }
    if (e.target.id === 'co-pagocon') { CHECKOUT.pagoCon = e.target.value; return; }
    if (e.target.id === 'co-nombre') { CHECKOUT.nombre = e.target.value; return; }
    if (e.target.id === 'co-telefono') { CHECKOUT.telefono = e.target.value; return; }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'co-nombre') { CHECKOUT.nombre = e.target.value; markField('co-nombre', 'co-err-nombre', !!e.target.value.trim()); }
    if (e.target.id === 'co-telefono') { CHECKOUT.telefono = e.target.value; markField('co-telefono', 'co-err-telefono', e.target.value.replace(/\D/g, '').length >= 10); }
    if (e.target.id === 'co-pagocon') { CHECKOUT.pagoCon = e.target.value; markField('co-pagocon', 'co-err-pagocon', !(CHECKOUT.pago === 'Efectivo' && CHECKOUT.pagoCon && +CHECKOUT.pagoCon < (cartSubtotal() + deliveryCost()))); }
    if (e.target.id === 'co-direccion') {
      CHECKOUT.direccion = e.target.value;
      checkoutZone = findZone(e.target.value);
      markField('co-direccion', 'co-err-direccion', !!e.target.value.trim());
    }
    if (e.target.id === 'modal-note' && MODAL) MODAL.note = e.target.value;
  });

  document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'checkout-form') confirmOrder(e);
  });

  /* ===================== fin CARRITO ===================== */

  /* Aplica los overrides guardados por el panel (admin.js) sobre el catálogo
     recién cargado de data-carta.json, ANTES de que se renderice nada.
     Si no hay overrides (ADMIN vacío) devuelve los datos sin tocar. */
  function applyAdminOverrides(data) {
    var catOn = ADMIN.catOn || {};
    var overrides = ADMIN.productOverrides || {};
    var customProducts = ADMIN.customProducts || {};
    var out = data.filter(function (c) { return catOn[c.slug] !== false; });
    out = out.map(function (c) {
      var products = c.products.slice();
      if (customProducts[c.slug] && customProducts[c.slug].length) {
        products = products.concat(customProducts[c.slug]);
      }
      products = products.map(function (p) {
        var ov = overrides[p.id];
        if (!ov) return p;
        if (ov.deleted || ov.hidden) return null;
        var np = {};
        for (var k in p) np[k] = p[k];
        if (typeof ov.price === 'number') np.price = ov.price;
        if (typeof ov.name === 'string' && ov.name) np.name = ov.name;
        if (typeof ov.desc === 'string') np.desc = ov.desc;
        var photos = (ov.photos && ov.photos.length) ? ov.photos : (ov.photo ? [ov.photo] : null);
        if (photos && photos.length) { np.thumb = photos[0]; np.image = photos[0]; np.photos = photos; }
        if (ov.on === false) np.soldOut = true;
        if (ov.promo) np.promo = true;
        return np;
      }).filter(Boolean);
      var catPhoto = ADMIN.photos && ADMIN.photos['cat-' + c.slug];
      var cc = {};
      for (var k2 in c) cc[k2] = c[k2];
      cc.products = products;
      if (catPhoto) cc.thumb = catPhoto;
      return cc;
    });
    return out;
  }

  /* Producto tachado + etiqueta "Agotado" cuando el panel lo marcó como no disponible. */
  function soldOutWrap(p, innerHtml) {
    if (!p.soldOut) return innerHtml;
    var inner = innerHtml.replace(/^<li[^>]*>/, '').replace(/<\/li>$/, '');
    var openTag = innerHtml.match(/^<li([^>]*)>/);
    return '<li style="opacity:.5"' + (openTag ? openTag[1] : '') + '>' + inner +
      ' <span style="display:inline-block;background:#E63B2E;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;margin-left:6px">Agotado</span></li>';
  }

  function isDesk() { return window.innerWidth >= 1024; }
  function navPx() { return isDesk() ? 64 : 56; }

  /* ===================== status ===================== */
  /* "min" son minutos desde las 00:00, puede venir ya pasado de 1440 (ej.
     1470 = 00:30 del día siguiente) — por eso el módulo antes de formatear. */
  function fmtClockMin(min) {
    var m = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    if (h === 0 && mm === 0) return 'medianoche';
    return h + (mm ? ':' + (mm < 10 ? '0' + mm : mm) : '');
  }
  function getStatus() {
    /* Estado forzado desde el panel (feriados, etc.), ignora el horario. */
    if (ADMIN.estado === 'abierto') return { open: true, text: 'Abierto', nav: 'Abierto' };
    if (ADMIN.estado === 'cerrado') return { open: false, text: 'Cerrado', nav: 'Cerrado' };
    var d = new Date(), day = d.getDay(), nowMin = d.getHours() * 60 + d.getMinutes();
    var today = HOURS[day];
    var yesterday = HOURS[(day + 6) % 7];
    /* Abierto hoy dentro de su propio rango, o todavía dentro de la cola
       nocturna de ayer (ej. ayer cerró 00:30, son las 00:15 de hoy). */
    if (today && nowMin >= today.from && nowMin < today.to) {
      return { open: true, text: 'Abierto hasta las ' + fmtClockMin(today.to), nav: 'Abierto' };
    }
    if (yesterday && yesterday.to > 1440 && nowMin < (yesterday.to - 1440)) {
      return { open: true, text: 'Abierto hasta las ' + fmtClockMin(yesterday.to), nav: 'Abierto' };
    }
    var next = '';
    var nextOpenMin = today ? today.from : null;
    if (!(today && nowMin < today.from)) {
      for (var i = 1; i <= 7; i++) {
        var nd = (day + i) % 7;
        if (HOURS[nd]) { next = i === 1 ? 'mañana ' : 'el ' + DAYS[nd] + ' '; nextOpenMin = HOURS[nd].from; break; }
      }
    }
    return { open: false, text: 'Cerrado, abrimos ' + next + 'a las ' + fmtClockMin(nextOpenMin), nav: 'Cerrado' };
  }

  function renderStatus() {
    var st = getStatus();
    var color = st.open ? '#2DB84C' : '#E63B2E';
    document.querySelectorAll('.status-dot').forEach(function (el) { el.style.background = color; });
    var full = document.getElementById('status-text-full');
    var short = document.getElementById('status-text-short');
    var menu = document.getElementById('mobile-menu-status');
    if (full) full.textContent = st.text;
    if (short) short.textContent = st.nav;
    if (menu) menu.innerHTML = escapeHtml(st.text) + '<br>Mariano Fragueiro 2706, esq. Francisco de Quevedo, Alta Córdoba';
  }

  /* ===================== promo de hoy (la activa el local desde el panel) =====================
     El local marca uno o más productos como "En promo hoy" en Carta y
     precios. Acá NO se toca el hero — se muestra como un recuadro
     superpuesto (como el modal de producto) con una cruz para cerrar,
     que aparece solo una vez por carga de página. Tocar la foto/info
     manda directo a pedirlo, igual que "Agregar al pedido" en la carta. */
  function findActivePromos() {
    if (!CARTA_DATA) return [];
    var out = [];
    CARTA_DATA.forEach(function (c) {
      c.products.forEach(function (p) {
        if (p.promo && !p.soldOut) out.push({ catSlug: c.slug, product: p });
      });
    });
    return out;
  }

  var PROMO_IDX = 0;
  var promoOverlayShownOnce = false;
  var promoOverlayOpen = false;

  function promoCardHtml(promos, idx) {
    var item = promos[idx];
    var p = item.product;
    var multi = promos.length > 1;
    var dots = multi ? promos.map(function (_, i) {
      return '<button type="button" class="promo-overlay__dot' + (i === idx ? ' is-active' : '') + '" data-promo-dot="' + i + '" aria-label="Ver promo ' + (i + 1) + '"></button>';
    }).join('') : '';
    /* Es un <div role="button"> y no un <button> real porque adentro tiene
       las flechas de "siguiente/anterior", que SÍ son botones de verdad —
       un botón real no puede contener otro botón (HTML inválido). */
    return (
      '<div class="promo-overlay__tap" data-add-product data-cat="' + escapeHtml(item.catSlug) + '" data-pid="' + escapeHtml(p.id) + '" role="button" tabindex="0" aria-label="Pedir ' + escapeHtml(p.name) + '">' +
      '<div class="promo-overlay__photo photo-wrap" style="aspect-ratio:4/3">' +
      productImg(p.thumb, p.name, '4/3', p.name) +
      (multi ? '<button type="button" class="promo-overlay__arrow promo-overlay__arrow--prev" data-promo-prev aria-label="Promo anterior">‹</button>' : '') +
      (multi ? '<button type="button" class="promo-overlay__arrow promo-overlay__arrow--next" data-promo-next aria-label="Promo siguiente">›</button>' : '') +
      '</div>' +
      '<div class="promo-overlay__info">' +
      '<h2 class="promo-overlay__name">' + escapeHtml(p.name) + '</h2>' +
      (p.desc ? '<p class="promo-overlay__desc">' + escapeHtml(p.desc) + '</p>' : '') +
      '<p class="promo-overlay__price">' + priceHtml(p.price, p.priceDiscount) + '</p>' +
      (multi ? '<div class="promo-overlay__dots">' + dots + '</div>' : '') +
      '</div>' +
      '</div>'
    );
  }

  function renderPromoOverlay() {
    var root = document.getElementById('promo-overlay-root');
    if (!root) return;
    var promos = findActivePromos();
    if (!promos.length) { closePromoOverlay(); return; }
    if (PROMO_IDX >= promos.length) PROMO_IDX = 0;
    promoOverlayOpen = true;
    root.innerHTML =
      '<div class="modal-overlay promo-overlay" id="promo-overlay-backdrop">' +
      '<div class="modal-box promo-overlay__box">' +
      '<button type="button" class="modal-close promo-overlay__close" data-promo-close aria-label="Cerrar">×</button>' +
      '<p class="promo-overlay__tag">' + (promos.length > 1 ? 'Promos de hoy' : 'Promo de hoy') + '</p>' +
      promoCardHtml(promos, PROMO_IDX) +
      '</div></div>';
    var backdrop = document.getElementById('promo-overlay-backdrop');
    if (backdrop) backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closePromoOverlay(); });
    var closeBtn = root.querySelector('[data-promo-close]');
    if (closeBtn) closeBtn.addEventListener('click', closePromoOverlay);
    var prev = root.querySelector('[data-promo-prev]');
    var next = root.querySelector('[data-promo-next]');
    if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); PROMO_IDX = (PROMO_IDX - 1 + promos.length) % promos.length; renderPromoOverlay(); });
    if (next) next.addEventListener('click', function (e) { e.stopPropagation(); PROMO_IDX = (PROMO_IDX + 1) % promos.length; renderPromoOverlay(); });
    root.querySelectorAll('[data-promo-dot]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); PROMO_IDX = +btn.getAttribute('data-promo-dot'); renderPromoOverlay(); });
    });
    var tap = root.querySelector('.promo-overlay__tap');
    /* Al tocar para pedir, cerramos el recuadro antes de que el handler
       global de [data-add-product] abra el modal del producto (si no,
       quedan los dos superpuestos). */
    if (tap) tap.addEventListener('click', function () { closePromoOverlay(); });
  }

  function closePromoOverlay() {
    promoOverlayOpen = false;
    var root = document.getElementById('promo-overlay-root');
    if (root) root.innerHTML = '';
  }

  /* Se llama cada vez que se refresca la carta (carga inicial o cambio en
     vivo desde el panel). La abre sola una sola vez por carga de página;
     si el cliente ya la cerró, no vuelve a aparecer sola, pero si queda
     abierta y el local cambia la promo mientras tanto, se actualiza. */
  function renderHeroPromo() {
    var promos = findActivePromos();
    if (!promos.length) { if (promoOverlayOpen) closePromoOverlay(); return; }
    if (promoOverlayOpen) { renderPromoOverlay(); return; }
    if (!promoOverlayShownOnce) {
      promoOverlayShownOnce = true;
      renderPromoOverlay();
    }
  }

  /* ===================== render: home categories grid ===================== */
  function renderHomeCatGrid() {
    var el = document.getElementById('home-cat-grid');
    if (!el) return;
    if (!CARTA_DATA) { el.innerHTML = '<li class="carta-loading">Cargando la carta…</li>'; return; }
    el.innerHTML = CARTA_DATA.map(function (c, i) {
      var min = catMin(c);
      var from = min !== null ? 'desde ' + fmt(min) : '';
      var meta = CAT_META[c.slug] || {};
      var delay = String((i % 3) * 70);
      var badge = meta.soloLocal ? '<span class="cat-card__badge">Solo en el local</span>' : '';
      return (
        '<li data-reveal="' + delay + '">' +
        '<a href="/carta" class="cat-card" data-go-cat="' + c.slug + '">' +
        '<div class="cat-card__photo photo-wrap" style="aspect-ratio:4/3">' + productImg(c.thumb, c.name, '4/3', c.name) + badge + '</div>' +
        '<div class="cat-card__row"><h3 class="cat-card__name">' + escapeHtml(c.name) + '</h3><span class="cat-card__from">' + escapeHtml(from) + '</span></div>' +
        '<p class="cat-card__examples">' + escapeHtml(meta.examples || '') + '</p>' +
        '</a></li>'
      );
    }).join('');
  }

  /* ===================== render: home top products ===================== */
  function renderHomeTop() {
    var el = document.getElementById('home-top-grid');
    if (!CARTA_DATA) { el.innerHTML = '<p class="carta-loading">Cargando la carta…</p>'; return; }
    var activePicks = (ADMIN.topPicks && ADMIN.topPicks.length === 4) ? ADMIN.topPicks : TOP_PICKS;
    var picks = activePicks.map(function (pick) {
      /* Los picks viejos guardaban solo {cat,name}; renombrar el producto
         rompía la referencia. Los nuevos guardan {cat,id}, estable. */
      var p = pick.id ? findProductById(pick.cat, pick.id) : findProduct(pick.cat, pick.name);
      var cat = CARTA_DATA.filter(function (c) { return c.slug === pick.cat; })[0];
      return p ? { cat: pick.cat, catName: cat ? cat.name : '', p: p } : null;
    }).filter(Boolean);
    el.innerHTML = picks.map(function (pick, i) {
      var p = pick.p;
      return (
        '<article class="top-pick" data-reveal="' + String(i * 70) + '">' +
        '<a href="/carta" class="top-card" data-go-cat="' + escapeHtml(pick.cat) + '">' +
        '<div class="top-card__photo photo-wrap" style="aspect-ratio:4/5">' + productImg(p.thumb, p.name, '4/5', p.name) + '</div>' +
        '<p class="top-card__cat">' + escapeHtml(pick.catName) + '</p>' +
        '<div class="top-card__row"><h3 class="top-card__name">' + escapeHtml(p.name) + '</h3><span class="top-card__price">' + priceHtml(p.price, p.priceDiscount) + '</span></div>' +
        '<p class="top-card__desc">' + escapeHtml(p.desc || '') + '</p>' +
        '</a>' +
        '<button type="button" class="btn-add btn-add--top" data-add-product data-cat="' + escapeHtml(pick.cat) + '" data-pid="' + escapeHtml(p.id) + '"' + (p.soldOut ? ' disabled' : '') + '>Agregar al pedido</button>' +
        '</article>'
      );
    }).join('');
  }

  /* ===================== render: carta ===================== */
  var activeCat = null;

  function renderCartaChips() {
    var el = document.getElementById('carta-chip-list');
    if (!CARTA_DATA) { el.innerHTML = '<span class="carta-loading">Cargando la carta…</span>'; return; }
    if (!activeCat) activeCat = CARTA_DATA[0].slug;
    el.innerHTML = CARTA_DATA.map(function (c) {
      return '<button type="button" class="chip" data-go-cat="' + c.slug + '">' + escapeHtml(c.name) + '</button>';
    }).join('');
    updateChipActive();
    el.querySelectorAll('[data-go-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () { goCat(btn.getAttribute('data-go-cat')); });
    });
  }

  function updateChipActive() {
    document.querySelectorAll('#carta-chip-list .chip').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-go-cat') === activeCat);
    });
  }

  function renderCartaCategories() {
    var el = document.getElementById('carta-categories');
    if (!CARTA_DATA) { el.innerHTML = '<p class="carta-loading">Cargando la carta…</p>'; return; }
    el.innerHTML = CARTA_DATA.map(function (c) {
      var meta = CAT_META[c.slug] || {};
      var badge = meta.soloLocal ? '<p class="cat-section__badge">Solo en el local</p>' : '';

      /* Agrupamos por el campo "group" del producto (puede ser ""). */
      var groupOrder = [];
      var groupMap = {};
      c.products.forEach(function (p) {
        var key = p.group || '';
        if (!groupMap[key]) { groupMap[key] = []; groupOrder.push(key); }
        groupMap[key].push(p);
      });

      var body = groupOrder.map(function (key) {
        var title = key ? '<h3 class="cat-group__title">' + escapeHtml(key) + '</h3>' : '';
        var items = groupMap[key].map(function (p) {
          var addControl = hasOptions(p)
            ? '<button type="button" class="btn-add" data-add-product data-cat="' + escapeHtml(c.slug) + '" data-pid="' + escapeHtml(p.id) + '"' + (p.soldOut ? ' disabled' : '') + '>Agregar al pedido</button>'
            : (
              '<div class="qty-stepper" data-qty-cat="' + escapeHtml(c.slug) + '" data-qty-pid="' + escapeHtml(p.id) + '">' +
              '<button type="button" class="qty-stepper__btn" data-qty-dec aria-label="Quitar uno"' + ((p.soldOut || cartQtyFor(c.slug, p.name) <= 0) ? ' disabled' : '') + '>−</button>' +
              '<span class="qty-stepper__val" data-qty-val>' + cartQtyFor(c.slug, p.name) + '</span>' +
              '<button type="button" class="qty-stepper__btn qty-stepper__btn--add" data-qty-inc aria-label="Agregar uno"' + (p.soldOut ? ' disabled' : '') + '>+</button>' +
              '</div>'
            );
          var searchHay = norm(p.name + ' ' + c.name + ' ' + (p.desc || ''));
          var li = (
            '<li data-open-product data-cat="' + escapeHtml(c.slug) + '" data-pid="' + escapeHtml(p.id) + '" data-search="' + escapeHtml(searchHay) + '" role="button" tabindex="0" aria-label="Ver ' + escapeHtml(p.name) + '">' +
            '<div class="cat-items__thumb photo-wrap">' + productImg(p.thumb, p.name, '1/1', p.name, photoFitFor(c.slug)) + '</div>' +
            '<div class="cat-items__main">' +
            '<div class="cat-items__toprow"><div class="cat-items__name">' + escapeHtml(p.name) + '</div>' +
            '<span class="cat-items__price">' + priceHtml(p.price, p.priceDiscount) + '</span></div>' +
            '<div class="cat-items__add">' + addControl + '</div>' +
            '</div></li>'
          );
          return soldOutWrap(p, li);
        }).join('');
        return '<div class="cat-group">' + title + '<ul class="cat-items">' + items + '</ul></div>';
      }).join('');

      return (
        '<section id="cat-' + c.slug + '" class="cat-section">' +
        '<div class="cat-section__head">' +
        '<h2 class="h3 h3--big" data-reveal="0">' + escapeHtml(c.name) + '</h2>' +
        '<p class="cat-section__line" data-reveal="60">' + escapeHtml(meta.line1 || '') + '</p>' +
        badge +
        '</div>' +
        '<div data-reveal="80" style="min-width:0">' + body + '</div>' +
        '</section>'
      );
    }).join('');
  }

  function goCat(id) {
    activeCat = id;
    updateChipActive();
    var el = document.getElementById('cat-' + id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navPx() - 56, behavior: 'smooth' });
  }

  var pendingCat = null;
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go-cat]');
    if (t && t.tagName === 'A') {
      pendingCat = t.getAttribute('data-go-cat');
    }
  });

  /* Botones "Retirar" / "Delivery" del hero: dejan elegido ese tipo de pedido
     para cuando se llegue al checkout, además de llevar a la carta. */
  document.addEventListener('click', function (e) {
    var ot = e.target.closest('[data-order-type]');
    if (ot) CHECKOUT.tipo = ot.getAttribute('data-order-type');
  });

  function spy() {
    if (currentPage !== 'carta' || !CARTA_DATA) return;
    var cur = CARTA_DATA[0].slug;
    CARTA_DATA.forEach(function (c) {
      var el = document.getElementById('cat-' + c.slug);
      if (el && el.getBoundingClientRect().top < 180) cur = c.slug;
    });
    if (cur !== activeCat) { activeCat = cur; updateChipActive(); }
  }

  /* ===================== render: delivery ===================== */
  var currentZone = null; // null = no query yet, -1 = not found, {i,b} = found

  function renderZonesList() {
    var el = document.getElementById('zones-list');
    el.innerHTML = ZONES.map(function (z, i) {
      var barrios = z.barrios.map(function (b) {
        var active = currentZone && currentZone !== -1 && currentZone.b === b ? ' is-active' : '';
        return '<button type="button" class="barrio-btn' + active + '" data-pick-zone="' + i + '" data-pick-barrio="' + escapeHtml(b) + '">' + escapeHtml(b) + '</button>';
      }).join('');
      return (
        '<div class="zone-block">' +
        '<div class="zone-block__head"><h3 class="zone-block__name">' + escapeHtml(z.name) + '</h3>' +
        '<span><strong>Envío ' + fmt(z.cost) + '</strong> · ' + escapeHtml(z.km) + ' · ' + escapeHtml(z.time) + '</span></div>' +
        '<div class="zone-block__barrios">' + barrios + '</div>' +
        '</div>'
      );
    }).join('');
    el.querySelectorAll('[data-pick-zone]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = +btn.getAttribute('data-pick-zone');
        var b = btn.getAttribute('data-pick-barrio');
        currentZone = { i: i, b: b, addr: b };
        document.getElementById('barrio-input').value = b;
        renderZonesList();
        renderZoneResult();
      });
    });
  }

  function renderBarriosDatalist() {
    var dl = document.getElementById('barrios-list');
    var all = ZONES.reduce(function (acc, z) { return acc.concat(z.barrios); }, []);
    dl.innerHTML = all.map(function (b) { return '<option value="' + escapeHtml(b) + '"></option>'; }).join('');
  }

  function findZone(q) {
    var n = norm(q);
    if (!n) return null;
    for (var i = 0; i < ZONES.length; i++) {
      for (var j = 0; j < ZONES[i].barrios.length; j++) {
        var b = ZONES[i].barrios[j];
        var nb = norm(b);
        if (nb === n || (n.length >= 4 && (nb.indexOf(n) !== -1 || n.indexOf(nb) !== -1))) return { i: i, b: b, addr: q.trim() };
      }
    }
    return -1;
  }

  /* ===================== zona por dirección (sin barrio escrito) =====================
     Si no reconocemos el barrio en lo que escribió, probamos ubicar la
     dirección con OpenStreetMap (gratis, sin API key) y calculamos la
     distancia real al local para asignar la zona por el radio en km que
     ya tiene cada una (mismo criterio que el mapa del panel). Si el
     buscador no encuentra nada, no inventamos una zona: queda "no
     reconocida" igual que antes, y se sugiere confirmar por WhatsApp. */
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function zoneIndexByDistanceKm(km) {
    for (var i = 0; i < ZONES.length; i++) {
      if (typeof ZONES[i].radius === 'number' && km <= ZONES[i].radius) return i;
    }
    return -1;
  }

  function geocodeAddress(query) {
    var pad = 0.15; // ~16km a la redonda del local, suficiente para toda la ciudad
    var viewbox = [CENTER_LON - pad, CENTER_LAT + pad, CENTER_LON + pad, CENTER_LAT - pad].join(',');
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&bounded=1&viewbox=' +
      viewbox + '&q=' + encodeURIComponent(query + ', Córdoba, Argentina');
    return fetch(url).then(function (r) { return r.json(); }).then(function (results) {
      if (!results || !results.length) return null;
      return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
    }).catch(function () { return null; });
  }

  /* Versión async de findZone: primero prueba el match rápido por barrio
     (gratis, instantáneo) y solo si no encuentra nada intenta geocodificar
     la dirección completa. Siempre devuelve una promesa con el mismo shape
     que findZone (null / -1 / {i,b,addr}). */
  /* resolveZone puede devolver: null (query vacía), -1 (encontramos la
     dirección pero está fuera de las zonas de envío), 'not-found' (no
     pudimos ubicar esa dirección, probablemente está mal escrita) o un
     {i,b,addr} con la zona encontrada. */
  var ZONE_NOT_FOUND = 'not-found';
  function resolveZone(q) {
    var local = findZone(q);
    if (local === null || local !== -1) return Promise.resolve(local);
    var query = (q || '').trim();
    if (query.length < 5) return Promise.resolve(ZONE_NOT_FOUND);
    return geocodeAddress(query).then(function (pos) {
      if (!pos) return ZONE_NOT_FOUND;
      var km = haversineKm(CENTER_LAT, CENTER_LON, pos.lat, pos.lon);
      var i = zoneIndexByDistanceKm(km);
      if (i === -1) return -1;
      return { i: i, b: ZONES[i].barrios[0], addr: query, geocoded: true };
    });
  }

  function renderZoneResult() {
    var el = document.getElementById('zone-result');
    if (!currentZone) { el.innerHTML = ''; return; }
    if (currentZone === ZONE_NOT_FOUND) {
      el.innerHTML = '<div class="zone-result zone-result--no"><strong>No encontramos esa dirección.</strong> Revisá que esté bien escrita (calle, altura y barrio) e intentá de nuevo.</div>';
      return;
    }
    if (currentZone === -1) {
      el.innerHTML = '<div class="zone-result zone-result--no"><strong>Todavía no llegamos a tu zona.</strong> Te esperamos en el local (Fragueiro y Quevedo), o pedinos por PedidosYa o Mercado Libre.</div>';
      return;
    }
    var z = ZONES[currentZone.i];
    var line = (currentZone.addr || currentZone.b) + ': envío ' + fmt(z.cost) + ' · ' + z.time;
    el.innerHTML =
      '<div class="zone-result zone-result--yes">' +
      '<span class="ok"><span class="ok-dot"></span>Sí, llegamos</span>' +
      '<span>' + escapeHtml(line) + '</span>' +
      '<a href="/carta">Armá tu pedido</a>' +
      '</div>';
  }

  function checkZone(e) {
    if (e) e.preventDefault();
    var q = document.getElementById('barrio-input').value;
    document.getElementById('zone-result').innerHTML = '<p class="zone-result">Buscando tu dirección…</p>';
    resolveZone(q).then(function (result) {
      currentZone = result;
      renderZonesList();
      renderZoneResult();
    });
  }

  /* ===================== event form ===================== */
  /* Frase de cada tipo de evento para el mensaje de WhatsApp (en vez de
     anteponer "un" a ciegas: "un juntada" queda mal, es "una juntada"). */
  var EVENT_TIPO_FRASE = {
    'Cumpleaños': 'un cumpleaños',
    'Juntada': 'una juntada',
    'After office': 'un after office',
    'Evento de empresa': 'un evento de empresa',
    'Otro': 'un evento'
  };

  /* ¿Ese día de la semana está cerrado según los horarios del panel? */
  function isWeekdayClosed(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var monIdx = (d.getDay() + 6) % 7; // 0=Lunes, igual que ADMIN.hours
    var days = (ADMIN.hours && ADMIN.hours.length === 7) ? ADMIN.hours : HOURS_DEFAULT_RAW;
    var day = days[monIdx];
    return !!(day && day.open === false);
  }

  function initEventForm() {
    var form = document.getElementById('event-form');
    var fechaInput = document.getElementById('ev-fecha');
    if (fechaInput) {
      var today = new Date();
      fechaInput.min = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nombre = document.getElementById('ev-nombre').value.trim();
      var fecha = document.getElementById('ev-fecha').value;
      var personas = document.getElementById('ev-personas').value;
      var tipo = document.getElementById('ev-tipo').value;
      var capacidad = ADMIN.capacidad || 40;
      var errNombre = !nombre;
      var fechaPasada = !!fecha && fecha < fechaInput.min;
      var fechaCerrada = !!fecha && !fechaPasada && isWeekdayClosed(fecha);
      var errFecha = !fecha || !(+personas > 0) || fechaPasada || fechaCerrada;
      var errCapacidad = !errFecha && +personas > capacidad;
      document.getElementById('err-nombre').hidden = !errNombre;
      var errFechaEl = document.getElementById('err-fecha');
      errFechaEl.textContent = fechaPasada ? 'Elegí una fecha a partir de hoy.'
        : fechaCerrada ? 'Ese día el local está cerrado, elegí otra fecha.'
        : 'Completá la fecha y la cantidad de personas.';
      errFechaEl.hidden = !errFecha;
      var errCapEl = document.getElementById('err-capacidad');
      errCapEl.textContent = 'El local entra hasta ' + capacidad + ' personas. Para un grupo más grande, escribinos directo por WhatsApp.';
      errCapEl.hidden = !errCapacidad;
      if (errNombre || errFecha || errCapacidad) return;
      var f = fecha.split('-').reverse().join('/');
      var frase = EVENT_TIPO_FRASE[tipo] || ('un ' + tipo.toLowerCase());
      var msg = 'Hola Fufa! Soy ' + nombre + '. Quiero alquilar el local para ' + frase + ' el ' + f + ', somos ' + personas + '. ¿Tienen la fecha libre?';
      window.open(waText(msg), '_blank', 'noopener');
    });
  }

  /* ===================== reveal on scroll ===================== */
  var io = null;
  function initObserver() {
    if (!('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        /* Animación corta: menos "blanco" mientras se scrollea en el celular. */
        var el = entry.target, d = Math.min(+el.getAttribute('data-reveal') || 0, 120);
        el.style.transition = 'opacity 220ms ease ' + d + 'ms, transform 220ms ease ' + d + 'ms';
        el.style.opacity = '1'; el.style.transform = 'none';
        io.unobserve(el);
      });
    }, { threshold: 0.03 });
  }

  function reveal() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('[data-reveal]:not([data-rv])').forEach(function (el) {
      el.setAttribute('data-rv', '1');
      if (el.getBoundingClientRect().top < window.innerHeight * 0.95) return;
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      if (io) io.observe(el);
    });
  }

  /* ===================== mobile menu ===================== */
  function openMenu() {
    document.getElementById('mobile-menu').hidden = false;
  }
  function closeMenu() {
    document.getElementById('mobile-menu').hidden = true;
  }
  document.addEventListener('click', function (e) {
    var menu = document.getElementById('mobile-menu');
    if (menu.hidden) return;
    if (menu.contains(e.target) || e.target.closest('#menu-open-btn')) return;
    closeMenu();
  });

  /* ===================== router ===================== */
  var currentPage = 'home';

  function showPage(page) {
    currentPage = page;
    ['home', 'carta', 'delivery', 'legal'].forEach(function (p) {
      document.getElementById('view-' + p).hidden = p !== page;
    });
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === page);
    });
    hideAddedToast();
    setTimeout(reveal, 60);
  }

  /* ===================== ruteo con URLs reales (SEO) =====================
     Antes cada sección vivía detrás de un "#/..." y para Google (y para
     compartir un link) todo el sitio era una sola página con un solo
     título. Ahora cada sección tiene su propia URL real (/carta, /delivery,
     /legal) manejada con la History API, con su propio <title> y
     descripción, y Vercel sirve index.html para cualquiera de esas rutas
     (ver vercel.json) así una recarga o un link compartido funcionan igual. */
  var PAGE_META = {
    home: { title: 'Fufa Food — Donde el hambre se rinde.', desc: 'Hamburguesas, lomitos, pizzas y empanadas en Alta Córdoba. Comé en el local, pedí delivery o alquilá el espacio para tu evento.' },
    carta: { title: 'Carta — Fufa Food', desc: 'Toda la carta de Fufa Food: hamburguesas, lomitos, pizzas, empanadas, frituras, bebidas y helados. Pedí por WhatsApp con delivery o retiro en Alta Córdoba.' },
    delivery: { title: 'Delivery — Fufa Food', desc: 'Fijate si llegamos a tu barrio y cuánto cuesta el envío. Delivery de Fufa Food en Alta Córdoba y alrededores.' },
    legal: { title: 'Términos y cookies — Fufa Food', desc: 'Términos y condiciones y política de cookies de Fufa Food.' }
  };

  function applyPageMeta(page) {
    var meta = PAGE_META[page] || PAGE_META.home;
    document.title = meta.title;
    var descEl = document.querySelector('meta[name="description"]');
    if (descEl) descEl.setAttribute('content', meta.desc);
    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      var path = page === 'home' ? '/' : '/' + page;
      canonical.setAttribute('href', location.origin + path);
    }
  }

  function parseLocation() {
    var seg = location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    var sub = (location.hash || '').replace(/^#/, '') || null;
    var page = seg === 'carta' ? 'carta' : seg === 'delivery' ? 'delivery' : seg === 'legal' ? 'legal' : 'home';
    return { seg: seg, sub: sub, page: page };
  }

  /* Si entraron directo por /local o /eventos, el scroll inicial (60ms)
     puede quedar mal una vez que terminan de llegar el catálogo y los
     datos del panel (cambian la altura de todo lo de arriba, hero
     incluido). Guardamos el deep-link y lo reintentamos cuando esos
     datos lleguen, ver initDeepLinkRescroll(). */
  var deepLinkSectionId = null;

  function scrollToSection(id, first) {
    var el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navPx(), behavior: first ? 'auto' : 'smooth' });
  }

  function route(first) {
    var loc = parseLocation();
    showPage(loc.page);
    applyPageMeta(loc.page);
    closeMenu();
    deepLinkSectionId = (first && (loc.seg === 'local' || loc.seg === 'eventos')) ? loc.seg : null;
    setTimeout(function () {
      if (loc.page === 'legal' && loc.sub) {
        var elL = document.getElementById(loc.sub);
        if (elL) window.scrollTo({ top: elL.getBoundingClientRect().top + window.scrollY - navPx(), behavior: first ? 'auto' : 'smooth' });
      } else if (loc.seg === 'local' || loc.seg === 'eventos') {
        scrollToSection(loc.seg, first);
      } else if (loc.page === 'carta' && pendingCat) {
        var id = pendingCat; pendingCat = null;
        activeCat = id; updateChipActive();
        var el2 = document.getElementById('cat-' + id);
        if (el2) window.scrollTo({ top: el2.getBoundingClientRect().top + window.scrollY - navPx() - 56, behavior: 'auto' });
      } else if (!first) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    }, 60);
  }

  /* Navega a una ruta real sin recargar la página (History API). */
  function navigate(path) {
    if (location.pathname + location.hash !== path) {
      history.pushState(null, '', path);
    }
    route(false);
  }

  /* Intercepta los links internos (href que empieza con "/") para que la
     navegación sea instantánea en vez de recargar todo el sitio; un click
     con ctrl/cmd/shift o del medio sigue abriendo en pestaña nueva como
     cualquier link normal. */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href^="/"]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });

  window.addEventListener('popstate', function () { route(false); });

  /* Compatibilidad con links viejos tipo "/#/carta" (de antes de pasar a
     URLs reales) que alguien pueda tener guardados o compartidos. */
  function redirectLegacyHash() {
    var h = location.hash;
    if (!h || h.charAt(1) !== '/') return;
    var rest = h.slice(2); // saca "#/"
    var sub = null;
    if (rest.indexOf('#') !== -1) { var parts = rest.split('#'); rest = parts[0]; sub = parts[1]; }
    var path = '/' + rest + (sub ? '#' + sub : '');
    history.replaceState(null, '', path || '/');
  }

  /* ===================== aplicar el panel del local a la web (en vivo) =====================
     Cada una de estas funciones es idempotente: se puede llamar las veces que
     haga falta (al cargar, y de nuevo cada vez que el panel cambia algo en
     OTRA pestaña) y siempre deja la web al día con el estado actual del panel,
     revirtiendo lo que ya no aplica (ej. si vuelven a prender el delivery). */

  function applyWaLinks() {
    ['wa-float', 'wa-link-local', 'wa-link-footer', 'legal-wa-link'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.href = waDefault;
    });
    var telLink = document.getElementById('tel-link-footer');
    if (telLink) telLink.href = 'tel:+' + WA;
    /* Por si queda algún link viejo apuntando a Pedix dando vueltas. */
    document.querySelectorAll('a[href="https://pedix.app/fufafood"]').forEach(function (a) { a.href = waOrder; });
  }

  function applyServicesVisibility() {
    var services = ADMIN.services || {};
    var localSec = document.getElementById('local');
    if (localSec) localSec.hidden = (services.local === false);
    var eventosSec = document.getElementById('eventos');
    if (eventosSec) eventosSec.hidden = (services.eventos === false);
    var retiroRow = document.getElementById('cond-retiro-row');
    if (retiroRow) retiroRow.hidden = (services.retiro === false);

    var zf = document.getElementById('zone-form');
    var zl = document.getElementById('zones-list');
    var zr = document.getElementById('zone-result');
    if (services.delivery === false) {
      if (zf) zf.hidden = true;
      if (zl) zl.innerHTML = '<p class="zone-result zone-result--no">Hoy no estamos haciendo envíos. Podés retirar tu pedido en el local.</p>';
      if (zr) zr.innerHTML = '';
    } else {
      if (zf) zf.hidden = false;
      renderBarriosDatalist();
      renderZonesList();
      renderZoneResult();
    }
  }

  function applyReceivingState() {
    var off = ADMIN.receiving === false;
    var notice = document.getElementById('receiving-notice');
    if (notice) notice.hidden = !off;
    document.querySelectorAll('.btn-pedi-header, .cart-icon-btn').forEach(function (btn) {
      if (btn.dataset.origHtml === undefined) btn.dataset.origHtml = btn.innerHTML;
      if (off) {
        btn.innerHTML = 'No disponible';
        btn.style.opacity = '.5';
        btn.style.pointerEvents = 'none';
      } else {
        btn.innerHTML = btn.dataset.origHtml;
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
      }
    });
    updateCartBadges();
  }

  function applySectionPhotos() {
    var photos = ADMIN.photos || {};
    [['photo-local', photos.local, 'el salón de noche'],
     ['photo-delivery', photos.delivery, 'pedido listo para salir'],
     ['photo-eventos', photos.eventos, 'un cumple en el local']].forEach(function (t) {
      var el = document.getElementById(t[0]);
      if (!el) return;
      var ratio = el.getAttribute('data-photo-ratio') || '4/3';
      el.innerHTML = t[1] ? productImg(t[1], t[2], ratio, t[2]) : fotoFufa(t[2], ratio);
    });
    var hero = document.getElementById('hero-section');
    if (hero) {
      if (photos.hero) {
        hero.classList.add('hero-tipo--photo');
        hero.style.setProperty('--hero-bg-desktop', 'url("' + photos.hero + '")');
        hero.style.setProperty('--hero-bg-mobile', 'url("' + (photos.heroMobile || photos.hero) + '")');
      } else {
        hero.classList.remove('hero-tipo--photo');
        hero.style.removeProperty('--hero-bg-desktop');
        hero.style.removeProperty('--hero-bg-mobile');
      }
    }
  }

  var RAW_CARTA_DATA = null;
  function refreshCarta() {
    if (!RAW_CARTA_DATA) return;
    CARTA_DATA = applyAdminOverrides(RAW_CARTA_DATA);
    renderHomeCatGrid();
    renderHomeTop();
    renderCartaChips();
    renderCartaCategories();
    applyCartaSearch();
    renderHeroPromo();
  }

  /* Buscador de la carta: filtra los productos ya renderizados por nombre,
     sin golpear el servidor ni perder el estado del stepper de cada fila. */
  function applyCartaSearch() {
    var input = document.getElementById('carta-search');
    if (!input) return;
    var raw = input.value.trim();
    var q = norm(raw);
    var anyVisible = false;
    document.querySelectorAll('#carta-categories .cat-section').forEach(function (sec) {
      var secVisible = false;
      sec.querySelectorAll('.cat-group').forEach(function (grp) {
        var grpVisible = false;
        grp.querySelectorAll('.cat-items > li').forEach(function (li) {
          var hay = li.getAttribute('data-search') || '';
          var match = !q || hay.indexOf(q) !== -1;
          li.hidden = !match;
          if (match) grpVisible = true;
        });
        grp.hidden = !grpVisible;
        if (grpVisible) secVisible = true;
      });
      sec.hidden = !secVisible;
      if (secVisible) anyVisible = true;
    });
    var empty = document.getElementById('carta-search-empty');
    if (empty) {
      if (q && !anyVisible) {
        empty.hidden = false;
        empty.innerHTML = 'No encontramos "' + escapeHtml(raw) + '". <button type="button" class="carta-search-empty__btn" data-clear-carta-search>Ver toda la carta</button>';
      } else {
        empty.hidden = true;
      }
    }
    /* Con una búsqueda activa el chip de categoría que había quedado
       marcado por el scroll ya no tiene sentido (esa sección puede estar
       oculta); se lo saca mientras haya texto en el buscador. */
    document.querySelectorAll('#carta-chip-list .chip').forEach(function (btn) {
      if (q) btn.classList.remove('is-active');
    });
    if (!q) updateChipActive();
  }

  function initCartaSearch() {
    var input = document.getElementById('carta-search');
    if (input) input.addEventListener('input', applyCartaSearch);
    var empty = document.getElementById('carta-search-empty');
    if (empty) empty.addEventListener('click', function (e) {
      if (!e.target.closest('[data-clear-carta-search]')) return;
      if (input) { input.value = ''; input.focus(); }
      applyCartaSearch();
    });
  }

  function applyEventosCapacidad() {
    var el = document.getElementById('eventos-capacidad-text');
    if (el) el.textContent = ADMIN.capacidad || 40;
  }

  function applyAdminEffects() {
    applyWaLinks();
    applyServicesVisibility();
    applyReceivingState();
    renderStatus();
    applyHoursText();
    applySectionPhotos();
    applyEventosCapacidad();
    refreshCarta();
  }

  /* El panel (admin.html) escribe en la tabla app_settings de Supabase.
     Esta función se llama al cargar la página y de nuevo cada vez que
     llega un cambio en vivo por la suscripción realtime de abajo, así
     que un cliente que ya tiene la web abierta ve los cambios sin
     recargar — sea que el panel se haya usado desde este mismo
     navegador o desde cualquier otro dispositivo. */
  function refreshAdmin(data) {
    ADMIN = (data && typeof data === 'object') ? data : {};
    recomputeWa();
    recomputeZones();
    recomputeHours();
    applyAdminEffects();
  }

  /* Cache en localStorage de la última versión conocida de ADMIN (incluye
     las fotos en base64). Así, en visitas siguientes, el hero y el resto
     de la web se pintan al instante con lo último guardado mientras de
     fondo se pide la versión fresca a Supabase — evita el hueco en negro
     que se veía mientras viajaba el pedido de red. */
  var ADMIN_CACHE_KEY = 'fufaAdminCache';
  function loadAdminFromCache() {
    try {
      var raw = window.localStorage.getItem(ADMIN_CACHE_KEY);
      if (!raw) return;
      refreshAdmin(JSON.parse(raw));
    } catch (e) { /* localStorage puede no estar disponible o el JSON es viejo; no pasa nada */ }
  }
  function saveAdminToCache(data) {
    try { window.localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(data || {})); }
    catch (e) { /* cuota llena u otro error de localStorage: seguimos sin cache */ }
  }

  /* Si este pedido falla (hipo de red, etc) reintenta solo: sin esto, un
     fallo puntual dejaba la web mostrando para siempre lo último que
     había en el cache local del navegador, sin forma de enterarse de
     cambios hechos desde el panel. */
  function loadAdminFromDb() {
    if (!db) return;
    db.from('app_settings').select('data').eq('id', 'main').maybeSingle().then(function (res) {
      if (res.error) { if (window.console) console.error(res.error); setTimeout(loadAdminFromDb, 4000); return; }
      var fresh = res.data && res.data.data;
      refreshAdmin(fresh);
      saveAdminToCache(fresh);
      if (deepLinkSectionId) setTimeout(function () { scrollToSection(deepLinkSectionId, true); }, 60);
    }).catch(function (err) {
      if (window.console) console.error(err);
      setTimeout(loadAdminFromDb, 4000);
    });
  }

  function subscribeAdmin() {
    if (!db) return;
    db.channel('settings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'id=eq.main' }, function (payload) {
        var fresh = payload.new && payload.new.data;
        refreshAdmin(fresh);
        saveAdminToCache(fresh);
      })
      .subscribe();
  }

  /* Delegado (no querySelectorAll+listener directo) porque el botón "Ver
     pedido" del toast de "agregado al pedido" se crea dinámicamente,
     después de que ya corrió el wiring inicial. */
  document.addEventListener('click', function (e) {
    var openBtn = e.target.closest('[data-open-cart]');
    if (openBtn) { e.preventDefault(); hideAddedToast(); openCart(); }
  });

  /* ===================== init ===================== */
  document.addEventListener('DOMContentLoaded', function () {
    var modalRoot = document.getElementById('product-modal-root');
    var drawerRoot = document.getElementById('cart-drawer-root');
    if (modalRoot) modalRoot.hidden = true;
    if (drawerRoot) drawerRoot.hidden = true;

    renderStaticPhotos();
    applyAdminEffects();
    loadAdminFromCache();
    loadAdminFromDb();
    subscribeAdmin();
    setInterval(renderStatus, 60000);

    fetch('./data-carta.json').then(function (r) { return r.json(); }).then(function (data) {
      RAW_CARTA_DATA = data;
      refreshCarta();
      if (currentPage === 'carta' && pendingCat) {
        var id = pendingCat; pendingCat = null;
        activeCat = id; updateChipActive();
        var el3 = document.getElementById('cat-' + id);
        if (el3) window.scrollTo({ top: el3.getBoundingClientRect().top + window.scrollY - navPx() - 56, behavior: 'auto' });
      }
      if (deepLinkSectionId) setTimeout(function () { scrollToSection(deepLinkSectionId, true); }, 60);
      setTimeout(reveal, 60);
    }).catch(function (err) {
      var msg = '<p class="carta-loading">No pudimos cargar la carta. Probá recargar la página.</p>';
      ['home-cat-grid', 'home-top-grid', 'carta-chip-list', 'carta-categories'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = msg;
      });
      if (window.console) console.error('No se pudo cargar data-carta.json', err);
    });

    initObserver();
    initEventForm();

    initCartaSearch();

    document.getElementById('menu-open-btn').addEventListener('click', openMenu);
    document.getElementById('menu-close-btn').addEventListener('click', closeMenu);
    document.getElementById('zone-form').addEventListener('submit', checkZone);
    document.getElementById('barrio-input').addEventListener('change', function () { currentZone = null; renderZoneResult(); });

    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', function () {
      if (isDesk()) closeMenu();
      layoutBottomBars();
    });

    redirectLegacyHash();
    route(true);
    setTimeout(reveal, 300);

    if (!cookiePrefs) setTimeout(showCookieBanner, 500);
  });
})();
