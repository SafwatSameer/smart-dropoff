/* Smart Drop-off — clickable prototype.
   All roads, distances and routes come from data.js (OpenStreetMap + OSRM). */
(function () {
  'use strict';
  var D = window.SD_DATA;
  var $ = function (s) { return document.querySelector(s); };
  var TURN_IDX = 38;          // routeSmart and routeToday share points 0..38 (the left turn off N3)
  var END_LIMIT_M = 60;       // ending a trip farther than this from the confirmed point needs passenger OK
  var MS_PER_M = 6;           // animation speed

  /* ---------- geometry ---------- */
  var RAD = Math.PI / 180, R = 6371000;
  function dist(a, b) {
    var x = (b[1] - a[1]) * RAD * Math.cos((a[0] + b[0]) / 2 * RAD), y = (b[0] - a[0]) * RAD;
    return Math.hypot(x, y) * R;
  }
  function toXY(p) { return [(p[1] - D.canteen[1]) * RAD * Math.cos(D.canteen[0] * RAD) * R, (p[0] - D.canteen[0]) * RAD * R]; }
  function toLL(q) { return [D.canteen[0] + q[1] / R / RAD, D.canteen[1] + q[0] / R / RAD / Math.cos(D.canteen[0] * RAD)]; }
  function nearestOn(line, p) {
    var P = toXY(p), best = { d: Infinity, pt: null };
    for (var i = 0; i < line.length - 1; i++) {
      var A = toXY(line[i]), B = toXY(line[i + 1]), dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy;
      var t = L ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      var Q = [A[0] + t * dx, A[1] + t * dy], d = Math.hypot(P[0] - Q[0], P[1] - Q[1]);
      if (d < best.d) best = { d: d, pt: toLL(Q) };
    }
    return best;
  }
  function nearestOf(lines, p) {
    return lines.reduce(function (b, l) { var n = nearestOn(l, p); return n.d < b.d ? n : b; }, { d: Infinity });
  }
  function cumulative(path) {
    var c = [0];
    for (var i = 1; i < path.length; i++) c.push(c[i - 1] + dist(path[i - 1], path[i]));
    return c;
  }
  function pointAt(path, cum, d) {
    for (var i = 1; i < path.length; i++) {
      if (cum[i] >= d) {
        var seg = cum[i] - cum[i - 1], t = seg ? (d - cum[i - 1]) / seg : 0;
        return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
      }
    }
    return path[path.length - 1];
  }
  var r10 = function (m) { return Math.round(m / 10) * 10; };
  var mfmt = function (m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; };

  /* Smart snapping: the backend rule this proposal adds.
     Ground-level, stoppable roads win; elevated / no-motorcycle roads are never a drop-off. */
  function classify(p) {
    var c = classifyRoad(p);
    if (c.snap && dist(c.snap, D.canteen) > 150) return { level: 'bad', kind: 'far', snap: null, msg: 'That spot is ' + Math.round(dist(c.snap, D.canteen)) + ' m from the canteen. Move the pin closer to your gate.' };
    return c;
  }
  function classifyRoad(p) {
    var dohs = nearestOn(D.roads.dohsBypass, p);
    var n3 = nearestOf([D.roads.n3, D.roads.n3North], p);
    var exp = nearestOf([D.roads.expressway, D.roads.expresswayRamp], p);
    var near = 22;
    if (dohs.d <= near) return { level: 'ok', kind: 'dohs', snap: dohs.pt, msg: 'On the DOHS road (ground level). The expressway overhead is ignored: bikes can\'t stop there.' };
    if (n3.d <= near) return { level: 'warn', kind: 'n3', snap: n3.pt, msg: 'On New Airport Road (N3). You\'ll have to cross a divided highway to reach the canteen.' };
    if (exp.d <= near) return { level: 'bad', kind: 'exp', snap: null, msg: 'That\'s the Elevated Expressway or its ramp. Bikes can\'t stop there. Move the pin to the canteen\'s road.' };
    var to = dohs.d <= n3.d ? { k: 'dohs', n: dohs, name: 'the DOHS road' } : { k: 'n3', n: n3, name: 'New Airport Road (N3)' };
    if (to.n.d > 150) return { level: 'bad', kind: 'far', snap: null, msg: 'Too far from the canteen. Move the pin closer to your gate.' };
    return { level: to.k === 'dohs' ? 'ok' : 'warn', kind: to.k, snap: to.n.pt, msg: 'Not on a road. The rider will stop at the nearest point on ' + to.name + ', ' + Math.round(to.n.d) + ' m from your pin.' };
  }

  /* ---------- state ---------- */
  function loadSaved() { try { return JSON.parse(localStorage.getItem('sd-saved') || 'null'); } catch (e) { return null; } }
  function storeSaved(v) { try { if (v) localStorage.setItem('sd-saved', JSON.stringify(v)); else localStorage.removeItem('sd-saved'); } catch (e) { /* private mode */ } }

  var NOTES = {
    enter: ['Take the DOHS road, not the expressway', 'এক্সপ্রেসওয়ে না, ডিওএইচএস রোড দিয়ে আসবেন'],
    gate: ['Stop at the canteen gate', 'ক্যান্টিনের গেটে থামবেন'],
    hw: ['Not on the highway (N3)', 'হাইওয়েতে (N3) নামাবেন না']
  };
  var S = {
    mode: /today/.test(location.hash) ? 'today' : 'smart',
    step: 'home', choice: 'gate', custom: null, notes: ['enter', 'gate'], save: true,
    saved: loadSaved(), usedSaved: false, feedback: null, end: null, rogue: false, detour: false, log: []
  };

  /* ---------- drop-off helpers ---------- */
  function drop() {
    if (S.mode === 'today') return { pt: D.n3Stop, kind: 'n3', en: 'POL Depo Ca…antonment', bn: 'নতুন বিমানবন্দর সড়ক (N3)' };
    if (S.choice === 'gate') return { pt: D.gate, kind: 'dohs', en: 'Canteen gate · Baridhara DOHS Main Rd', bn: 'ক্যান্টিন গেট, বারিধারা ডিওএইচএস মেইন রোড' };
    if (S.choice === 'n3') return { pt: D.n3Stop, kind: 'n3', en: 'New Airport Road (N3), opposite the canteen', bn: 'নতুন বিমানবন্দর সড়ক (N3), ক্যান্টিনের বিপরীতে' };
    var c = S.custom && S.custom.snap ? S.custom : null;
    if (!c) return null;
    return c.kind === 'dohs'
      ? { pt: c.snap, kind: 'dohs', en: 'Your pin · DOHS road', bn: 'যাত্রীর পিন, ডিওএইচএস রোড' }
      : { pt: c.snap, kind: 'n3', en: 'Your pin · New Airport Road (N3)', bn: 'যাত্রীর পিন, নতুন বিমানবন্দর সড়ক (N3)' };
  }
  function routeFor(dp) {
    if (S.mode === 'today') return D.routeToday.path;
    var base = dp.kind === 'dohs' ? D.routeSmart.path : D.routeToday.path;
    var last = base[base.length - 1];
    return dist(last, dp.pt) < 2 ? base : base.concat([dp.pt]);
  }
  function walkM(pt) { return dist(pt, D.canteen); }
  var overbridgeWalk = function () { return dist(D.n3Stop, D.overbridge) + dist(D.overbridge, D.canteen); };

  /* ---------- log ---------- */
  function log(kind, html) { S.log.push({ kind: kind, html: html }); renderLog(); }
  function renderLog() {
    var el = $('#log');
    if (!S.log.length) { el.innerHTML = '<li class="empty">Tap <b>Office</b> on the phone to start.</li>'; return; }
    el.innerHTML = S.log.map(function (l) { return '<li class="' + l.kind + '">' + l.html + '</li>'; }).join('');
    el.scrollTop = el.scrollHeight;
  }
  function candidatesTable(smart) {
    return '<table>' +
      '<tr><td>Dhaka Elevated Expressway<br><code>bridge · layer 3 · motorcycle=no</code></td><td>18 m</td><td class="' + (smart ? 'rej">✗ no stopping' : 'bad">← picked') + '</td></tr>' +
      '<tr><td>Baridhara DOHS Main Rd<br><code>ground level · directly below</code></td><td>17 m</td><td class="' + (smart ? 'acc">✓ chosen' : '">lost the tie') + '</td></tr>' +
      '<tr><td>New Airport Road (N3)<br><code>divided trunk · far side</code></td><td>89 m</td><td class="' + (smart ? 'fb">fallback' : 'bad">rider ends here') + '</td></tr>' +
      '</table>';
  }

  /* ---------- icons ---------- */
  var I = {
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    office: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 21V5l8-3v19M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20"/></svg>',
    home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v10H3z"/><path d="M9 21v-6h6v6"/></svg>',
    warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
    ok: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6"/></svg>',
    pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    bike: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5L9 10h5l4.5 6.5M12 10l-1.5-3H8M14 10l1.5-3H18"/></svg>',
    bikeBig: '<svg width="46" height="34" viewBox="0 0 46 34" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="24" r="7" stroke="#0b1220" stroke-width="3"/><circle cx="36" cy="24" r="7" stroke="#0b1220" stroke-width="3"/><path d="M10 24l7-11h11l8 11M22 13l-3-6h-5M28 13l3-6h5" stroke="#d92d3a" stroke-width="3"/></svg>',
    fork: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 2v8a2 2 0 002 2v10M11 2v8a2 2 0 01-2 2M17 2c-1.5 0-3 2-3 6s1.5 5 3 5v9"/></svg>'
  };

  /* ---------- map ---------- */
  var map = L.map('map', { zoomControl: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false }).setView(D.canteen, 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  var lay = L.layerGroup().addTo(map);
  var bikeLayer = L.layerGroup().addTo(map);
  var bike = null, customMarker = null;

  function icon(html, size, anchor) { return L.divIcon({ className: 'mk', html: html, iconSize: size, iconAnchor: anchor }); }
  var pinIcon = function (c, faded) { return icon('<div class="pin' + (faded ? ' faded' : '') + '" style="--c:' + c + '"></div>', [30, 40], [15, 39]); };
  var dotIcon = function (c, txt, big) { return icon('<div class="dotm' + (big ? ' big' : '') + '" style="--c:' + c + '">' + (txt || '') + '</div>', big ? [30, 30] : [22, 22], big ? [15, 15] : [11, 11]); };
  var meIcon = icon('<div class="me"></div>', [18, 18], [9, 9]);
  var poiIcon = icon('<div class="poi">' + I.fork + '</div>', [30, 30], [15, 15]);
  var bikeIcon = icon('<div class="bike">' + I.bike + '</div>', [34, 34], [17, 17]);
  function tip(layer, text, cls, dir, offset) {
    layer.bindTooltip(text, { permanent: true, direction: dir || 'top', className: 'lbl ' + (cls || ''), offset: offset || [0, -8] });
    return layer;
  }
  function road(line, style, label, cls) {
    var l = L.polyline(line, style).addTo(lay);
    if (label) l.bindTooltip(label, { permanent: true, direction: 'center', className: 'lbl road ' + (cls || '') });
    return l;
  }
  function drawRoads() {
    road(D.roads.n3, { color: '#64748b', weight: 7, opacity: .55 });
    road(D.roads.dohsBypass, { color: '#0e9f6e', weight: 8, opacity: .75 });
    road(D.roads.expressway, { color: '#d92d3a', weight: 12, opacity: .35, dashArray: '2 6', lineCap: 'butt' });
    road(D.roads.expresswayRamp, { color: '#d92d3a', weight: 8, opacity: .35, dashArray: '2 6', lineCap: 'butt' });
  }
  function canteen() { tip(L.marker(D.canteen, { icon: poiIcon, zIndexOffset: 500 }).addTo(lay), 'POL Depo Canteen', '', 'right', [14, 0]); }
  function fit(points, opts) {
    setTimeout(function () {
      var sheetH = $('#sheet').offsetHeight;
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(points), Object.assign({ paddingTopLeft: [30, 96], paddingBottomRight: [30, sheetH + 48], maxZoom: 18, animate: false }, opts || {}));
    }, 0);
  }

  function drawMap() {
    lay.clearLayers();
    if (S.step !== 'trip' && S.step !== 'rogue') bikeLayer.clearLayers();
    customMarker = null;
    var st = S.step, smart = S.mode === 'smart', dp = drop();

    if (st === 'home') {
      L.marker(D.start, { icon: meIcon }).addTo(lay);
      canteen();
      return fit([D.start, D.canteen]);
    }

    if (st === 'confirm') {
      drawRoads();
      canteen();
      tip(L.marker(D.todayPin, { icon: pinIcon('#d92d3a', true) }).addTo(lay), 'Map pin: on expressway', 'bad', 'left', [-14, -20]);
      var gateSel = S.choice === 'gate', n3Sel = S.choice === 'n3';
      tip(L.marker(D.gate, { icon: dotIcon('#0e9f6e', '✓', gateSel), zIndexOffset: 800 }).addTo(lay), 'Canteen gate', 'ok', 'bottom', [0, 12]);
      tip(L.marker(D.n3Stop, { icon: dotIcon(n3Sel ? '#f59e0b' : '#94a3b8', '', n3Sel) }).addTo(lay), 'N3, opposite side', '', 'left', [-14, 0]);
      if (gateSel) L.polyline([D.gate, D.canteen], { color: '#0e9f6e', weight: 3, dashArray: '4 6' }).addTo(lay);
      if (n3Sel) L.polyline([D.n3Stop, D.canteen], { color: '#d92d3a', weight: 3, dashArray: '4 6' }).addTo(lay);
      if (S.choice === 'custom') {
        var start = S.custom.raw;
        customMarker = L.marker(start, { icon: pinIcon('#1d4ed8'), draggable: true, autoPan: true, zIndexOffset: 1000 }).addTo(lay);
        customMarker.bindTooltip('Drag me', { permanent: !S.custom, direction: 'top', className: 'lbl', offset: [0, -40] });
        customMarker.on('dragend', function () { setCustom(customMarker.getLatLng()); });
        if (S.custom && S.custom.snap) {
          L.marker(S.custom.snap, { icon: dotIcon(S.custom.level === 'ok' ? '#0e9f6e' : '#f59e0b', '') }).addTo(lay);
          L.polyline([S.custom.raw, S.custom.snap], { color: '#1d4ed8', weight: 2, dashArray: '3 5' }).addTo(lay);
        }
      }
      return fit([D.todayPin, D.gate, D.n3Stop, D.canteen], { maxZoom: 18 });
    }

    // ride / searching / matched / trip / rogue / arrived
    var path = routeFor(dp || { pt: D.gate, kind: 'dohs' });
    var lineColor = smart ? '#0e9f6e' : '#0b1220';
    if (st === 'arrived' && !smart) drawRoads();
    L.polyline(path, { color: '#ffffff', weight: 9, opacity: .9 }).addTo(lay);
    L.polyline(path, { color: lineColor, weight: 5 }).addTo(lay);
    L.marker(D.start, { icon: meIcon }).addTo(lay);
    canteen();

    if (!smart) {
      tip(L.marker(D.todayPin, { icon: pinIcon('#d92d3a') }).addTo(lay), 'POL Depo Ca…antonment', '', 'left', [-14, -22]);
      if (st === 'arrived') {
        L.marker(D.n3Stop, { icon: dotIcon('#d92d3a', '✕', true), zIndexOffset: 900 }).addTo(lay);
        tip(L.polyline([D.n3Stop, D.canteen], { color: '#d92d3a', weight: 3, dashArray: '4 6' }).addTo(lay), '89 m · across highway', 'bad', 'center');
        tip(L.polyline([D.n3Stop, D.overbridge, D.canteen], { color: '#f59e0b', weight: 3, dashArray: '2 6' }).addTo(lay), '~' + r10(overbridgeWalk()) + ' m via foot overbridge', '', 'right', [10, 0]);
        return fit([D.n3Stop, D.canteen, D.overbridge], { maxZoom: 18 });
      }
    } else if (dp) {
      var ok = dp.kind === 'dohs';
      tip(L.marker(dp.pt, { icon: dotIcon(ok ? '#0e9f6e' : '#f59e0b', ok ? '✓' : '!', true), zIndexOffset: 900 }).addTo(lay), ok ? 'Drop-off gate' : 'Drop-off (N3)', ok ? 'ok' : '', 'bottom', [0, 14]);
      if (st === 'arrived') {
        var end = S.end || dp.pt;
        var w = walkM(end);
        tip(L.polyline([end, D.canteen], { color: w > 60 ? '#d92d3a' : '#0e9f6e', weight: 3, dashArray: '4 6' }).addTo(lay), Math.round(w) + ' m walk', w > 60 ? 'bad' : 'ok', 'center');
        return fit([end, D.canteen, dp.pt], { maxZoom: 18 });
      }
    }
    if (st === 'trip' || st === 'rogue') return fit(path.concat(S.rogue ? D.routeDetour.path : []));
    return fit(path);
  }

  function setCustom(ll, silent) {
    var raw = [ll.lat, ll.lng];
    var c = classify(raw);
    c.raw = raw;
    S.custom = c;
    if (!silent) {
      log(c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'bad', '<b>Pin moved.</b> Snapping check: ' + c.msg);
      render();
    }
  }

  /* ---------- screens ---------- */
  function top(back, title, sub) {
    return (back ? '<button class="iconbtn" data-act="back" aria-label="Back">' + I.back + '</button>' : '') +
      (title ? '<div class="destpill"><small>' + sub + '</small><b>' + title + '</b></div>' : '');
  }

  var screens = {
    home: function () {
      var saved = S.mode === 'smart' && S.saved;
      return {
        top: '',
        sheet: '<div class="grab"></div><h3>Good morning</h3>' +
          '<button class="search" type="button" data-act="office">' + I.search + 'Where to?</button>' +
          '<div class="label">Saved places</div>' +
          '<button class="place pulse" type="button" data-act="office"><span class="pi">' + I.office + '</span><span class="grow"><b>Office</b><small>POL Depo Canteen Noya Kutum Bari · Dhaka Cantonment</small></span>' +
          (saved ? '<em class="chip ok">Gate saved</em>' : '') + '</button>' +
          '<button class="place" type="button" disabled><span class="pi">' + I.home + '</span><span class="grow"><b>Home</b><small>Not set in this demo</small></span></button>'
      };
    },

    confirm: function () {
      var c = S.custom;
      var noteChips = Object.keys(NOTES).map(function (k) {
        return '<button type="button" data-note="' + k + '" aria-pressed="' + (S.notes.indexOf(k) > -1) + '">' + NOTES[k][0] + '</button>';
      }).join('');
      var bn = S.notes.map(function (k) { return NOTES[k][1]; }).join(' · ');
      var en = S.notes.map(function (k) { return NOTES[k][0]; }).join(' · ');
      var canConfirm = S.choice !== 'custom' || (c && c.snap);
      var opt = function (v, title, sub, extra) {
        var sel = S.choice === v;
        return '<label class="opt' + (sel ? ' sel' : '') + (sel && v === 'n3' ? ' risky' : '') + '"><input type="radio" name="drop" value="' + v + '"' + (sel ? ' checked' : '') + '>' +
          '<span class="grow"><b>' + title + '</b><small>' + sub + '</small></span>' + (extra || '') + '</label>';
      };
      return {
        top: top(true, 'POL Depo Canteen Noya Kutum Bari', 'Drop-off point'),
        sheet: '<div class="grab"></div>' +
          '<div class="alert warn">' + I.warn + '<div><b>Your map pin is on the Dhaka Elevated Expressway.</b>Bikes can\'t stop there, so riders end up dropping people on the highway.</div></div>' +
          '<h3>Where should your rider stop?</h3>' +
          opt('gate', 'Canteen gate · Baridhara DOHS Main Rd', Math.round(walkM(D.gate)) + ' m walk · no road to cross · +52 m for the rider', '<em class="chip ok">Best</em>') +
          opt('n3', 'New Airport Road (N3), opposite side', '89 m straight line · cross a divided highway, or ~' + r10(overbridgeWalk()) + ' m via foot overbridge') +
          opt('custom', 'Set the exact spot on the map', 'Drag the blue pin, or tap the map. We check that a bike can stop there.') +
          (S.choice === 'custom' && c ? '<div class="check ' + c.level + '">' + c.msg + (c.snap ? ' Walk: ' + Math.round(walkM(c.snap)) + ' m.' : '') + '</div>' : '') +
          '<div class="label">Note for your rider <small>· auto-translated to Bangla</small></div>' +
          '<div class="chips">' + noteChips + '</div>' +
          (S.notes.length ? '<div class="bnbox">' + bn + '<small>' + en + '</small></div>' : '') +
          '<label class="switch"><span>Save as my Office drop-off<small>We won\'t ask again on your next trip</small></span><input type="checkbox" data-act="save"' + (S.save ? ' checked' : '') + '></label>' +
          '<button class="primary" type="button" data-act="confirm"' + (canConfirm ? '' : ' disabled') + '>Confirm drop-off</button>'
      };
    },

    ride: function () {
      var smart = S.mode === 'smart', dp = drop();
      var routeM = smart ? (dp.kind === 'dohs' ? D.routeSmart.m : D.routeToday.m) : D.routeToday.m;
      var dropRow = smart
        ? '<div class="drop ' + (dp.kind === 'dohs' ? 'ok' : '') + '">' + (dp.kind === 'dohs' ? I.ok : I.warn) + '<span class="grow"><b>Drop-off: ' + dp.en + '</b><small>' +
          (S.usedSaved ? 'Saved Office drop-off · ' : '') + 'Your rider sees this point before accepting</small></span><button class="linkish" type="button" data-act="change">Change</button></div>'
        : '<div class="drop">' + I.pin + '<span class="grow"><b>Drop-off: POL Depo Ca…antonment</b><small>Pin placed automatically by the map</small></span></div>';
      return {
        top: top(true, smart ? dp.en : 'POL Depo Ca…antonment', 'Reach in ~8 mins · ' + mfmt(routeM)),
        sheet: '<div class="grab"></div><div class="row between"><h3>Ride details</h3><span class="pill">Pickup now</span></div>' +
          '<div class="vehicle">' + I.bikeBig + '<span class="grow"><b>Bike</b> · 1<small>Quick and affordable ride</small></span><span class="fare">৳136</span></div>' +
          dropRow +
          '<div class="payrow">Cash <span>Change ›</span></div>' +
          '<button class="primary" type="button" data-act="book">Choose Bike</button>'
      };
    },

    searching: function () {
      return {
        top: top(false),
        sheet: '<div class="grab"></div><div class="spinner" role="img" aria-label="Searching"></div><p class="center"><b>Finding a rider near you…</b></p>' +
          (S.mode === 'smart' ? '<p class="center" style="color:var(--muted);font-size:13px">Riders see your drop-off gate before they accept.</p>' : '')
      };
    },

    matched: function () {
      var smart = S.mode === 'smart';
      return {
        top: top(false, smart ? drop().en : 'POL Depo Ca…antonment', 'Rider on the way'),
        sheet: '<div class="grab"></div>' +
          '<div class="rider"><div class="avatar">K</div><div class="grow"><b>Karim</b> <span style="color:#f59e0b">★</span> 4.9<small>Bike · DHAKA METRO-HA 12-3456</small></div><div class="eta">2 min<small><br>away</small></div></div>' +
          (smart ? '<div class="ack">' + I.ok + '<span>Karim saw your drop-off gate before accepting.</span></div>' +
                   '<button class="ghost" type="button" data-act="peek">See what the rider sees</button>'
                 : '<p style="color:var(--muted)">Your rider is coming to pick you up.</p>') +
          '<button class="primary" type="button" data-act="start">Start trip <small style="font-weight:500;opacity:.8">(simulated)</small></button>'
      };
    },

    trip: function () {
      var smart = S.mode === 'smart';
      return {
        top: top(false, smart ? drop().en : 'POL Depo Ca…antonment', 'On trip'),
        sheet: '<div class="grab"></div><h3>On the way</h3>' +
          '<div class="progress"><i id="prog"></i></div>' +
          '<div class="next"><span class="ar" id="nextAr">↑</span><span id="nextTxt">Starting…</span></div>' +
          (smart && drop().kind === 'dohs' && !S.rogue ? '<button class="demo" type="button" id="rogueBtn" data-act="rogue">Demo: rider skips the turn<small>See what happens when a rider ignores the gate and stays on N3</small></button>' : '')
      };
    },

    rogue: function () {
      var dp = drop();
      return {
        top: top(false, dp.en, 'Rider stopped'),
        sheet: '<div class="grab"></div>' +
          '<div class="alert bad">' + I.warn + '<div><b>Karim wants to end the trip here.</b>You are ' + Math.round(dist(D.n3Stop, dp.pt)) + ' m from your gate, across a divided highway.</div></div>' +
          '<p>Smart Drop-off asks you first whenever a trip ends more than ' + END_LIMIT_M + ' m from a confirmed gate. This rider missed the turn, so reaching the gate now means a <b>' + mfmt(D.routeDetour.m) + ' detour</b>. That\'s why the rider gets the gate and the turn before accepting.</p>' +
          '<button class="primary" type="button" data-act="continue">Ask rider to continue to the gate</button>' +
          '<button class="ghost" type="button" data-act="endhere">End trip here</button>'
      };
    },

    arrived: function () {
      var smart = S.mode === 'smart', dp = drop();
      if (!smart) {
        return {
          top: top(false, 'POL Depo Ca…antonment', 'Trip complete'),
          sheet: '<div class="grab"></div>' +
            '<div class="alert bad">' + I.warn + '<div><b>You were dropped on New Airport Road (N3).</b>The canteen is 89 m away across a divided highway. The safe way is the Shewra foot overbridge, about ' + r10(overbridgeWalk()) + ' m on foot.</div></div>' +
            '<div class="stats"><div class="stat bad"><small>Drop-off error</small><b>89 m</b></div><div class="stat bad"><small>Safe walk</small><b>~' + r10(overbridgeWalk()) + ' m</b></div></div>' +
            '<p style="font-size:13px;color:var(--muted)">This happens on about half of my weekday trips. Next time, it\'s easier to open Uber.</p>' +
            '<button class="primary" type="button" data-act="toSmart" style="background:var(--good)">Replay with Smart Drop-off →</button>'
        };
      }
      var end = S.end || dp.pt, w = walkM(end), good = w <= 60;
      var fb = S.feedback;
      return {
        top: top(false, dp.en, 'Trip complete'),
        sheet: '<div class="grab"></div>' +
          (good
            ? '<div class="alert ok">' + I.ok + '<div><b>You\'ve arrived at your gate.</b>' + Math.round(w) + ' m walk to the canteen, no road to cross.' + (S.rogue ? ' The rider took the detour after your request.' : '') + '</div></div>'
            : '<div class="alert warn">' + I.warn + '<div><b>Trip ended ' + Math.round(dist(end, dp.pt)) + ' m from your gate.</b>We logged it as a wrong drop-off. That feeds rider coaching and the gate data.</div></div>') +
          '<div class="label">Was this the right drop-off spot?</div>' +
          '<div class="fb"><button type="button" data-fb="yes" aria-pressed="' + (fb === 'yes') + '">Yes</button><button type="button" data-fb="no" aria-pressed="' + (fb === 'no') + '">No, it was wrong</button></div>' +
          (fb ? '<p style="font-size:13px;color:var(--muted)">Thanks. ' + (fb === 'yes' ? 'This confirms the gate for everyone going to POL Depo Canteen.' : 'We\'ll ask the next few passengers to confirm this gate.') + '</p>' : '') +
          '<div class="label">Today vs Smart Drop-off</div>' +
          '<table class="compare"><tr><th></th><th>Today</th><th>Smart</th></tr>' +
          '<tr><td>Drop-off</td><td>N3, across the highway</td><td>' + (good ? 'Canteen gate' : 'Logged as wrong drop-off') + '</td></tr>' +
          '<tr><td>Walk</td><td>~' + r10(overbridgeWalk()) + ' m via overbridge</td><td>' + Math.round(w) + ' m</td></tr>' +
          '<tr><td>Rider cost</td><td>—</td><td>+52 m, ~40 s</td></tr>' +
          '<tr><td>Next trip</td><td>Same problem</td><td>' + (S.save || S.usedSaved ? 'Gate saved, no question' : 'Asked again') + '</td></tr></table>' +
          '<button class="primary" type="button" data-act="restart">Run it again</button>' +
          '<button class="ghost" type="button" data-act="toToday">Compare with today\'s app</button>'
      };
    }
  };

  /* ---------- steps ---------- */
  var STEPS = {
    smart: [['home', 'Pick Office'], ['confirm', 'Confirm the drop-off gate (once)'], ['ride', 'Ride details show the gate'], ['matched', 'Rider sees the gate before accepting'], ['trip', 'Trip with turn guidance'], ['arrived', 'Arrive + 1-tap feedback']],
    today: [['home', 'Pick Office'], ['ride', 'Ride details (pin on expressway)'], ['matched', 'Rider assigned'], ['trip', 'Trip'], ['arrived', 'Dropped on the highway']]
  };
  var STEP_ALIAS = { searching: 'matched', rogue: 'trip' };
  function renderSteps() {
    var list = STEPS[S.mode], cur = STEP_ALIAS[S.step] || S.step;
    var idx = list.findIndex(function (s) { return s[0] === cur; });
    if (S.mode === 'smart' && S.usedSaved && cur !== 'home' && cur !== 'confirm') {
      list = list.map(function (s) { return s[0] === 'confirm' ? ['confirm', 'Gate already saved, skipped'] : s; });
    }
    $('#steps').innerHTML = list.map(function (s, i) {
      return '<li class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '">' + s[1] + '</li>';
    }).join('');
  }

  /* ---------- render ---------- */
  function render() {
    document.body.dataset.mode = S.mode;
    document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)); });
    $('#modeEyebrow').textContent = S.mode === 'smart' ? 'With Smart Drop-off' : "Today's app";
    var v = screens[S.step]();
    $('#topbar').innerHTML = v.top;
    $('#sheet').innerHTML = v.sheet;
    renderSteps();
    renderLog();
    drawMap();
  }
  function go(step) { S.step = step; render(); $('#sheet').scrollTop = 0; }

  function toast(html, ms) {
    var t = $('#toast');
    t.innerHTML = html; t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }

  /* ---------- trip animation ---------- */
  var anim = null;
  function stopAnim() { if (anim) clearTimeout(anim.raf); anim = null; }
  function runPath(path, onEnd, fromD) {
    stopAnim();
    anim = { path: path, cum: cumulative(path), d: fromD || 0, onEnd: onEnd, last: performance.now(), raf: 0 };
    anim.total = anim.cum[anim.cum.length - 1];
    if (!bike) bike = L.marker(path[0], { icon: bikeIcon, zIndexOffset: 2000 });
    bikeLayer.clearLayers(); bike.addTo(bikeLayer);
    var tick = function () {
      if (!anim) return;
      var now = performance.now();
      anim.d = Math.min(anim.total, anim.d + (now - anim.last) / MS_PER_M);
      anim.last = now;
      bike.setLatLng(pointAt(anim.path, anim.cum, anim.d));
      tripUI();
      if (anim.d >= anim.total) { var cb = anim.onEnd; anim = null; cb(); }
      else anim.raf = setTimeout(tick, 33);
    };
    anim.raf = setTimeout(tick, 33);
  }
  function tripUI() {
    if (!anim) return;
    var prog = $('#prog'), txt = $('#nextTxt'), ar = $('#nextAr'), btn = $('#rogueBtn');
    if (prog) prog.style.width = (anim.d / anim.total * 100).toFixed(1) + '%';
    if (!txt) return;
    var smart = S.mode === 'smart', dp = drop(), left = anim.total - anim.d;
    var turnD = cumulative(D.routeSmart.path)[TURN_IDX];
    if (smart && dp.kind === 'dohs' && !S.rogue && anim.d < turnD) {
      var toTurn = turnD - anim.d;
      ar.textContent = '↰';
      txt.innerHTML = '<b>Left onto Baridhara DOHS Main Road in ' + mfmt(r10(toTurn)) + '</b><br>Rider gets the same prompt in Bangla';
    } else if (smart && !S.rogue) {
      ar.textContent = '↑';
      txt.innerHTML = '<b>' + mfmt(r10(left)) + ' to ' + dp.en + '</b><br>Off the highway now';
      if (btn) btn.remove();
    } else if (S.detour) {
      ar.textContent = '↻';
      txt.innerHTML = '<b>Re-routed: ' + mfmt(r10(left)) + ' to your gate</b><br>Detour because the turn was missed';
    } else if (S.rogue && S.step === 'trip') {
      ar.textContent = '↑';
      txt.innerHTML = '<b>Rider stayed on N3</b><br>Heading past the turn…';
      if (btn) btn.remove();
    } else {
      ar.textContent = '↑';
      txt.innerHTML = '<b>' + mfmt(r10(left)) + ' to POL Depo Ca…antonment</b><br>Staying on New Airport Road (N3)';
    }
  }
  function startTrip() {
    S.rogue = false; S.detour = false; S.end = null;
    go('trip');
    var dp = drop();
    log('info', '<b>Trip started.</b> Route ' + (S.mode === 'smart' ? 'to ' + dp.en : 'to the map pin') + ': ' + mfmt(S.mode === 'smart' && dp.kind === 'dohs' ? D.routeSmart.m : D.routeToday.m) + '.');
    runPath(routeFor(dp), arrive);
  }
  function arrive() {
    var smart = S.mode === 'smart', dp = drop();
    if (!smart) {
      log('bad', '<b>Trip ended on N3</b>, 89 m from the canteen across a divided highway. Nothing records it as a wrong drop-off: the rider reached the pin\'s "nearest legal road".');
    } else {
      var end = S.end || dp.pt;
      var err = Math.round(dist(end, dp.pt));
      log(err <= END_LIMIT_M ? 'ok' : 'warn', '<b>Trip ended ' + err + ' m from the confirmed drop-off.</b> Logged as drop-off error <code>' + err + ' m</code>, the primary success metric.');
    }
    go('arrived');
  }

  /* ---------- rider overlay ---------- */
  var raMap = null;
  function openRider() {
    var dp = drop(), ov = $('#overlay');
    var notes = S.notes.map(function (k) { return NOTES[k][1]; }).join(' · ');
    var isGate = dp.kind === 'dohs';
    ov.innerHTML =
      '<div class="ra-top"><span>রাইডার অ্যাপ · Rider app</span><button type="button" data-act="closeRider">Close ✕</button></div>' +
      '<div class="ra-map" id="raMap"></div>' +
      '<div class="ra-body">' +
        '<span class="ra-tag">নতুন রাইড · New ride request</span>' +
        '<div class="ra-card gate"><div class="t">ড্রপ-অফ · Drop-off ' + (isGate ? 'gate' : 'point') + '</div>' + dp.bn + '<small>' + dp.en + '</small></div>' +
        (isGate ? '<div class="ra-card"><div class="t">মোড় · The turn</div>↰ N3 থেকে বামে ঘুরে বারিধারা ডিওএইচএস মেইন রোডে ঢুকুন<small>Turn left off N3 into Baridhara DOHS Main Road. Only +52 m.</small></div>' : '') +
        '<div class="ra-card warn"><div class="t">সতর্কতা · Heads-up</div>এক্সপ্রেসওয়ে বা N3-তে যাত্রী নামাবেন না<small>Don\'t drop the passenger on the expressway or N3.</small></div>' +
        (notes ? '<div class="ra-card"><div class="t">যাত্রীর নোট · Passenger note</div>' + notes + '</div>' : '') +
        '<button class="ra-accept" type="button" data-act="closeRider">গেট দেখেছি · গ্রহণ করুন<small>Gate seen · Accept</small></button>' +
      '</div>';
    ov.hidden = false;
    raMap = L.map('raMap', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(raMap);
    var path = routeFor(dp);
    var tail = isGate ? path.slice(TURN_IDX - 6) : path.slice(-10);
    L.polyline(tail, { color: '#34d399', weight: 6 }).addTo(raMap);
    L.marker(dp.pt, { icon: dotIcon(isGate ? '#34d399' : '#f59e0b', '✓', true) }).addTo(raMap);
    if (isGate) L.marker(D.routeSmart.path[TURN_IDX], { icon: dotIcon('#facc15', '↰') }).addTo(raMap);
    L.marker(D.n3Stop, { icon: dotIcon('#ef4444', '✕') }).addTo(raMap);
    setTimeout(function () { raMap.invalidateSize(); raMap.fitBounds(L.latLngBounds(tail.concat([D.n3Stop])), { padding: [24, 24] }); }, 30);
    log('info', '<b>Rider app received:</b> gate pin, the left turn off N3, a no-highway warning and your note in Bangla. Accepting = "gate seen".');
  }
  function closeRider() {
    $('#overlay').hidden = true;
    if (raMap) { raMap.remove(); raMap = null; }
  }

  /* ---------- actions ---------- */
  function restart() {
    stopAnim(); closeRider(); bikeLayer.clearLayers(); bike = null;
    S.step = 'home'; S.choice = 'gate'; S.custom = null; S.notes = ['enter', 'gate']; S.save = true;
    S.usedSaved = false; S.feedback = null; S.end = null; S.rogue = false; S.detour = false; S.log = [];
    $('#toast').hidden = true;
    render();
  }
  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m;
    try { history.replaceState(null, '', m === 'today' ? '#today' : '#smart'); } catch (e) { location.hash = m; }
    restart();
  }

  var actions = {
    office: function () {
      log('info', '<b>Geocoded</b> "POL Depo Canteen Noya Kutum Bari" → <code>23.81661, 90.41308</code>');
      if (S.mode === 'today') {
        log('bad', '<b>Today\'s rule: snap the pin to the nearest road line.</b> The expressway deck (18 m) and the canteen\'s road (17 m) are the same line on a flat map. The pin lands on the expressway.' + candidatesTable(false));
        log('bad', '<b>Rider navigation:</b> the expressway is closed to motorcycles, so the route ends at the nearest legal road, <b>N3</b>, on the far side.');
        return go('ride');
      }
      log('ok', '<b>Smart rule: ignore roads where a bike can\'t stop.</b> Elevated, ramp and no-motorcycle roads are filtered out first.' + candidatesTable(true));
      if (S.saved) {
        S.choice = S.saved.choice; S.custom = S.saved.custom || null; S.notes = S.saved.notes || []; S.usedSaved = true;
        log('ok', '<b>Saved Office drop-off found:</b> ' + drop().en + '. No question asked this time.');
        return go('ride');
      }
      log('warn', '<b>Pin is on a no-stop road,</b> so we ask the passenger once to confirm the gate.');
      go('confirm');
    },
    back: function () {
      stopAnim();
      if (S.step === 'confirm') return go('home');
      if (S.step === 'ride') return go(S.mode === 'smart' && !S.usedSaved ? 'confirm' : 'home');
      go('home');
    },
    change: function () { S.usedSaved = false; go('confirm'); },
    save: function (el) { S.save = el.checked; },
    confirm: function () {
      var dp = drop();
      if (!dp) return;
      if (S.save) {
        S.saved = { choice: S.choice, custom: S.custom, notes: S.notes.slice() };
        storeSaved(S.saved);
      }
      log(dp.kind === 'dohs' ? 'ok' : 'warn', '<b>Passenger confirmed:</b> ' + dp.en + ' (' + Math.round(walkM(dp.pt)) + ' m walk).' + (S.save ? ' Saved to place <code>Office</code> for future trips.' : '') + (S.notes.length ? ' Note queued in Bangla.' : ''));
      go('ride');
    },
    book: function () {
      go('searching');
      setTimeout(function () {
        if (S.step !== 'searching') return;
        if (S.mode === 'smart') log('ok', '<b>Dispatch:</b> the drop-off gate is part of the ride offer, so the rider accepts knowing exactly where to stop.');
        go('matched');
      }, 1600);
    },
    peek: openRider,
    closeRider: closeRider,
    start: startTrip,
    rogue: function () {
      if (!anim || anim.d >= cumulative(D.routeSmart.path)[TURN_IDX]) return;
      S.rogue = true;
      var d = anim.d;
      log('warn', '<b>Demo:</b> rider ignores the turn prompt and stays on N3.');
      runPath(D.routeToday.path, function () {
        S.end = D.n3Stop;
        log('warn', '<b>Rider tried to end the trip ' + Math.round(dist(D.n3Stop, drop().pt)) + ' m from the confirmed gate</b> (limit ' + END_LIMIT_M + ' m), so the passenger is asked before the trip can end.');
        go('rogue');
        bike.addTo(bikeLayer).setLatLng(D.n3Stop);
      }, d);
      tripUI();
    },
    continue: function () {
      toast('Karim was asked to continue to your gate.<span class="bn">যাত্রী গেট পর্যন্ত যেতে অনুরোধ করেছেন</span>');
      log('info', '<b>Passenger asked the rider to continue.</b> The rider gets a Bangla prompt and a re-route: ' + mfmt(D.routeDetour.m) + ' because the turn was missed.');
      S.end = null; S.detour = true;
      go('trip');
      runPath(D.routeDetour.path, arrive);
    },
    endhere: function () {
      log('warn', '<b>Passenger accepted ending on N3.</b> Logged as a wrong drop-off. This rider gets a coaching nudge.');
      S.end = D.n3Stop;
      arrive();
    },
    restart: function () { restart(); },
    toSmart: function () { setMode('smart'); },
    toToday: function () { setMode('today'); }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (b && b.tagName !== 'INPUT') { e.preventDefault(); if (actions[b.dataset.act]) actions[b.dataset.act](b); return; }
    var n = e.target.closest('[data-note]');
    if (n) {
      var k = n.dataset.note, i = S.notes.indexOf(k);
      if (i > -1) S.notes.splice(i, 1); else S.notes.push(k);
      var keepScroll = $('#sheet').scrollTop;
      $('#sheet').innerHTML = screens[S.step]().sheet;
      $('#sheet').scrollTop = keepScroll;
      return;
    }
    var f = e.target.closest('[data-fb]');
    if (f) {
      S.feedback = f.dataset.fb;
      log(S.feedback === 'yes' ? 'ok' : 'warn', '<b>Feedback:</b> passenger said the spot was ' + (S.feedback === 'yes' ? 'right. +1 confirmation for this gate.' : 'wrong. Gate flagged for review.'));
      var ks = $('#sheet').scrollTop;
      $('#sheet').innerHTML = screens.arrived().sheet;
      $('#sheet').scrollTop = ks;
      return;
    }
    var m = e.target.closest('.seg button');
    if (m) setMode(m.dataset.mode);
  });
  document.addEventListener('change', function (e) {
    if (e.target.name === 'drop') {
      S.choice = e.target.value;
      if (S.choice === 'custom' && !S.custom) { var p0 = [23.81652, 90.41318]; S.custom = classify(p0); S.custom.raw = p0; }
      if (S.choice === 'n3') log('warn', '<b>Passenger picked N3.</b> Allowed, and shown honestly: a highway crossing.');
      render();
    } else if (e.target.dataset.act === 'save') {
      S.save = e.target.checked;
    }
  });
  $('#restart').addEventListener('click', function () { restart(); });
  $('#resetAll').addEventListener('click', function () { S.saved = null; storeSaved(null); restart(); toast('Saved gate cleared. The confirm step will show again.'); });
  window.addEventListener('resize', function () { map.invalidateSize(); });
  map.on('click', function (e) { if (S.step === 'confirm' && S.choice === 'custom') setCustom(e.latlng); });
  window.__sd = { setCustom: function (lat, lng) { setCustom(L.latLng(lat, lng)); }, state: S };

  render();
})();
