(function () {
  'use strict';

  /* ============================================================
     Panel del local — Fufa Food (admin.js)

     AVISO DE SEGURIDAD: este panel no tiene login. Cualquiera que
     conozca la URL /administracion puede editar todo (precios, zonas,
     pedidos, etc). La base de datos (Supabase) tiene las reglas
     configuradas para permitir esto sin login — ver supabase/schema.sql.

     Persistencia: todo lo editable se guarda en la tabla app_settings
     de Supabase (debounce ~400ms, ver save()). script.js (sitio
     público) lee la MISMA fila en vivo y aplica estos datos como
     overrides sobre el catálogo real de data-carta.json. Los pedidos
     (kanban) se leen y escriben de la tabla orders, también en vivo.
     ============================================================ */

  var db = window.fufaDb; // ver supabase-client.js

  /* ===================== helpers ===================== */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return '$' + (Number(n) || 0).toLocaleString('es-AR'); }
  function fmtKm(n) { return String(n).replace('.', ','); }
  function uid() { return 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function byId(id) { return document.getElementById(id); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  /* ===================== estado por defecto ===================== */
  var DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  function defaultZones() {
    return [
      { name: 'Zona 1', cost: 1500, time: '25–35 min', radius: 1.5, barrios: ['Alta Córdoba', 'Cofico', 'General Bustos', 'Providencia'], on: true },
      { name: 'Zona 2', cost: 2500, time: '35–45 min', radius: 3, barrios: ['Pueyrredón', 'General Paz', 'Las Margaritas', 'Villa Cabrera', 'Centro'], on: true },
      { name: 'Zona 3', cost: 3500, time: '45–55 min', radius: 4.5, barrios: ['Juniors', 'San Martín', 'Alberdi', 'Marqués de Sobremonte'], on: true }
    ];
  }
  function defaultHours() {
    // índice 0=Lunes .. 6=Domingo (coincide con (d.getDay()+6)%7)
    return [
      { open: false, from: '20:00', to: '00:00' }, // Lunes: cerrado
      { open: true, from: '20:00', to: '00:00' },  // Martes
      { open: true, from: '20:00', to: '00:00' },  // Miércoles
      { open: true, from: '20:00', to: '00:00' },  // Jueves
      { open: true, from: '20:00', to: '00:30' },  // Viernes
      { open: true, from: '20:00', to: '00:30' },  // Sábado
      { open: true, from: '20:00', to: '00:00' }   // Domingo
    ];
  }
  function defaultState() {
    return {
      productOverrides: {},
      catOn: {},
      customProducts: {},
      topPicks: null,
      zones: defaultZones(),
      hours: defaultHours(),
      estado: 'auto',
      services: { local: true, delivery: true, retiro: true, eventos: true },
      photos: {},
      capacidad: 40,
      whatsapp: '',
      receiving: true
    };
  }

  function mergeState(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    var out = base;
    for (var k in saved) {
      if (saved[k] == null) continue;
      if (k === 'services') {
        out[k] = Object.assign({}, base[k], saved[k]);
      } else {
        out[k] = saved[k];
      }
    }
    return out;
  }

  // Arranca con los valores por defecto; loadStateFromDb() los pisa una vez
  // que hay sesión y llegó la fila real desde Supabase.
  var state = defaultState();

  function loadStateFromDb() {
    return db.from('app_settings').select('data').eq('id', 'main').maybeSingle().then(function (res) {
      if (res.error) { if (window.console) console.error(res.error); return; }
      state = mergeState(defaultState(), res.data && res.data.data);
    });
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    var el1 = byId('saved-text');
    if (el1) el1.textContent = 'Guardando…';
    saveTimer = setTimeout(function () {
      db.from('app_settings').upsert({ id: 'main', data: state, updated_at: new Date().toISOString() }).then(function (res) {
        var d = new Date();
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        if (el1) el1.textContent = res.error ? 'No se pudo guardar — revisá tu conexión' : ('Guardado ' + hh + ':' + mm);
      });
    }, 400);
  }

  /* ===================== catálogo real ===================== */
  var CARTA_DATA = null; // array de categorías tal cual viene de data-carta.json, SIN overrides

  function catBySlug(slug) {
    return (CARTA_DATA || []).filter(function (c) { return c.slug === slug; })[0] || null;
  }
  function allActiveProducts(catSlug) {
    var c = catBySlug(catSlug);
    if (!c) return [];
    var list = c.products.slice();
    var customs = state.customProducts[catSlug] || [];
    return list.concat(customs);
  }
  function overrideFor(id) { return state.productOverrides[id] || {}; }
  function setOverride(id, patch) {
    var cur = state.productOverrides[id] ? Object.assign({}, state.productOverrides[id]) : {};
    Object.assign(cur, patch);
    state.productOverrides[id] = cur;
    save();
  }
  function effectivePrice(p) {
    var ov = overrideFor(p.id);
    return typeof ov.price === 'number' ? ov.price : p.price;
  }
  function effectiveName(p) {
    var ov = overrideFor(p.id);
    return ov.name || p.name;
  }
  function effectiveDesc(p) {
    var ov = overrideFor(p.id);
    return typeof ov.desc === 'string' ? ov.desc : (p.desc || '');
  }
  function photosFor(id) {
    var ov = overrideFor(id);
    if (ov.photos && ov.photos.length) return ov.photos.slice();
    if (ov.photo) return [ov.photo];
    return [];
  }
  function setPhotos(id, photos) {
    setOverride(id, { photos: photos, photo: null });
  }
  function effectiveThumb(p) {
    var photos = photosFor(p.id);
    return photos.length ? photos[0] : p.thumb;
  }
  function findProductAnywhere(id) {
    var found = null;
    (CARTA_DATA || []).forEach(function (c) {
      c.products.forEach(function (p) { if (p.id === id) found = p; });
      (state.customProducts[c.slug] || []).forEach(function (p) { if (p.id === id) found = p; });
    });
    return found;
  }
  function isOn(p) {
    var ov = overrideFor(p.id);
    return ov.on !== false;
  }
  function isPromo(p) {
    return !!overrideFor(p.id).promo;
  }
  function isDeleted(p) {
    return !!overrideFor(p.id).deleted;
  }

  /* ===================== navegación entre secciones ===================== */
  var SECTIONS = ['pedidos', 'carta', 'delivery', 'fotos', 'servicios'];
  var currentSection = 'pedidos';

  function showSection(sec) {
    currentSection = sec;
    SECTIONS.forEach(function (s) {
      var el = byId('sec-' + s);
      if (el) el.hidden = (s !== sec);
    });
    document.querySelectorAll('[data-section]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-section') === sec);
    });
    if (sec === 'delivery') setTimeout(ensureMap, 30);
  }

  function initNav() {
    document.querySelectorAll('[data-section]').forEach(function (btn) {
      btn.addEventListener('click', function () { showSection(btn.getAttribute('data-section')); });
    });
  }

  /* ===================== estado abierto/cerrado (igual criterio que script.js) ===================== */
  function computeStatus() {
    if (state.estado === 'abierto') return { open: true, text: 'Abierto hasta las 00:00' };
    if (state.estado === 'cerrado') return { open: false, text: 'Cerrado' };
    var d = new Date();
    var adminIdx = (d.getDay() + 6) % 7; // 0=Lunes..6=Domingo
    var day = state.hours[adminIdx];
    var h = d.getHours();
    if (day && day.open) {
      var from = parseInt(day.from, 10);
      var to = parseInt(day.to, 10);
      if (to === 0) to = 24;
      if (h >= from && h < to) return { open: true, text: 'Abierto hasta las ' + day.to + ' h' };
    }
    return { open: false, text: 'Cerrado' };
  }

  function renderStatusIndicators() {
    var st = computeStatus();
    var color = st.open ? '#2DB84C' : '#E63B2E';
    ['side-status-dot', 'm-status-dot'].forEach(function (id) {
      var el = byId(id); if (el) el.style.background = color;
    });
    var side = byId('side-status-text'); if (side) side.textContent = st.open ? 'Abierto' : 'Cerrado';
    var m = byId('m-status-text'); if (m) m.textContent = st.open ? 'Abierto' : 'Cerrado';
    var prev = byId('estado-preview');
    if (prev) prev.textContent = 'En la web se ve: ' + (st.open ? ('punto verde, "' + st.text + '"') : 'punto rojo, "Cerrado"');
  }

  /* ============================================================
     PEDIDOS — tabla "orders" en Supabase. Los clientes insertan desde
     la web (script.js) al confirmar el pedido; acá se leen y se les
     cambia el estado en vivo.
     ============================================================ */
  var orders = [];
  var kanbanTab = 'nuevos';
  var COLUMNS = [
    { key: 'nuevos', label: 'Nuevos' },
    { key: 'cocina', label: 'En cocina' },
    { key: 'listos', label: 'Listos' },
    { key: 'camino', label: 'En camino' }
  ];
  var NEXT_STATE = { nuevos: 'cocina', cocina: 'listos', listos: 'camino', camino: 'entregado' };
  var NEXT_LABEL = { nuevos: 'Aceptar', cocina: 'Marcar listo', listos: 'Salió', camino: 'Entregado' };

  function mapOrderRow(row) {
    return {
      id: row.id,
      dailySeq: row.daily_seq,
      name: row.customer_name,
      phone: row.phone || '',
      tipo: row.tipo,
      addr: row.address || '',
      items: Array.isArray(row.items) ? row.items : [],
      pay: row.payment || '',
      total: Number(row.total) || 0,
      status: row.status,
      createdAt: row.created_at
    };
  }
  function ageMin(o) {
    var ms = Date.now() - new Date(o.createdAt).getTime();
    return Math.max(0, Math.round(ms / 60000));
  }

  function loadOrdersFromDb() {
    return db.from('orders').select('*').neq('status', 'entregado').order('created_at', { ascending: false }).then(function (res) {
      if (res.error) { if (window.console) console.error(res.error); return; }
      orders = (res.data || []).map(mapOrderRow);
    });
  }

  function subscribeOrders() {
    db.channel('orders-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, function (payload) {
        orders.unshift(mapOrderRow(payload.new));
        renderKanban(); renderPedidosResumen(); renderBadges();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, function (payload) {
        var updated = mapOrderRow(payload.new);
        if (updated.status === 'entregado') {
          orders = orders.filter(function (o) { return o.id !== updated.id; });
        } else {
          var i = orders.findIndex(function (o) { return o.id === updated.id; });
          if (i >= 0) orders[i] = updated; else orders.unshift(updated);
        }
        renderKanban(); renderPedidosResumen(); renderBadges();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, function (payload) {
        orders = orders.filter(function (o) { return o.id !== payload.old.id; });
        renderKanban(); renderPedidosResumen(); renderBadges();
      })
      .subscribe();
  }

  function tagHtml(tipo) {
    if (tipo === 'delivery') return '<span class="adm-tag adm-tag--delivery">Delivery</span>';
    if (tipo === 'retiro') return '<span class="adm-tag adm-tag--retiro">Retiro</span>';
    return '<span class="adm-tag adm-tag--local">En el local</span>';
  }

  function renderKanbanTabs() {
    var el = byId('kanban-tabs');
    if (!el) return;
    el.innerHTML = COLUMNS.map(function (c) {
      var n = orders.filter(function (o) { return o.status === c.key; }).length;
      return '<button type="button" data-tab="' + c.key + '" class="' + (kanbanTab === c.key ? 'is-active' : '') + '">' + c.label + ' (' + n + ')</button>';
    }).join('');
    el.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { kanbanTab = btn.getAttribute('data-tab'); renderKanban(); });
    });
  }

  function orderCardHtml(o) {
    var mins = ageMin(o);
    var late = (o.status === 'nuevos' && mins >= 5) || (o.status === 'cocina' && mins >= 20);
    var visibleItems = o.items.slice(0, 2);
    var items = visibleItems.map(function (it) { return '<li>' + escapeHtml(it) + '</li>'; }).join('');
    if (o.items.length > 2) items += '<li>+' + (o.items.length - 2) + ' más</li>';
    var btns = '';
    if (o.status !== 'entregado') {
      btns += '<button type="button" class="adm-btn adm-btn--yellow adm-btn--sm" data-advance="' + o.id + '">' + NEXT_LABEL[o.status] + '</button>';
    }
    if (o.status === 'nuevos') {
      btns += '<button type="button" class="adm-btn adm-btn--danger adm-btn--sm" data-reject="' + o.id + '">Rechazar</button>';
    }
    return (
      '<article class="adm-card">' +
      '<div class="adm-card__top"><span>#' + (o.dailySeq != null ? o.dailySeq : o.id) + '</span><span class="adm-card__age' + (late ? ' is-late' : '') + '">' + mins + ' min</span></div>' +
      '<div class="adm-card__name">' + escapeHtml(o.name) + '</div>' +
      tagHtml(o.tipo) +
      (o.addr ? '<div class="adm-card__addr">' + escapeHtml(o.addr) + '</div>' : '') +
      '<ul class="adm-card__items">' + items + '</ul>' +
      '<div class="adm-card__pay">' + escapeHtml(o.pay) + '</div>' +
      '<div class="adm-card__total">' + fmt(o.total) + '</div>' +
      '<div class="adm-card__links">' +
      '<button type="button" class="adm-card__view" data-view="' + o.id + '">Ver pedido</button>' +
      '<button type="button" class="adm-card__view" data-print="' + o.id + '">Imprimir</button>' +
      '</div>' +
      '<div class="adm-card__actions">' + btns + '</div>' +
      '</article>'
    );
  }

  /* ----- modal de detalle del pedido ----- */
  function orderDetailHtml(o) {
    var items = o.items.map(function (it) { return '<li>' + escapeHtml(it) + '</li>'; }).join('');
    return (
      '<div class="adm-modal-overlay" id="adm-order-modal-overlay">' +
      '<div class="adm-modal-box" role="dialog" aria-modal="true" aria-label="Pedido #' + (o.dailySeq != null ? o.dailySeq : o.id) + '">' +
      '<button type="button" class="adm-modal-close" data-role="order-modal-close">Cerrar</button>' +
      '<h3 class="adm-modal-title">Pedido #' + (o.dailySeq != null ? o.dailySeq : o.id) + '</h3>' +
      '<p class="adm-hint">' + tagHtml(o.tipo) + ' · ' + ageMin(o) + ' min</p>' +
      '<p><strong>' + escapeHtml(o.name) + '</strong></p>' +
      (o.addr ? '<p>' + escapeHtml(o.addr) + '</p>' : '') +
      '<ul class="adm-order-detail-items">' + items + '</ul>' +
      '<p>' + escapeHtml(o.pay) + '</p>' +
      '<p style="font-size:20px;font-weight:700">' + fmt(o.total) + '</p>' +
      '<button type="button" class="adm-btn adm-btn--outline" data-role="print-order">Imprimir comanda</button>' +
      '</div></div>'
    );
  }
  function openOrderDetail(id) {
    var o = orders.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    var root = byId('order-modal-root');
    if (!root) return;
    root.innerHTML = orderDetailHtml(o);
    var closeBtn = root.querySelector('[data-role="order-modal-close"]');
    if (closeBtn) closeBtn.addEventListener('click', closeOrderDetail);
    var printBtn = root.querySelector('[data-role="print-order"]');
    if (printBtn) printBtn.addEventListener('click', function () { printOrder(o); });
    var overlay = byId('adm-order-modal-overlay');
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeOrderDetail(); });
  }

  /* ----- comanda impresa -----
     Se arma en #print-ticket-root (fuera de la vista normal) y se imprime con
     window.print(); el CSS (@media print) oculta todo lo demás de la pagina,
     asi en la impresora sale solo el ticket. Pensado para impresoras termicas
     chicas de cocina/mostrador, de ahi el ancho angosto y la tipografia simple. */
  function printOrder(o) {
    var root = byId('print-ticket-root');
    if (!root) return;
    var items = o.items.map(function (it) { return '<li>' + escapeHtml(it) + '</li>'; }).join('');
    var fecha = o.createdAt ? new Date(o.createdAt).toLocaleString('es-AR') : '';
    root.innerHTML =
      '<div class="print-ticket">' +
      '<h1>FUFA FOOD</h1>' +
      '<p class="print-ticket__num">#' + (o.dailySeq != null ? o.dailySeq : o.id) + '</p>' +
      '<p>' + fecha + '</p>' +
      '<hr>' +
      '<p><strong>' + escapeHtml(o.name) + '</strong>' + (o.phone ? ' · ' + escapeHtml(o.phone) : '') + '</p>' +
      '<p>' + escapeHtml(o.tipo === 'delivery' ? 'Delivery' : (o.tipo === 'retiro' ? 'Retiro en el local' : 'Mesa')) + '</p>' +
      (o.addr ? '<p>' + escapeHtml(o.addr) + '</p>' : '') +
      '<hr>' +
      '<ul>' + items + '</ul>' +
      '<hr>' +
      '<p>Pago: ' + escapeHtml(o.pay) + '</p>' +
      '<p class="print-ticket__total">Total: ' + fmt(o.total) + '</p>' +
      '</div>';
    window.print();
  }
  function closeOrderDetail() {
    var root = byId('order-modal-root');
    if (root) root.innerHTML = '';
  }

  function renderKanban() {
    var board = byId('kanban-board');
    if (!board) return;
    board.innerHTML = COLUMNS.map(function (c) {
      var cards = orders.filter(function (o) { return o.status === c.key; });
      var cls = 'adm-kcol' + (kanbanTab === c.key ? ' is-active' : '');
      return (
        '<div class="' + cls + '" data-col="' + c.key + '">' +
        '<div class="adm-kcol__head"><span>' + c.label + '</span><span>' + cards.length + '</span></div>' +
        cards.map(orderCardHtml).join('') +
        '</div>'
      );
    }).join('');
    board.querySelectorAll('[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { openOrderDetail(+btn.getAttribute('data-view')); });
    });
    board.querySelectorAll('[data-print]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var o = orders.filter(function (x) { return x.id === +btn.getAttribute('data-print'); })[0];
        if (o) printOrder(o);
      });
    });
    board.querySelectorAll('[data-advance]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = +btn.getAttribute('data-advance');
        var o = orders.filter(function (x) { return x.id === id; })[0];
        if (!o) return;
        var next = NEXT_STATE[o.status];
        o.status = next;
        renderKanbanTabs(); renderKanban(); renderPedidosResumen(); renderBadges();
        db.from('orders').update({ status: next }).eq('id', id).then(function (res) {
          if (res.error && window.console) console.error(res.error);
        });
      });
    });
    board.querySelectorAll('[data-reject]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = +btn.getAttribute('data-reject');
        orders = orders.filter(function (x) { return x.id !== id; });
        renderKanbanTabs(); renderKanban(); renderPedidosResumen(); renderBadges();
        db.from('orders').delete().eq('id', id).then(function (res) {
          if (res.error && window.console) console.error(res.error);
        });
      });
    });
    renderKanbanTabs();
  }

  function renderPedidosResumen() {
    var el = byId('pedidos-resumen');
    if (!el) return;
    var enCurso = orders.filter(function (o) { return o.status !== 'entregado'; }).length;
    var entregados = orders.filter(function (o) { return o.status === 'entregado'; });
    var facturado = entregados.reduce(function (s, o) { return s + o.total; }, 0);
    el.textContent = enCurso + ' en curso · ' + entregados.length + ' entregados hoy · ' + fmt(facturado) + ' facturado';
  }

  function renderBadges() {
    var n = orders.filter(function (o) { return o.status === 'nuevos'; }).length;
    [byId('badge-pedidos'), byId('badge-pedidos-m')].forEach(function (el) {
      if (!el) return;
      el.hidden = n === 0;
      el.textContent = String(n);
    });
  }

  function renderPausedBanner() {
    var el = byId('paused-banner');
    if (el) el.hidden = state.receiving !== false;
    var waEl = byId('no-whatsapp-banner');
    if (waEl) waEl.hidden = !!(state.whatsapp && state.whatsapp.trim());
  }

  function initPedidos() {
    loadOrdersFromDb().then(function () {
      renderKanban();
      renderPedidosResumen();
      renderBadges();
    });
    subscribeOrders();
    renderPausedBanner();
    var toggle = byId('receiving-toggle');
    if (toggle) {
      toggle.checked = state.receiving !== false;
      toggle.addEventListener('change', function () {
        state.receiving = toggle.checked;
        save();
        renderPausedBanner();
      });
    }
    // re-pinta cada minuto para que "hace N min" se actualice solo
    setInterval(renderKanban, 60000);
  }

  /* ============================================================
     CARTA Y PRECIOS
     ============================================================ */
  var activeCatSlug = null;
  var lastPriceSnapshot = null; // para "Deshacer" (un solo nivel)

  function catCount(slug) {
    return allActiveProducts(slug).filter(function (p) { return !isDeleted(p); }).length;
  }

  function renderCatTabs() {
    var el = byId('cat-tabs');
    if (!el || !CARTA_DATA) return;
    if (!activeCatSlug) activeCatSlug = CARTA_DATA[0].slug;
    el.innerHTML = CARTA_DATA.map(function (c) {
      return '<button type="button" data-cat="' + c.slug + '" class="' + (activeCatSlug === c.slug ? 'is-active' : '') + '">' + escapeHtml(c.name) + ' (' + catCount(c.slug) + ')</button>';
    }).join('');
    el.querySelectorAll('[data-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeCatSlug = btn.getAttribute('data-cat');
        renderCatTabs();
        renderCatEditor();
      });
    });
  }

  function resizeImageToDataUrl(file, maxSize, cb) {
    var img = new Image();
    var reader = new FileReader();
    reader.onload = function (e) {
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function wireThumbUpload(thumbEl, onPicked) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    thumbEl.appendChild(input);
    thumbEl.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      resizeImageToDataUrl(file, 800, onPicked);
    });
  }

  /* ----- gestor de fotos por producto (modal chico) ----- */
  var photoMgrPid = null;

  function photoMgrItemHtml(url, idx, lastIdx) {
    return (
      '<div class="adm-photo-mgr-item" data-idx="' + idx + '">' +
      '<div class="adm-photo-mgr-item__img"><img src="' + escapeHtml(url) + '" alt=""></div>' +
      (idx === 0 ? '<span class="adm-photo-mgr-badge">Portada</span>' : '') +
      '<div class="adm-photo-mgr-item__actions">' +
      '<button type="button" data-role="move-left" title="Mover a la izquierda"' + (idx === 0 ? ' disabled' : '') + '>←</button>' +
      '<button type="button" data-role="move-right" title="Mover a la derecha"' + (idx === lastIdx ? ' disabled' : '') + '>→</button>' +
      '<button type="button" data-role="remove" title="Sacar foto">×</button>' +
      '</div></div>'
    );
  }

  function renderPhotoManager() {
    var root = byId('photo-modal-root');
    if (!root || !photoMgrPid) return;
    var pid = photoMgrPid;
    var product = findProductAnywhere(pid);
    var photos = photosFor(pid);
    var lastIdx = photos.length - 1;
    var itemsHtml = photos.map(function (url, idx) { return photoMgrItemHtml(url, idx, lastIdx); }).join('');
    root.innerHTML =
      '<div class="adm-modal-overlay" id="adm-photo-modal-overlay">' +
      '<div class="adm-modal-box" role="dialog" aria-modal="true" aria-label="Fotos de ' + escapeHtml(product ? effectiveName(product) : '') + '">' +
      '<button type="button" class="adm-modal-close" data-role="photo-modal-close">Cerrar</button>' +
      '<h3 class="adm-modal-title">Fotos — ' + escapeHtml(product ? effectiveName(product) : '') + '</h3>' +
      '<p class="adm-hint">La primera foto es la portada: es la que se ve en la carta, en "Los más pedidos" y en el carrito.</p>' +
      '<div class="adm-photo-mgr-grid">' + itemsHtml +
      '<button type="button" class="adm-photo-mgr-add" data-role="add-photo">+ Agregar foto</button>' +
      '</div>' +
      '</div></div>';

    root.querySelectorAll('[data-role="move-left"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = +btn.closest('.adm-photo-mgr-item').getAttribute('data-idx');
        if (idx <= 0) return;
        var arr = photosFor(pid);
        var tmp = arr[idx - 1]; arr[idx - 1] = arr[idx]; arr[idx] = tmp;
        setPhotos(pid, arr);
        renderPhotoManager();
        renderCatEditor();
      });
    });
    root.querySelectorAll('[data-role="move-right"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = +btn.closest('.adm-photo-mgr-item').getAttribute('data-idx');
        var arr = photosFor(pid);
        if (idx >= arr.length - 1) return;
        var tmp = arr[idx + 1]; arr[idx + 1] = arr[idx]; arr[idx] = tmp;
        setPhotos(pid, arr);
        renderPhotoManager();
        renderCatEditor();
      });
    });
    root.querySelectorAll('[data-role="remove"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = +btn.closest('.adm-photo-mgr-item').getAttribute('data-idx');
        var arr = photosFor(pid);
        arr.splice(idx, 1);
        setPhotos(pid, arr);
        renderPhotoManager();
        renderCatEditor();
      });
    });
    var addBtn = root.querySelector('[data-role="add-photo"]');
    if (addBtn) {
      var input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
      addBtn.appendChild(input);
      addBtn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        resizeImageToDataUrl(file, 1600, function (dataUrl) {
          var arr = photosFor(pid);
          arr.push(dataUrl);
          setPhotos(pid, arr);
          renderPhotoManager();
          renderCatEditor();
        });
      });
    }
    var closeBtn = root.querySelector('[data-role="photo-modal-close"]');
    if (closeBtn) closeBtn.addEventListener('click', closePhotoManager);
    var overlay = byId('adm-photo-modal-overlay');
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closePhotoManager(); });
  }

  function openPhotoManager(pid) {
    photoMgrPid = pid;
    renderPhotoManager();
  }
  function closePhotoManager() {
    photoMgrPid = null;
    var root = byId('photo-modal-root');
    if (root) root.innerHTML = '';
  }

  function productRowHtml(p) {
    var name = effectiveName(p), desc = effectiveDesc(p), price = effectivePrice(p);
    var photos = photosFor(p.id);
    var thumb = photos.length ? photos[0] : p.thumb;
    var on = isOn(p);
    var promo = isPromo(p);
    return (
      '<div class="adm-prod-row' + (on ? '' : ' is-off') + '" data-pid="' + escapeHtml(p.id) + '">' +
      '<div class="adm-prod-thumb" data-role="thumb" title="Click para administrar fotos">' +
      (thumb ? '<img src="' + escapeHtml(thumb) + '" alt="">' : '<span style="font-size:10px;text-align:center;display:block;padding:4px">Sin foto</span>') +
      (photos.length > 1 ? '<span class="adm-prod-thumb__count">' + photos.length + '</span>' : '') +
      '</div>' +
      '<div class="adm-prod-main">' +
      '<input type="text" data-role="name" value="' + escapeHtml(name) + '" placeholder="Nombre">' +
      '<input type="text" data-role="desc" value="' + escapeHtml(desc) + '" placeholder="Descripción">' +
      '<input type="number" data-role="price" value="' + (price || 0) + '" placeholder="Precio" min="0" step="100">' +
      '</div>' +
      '<div class="adm-prod-side">' +
      '<label class="adm-switch"><input type="checkbox" data-role="on"' + (on ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span><span class="adm-switch__label">Disponible</span></label>' +
      '<label class="adm-switch"><input type="checkbox" data-role="promo"' + (promo ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span><span class="adm-switch__label">En promo hoy</span></label>' +
      '<button type="button" class="adm-x-btn" data-role="delete" title="Borrar producto">×</button>' +
      '</div>' +
      (!on ? '<span class="adm-sold-out">Agotado</span>' : '') +
      (promo ? '<span class="adm-sold-out" style="background:#2DB84C">En promo</span>' : '') +
      '</div>'
    );
  }

  function renderCatEditor() {
    var wrap = byId('cat-editor');
    if (!wrap || !CARTA_DATA) return;
    var c = catBySlug(activeCatSlug);
    if (!c) { wrap.innerHTML = ''; return; }
    var catOn = state.catOn[c.slug] !== false;
    var products = allActiveProducts(c.slug).filter(function (p) { return !isDeleted(p); });

    wrap.innerHTML =
      '<div class="adm-cat-head">' +
      '<label class="adm-switch"><input type="checkbox" id="cat-on-toggle"' + (catOn ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span><span class="adm-switch__label">Mostrar en la web</span></label>' +
      '</div>' +
      '<div id="prod-list"></div>' +
      '<button type="button" class="adm-btn adm-btn--outline" id="add-prod-btn">+ Agregar producto a ' + escapeHtml(c.name) + '</button>';

    byId('cat-on-toggle').addEventListener('change', function (e) {
      state.catOn[c.slug] = e.target.checked;
      save();
      renderCatTabs();
    });

    var list = byId('prod-list');
    list.innerHTML = products.map(productRowHtml).join('');

    list.querySelectorAll('.adm-prod-row').forEach(function (row) {
      var pid = row.getAttribute('data-pid');
      var product = products.filter(function (p) { return p.id === pid; })[0];
      row.querySelector('[data-role="name"]').addEventListener('input', function (e) { setOverride(pid, { name: e.target.value }); });
      row.querySelector('[data-role="desc"]').addEventListener('input', function (e) { setOverride(pid, { desc: e.target.value }); });
      row.querySelector('[data-role="price"]').addEventListener('input', function (e) { setOverride(pid, { price: +e.target.value || 0 }); });
      row.querySelector('[data-role="on"]').addEventListener('change', function (e) {
        setOverride(pid, { on: e.target.checked });
        renderCatEditor();
      });
      row.querySelector('[data-role="promo"]').addEventListener('change', function (e) {
        setOverride(pid, { promo: e.target.checked });
        renderCatEditor();
      });
      row.querySelector('[data-role="delete"]').addEventListener('click', function () {
        if (!window.confirm('¿Borrar "' + effectiveName(product) + '" de la carta? Se deja de ver en la web.')) return;
        setOverride(pid, { deleted: true });
        renderCatTabs();
        renderCatEditor();
      });
      var thumbEl = row.querySelector('[data-role="thumb"]');
      thumbEl.addEventListener('click', function () { openPhotoManager(pid); });
    });

    byId('add-prod-btn').addEventListener('click', function () {
      var list2 = state.customProducts[c.slug] || (state.customProducts[c.slug] = []);
      list2.push({ id: uid(), name: 'Producto nuevo', slug: 'producto-nuevo', group: '', desc: '', price: 0, priceDiscount: null, thumb: '', image: '', options: [] });
      save();
      renderCatTabs();
      renderCatEditor();
    });
  }

  /* ----- ajuste de precios por % ----- */
  function allProductsFlat() {
    var out = [];
    (CARTA_DATA || []).forEach(function (c) { allActiveProducts(c.slug).forEach(function (p) { if (!isDeleted(p)) out.push({ p: p, cat: c.slug }); }); });
    return out;
  }
  function pctPreviewAndCount() {
    var pct = +byId('pct-input').value || 0;
    var scope = byId('pct-scope').value;
    var round = byId('pct-round').checked;
    var items = allProductsFlat().filter(function (it) { return typeof effectivePrice(it.p) === 'number'; });
    if (scope === 'cat') items = items.filter(function (it) { return it.cat === activeCatSlug; });
    var count = items.length;
    var example = items[0];
    var txt = '';
    if (example) {
      var from = effectivePrice(example.p);
      var to = applyPct(from, pct, round);
      txt = 'Ejemplo: ' + effectiveName(example.p) + ' pasa de ' + fmt(from) + ' a ' + fmt(to) + '.';
    }
    byId('pct-preview').textContent = txt;
    byId('pct-apply-btn').textContent = 'Aplicar a ' + count + ' producto' + (count === 1 ? '' : 's');
    return items;
  }
  function applyPct(price, pct, round) {
    var n = Math.round(price * (1 + pct / 100));
    if (round) n = Math.round(n / 100) * 100;
    return n;
  }
  function initPctPanel() {
    var toggleBtn = byId('pct-toggle-btn'), panel = byId('pct-panel');
    toggleBtn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        var sel = byId('pct-scope');
        sel.innerHTML = '<option value="all">Toda la carta</option><option value="cat">Solo ' + escapeHtml((catBySlug(activeCatSlug) || {}).name || 'esta categoría') + '</option>';
        pctPreviewAndCount();
      }
    });
    ['pct-input', 'pct-scope', 'pct-round'].forEach(function (id) { byId(id).addEventListener('input', pctPreviewAndCount); byId(id).addEventListener('change', pctPreviewAndCount); });
    byId('pct-apply-btn').addEventListener('click', function () {
      var pct = +byId('pct-input').value || 0;
      var round = byId('pct-round').checked;
      var items = pctPreviewAndCount();
      lastPriceSnapshot = items.map(function (it) { return { id: it.p.id, price: effectivePrice(it.p) }; });
      items.forEach(function (it) {
        var np = applyPct(effectivePrice(it.p), pct, round);
        setOverride(it.p.id, { price: np });
      });
      renderCatEditor();
      byId('pct-undo-wrap').hidden = false;
    });
    byId('pct-undo-btn').addEventListener('click', function () {
      if (!lastPriceSnapshot) return;
      lastPriceSnapshot.forEach(function (s) { setOverride(s.id, { price: s.price }); });
      lastPriceSnapshot = null;
      byId('pct-undo-wrap').hidden = true;
      renderCatEditor();
    });
  }

  function initCarta() {
    renderCatTabs();
    renderCatEditor();
    initPctPanel();
    renderTopPicksEditor();
  }

  function allRealProducts() {
    var out = [];
    (CARTA_DATA || []).forEach(function (c) {
      c.products.forEach(function (p) { out.push({ cat: c.slug, catName: c.name, name: p.name, label: effectiveName(p) }); });
    });
    return out;
  }

  function renderTopPicksEditor() {
    var wrap = byId('top-picks-editor');
    if (!wrap || !CARTA_DATA) return;
    var picks = effectiveTopPicks();
    var products = allRealProducts();
    var byCat = {};
    products.forEach(function (p) {
      if (!byCat[p.cat]) byCat[p.cat] = { catName: p.catName, items: [] };
      byCat[p.cat].items.push(p);
    });
    wrap.innerHTML = picks.map(function (pick, i) {
      var optgroups = Object.keys(byCat).map(function (catSlug) {
        var group = byCat[catSlug];
        var opts = group.items.map(function (p) {
          var val = p.cat + '::' + p.name;
          var sel = (p.cat === pick.cat && p.name === pick.name) ? ' selected' : '';
          return '<option value="' + escapeHtml(val) + '"' + sel + '>' + escapeHtml(p.label) + '</option>';
        }).join('');
        return '<optgroup label="' + escapeHtml(group.catName) + '">' + opts + '</optgroup>';
      }).join('');
      return (
        '<label class="adm-field">' +
        '<span>Más pedido #' + (i + 1) + '</span>' +
        '<select data-top-pick-idx="' + i + '">' + optgroups + '</select>' +
        '</label>'
      );
    }).join('');

    wrap.querySelectorAll('[data-top-pick-idx]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var idx = +sel.getAttribute('data-top-pick-idx');
        var parts = sel.value.split('::');
        var current = effectiveTopPicks().slice();
        current[idx] = { cat: parts[0], name: parts[1] };
        state.topPicks = current;
        save();
        renderFotos();
      });
    });
  }

  /* ============================================================
     DELIVERY
     ============================================================ */
  var map = null, mapLayers = [];
  var CENTER = [-31.3929, -64.1838];

  function recomputeKm(zones) {
    zones.forEach(function (z, i) {
      var prev = i === 0 ? 0 : zones[i - 1].radius;
      z.km = i === 0 ? ('hasta ' + fmtKm(z.radius) + ' km') : ('de ' + fmtKm(prev) + ' a ' + fmtKm(z.radius) + ' km');
    });
  }

  function ensureMap() {
    if (map || !window.L) return;
    map = window.L.map('delivery-map', { scrollWheelZoom: false }).setView(CENTER, 14);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    var centerIcon = window.L.divIcon({ html: '<div style="width:16px;height:16px;border-radius:50%;background:#FFD400;border:2px solid #0E0E0E"></div>', className: '', iconSize: [16, 16] });
    window.L.marker(CENTER, { icon: centerIcon }).addTo(map).bindTooltip('Fufa Food', { permanent: true, direction: 'top' });
    drawZones();
    setTimeout(function () { if (map) map.invalidateSize(); }, 60);
  }

  function drawZones() {
    if (!map) return;
    mapLayers.forEach(function (l) { map.removeLayer(l); });
    mapLayers = [];
    recomputeKm(state.zones);
    state.zones.forEach(function (z, i) {
      if (z.on === false) return;
      var circle = window.L.circle(CENTER, {
        radius: z.radius * 1000,
        color: '#0E0E0E',
        weight: 2,
        fillColor: '#FFD400',
        fillOpacity: 0.18,
        dashArray: i === 0 ? null : '6,6'
      }).addTo(map);
      circle.bindTooltip(z.name + ' · ' + fmtKm(z.radius) + ' km');
      mapLayers.push(circle);
    });
  }

  function zoneCardHtml(z, i) {
    var min = i === 0 ? 0 : state.zones[i - 1].radius;
    var chips = z.barrios.map(function (b) {
      return '<span class="adm-chip">' + escapeHtml(b) + '<button type="button" data-rm-barrio="' + escapeHtml(b) + '">×</button></span>';
    }).join('');
    return (
      '<div class="adm-zone-card" data-zi="' + i + '">' +
      '<div class="adm-zone-card__head"><span class="adm-zone-card__name">' + escapeHtml(z.name) + '</span>' +
      '<label class="adm-switch"><input type="checkbox" data-role="on"' + (z.on !== false ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span></label></div>' +
      '<div class="adm-slider-row"><span style="font-size:13px;min-width:70px">' + fmtKm(z.radius) + ' km</span>' +
      '<input type="range" min="' + min + '" max="10" step="0.5" value="' + z.radius + '" data-role="radius"></div>' +
      '<div class="adm-field-row">' +
      '<label class="adm-field"><span>Costo de envío</span><input type="number" data-role="cost" value="' + z.cost + '"></label>' +
      '<label class="adm-field"><span>Tiempo estimado</span><input type="text" data-role="time" value="' + escapeHtml(z.time) + '"></label>' +
      '</div>' +
      '<div class="adm-chip-row">' + chips + '</div>' +
      '<div class="adm-chip-add"><input type="text" placeholder="Agregar barrio" data-role="new-barrio"><button type="button" class="adm-btn adm-btn--sm adm-btn--outline" data-role="add-barrio">Agregar</button></div>' +
      '</div>'
    );
  }

  function renderZonesEditor() {
    recomputeKm(state.zones);
    var el = byId('zones-editor');
    el.innerHTML = state.zones.map(zoneCardHtml).join('');
    el.querySelectorAll('.adm-zone-card').forEach(function (card) {
      var i = +card.getAttribute('data-zi');
      var z = state.zones[i];
      card.querySelector('[data-role="on"]').addEventListener('change', function (e) { z.on = e.target.checked; save(); drawZones(); });
      card.querySelector('[data-role="radius"]').addEventListener('input', function (e) {
        var v = +e.target.value;
        var min = i === 0 ? 0 : state.zones[i - 1].radius;
        v = Math.max(v, min);
        // empuja hacia arriba a las zonas siguientes si quedaron por debajo
        z.radius = v;
        for (var j = i + 1; j < state.zones.length; j++) {
          if (state.zones[j].radius < state.zones[j - 1].radius) state.zones[j].radius = state.zones[j - 1].radius;
        }
        save();
        renderZonesEditor();
        drawZones();
      });
      card.querySelector('[data-role="cost"]').addEventListener('input', function (e) { z.cost = +e.target.value || 0; save(); });
      card.querySelector('[data-role="time"]').addEventListener('input', function (e) { z.time = e.target.value; save(); });
      card.querySelectorAll('[data-rm-barrio]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var b = btn.getAttribute('data-rm-barrio');
          z.barrios = z.barrios.filter(function (x) { return x !== b; });
          save();
          renderZonesEditor();
        });
      });
      card.querySelector('[data-role="add-barrio"]').addEventListener('click', function () {
        var input = card.querySelector('[data-role="new-barrio"]');
        var v = input.value.trim();
        if (!v) return;
        z.barrios.push(v);
        input.value = '';
        save();
        renderZonesEditor();
      });
    });
  }

  function initDelivery() {
    renderZonesEditor();
    byId('add-zone-btn').addEventListener('click', function () {
      var last = state.zones[state.zones.length - 1];
      state.zones.push({ name: 'Zona ' + (state.zones.length + 1), cost: (last ? last.cost : 1500) + 1000, time: '45–60 min', radius: (last ? last.radius : 1.5) + 1.5, barrios: [], on: true });
      save();
      renderZonesEditor();
      drawZones();
    });
  }

  /* ============================================================
     FOTOS
     ============================================================ */
  var DEFAULT_TOP_PICKS = [
    { cat: 'hamburguesas', name: 'BIG FUFA' },
    { cat: 'lomitos', name: 'ESPECIAL' },
    { cat: 'pizzas', name: 'ESPECIAL' },
    { cat: 'empanadas', name: 'DOCENA EMPANADAS MIXTAS' }
  ];

  function effectiveTopPicks() {
    return (state.topPicks && state.topPicks.length === 4) ? state.topPicks : DEFAULT_TOP_PICKS;
  }

  function findRealProduct(catSlug, name) {
    var c = catBySlug(catSlug);
    if (!c) return null;
    return c.products.filter(function (p) { return p.name === name; })[0] || null;
  }

  function fotoSlotHtml(key, label, currentUrl, hint) {
    return (
      '<div class="adm-foto-slot" data-foto-key="' + escapeHtml(key) + '">' +
      '<div class="adm-foto-slot__img">' +
      (currentUrl ? '<img src="' + escapeHtml(currentUrl) + '" alt="">' : '<span class="adm-foto-placeholder">Foto real de Fufa</span>') +
      '</div>' +
      '<div class="adm-foto-slot__label">' + escapeHtml(label) + '</div>' +
      (hint ? '<div class="adm-hint" style="margin:0 10px 6px">' + escapeHtml(hint) + '</div>' : '') +
      '<div class="adm-foto-slot__actions">' +
      '<button type="button" class="adm-btn adm-btn--sm adm-btn--outline" data-role="upload">' + (currentUrl ? 'Cambiar' : 'Subir foto') + '</button>' +
      (currentUrl ? '<button type="button" class="adm-btn adm-btn--sm adm-btn--danger" data-role="remove">Quitar</button>' : '') +
      '</div></div>'
    );
  }

  function renderFotos() {
    var wrap = byId('fotos-groups');
    if (!wrap || !CARTA_DATA) return;

    var inicioSlots = [
      fotoSlotHtml('hero', 'Portada / hero (desktop)', state.photos.hero, 'Se muestra de fondo en el inicio. Sin foto, queda el fondo amarillo.'),
      fotoSlotHtml('heroMobile', 'Portada / hero (mobile)', state.photos.heroMobile, 'Opcional. Si la imagen de desktop corta texto o lo importante en mobile, subí acá una version recortada distinta para celular. Si no cargás esta, se usa la misma de desktop.'),
      fotoSlotHtml('local', 'El local', state.photos.local, null),
      fotoSlotHtml('delivery', 'Delivery', state.photos.delivery, null),
      fotoSlotHtml('eventos', 'Eventos', state.photos.eventos, null)
    ].join('');

    var catSlots = CARTA_DATA.map(function (c) {
      var cur = state.photos['cat-' + c.slug] || c.thumb;
      return fotoSlotHtml('cat-' + c.slug, c.name, cur, null);
    }).join('');

    var topSlots = effectiveTopPicks().map(function (t) {
      var p = findRealProduct(t.cat, t.name);
      var cur = p ? effectiveThumb(p) : '';
      return fotoSlotHtml('top::' + (p ? p.id : t.cat + '-' + t.name), p ? effectiveName(p) : t.name, cur, null);
    }).join('');

    wrap.innerHTML =
      '<div class="adm-foto-group"><h2 class="adm-h2">Inicio</h2><div class="adm-foto-grid">' + inicioSlots + '</div></div>' +
      '<div class="adm-foto-group"><h2 class="adm-h2">Categorías</h2><div class="adm-foto-grid">' + catSlots + '</div></div>' +
      '<div class="adm-foto-group"><h2 class="adm-h2">Los más pedidos</h2><div class="adm-foto-grid">' + topSlots + '</div></div>';

    wrap.querySelectorAll('.adm-foto-slot').forEach(function (slot) {
      var key = slot.getAttribute('data-foto-key');
      var uploadBtn = slot.querySelector('[data-role="upload"]');
      var removeBtn = slot.querySelector('[data-role="remove"]');
      var input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
      slot.appendChild(input);
      uploadBtn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        resizeImageToDataUrl(file, key === 'hero' ? 1920 : (key === 'heroMobile' ? 1400 : 1200), function (dataUrl) {
          if (key.indexOf('top::') === 0) {
            var pid = key.slice(5);
            var arr = photosFor(pid);
            arr[0] = dataUrl; // reemplaza (o agrega) la portada, sin perder el resto de la galería
            setPhotos(pid, arr);
          } else {
            state.photos[key] = dataUrl;
            save();
          }
          renderFotos();
        });
      });
      if (removeBtn) removeBtn.addEventListener('click', function () {
        if (key.indexOf('top::') === 0) {
          var pid = key.slice(5);
          var arr = photosFor(pid);
          arr.shift(); // sacar solo la portada; si quedan otras fotos de la galería, la siguiente pasa a ser portada
          setPhotos(pid, arr);
        } else {
          delete state.photos[key];
          save();
        }
        renderFotos();
      });
    });
  }

  /* ============================================================
     SERVICIOS Y HORARIOS
     ============================================================ */
  var SERVICE_DEFS = [
    { key: 'local', name: 'Comer en el local', desc: 'Si se apaga, se oculta esa sección en la web.' },
    { key: 'delivery', name: 'Delivery', desc: 'Si se apaga, el buscador de zonas avisa que hoy no hay envíos.' },
    { key: 'retiro', name: 'Retiro en el local', desc: 'Si se apaga, se saca la mención de retiro de la web.' },
    { key: 'eventos', name: 'Alquiler para eventos', desc: 'Si se apaga, se oculta el formulario de eventos.' }
  ];

  function renderServicesGrid() {
    var el = byId('services-grid');
    el.innerHTML = SERVICE_DEFS.map(function (s) {
      var on = state.services[s.key] !== false;
      return (
        '<div class="adm-service-card">' +
        '<div><div class="adm-service-card__name">' + escapeHtml(s.name) + '</div><div class="adm-service-card__desc">' + escapeHtml(s.desc) + '</div></div>' +
        '<label class="adm-switch"><input type="checkbox" data-svc="' + s.key + '"' + (on ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span></label>' +
        '</div>'
      );
    }).join('');
    el.querySelectorAll('[data-svc]').forEach(function (input) {
      input.addEventListener('change', function () {
        state.services[input.getAttribute('data-svc')] = input.checked;
        save();
      });
    });
  }

  function hourRowHtml(day, i) {
    return (
      '<div class="adm-hour-row" data-day="' + i + '">' +
      '<span class="adm-hour-row__day">' + DAY_NAMES[i] + '</span>' +
      '<label class="adm-switch"><input type="checkbox" data-role="open"' + (day.open ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span></label>' +
      (day.open
        ? '<input type="time" data-role="from" value="' + day.from + '"><span>a</span><input type="time" data-role="to" value="' + day.to + '">'
        : '<span class="adm-hour-row__closed">Cerrado</span>') +
      '</div>'
    );
  }

  function renderHoursEditor() {
    var el = byId('hours-editor');
    el.innerHTML = state.hours.map(hourRowHtml).join('');
    el.querySelectorAll('.adm-hour-row').forEach(function (row) {
      var i = +row.getAttribute('data-day');
      var day = state.hours[i];
      row.querySelector('[data-role="open"]').addEventListener('change', function (e) {
        day.open = e.target.checked;
        save();
        renderHoursEditor();
        renderStatusIndicators();
      });
      var fromEl = row.querySelector('[data-role="from"]');
      var toEl = row.querySelector('[data-role="to"]');
      if (fromEl) fromEl.addEventListener('input', function (e) { day.from = e.target.value; save(); renderStatusIndicators(); });
      if (toEl) toEl.addEventListener('input', function (e) { day.to = e.target.value; save(); renderStatusIndicators(); });
    });
  }

  function initServicios() {
    renderServicesGrid();
    renderHoursEditor();
    document.querySelectorAll('input[name="estado"]').forEach(function (r) {
      r.checked = (r.value === state.estado);
      r.addEventListener('change', function () {
        if (r.checked) { state.estado = r.value; save(); renderStatusIndicators(); }
      });
    });
    byId('svc-capacidad').value = state.capacidad;
    byId('svc-whatsapp').value = state.whatsapp;
    byId('svc-capacidad').addEventListener('input', function (e) { state.capacidad = +e.target.value || 0; save(); });
    byId('svc-whatsapp').addEventListener('input', function (e) { state.whatsapp = e.target.value.trim(); save(); renderPausedBanner(); });
    renderStatusIndicators();
  }

  /* ============================================================
     INIT
     ============================================================ */
  function boot() {
    initNav();
    showSection('pedidos');
    renderStatusIndicators();
    setInterval(renderStatusIndicators, 60000);

    loadStateFromDb().then(function () {
      initPedidos();
      renderPausedBanner();

      fetch('./data-carta.json').then(function (r) { return r.json(); }).then(function (data) {
        CARTA_DATA = data;
        initCarta();
        initDelivery();
        renderFotos();
        initServicios();
      }).catch(function (err) {
        if (window.console) console.error('No se pudo cargar data-carta.json', err);
        var wrap = byId('cat-editor');
        if (wrap) wrap.innerHTML = '<p class="adm-hint">No pudimos cargar la carta. Probá recargar la página.</p>';
        initDelivery();
        initServicios();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
