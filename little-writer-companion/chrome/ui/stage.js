// Sprint games play inside the desk window. Embedded, coordinates are the iframe
// viewport and this page does not move the window. The service worker fullscreens it.
const T = window.__TAURI__;
const $ = id => document.getElementById(id);
const comp = $('companion'), bubble = $('bubble'), note = $('note'), hit = $('hit');
const BW = LWMotion.SPRITE_W, BH = LWMotion.SPRITE_H;
let ch, hatsApi, snap = null, games = [];
let pos = null, goal = null, path = [], wanderGoal = null, hide = null, watchMon = null;
let lastMode = null, bubbleT = 0, gameCursor = null, celebrating = false, gameMem = null, gameClick = false;
let raceHoldUntil = 0, rushing = false, arrivedSent = false, handedOff = false, settling = false, focusBackSent = false;
let lastT = null, vel = 0, kNow = null, winId = null, playFocused = false, lastMove = 0;
let view = { left: 0, top: 0, width: 220, height: 240, screenX: 0, screenY: 0 };
const embedded = window.top !== window;
const SHAPE_COLORS = ['#d9c7a6', '#c9b48f', '#e6d3b0', '#b9a484'];

function viewBox() {
  return {
    w: Math.max(200, document.documentElement.clientWidth || window.innerWidth || 320),
    h: Math.max(200, document.documentElement.clientHeight || window.innerHeight || 240),
  };
}
function playField() {
  const v = viewBox();
  const reserve = v.h > 420 ? 210 : 0;
  return { x: 0, y: 0, w: v.w, h: Math.max(180, v.h - reserve) };
}
function ensureCovers() {
  let box = document.getElementById('covers');
  if (!box) {
    box = document.createElement('div');
    box.id = 'covers';
    document.body.appendChild(box);
  }
  return box;
}
function paintCovers(shapes) {
  const box = ensureCovers();
  box.replaceChildren();
  shapes.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'shape';
    d.style.left = Math.round(s.x) + 'px';
    d.style.top = Math.round(s.y) + 'px';
    d.style.width = Math.round(s.w) + 'px';
    d.style.height = Math.round(s.h) + 'px';
    d.style.background = SHAPE_COLORS[i % SHAPE_COLORS.length];
    box.appendChild(d);
  });
}
function clearCovers() {
  const box = document.getElementById('covers');
  if (box) box.replaceChildren();
}
function placeHit(side) {
  if (side === 'left') { hit.style.left = '28px'; hit.style.top = '70px'; hit.style.width = '56px'; hit.style.height = '72px'; }
  else if (side === 'right') { hit.style.left = '122px'; hit.style.top = '70px'; hit.style.width = '56px'; hit.style.height = '72px'; }
  else if (side === 'top') { hit.style.left = '75px'; hit.style.top = '28px'; hit.style.width = '80px'; hit.style.height = '56px'; }
  else if (side === 'bottom') { hit.style.left = '75px'; hit.style.top = '110px'; hit.style.width = '80px'; hit.style.height = '56px'; }
  else { hit.style.left = '75px'; hit.style.top = '68.75px'; hit.style.width = '80px'; hit.style.height = '80px'; }
}
function layCovers(k) {
  const field = playField();
  const sw = BW * k, sh = BH * k;
  const gap = 18;
  const colW = Math.max(100, (field.w - gap * 3) / 2);
  const rowH = Math.max(90, (field.h - gap * 3) / 2);
  const shapes = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const w = Math.max(72, colW * 0.62);
      const h = Math.max(64, rowH * 0.62);
      shapes.push({
        x: field.x + gap + c * (colW + gap) + (colW - w) * 0.5,
        y: field.y + gap + r * (rowH + gap) + (rowH - h) * 0.5,
        w, h,
      });
    }
  }
  const hide = shapes[Math.floor(Math.random() * shapes.length)];
  const options = [];
  if (hide.x > sw * 0.45) options.push('left');
  if (hide.x + hide.w + sw * 0.45 < field.w) options.push('right');
  if (hide.y > sh * 0.45) options.push('top');
  if (hide.y + hide.h + sh * 0.45 < field.h) options.push('bottom');
  const side = (options.length ? options : ['right'])[Math.floor(Math.random() * (options.length || 1))];
  let px, py, look;
  if (side === 'left') { px = hide.x - sw * 0.42; py = hide.y + (hide.h - sh) * 0.5; look = 'left'; }
  else if (side === 'right') { px = hide.x + hide.w - sw * 0.58; py = hide.y + (hide.h - sh) * 0.5; look = 'right'; }
  else if (side === 'top') { px = hide.x + (hide.w - sw) * 0.5; py = hide.y - sh * 0.42; look = 'right'; }
  else { px = hide.x + (hide.w - sw) * 0.5; py = hide.y + hide.h - sh * 0.58; look = 'right'; }
  px = Math.max(4, Math.min(px, field.w - sw * 0.4));
  py = Math.max(4, Math.min(py, field.h - sh * 0.4));
  return { pos: [px, py], look, side, shapes };
}

const userScale = () => {
  const u = (snap && snap.buddy_scale) || 1;
  return (snap && (snap.mode === 'race_back' || snap.focus_phase === 'back')) ? Math.min(u, LWMotion.HOME_MAX_SCALE) : u;
};
function monitorsCss() {
  const k = userScale();
  if (embedded) {
    const v = viewBox();
    return [{ i: 0, x: 0, y: 0, w: v.w, h: v.h, k }];
  }
  const ms = (snap && snap.monitors && snap.monitors.length) ? snap.monitors : [{ x: 0, y: 0, w: 1280, h: 800, scale: 1 }];
  return ms.map((m, i) => ({ i, x: m.x, y: m.y, w: m.w, h: m.h, k }));
}
const centerOf = p => [p[0] + BW * scaleAt(p) / 2, p[1] + BH * scaleAt(p) / 2];
function monitorAt(p, ms = monitorsCss()) { return LWMotion.monitorAt(p, ms); }
function scaleAt(p) { return monitorAt([p[0] + BW / 2, p[1] + BH / 2]).k; }
function deskMon() {
  const ms = monitorsCss();
  if (embedded) return ms[0];
  if (snap && snap.home) return monitorAt([snap.home[0], snap.home[1]], ms);
  return ms[(snap && snap.desk_monitor) || 0] || ms[0];
}
function raceTarget(k = kNow || scaleAt(pos || [0, 0])) {
  if (embedded) return deskPos();
  if (!(snap && snap.home)) return deskPos();
  const [hx, hy, , , hs] = snap.home;
  return LWMotion.raceTarget([hx, hy], (hs || 1), snap.home_side, (snap && snap.buddy_scale) || 1, k);
}
function focusCenter() {
  const ms = monitorsCss();
  const a = snap && snap.focus_anchor;
  let m = null;
  if (a && a[2] > 0 && a[3] > 0) m = LWMotion.monitorForWindow(a[0], a[1], a[0] + a[2], a[1] + a[3], ms);
  if (!m) m = deskMon();
  const k = m.k || 1;
  return [m.x + m.w / 2 - LWGames.BODY_X * k, m.y + m.h / 2 - LWGames.BODY_Y * k];
}
function deskPos() {
  if (embedded) {
    const v = viewBox();
    const b = Math.min((snap && snap.buddy_scale) || 1, LWMotion.HOME_MAX_SCALE);
    return [
      v.w - 200 + (LWMotion.DESK_ANCHOR_X + LWMotion.SCALE_ORIGIN_X * (1 - b)),
      v.h - 200 + (LWMotion.DESK_ANCHOR_Y + LWMotion.SCALE_ORIGIN_Y * (1 - b)),
    ];
  }
  if (snap && snap.home) {
    const [hx, hy, , , hs] = snap.home;
    const b = Math.min((snap.buddy_scale) || 1, LWMotion.HOME_MAX_SCALE);
    const f = hs || 1;
    return [
      hx + (LWMotion.DESK_ANCHOR_X + LWMotion.SCALE_ORIGIN_X * (1 - b)) * f,
      hy + (LWMotion.DESK_ANCHOR_Y + LWMotion.SCALE_ORIGIN_Y * (1 - b)) * f,
    ];
  }
  const m = deskMon();
  return [m.x + m.w - BW * m.k - 60, m.y + m.h - BH * m.k - 110];
}
function roamMonitors() { return (snap && snap.roam_all_monitors === false) ? [deskMon()] : monitorsCss(); }
function randomSpot() {
  const ms = roamMonitors(), m = ms[Math.floor(Math.random() * ms.length)];
  return [m.x + 20 + Math.random() * Math.max(1, m.w - BW * m.k - 40), m.y + m.h - BH * m.k - 60 - Math.random() * Math.min(200, m.h / 3)];
}
function route(from, to) { return LWMotion.route(from, to, monitorsCss(), centerOf); }
function setGoal(t, slack = 2) {
  if (!t) return;
  if (goal && Math.hypot(goal[0] - t[0], goal[1] - t[1]) < slack) return;
  goal = t; path = pos ? route(pos, t) : [t];
}
const atGoal = () => !path.length;
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
function say(text, ms) {
  if (!text) return;
  bubble.textContent = text;
  bubble.classList.add('on');
  clearTimeout(bubbleT);
  bubbleT = setTimeout(() => bubble.classList.remove('on'), ms || 5000);
}
function pickEdge() {
  const ms = roamMonitors(), all = monitorsCss(), VIS = 0.45, spots = [];
  const adjL = m => all.some(o => o.i !== m.i && Math.abs(o.x + o.w - m.x) < 2 && o.y < m.y + m.h && o.y + o.h > m.y);
  const adjR = m => all.some(o => o.i !== m.i && Math.abs(o.x - (m.x + m.w)) < 2 && o.y < m.y + m.h && o.y + o.h > m.y);
  for (const m of ms) {
    const w = BW * m.k;
    const y = m.y + m.h - BH * m.k - 60 - Math.random() * Math.min(150, m.h / 4);
    if (!adjL(m)) spots.push({ side: 'left', pos: [m.x - w * (1 - VIS), y] });
    if (!adjR(m)) spots.push({ side: 'right', pos: [m.x + m.w - w * VIS, y] });
  }
  if (!spots.length) return null;
  const h = spots[Math.floor(Math.random() * spots.length)];
  h.face = ['shy', 'curious', 'excited'][Math.floor(Math.random() * 3)];
  h.dur = 6000 + Math.random() * 9000;
  return h;
}
function playBox(c) {
  const m = monitorAt(c, roamMonitors());
  const pad = 48;
  let x0 = m.x + pad, y0 = m.y + pad, x1 = m.x + m.w - pad, y1 = m.y + m.h - pad;
  if (embedded && m.h > 420) y1 = Math.min(y1, m.y + m.h - 210);
  if (x1 < x0) { const mid = m.x + m.w / 2; x0 = mid; x1 = mid; }
  if (y1 < y0) { const mid = m.y + m.h / 2; y0 = mid; y1 = mid; }
  return { x0, y0, x1, y1 };
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
  say(raw.replaceAll('{buddy}', snap.buddy || 'Buddy'), 4000);
  setTimeout(() => { celebrating = false; if (T) T.core.invoke('focus_finish').catch(() => {}); }, 1200);
}
function bodyCenter(k) { return [pos[0] + LWGames.BODY_X * k, pos[1] + LWGames.BODY_Y * k]; }
function setCenter(c, k) { pos = [c[0] - LWGames.BODY_X * k, c[1] - LWGames.BODY_Y * k]; }
function lookOf(c) { return gameCursor && gameCursor[0] < c[0] ? 'left' : 'right'; }
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
  if (embedded) return layCovers(k);
  const ms = monitorsCss();
  const r = snap && snap.fg_rect;
  if (r && r[2] > 40 && r[3] > 40) {
    const m = LWMotion.monitorForWindow(r[0], r[1], r[0] + r[2], r[1] + r[3], ms);
    const spot = LWMotion.watchGoal(r[0], r[1], r[0] + r[2], r[1] + r[3], m, BW, BH, k);
    const look = LWMotion.lookToward(spot[0] + BW * k / 2, r[0] + r[2] / 2, m.x + m.w / 2) || 'right';
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
    const v = viewBox();
    if (mem.placed && mem.viewW && (Math.abs(v.w - mem.viewW) > 80 || Math.abs(v.h - mem.viewH) > 80)) mem.placed = false;
    if (!mem.placed) {
      const spot = warmerSpot(k);
      mem.placed = true;
      mem.look = spot.look;
      mem.side = spot.side || null;
      mem.viewW = v.w;
      mem.viewH = v.h;
      if (spot.shapes) {
        pos = spot.pos.slice();
        path = [];
        goal = pos.slice();
        paintCovers(spot.shapes);
        placeHit(spot.side);
        applyLook('peeking', mem.look);
        ch.setFace('curious');
      } else {
        setGoal(spot.pos);
        ch.setFace('curious');
        ch.setBody('walking');
      }
    }
    if (path.length) return;
    applyLook('peeking', mem.look);
    ch.setFace('curious');
    if (gameCursor) {
      const c = bodyCenter(k);
      const dist = Math.hypot(gameCursor[0] - c[0], gameCursor[1] - c[1]);
      const word = LWGames.warmerWord(dist, mem.dist);
      mem.dist = dist;
      if (word && word !== mem.word) {
        mem.word = word;
        say(word === 'warmer' ? 'Warmer.' : 'Colder.', 1400);
      }
    }
    return;
  }
  path = [];
  if (!gameCursor) return;
  const c = bodyCenter(k);
  if (id === 'tag') {
    const speed = ((snap.walk_speed) || 96) * k * 1.45;
    const next = LWGames.tag(c, gameCursor, dt, speed, playBox(c));
    const dx = next[0] - c[0];
    setCenter(next, k);
    if (Math.abs(dx) > 0.4) ch.setWalkDir(dx < 0 ? 'left' : 'right');
    return;
  }
  if (id === 'redlight') {
    const n = LWGames.redlight(c, gameCursor, dt, LWGames.CATCH_R * k, playBox(c), mem);
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
    if (!n.caught && clicked && n.hits > 0 && n.hits < LWGames.HIGHFIVE_GOAL) say(n.hits === 1 ? 'One!' : 'Two!', 900);
    return;
  }
  const speed = ((snap.walk_speed) || 96) * k * 2.2;
  const n = LWGames.chase(c, gameCursor, dt, speed, LWGames.CATCH_R * k);
  const dx = n.pos[0] - c[0];
  setCenter(n.pos, k);
  if (Math.abs(dx) > 0.4) ch.setWalkDir(dx < 0 ? 'left' : 'right');
  if (n.caught) beginCheer();
}
function faceWatch() {
  if (!snap || !snap.watch || !pos) return;
  const w = snap.watch;
  const m = LWMotion.monitorForWindow(w.x, w.y, w.x + w.w, w.y + w.h, monitorsCss(), watchMon);
  const k = kNow || m.k || 1;
  const spanL = Math.max(w.x, m.x), spanR = Math.min(w.x + w.w, m.x + m.w);
  const look = LWMotion.lookToward(pos[0] + BW * k / 2, (spanL + spanR) / 2, m.x + m.w / 2, 24) || visualLook();
  ch.setFace('curious');
  applyLook(LWCharacter.supportsBody('watching') ? 'watching' : 'peeking', look);
}
function syncPose(mode) {
  if (mode !== 'watch') watchMon = null;
  if (mode === lastMode) return;
  handedOff = false; arrivedSent = false; settling = false;
  if (mode === 'race_back') { raceHoldUntil = Date.now() + LWDomain.RACE_HOLD_MS; ch.setFace('excited'); ch.setBody('idle'); rushing = false; }
  else if (mode === 'watch') { ch.setFace('curious'); applyLook('walking', visualLook()); }
  else ch.setState(mode);
  const line = { asleep: 'sleeping', wander: 'wandering', watch: 'watchingVideo', race_back: 'backToWork' }[mode];
  if (line) say(LWContent.line(line, { buddy: (snap && snap.buddy) || 'Buddy' }));
  lastMode = mode; wanderGoal = null; hide = null;
}
function syncPath(mode) {
  const holdingRace = mode === 'race_back' && Date.now() < raceHoldUntil;
  if (holdingRace) { path = []; goal = pos.slice(); return; }
  if (mode === 'race_back' && !rushing) {
    rushing = true; ch.setState('race_back');
    const t = raceTarget();
    ch.setWalkDir(t[0] < pos[0] ? 'left' : 'right');
    setGoal(t);
  }
  if (mode === 'wander') {
    if (hide) {
      if (atGoal() && !hide.since) { hide.since = Date.now(); ch.setFace(hide.face); applyLook('peeking', LWMotion.hideLook(hide.side, false)); }
      if (hide.since && Date.now() - hide.since > hide.dur) { hide = null; ch.setState('wander'); wanderGoal = randomSpot(); }
    } else if (!wanderGoal || atGoal()) {
      hide = Math.random() < 0.4 ? pickEdge() : null;
      if (!hide) wanderGoal = randomSpot();
    }
    setGoal(hide ? hide.pos : wanderGoal, hide ? 8 : 2);
  } else if (mode === 'watch' && snap.watch) {
    const w = snap.watch;
    watchMon = LWMotion.monitorForWindow(w.x, w.y, w.x + w.w, w.y + w.h, monitorsCss(), watchMon);
    setGoal(LWMotion.watchGoal(w.x, w.y, w.x + w.w, w.y + w.h, watchMon, BW, BH, watchMon.k), 16);
    if (atGoal()) faceWatch();
    else { ch.setFace('curious'); applyLook('walking', visualLook()); }
  } else if (LWDomain.atHome(mode)) { pos = deskPos(); path = []; goal = pos.slice(); }
  else if (mode !== 'watch') setGoal(mode === 'race_back' ? raceTarget() : deskPos());
}
function focusOut(s) {
  const phase = s && s.focus_phase;
  return phase === 'ask' || phase === 'explain' || phase === 'play' || phase === 'back';
}
function showFocus(s) {
  const phase = s.focus_phase;
  const modeName = phase === 'play' ? 'game' : 'focus_' + phase;
  const entering = lastMode !== modeName;
  if (entering) {
    hide = null; handedOff = false; settling = false; arrivedSent = false;
    if (phase === 'play') { gameMem = null; gameClick = false; path = []; goal = pos ? pos.slice() : goal; }
    if (phase === 'back') { focusBackSent = false; rushing = true; }
    if (phase === 'ask' || phase === 'explain') rushing = false;
  }
  lastMode = modeName;
  comp.style.visibility = 'visible';
  if (phase === 'ask' || phase === 'explain') {
    setGoal(focusCenter(), 16);
    if (!path.length) { ch.setFace('curious'); applyLook('idle', visualLook()); }
    else if (ch.el.getAttribute('data-body') !== 'walking') { ch.setFace('curious'); applyLook('walking', visualLook()); }
  } else if (phase === 'back') {
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
  if (s.page_color) document.body.style.background = s.page_color;
  if (!(s.focus_phase === 'play' && s.focus_game === 'warmer')) { clearCovers(); placeHit(null); }
  if (!pos) pos = deskPos();
  const mode = s.paused ? 'paused' : s.mode;
  ch.setColors(s.colors);
  ch.setTool(s.tool);
  bubble.style.fontSize = (s.bubble_px || 12) + 'px';
  note.classList.toggle('on', s.focus_phase === 'play');
  if (focusOut(s)) { showFocus(s); return; }
  if (celebrating) celebrating = false;
  gameMem = null;
  gameClick = false;
  comp.style.visibility = handedOff ? 'hidden' : 'visible';
  syncPose(mode);
  syncPath(mode);
  if (hatsApi) hatsApi.apply(s);
}
function cardRect(k) {
  const sw = BW * k, sh = BH * k;
  const vw = document.documentElement.clientWidth || (view.width - 16);
  const vh = document.documentElement.clientHeight || (view.height - 40);
  const frameW = Math.max(0, view.width - vw);
  const frameH = Math.max(0, view.height - vh);
  const width = Math.max(180, Math.ceil(sw + 16 + frameW));
  const height = Math.max(200, Math.ceil(sh + 72 + frameH));
  const insetX = window.screenX - view.left;
  const insetY = window.screenY - view.top;
  let vx = Math.round(pos[0] - 8);
  let vy = Math.round(pos[1] - 56);
  const m = monitorAt([pos[0] + sw / 2, pos[1] + sh / 2]);
  vx = Math.max(m.x, Math.min(vx, m.x + m.w - Math.min(width, m.w)));
  vy = Math.max(m.y, Math.min(vy, m.y + m.h - Math.min(height, m.h)));
  return { left: Math.round(vx - insetX), top: Math.round(vy - insetY), width: Math.min(width, m.w), height: Math.min(height, m.h) };
}
function playRect() {
  const m = monitorAt(pos || [0, 0]);
  return {
    left: Math.round(m.x),
    top: Math.round(m.y),
    width: Math.max(220, Math.round(m.w) - 16),
    height: Math.max(220, Math.round(m.h) - 16),
  };
}
function moveWindow(now) {
  if (embedded) return;
  if (!winId || !pos || !snap || now - lastMove < 50) return;
  const playing = snap.focus_phase === 'play';
  const rect = playing ? playRect() : cardRect(kNow || 1);
  if (Math.abs(rect.left - view.left) < 1 && Math.abs(rect.top - view.top) < 1 && Math.abs(rect.width - view.width) < 1 && Math.abs(rect.height - view.height) < 1) return;
  const insetX = window.screenX - view.left, insetY = window.screenY - view.top;
  view.left = rect.left; view.top = rect.top; view.width = rect.width; view.height = rect.height;
  view.screenX = rect.left + insetX; view.screenY = rect.top + insetY;
  lastMove = now;
  const extra = {};
  if (playing && !playFocused) { playFocused = true; extra.focused = true; }
  if (!playing) playFocused = false;
  chrome.windows.update(winId, Object.assign({
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }, extra)).catch(() => {});
}
function placeSprite() {
  const k = kNow || 1;
  const left = embedded ? pos[0] : pos[0] - window.screenX;
  const top = embedded ? pos[1] : pos[1] - window.screenY;
  comp.style.left = left + 'px';
  comp.style.top = top + 'px';
  comp.style.transform = Math.abs(k - 1) > 1e-3 ? 'scale(' + k + ')' : '';
  const sw = BW * k, sh = BH * k;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  let l = 0, r = 0, t = 0, b = 0;
  if (left < 0) l = -left;
  if (top < 0) t = -top;
  if (left + sw > vw) r = left + sw - vw;
  if (top + sh > vh) b = top + sh - vh;
  comp.style.clipPath = (l || r || t || b) ? 'inset(' + (t / k) + 'px ' + (r / k) + 'px ' + (b / k) + 'px ' + (l / k) + 'px)' : '';
}
function frame(t) {
  const dt = lastT == null ? 0 : LWMotion.clampDt(t - lastT);
  lastT = t;
  if (pos && snap && ch) {
    const kTarget = scaleAt(pos);
    kNow = kNow == null ? kTarget : LWMotion.smoothScale(kNow, kTarget, dt);
    stepGame(dt);
    if (path.length) {
      const walk = (snap && snap.walk_speed) || 96;
      const speedMode = lastMode === 'focus_back' ? 'race_back'
        : (lastMode === 'focus_ask' || lastMode === 'focus_explain') ? 'wander'
        : (lastMode === 'wander' || lastMode === 'watch' || lastMode === 'race_back' ? lastMode : 'home');
      const n = LWMotion.step(pos, path[0], vel, LWMotion.modeSpeed(speedMode, walk), dt, kNow);
      const dx = path[0][0] - pos[0];
      pos = n.pos; vel = path.length > 1 && n.arrived ? n.v || vel : n.v;
      if (n.arrived) path.shift();
      const bodyNow = ch.el.getAttribute('data-body');
      const travel = bodyNow === 'walking' || bodyNow === 'rushing' || bodyNow === 'racing';
      if (path.length && Math.abs(dx) > 1 && !(hide && hide.since) && travel) ch.setWalkDir(dx < 0 ? 'left' : 'right');
    } else vel = 0;
    if (lastMode === 'watch' && snap.watch) { if (path.length) { ch.setFace('curious'); applyLook('walking', visualLook()); } else faceWatch(); }
    if ((lastMode === 'focus_ask' || lastMode === 'focus_explain') && !path.length) { ch.setFace('curious'); applyLook('idle', visualLook()); }
    if (lastMode === 'focus_back' && !focusBackSent) {
      const target = raceTarget(kNow);
      if (path.length) path[path.length - 1] = target; else if (Math.hypot(target[0] - pos[0], target[1] - pos[1]) > 0.5) setGoal(target);
      const left = Math.hypot(target[0] - pos[0], target[1] - pos[1]);
      if (left < 24 * kNow && !settling) { settling = true; ch.setBody('idle'); }
      if (left <= 2) { focusBackSent = true; if (T) T.core.invoke('focus_back').catch(() => {}); }
    }
    if (lastMode === 'race_back' && rushing && !arrivedSent) {
      const target = raceTarget(kNow);
      if (path.length) path[path.length - 1] = target; else if (Math.hypot(target[0] - pos[0], target[1] - pos[1]) > 0.5) setGoal(target);
      const left = Math.hypot(target[0] - pos[0], target[1] - pos[1]);
      if (left < 24 * kNow && !settling) { settling = true; ch.setBody('idle'); }
      if (left <= 2) { arrivedSent = true; if (T) T.core.invoke('race_arrived').catch(() => {}); }
    }
    moveWindow(t);
    placeSprite();
  }
  requestAnimationFrame(frame);
}

hit.addEventListener('click', () => {
  if (!snap || !T) return;
  const phase = snap.focus_phase;
  const id = snap.focus_game;
  if (phase === 'explain' || (phase === 'play' && (id === 'tag' || id === 'highfive' || id === 'warmer'))) {
    T.core.invoke('focus_tag').catch(() => {});
  }
});
document.addEventListener('mousemove', e => {
  gameCursor = embedded ? [e.clientX, e.clientY] : [e.screenX, e.screenY];
});

(async () => {
  if (!embedded) {
    const win = await chrome.windows.getCurrent();
    winId = win.id;
    view = { left: win.left, top: win.top, width: win.width, height: win.height, screenX: window.screenX, screenY: window.screenY };
  }
  ch = await LWCharacter.mount($('charHost'));
  if (T) { hatsApi = LWCharacter.bindHats((c, a) => T.core.invoke(c, a), ch, () => snap); await hatsApi.refresh(); }
  if (T) { try { games = await T.core.invoke('list_games') || []; } catch (_) { games = []; } }
  await LWContent.ready;
  requestAnimationFrame(frame);
  if (!T) return;
  const s = await T.core.invoke('get_snapshot');
  if (s) onState(s);
  T.event.listen('companion-state', e => onState(e.payload));
  T.event.listen('handoff', () => { if (lastMode === 'race_back') { handedOff = true; comp.style.visibility = 'hidden'; } });
  T.event.listen('settings-changed', async () => {
    try { games = await T.core.invoke('list_games') || []; } catch (_) {}
    if (hatsApi) hatsApi.refresh();
  });
  T.event.listen('tag-click', () => {
    if (!snap || celebrating || snap.focus_phase !== 'play') return;
    if (snap.focus_game === 'highfive') { gameClick = true; return; }
    beginCheer();
  });
  T.event.listen('focus-say', e => {
    const p = e.payload || {};
    if (LWDomain.focusAtDesk(snap)) return;
    const buddy = (snap && snap.buddy) || 'Buddy';
    const text = p.text || (p.kind === 'invite' ? LWContent.line('focusBreak', { buddy }) : '');
    if (text) say(text, p.kind === 'ask' || p.kind === 'explain' || p.kind === 'decline' ? 9000 : 5000);
  });
})();
