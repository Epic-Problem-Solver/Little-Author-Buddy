// Session engine for the Chrome port. Same rules as the desktop app:
// letter counts and timing only, titles never saved, focus streak not written
// into the save, packs are data (never scripts). No Chrome APIs in this file.
(function (root) {
  const APP_VERSION = '0.8.0';
  const SUGGEST_MS = 15 * 60 * 1000;
  const DEFAULT_BUDDY = 'Buddy';
  const MAX_FOCUS_MINUTES = 180;
  const PLAY_MS = 45000;
  const TEXT_MAX = 160;
  const ENGINES = ['chase', 'tag', 'redlight', 'highfive', 'warmer'];
  const FURNITURE = {
    desk: '#8a5a35', desk_shade: '#6e4527', tool: '#7d8aa0', tool_shade: '#56627a',
    screen: '#9fe3ff', ink: '#2f3a66', feather: '#f4f0ea', feather_shade: '#cbbfae',
    paper: '#f6efe2', paper_shade: '#d9cdb8',
  };
  const DEFAULT_BODY = '#e8cfa9';
  const OUTLINE = '#241414';

  function shadeOf(hex) {
    const f = root.lwDeriveShade;
    if (typeof f !== 'function') throw new Error('lw-color.js is not loaded');
    return f(hex);
  }
  function bodyAllowed(hex) {
    const f = root.lwBodyAllowed;
    if (typeof f !== 'function') throw new Error('lw-color.js is not loaded');
    return !!f(hex);
  }

  function defaultColors() {
    const shade = '#b77d48';
    return Object.assign({ body: DEFAULT_BODY, shade, hands: shade, outline: OUTLINE }, FURNITURE);
  }
  function deriveColors(raw) {
    const c = Object.assign(defaultColors(), raw || {});
    Object.assign(c, FURNITURE);
    c.outline = OUTLINE;
    if (!bodyAllowed(c.body)) c.body = DEFAULT_BODY;
    const shade = shadeOf(c.body);
    c.shade = shade;
    c.hands = shade;
    return c;
  }
  function defaultSettings() {
    return {
      keys_per_word: 5,
      idle_threshold_ms: 20000,
      wander_min_ms: 60000,
      wander_max_ms: 300000,
      race_back_ms: 1500,
      distraction_titles: ['YouTube', 'Netflix', 'Reddit', 'VLC', 'Twitch', 'Disney+', 'Prime Video', 'TikTok'],
      detect_titles: true,
      detect_media: true,
      detect_scroll: true,
      scroll_events_threshold: 12,
      scroll_window_ms: 6000,
      colors: defaultColors(),
      tiers: { short_story: 3000, novella: 30000, novel: 60000 },
      desk_monitor: null,
      roam_all_monitors: true,
      journal_dir: null,
      tool: 'pen',
      unlock_all: false,
      home_pos: null,
      buddy_name: DEFAULT_BUDDY,
      buddy_scale: 1,
      walk_speed: 96,
      bubble_px: 12,
      hat: '',
      hat_color: '',
      hat_extra: false,
      focus_minutes: 30,
      page_color: '#f6efe2',
    };
  }
  function defaultData() {
    return {
      settings: defaultSettings(),
      active: null,
      queue: [],
      completed: [],
      total_keystrokes: 0,
      daily: [],
      journal: [],
      carry_keystrokes: 0,
      awaiting_next: false,
      onboarded: false,
      seen_version: '',
    };
  }
  function freshFocus() {
    return { elapsed_ms: 0, ready: false, running: false, held: false, phase: 'idle', game: '', play_ms: 0, anchor: null, prompt: '', sprint_minutes: 0 };
  }
  function freshMachine(now) {
    return { mode: 'typing', lastKey: now, wanderAt: Infinity };
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function finite(v, d) { return Number.isFinite(v) ? v : d; }
  function takeChars(s, n) { return Array.from(String(s)).slice(0, n).join(''); }
  function dayString(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function versionParts(raw) {
    const t = String(raw || '').trim().replace(/^v/, '');
    const bits = t.split('.');
    if (!bits.length || bits.length > 3) return null;
    const p = [0, 0, 0];
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      if (!b || !/^[0-9]+$/.test(b) || b.length > 6) return null;
      p[i] = Number(b);
    }
    return p;
  }
  function versionAtMost(min, cur) {
    const a = versionParts(min), b = versionParts(cur);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
    return true;
  }
  function cmpVer(a, b) {
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
    return 0;
  }
  function idOk(id) {
    return typeof id === 'string' && id.length >= 1 && id.length <= 32 && /^[a-z0-9-]+$/.test(id);
  }
  function hexOk(raw) {
    const t = String(raw || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(t) ? t.toLowerCase() : null;
  }
  function cleanLabel(raw) {
    const t = Array.from(String(raw || '')).filter(c => c >= ' ' && c !== '\u007f').slice(0, 48).join('').trim();
    return t || null;
  }
  function lineText(raw, required) {
    const t = Array.from(String(raw || '')).filter(c => c >= ' ' && c !== '\u007f').slice(0, TEXT_MAX).join('').trim();
    if (!t) return required ? null : '';
    return t;
  }
  function clampKpw(v) { v = Number(v); if (!Number.isFinite(v)) return 5; return clamp(Math.round(v), 1, 5); }
  function clampFocus(v) { v = Number(v); if (!Number.isFinite(v) || v < 0) return 0; return Math.min(MAX_FOCUS_MINUTES, Math.round(v)); }
  function clampTitles(titles) {
    const out = [];
    for (const t of titles || []) {
      const s = takeChars(String(t).trim(), 80);
      if (s) out.push(s);
      if (out.length >= 32) break;
    }
    return out;
  }
  function clampMotion(s) {
    const f = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);
    s.buddy_scale = f(Number(s.buddy_scale), 0.6, 1.6, 1);
    s.walk_speed = f(Number(s.walk_speed), 40, 300, 96);
    s.bubble_px = f(Number(s.bubble_px), 9, 20, 12);
  }
  function journalOk(raw) {
    if (raw == null) return null;
    const t = String(raw).trim();
    if (!t || t === 'Little Author Journal') return null;
    if (t.length > 512 || t.includes('..') || /[\u0000\r\n]/.test(t)) {
      throw new Error('journal folder must be an absolute path without ..');
    }
    return t;
  }
  function tierIndex(tier) { return { short_story: 0, novella: 1, novel: 2 }[tier]; }
  function toolIndex(tool) { return { pen: 0, typewriter: 1, laptop: 2 }[tool]; }
  function realLevel(completed) {
    if ((completed || []).some(p => p.tier === 'novella' || p.tier === 'novel')) return 2;
    if ((completed || []).some(p => p.tier === 'short_story')) return 1;
    return 0;
  }
  function levelOf(data) { return data.settings.unlock_all ? 2 : realLevel(data.completed); }
  function tierUnlocked(data, tier) { const i = tierIndex(tier); return i != null && i <= levelOf(data); }
  function effectiveTool(data) {
    const lv = levelOf(data);
    const tools = ['pen', 'typewriter', 'laptop'];
    return toolIndex(data.settings.tool) <= lv ? data.settings.tool : tools[lv];
  }
  function needsTitle(data) {
    return !data.active && !data.queue.length && !data.completed.length && !data.awaiting_next;
  }
  function targetFor(settings, tier) {
    const t = settings.tiers || {};
    const n = tier === 'novella' ? t.novella : tier === 'novel' ? t.novel : t.short_story;
    return Math.max(1, Number(n) || 1);
  }
  function makeProject(data, name, tier, target, now) {
    return {
      name, tier,
      target_words: Math.max(1, target == null ? targetFor(data.settings, tier) : Number(target) || 1),
      keystrokes: 0, started_at: now, completed_at: null,
    };
  }
  function startProject(data, p, now) {
    p.keystrokes += data.carry_keystrokes;
    data.carry_keystrokes = 0;
    p.started_at = now;
    data.active = p;
    data.awaiting_next = false;
  }
  function addDaily(data, now, n) {
    if (!n) return;
    const day = dayString(now);
    const last = data.daily[data.daily.length - 1];
    if (last && last.day === day) last.keystrokes += n;
    else data.daily.push({ day, keystrokes: n });
  }
  function credit(data, dk, now) {
    data.total_keystrokes += dk;
    addDaily(data, now, dk);
    let changed = dk > 0;
    let notice = null;
    if (needsTitle(data)) {
      data.carry_keystrokes += dk;
      return { completed: null, notice, changed };
    }
    if (!data.active && !data.awaiting_next) {
      startProject(data, makeProject(data, 'My Short Story', 'short_story', null, now), now);
      changed = true;
      notice = 'Started a new Short Story for you — change it in Projects.';
    }
    if (data.awaiting_next) {
      data.carry_keystrokes += dk;
      return { completed: null, notice, changed };
    }
    const p = data.active;
    if (!p) return { completed: null, notice, changed };
    const kpw = Math.max(1, data.settings.keys_per_word);
    p.keystrokes += dk;
    p.target_words = Math.max(1, p.target_words);
    if (Math.floor(p.keystrokes / kpw) < p.target_words) return { completed: null, notice, changed };
    const done = Object.assign({}, p);
    done.completed_at = now;
    data.carry_keystrokes += done.keystrokes - done.target_words * kpw;
    done.keystrokes = done.target_words * kpw;
    const before = realLevel(data.completed);
    data.completed.push(done);
    data.active = null;
    data.awaiting_next = true;
    const after = realLevel(data.completed);
    if (after > before) notice = after === 1 ? 'Unlocked: Novella + typewriter!' : 'Unlocked: Novel + laptop!';
    return { completed: done, notice, changed };
  }

  function reason(policy, title, media, scrolls) {
    if (policy.detect_titles && title) {
      const lower = title.toLowerCase();
      const hit = (policy.titles || []).find(d => d && lower.includes(String(d).toLowerCase()));
      if (hit) return 'title:' + hit;
    }
    if (policy.detect_media && media) return 'media';
    if (policy.detect_scroll && scrolls >= policy.scroll_events_threshold) return 'scroll';
    return null;
  }
  function scrollActive(latched, scrolls, threshold) {
    const enter = Math.max(1, threshold | 0);
    const leave = Math.max(1, Math.floor(enter / 2));
    return latched ? scrolls >= leave : scrolls >= enter;
  }

  // Chrome keeps the buddy at the desk. Idle is sleep. A letter key wakes typing in place.
  // Sprint games still leave the desk; that walk is focus_phase, not this mode.
  function stepMachine(m, i, p) {
    if (i.newKeys > 0 || i.arrived) {
      m.lastKey = i.newKeys > 0 ? i.now : Math.max(m.lastKey, i.now > 0 ? i.now - 1 : 0);
      m.mode = 'typing';
      return m.mode;
    }
    const idle = i.now - m.lastKey;
    m.mode = idle < p.idleMs ? 'typing' : 'asleep';
    return m.mode;
  }

  function focusStart(f) {
    if (f.phase !== 'idle') return false;
    if (f.held) { f.held = false; f.running = true; return true; }
    if (f.running) return false;
    if (f.ready) { f.ready = false; f.elapsed_ms = 0; f.game = ''; f.anchor = null; f.prompt = ''; f.sprint_minutes = 0; }
    f.running = true;
    return true;
  }
  function focusPause(f) {
    if (f.phase !== 'idle' || !f.running) return false;
    f.running = false;
    f.held = true;
    return true;
  }
  function focusTick(f, t) {
    if (f.phase === 'play') {
      if (t.paused) return null;
      if (t.keys > 0) { Object.assign(f, freshFocus()); return null; }
      f.play_ms += t.dtMs;
      if (f.play_ms >= PLAY_MS) {
        const game = f.game;
        Object.assign(f, freshFocus());
        return { kind: 'away', game };
      }
      return null;
    }
    if (f.phase !== 'idle') return null;
    if (t.mode === 'asleep' || t.mode === 'wander' || t.mode === 'watch') {
      f.elapsed_ms = 0;
      return null;
    }
    if (t.mode !== 'typing' || t.paused) return null;
    f.elapsed_ms += t.dtMs;
    if (f.elapsed_ms >= SUGGEST_MS) {
      f.elapsed_ms = 0;
      return { kind: 'suggest', game: '' };
    }
    return null;
  }
  function markSprint(f) {
    f.sprint_minutes = Math.max(1, Math.round(f.elapsed_ms / 60000));
    f.game = '';
    f.anchor = null;
  }
  function beginAsk(f, game, anchor) {
    if (!f.ready || f.phase !== 'idle' || !game) return null;
    f.phase = 'ask';
    f.prompt = 'game';
    f.game = game;
    f.anchor = anchor || null;
    f.running = false;
    f.held = false;
    return { kind: 'ask', game };
  }
  function beginSprintAsk(f) {
    if (!f.ready || f.phase !== 'idle') return null;
    f.phase = 'ask';
    f.prompt = 'sprint';
    f.game = '';
    f.anchor = null;
    f.running = false;
    f.held = false;
    return { kind: 'ask', game: '' };
  }
  // A game question's No stays at the desk and asks about another sprint.
  // Yes on that sprint starts the timer again. An empty prompt is a game question.
  function focusAnswer(f, yes) {
    if (f.phase !== 'ask') return null;
    if (f.prompt === 'sprint' || f.prompt === 'again') {
      if (yes) {
        Object.assign(f, freshFocus());
        f.running = true;
        return { kind: 'sprint', game: '' };
      }
      const game = f.game;
      Object.assign(f, freshFocus());
      return { kind: 'decline', game };
    }
    if (yes) {
      f.phase = 'explain';
      f.prompt = 'game';
      return { kind: 'explain', game: f.game };
    }
    f.phase = 'ask';
    f.prompt = 'again';
    f.game = '';
    f.anchor = null;
    f.running = false;
    f.held = false;
    return { kind: 'ask', game: '' };
  }
  function readyClick(f) {
    if (f.phase !== 'explain') return false;
    f.phase = 'play';
    f.play_ms = 0;
    f.elapsed_ms = 0;
    f.ready = false;
    f.running = false;
    f.held = false;
    return true;
  }
  function backArrived(f) {
    if (f.phase !== 'back') return false;
    Object.assign(f, freshFocus());
    return true;
  }
  function focusFinish(f) {
    if (f.phase !== 'play') return false;
    Object.assign(f, freshFocus());
    return true;
  }
  function focusLimit(f, limitMs) {
    if (limitMs === 0) { Object.assign(f, freshFocus()); return null; }
    if (f.phase !== 'idle') return null;
    if (f.elapsed_ms >= limitMs) {
      f.elapsed_ms = limitMs;
      f.running = false;
      f.held = false;
      if (f.ready) return null;
      f.ready = true;
      markSprint(f);
      return { kind: 'invite', game: '' };
    }
    f.ready = false;
    return null;
  }
  function chooseId(ids, roll) {
    if (!ids.length) return null;
    const n = ids.length;
    const i = ((roll % n) + n) % n;
    return ids[i];
  }
  function limitMs(minutes) { return clampFocus(minutes) * 60000; }
  function wantsHit(id) { return id === 'tag' || id === 'highfive' || id === 'warmer'; }
  function builtinName(id) {
    if (id === 'tag') return 'Tag the Buddy';
    if (id === 'redlight') return 'Red Light Green Light';
    if (id === 'highfive') return 'High Five';
    if (id === 'warmer') return 'Hide and Seek';
    return 'Chase the Mouse';
  }
  function builtin(id) {
    if (id === 'tag') return ['Ooh! {buddy} runs from the cursor. Click {buddy}.', 'You got {buddy}!', 'Ooh! {buddy} got away.'];
    if (id === 'redlight') return ['Ooh! Sneak closer while {buddy} faces away. Hold still when {buddy} looks.', 'You made it!', 'Ooh! {buddy} is still looking.'];
    if (id === 'highfive') return ['Ooh! Click {buddy} while the happy face shows. Three in a row.', 'High five!', 'Ooh! {buddy} put the hand down.'];
    if (id === 'warmer') return ['Ooh! Find {buddy} by the window. Warmer, then colder, then a click.', 'You found {buddy}!', 'Ooh! {buddy} stayed hidden.'];
    return ['Ooh! {buddy} chases the cursor. A catch gets a cheer.', '{buddy} caught it!', 'Ooh! Too quick for {buddy}.'];
  }
  function fillBuddy(raw, buddy) {
    const name = String(buddy || '').trim() || DEFAULT_BUDDY;
    return String(raw).split('{buddy}').join(name);
  }
  function sayEvent(kind, game, buddy, games, focus) {
    let text = '';
    const yn = ' Press Y for yes, or N for no.';
    if (kind === 'ask') {
      const n = Math.max(1, (focus && focus.sprint_minutes) || 0);
      const wrote = 'You wrote for ' + n + ' ' + (n === 1 ? 'minute' : 'minutes') + '! ';
      if (focus && focus.prompt === 'again') text = 'Want to do another sprint?' + yn;
      else if (focus && focus.prompt === 'sprint') text = wrote + 'Want to do another sprint?' + yn;
      else text = wrote + 'Want to play a game?' + yn;
    } else if (kind === 'sprint') text = 'Okay. Another sprint.';
    else if (kind === 'explain') {
      let raw;
      if (game === 'warmer') raw = 'Ooh! {buddy} hides behind a shape in this window. Follow warmer and colder, then click {buddy}.';
      else {
        const g = (games || []).find(x => x.id === game);
        raw = (g && g.explain) || builtin(game)[0];
      }
      text = fillBuddy(raw, buddy) + " Click when you're ready.";
    } else if (kind === 'decline') text = fillBuddy('Okay. {buddy} understands. Back to the writing.', buddy);
    else if (kind === 'away') {
      const g = (games || []).find(x => x.id === game);
      const raw = g && g.away ? g.away : builtin(game)[2];
      text = fillBuddy(raw, buddy);
    } else if (kind === 'suggest') {
      if (!game) text = 'Ooh! Time for a game!';
      else {
        const g = (games || []).find(x => x.id === game);
        text = 'Ooh! How about ' + ((g && g.name) || builtinName(game)) + '?';
      }
    }
    return { kind, game: game || '', text };
  }
  function warmerBlurb() {
    return 'Ooh! {buddy} hides behind a shape in this window. Follow warmer and colder, then click {buddy}.';
  }
  function gameCatalog(s) {
    const buddy = s.data.settings.buddy_name;
    return ENGINES.map(id => {
      const installed = (s.games || []).find(g => g.id === id);
      const raw = id === 'warmer' ? warmerBlurb() : (installed && installed.explain) || builtin(id)[0];
      return { id, name: (installed && installed.name) || builtinName(id), blurb: fillBuddy(raw, buddy) };
    });
  }
  function beginPlay(f, game) {
    if (!ENGINES.includes(game)) return false;
    Object.assign(f, freshFocus());
    f.phase = 'play';
    f.game = game;
    f.play_ms = 0;
    return true;
  }

  function acceptHat(entry) {
    if (!entry || !idOk(entry.id) || !entry.files) return null;
    let m;
    try { m = JSON.parse(entry.files['manifest.json'] || ''); } catch (_) { return null; }
    if (!m || m.id !== entry.id || m.kind !== 'hat' || !(m.files || []).includes('hat.svg')) return null;
    if (!versionAtMost(m.minAppVersion, APP_VERSION)) return null;
    const name = cleanLabel(m.name);
    const defaultColor = hexOk(m.defaultColor);
    const svg = entry.files['hat.svg'];
    if (!name || !defaultColor || typeof svg !== 'string' || !svg || svg.length > 32768) return null;
    let mode, colors = [], values = [];
    if (m.color === 'free') mode = 'free';
    else if (m.color === 'choice') {
      mode = 'choice';
      for (const c of m.colors || []) {
        const label = cleanLabel(c.label);
        const value = hexOk(c.value);
        if (!label || !value || values.includes(value)) continue;
        values.push(value);
        colors.push({ label, value });
      }
      if (!colors.length || !values.includes(defaultColor)) return null;
    } else return null;
    const extra = m.extra ? cleanLabel(m.extra.label) : null;
    return {
      info: { id: entry.id, name, order: m.order | 0, color: mode, default_color: defaultColor, colors, extra, svg },
      rule: { id: entry.id, mode, default_color: defaultColor, choices: values, has_extra: !!extra },
    };
  }
  function acceptGame(entry) {
    if (!entry || !ENGINES.includes(entry.id) || !entry.files) return null;
    let m, lines;
    try { m = JSON.parse(entry.files['manifest.json'] || ''); } catch (_) { return null; }
    if (!m || m.id !== entry.id || m.kind !== 'game' || m.engine !== entry.id) return null;
    const files = m.files || [];
    if (files.length !== 1 || files[0] !== 'game.json') return null;
    if (!versionAtMost(m.minAppVersion, APP_VERSION)) return null;
    const name = cleanLabel(m.name);
    if (!name) return null;
    try { lines = JSON.parse(entry.files['game.json'] || ''); } catch (_) { return null; }
    const explain = lineText(lines.explain, true);
    const cheer = lineText(lines.cheer, true);
    if (!explain || !cheer) return null;
    return { id: entry.id, name, order: m.order | 0, explain, cheer, away: lineText(lines.away, false) || '' };
  }
  function scanPacks(list) {
    const hats = [], games = [];
    for (const entry of list || []) {
      const hat = acceptHat(entry);
      if (hat) hats.push(hat);
      const game = acceptGame(entry);
      if (game) games.push(game);
    }
    hats.sort((a, b) => a.info.order - b.info.order || (a.info.id < b.info.id ? -1 : 1));
    games.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    return { hats, games };
  }
  function clampHat(settings, hats) {
    if (!settings.hat) { settings.hat_color = ''; settings.hat_extra = false; return; }
    const found = (hats || []).find(h => h.rule.id === settings.hat);
    if (!found) { settings.hat = ''; settings.hat_color = ''; settings.hat_extra = false; return; }
    const rule = found.rule;
    if (rule.mode === 'free') settings.hat_color = hexOk(settings.hat_color) || rule.default_color;
    else {
      const c = String(settings.hat_color || '').trim().toLowerCase();
      settings.hat_color = rule.choices.includes(c) ? c : rule.default_color;
    }
    if (!rule.has_extra) settings.hat_extra = false;
  }

  function progressOf(data) {
    const kpw = Math.max(1, data.settings.keys_per_word);
    let project_name = '', tier = '', words = 0, target_words = 1;
    if (data.active) {
      project_name = data.active.name;
      tier = data.active.tier;
      words = Math.floor(data.active.keystrokes / kpw);
      target_words = data.active.target_words;
    } else if (data.completed.length) {
      const p = data.completed[data.completed.length - 1];
      project_name = p.name;
      tier = p.tier;
      words = p.target_words;
      target_words = p.target_words;
    }
    return {
      words, target_words, project_name, tier,
      completed_count: data.completed.length,
      awaiting_next: !!data.awaiting_next,
      carry_words: Math.floor(data.carry_keystrokes / kpw),
      needs_title: needsTitle(data),
    };
  }
  function deskSide(rect, mons) {
    if (!rect) return 'right';
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    let best = null, bd = Infinity;
    for (const m of mons || []) {
      const dx = Math.max(m.x - cx, 0, cx - (m.x + m.w));
      const dy = Math.max(m.y - cy, 0, cy - (m.y + m.h));
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) return 'right';
    return cx >= best.x + best.w / 2 ? 'right' : 'left';
  }
  function placeHome(saved, size, mons) {
    if (!mons || !mons.length) return null;
    const w = size[0], h = size[1];
    const clampOn = (m, x, y) => [Math.max(m.x, Math.min(x, m.x + m.w - w)), Math.max(m.y, Math.min(y, m.y + m.h - h))];
    if (saved && saved.length === 2) {
      const cx = saved[0] + w / 2, cy = saved[1] + h / 2;
      let near = null, bd = Infinity;
      for (const m of mons) {
        const dx = Math.max(m.x - cx, 0, cx - (m.x + m.w));
        const dy = Math.max(m.y - cy, 0, cy - (m.y + m.h));
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; near = m; }
      }
      if (!near) return null;
      return clampOn(near, saved[0], saved[1]);
    }
    const m = mons.find(x => x.primary) || mons[0];
    const marginX = 20 * (m.scale || 1), marginY = 60 * (m.scale || 1);
    return clampOn(m, m.x + m.w - w - marginX, m.y + m.h - h - marginY);
  }

  function migrate(raw) {
    const d = defaultData();
    const src = raw && typeof raw === 'object' ? raw : {};
    const hadOnboarded = Object.prototype.hasOwnProperty.call(src, 'onboarded');
    Object.assign(d, src);
    d.settings = Object.assign(defaultSettings(), src.settings || {});
    d.settings.colors = deriveColors(d.settings.colors);
    d.settings.keys_per_word = clampKpw(d.settings.keys_per_word);
    clampMotion(d.settings);
    d.settings.focus_minutes = clampFocus(d.settings.focus_minutes);
    d.settings.distraction_titles = clampTitles(d.settings.distraction_titles);
    d.settings.wander_max_ms = Math.max(Number(d.settings.wander_min_ms) || 0, Number(d.settings.wander_max_ms) || 0);
    if (!d.settings.buddy_name || !String(d.settings.buddy_name).trim()) d.settings.buddy_name = DEFAULT_BUDDY;
    d.settings.buddy_name = takeChars(String(d.settings.buddy_name).trim(), 40);
    if (!toolIndex(d.settings.tool) && d.settings.tool !== 'pen') d.settings.tool = 'pen';
    try { d.settings.journal_dir = journalOk(d.settings.journal_dir); } catch (_) { d.settings.journal_dir = null; }
    d.settings.home_pos = Array.isArray(d.settings.home_pos) && d.settings.home_pos.length === 2 ? d.settings.home_pos.map(Number) : null;
    for (const p of [d.active, ...(d.queue || []), ...(d.completed || [])]) {
      if (p) p.target_words = Math.max(1, Number(p.target_words) || 1);
    }
    d.queue = d.queue || [];
    d.completed = d.completed || [];
    d.daily = d.daily || [];
    d.journal = d.journal || [];
    d.carry_keystrokes = d.carry_keystrokes | 0;
    d.awaiting_next = !!d.awaiting_next;
    d.total_keystrokes = d.total_keystrokes | 0;
    if (!hadOnboarded) d.onboarded = !needsTitle(d);
    else d.onboarded = src.onboarded == null ? false : !!src.onboarded;
    d.seen_version = typeof src.seen_version === 'string' ? takeChars(src.seen_version, 32) : '';
    return d;
  }

  function letterMd(l) {
    const day = dayString(l.received_at);
    const slug = Array.from(l.project || '').map(c => /[A-Za-z0-9]/.test(c) ? c : '-').join('');
    const name = day + '-' + slug + '-' + l.received_at + '.md';
    const md = '# Fan letter — ' + l.project + '\n\n*' + l.category + ' · ' + day + '*\n\n' + l.body + '\n\n— ' + l.from + '\n';
    return { name, markdown: md };
  }

  function judgeUpdate(current, tag) {
    const cur = versionParts(current), lat = versionParts(tag);
    if (!cur || !lat) return null;
    const cmp = cmpVer(lat, cur);
    const state = cmp > 0 ? 'newer' : cmp < 0 ? 'ahead' : 'current';
    const display = s => String(s).trim().replace(/^v/, '');
    return { current: display(current), latest: display(tag), state };
  }
  function tagName(body) {
    const key = '"tag_name"';
    const i = String(body).indexOf(key);
    if (i < 0) return null;
    let rest = body.slice(i + key.length).trim().replace(/^:/, '').trim();
    if (!rest.startsWith('"')) return null;
    rest = rest.slice(1);
    const end = rest.indexOf('"');
    if (end < 0) return null;
    const tag = rest.slice(0, end);
    if (!tag || tag.length > 32 || /[\u0000-\u001f\\]/.test(tag)) return null;
    return tag;
  }

  function createSession(now, saved) {
    let data = defaultData();
    let warning = null;
    if (saved == null || saved === '') data = defaultData();
    else {
      try {
        const raw = typeof saved === 'string' ? JSON.parse(saved) : saved;
        data = migrate(raw);
      } catch (e) {
        data = defaultData();
        warning = 'Saved data was corrupt (' + (e && e.message ? e.message : 'could not be read') + '). A fresh profile started.';
      }
    }
    const s = {
      data,
      focus: freshFocus(),
      machine: freshMachine(now || 0),
      paused: false,
      keys: 0,
      wheel: 0,
      warnings: warning ? [warning] : [],
      monitors: [],
      origin: [0, 0],
      homeRect: null,
      fg: null,
      media: false,
      packFiles: [],
      hats: [],
      games: [],
      snap: null,
      settingsTab: 'settings',
      lastKeys: 0,
      lastWheel: 0,
      wheelHist: [],
      tickN: 0,
      focusAt: now || 0,
      scrollLatched: false,
      homeDb: { pending: null, since: 0, saved: data.settings.home_pos ? data.settings.home_pos.slice() : null },
      lastSave: now || 0,
      dirty: false,
      rng: null,
      welcome: [],
      welcomeDue: false,
    };
    noteWelcome(s);
    s.snap = paint(s);
    return s;
  }

  function paint(s) {
    const data = s.data;
    const mons = s.monitors || [];
    let desk = data.settings.desk_monitor;
    if (!(Number.isInteger(desk) && desk >= 0 && desk < mons.length)) {
      desk = mons.findIndex(m => m.primary);
      if (desk < 0) desk = 0;
    }
    const mode = s.machine.mode;
    const fg = s.fg;
    const watch = mode === 'watch' && fg ? { id: fg.id, x: fg.x, y: fg.y, w: fg.w, h: fg.h } : null;
    const home = s.homeRect;
    const prog = progressOf(data);
    return Object.assign({
      mode,
      paused: !!s.paused,
      watch,
      distraction_reason: s.reason || null,
      fg_rect: fg ? [fg.x, fg.y, fg.w, fg.h] : null,
      fg_id: fg ? fg.id : null,
      force_hide: false,
      origin: s.origin || [0, 0],
      monitors: mons.map(m => ({ x: m.x, y: m.y, w: m.w, h: m.h, scale: m.scale || 1, primary: !!m.primary })),
      desk_monitor: desk,
      roam_all_monitors: !!data.settings.roam_all_monitors,
      colors: data.settings.colors,
      warnings: s.warnings.slice(),
      interactive: false,
      buddy: data.settings.buddy_name,
      onboarded: data.onboarded !== false,
      buddy_scale: data.settings.buddy_scale,
      walk_speed: data.settings.walk_speed,
      bubble_px: data.settings.bubble_px,
      tool: effectiveTool(data),
      level: levelOf(data),
      real_level: realLevel(data.completed),
      unlock_all: !!data.settings.unlock_all,
      home: home ? [home.x, home.y, home.w, home.h, 1] : null,
      home_side: deskSide(home, mons),
      hat: data.settings.hat || '',
      hat_color: data.settings.hat_color || '',
      hat_extra: !!data.settings.hat_extra,
      focus_ms: s.focus.elapsed_ms,
      focus_limit_ms: limitMs(data.settings.focus_minutes),
      focus_ready: !!s.focus.ready,
      focus_running: !!s.focus.running,
      focus_held: !!s.focus.held,
      focus_phase: s.focus.phase,
      focus_game: s.focus.game || '',
      focus_anchor: s.focus.anchor,
      focus_prompt: s.focus.prompt || '',
      sprint_minutes: s.focus.sprint_minutes | 0,
      page_color: hexOk(data.settings.page_color) || '#f6efe2',
    }, prog);
  }

  function setMonitors(s, mons) {
    s.monitors = (mons || []).map(m => ({
      x: m.x | 0, y: m.y | 0, w: m.w | 0, h: m.h | 0, scale: Number(m.scale) || 1, primary: !!m.primary,
    }));
    if (!s.monitors.length) { s.origin = [0, 0]; return; }
    const x0 = Math.min(...s.monitors.map(m => m.x));
    const y0 = Math.min(...s.monitors.map(m => m.y));
    s.origin = [x0, y0];
  }
  function noteHome(s, x, y, w, h, now) {
    s.homeRect = { x: x | 0, y: y | 0, w: w | 0, h: h | 0 };
    const pos = [s.homeRect.x, s.homeRect.y];
    const db = s.homeDb;
    if (!db.pending || db.pending[0] !== pos[0] || db.pending[1] !== pos[1]) { db.pending = pos; db.since = now; }
  }
  function setPackFiles(s, list) {
    s.packFiles = Array.isArray(list) ? list : [];
    const scanned = scanPacks(s.packFiles);
    s.hats = scanned.hats;
    s.games = scanned.games;
    clampHat(s.data.settings, s.hats);
  }
  function rollOf(s) {
    const r = s.rng ? Number(s.rng()) : Math.random();
    if (!Number.isFinite(r)) return 0;
    if (r >= 0 && r < 1) return Math.floor(r * 0x100000000);
    return Math.floor(Math.abs(r));
  }
  function offerRandom(s) {
    const ids = s.games.map(g => g.id);
    const id = chooseId(ids, rollOf(s));
    if (!id) return beginSprintAsk(s.focus);
    const fg = s.fg && s.fg.title && !s.fg.title.includes('Little Author') ? s.fg : null;
    const anchor = fg ? [fg.x, fg.y, fg.w, fg.h] : (s.focusAnchorSample || null);
    return beginAsk(s.focus, id, anchor);
  }
  function settle(s, spoken) {
    if (!spoken || spoken.kind === 'invite') return null;
    if (spoken.kind === 'suggest' && !spoken.game) {
      return { kind: 'suggest', game: chooseId(ENGINES.slice(), rollOf(s)) || 'chase' };
    }
    return spoken;
  }
  function sayOf(s, spoken) {
    if (!spoken) return null;
    return sayEvent(spoken.kind, spoken.game, s.data.settings.buddy_name, s.games, s.focus);
  }

  function sampleFg(s, fg) {
    if (!fg || (fg.title || '').includes('Little Author')) { s.fg = null; return; }
    s.fg = { id: fg.id, title: String(fg.title || ''), x: fg.x | 0, y: fg.y | 0, w: fg.w | 0, h: fg.h | 0 };
    s.focusAnchorSample = [s.fg.x, s.fg.y, s.fg.w, s.fg.h];
  }

  // One 250 ms step. `input` is { fg, media } sampled by the shell. Key and wheel
  // totals are already on the session. Returns events in desktop order.
  function tick(s, now, input) {
    input = input || {};
    s.tickN++;
    const dk = s.paused ? 0 : s.keys - s.lastKeys;
    const dw = s.paused ? 0 : s.wheel - s.lastWheel;
    s.lastKeys = s.keys;
    s.lastWheel = s.wheel;
    if (s.homeDb.pending && now - s.homeDb.since >= 600) {
      const p = s.homeDb.pending;
      const saved = s.homeDb.saved;
      if (!saved || saved[0] !== p[0] || saved[1] !== p[1]) {
        s.data.settings.home_pos = p.slice();
        s.homeDb.saved = p.slice();
        s.dirty = true;
      }
    }
    const g = s.data.settings;
    const idle = now - s.machine.lastKey >= g.idle_threshold_ms;
    if (!idle) { s.wheelHist = []; s.fg = null; s.media = false; }
    else {
      if (s.tickN % 4 === 0 && input.fg !== undefined) sampleFg(s, input.fg);
      if (g.detect_media && s.tickN % 8 === 0 && input.media !== undefined) s.media = !!input.media;
      s.wheelHist.push([now, dw]);
      while (s.wheelHist.length && now - s.wheelHist[0][0] > g.scroll_window_ms) s.wheelHist.shift();
    }
    const scrolls = s.wheelHist.reduce((n, x) => n + x[1], 0);
    s.scrollLatched = idle && g.detect_scroll && scrollActive(s.scrollLatched, scrolls, g.scroll_events_threshold);
    const title = idle && s.fg ? s.fg.title : null;
    s.reason = idle ? reason({
      detect_titles: g.detect_titles, detect_media: g.detect_media, detect_scroll: g.detect_scroll,
      titles: g.distraction_titles, scroll_events_threshold: g.scroll_events_threshold | 0,
    }, title, s.media, s.scrollLatched ? g.scroll_events_threshold : 0) : null;
    const mode = stepMachine(s.machine, {
      now, newKeys: dk, distracted: !!s.reason, arrived: false,
    }, { idleMs: g.idle_threshold_ms });
    const dt = Math.min(2000, Math.max(0, now - s.focusAt));
    s.focusAt = now;
    const result = credit(s.data, dk, now);
    if (result.changed) s.dirty = true;
    let spoken = focusTick(s.focus, { dtMs: dt, mode, paused: !!s.paused, keys: dk, limitMs: limitMs(g.focus_minutes) });
    spoken = settle(s, spoken);
    s.snap = paint(s);
    const events = [{ name: 'companion-state', payload: s.snap }];
    const say = sayOf(s, spoken);
    if (say) events.push({ name: 'focus-say', payload: say });
    if (result.notice) events.push({ name: 'notice', payload: result.notice });
    if (result.completed) {
      events.push({ name: 'project-complete', payload: result.completed });
      events.push({ name: 'show-tab', payload: 'projects', target: 'settings' });
    }
    return { events, completed: !!result.completed, dirty: s.dirty };
  }

  function noteAnswer(s) {
    if (s.focus.phase !== 'ask') return null;
    return null;
  }

  function applyAnswer(s, yes) {
    const spoken = focusAnswer(s.focus, !!yes);
    if (!spoken) return [];
    s.snap = paint(s);
    const say = sayOf(s, spoken);
    const events = [{ name: 'companion-state', payload: s.snap }];
    if (say) events.push({ name: 'focus-say', payload: say });
    return events;
  }

  function publicData(s) {
    return JSON.parse(JSON.stringify(s.data));
  }

  function applySettings(s, incoming) {
    const cur = s.data.settings;
    const v = Object.assign(defaultSettings(), incoming || {});
    v.keys_per_word = clampKpw(v.keys_per_word);
    clampMotion(v);
    v.colors = deriveColors(v.colors);
    if (!String(v.buddy_name || '').trim()) v.buddy_name = cur.buddy_name;
    v.buddy_name = takeChars(String(v.buddy_name).trim(), 40);
    v.wander_max_ms = Math.max(Number(v.wander_min_ms) || 0, Number(v.wander_max_ms) || 0);
    v.tiers = {
      short_story: Math.max(1, Number(v.tiers && v.tiers.short_story) || 1),
      novella: Math.max(1, Number(v.tiers && v.tiers.novella) || 1),
      novel: Math.max(1, Number(v.tiers && v.tiers.novel) || 1),
    };
    v.home_pos = cur.home_pos;
    v.distraction_titles = clampTitles(v.distraction_titles);
    v.journal_dir = journalOk(v.journal_dir);
    v.tool = toolIndex(v.tool) == null ? 'pen' : v.tool;
    v.unlock_all = !!v.unlock_all;
    v.detect_titles = !!v.detect_titles;
    v.detect_media = !!v.detect_media;
    v.detect_scroll = !!v.detect_scroll;
    v.roam_all_monitors = !!v.roam_all_monitors;
    v.desk_monitor = v.desk_monitor == null || v.desk_monitor === '' ? null : (Number(v.desk_monitor) | 0);
    v.hat = String(v.hat || '');
    v.hat_color = String(v.hat_color || '');
    v.hat_extra = !!v.hat_extra;
    clampHat(v, s.hats);
    v.focus_minutes = clampFocus(v.focus_minutes);
    v.page_color = hexOk(v.page_color) || '#f6efe2';
    const focusChanged = v.focus_minutes !== cur.focus_minutes;
    s.data.settings = v;
    let spoken = null;
    if (focusChanged) spoken = focusLimit(s.focus, limitMs(v.focus_minutes));
    spoken = settle(s, spoken);
    s.dirty = true;
    s.snap = paint(s);
    const events = [{ name: 'companion-state', payload: s.snap }, { name: 'settings-changed', payload: null }];
    const say = sayOf(s, spoken);
    if (say) events.push({ name: 'focus-say', payload: say });
    return events;
  }

  function invoke(s, cmd, args, now) {
    args = args || {};
    const events = [];
    let value = null;
    if (cmd === 'get_snapshot') value = s.snap;
    else if (cmd === 'get_data') value = publicData(s);
    else if (cmd === 'get_warnings') value = s.warnings.slice();
    else if (cmd === 'list_hats') value = s.hats.map(h => h.info);
    else if (cmd === 'list_games') value = s.games.map(g => ({ id: g.id, name: g.name, order: g.order, explain: g.explain, cheer: g.cheer, away: g.away }));
    else if (cmd === 'game_catalog') value = gameCatalog(s);
    else if (cmd === 'open_games') {
      events.push({ name: 'open-games', payload: null, internal: true });
    } else if (cmd === 'play_game') {
      const id = String(args.id || '').trim();
      if (!ENGINES.includes(id) || !beginPlay(s.focus, id)) throw new Error('Unknown game.');
      s.snap = paint(s);
      events.push({ name: 'companion-state', payload: s.snap });
    }
    else if (cmd === 'initial_tab') value = s.settingsTab || 'settings';
    else if (cmd === 'default_journal_dir') value = s.data.settings.journal_dir || 'Little Author Journal';
    else if (cmd === 'focus_start') {
      if (s.data.settings.focus_minutes !== 0 && focusStart(s.focus)) {
        s.snap = paint(s);
        events.push({ name: 'companion-state', payload: s.snap });
      }
    } else if (cmd === 'focus_pause') {
      if (focusPause(s.focus)) {
        s.snap = paint(s);
        events.push({ name: 'companion-state', payload: s.snap });
      }
    } else if (cmd === 'focus_finish') {
      if (focusFinish(s.focus)) {
        s.snap = paint(s);
        events.push({ name: 'companion-state', payload: s.snap });
      }
    } else if (cmd === 'focus_tag') {
      if (s.focus.phase === 'explain' && readyClick(s.focus)) {
        s.snap = paint(s);
        events.push({ name: 'companion-state', payload: s.snap });
      } else if (s.focus.phase === 'play' && wantsHit(s.focus.game)) {
        events.push({ name: 'tag-click', payload: null });
      }
    } else if (cmd === 'focus_back') {
      if (backArrived(s.focus)) {
        s.snap = paint(s);
        events.push({ name: 'companion-state', payload: s.snap });
      }
    } else if (cmd === 'set_focus_minutes') {
      const minutes = clampFocus(args.minutes);
      if (minutes !== s.data.settings.focus_minutes) {
        s.data.settings.focus_minutes = minutes;
        let spoken = settle(s, focusLimit(s.focus, limitMs(minutes)));
        s.dirty = true;
        s.snap = paint(s);
        events.push({ name: 'companion-state', payload: s.snap }, { name: 'settings-changed', payload: null });
        const say = sayOf(s, spoken);
        if (say) events.push({ name: 'focus-say', payload: say });
      }
    } else if (cmd === 'new_project') {
      const tier = args.tier;
      if (!tierUnlocked(s.data, tier)) throw new Error('The ' + tier + ' tier is locked');
      const name = String(args.name || '').trim() ? takeChars(String(args.name).trim(), 120) : 'Untitled';
      const target = args.targetWords != null ? args.targetWords : args.target_words;
      const p = makeProject(s.data, name, tier, target == null ? null : target, now);
      if (!s.data.active) startProject(s.data, p, now);
      else s.data.queue.push(p);
      s.dirty = true;
      s.snap = paint(s);
      events.push({ name: 'companion-state', payload: s.snap });
    } else if (cmd === 'start_next') {
      value = false;
      if (!s.data.active && s.data.queue.length && tierUnlocked(s.data, s.data.queue[0].tier)) {
        const p = s.data.queue.shift();
        startProject(s.data, p, now);
        s.dirty = true;
        value = true;
        s.snap = paint(s);
        events.push({ name: 'companion-state', payload: s.snap });
      }
    } else if (cmd === 'update_settings') {
      events.push(...applySettings(s, args.settings));
    } else if (cmd === 'save_letter') {
      const clip = (v, n) => takeChars(String(v || '').trim(), n);
      const body = takeChars(String(args.body || ''), 4000);
      const letter = {
        category: clip(args.category, 64),
        from: clip(args.from, 120),
        body,
        project: clip(args.project, 120),
        received_at: now,
      };
      s.data.journal.push(letter);
      s.dirty = true;
      const file = letterMd(letter);
      value = (s.data.settings.journal_dir || 'Little Author Journal') + '/' + file.name;
      events.push({ name: 'journal-file', payload: file, internal: true });
    } else if (cmd === 'export_journal') {
      const files = s.data.journal.map(letterMd);
      value = s.data.journal.length + ' letters exported to ' + (s.data.settings.journal_dir || 'Little Author Journal');
      events.push({ name: 'journal-files', payload: files, internal: true });
    } else if (cmd === 'finish_onboarding') {
      const buddy = takeChars(String(args.buddy || '').trim(), 40);
      s.data.settings.buddy_name = buddy || DEFAULT_BUDDY;
      s.data.settings.colors = deriveColors(args.colors);
      s.data.onboarded = true;
      s.data.seen_version = APP_VERSION;
      s.welcomeDue = false;
      if (!s.data.active && !s.data.queue.length) {
        const title = String(args.title || '').trim() ? takeChars(String(args.title).trim(), 120) : 'My Short Story';
        startProject(s.data, makeProject(s.data, title, 'short_story', null, now), now);
      }
      s.dirty = true;
      s.snap = paint(s);
      events.push({ name: 'companion-state', payload: s.snap }, { name: 'settings-changed', payload: null }, { name: 'close-onboarding', payload: null, internal: true });
    } else if (cmd === 'reopen_onboarding') {
      events.push({ name: 'open-onboarding', payload: null, internal: true });
    } else if (cmd === 'open_settings') {
      const tab = String(args.tab || 'settings').replace(/[^a-z0-9]/gi, '') || 'settings';
      s.settingsTab = tab;
      events.push({ name: 'show-tab', payload: tab, target: 'settings' }, { name: 'open-settings', payload: tab, internal: true });
    } else if (cmd === 'quit_app') {
      events.push({ name: 'quit', payload: null, internal: true });
    } else if (cmd === 'race_arrived') {
      stepMachine(s.machine, { now, newKeys: 0, distracted: false, arrived: true }, { idleMs: s.data.settings.idle_threshold_ms });
      s.snap = paint(s);
      events.push({ name: 'handoff', payload: null }, { name: 'companion-state', payload: s.snap });
    } else if (cmd === 'track_window') {
      value = null;
    } else if (cmd === 'place_tag_hit') {
      value = null;
    } else if (cmd === 'check_update') {
      value = args._status || null;
      if (!value) throw new Error("Couldn't reach GitHub.");
    } else if (cmd === 'open_download_page') {
      events.push({ name: 'open-download', payload: null, internal: true });
    } else if (cmd === 'get_welcome') {
      const name = String(s.data.settings.buddy_name || '').trim();
      value = {
        buddy: name || DEFAULT_BUDDY,
        sections: (s.welcome || []).map(sec => ({ version: sec.version, lines: (sec.lines || []).slice() })),
      };
    } else if (cmd === 'dismiss_welcome') {
      events.push({ name: 'close-welcome', payload: null, internal: true });
    } else if (cmd === 'toggle_pause') {
      s.paused = !s.paused;
      s.snap = paint(s);
      events.push({ name: 'companion-state', payload: s.snap });
      value = s.paused;
    } else if (cmd === 'export_state') {
      value = JSON.stringify(s.data, null, 2);
    } else if (cmd === 'import_state') {
      const next = migrate(JSON.parse(args.json));
      s.data = next;
      clampHat(s.data.settings, s.hats);
      noteWelcome(s);
      s.dirty = true;
      s.snap = paint(s);
      events.push({ name: 'companion-state', payload: s.snap }, { name: 'settings-changed', payload: null });
      value = true;
    } else {
      throw new Error('Unknown command');
    }
    return { value, events };
  }

  function addInput(s, letters, wheels) {
    if (s.paused) return;
    if (letters > 0) s.keys += letters;
    if (wheels > 0) s.wheel += wheels;
  }

  // The save is counts, projects, and settings. It must not grow a title or a key.
  function saveJson(s) {
    return JSON.stringify(s.data);
  }

  // Chrome notes for the desktop welcome window. Sleep and one desk window replace wander and the active-window game.
  const WELCOME_NOTES = [
    {
      version: '0.7.0',
      lines: [
        'The desk has a sprint timer. Start begins it, and Pause holds it.',
        'Hats and games come from a supporter zip, or from a packs folder you choose. They are not in this extension.',
      ],
    },
    {
      version: '0.8.0',
      lines: [
        'After fifteen minutes of writing at the desk, Buddy suggests a game and keeps typing. Falling asleep starts that wait over.',
        'Red Light Green Light, High Five, and Hide and Seek are new games. They are not in this extension.',
        'The games button beside the gear lists each game. Play fills this window, then shrinks it back.',
        'Settings can check for a newer release. The check sends nothing you wrote, and it does not download the update.',
      ],
    },
  ];

  function pendingWelcome(seen, onboarded, current) {
    if (!onboarded) return null;
    const cur = versionParts(current);
    if (!cur) return null;
    const seenV = versionParts(seen);
    if (seenV && cmpVer(seenV, cur) >= 0) return null;
    const sections = [];
    for (const note of WELCOME_NOTES) {
      const v = versionParts(note.version);
      if (!v || cmpVer(v, cur) > 0) continue;
      if (seenV && cmpVer(v, seenV) <= 0) continue;
      sections.push({ version: note.version, lines: note.lines.slice() });
    }
    return sections;
  }

  function noteWelcome(s) {
    const due = pendingWelcome(s.data.seen_version, s.data.onboarded === true, APP_VERSION);
    s.welcomeDue = due != null;
    s.welcome = due || [];
  }

  const ZIP_MAX = 2 * 1024 * 1024;
  const UNCOMPRESSED_MAX = 2 * 1024 * 1024;
  const ENTRY_MAX = 80;
  const MANIFEST_MAX = 8 * 1024;
  const GAME_MAX = 8 * 1024;
  const SVG_MAX = 32 * 1024;

  function installFail(kind) {
    const err = new Error(kind);
    err.install = kind;
    return err;
  }

  function installErrorMessage(kind) {
    if (kind === 'Unsafe') return 'That zip could not be used.';
    if (kind === 'Write') return 'The packs folder could not be written.';
    return 'That zip could not be read.';
  }

  function asBytes(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (Array.isArray(bytes)) return Uint8Array.from(bytes);
    throw installFail('Read');
  }

  function u16(b, o) {
    if (o < 0 || o + 2 > b.length) throw installFail('Read');
    return b[o] | (b[o + 1] << 8);
  }

  function u32(b, o) {
    if (o < 0 || o + 4 > b.length) throw installFail('Read');
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function entryPath(raw) {
    if (!raw || raw.indexOf('\0') >= 0) throw installFail('Unsafe');
    let name = raw.replace(/\\/g, '/');
    if (name.charAt(0) === '/') throw installFail('Unsafe');
    name = name.replace(/\/+$/, '');
    if (!name) return { kind: 'ignore' };
    const parts = name.split('/');
    for (const part of parts) {
      if (!part || part === '.' || part === '..' || part.length > 64) throw installFail('Unsafe');
      if (!/^[A-Za-z0-9._\- ]+$/.test(part)) throw installFail('Unsafe');
    }
    if (parts.length === 1) return { kind: 'root' };
    if (parts.length === 2) return { kind: 'pack', id: parts[0], filename: parts[1] };
    return { kind: 'ignore' };
  }

  function fileCap(name) {
    if (name === 'manifest.json') return MANIFEST_MAX;
    if (name === 'game.json') return GAME_MAX;
    if (name === 'hat.svg') return SVG_MAX;
    return null;
  }

  function account(total, n) {
    const next = total + n;
    if (!Number.isFinite(next) || next > UNCOMPRESSED_MAX) throw installFail('Unsafe');
    return next;
  }

  function unixSymlink(madeBy, ext) {
    if ((madeBy >>> 8) !== 3) return false;
    const mode = (ext >>> 16) & 0xffff;
    return (mode & 0o170000) === 0o120000;
  }

  function findEocd(bytes) {
    const min = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (u32(bytes, i) !== 0x06054b50) continue;
      const comment = u16(bytes, i + 20);
      if (i + 22 + comment === bytes.length) return i;
    }
    throw installFail('Read');
  }

  function dataOffset(bytes, localAt) {
    if (u32(bytes, localAt) !== 0x04034b50) throw installFail('Read');
    const start = localAt + 30 + u16(bytes, localAt + 26) + u16(bytes, localAt + 28);
    if (start > bytes.length) throw installFail('Read');
    return start;
  }

  function decodeText(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { return null; }
  }

  function versionParsed(raw) {
    const bits = String(raw || '').trim().split('.');
    if (!bits.length || bits.length > 3) return false;
    return bits.every(b => b.length > 0 && b.length <= 6 && /^[0-9]+$/.test(b));
  }

  function peekManifest(text) {
    let manifest;
    try { manifest = JSON.parse(text); } catch (_) { return null; }
    if (!manifest || typeof manifest !== 'object') return null;
    if (typeof manifest.id !== 'string' || typeof manifest.name !== 'string' || typeof manifest.minAppVersion !== 'string') return null;
    if (manifest.order == null) manifest.order = 0;
    if (typeof manifest.order !== 'number' || !Number.isFinite(manifest.order) || Math.trunc(manifest.order) !== manifest.order) return null;
    return manifest;
  }

  async function readStoredOrDeflated(bytes, entry, inflateRaw) {
    const start = dataOffset(bytes, entry.localAt);
    if (start + entry.compSize > bytes.length) throw installFail('Read');
    const comp = bytes.subarray(start, start + entry.compSize);
    let out;
    if (entry.method === 0) {
      if (entry.compSize !== entry.uncompSize) throw installFail('Read');
      out = comp;
    } else {
      if (typeof inflateRaw !== 'function') throw installFail('Read');
      try {
        out = await inflateRaw(comp, entry.uncompSize);
      } catch (e) {
        if (e && e.install) throw e;
        throw installFail('Read');
      }
      if (!out || out.length !== entry.uncompSize) throw installFail('Read');
      out = out instanceof Uint8Array ? out : new Uint8Array(out);
    }
    if (crc32(out) !== entry.crc) throw installFail('Read');
    return out;
  }

  async function gatherZip(bytes, inflateRaw) {
    if (bytes.length > ZIP_MAX) throw installFail('Unsafe');
    if (bytes.length < 22) throw installFail('Read');
    const eocd = findEocd(bytes);
    if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) throw installFail('Read');
    const count = u16(bytes, eocd + 8);
    if (count !== u16(bytes, eocd + 10)) throw installFail('Read');
    if (count === 0xffff) throw installFail('Read');
    if (count > ENTRY_MAX) throw installFail('Unsafe');
    const cdSize = u32(bytes, eocd + 12);
    const cdAt = u32(bytes, eocd + 16);
    if (cdSize === 0xffffffff || cdAt === 0xffffffff) throw installFail('Read');
    if (cdAt + cdSize > bytes.length) throw installFail('Read');
    const entries = [];
    let p = cdAt;
    for (let n = 0; n < count; n++) {
      if (u32(bytes, p) !== 0x02014b50) throw installFail('Read');
      const madeBy = u16(bytes, p + 4);
      const flags = u16(bytes, p + 8);
      const method = u16(bytes, p + 10);
      const crc = u32(bytes, p + 16);
      const compSize = u32(bytes, p + 20);
      const uncompSize = u32(bytes, p + 24);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const ext = u32(bytes, p + 38);
      const localAt = u32(bytes, p + 42);
      const nameAt = p + 46;
      const next = nameAt + nameLen + extraLen + commentLen;
      if (next > cdAt + cdSize) throw installFail('Read');
      const name = decodeText(bytes.subarray(nameAt, nameAt + nameLen));
      if (name == null) throw installFail('Unsafe');
      entries.push({ madeBy, flags, method, crc, compSize, uncompSize, ext, localAt, name });
      p = next;
    }
    const packs = new Map();
    let total = 0;
    for (const entry of entries) {
      if ((entry.flags & 1) !== 0 || unixSymlink(entry.madeBy, entry.ext)) throw installFail('Unsafe');
      if (entry.method !== 0 && entry.method !== 8) throw installFail('Unsafe');
      if (entry.uncompSize > UNCOMPRESSED_MAX || entry.compSize > ZIP_MAX) throw installFail('Unsafe');
      const where = entryPath(entry.name);
      const isDir = /[\\/]$/.test(entry.name) || (entry.ext & 0x10) !== 0;
      if (isDir) {
        total = account(total, entry.uncompSize);
        continue;
      }
      if (where.kind === 'ignore' || where.kind === 'root') {
        total = account(total, entry.uncompSize);
        continue;
      }
      if (!idOk(where.id)) {
        total = account(total, entry.uncompSize);
        continue;
      }
      let slot = packs.get(where.id);
      if (!slot) {
        slot = { files: new Map(), tainted: false };
        packs.set(where.id, slot);
      }
      const cap = fileCap(where.filename);
      if (cap == null || slot.files.has(where.filename) || entry.uncompSize > cap) {
        slot.tainted = true;
        total = account(total, Math.min(entry.uncompSize, cap == null ? UNCOMPRESSED_MAX : cap));
        continue;
      }
      const raw = await readStoredOrDeflated(bytes, entry, inflateRaw);
      if (raw.length > cap) {
        slot.tainted = true;
        total = account(total, cap);
        continue;
      }
      total = account(total, raw.length);
      slot.files.set(where.filename, raw);
    }
    return packs;
  }

  function filesAsText(map) {
    const files = {};
    for (const [name, raw] of map) {
      const text = decodeText(raw);
      if (text == null) return null;
      files[name] = text;
    }
    return files;
  }

  function classZip(id, incoming) {
    const manifestRaw = incoming.files.get('manifest.json');
    if (manifestRaw) {
      const text = decodeText(manifestRaw);
      const peek = text == null ? null : peekManifest(text);
      if (peek && peek.id === id && versionParsed(peek.minAppVersion) && !versionAtMost(peek.minAppVersion, APP_VERSION)) {
        return { kind: 'newer', name: cleanLabel(peek.name) || id, order: peek.order };
      }
    }
    if (incoming.tainted || incoming.files.size !== 2 || !manifestRaw) return { kind: 'skip' };
    const hat = incoming.files.has('hat.svg');
    const game = incoming.files.has('game.json');
    if (hat === game) return { kind: 'skip' };
    const files = filesAsText(incoming.files);
    if (!files) return { kind: 'skip' };
    const entry = { id, files };
    if (hat) return acceptHat(entry) ? { kind: 'hat', entry } : { kind: 'skip' };
    return acceptGame(entry) ? { kind: 'game', entry } : { kind: 'skip' };
  }

  function countPhrase(n, one, many) {
    return (n === 1 ? '1 ' + one : n + ' ' + many);
  }

  function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  function reportInstall(hats, games, newer, skipped) {
    const parts = [];
    if (hats && games) parts.push('Installed ' + countPhrase(hats, 'hat', 'hats') + ' and ' + countPhrase(games, 'game', 'games') + '.');
    else if (hats) parts.push('Installed ' + countPhrase(hats, 'hat', 'hats') + '.');
    else if (games) parts.push('Installed ' + countPhrase(games, 'game', 'games') + '.');
    if (newer.length === 1) parts.push(newer[0] + ' needs a newer Little Author Buddy, so it was left out.');
    else if (newer.length > 1) parts.push(joinNames(newer) + ' need a newer Little Author Buddy, so they were left out.');
    if (skipped > 0) parts.push('Some packs in that zip were left out.');
    if (!parts.length) parts.push('This zip had no supporter packs the app could use.');
    return { message: parts.join(' '), installed: hats + games > 0 };
  }

  async function installZip(bytes, inflateRaw) {
    const gathered = await gatherZip(asBytes(bytes), inflateRaw);
    const accepted = [];
    const newer = [];
    let skipped = 0;
    let hats = 0;
    let games = 0;
    for (const [id, incoming] of gathered) {
      const row = classZip(id, incoming);
      if (row.kind === 'hat') { accepted.push(row.entry); hats++; }
      else if (row.kind === 'game') { accepted.push(row.entry); games++; }
      else if (row.kind === 'newer') newer.push(row);
      else skipped++;
    }
    newer.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const status = reportInstall(hats, games, newer.map(row => row.name), skipped);
    status.packs = status.installed ? accepted : [];
    return status;
  }

  function mergePacks(existing, added) {
    const out = [];
    const index = new Map();
    for (const entry of existing || []) {
      if (!entry || !entry.id) continue;
      index.set(entry.id, out.length);
      out.push(entry);
    }
    for (const entry of added || []) {
      if (!entry || !entry.id) continue;
      if (index.has(entry.id)) out[index.get(entry.id)] = entry;
      else {
        index.set(entry.id, out.length);
        out.push(entry);
      }
    }
    return out;
  }

  const LWC = {
    APP_VERSION, DEFAULT_BUDDY, createSession, tick, invoke, paint, setMonitors, noteHome, setPackFiles,
    addInput, applyAnswer, noteAnswer, saveJson, migrate, placeHome, deskSide, judgeUpdate, tagName,
    versionParts, wantsHit, sayEvent, letterMd, scanPacks, chooseId, limitMs, dayString,
    pendingWelcome, installZip, installErrorMessage, mergePacks,
    CHROME_NOTES: [
      'Chrome counts letter keys in web pages. The address bar, system windows, and Android or Linux apps on Chrome OS are not counted.',
      'When idle, Buddy sleeps at the desk. Fifteen minutes of writing suggests a game there. Sleeping starts that wait over. Play fills this window, then shrinks it back. The cursor is read only inside that window and is not saved.',
      'Hats and games are installed from Little Author Buddy DLC.zip or from a packs folder you choose. They are not in this extension, and nothing in a pack is run.',
    ],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LWC;
  else root.LWC = LWC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
