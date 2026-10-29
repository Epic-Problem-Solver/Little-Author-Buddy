// Chrome OS / browser shell. The session rules live in engine.js.
// This file only adapts them to the windows, tabs, and storage Chrome provides.
importScripts('ui/assets/lw-color.js', 'engine.js');

const DOWNLOAD = 'https://epic-problem-solver.github.io/Little-Author-Buddy/little-writer-companion/download/';
const RELEASES = 'https://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/latest';
const HOME_W = 230;
const HOME_H = 240;
const FALLBACK_MONITOR = { x: 0, y: 0, w: 1280, h: 800, scale: 1, primary: true };

let session = null;
let quit = false;
let bootP = null;
let timer = null;
let ticking = false;
let lastSave = 0;
let flagSig = '';
let stageDismissed = false;
let stageLock = null;
let warnedTop = false;
let frameMode = 'desk';
let placing = false;
let placedAt = 0;
const ports = new Set();
const wins = { home: null, stage: null, settings: null, onboarding: null, letter: null, welcome: null, games: null };
const closing = new Set();

function b64ToBytes(text) {
  const bin = atob(String(text || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflateRaw(comp, limit) {
  if (typeof DecompressionStream !== 'function') {
    const err = new Error('Read');
    err.install = 'Read';
    throw err;
  }
  const reader = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let n = 0;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      n += step.value.byteLength;
      if (n > limit) {
        const err = new Error('Unsafe');
        err.install = 'Unsafe';
        throw err;
      }
      chunks.push(step.value);
    }
  } catch (e) {
    try { await reader.cancel(); } catch (_) {}
    if (e && e.install) throw e;
    const err = new Error('Read');
    err.install = 'Read';
    throw err;
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

function emit(name, payload) {
  for (const port of ports) {
    try { port.postMessage({ event: name, payload }); } catch (_) { ports.delete(port); }
  }
}

function buddyHome() {
  const s = session && session.snap;
  if (!s) return true;
  if (s.focus_phase && s.focus_phase !== 'idle') return false;
  return s.mode === 'typing' || s.mode === 'asleep';
}

function isAway() {
  const s = session && session.snap;
  if (!s || s.paused) return false;
  const phase = s.focus_phase;
  if (phase === 'ask' || phase === 'explain' || phase === 'play' || phase === 'back') return true;
  return s.mode === 'wander' || s.mode === 'watch' || s.mode === 'race_back';
}

function packMachine(m) {
  return {
    mode: m.mode,
    lastKey: m.lastKey,
    wanderAt: Number.isFinite(m.wanderAt) ? m.wanderAt : null,
    raceUntil: m.raceUntil || 0,
  };
}

function unpackMachine(m, now) {
  if (!m || !m.mode) return null;
  if (['typing', 'asleep', 'wander', 'watch', 'race_back'].indexOf(m.mode) < 0) return null;
  return {
    mode: m.mode,
    lastKey: Number.isFinite(m.lastKey) ? m.lastKey : now,
    wanderAt: m.wanderAt == null ? Infinity : m.wanderAt,
    raceUntil: m.raceUntil || 0,
  };
}

function unpackFocus(f) {
  if (!f || !f.phase) return null;
  if (['idle', 'ask', 'explain', 'play', 'back'].indexOf(f.phase) < 0) return null;
  return {
    elapsed_ms: f.elapsed_ms | 0,
    ready: !!f.ready,
    running: !!f.running,
    held: !!f.held,
    phase: f.phase,
    game: f.game || '',
    play_ms: f.play_ms | 0,
    anchor: Array.isArray(f.anchor) ? f.anchor : null,
    prompt: f.prompt === 'sprint' || f.prompt === 'game' || f.prompt === 'again' ? f.prompt : '',
    sprint_minutes: Math.max(0, f.sprint_minutes | 0),
  };
}

function badge() {
  const text = session && session.paused && !quit ? 'II' : '';
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ color: '#241414' }).catch(() => {});
}

async function syncFlags() {
  if (!session) return;
  const asking = session.focus.phase === 'ask';
  const sig = (quit ? 'q' : '') + (session.paused ? 'p' : '') + (asking ? 'a' : '');
  if (sig === flagSig) return;
  flagSig = sig;
  await chrome.storage.session.set({ live: !quit, paused: !!session.paused, asking });
  badge();
}

async function persist(force) {
  if (!session) return;
  const now = Date.now();
  if (!force && now - lastSave < 2000) return;
  lastSave = now;
  const asking = session.focus.phase === 'ask';
  flagSig = (quit ? 'q' : '') + (session.paused ? 'p' : '') + (asking ? 'a' : '');
  await chrome.storage.session.set({
    focus: session.focus,
    machine: packMachine(session.machine),
    paused: !!session.paused,
    live: !quit,
    asking,
  });
  if (session.dirty || force) {
    session.dirty = false;
    await chrome.storage.local.set({ state: LWC.saveJson(session) });
  }
  badge();
}

async function loadMonitors() {
  try {
    const info = await chrome.system.display.getInfo();
    const mons = (info || []).map(d => ({
      x: d.bounds.left,
      y: d.bounds.top,
      w: d.bounds.width,
      h: d.bounds.height,
      scale: (d.dpiX || 96) / 96,
      primary: !!d.isPrimary,
    }));
    LWC.setMonitors(session, mons.length ? mons : [FALLBACK_MONITOR]);
  } catch (_) {
    LWC.setMonitors(session, [FALLBACK_MONITOR]);
  }
}

function primary() {
  return (session.monitors || []).find(m => m.primary) || (session.monitors || [])[0] || FALLBACK_MONITOR;
}

function deskSpot() {
  const mons = (session && session.monitors) || [];
  const idx = session && session.data.settings.desk_monitor;
  if (Number.isInteger(idx) && mons[idx]) {
    const m = mons[idx];
    const marginX = 20 * (m.scale || 1);
    const marginY = 60 * (m.scale || 1);
    return {
      left: Math.max(m.x, Math.round(m.x + m.w - HOME_W - marginX)),
      top: Math.max(m.y, Math.round(m.y + m.h - HOME_H - marginY)),
    };
  }
  const p = LWC.placeHome(null, [HOME_W, HOME_H], mons) || [80, 80];
  return { left: p[0], top: p[1] };
}

function wantGameFrame() {
  const phase = session && session.focus && session.focus.phase;
  return phase === 'explain' || phase === 'play' || phase === 'back';
}

function centerOn(w, h) {
  const m = primary();
  return {
    left: Math.round(m.x + Math.max(0, m.w - w) / 2),
    top: Math.round(m.y + Math.max(0, m.h - h) / 2),
  };
}

// Chrome rejects windows.create and windows.update when left, top, width, or height
// is a fractional number. Display bounds and the scale margin often are.
function wholePx(n, fallback) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? v : fallback;
}

async function popup(key, url, opts) {
  const create = extra => chrome.windows.create(Object.assign({
    url,
    type: 'popup',
    width: wholePx(opts.width, 200),
    height: wholePx(opts.height, 200),
    left: wholePx(opts.left, 0),
    top: wholePx(opts.top, 0),
    focused: opts.focused !== false,
  }, extra || {}));
  let win;
  const wantTop = !!opts.alwaysOnTop;
  try {
    win = await create(wantTop ? { alwaysOnTop: true } : {});
  } catch (e) {
    if (!wantTop) throw e;
    win = await create({});
    if (!warnedTop && session) {
      warnedTop = true;
      session.warnings.push('This Chrome could not keep the companion above other windows.');
      session.snap = LWC.paint(session);
      emit('companion-state', session.snap);
    }
  }
  wins[key] = win.id;
  return win;
}

async function closeWin(key) {
  const id = wins[key];
  if (id == null) return;
  closing.add(id);
  wins[key] = null;
  try { await chrome.windows.remove(id); } catch (_) {}
}

async function adoptWindows() {
  let all = [];
  try { all = await chrome.windows.getAll({ populate: true }); } catch (_) { return; }
  const base = chrome.runtime.getURL('ui/');
  for (const w of all) {
    const url = (w.tabs && w.tabs[0] && w.tabs[0].url) || '';
    if (url.indexOf(base) !== 0) continue;
    if (url.indexOf('home.html') >= 0) wins.home = w.id;
    else if (url.indexOf('stage.html') >= 0) wins.stage = w.id;
    else if (url.indexOf('settings.html') >= 0) wins.settings = w.id;
    else if (url.indexOf('onboarding.html') >= 0) wins.onboarding = w.id;
    else if (url.indexOf('letter.html') >= 0) wins.letter = w.id;
    else if (url.indexOf('welcome.html') >= 0) wins.welcome = w.id;
    else if (url.indexOf('games.html') >= 0) wins.games = w.id;
  }
}

async function ensureHome() {
  if (quit || !session) return;
  if (wins.home != null) {
    try { await chrome.windows.get(wins.home); return; } catch (_) { wins.home = null; }
  }
  const spot = deskSpot();
  LWC.noteHome(session, spot.left, spot.top, HOME_W, HOME_H, Date.now());
  session.snap = LWC.paint(session);
  frameMode = 'desk';
  placedAt = Date.now();
  const win = await popup('home', chrome.runtime.getURL('ui/home.html'), {
    width: HOME_W, height: HOME_H, left: spot.left, top: spot.top, focused: false, alwaysOnTop: true,
  });
  try {
    const got = await chrome.windows.get(win.id);
    LWC.noteHome(session, got.left, got.top, got.width, got.height, Date.now());
    session.snap = LWC.paint(session);
  } catch (_) {}
}

async function openGames() {
  if (!session || quit) return;
  if (wins.games != null) {
    try { await chrome.windows.update(wins.games, { focused: true }); return; }
    catch (_) { wins.games = null; }
  }
  const spot = centerOn(420, 560);
  await popup('games', chrome.runtime.getURL('ui/games.html'), {
    width: 420, height: 560, left: spot.left, top: spot.top, focused: true, alwaysOnTop: false,
  });
}

async function openSettings(tab) {
  if (!session || quit) return;
  const name = String(tab || 'settings');
  session.settingsTab = name;
  if (wins.settings != null) {
    try {
      await chrome.windows.update(wins.settings, { focused: true });
      emit('show-tab', name);
      return;
    } catch (_) { wins.settings = null; }
  }
  const spot = centerOn(580, 680);
  await popup('settings', chrome.runtime.getURL('ui/settings.html'), {
    width: 580, height: 680, left: spot.left, top: spot.top, focused: true, alwaysOnTop: false,
  });
}

async function openOnboarding() {
  if (!session || quit) return;
  if (wins.onboarding != null) {
    try { await chrome.windows.update(wins.onboarding, { focused: true }); return; } catch (_) { wins.onboarding = null; }
  }
  const spot = centerOn(480, 600);
  await popup('onboarding', chrome.runtime.getURL('ui/onboarding.html'), {
    width: 480, height: 600, left: spot.left, top: spot.top, focused: true, alwaysOnTop: true,
  });
}

async function openWelcome() {
  if (!session || quit || !session.welcomeDue) return false;
  if (wins.welcome != null) {
    try { await chrome.windows.update(wins.welcome, { focused: true }); return true; }
    catch (_) { wins.welcome = null; }
  }
  const spot = centerOn(440, 560);
  try {
    await popup('welcome', chrome.runtime.getURL('ui/welcome.html'), {
      width: 440, height: 560, left: spot.left, top: spot.top, focused: true, alwaysOnTop: true,
    });
  } catch (_) { return false; }
  return wins.welcome != null;
}

async function showWelcome() {
  if (!session || quit || session.data.onboarded === false || !session.welcomeDue) return;
  const opened = await openWelcome();
  if (!opened) return;
  session.data.seen_version = LWC.APP_VERSION;
  session.welcomeDue = false;
  session.dirty = true;
}

async function openLetter(project) {
  if (!session || !project) return;
  const q = encodeURIComponent(JSON.stringify({
    name: project.name,
    tier: project.tier,
    target_words: project.target_words,
    completed_at: project.completed_at,
    completed_count: session.snap ? session.snap.completed_count : 1,
    buddy: session.data.settings.buddy_name,
  }));
  await closeWin('letter');
  const home = session.homeRect || { x: 200, y: 200 };
  await popup('letter', chrome.runtime.getURL('ui/letter.html') + '?p=' + q, {
    width: 360,
    height: 280,
    left: Math.max(0, home.x - 160),
    top: Math.max(0, home.y - 300),
    focused: true,
    alwaysOnTop: true,
  });
}

async function placeDesk(blur) {
  if (wins.home == null || placing) return;
  placing = true;
  placedAt = Date.now();
  const spot = deskSpot();
  const update = {
    state: 'normal',
    left: wholePx(spot.left, 0),
    top: wholePx(spot.top, 0),
    width: wholePx(HOME_W, HOME_W),
    height: wholePx(HOME_H, HOME_H),
  };
  if (blur) update.focused = false;
  try {
    await chrome.windows.update(wins.home, update);
    const got = await chrome.windows.get(wins.home);
    LWC.noteHome(session, got.left, got.top, got.width, got.height, Date.now());
  } catch (_) {}
  placing = false;
}

async function fullscreenHome() {
  if (wins.home == null || placing) return;
  placing = true;
  placedAt = Date.now();
  try {
    await chrome.windows.update(wins.home, { state: 'fullscreen' });
    try { await chrome.windows.update(wins.home, { focused: true }); } catch (_) {}
  } catch (_) {
    const mons = session.monitors || [];
    const idx = session.data.settings.desk_monitor;
    const m = (Number.isInteger(idx) && mons[idx]) || primary();
    try {
      await chrome.windows.update(wins.home, {
        state: 'normal',
        focused: true,
        left: Math.round(m.x),
        top: Math.round(m.y),
        width: Math.max(HOME_W, Math.round(m.w)),
        height: Math.max(HOME_H, Math.round(m.h)),
      });
    } catch (_) {}
  }
  placing = false;
}

async function repinIfNeeded() {
  if (placing || wins.home == null || Date.now() - placedAt < 1000) return;
  let w;
  try { w = await chrome.windows.get(wins.home); } catch (_) { return; }
  const spot = deskSpot();
  const drifted = w.state === 'fullscreen' || w.state === 'maximized'
    || Math.abs(w.left - spot.left) > 24 || Math.abs(w.top - spot.top) > 24
    || Math.abs(w.width - HOME_W) > 80 || Math.abs(w.height - HOME_H) > 80;
  if (drifted) await placeDesk();
}

async function applyFrame() {
  if (!session || quit || wins.home == null) return;
  const mode = wantGameFrame() ? 'game' : 'desk';
  if (mode !== frameMode) {
    frameMode = mode;
    if (mode === 'game') await fullscreenHome();
    else await placeDesk(true);
    return;
  }
  if (mode === 'desk') await repinIfNeeded();
}

async function syncStageBody() {
  if (!session || quit) return;
  if (buddyHome()) stageDismissed = false;
  if (wins.stage != null) await closeWin('stage');
  await applyFrame();
}

function syncStage() {
  if (stageLock) return stageLock;
  stageLock = syncStageBody().finally(() => { stageLock = null; });
  return stageLock;
}

async function dispatch(events) {
  const files = [];
  for (const ev of events || []) {
    if (ev.name === 'quit') { await quitApp(); continue; }
    if (ev.name === 'open-settings') { await openSettings(ev.payload); continue; }
    if (ev.name === 'open-games') { await openGames(); continue; }
    if (ev.name === 'open-onboarding') { await openOnboarding(); continue; }
    if (ev.name === 'close-onboarding') { await closeWin('onboarding'); continue; }
    if (ev.name === 'close-welcome') { await closeWin('welcome'); continue; }
    if (ev.name === 'open-download') { chrome.tabs.create({ url: DOWNLOAD }); continue; }
    if (ev.name === 'journal-file') { if (ev.payload) files.push(ev.payload); continue; }
    if (ev.name === 'journal-files') { files.push(...(ev.payload || [])); continue; }
    if (ev.internal) continue;
    emit(ev.name, ev.payload);
    if (ev.name === 'project-complete') {
      await openSettings('projects');
      await openLetter(ev.payload);
    }
  }
  return files;
}

async function dismissStageActivity() {
  if (!session) return;
  const phase = session.focus.phase;
  let out = null;
  if (phase === 'play') out = LWC.invoke(session, 'focus_finish', {}, Date.now());
  else if (phase === 'back') out = LWC.invoke(session, 'focus_back', {}, Date.now());
  else if (phase === 'ask') {
    out = { events: LWC.applyAnswer(session, false) };
  } else if (phase === 'explain') {
    session.focus.phase = 'play';
    out = LWC.invoke(session, 'focus_finish', {}, Date.now());
  }
  if (!out) return;
  await dispatch(out.events);
  await persist(true);
  await syncStage();
}

async function step() {
  if (ticking || quit || !session) return;
  ticking = true;
  try {
    const now = Date.now();
    const result = LWC.tick(session, now, {});
    await dispatch(result.events);
    await syncFlags();
    await syncStage();
    if (session.dirty || now - lastSave >= 2000) await persist(false);
  } finally {
    ticking = false;
  }
}

function ensureTicker() {
  if (timer || quit) return;
  timer = setInterval(() => { step().catch(() => {}); }, 250);
}

async function checkUpdate() {
  const ctrl = new AbortController();
  const timerId = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(RELEASES, { signal: ctrl.signal });
    if (!res.url || !res.url.startsWith('https://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/')) {
      throw new Error('bad url');
    }
    const text = (await res.text()).slice(0, 32768);
    const tag = LWC.tagName(text);
    const status = tag && LWC.judgeUpdate(LWC.APP_VERSION, tag);
    if (!status) throw new Error('no tag');
    return status;
  } finally {
    clearTimeout(timerId);
  }
}

async function quitApp() {
  if (quit) return;
  quit = true;
  if (timer) { clearInterval(timer); timer = null; }
  if (session) {
    const pending = session.homeDb && session.homeDb.pending;
    if (pending) session.data.settings.home_pos = pending.slice();
    try { await chrome.storage.local.set({ quit: true, state: LWC.saveJson(session) }); } catch (_) {}
  } else {
    try { await chrome.storage.local.set({ quit: true }); } catch (_) {}
  }
  flagSig = 'q';
  try { await chrome.storage.session.set({ live: false, asking: false, paused: false }); } catch (_) {}
  const ids = Object.keys(wins).map(k => wins[k]).filter(id => id != null);
  for (const id of ids) closing.add(id);
  for (const k of Object.keys(wins)) wins[k] = null;
  for (const id of ids) { try { await chrome.windows.remove(id); } catch (_) {} }
  badge();
}

async function doBoot() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(['state', 'quit', 'packsCache']);
  const live = await chrome.storage.session.get(['focus', 'machine', 'paused']);
  quit = !!stored.quit;
  let saved = null;
  let corrupt = false;
  if (typeof stored.state === 'string' && stored.state) {
    try { saved = JSON.parse(stored.state); }
    catch (_) {
      corrupt = true;
      try { await chrome.storage.local.set({ ['state.corrupt-' + now]: stored.state }); } catch (_) {}
      try { await chrome.storage.local.remove('state'); } catch (_) {}
    }
  }
  session = LWC.createSession(now, corrupt ? null : saved);
  if (corrupt) session.warnings.push('Saved data was corrupt. A fresh profile started.');
  if (Array.isArray(stored.packsCache)) LWC.setPackFiles(session, stored.packsCache);
  const machine = unpackMachine(live.machine, now);
  if (machine) session.machine = machine;
  const focus = unpackFocus(live.focus);
  if (focus) session.focus = focus;
  if (live.paused != null) session.paused = !!live.paused;
  session.focusAt = now;
  await loadMonitors();
  const spot = deskSpot();
  LWC.noteHome(session, spot.left, spot.top, HOME_W, HOME_H, now);
  session.snap = LWC.paint(session);
  await adoptWindows();
  await syncFlags();
  if (quit) {
    for (const key of Object.keys(wins)) await closeWin(key);
    badge();
    return;
  }
  ensureTicker();
  await ensureHome();
  if (session.data.onboarded === false) await openOnboarding();
  else await showWelcome();
  await syncStage();
  await persist(true);
}

function boot() {
  if (!bootP) bootP = doBoot().catch(e => { bootP = null; throw e; });
  return bootP;
}

async function resume() {
  await boot();
  quit = false;
  stageDismissed = false;
  try { await chrome.storage.local.set({ quit: false }); } catch (_) {}
  await syncFlags();
  ensureTicker();
  await ensureHome();
  if (session && session.data.onboarded === false) await openOnboarding();
  else await showWelcome();
  await syncStage();
  if (session && session.dirty) await persist(false);
}

async function onMessage(msg) {
  await boot();
  if (!msg || !msg.type) return { ok: false, error: 'empty message' };
  if (msg.type === 'status') {
    return {
      ok: true,
      quit,
      paused: !!(session && session.paused),
      onboarded: !!(session && session.data.onboarded !== false),
    };
  }
  if (msg.type === 'resume') { await resume(); return { ok: true }; }
  if (quit || !session) return { ok: false, error: 'Little Author is not running' };
  if (msg.type === 'input') {
    LWC.addInput(session, msg.letters | 0, msg.wheels | 0);
    return { ok: true };
  }
  if (msg.type === 'answer') {
    const ev = LWC.applyAnswer(session, !!msg.yes);
    await dispatch(ev);
    await syncFlags();
    await syncStage();
    return { ok: true };
  }
  if (msg.type === 'home-pos') {
    if (wins.home != null) {
      try {
        const w = await chrome.windows.get(wins.home);
        LWC.noteHome(session, w.left, w.top, w.width, w.height, Date.now());
      } catch (_) {}
    }
    return { ok: true };
  }
  if (msg.type === 'activate') {
    try {
      const bytes = b64ToBytes(msg.b64 || '');
      const result = await LWC.installZip(bytes, inflateRaw);
      if (result.installed) {
        const merged = LWC.mergePacks(session.packFiles, result.packs);
        try {
          await chrome.storage.local.set({ packsCache: merged });
        } catch (_) {
          return { ok: true, value: { message: LWC.installErrorMessage('Write'), installed: false } };
        }
        LWC.setPackFiles(session, merged);
        session.snap = LWC.paint(session);
        emit('companion-state', session.snap);
        emit('settings-changed', null);
      }
      return { ok: true, value: { message: result.message, installed: !!result.installed } };
    } catch (e) {
      return { ok: true, value: { message: LWC.installErrorMessage(e && e.install), installed: false } };
    }
  }
  if (msg.type === 'packs') {
    const packs = Array.isArray(msg.packs) ? msg.packs : [];
    LWC.setPackFiles(session, packs);
    try { await chrome.storage.local.set({ packsCache: packs }); } catch (_) {}
    session.snap = LWC.paint(session);
    emit('companion-state', session.snap);
    emit('settings-changed', null);
    return { ok: true };
  }
  if (msg.type === 'invoke') {
    if (msg.cmd === 'check_update') {
      try { return { ok: true, value: await checkUpdate() }; }
      catch (_) { return { ok: false, error: "Couldn't reach GitHub." }; }
    }
    try {
      const out = LWC.invoke(session, msg.cmd, msg.args || {}, Date.now());
      const files = await dispatch(out.events);
      await syncFlags();
      await syncStage();
      if (session && session.dirty) await persist(false);
      return { ok: true, value: out.value, files: files.length ? files : undefined };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }
  return { ok: false, error: 'unknown message' };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  onMessage(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
  return true;
});

chrome.runtime.onConnect.addListener(port => {
  if (!port || port.name !== 'ui') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  boot().then(() => { if (!quit) ensureTicker(); }).catch(() => {});
});

chrome.windows.onRemoved.addListener(id => {
  let key = null;
  for (const k of Object.keys(wins)) if (wins[k] === id) key = k;
  if (key) wins[key] = null;
  if (closing.has(id)) { closing.delete(id); return; }
  if (key === 'home') { quitApp(); return; }
  if (key === 'stage') {
    if (isAway()) stageDismissed = true;
    dismissStageActivity().catch(() => {});
  }
});

chrome.windows.onBoundsChanged.addListener(win => {
  if (!session || placing || frameMode === 'game' || !win || win.id !== wins.home) return;
  LWC.noteHome(session, win.left, win.top, win.width, win.height, Date.now());
});

if (chrome.system && chrome.system.display && chrome.system.display.onDisplayChanged) {
  chrome.system.display.onDisplayChanged.addListener(() => {
    if (!session || quit) return;
    loadMonitors().then(() => { if (frameMode === 'desk') return placeDesk(); }).catch(() => {});
  });
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ quit: false }).finally(() => boot());
  }
});

chrome.runtime.onStartup.addListener(() => { bootP = null; session = null; boot(); });

chrome.alarms.create('wake', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm || alarm.name !== 'wake') return;
  boot().then(() => { if (!quit) ensureTicker(); }).catch(() => {});
});

boot();
