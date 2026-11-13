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
  /* Mismo formato que argDateStr() en script.js (DD/MM/AA - HH:MMhs,
     huso de Córdoba), para que la comanda impresa muestre la misma
     fecha/hora que el cliente vio en su mensaje de WhatsApp. */
  function fechaStr(d) {
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
    return parts.day + '/' + parts.month + '/' + parts.year + ' - ' + parts.hour + ':' + parts.minute + 'hs';
  }
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

  /* Si esto falla (hipo de red) o la fila no llega, antes el panel seguía
     de largo con state = defaultState() SIN avisar nada: cualquier cambio
     hecho después pisaba TODA la configuración real (horarios, zonas,
     fotos, precios, los más pedidos, etc) con los valores de fábrica. Ahora
     reintenta solo hasta tener la fila real antes de dejar seguir a boot(). */
  function loadStateFromDb() {
    return db.from('app_settings').select('data,updated_at').eq('id', 'main').maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        if (window.console) console.error(res.error || new Error('app_settings "main" no llegó, reintentando'));
        return new Promise(function (resolve) { setTimeout(function () { resolve(loadStateFromDb()); }, 3000); });
      }
      state = mergeState(defaultState(), res.data.data);
      rememberOwnSave(res.data.updated_at);
    }).catch(function (err) {
      if (window.console) console.error(err);
      return new Promise(function (resolve) { setTimeout(function () { resolve(loadStateFromDb()); }, 3000); });
    });
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    var el1 = byId('saved-text');
    if (el1) el1.textContent = 'Guardando…';
    saveTimer = setTimeout(function () {
      var ts = new Date().toISOString();
      rememberOwnSave(ts);
      db.from('app_settings').upsert({ id: 'main', data: state, updated_at: ts }).then(function (res) {
        var d = new Date();
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        if (el1) el1.textContent = res.error ? 'No se pudo guardar — revisá tu conexión' : ('Guardado ' + hh + ':' + mm);
      });
    }, 400);
  }

  /* P1 del informe QA: si dos pestañas/dispositivos editan el panel al
     mismo tiempo, el último que guarda pisa al otro sin avisar (toda la
     config es un solo registro). No cambiamos ese guardado "todo junto"
     (seria una migracion grande), pero al menos avisamos: si llega un
     cambio de OTRO origen (updated_at distinto al que guardamos
     nosotros mismos), se muestra un banner para recargar antes de seguir
     editando y pisar ese cambio sin querer. */
  // Guarda los últimos timestamps que generamos NOSOTROS (esta pestaña), no
  // solo el último: si editás varios campos seguidos, cada guardado viaja
  // por separado y sus confirmaciones pueden llegar de vuelta desordenadas.
  // Con un solo valor recordado, la confirmación de un guardado "viejo" que
  // llega tarde no se reconocía como propia y se mostraba como si fuera de
  // otro dispositivo, aunque fuera la misma persona editando normal.
  var ownSaveTimes = [];
  function rememberOwnSave(isoTs) {
    var ms = new Date(isoTs).getTime();
    ownSaveTimes.push(ms);
    var cutoff = Date.now() - 60000;
    ownSaveTimes = ownSaveTimes.filter(function (t) { return t >= cutoff; });
  }
  function isOwnSave(isoTs) {
    var ms = new Date(isoTs).getTime();
    for (var i = 0; i < ownSaveTimes.length; i++) {
      if (Math.abs(ownSaveTimes[i] - ms) < 2000) return true;
    }
    return false;
  }
  function subscribeSettings() {
    db.channel('settings-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings', filter: 'id=eq.main' }, function (payload) {
        var updatedAt = payload.new && payload.new.updated_at;
        if (!updatedAt) return;
        if (isOwnSave(updatedAt)) return;
        var banner = byId('conflict-banner');
        if (banner) banner.hidden = false;
      })
      .subscribe();
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
  function isHidden(p) {
    return !!overrideFor(p.id).hidden;
  }
  /* Un producto recién creado arranca oculto (ver add-prod-btn); se
     publica solo cuando ya tiene nombre y precio reales, para no mostrar
     "Producto nuevo" a $0 en la web mientras se lo está armando. */
  function maybeAutoPublish(p) {
    if (!isHidden(p)) return;
    var nm = effectiveName(p).trim();
    var pr = effectivePrice(p);
    if (nm && nm !== 'Producto nuevo' && pr > 0) setOverride(p.id, { hidden: false });
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

  /* Aviso de pedido nuevo: sonido + titulo de la pestaña, para que no se
     pase un pedido si la cocina tiene esta pantalla en otra pestaña. */
  var baseTitle = document.title;
  var newOrderCount = 0;
  function playNewOrderSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.2;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      setTimeout(function () { o.stop(); ctx.close(); }, 180);
      setTimeout(function () {
        var ctx2 = new (window.AudioContext || window.webkitAudioContext)();
        var o2 = ctx2.createOscillator(), g2 = ctx2.createGain();
        o2.type = 'sine'; o2.frequency.value = 1175; g2.gain.value = 0.2;
        o2.connect(g2); g2.connect(ctx2.destination);
        o2.start();
        setTimeout(function () { o2.stop(); ctx2.close(); }, 180);
      }, 200);
    } catch (e) { /* el navegador puede bloquear audio si todavia no hubo ninguna interaccion; no pasa nada */ }
  }
  function updateTabTitle() {
    document.title = newOrderCount > 0 ? '(' + newOrderCount + ') Nuevo pedido' : baseTitle;
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { newOrderCount = 0; updateTabTitle(); }
  });
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
      code: row.code || '',
      name: row.customer_name,
      phone: row.phone || '',
      tipo: row.tipo,
      addr: row.address || '',
      items: Array.isArray(row.items) ? row.items : [],
      pay: row.payment || '',
      pagoCon: row.pago_con != null ? Number(row.pago_con) : null,
      total: Number(row.total) || 0,
      status: row.status,
      createdAt: row.created_at
    };
  }

  /* Los pedidos guardados antes de este cambio tienen o.items como un
     array plano de strings; los nuevos lo guardan agrupado (ver
     buildOrderGroups en script.js). Normalizamos para no romper pedidos
     viejos que puedan seguir en curso justo durante el deploy. */
  function orderGroups(o) {
    if (!Array.isArray(o.items) || !o.items.length) return [];
    if (typeof o.items[0] === 'string') {
      return [{ header: null, items: o.items.map(function (s) { return { qty: null, name: s, price: null, toppings: [], note: '', legacy: true }; }) }];
    }
    return o.items;
  }
  function orderFlatLines(o) {
    var out = [];
    orderGroups(o).forEach(function (g) {
      g.items.forEach(function (l) {
        out.push(l.legacy ? l.name : (l.qty + 'x ' + l.name));
      });
    });
    return out;
  }
  function ageMin(o) {
    var ms = Date.now() - new Date(o.createdAt).getTime();
    return Math.max(0, Math.round(ms / 60000));
  }

  function loadOrdersFromDb() {
    return db.from('orders').select('*').not('status', 'in', '(entregado,cancelado)').order('created_at', { ascending: false }).then(function (res) {
      if (res.error) { if (window.console) console.error(res.error); return; }
      orders = (res.data || []).map(mapOrderRow);
    });
  }

  function subscribeOrders() {
    db.channel('orders-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, function (payload) {
        orders.unshift(mapOrderRow(payload.new));
        renderKanban(); renderPedidosResumen(); renderBadges();
        playNewOrderSound();
        if (document.hidden) { newOrderCount++; updateTabTitle(); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, function (payload) {
        var updated = mapOrderRow(payload.new);
        if (updated.status === 'entregado' || updated.status === 'cancelado') {
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
    var flatLines = orderFlatLines(o);
    var visibleItems = flatLines.slice(0, 2);
    var items = visibleItems.map(function (it) { return '<li>' + escapeHtml(it) + '</li>'; }).join('');
    if (flatLines.length > 2) items += '<li>+' + (flatLines.length - 2) + ' más</li>';
    var btns = '';
    if (o.status !== 'entregado') {
      btns += '<button type="button" class="adm-btn adm-btn--yellow adm-btn--sm" data-advance="' + o.id + '">' + NEXT_LABEL[o.status] + '</button>';
    }
    btns += '<button type="button" class="adm-btn adm-btn--danger adm-btn--sm" data-cancel="' + o.id + '">Cancelar</button>';
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

  /* HTML de los grupos de ítems (categoría, cantidad/nombre/precio,
     toppings y nota) compartido entre el detalle del pedido y la
     comanda impresa, para que ambos muestren siempre la misma
     estructura que armó buildOrderGroups() en script.js. */
  function orderGroupsHtml(o, itemsClass) {
    return orderGroups(o).map(function (g) {
      var itemsHtml = g.items.map(function (l) {
        if (l.legacy) return '<li>' + escapeHtml(l.name) + '</li>';
        var toppingsHtml = (l.toppings && l.toppings.length)
          ? '<p class="order-line__topping-label">' + (l.qty > 1 ? 'Cada unidad lleva:' : 'Topping:') + '</p><ul class="order-line__toppings">' +
            l.toppings.map(function (t) { return '<li>- ' + t.qty + 'x ' + escapeHtml(t.name) + (t.price > 0 ? ' (+' + fmt(t.price) + ')' : '') + '</li>'; }).join('') +
            '</ul>'
          : '';
        var noteHtml = l.note ? '<p class="order-line__note">Nota: ' + escapeHtml(l.note) + '</p>' : '';
        return '<li>' + l.qty + 'x ' + escapeHtml(l.name) + ': ' + fmt(l.price) + toppingsHtml + noteHtml + '</li>';
      }).join('');
      return (g.header ? '<p class="order-group__header">' + escapeHtml(g.header) + '</p>' : '') +
        '<ul class="' + (itemsClass || '') + '">' + itemsHtml + '</ul>';
    }).join('');
  }

  /* ----- modal de detalle del pedido ----- */
  function orderDetailHtml(o) {
    return (
      '<div class="adm-modal-overlay" id="adm-order-modal-overlay">' +
      '<div class="adm-modal-box" role="dialog" aria-modal="true" aria-label="Pedido #' + (o.dailySeq != null ? o.dailySeq : o.id) + '">' +
      '<button type="button" class="adm-modal-close" data-role="order-modal-close">Cerrar</button>' +
      '<h3 class="adm-modal-title">Pedido #' + (o.dailySeq != null ? o.dailySeq : o.id) + '</h3>' +
      '<p class="adm-hint">' + tagHtml(o.tipo) + ' · ' + ageMin(o) + ' min</p>' +
      '<p><strong>' + escapeHtml(o.name) + '</strong>' + (o.phone ? ' · ' + escapeHtml(o.phone) : '') + '</p>' +
      (o.addr ? '<p>' + escapeHtml(o.addr) + '</p>' : '') +
      orderGroupsHtml(o, 'adm-order-detail-items') +
      '<p>' + escapeHtml(o.pay) + (o.pagoCon != null ? ' · Pago con ' + fmt(o.pagoCon) : '') + '</p>' +
      '<p style="font-size:20px;font-weight:700">' + fmt(o.total) + '</p>' +
      '<div class="adm-modal-actions">' +
      '<button type="button" class="adm-btn adm-btn--outline" data-role="print-order">Imprimir comanda</button>' +
      '<button type="button" class="adm-btn adm-btn--danger" data-role="cancel-order">Cancelar pedido</button>' +
      '</div>' +
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
    var cancelBtn = root.querySelector('[data-role="cancel-order"]');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { cancelOrder(o.id); });
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
    var fecha = o.createdAt ? fechaStr(new Date(o.createdAt)) : '';
    var tipoLine = o.tipo === 'delivery'
      ? ('Delivery a: ' + (o.addr || ''))
      : (o.tipo === 'retiro' ? 'Retira en el local' : 'Consumo en el local');
    root.innerHTML =
      '<div class="print-ticket">' +
      '<p>Pedido: #' + (o.dailySeq != null ? o.dailySeq : o.id) + (o.code ? ' / ' + escapeHtml(o.code) : '') + '</p>' +
      '<p>Tienda: fufafood</p>' +
      '<p>Fecha: ' + fecha + '</p>' +
      '<p>Nombre: ' + escapeHtml(o.name) + '</p>' +
      (o.phone ? '<p>Teléfono: ' + escapeHtml(o.phone) + '</p>' : '') +
      '<hr>' +
      '<p>Forma de pago: ' + escapeHtml(o.pay) + '</p>' +
      '<p>Total: ' + fmt(o.total) + '</p>' +
      (o.pagoCon != null ? '<p>Pago con: ' + fmt(o.pagoCon) + '</p>' : '') +
      '<hr>' +
      '<p>' + escapeHtml(tipoLine) + '</p>' +
      '<hr>' +
      '<p>Mi pedido es</p>' +
      orderGroupsHtml(o) +
      '<hr>' +
      '<p class="print-ticket__total">TOTAL: ' + fmt(o.total) + '</p>' +
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
    board.querySelectorAll('[data-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () { cancelOrder(+btn.getAttribute('data-cancel')); });
    });
    renderKanbanTabs();
  }

  /* Cancelar borra el pedido para siempre (no hay "cancelados" para revisar
     despues), asi que se confirma antes de mandar el delete. */
  /* Cancelar NO borra la fila: queda con status "cancelado" (sale del
     Kanban igual que "entregado"), asi no se pierde el historial ni la
     facturacion del dia por un pedido que se canceló. */
  function cancelOrder(id) {
    var o = orders.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    var label = '#' + (o.dailySeq != null ? o.dailySeq : o.id) + ' (' + o.name + ')';
    if (!window.confirm('¿Cancelar el pedido ' + label + '? Sale del tablero, pero queda guardado como cancelado.')) return;
    orders = orders.filter(function (x) { return x.id !== id; });
    renderKanbanTabs(); renderKanban(); renderPedidosResumen(); renderBadges();
    closeOrderDetail();
    db.from('orders').update({ status: 'cancelado' }).eq('id', id).then(function (res) {
      if (res.error && window.console) console.error(res.error);
    });
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

  /* Antes esto devolvía un data: URL en base64 (quedaba texto pesado
     adentro de app_settings). Ahora redimensiona igual pero sube el
     archivo a Supabase Storage (bucket "fotos", ver supabase/schema.sql)
     y devuelve la URL pública real -- unos pocos bytes para guardar en
     vez de cientos de KB por foto. */
  var STORAGE_BUCKET = 'fotos';
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
        canvas.toBlob(function (blob) {
          var path = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
          db.storage.from(STORAGE_BUCKET).upload(path, blob, { contentType: 'image/jpeg' }).then(function (res) {
            if (res.error) {
              if (window.console) console.error('No se pudo subir la imagen', res.error);
              window.alert('No se pudo subir la imagen. Si es la primera vez, puede faltar crear el bucket "fotos" en Supabase (ver supabase/schema.sql). Si no, revisá tu conexión.');
              return;
            }
            var pub = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
            cb(pub.data.publicUrl);
          });
        }, 'image/jpeg', 0.85);
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
    var hidden = isHidden(p);
    return (
      '<div class="adm-prod-row' + (on ? '' : ' is-off') + '" data-pid="' + escapeHtml(p.id) + '">' +
      '<div class="adm-prod-thumb" data-role="thumb" title="Click para administrar fotos">' +
      (thumb ? '<img src="' + escapeHtml(thumb) + '" alt="">' : '<span style="font-size:10px;text-align:center;display:block;padding:4px">Sin foto</span>') +
      (photos.length > 1 ? '<span class="adm-prod-thumb__count">' + photos.length + '</span>' : '') +
      '</div>' +
      '<div class="adm-prod-main">' +
      '<input type="text" data-role="name" value="' + escapeHtml(name) + '" placeholder="Nombre">' +
      '<input type="text" data-role="desc" value="' + escapeHtml(desc) + '" placeholder="Descripción">' +
      '<input type="number" data-role="price" value="' + (price || 0) + '" placeholder="Precio" min="0" step="1">' +
      '</div>' +
      '<div class="adm-prod-side">' +
      '<label class="adm-switch"><input type="checkbox" data-role="on"' + (on ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span><span class="adm-switch__label">Disponible</span></label>' +
      '<label class="adm-switch"><input type="checkbox" data-role="promo"' + (promo ? ' checked' : '') + '><span class="adm-switch__track"><span class="adm-switch__thumb"></span></span><span class="adm-switch__label">En promo hoy</span></label>' +
      '<button type="button" class="adm-x-btn" data-role="delete" title="Borrar producto">×</button>' +
      '</div>' +
      (!on ? '<span class="adm-sold-out">Agotado</span>' : '') +
      (promo ? '<span class="adm-sold-out" style="background:#2DB84C">En promo</span>' : '') +
      (hidden ? '<span class="adm-sold-out" style="background:#8a6a00">Oculto — completá nombre y precio para publicarlo</span>' : '') +
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
      /* "change" (al salir del campo), no "input": publicar un valor por
         cada tecla tipeada mandaba precios/nombres a medio escribir a
         quien estuviera mirando la web justo en ese momento. */
      row.querySelector('[data-role="name"]').addEventListener('change', function (e) {
        setOverride(pid, { name: e.target.value });
        maybeAutoPublish(product);
        renderCatEditor();
      });
      row.querySelector('[data-role="desc"]').addEventListener('change', function (e) { setOverride(pid, { desc: e.target.value }); });
      row.querySelector('[data-role="price"]').addEventListener('change', function (e) {
        setOverride(pid, { price: +e.target.value || 0 });
        maybeAutoPublish(product);
        renderCatEditor();
      });
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
      var newId = uid();
      list2.push({ id: newId, name: 'Producto nuevo', slug: 'producto-nuevo', group: '', desc: '', price: 0, priceDiscount: null, thumb: '', image: '', options: [] });
      /* Arranca oculto: no se ve en la web hasta que tenga nombre y precio
         reales (ver maybeAutoPublish), asi no sale "Producto nuevo" a $0. */
      setOverride(newId, { hidden: true });
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
      c.products.forEach(function (p) { out.push({ cat: c.slug, catName: c.name, id: p.id, name: p.name, label: effectiveName(p) }); });
    });
    return out;
  }

  /* Un pick coincide con un producto por id (estable); los picks viejos
     (de antes de este cambio) solo tenían {cat,name}, así que para esos
     se compara por nombre como respaldo. */
  function pickMatchesProduct(pick, p) {
    if (pick.id) return pick.id === p.id;
    return pick.cat === p.cat && pick.name === p.name;
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
          var val = p.cat + '::' + p.id;
          var isThisSlot = pickMatchesProduct(pick, p);
          /* No dejar elegir el mismo producto en dos puestos a la vez. */
          var usedElsewhere = picks.some(function (other, oi) { return oi !== i && pickMatchesProduct(other, p); });
          var attrs = (isThisSlot ? ' selected' : '') + (usedElsewhere && !isThisSlot ? ' disabled' : '');
          var label = p.label + ' — ' + p.catName + (usedElsewhere && !isThisSlot ? ' (ya elegido)' : '');
          return '<option value="' + escapeHtml(val) + '"' + attrs + '>' + escapeHtml(label) + '</option>';
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
        var product = products.filter(function (p) { return p.cat === parts[0] && p.id === parts[1]; })[0];
        if (!product) return;
        var current = effectiveTopPicks().slice();
        current[idx] = { cat: parts[0], id: parts[1], name: product.name };
        state.topPicks = current;
        save();
        renderTopPicksEditor();
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
    { cat: 'hamburguesas', id: 'IlNOGYezC5vWn4zWrBHc', name: 'BIG FUFA' },
    { cat: 'lomitos', id: 'fCScPT8RmMvRgWjQQ98P', name: 'ESPECIAL' },
    { cat: 'pizzas', id: 'weHYC6IEv5aIx2TZ0UdF', name: 'ESPECIAL' },
    { cat: 'empanadas', id: 'v8kx4BFNafhSc9AipQyA', name: 'DOCENA EMPANADAS MIXTAS' }
  ];

  function effectiveTopPicks() {
    return (state.topPicks && state.topPicks.length === 4) ? state.topPicks : DEFAULT_TOP_PICKS;
  }

  function findRealProduct(catSlug, name) {
    var c = catBySlug(catSlug);
    if (!c) return null;
    return c.products.filter(function (p) { return p.name === name; })[0] || null;
  }
  function findRealProductById(catSlug, id) {
    var c = catBySlug(catSlug);
    if (!c) return null;
    return c.products.filter(function (p) { return p.id === id; })[0] || null;
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
      var p = t.id ? findRealProductById(t.cat, t.id) : findRealProduct(t.cat, t.name);
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
    byId('svc-whatsapp').addEventListener('input', function (e) { state.whatsapp = e.target.value.trim(); save(); renderPausedBanner(); updateWaTestLink(); });
    byId('svc-whatsapp').addEventListener('change', function (e) {
      state.whatsapp = normalizeWhatsapp(e.target.value);
      e.target.value = state.whatsapp;
      save(); renderPausedBanner(); updateWaTestLink();
    });
    updateWaTestLink();
    renderStatusIndicators();
  }

  /* Agrega el 549 (Argentina, celular) si falta, para que wa.me y tel:
     siempre reciban el formato internacional completo (ver C1 del QA). */
  function normalizeWhatsapp(raw) {
    var digits = (raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.indexOf('549') === 0) return digits;
    if (digits.indexOf('54') === 0) return '549' + digits.slice(2);
    return '549' + digits;
  }
  function updateWaTestLink() {
    var a = byId('svc-whatsapp-test');
    if (a) a.href = 'https://wa.me/' + normalizeWhatsapp(state.whatsapp);
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
      subscribeSettings();
      var reloadBtn = byId('conflict-reload-btn');
      if (reloadBtn) reloadBtn.addEventListener('click', function () { window.location.reload(); });

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

  /* ============================================================
     LOGIN
     Aviso de seguridad: esto es solo una traba del lado del navegador para
     que no entre cualquiera que se tope con la URL. NO reemplaza seguridad
     real — la base (Supabase) sigue aceptando leer/escribir con la misma
     clave pública que ya usa la web público, login o no. La contraseña
     nunca queda en texto plano en el código: se compara el hash SHA-256.
     ============================================================ */
  var AUTH_KEY = 'fufaAdminAuth';
  var AUTH_USER = 'fufafood';
  var AUTH_PASS_SHA256 = 'fef938812a2ba39a4d65df411de1a091be30a3195fcc3dc6bfba6c15365a5452';

  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  function showAdminShell() {
    document.body.classList.remove('is-logged-out');
    ['adm-topbar', 'adm-shell', 'adm-bottomnav'].forEach(function (id) { var el = byId(id); if (el) el.hidden = false; });
  }

  function wireLogout() {
    var btn = byId('logout-btn');
    if (btn) btn.addEventListener('click', function () {
      window.localStorage.removeItem(AUTH_KEY);
      window.location.reload();
    });
  }

  function wireLogin() {
    var form = byId('login-form');
    var err = byId('login-error');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var user = byId('login-user').value.trim();
      var pass = byId('login-pass').value;
      sha256Hex(pass).then(function (hash) {
        if (user === AUTH_USER && hash === AUTH_PASS_SHA256) {
          window.localStorage.setItem(AUTH_KEY, '1');
          err.hidden = true;
          showAdminShell();
          boot();
        } else {
          err.hidden = false;
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireLogout();
    if (window.localStorage.getItem(AUTH_KEY) === '1') {
      showAdminShell();
      boot();
    } else {
      document.body.classList.add('is-logged-out');
      wireLogin();
    }
  });
})();
