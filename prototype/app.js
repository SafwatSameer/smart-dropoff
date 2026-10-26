/* Smart Drop-off — clickable prototype.
   Roads, distances and routes come from data.js (OpenStreetMap + OSRM, fetched 27 Oct 2026). */
(function () {
  'use strict';
  var D = window.SD_DATA;
  var $ = function (s) { return document.querySelector(s); };
  var MS_PER_M = 8.5;             // trip animation speed (~12 s for the whole ride)
  var TIP_EXAMPLE = 'Take the small road under the expressway. The canteen is on the left.';

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
  function cumulative(path) {
    var c = [0];
    for (var i = 1; i < path.length; i++) c.push(c[i - 1] + dist(path[i - 1], path[i]));
    return c;
  }
  function pointAt(path, cum, d) {
    for (var i = 1; i < path.length; i++) {
      if (cum[i] >= d) {
        var seg = cum[i] - cum[i - 1], t = seg ? (d - cum[i - 1]) / seg : 0;
        return { pt: [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t], i: i };
      }
    }
    return { pt: path[path.length - 1], i: path.length - 1 };
  }
  var ll = function (p) { return [p[1], p[0]]; };

  /* The Smart rule: a drop-off goes on the nearest road where a bike can stop.
     Expressways / ramps (motorcycles banned) are never used. Highways are allowed with a rider reminder. */
  function classify(p) {
    var near = 22;
    var road = nearestOn(D.roads.dohsBypass, p);
    var hw = nearestOn(D.roads.n3, p);
    var exp = [nearestOn(D.roads.expressway, p), nearestOn(D.roads.expresswayRamp, p)].sort(function (a, b) { return a.d - b.d; })[0];
    var out;
    if (road.d <= near) out = { level: 'ok', kind: 'road', snap: road.pt, tag: '✓ Bikes can stop here', msg: 'On the road under the expressway. A few steps to the canteen.' };
    else if (hw.d <= near) out = { level: 'warn', kind: 'hw', snap: hw.pt, tag: '! Highway', msg: 'This is on the highway. Your rider will be reminded to pull over safely.' };
    else if (exp.d <= near) return { level: 'bad', kind: 'exp', snap: null, tag: '✕ Expressway: no bikes', msg: 'Bikes can\'t go on the expressway. Move the map to the road below it.' };
    else {
      var to = road.d <= hw.d ? road : hw;
      out = road.d <= hw.d
        ? { level: 'ok', kind: 'road', snap: to.pt, tag: '✓ Nearest road', msg: 'Not on a road, so your rider will stop on the nearest road, under the expressway.' }
        : { level: 'warn', kind: 'hw', snap: to.pt, tag: '! Highway', msg: 'Nearest road is the highway. Your rider will be reminded to pull over safely.' };
    }
    if (dist(out.snap, D.canteen) > 150) return { level: 'bad', kind: 'far', snap: null, tag: '✕ Too far', msg: 'That\'s too far from the canteen. Move the map closer.' };
    return out;
  }
  function spotFrom(c, source) {
    var gate = dist(c.snap, D.gate) < 12;
    if (c.kind === 'road') return { pt: gate ? D.gate : c.snap, kind: 'road', source: source,
      en: gate ? 'Canteen gate' : 'Your spot', desc: 'Road under the expressway', bn: gate ? 'ক্যান্টিন গেট' : 'যাত্রীর বেছে নেওয়া জায়গা', bnDesc: 'এক্সপ্রেসওয়ের নিচের রাস্তা' };
    return { pt: c.snap, kind: 'hw', source: source, en: 'Your spot', desc: 'On the highway', bn: 'যাত্রীর বেছে নেওয়া জায়গা', bnDesc: 'হাইওয়ের উপর' };
  }
  var AUTO_SPOT = spotFrom({ kind: 'road', snap: D.gate }, 'auto');

  /* ---------- state ---------- */
  function load() { try { return JSON.parse(localStorage.getItem('sd2-saved') || 'null'); } catch (e) { return null; } }
  // ?fresh = demo link: forget any saved spot so the walkthrough always starts clean
  if (/[?&]fresh\b/.test(location.search)) { try { localStorage.removeItem('sd2-saved'); } catch (e) { /* private mode */ } }
  function store(v) { try { if (v) localStorage.setItem('sd2-saved', JSON.stringify(v)); else localStorage.removeItem('sd2-saved'); } catch (e) { /* private mode */ } }
  var S = {
    mode: /today/.test(location.hash) ? 'today' : 'smart',
    step: 'home', saved: load(), spot: AUTO_SPOT, tip: '', remember: true, usedSaved: false,
    pick: null, feedback: null, log: [], unread: 0
  };

  /* ---------- behind the scenes ---------- */
  function log(kind, html) {
    S.log.push({ kind: kind, html: html });
    if ($('#drawer-scenes').hidden) S.unread++;
    renderLog();
  }
  function renderLog() {
    $('#rule').innerHTML = S.mode === 'smart'
      ? '<b>Smart rule:</b> end the route on the nearest road where a bike can stop. Skip expressways and roads closed to bikes. Send the spot and the passenger\'s tip to the rider with the ride request.'
      : '<b>Today\'s rule:</b> end the route on the road line nearest to the pin. Here that line is the expressway, right above the canteen\'s road. The pin is correct; the route is not.';
    $('#log').innerHTML = S.log.length
      ? S.log.map(function (l) { return '<li class="' + l.kind + '">' + l.html + '</li>'; }).join('')
      : '<li class="empty">Tap <b>Where to?</b> on the phone to start. Each decision the app makes will show up here.</li>';
    var b = $('#badge');
    b.hidden = !S.unread; b.textContent = S.unread;
  }

  /* ---------- map ---------- */
  var ready = false, markers = [], bikeMarker = null;
  var map = new maplibregl.Map({
    container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
    center: ll(D.canteen), zoom: 15, attributionControl: { compact: true },
    dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0
  });
  map.touchZoomRotate.disableRotation();
  var EMPTY = { type: 'FeatureCollection', features: [] };
  function line(coords) { return coords && coords.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords.map(ll) } } : EMPTY; }
  function setLine(id, coords) { if (ready) map.getSource(id).setData(line(coords)); }

  map.once('style.load', function () {
    // Cleaner map: English labels, no shop/place icons, no house numbers.
    map.getStyle().layers.forEach(function (l) {
      if (l.type !== 'symbol') return;
      var src = l['source-layer'] || '';
      if (src === 'poi' || src === 'housenumber' || src === 'aerodrome_label' || src === 'mountain_peak') { map.setLayoutProperty(l.id, 'visibility', 'none'); return; }
      if (l.layout && l.layout['text-field']) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']]);
    });
    ['route', 'trail', 'walk', 'nostop'].forEach(function (id) { map.addSource(id, { type: 'geojson', data: EMPTY }); });
    map.addLayer({ id: 'nostop', type: 'line', source: 'nostop', paint: { 'line-color': '#e0343f', 'line-width': 5, 'line-opacity': .45, 'line-dasharray': [1, 1.2] } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0e9f6e', 'line-width': 5 } });
    map.addLayer({ id: 'trail', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#94a3b8', 'line-width': 5 } });
    map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#0e9f6e', 'line-width': 3, 'line-dasharray': [1, 1.6] } });
    var at = document.querySelector('.maplibregl-ctrl-attrib');
    if (at) at.classList.remove('maplibregl-compact-show');
    ready = true;
    drawMap();
  });

  function el(cls, html) { var e = document.createElement('div'); e.className = cls; e.innerHTML = html || ''; return e; }
  function addMarker(e, pt, anchor) {
    // pins: the rotated square tip sticks ~6px below its box, so lift it to sit exactly on the point
    var m = new maplibregl.Marker({ element: e, anchor: anchor || 'center', offset: anchor === 'bottom' ? [0, -6] : [0, 0] }).setLngLat(ll(pt)).addTo(map);
    markers.push(m); return m;
  }
  function clearMarkers() { markers.forEach(function (m) { m.remove(); }); markers = []; }
  function pin(color, tag, cls, faded) { return el('mk' + (faded ? ' faded' : ''), '<div class="pin" style="--c:' + color + '"></div>' + (tag ? '<div class="tag ' + (cls || '') + '">' + tag + '</div>' : '')); }
  function poi() { return el('poi', '<i></i><span>POL Depo Canteen</span>'); }
  var BIKE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5L9 10h5l4.5 6.5M14 10l1.5-3H18"/></svg>';

  function sheetH() { return $('#sheet').offsetHeight; }
  function fit(points, maxZoom) {
    if (!ready) return;
    var b = new maplibregl.LngLatBounds();
    points.forEach(function (p) { b.extend(ll(p)); });
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    map.fitBounds(b, { padding: { top: 120, bottom: sheetH() + 64, left: 56, right: 56 }, maxZoom: maxZoom || 16.8, duration: 650 });
  }

  function routeFor() {
    if (S.mode === 'today') return D.routeToday.path;
    var base = S.spot.kind === 'road' ? D.routeSmart.path : D.routeToday.path;
    var last = base[base.length - 1];
    return dist(last, S.spot.pt) < 3 ? base : base.concat([S.spot.pt]);
  }
  // a point on the expressway ~70 m north-east of the canteen, so the label fits a close-up view
  var EXP_LABEL = (function () {
    var path = D.roads.expressway, cum = cumulative(path), best = path[0], bd = Infinity;
    for (var s = 0; s < cum[cum.length - 1]; s += 5) {
      var p = pointAt(path, cum, s).pt;
      if (p[0] < D.canteen[0]) continue;
      var e = Math.abs(dist(p, D.canteen) - 70);
      if (e < bd) { bd = e; best = p; }
    }
    return best;
  })();
  function expLabelPoint() { return EXP_LABEL; }

  function drawMap() {
    if (!ready) return;
    var st = S.step, smart = S.mode === 'smart';
    clearMarkers();
    if (st !== 'trip' && bikeMarker) { bikeMarker.remove(); bikeMarker = null; }
    setLine('trail', null); setLine('walk', null); setLine('nostop', null);
    $('#centerpin').hidden = st !== 'pick';
    map.dragPan[st === 'trip' ? 'disable' : 'enable']();

    if (st === 'home' || st === 'lookup') {
      setLine('route', null);
      addMarker(el('me'), D.start);
      addMarker(poi(), D.canteen, 'left');
      return fit([D.start, D.canteen], 15.3);
    }
    if (st === 'spot') {
      setLine('route', null);
      setLine('nostop', D.roads.expressway);
      addMarker(el('roadtag', 'Expressway · no bikes'), expLabelPoint());
      addMarker(pin('#0f172a', 'Your pin', 'rside'), D.canteen, 'bottom');
      addMarker(pin(S.spot.kind === 'road' ? '#0e9f6e' : '#d97706', 'Rider stops here', S.spot.kind === 'road' ? 'good' : ''), S.spot.pt, 'bottom');
      setLine('walk', [S.spot.pt, D.canteen]);
      return fit([S.spot.pt, D.canteen, expLabelPoint()], 18.2);
    }
    if (st === 'pick') {
      setLine('route', null);
      setLine('nostop', D.roads.expressway);
      addMarker(el('roadtag', 'Expressway · no bikes'), expLabelPoint());
      addMarker(poi(), D.canteen, 'left');
      placeCenterPin();
      map.easeTo({ center: ll(S.spot.pt), zoom: 17.4, padding: { top: 0, bottom: sheetH(), left: 0, right: 0 }, duration: 500 });
      return;
    }

    var path = routeFor();
    map.setPaintProperty('route', 'line-color', smart ? '#0e9f6e' : '#0f172a');
    setLine('route', path);
    if (smart) {
      addMarker(poi(), D.canteen, 'left');
      if (st !== 'done') addMarker(pin(S.spot.kind === 'road' ? '#0e9f6e' : '#d97706', S.spot.en, 'good'), S.spot.pt, 'bottom');
    } else {
      addMarker(pin('#e0343f', 'Your pin: POL Depo Canteen'), D.canteen, 'bottom');
    }

    if (st === 'trip') return; // camera follows the bike
    if (st === 'done') {
      setLine('route', null);
      if (smart) {
        setLine('walk', [S.spot.pt, D.canteen]);
        addMarker(el('bike', BIKE), S.spot.pt);
        return fit([S.spot.pt, D.canteen], 17.6);
      }
      setLine('nostop', D.roads.expressway);
      map.setPaintProperty('walk', 'line-color', '#e0343f');
      setLine('walk', [D.n3Stop, D.canteen]);
      addMarker(el('mk', '<div class="x">✕</div><div class="tag bad">You are here</div>'), D.n3Stop, 'center');
      return fit([D.n3Stop, D.canteen], 17.6);
    }
    map.setPaintProperty('walk', 'line-color', '#0e9f6e');
    addMarker(el('me'), D.start);
    fit(path.concat([D.start]), 16.2);
  }

  /* move-the-map picker */
  function placeCenterPin() {
    var cp = $('#centerpin'), scr = $('.screen');
    cp.style.top = ((scr.offsetHeight - sheetH()) / 2 + 9) + 'px';
  }
  var pickQueued = false;
  map.on('move', function () {
    if (S.step !== 'pick' || pickQueued) return;
    pickQueued = true;
    setTimeout(function () { pickQueued = false; updatePick(); }, 60);
  });
  map.on('moveend', function () { if (S.step === 'pick') updatePick(); });
  function updatePick() {
    var c = map.getCenter();
    S.pick = classify([c.lat, c.lng]);
    var tag = $('#cpTag');
    tag.textContent = S.pick.tag;
    tag.className = 'cp-tag ' + S.pick.level;
    var m = $('#pickMsg'), b = $('#pickBtn');
    if (m) { m.textContent = S.pick.msg; m.className = 'sub'; }
    if (b) b.disabled = !S.pick.snap;
  }

  /* ---------- screens ---------- */
  var I = {
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    office: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 21V5l8-3v19M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20"/></svg>',
    fork: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 2v8a2 2 0 002 2v10M11 2v8a2 2 0 01-2 2M17 2c-1.5 0-3 2-3 6s1.5 5 3 5v9"/></svg>',
    home: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v10H3z"/><path d="M9 21v-6h6v6"/></svg>',
    bike: '<svg width="40" height="28" viewBox="0 0 46 34" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="24" r="7" stroke="#0f172a" stroke-width="3"/><circle cx="36" cy="24" r="7" stroke="#0f172a" stroke-width="3"/><path d="M10 24l7-11h11l8 11M28 13l3-6h5" stroke="#e0343f" stroke-width="3"/></svg>'
  };
  function top(back, sub, title) {
    return (back ? '<button class="back" type="button" data-act="back" aria-label="Back">' + I.back + '</button>' : '') +
      (title ? '<div class="dest"><small>' + sub + '</small><b>' + title + '</b></div>' : '');
  }
  function tipbox() {
    return '<div class="tipbox"><div class="tl"><label for="tip">Tip for your rider <span>(optional)</span></label>' +
      (S.tip ? '' : '<button type="button" class="example" data-act="example">Use example</button>') + '</div>' +
      '<textarea id="tip" maxlength="120" placeholder="Which road, which gate, a landmark…">' + esc(S.tip) + '</textarea></div>' +
      '<label class="remember"><input type="checkbox" id="remember"' + (S.remember ? ' checked' : '') + '>Remember spot and tip for my next trips</label>';
  }
  function results() {
    var q = (S.q || '').trim().toLowerCase();
    var hit = !q || ['pol', 'depo', 'canteen', 'noya', 'kutum', 'bari', 'cantonment'].some(function (w) { return w.indexOf(q) === 0 || q.indexOf(w) > -1; });
    if (!hit) return '<p class="sub" style="margin-top:12px">No results. Try "POL Depo".</p>';
    var saved = S.mode === 'smart' && S.saved;
    return '<div class="lbl">' + (q ? 'Results' : 'Suggested') + '</div>' +
      '<button class="place attn" type="button" data-act="place"><span class="pi">' + I.fork + '</span><span class="grow"><b>POL Depo Canteen Noya Kutum Bari</b><small>Restaurant · Dhaka Cantonment</small></span>' +
      (saved ? '<span class="chip ok">✓ Spot' + (S.saved.tip ? ' & tip' : '') + ' saved</span>' : '<span class="tapme">Tap</span>') + '</button>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var screens = {
    home: function () {
      var saved = S.mode === 'smart' && S.saved;
      return { top: '', sheet: '<div class="grab"></div><h3>Good morning</h3>' +
        '<button class="search attn" type="button" data-act="search">' + I.search + '<span class="grow">Where to?</span><span class="tapme">Tap</span></button>' +
        (saved ? '<p class="sub" style="margin:10px 2px 0">✓ Your drop-off spot' + (S.saved.tip ? ' and tip' : '') + ' for POL Depo Canteen are saved.</p>' : '') };
    },

    lookup: function () {
      var saved = S.mode === 'smart' && S.saved;
      return { top: top(true, 'Where to?', 'Search a place'),
        sheet: '<div class="grab"></div>' +
          '<label class="searchbox">' + I.search + '<input id="q" type="search" autocomplete="off" placeholder="Search a place" value="' + esc(S.q || '') + '" aria-label="Search a place"></label>' +
          '<div id="results">' + results() + '</div>' };
    },

    spot: function () {
      var auto = S.spot.source === 'auto';
      var hw = S.spot.kind === 'hw';
      if (auto) return {
        top: top(true, 'Drop-off for', 'POL Depo Canteen Noya Kutum Bari'),
        sheet: '<div class="grab"></div>' +
          '<h3>Your rider will stop at the canteen gate</h3>' +
          '<p class="sub">Your pin is right. But the nearest road is the expressway above, and bikes can\'t use it. So the ride ends on the road below, at the gate.</p>' +
          tipbox() +
          '<button class="btn" type="button" data-act="confirm">Confirm drop-off</button>' +
          '<button class="linkbtn" type="button" data-act="pick">Choose another spot</button>'
      };
      return {
        top: top(true, 'Drop-off for', 'POL Depo Canteen Noya Kutum Bari'),
        sheet: '<div class="grab"></div>' +
          '<h3>' + (auto ? 'Drop-off moved to the canteen gate' : 'Drop-off: ' + S.spot.en) + '</h3>' +
          '<p class="sub">' + (hw ? 'This spot is on the highway. Your rider will be reminded to pull over safely.'
            : 'On the road under the expressway. Bikes can stop here.') + '</p>' +
          tipbox() +
          '<button class="btn" type="button" data-act="confirm">Confirm drop-off</button>' +
          '<button class="linkbtn" type="button" data-act="pick">Choose another spot</button>'
      };
    },

    pick: function () {
      return {
        top: top(true, 'Move the map', 'Put the pin where you want to get off'),
        sheet: '<div class="grab"></div><h3>Set your drop-off spot</h3>' +
          '<p class="sub" id="pickMsg">Move the map under the pin.</p>' +
          '<button class="btn" type="button" id="pickBtn" data-act="setpick">Use this spot</button>' +
          '<button class="linkbtn" type="button" data-act="cancelpick">Cancel</button>'
      };
    },

    ride: function () {
      var smart = S.mode === 'smart';
      var rows = smart
        ? '<div class="row"><span class="ri good">✓</span><span class="grow"><b>Drop-off: ' + S.spot.en + '</b><small>' + S.spot.desc + (S.usedSaved ? ' · saved' : '') + '</small></span><button class="act" type="button" data-act="edit">Edit</button></div>' +
          (S.tip ? '<div class="row"><span class="ri">💬</span><span class="grow"><b>Tip for rider</b><small>' + esc(S.tip) + '</small></span></div>' : '')
        : '<div class="row"><span class="ri">📍</span><span class="grow"><b>Drop-off: POL Depo Canteen</b><small>Pin placed on the canteen</small></span></div>';
      return {
        top: top(true, 'Reach in ~8 mins', smart ? S.spot.en + ' · POL Depo Canteen' : 'POL Depo Canteen Noya Kutum Bari'),
        sheet: '<div class="grab"></div><h3>Choose a ride</h3>' +
          '<div class="ride">' + I.bike + '<span class="grow"><b>Bike</b><small>Quick and affordable</small></span><span class="fare">৳136</span></div>' +
          '<div class="rows">' + rows + '<div class="row"><span class="ri">৳</span><span class="grow"><b>Cash</b></span></div></div>' +
          '<button class="btn" type="button" data-act="book">Choose Bike</button>'
      };
    },

    search: function () {
      return { top: '', sheet: '<div class="grab"></div><div class="spinner" role="img" aria-label="Searching"></div><p class="center"><b>Finding a rider…</b></p>' +
        (S.mode === 'smart' ? '<p class="sub center">Riders see your drop-off spot' + (S.tip ? ' and tip' : '') + ' before they accept.</p>' : '') };
    },

    found: function () {
      var smart = S.mode === 'smart';
      return {
        top: top(false, 'Rider found', smart ? S.spot.en + ' · POL Depo Canteen' : 'POL Depo Canteen Noya Kutum Bari'),
        sheet: '<div class="grab"></div>' +
          '<div class="driver"><div class="avatar">K</div><div class="grow"><b>Karim</b> <span style="color:#f59e0b">★</span> 4.9<small>Bike · DHAKA METRO-HA 12-3456</small></div><div class="eta">2 min<small>away</small></div></div>' +
          (smart ? '<div class="note good" style="margin-top:12px"><span class="ni">✓</span><span>Karim got your drop-off spot' + (S.tip ? ' and tip' : '') + ' with the ride request.</span></div>' +
                   '<button class="btn ghost" type="button" data-act="rider">See Karim\'s screen</button>' : '') +
          '<button class="btn" type="button" data-act="start">Start ride</button>' +
          '<p class="sub center" style="margin:8px 0 0">Demo skips the pickup.</p>'
      };
    },

    trip: function () {
      var smart = S.mode === 'smart';
      return {
        top: top(false, 'On trip with Karim', smart ? S.spot.en + ' · POL Depo Canteen' : 'POL Depo Canteen Noya Kutum Bari'),
        sheet: '<div class="grab"></div><h3>On the way</h3>' +
          '<div class="progress"><i id="prog"></i></div>' +
          '<div class="trip-line"><span id="tripLeft">Starting…</span><b id="tripEta"></b></div>'
      };
    },

    done: function () {
      var smart = S.mode === 'smart';
      if (!smart) {
        return {
          top: top(false, 'Trip complete', 'POL Depo Canteen Noya Kutum Bari'),
          sheet: '<div class="grab"></div><h3>You have arrived</h3>' +
            '<p class="sub">That\'s what the app says. Your pin was exactly on the canteen, but you\'re on the highway, across the road.</p>' +
            '<div class="vs"><div class="t"><b>Today</b>Pin right, ride ends on the highway. Rider had to call.</div><div class="s"><b>Smart Drop-off</b>Ride ends at the gate. Your tip shows the way.</div></div>' +
            '<button class="btn" type="button" data-act="toSmart" style="background:var(--good)">See the fix →</button>'
        };
      }
      var hw = S.spot.kind === 'hw';
      var savedLine = S.remember && !S.usedSaved ? '<div class="note good" style="margin-top:10px"><span class="ni">★</span><span>Saved for next time: your spot' + (S.tip ? ' and tip' : '') + '. You won\'t be asked again.</span></div>' : '';
      return {
        top: top(false, 'Trip complete', S.spot.en + ' · POL Depo Canteen'),
        sheet: '<div class="grab"></div><div class="big-ok">✓</div>' +
          '<h3>' + (hw ? 'You\'re at your spot' : 'You\'re at the canteen gate') + '</h3>' +
          '<p class="sub">' + (hw ? 'On the highway, as you chose.' : 'A few steps to the canteen. No road to cross.') + '</p>' +
          '<div class="lbl" style="margin-top:4px">Was this the right spot?</div>' +
          '<div class="thumbs"><button type="button" data-fb="yes" aria-pressed="' + (S.feedback === 'yes') + '">👍 Yes</button><button type="button" data-fb="no" aria-pressed="' + (S.feedback === 'no') + '">👎 No</button></div>' +
          (S.tip && !hw ? '<div class="note good" style="margin-top:10px"><span class="ni">💬</span><span>No call needed. Your tip told Karim the way in.</span></div>' : '') +
          savedLine +
          '<button class="btn" type="button" data-act="finish">Done</button>' +
          '<button class="linkbtn" type="button" data-act="toToday">Compare with today\'s app</button>'
      };
    }
  };

  function render() {
    document.body.dataset.mode = S.mode;
    document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)); });
    var v = screens[S.step]();
    $('#topcard').innerHTML = v.top;
    var sh = $('#sheet');
    sh.innerHTML = v.sheet;
    sh.scrollTop = 0;
    sh.classList.toggle('more', sh.scrollHeight > sh.clientHeight + 4);
    if (S.step !== 'trip') banner(null);
    renderLog();
    drawMap();
    if (S.step === 'pick') setTimeout(updatePick, 30);
  }
  function go(step) { S.step = step; render(); }

  function banner(kind, icon, title, text) {
    var b = $('#banner');
    if (!kind) { b.hidden = true; return; }
    b.className = 'banner ' + kind;
    b.innerHTML = '<span class="bi">' + icon + '</span><span><b>' + title + '</b>' + text + '</span>';
    b.hidden = false;
  }

  /* ---------- trip ---------- */
  var anim = null;
  function stopAnim() { if (anim) clearTimeout(anim.t); anim = null; }
  function startTrip() {
    go('trip');
    var path = routeFor(), cum = cumulative(path), total = cum[cum.length - 1];
    var smart = S.mode === 'smart';
    var turnD = smart && S.spot.kind === 'road' ? cumulative(D.routeSmart.path)[38] : null;
    bikeMarker = new maplibregl.Marker({ element: el('bike', BIKE) }).setLngLat(ll(path[0])).addTo(map);
    if (ready) map.setPadding({ top: 120, bottom: sheetH() + 20, left: 0, right: 0 });
    var zoom = 15.6, d = 0, last = performance.now(), stage = 0;
    log('', smart ? '<b>Trip started</b> towards ' + S.spot.en.toLowerCase() + '. Karim\'s navigation ends at the spot itself, not on the highway.'
                  : '<b>Trip started.</b> Navigation ends on the highway, the nearest road a bike can use to the expressway point.');
    anim = { t: 0 };
    (function tick() {
      if (!anim) return;
      var now = performance.now();
      d = Math.min(total, d + (now - last) / MS_PER_M); last = now;
      var at = pointAt(path, cum, d), left = total - d;
      bikeMarker.setLngLat(ll(at.pt)); S.bikeAt = at.pt;
      setLine('trail', path.slice(0, at.i).concat([at.pt]));
      var target = left < 380 ? 17.2 : 15.9;
      zoom += (target - zoom) * 0.06;
      if (ready) map.jumpTo({ center: ll(at.pt), zoom: zoom });
      var p = $('#prog'); if (p) p.style.width = (d / total * 100).toFixed(1) + '%';
      var tl = $('#tripLeft'); if (tl) tl.textContent = left > 40 ? Math.round(left / 10) * 10 + ' m to go' : 'Arriving';
      var te = $('#tripEta'); if (te) te.textContent = Math.max(1, Math.ceil(left / 1390 * 8)) + ' min';
      if (!smart && stage === 0 && left < 560) {
        stage = 1;
        banner('call', '📞', 'Karim is calling…', '<span class="bn">"ভাই, কোন দিকে নামবেন? হাইওয়েতেই নামিয়ে দিই?"</span><small>"Which side? Shall I drop you on the highway?"</small>');
        log('warn', '<b>Rider called the passenger</b> to ask where to stop. The map gave him the canteen, but not a road he could use to reach it.');
      }
      if (smart && turnD) {
        if (stage === 0 && d > turnD - 380) { stage = 1; banner('good', '↰', 'Karim turns off the highway here', 'Onto the road under the expressway, as your tip says.'); log('good', '<b>Turn reminder sent to Karim</b> just before the turn off the highway.'); }
        if (stage === 1 && d > turnD + 30) { stage = 2; banner('good', '✓', 'Off the highway', 'Heading straight to your drop-off spot.'); }
      }
      if (d >= total) { stopAnim(); arrive(); return; }
      anim.t = setTimeout(tick, 33);
    })();
  }
  function arrive() {
    if (bikeMarker) { bikeMarker.remove(); bikeMarker = null; }
    if (S.mode === 'smart') {
      log('good', '<b>Trip ended at the drop-off spot.</b> The app records how far the trip ended from the spot. That\'s the main success measure.');
      if (S.remember && !S.usedSaved) {
        S.saved = { spot: S.spot, tip: S.tip };
        store(S.saved);
        log('good', '<b>Saved for this place:</b> the spot' + (S.tip ? ' and the tip' : '') + '. Next time they\'re used automatically.');
      }
      go('done');
    } else {
      log('bad', '<b>Trip ended on the highway</b>, across the road from the canteen. Nothing flags this as a wrong drop-off.');
      go('done');
      banner('bad', '!', 'Your pin was right. The ride wasn\'t.', 'You\'re on the highway. The canteen is across the road.');
    }
  }

  /* ---------- rider screen ---------- */
  function openRider() {
    var s = S.spot, hw = s.kind === 'hw';
    var r = $('#rider');
    r.innerHTML = '<div class="rtop"><span>Rider\'s app (sample)</span><button type="button" data-act="closeRider">Close</button></div>' +
      '<span class="req">নতুন রাইড · New ride</span>' +
      '<div class="rcard spot"><div class="t">Drop-off spot</div><div class="bn">' + s.bn + ' · ' + s.bnDesc + '</div><small>' + s.en + ' · ' + s.desc + '</small></div>' +
      (S.tip ? '<div class="rcard tip"><div class="t">Passenger\'s tip</div><div class="q">“' + esc(S.tip) + '”</div></div>' : '') +
      (hw ? '<div class="rcard warn"><div class="t">Safety reminder</div><div class="bn">হাইওয়ে: রাস্তার পাশে নিরাপদে থামুন।</div><small>Highway: pull over safely at the side of the road.</small></div>'
          : '<div class="rcard warn"><div class="t">Reminder</div><div class="bn">এক্সপ্রেসওয়েতে নয়, নিচের রাস্তায় নামাবেন।</div><small>Not on the expressway. Drop off on the road below.</small></div>') +
      '<button class="raccept" type="button" data-act="closeRider">গ্রহণ করুন<small>Accept</small></button>';
    r.hidden = false;
    log('', '<b>Rider\'s ride request shows</b> the drop-off spot, the passenger\'s tip in their own words, and a short reminder in Bangla.');
  }

  /* ---------- actions ---------- */
  function restart() {
    stopAnim(); $('#rider').hidden = true; banner(null);
    S.step = 'home'; S.q = ''; S.spot = AUTO_SPOT; S.tip = ''; S.remember = true; S.usedSaved = false; S.pick = null; S.feedback = null; S.log = []; S.unread = 0;
    render();
  }
  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m;
    try { history.replaceState(null, '', '#' + m); } catch (e) { /* ignore */ }
    restart();
  }
  function readTip() { var t = $('#tip'); if (t) S.tip = t.value.trim(); var r = $('#remember'); if (r) S.remember = r.checked; }

  var actions = {
    search: function () { go('lookup'); setTimeout(function () { var q = $('#q'); if (q) q.focus(); }, 50); },
    office: function () { actions.place(); },
    place: function () {
      log('', '<b>Pin placed exactly on POL Depo Canteen.</b> The map and GPS got this part right.');
      if (S.mode === 'today') {
        log('bad', '<b>Route end = nearest road line to the pin:</b> the Elevated Expressway, which runs right above the canteen\'s road. On a flat map they look like one line.');
        log('bad', '<b>Bikes can\'t use the expressway,</b> so the route ends on the nearest road they can use: the highway, across from the canteen.');
        return go('ride');
      }
      if (S.saved) {
        S.spot = S.saved.spot; S.tip = S.saved.tip || ''; S.usedSaved = true;
        log('good', '<b>Saved spot found for this place.</b> Using it' + (S.tip ? ' with your tip' : '') + '. No questions asked.');
        return go('ride');
      }
      log('warn', '<b>Nearest road line is the Elevated Expressway.</b> Bikes can\'t use it, so it\'s skipped.');
      log('good', '<b>Route now ends on the nearest road a bike can use:</b> the road right below, at the canteen gate.');
      S.spot = AUTO_SPOT;
      go('spot');
    },
    back: function () {
      stopAnim();
      if (S.step === 'pick') return go('spot');
      if (S.step === 'spot') return go('lookup');
      if (S.step === 'ride') return go(S.mode === 'smart' && !S.usedSaved ? 'spot' : 'lookup');
      go('home');
    },
    example: function () { var t = $('#tip'); if (t) { t.value = TIP_EXAMPLE; t.focus(); } var b = document.querySelector('[data-act=example]'); if (b) b.remove(); },
    pick: function () { readTip(); go('pick'); },
    cancelpick: function () { go('spot'); },
    setpick: function () {
      if (!S.pick || !S.pick.snap) return;
      S.spot = spotFrom(S.pick, 'manual');
      log(S.spot.kind === 'hw' ? 'warn' : 'good', S.spot.kind === 'hw'
        ? '<b>Passenger chose a spot on the highway.</b> Allowed. The rider will get a safety reminder with the request.'
        : '<b>Passenger moved the pin.</b> It\'s on a road where bikes can stop.');
      go('spot');
    },
    confirm: function () {
      readTip();
      log('good', '<b>Drop-off confirmed:</b> ' + S.spot.en.toLowerCase() + (S.tip ? ', with a tip for the rider' : '') + '.' + (S.remember ? ' The app will remember it after this trip.' : ''));
      go('ride');
    },
    edit: function () { S.usedSaved = false; go('spot'); },
    book: function () {
      go('search');
      setTimeout(function () {
        if (S.step !== 'search') return;
        if (S.mode === 'smart') log('good', '<b>Ride request sent with the spot' + (S.tip ? ' and tip' : '') + '.</b> The rider knows exactly where to stop before accepting.');
        go('found');
      }, 1500);
    },
    rider: openRider,
    closeRider: function () { $('#rider').hidden = true; },
    start: startTrip,
    finish: function () { go('home'); },
    toSmart: function () { setMode('smart'); },
    toToday: function () { setMode('today'); }
  };

  /* ---------- drawers ---------- */
  function openDrawer(name) {
    closeDrawers();
    $('#drawer-' + name).hidden = false;
    $('#scrim').hidden = false;
    if (name === 'scenes') { S.unread = 0; renderLog(); }
  }
  function closeDrawers() {
    document.querySelectorAll('.drawer').forEach(function (d) { d.hidden = true; });
    $('#scrim').hidden = true;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (a) { e.preventDefault(); if (actions[a.dataset.act]) actions[a.dataset.act](a); return; }
    var f = e.target.closest('[data-fb]');
    if (f) {
      S.feedback = f.dataset.fb;
      document.querySelectorAll('[data-fb]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === f)); });
      log(S.feedback === 'yes' ? 'good' : 'warn', S.feedback === 'yes' ? '<b>Passenger: right spot.</b> One more confirmation for this gate.' : '<b>Passenger: wrong spot.</b> The gate is flagged for review.');
      return;
    }
    var dr = e.target.closest('[data-drawer]');
    if (dr) { openDrawer(dr.dataset.drawer); return; }
    if (e.target.closest('[data-close]') || e.target.id === 'scrim') { closeDrawers(); return; }
    var m = e.target.closest('.seg button');
    if (m) setMode(m.dataset.mode);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawers(); });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    S.q = e.target.value;
    $('#results').innerHTML = results();
  });
  $('#restart').addEventListener('click', restart);
  $('#forget').addEventListener('click', function () { S.saved = null; store(null); closeDrawers(); restart(); });
  window.addEventListener('resize', function () { if (S.step === 'pick') placeCenterPin(); });
  window.__sd = { state: S, classify: classify, map: map };

  render();

  // Test hook: ?auto=office,confirm,book,start plays steps (used for screenshots).
  var auto = (location.search.match(/[?&]auto=([^&]+)/) || [])[1];
  if (auto) {
    try { localStorage.removeItem('sd2-saved'); } catch (e) { /* ignore */ }
    S.saved = null;
    var steps = decodeURIComponent(auto).split(',');
    (function next() {
      if (!ready) return setTimeout(next, 300);
      var s = steps.shift();
      if (!s) return;
      if (s === 'example') actions.example(); else if (s === 'scenes' || s === 'about') openDrawer(s); else if (actions[s]) actions[s]();
      setTimeout(next, s === 'book' ? 2200 : 1400);
    })();
  }
})();
