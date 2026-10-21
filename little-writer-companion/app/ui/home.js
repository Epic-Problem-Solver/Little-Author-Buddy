// Home (desk) window: draggable, fixed size. X quits the whole app (saves first); gear opens Settings.
const T = window.__TAURI__, I = (c, a) => T.core.invoke(c, a), $ = id => document.getElementById(id);
let handedOff = false;
let ch, desk, snap, hatsApi, proudUntil = 0, lastMode, lastAway, noticeUntil = 0, speechT = 0;
const atHome = LWDomain.atHome;

function render(s) {
  snap = s;
  const mode = s.paused ? 'paused' : s.mode;
  // v0.6: while the buddy is away the desk + tool stay on the home window (desk-only; pen -> inkwell)
  if (mode !== 'race_back') handedOff = false;
  const focusAway = s.focus_phase === 'ask' || s.focus_phase === 'explain' || s.focus_phase === 'play' || s.focus_phase === 'back';
  const away = focusAway || (!atHome(mode) && Date.now() >= proudUntil && !(mode === 'race_back' && handedOff)); // runner already handed off
  ch.setTool(s.tool);
  // Buddy size also scales the desk buddy (same cap + bottom-centre origin as the overlay's race-back target)
  const hsc = Math.min(s.buddy_scale || 1, LWMotion.HOME_MAX_SCALE);
  $('stage').style.transform = Math.abs(hsc - 1) > 1e-3 ? `scale(${hsc})` : '';
  paintFocus(s);
  if (desk) { desk.setTool(s.tool); desk.setColors(s.colors); if (s.home_side) desk.setSide(s.home_side); }
  if (Date.now() >= proudUntil && (mode !== lastMode || away !== lastAway)) {
    // Animator v0.7 desk-alone layer: fixed desk.svg (same tool/side, pixel-aligned) while the buddy is away
    $('deskHost').classList.toggle('on', away && !!desk);
    $('charHost').style.visibility = away ? 'hidden' : 'visible';
    if (!away) ch.setState(mode);
    lastMode = mode; lastAway = away;
  } ch.setColors(s.colors); LWCharacter.setVars(document.body, s.colors);
  if (hatsApi) hatsApi.apply(s);
  // desk angles into the screen depending on which half of its monitor the home window sits in (attribute only)
  // v0.6: computed in Rust from the real monitor the home window is on (updates after drags + monitor changes)
  if (s.home_side) ch.setSide(s.home_side);
  if (Date.now() < noticeUntil) return;
  const pct = Math.min(100, (s.words / Math.max(1, s.target_words)) * 100);
  $('hudText').textContent = s.needs_title ? `Click here to set up ${s.buddy || 'your buddy'}`
    : s.awaiting_next ? `“${s.project_name}” done! Pick the next project (⚙ → Projects)`
    : `${s.project_name}: ${s.words.toLocaleString()} / ${s.target_words.toLocaleString()}${s.paused ? ' (paused)' : ''}`;
  $('hudText').title = $('hudText').textContent;
  $('fill').style.width = pct + '%';
}
function notice(text) { $('hudText').textContent = text; noticeUntil = Date.now() + 6000; }

function fmtRemain(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function paintFocus(s) {
  const el = $('focus');
  const limit = s.focus_limit_ms || 0;
  const phase = s.focus_phase;
  const out = phase === 'ask' || phase === 'explain' || phase === 'play' || phase === 'back';
  el.style.left = s.home_side === 'left' ? '38px' : '14px';
  $('focusTime').textContent = limit === 0 ? 'Off' : phase === 'play' ? 'Play' : fmtRemain(Math.max(0, limit - (s.focus_ms || 0)));
  const start = $('focusStart'), pause = $('focusPause');
  const running = !!s.focus_running && !s.focus_held;
  start.disabled = out || limit === 0 || running;
  pause.disabled = out || !s.focus_running;
  start.classList.toggle('on', running);
  pause.classList.toggle('on', !!s.focus_held);
  start.title = s.focus_held ? 'Resume' : 'Start';
}
function showSpeech(text) {
  const el = $('speech');
  if (!text) { el.classList.remove('on'); return; }
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(speechT);
  speechT = setTimeout(() => el.classList.remove('on'), 8000);
}
document.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('.btn') || e.target.closest('#focus') || e.target.closest('#speech') || (snap && snap.needs_title && e.target.closest('#hud'))) return;
  T.window.getCurrentWindow().startDragging().catch(() => {});
});
$('focus').addEventListener('mousedown', e => e.stopPropagation());
$('focusStart').onclick = e => { e.stopPropagation(); I('focus_start').catch(() => {}); };
$('focusPause').onclick = e => { e.stopPropagation(); I('focus_pause').catch(() => {}); };
$('close').onclick = () => I('quit_app');
$('gear').onclick = () => I('open_settings', { tab: 'settings' });
for (const id of ['close', 'gear']) $(id).onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') $(id).click(); };
// first run is handled by the onboarding window; clicking the HUD reopens it if it was closed
$('hud').onclick = () => { if (snap && snap.needs_title) I('reopen_onboarding'); };

(async () => {
  ch = await LWCharacter.mount($('charHost'));
  hatsApi = LWCharacter.bindHats(I, ch, () => snap);
  await hatsApi.refresh();
  desk = await LWCharacter.mount($('deskHost'), 'desk.svg');
  const g = await LWCharacter.button($('gear'), 'ui-gear.svg', '⚙'); g.classList.add('lw-ui', 'lw-ui-gear');
  const x = await LWCharacter.button($('close'), 'ui-close.svg', '×'); x.classList.add('lw-ui', 'lw-ui-close');
  const s = await I('get_snapshot'); if (s) render(s);
  T.event.listen('companion-state', e => render(e.payload));
  T.event.listen('focus-say', e => {
    const p = e.payload || {};
    if (!LWDomain.focusAtDesk(snap)) return;
    const buddy = (snap && snap.buddy) || 'Buddy';
    const text = p.text || (p.kind === 'invite' ? LWContent.line('focusBreak', { buddy }) : '');
    showSpeech(text);
  });
  // BUG-23: runner arrived -> show the typing desk buddy on the same event the overlay hides the runner
  T.event.listen('handoff', () => {
    if (Date.now() < proudUntil) return;
    $('deskHost').classList.remove('on'); $('charHost').style.visibility = 'visible'; ch.setState('typing');
    lastAway = false; lastMode = 'race_back'; handedOff = true;
  });
  T.event.listen('project-complete', () => { proudUntil = Date.now() + 6000; lastMode = 'proud'; $('deskHost').classList.remove('on'); $('charHost').style.visibility = 'visible'; lastAway = false; ch.setState('proud'); });
  T.event.listen('notice', e => notice(e.payload));
})();
