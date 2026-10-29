// Overlay: moves the character across monitors, routes through monitor seams, hides/peeks with clipping.
const T = window.__TAURI__;
const $ = id => document.getElementById(id);
const comp = $('companion'), bubble = $('bubble'), letterEl = $('letter'), warnEl = $('warn');
const BW = LWMotion.SPRITE_W, BH = LWMotion.SPRITE_H; // base sprite size in CSS px at the overlay's own scale
comp.style.width = BW + 'px';
comp.querySelector('.clip').style.width = BW + 'px';
comp.querySelector('.clip').style.height = BH + 'px';
const seenWarn = {};
let ch, snap = null, hatsApi = null, pos = null, lastMode = null, bubbleT = 0;
let goal = null, path = [], wanderGoal = null, hide = null, holdUntil = 0;
let games = [], gameCursor = null, celebrating = false, hitSent = '', gameMem = null, gameClick = false;
let watchMon = null;

// ---- geometry -------------------------------------------------------------------------
// The overlay is one webview: physical -> CSS is (p - origin) / overlay DPR everywhere.
// Per-monitor DPI is handled by scaling the sprite by monitor.scale / DPR so it keeps the
// same physical-inch size on mixed-DPI setups. Seam routing and the race target live in motion.js.
const dpr = () => window.devicePixelRatio || 1;
// Home window desk buddy is scaled by Buddy size too, capped so it fits the fixed 200 px window (bottom-centre origin).
const homeScale = () => Math.min((snap && snap.buddy_scale) || 1, LWMotion.HOME_MAX_SCALE);
// while racing back, converge on the home window's size so the hand-off matches
const userScale = () => (snap && (snap.mode === 'race_back' || snap.focus_phase === 'back')) ? homeScale() : ((snap && snap.buddy_scale) || 1);
const toCss = (x, y) => { const o = snap ? snap.origin : [0, 0]; return [(x - o[0]) / dpr(), (y - o[1]) / dpr()]; };
function monitorsCss() {
  const ms = (snap && snap.monitors.length) ? snap.monitors : [{ x: 0, y: 0, w: innerWidth * dpr(), h: innerHeight * dpr(), scale: dpr() }];
  return ms.map((m, i) => { const [x, y] = toCss(m.x, m.y); return { i, x, y, w: m.w / dpr(), h: m.h / dpr(), k: LWMotion.scaleFor(m.scale || dpr(), dpr(), userScale()) }; });
}
const center = p => [p[0] + BW * scaleAt(p) / 2, p[1] + BH * scaleAt(p) / 2];
function monitorAt(p, ms = monitorsCss()) { return LWMotion.monitorAt(p, ms); }
function scaleAt(p) { const ms = monitorsCss(); return monitorAt([p[0] + BW / 2, p[1] + BH / 2], ms).k; }
// The desk lives in the separate home window; the character sits at (40,30) CSS px inside it.
const deskMon = () => { const ms = monitorsCss(); if (snap && snap.home) { const [x, y] = toCss(snap.home[0], snap.home[1]); return monitorAt([x, y], ms); } return ms[(snap && snap.desk_monitor) || 0] || ms[0]; };
// The race-back ends on the desk buddy's body centre. motion.js owns that geometry.
function raceTarget(k = kNow || scaleAt(deskPos())) {
  if (!(snap && snap.home)) return deskPos();
  const [hx, hy, , , hs] = snap.home;
  return LWMotion.raceTarget(toCss(hx, hy), hs / dpr(), snap.home_side, (snap && snap.buddy_scale) || 1, k);
}
function focusCenter() {
  const ms = monitorsCss();
  const a = snap && snap.focus_anchor;
  let m = null;
  if (a && a[2] > 0 && a[3] > 0) {
    const [x0, y0] = toCss(a[0], a[1]);
    m = LWMotion.monitorForWindow(x0, y0, x0 + a[2] / dpr(), y0 + a[3] / dpr(), ms);
  }
  if (!m) m = deskMon();
  const k = m.k || 1;
  return [m.x + m.w / 2 - LWGames.BODY_X * k, m.y + m.h / 2 - LWGames.BODY_Y * k];
}
function deskPos() {
  if (snap && snap.home) {
    const [hx, hy, , , hs] = snap.home, b = homeScale();
    return toCss(hx + (LWMotion.DESK_ANCHOR_X + LWMotion.SCALE_ORIGIN_X * (1 - b)) * hs, hy + (LWMotion.DESK_ANCHOR_Y + LWMotion.SCALE_ORIGIN_Y * (1 - b)) * hs);
  }
  const m = deskMon(); return [m.x + m.w - BW * m.k - 60, m.y + m.h - BH * m.k - 110];
}
const atHome = LWDomain.atHome;
function roamMonitors() { return (snap && snap.roam_all_monitors === false) ? [deskMon()] : monitorsCss(); }
function randomSpot() { // always fully inside a monitor, never in gaps
  const ms = roamMonitors(), m = ms[Math.floor(Math.random() * ms.length)];
  return [m.x + 20 + Math.random() * Math.max(1, m.w - BW * m.k - 40), m.y + m.h - BH * m.k - 60 - Math.random() * Math.min(200, m.h / 3)];
}
function seam(a, b) { return LWMotion.seam(a, b); }
function route(from, to) { return LWMotion.route(from, to, monitorsCss(), center); }
function setGoal(t, slack = 2) {
  if (!t) return;
  if (goal && Math.hypot(goal[0] - t[0], goal[1] - t[1]) < slack) return;
  goal = t; path = pos ? route(pos, t) : [t];
}
const atGoal = () => !path.length;
// Still poses mirror on data-dir=left, so that attribute faces the other way from walking.
function visualLook() {
  const body = ch.el.getAttribute('data-body') || '';
  const namedLeft = ch.el.getAttribute('data-dir') === 'left';
  const travel = body === 'walking' || body === 'rushing' || body === 'racing';
  return travel ? (namedLeft ? 'left' : 'right') : (namedLeft ? 'right' : 'left');
}
function applyLook(body, look) {
  if (ch.el.getAttribute('data-body') !== body) ch.setBody(body);
  const dir = LWMotion.dirForLook(body, look);
  if ((ch.el.getAttribute('data-dir') === 'left') !== (dir === 'left')) ch.setDir(dir);
}
function faceHide(h) { applyLook('peeking', LWMotion.hideLook(h.side, !!h.win)); }
// Peek as soon as the walk arrives. The pose used to wait for the next companion-state,
// so a stalled tick left him walking into the bezel.
function settleHide() {
  if (!hide || hide.since || path.length) return;
  hide.since = Date.now();
  ch.setFace(hide.face);
  faceHide(hide);
}
function watchBox(w) {
  const [x0, y0] = toCss(w.x, w.y), [x1, y1] = toCss(w.x + w.w, w.y + w.h);
  return [x0, y0, x1, y1];
}
// On arrival, face the window. If it is straight ahead, face the monitor centre.
// If that is straight ahead too, keep the way he was already looking.
function faceWatch() {
  if (!snap || !snap.watch || !pos) return;
  const [x0, y0, x1, y1] = watchBox(snap.watch);
  const m = LWMotion.monitorForWindow(x0, y0, x1, y1, monitorsCss(), watchMon);
  const k = kNow || m.k || 1;
  const spanL = Math.max(x0, m.x), spanR = Math.min(x1, m.x + m.w);
  const look = LWMotion.lookToward(pos[0] + BW * k / 2, (spanL + spanR) / 2, m.x + m.w / 2, 24) || visualLook();
  ch.setFace('curious');
  applyLook(LWCharacter.supportsBody('watching') ? 'watching' : 'peeking', look);
}
function ensureWatchWalk() {
  if (ch.el.getAttribute('data-body') === 'walking') return;
  const look = visualLook();
  ch.setFace('curious');
  applyLook('walking', look);
}

// ---- hiding / peeking -------------------------------------------------------------------
// Hide spots: outer monitor edges (no adjacent monitor there) and the foreground window's left/right edges.
// side = which side of the sprite is hidden; line = clip line x (CSS px).
function pickHide() {
  const ms = roamMonitors(), all = monitorsCss(), c = [], VIS = 0.45;
  const adjL = m => all.some(o => o.i !== m.i && Math.abs(o.x + o.w - m.x) < 2 && o.y < m.y + m.h && o.y + o.h > m.y);
  const adjR = m => all.some(o => o.i !== m.i && Math.abs(o.x - (m.x + m.w)) < 2 && o.y < m.y + m.h && o.y + o.h > m.y);
  for (const m of ms) {
    const w = BW * m.k, y = m.y + m.h - BH * m.k - 60 - Math.random() * Math.min(150, m.h / 4);
    if (!adjL(m)) c.push({ line: m.x, side: 'left', pos: [m.x - w * (1 - VIS), y] });
    if (!adjR(m)) c.push({ line: m.x + m.w, side: 'right', pos: [m.x + m.w - w * VIS, y] });
  }
  if (snap && snap.fg_rect) {
    const [fx, fy, fw, fh] = snap.fg_rect, [x0, y0] = toCss(fx, fy), [x1, y1] = toCss(fx + fw, fy + fh);
    const k = monitorAt([(x0 + x1) / 2, (y0 + y1) / 2]).k, w = BW * k;
    const r = { x0, y0, x1, y1 }, yFrac = 0.6;
    if (LWHide.fits(r, w, BH * k) && snap.fg_id) for (const side of ['right', 'left']) c.push({ side, yFrac, win: snap.fg_id, ...LWHide.windowGeom(side, yFrac, r, w, BH * k) });
  }
  if (!c.length) return null;
  const wins = c.filter(x => x.win);
  const h = snap.force_hide && wins.length ? wins[0] : c[Math.floor(Math.random() * c.length)];
  h.face = ['shy', 'curious', 'excited'][Math.floor(Math.random() * 3)]; // shy / curious / giggly
  h.dur = 6000 + Math.random() * 9000;
  if (T) T.core.invoke('track_window', { id: h.win || null }).catch(() => {});
  return h;
}
function endHide() { if (hide && hide.win && T) T.core.invoke('track_window', { id: null }).catch(() => {}); hide = null; }
// Live target updates (every ~40 ms while hiding behind a window): re-clip + reposition, or pop out.
function onTarget(t) {
  if (!hide || !hide.win || t.id !== hide.win) return;
  const k = scaleAt(pos), w = BW * k, h = BH * k;
  let r = null;
  if (t.state === 'ok') { const [x0, y0] = toCss(t.x, t.y), [x1, y1] = toCss(t.x + t.w, t.y + t.h); r = { x0, y0, x1, y1 }; }
  if (LWHide.verdict(t, r, w, h) === 'popout') return popOut();
  const g = LWHide.windowGeom(hide.side, hide.yFrac, r, w, h);
  hide.line = g.line; hide.pos = g.pos;
  if (hide.since) { pos = [g.pos[0], g.pos[1]]; path = []; goal = g.pos; faceHide(hide); }
  else setGoal(g.pos, 8);
}
function popOut() {
  endHide();
  ch.setFace('excited'); ch.setBody(LWCharacter.rushBody());
  wanderGoal = randomSpot(); setGoal(wanderGoal);
  setTimeout(() => { if (lastMode === 'wander') ch.setState('wander'); }, 900);
}
function applyClip(k) {
  let l = 0, r = 0;
  if (hide && hide.since && hide.line != null) ({ l, r } = LWHide.clip(pos[0], BW * k, hide.line, hide.side));
  // clip-path is applied in the element's unscaled box
  comp.style.clipPath = (l || r) ? `inset(0 ${r / k}px 0 ${l / k}px)` : '';
  bubble.style.display = (l || r) ? 'none' : '';
}
// Speech bubble. 8px gap above the sprite. index.html's bottom is the same number; this wins once the script runs.
// The shift is computed from layout size. Measuring getBoundingClientRect after clearing
// the transform put the bubble back on the seam for a frame, then shoved it off again,
// so near a monitor edge it jittered instead of sliding.
const BUBBLE_BOTTOM = BH + 8;
bubble.style.bottom = BUBBLE_BOTTOM + 'px';
let bubbleHold = null, bubbleSizeKey = '', bubbleNat = null;
function bubbleNatural() {
  const key = bubble.textContent + '\n' + (bubble.style.fontSize || '');
  if (bubbleNat && bubbleSizeKey === key) return bubbleNat;
  const max = bubble.style.maxWidth, ws = bubble.style.whiteSpace;
  bubble.style.maxWidth = 'none';
  bubble.style.whiteSpace = 'nowrap';
  bubbleNat = { w: bubble.offsetWidth, h: bubble.offsetHeight };
  bubbleSizeKey = key;
  bubble.style.maxWidth = max;
  bubble.style.whiteSpace = ws;
  return bubbleNat;
}
function placeBubble(k) {
  const showing = pos && bubble.classList.contains('on') && bubble.style.display !== 'none';
  if (!showing) { bubbleHold = null; return; }
  const kk = k || 1;
  const nat = bubbleNatural();
  if (nat.w < 1 || nat.h < 1) return;
  const ms = monitorsCss();
  const anchor = [pos[0] + BW * kk / 2, pos[1] + BH * kk / 2];
  const held = bubbleHold == null ? null : ms.find(m => m.i === bubbleHold) || null;
  const m = LWMotion.bubbleMonitor(held, anchor, ms, 12);
  bubbleHold = m.i;
  const pad = 4, room = Math.max(8, m.w - pad * 2);
  let w = nat.w, h = nat.h;
  const visualW = (bw) => bw * kk;
  if (visualW(nat.w) > room) {
    bubble.style.whiteSpace = 'normal';
    bubble.style.maxWidth = (room / kk) + 'px';
    w = bubble.offsetWidth; h = bubble.offsetHeight;
  } else if (bubble.style.maxWidth) {
    bubble.style.maxWidth = '';
    bubble.style.whiteSpace = '';
  }
  const box = {
    x: pos[0] + (BW / 2 - w / 2) * kk,
    y: pos[1] + (BH - BUBBLE_BOTTOM - h) * kk,
    w: w * kk, h: h * kk,
  };
  const [dx, dy] = LWMotion.fitBox(box.x, box.y, box.w, box.h, m, pad);
  bubble.style.transform = `translate(calc(-50% + ${(dx - box.x) / kk}px), ${(dy - box.y) / kk}px)`;
}

// ---- state ------------------------------------------------------------------------------
let raceHoldUntil = 0, rushing = false, arrivedSent = false, handedOff = false, settling = false, focusBackSent = false;
function say(key, text, ms) {
  const t = text || LWContent.line(key, { buddy: (snap && snap.buddy) || 'Buddy' }); if (!t) return;
  bubble.textContent = t; bubble.classList.add('on'); clearTimeout(bubbleT); bubbleT = setTimeout(() => bubble.classList.remove('on'), ms || 5000);
}
function playBox(center) {
  const ms = roamMonitors();
  const m = monitorAt(center, ms);
  const pad = 48;
  let x0 = m.x + pad, y0 = m.y + pad, x1 = m.x + m.w - pad, y1 = m.y + m.h - pad;
  if (x1 < x0) { const c = m.x + m.w / 2; x0 = c; x1 = c; }
  if (y1 < y0) { const c = m.y + m.h / 2; y0 = c; y1 = c; }
  return { x0, y0, x1, y1 };
}
function placeTag(k) {
  if (!T || !snap || !pos) return;
  const dprNow = window.devicePixelRatio || 1;
  const r = LWGames.CATCH_R * k;
  const cx = pos[0] + LWGames.BODY_X * k, cy = pos[1] + LWGames.BODY_Y * k;
  const x = Math.round(snap.origin[0] + (cx - r) * dprNow);
  const y = Math.round(snap.origin[1] + (cy - r) * dprNow);
  const w = Math.max(8, Math.round(2 * r * dprNow));
  const key = x + ',' + y + ',' + w;
  if (key === hitSent) return;
  hitSent = key;
  T.core.invoke('place_tag_hit', { x, y, w, h: w }).catch(() => { if (hitSent === key) hitSent = ''; });
}
function beginCheer() {
  if (celebrating || !snap) return;
  celebrating = true;
  ch.setFace('proud');
  ch.setBody('idle');
  if (ch.el.hasAttribute('data-slap')) ch.el.removeAttribute('data-slap');
  const id = snap.focus_game;
  const g = games.find(x => x.id === id);
  const fallback = { tag: 'You got {buddy}!', redlight: 'You made it!', highfive: 'High five!', warmer: 'You found {buddy}!' };
  const raw = (g && g.cheer) || fallback[id] || '{buddy} caught it!';
  say(null, raw.replaceAll('{buddy}', snap.buddy || 'Buddy'), 4000);
  setTimeout(() => { celebrating = false; if (T) T.core.invoke('focus_finish').catch(() => {}); }, 1200);
}
function bodyCenter(k) { return [pos[0] + LWGames.BODY_X * k, pos[1] + LWGames.BODY_Y * k]; }
function setCenter(c, k) { pos = [c[0] - LWGames.BODY_X * k, c[1] - LWGames.BODY_Y * k]; }
function lookOf(center) { return gameCursor && gameCursor[0] < center[0] ? 'left' : 'right'; }
function freshMem(id) {
  if (!gameMem || gameMem.id !== id) {
    gameMem = {
      id, phase: 'green', left: LWGames.REDLIGHT_GREEN, from: null, moved: false, pushed: false,
      happy: true, hits: 0, placed: false, look: 'right', dist: null, word: '',
    };
  }
  return gameMem;
}
// Happy window holds the hand up. A counted click swings it down, then the cheer waits out that swing.
function poseHighfive(mem, n) {
  const now = Date.now();
  if (n.hits === 0) mem.shownHits = 0;
  else if (n.hits > (mem.shownHits || 0)) {
    mem.shownHits = n.hits;
    mem.slapUntil = now + 420;
    if (ch.el.getAttribute('data-slap') === 'on') {
      ch.el.removeAttribute('data-slap');
      void ch.el.getBoundingClientRect();
    }
  }
  if (mem.slapUntil && now < mem.slapUntil) {
    ch.setFace('excited');
    applyLook('highfive', 'right');
    if (ch.el.getAttribute('data-slap') !== 'on') ch.el.setAttribute('data-slap', 'on');
    return false;
  }
  if (ch.el.hasAttribute('data-slap')) ch.el.removeAttribute('data-slap');
  if (mem.pendingCheer) {
    mem.pendingCheer = false;
    beginCheer();
    return true;
  }
  ch.setFace(n.happy ? 'excited' : 'focused');
  applyLook(n.happy ? 'highfive' : 'idle', 'right');
  return false;
}
function warmerSpot(k) {
  const ms = monitorsCss();
  const r = snap && snap.fg_rect;
  if (r && r[2] > 40 && r[3] > 40) {
    const [x0, y0] = toCss(r[0], r[1]);
    const x1 = x0 + r[2] / dpr(), y1 = y0 + r[3] / dpr();
    const m = LWMotion.monitorForWindow(x0, y0, x1, y1, ms);
    const spot = LWMotion.watchGoal(x0, y0, x1, y1, m, BW, BH, k);
    const look = LWMotion.lookToward(spot[0] + BW * k / 2, (x0 + x1) / 2, m.x + m.w / 2) || 'right';
    return { pos: spot, look };
  }
  const m = monitorAt(pos, ms);
  return { pos: [m.x + 24, m.y + m.h - BH * k - 24], look: 'right' };
}
function stepGame(dt) {
  if (!snap || snap.focus_phase !== 'play' || celebrating || !pos) return;
  const id = snap.focus_game;
  const k = kNow || scaleAt(pos);
  const mem = freshMem(id);
  if (id === 'warmer') {
    if (!mem.placed) {
      const spot = warmerSpot(k);
      mem.placed = true;
      mem.look = spot.look;
      setGoal(spot.pos);
      ch.setFace('curious');
      ch.setBody('walking');
    }
    if (path.length) return;
    applyLook('peeking', mem.look);
    ch.setFace('curious');
    if (gameCursor) {
      const center = bodyCenter(k);
      const dist = Math.hypot(gameCursor[0] - center[0], gameCursor[1] - center[1]);
      const word = LWGames.warmerWord(dist, mem.dist);
      mem.dist = dist;
      if (word && word !== mem.word) {
        mem.word = word;
        say(null, word === 'warmer' ? 'Warmer.' : 'Colder.', 1400);
      }
    }
    placeTag(k);
    return;
  }
  path = [];
  if (!gameCursor) return;
  const center = bodyCenter(k);
  if (id === 'tag') {
    const speed = ((snap.walk_speed) || 96) * k * 1.45;
    const next = LWGames.tag(center, gameCursor, dt, speed, playBox(center));
    const dx = next[0] - center[0];
    setCenter(next, k);
    if (Math.abs(dx) > 0.4) ch.setWalkDir(dx < 0 ? 'left' : 'right');
    placeTag(k);
    return;
  }
  if (id === 'redlight') {
    const n = LWGames.redlight(center, gameCursor, dt, LWGames.CATCH_R * k, playBox(center), mem);
    setCenter(n.anchor, k);
    const toward = lookOf(n.anchor);
    if (n.phase === 'green') applyLook('watching', toward === 'left' ? 'right' : 'left');
    else { ch.setFace('curious'); applyLook('idle', toward); }
    if (n.caught) beginCheer();
    return;
  }
  if (id === 'highfive') {
    const clicked = gameClick;
    gameClick = false;
    const n = LWGames.highfive(mem, dt, clicked);
    if (n.caught) mem.pendingCheer = true;
    if (poseHighfive(mem, n)) return;
    placeTag(k);
    if (!n.caught && clicked && n.hits > 0 && n.hits < LWGames.HIGHFIVE_GOAL) say(null, n.hits === 1 ? 'One!' : 'Two!', 900);
    return;
  }
  const speed = ((snap.walk_speed) || 96) * k * 2.2;
  const n = LWGames.chase(center, gameCursor, dt, speed, LWGames.CATCH_R * k);
  const dx = n.pos[0] - center[0];
  setCenter(n.pos, k);
  if (Math.abs(dx) > 0.4) ch.setWalkDir(dx < 0 ? 'left' : 'right');
  if (n.caught) beginCheer();
}
function syncPose(s, mode) {
  if (mode !== 'watch') watchMon = null;
  if (mode === lastMode) return;
  handedOff = false; arrivedSent = false; settling = false;
  if (mode === 'race_back') { raceHoldUntil = Date.now() + LWDomain.RACE_HOLD_MS; ch.setFace('excited'); ch.setBody('idle'); rushing = false; }
  else if (mode === 'watch') { const look = visualLook(); ch.setFace('curious'); applyLook('walking', look); }
  else ch.setState(mode);
  ({ asleep: () => say('sleeping'), wander: () => say('wandering'), watch: () => say('watchingVideo'), race_back: () => say('backToWork') }[mode] || (() => {}))();
  lastMode = mode; wanderGoal = null; endHide();
}
function syncPath(s, mode) {
  const holdingRace = mode === 'race_back' && Date.now() < raceHoldUntil;
  if (holdingRace) { path = []; goal = pos.slice(); return; }
  if (mode === 'race_back' && !rushing) { rushing = true; ch.setState('race_back'); const t = raceTarget(); ch.setWalkDir(t[0] < pos[0] ? 'left' : 'right'); setGoal(t); }
  if (mode === 'wander') {
    if (hide) {
      if (atGoal() && !hide.since) { hide.since = Date.now(); ch.setFace(hide.face); faceHide(hide); }
      if (hide && hide.since && Date.now() - hide.since > hide.dur) { endHide(); ch.setState('wander'); wanderGoal = randomSpot(); }
    } else if (!wanderGoal || atGoal()) {
      hide = (s.force_hide || Math.random() < 0.4) ? pickHide() : null;
      if (!hide) wanderGoal = randomSpot();
    }
    setGoal(hide ? hide.pos : wanderGoal, hide ? 8 : 2);
  } else if (mode === 'watch' && s.watch) {
    const [x0, y0, x1, y1] = watchBox(s.watch);
    watchMon = LWMotion.monitorForWindow(x0, y0, x1, y1, monitorsCss(), watchMon);
    setGoal(LWMotion.watchGoal(x0, y0, x1, y1, watchMon, BW, BH, watchMon.k), 16);
    if (atGoal()) faceWatch(); else ensureWatchWalk();
  } else if (atHome(mode)) { pos = deskPos(); path = []; goal = pos.slice(); }
  else if (mode !== 'watch') setGoal(mode === 'race_back' ? raceTarget() : deskPos());
}
function syncHud(s, mode) {
  ch.setColors(s.colors);
  ch.setTool(s.tool);
  bubble.style.fontSize = ((s.bubble_px || 12)) + 'px';
  comp.style.visibility = atHome(mode) || handedOff ? 'hidden' : 'visible';
  const now = Date.now(), ws = (s.warnings || []).filter(w => (seenWarn[w] ??= now) > now - 60000);
  warnEl.textContent = ws.join('\n'); warnEl.style.display = ws.length ? 'block' : 'none';
  if (ws.length) { const m = deskMon(); warnEl.style.left = m.x + 20 + 'px'; warnEl.style.top = m.y + 20 + 'px'; }
}
function focusOut(s) {
  const phase = s && s.focus_phase;
  return phase === 'play' || phase === 'back';
}
function showFocus(s) {
  const phase = s.focus_phase;
  const modeName = phase === 'play' ? 'game' : 'focus_' + phase;
  const entering = lastMode !== modeName;
  if (entering) {
    endHide();
    handedOff = false;
    settling = false;
    arrivedSent = false;
    const c = focusCenter();
    pos = c.slice();
    path = [];
    goal = pos.slice();
    if (phase === 'play') { hitSent = ''; gameMem = null; gameClick = false; }
    if (phase === 'back') { focusBackSent = false; rushing = true; }
  }
  lastMode = modeName;
  ch.setColors(s.colors);
  ch.setTool(s.tool);
  bubble.style.fontSize = ((s.bubble_px || 12)) + 'px';
  comp.style.visibility = 'visible';
  if (phase === 'back') {
    if (entering) {
      ch.setFace('excited');
      ch.setState('race_back');
      const t = raceTarget();
      ch.setWalkDir(t[0] < pos[0] ? 'left' : 'right');
      setGoal(t);
    }
  } else if (entering && s.focus_game === 'highfive') {
    ch.setFace('excited');
    applyLook('highfive', 'right');
  } else if (!celebrating && (s.focus_game === 'chase' || s.focus_game === 'tag') && ch.el.getAttribute('data-body') !== 'rushing') {
    ch.setFace('excited');
    ch.setBody('rushing');
  }
  if (hatsApi) hatsApi.apply(s);
}
function onState(s) {
  snap = s;
  if (!pos) pos = deskPos();
  const mode = s.paused ? 'paused' : s.mode;
  const phase = s.focus_phase;
  if (phase === 'ask' || phase === 'explain') {
    path = [];
    if (pos) goal = pos.slice();
    comp.style.visibility = 'hidden';
    return;
  }
  if (focusOut(s)) { showFocus(s); return; }
  if (celebrating) celebrating = false;
  gameMem = null;
  gameClick = false;
  syncPose(s, mode);
  syncPath(s, mode);
  syncHud(s, mode);
  if (hatsApi) hatsApi.apply(s);
}

// Time-based, eased movement (logical px/s via LWMotion), smooth re-scale when crossing monitors.
let lastT = null, vel = 0, kNow = null;
function frame(t) {
  const dt = lastT == null ? 0 : LWMotion.clampDt(t - lastT); lastT = t;
  if (pos) {
    const kTarget = scaleAt(pos);
    kNow = kNow == null ? kTarget : LWMotion.smoothScale(kNow, kTarget, dt);
    stepGame(dt);
    if (path.length) {
      const walk = (snap && snap.walk_speed) || 96;
      const speedMode = lastMode === 'focus_back' ? 'race_back'
        : (lastMode === 'focus_ask' || lastMode === 'focus_explain') ? 'wander'
        : (lastMode === 'wander' || lastMode === 'watch' || lastMode === 'race_back' ? lastMode : 'home');
      const vmax = LWMotion.modeSpeed(speedMode, walk);
      const to = path[0], dx = to[0] - pos[0];
      const n = LWMotion.step(pos, to, vel, vmax, dt, kNow);
      pos = n.pos; vel = path.length > 1 && n.arrived ? n.v || vel : n.v; // keep momentum through seam waypoints
      if (n.arrived) path.shift();
      // Watching and peeking use the opposite data-dir from walking, so only a travel pose follows dx.
      const bodyNow = ch.el.getAttribute('data-body');
      const travel = bodyNow === 'walking' || bodyNow === 'rushing' || bodyNow === 'racing';
      if (path.length && Math.abs(dx) > 1 && !(hide && hide.since) && travel) ch.setWalkDir(dx < 0 ? 'left' : 'right');
    } else vel = 0;
    settleHide();
    if (lastMode === 'watch' && snap && snap.watch) { if (path.length) ensureWatchWalk(); else faceWatch(); }
    if ((lastMode === 'focus_ask' || lastMode === 'focus_explain') && !path.length) {
      ch.setFace('curious');
      applyLook('idle', visualLook());
    }
    if (lastMode === 'focus_back' && !focusBackSent) {
      const t = raceTarget(kNow);
      if (path.length) path[path.length - 1] = t; else if (Math.hypot(t[0] - pos[0], t[1] - pos[1]) > 0.5) setGoal(t);
      const left = Math.hypot(t[0] - pos[0], t[1] - pos[1]);
      if (left < 24 * kNow && !settling) { settling = true; ch.setBody('idle'); }
      if (left <= 2) {
        focusBackSent = true;
        if (T) T.core.invoke('focus_back').catch(() => {});
      }
    }
    comp.style.left = pos[0] + 'px'; comp.style.top = pos[1] + 'px'; comp.style.transform = Math.abs(kNow - 1) > 1e-3 ? `scale(${kNow})` : '';
    applyClip(kNow);
    placeBubble(kNow);
    // BUG-23: while rushing, keep re-aiming at the desk buddy's body with the current scale, and report arrival
    // (the hand-off is arrival-driven; the backend only has a safety timeout).
    if (lastMode === 'race_back' && rushing && !arrivedSent) {
      const t = raceTarget(kNow);
      if (path.length) path[path.length - 1] = t; else if (Math.hypot(t[0] - pos[0], t[1] - pos[1]) > 0.5) setGoal(t);
      const left = Math.hypot(t[0] - pos[0], t[1] - pos[1]);
      // last few px: stop leaning (the rushing pose shifts the body forward) so the swap is pose-matched
      if (left < 24 * kNow && !settling) { settling = true; ch.setBody('idle'); }
      if (left <= 2) {
        arrivedSent = true;
        if (T) T.core.invoke('race_arrived').catch(() => {}); else { handedOff = true; comp.style.visibility = 'hidden'; }
      }
    }
  }
  requestAnimationFrame(frame);
}

async function showLetter(p) {
  const L = LWContent.letter({ buddy: (snap && snap.buddy) || 'Buddy', projectTitle: p.name, tier: p.tier.replace('_', ' '), wordCount: p.target_words.toLocaleString() },
    (snap ? snap.completed_count : 1) - 1, p.name + ':' + p.completed_at);
  letterEl.innerHTML = '<b></b><p></p><i></i><small></small>';
  letterEl.querySelector('b').textContent = `A fan letter (${L.category})`;
  letterEl.querySelector('p').textContent = L.body; letterEl.querySelector('i').textContent = '— ' + L.from;
  const [x, y] = deskPos(); letterEl.style.left = Math.max(deskMon().x + 10, x - 300) + 'px'; letterEl.style.top = y - 140 + 'px'; letterEl.style.display = 'block';
  if (T) { try { const f = await T.core.invoke('save_letter', { category: L.category, from: L.from, body: L.body, project: p.name }); letterEl.querySelector('small').textContent = 'Saved to journal'; console.log('journal', f); } catch (e) { letterEl.querySelector('small').textContent = 'Journal save failed: ' + e; } }
  setTimeout(() => (letterEl.style.display = 'none'), 15000);
}

(async () => {
  ch = await LWCharacter.mount($('charHost'));
  if (T) { hatsApi = LWCharacter.bindHats((c, a) => T.core.invoke(c, a), ch, () => snap); await hatsApi.refresh(); }
  if (T) { try { games = await T.core.invoke('list_games') || []; } catch (_) { games = []; } }
  await LWContent.ready;
  requestAnimationFrame(frame);
  if (!T) { onState({ mode: 'typing', paused: false, words: 0, target_words: 3000, project_name: 'Demo', tier: 'short_story', origin: [0, 0], monitors: [], colors: {}, desk_monitor: 0 }); return; }
  const s = await T.core.invoke('get_snapshot'); if (s) onState(s);
  T.event.listen('companion-state', e => onState(e.payload));
  // BUG-23 hand-off: the backend emits this to both windows at once; hide the runner on that same event
  T.event.listen('handoff', () => { if (lastMode === 'race_back') { handedOff = true; comp.style.visibility = 'hidden'; } });
  T.event.listen('project-complete', e => showLetter(e.payload));
  T.event.listen('target-rect', e => onTarget(e.payload));
  T.event.listen('game-cursor', e => { if (snap) gameCursor = toCss(e.payload.x, e.payload.y); });
  T.event.listen('tag-click', () => {
    if (!snap || celebrating || snap.focus_phase !== 'play') return;
    if (snap.focus_game === 'highfive') { gameClick = true; return; }
    beginCheer();
  });
  T.event.listen('focus-say', e => {
    const p = e.payload || {};
    const phase = snap && snap.focus_phase;
    if (phase !== 'play' && phase !== 'back') return;
    if (LWDomain.focusAtDesk(snap)) return;
    const buddy = (snap && snap.buddy) || 'Buddy';
    const text = p.text || (p.kind === 'invite' ? LWContent.line('focusBreak', { buddy }) : '');
    if (text) say(null, text, p.kind === 'ask' || p.kind === 'explain' || p.kind === 'decline' ? 9000 : 5000);
  });
})();
