// Home (desk) window: draggable, fixed size. X quits the whole app (saves first); gear opens Settings.
const T = window.__TAURI__, I = (c, a) => T.core.invoke(c, a), $ = id => document.getElementById(id);
let handedOff = false;
let ch, desk, snap, proudUntil = 0, lastMode, lastAway, noticeUntil = 0;
const atHome = LWDomain.atHome;

function render(s) {
  snap = s;
  const mode = s.paused ? 'paused' : s.mode;
  // v0.6: while the buddy is away the desk + tool stay on the home window (desk-only; pen -> inkwell)
  if (mode !== 'race_back') handedOff = false;
  const away = !atHome(mode) && Date.now() >= proudUntil && !(mode === 'race_back' && handedOff); // runner already handed off
  ch.setTool(s.tool);
  // Buddy size also scales the desk buddy (same cap + bottom-centre origin as the overlay's race-back target)
  const hsc = Math.min(s.buddy_scale || 1, LWMotion.HOME_MAX_SCALE);
  for (const id of ['charHost', 'deskHost']) $(id).style.transform = Math.abs(hsc - 1) > 1e-3 ? `scale(${hsc})` : '';
  if (desk) { desk.setTool(s.tool); desk.setColors(s.colors); if (s.home_side) desk.setSide(s.home_side); }
  if (Date.now() >= proudUntil && (mode !== lastMode || away !== lastAway)) {
    // Animator v0.7 desk-alone layer: fixed desk.svg (same tool/side, pixel-aligned) while the buddy is away
    $('deskHost').classList.toggle('on', away && !!desk);
    $('charHost').style.visibility = away ? 'hidden' : 'visible';
    if (!away) ch.setState(mode);
    lastMode = mode; lastAway = away;
  } ch.setColors(s.colors); LWCharacter.setVars(document.body, s.colors);
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

document.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('.btn, #menu') || (snap && snap.needs_title && e.target.closest('#hud'))) return;
  menu(false);
  T.window.getCurrentWindow().startDragging().catch(() => {});
});
$('close').onclick = () => I('quit_app');
// the gear's tooltip would cover 'Settings…': drop it while the menu is open
const GEAR_TIP = 'Settings';
function menu(on) { $('menu').classList.toggle('on', on); $('gear').title = on ? '' : GEAR_TIP; }
$('gear').onclick = () => menu(!$('menu').classList.contains('on'));
$('mSettings').onclick = () => { menu(false); I('open_settings', { tab: 'settings' }); };
$('mSnap').onclick = () => { menu(false); snapshot(); };
// Snapshot of companion + desk rendered from the SVG (independent of screen capture)
async function snapshot() {
  const svg = $('charHost').querySelector('svg');
  const wasAway = lastAway;
  if (wasAway) { ch.setState('typing'); $('charHost').style.visibility = 'visible'; } // away: snapshot the buddy at its desk
  try { const path = await I('save_snapshot', { svg: LWSnapshot.serialize(svg) }); notice('📸 Saved ' + path.split(/[\\/]/).pop()); }
  catch (e) { notice('Snapshot failed: ' + e); }
  lastMode = null; lastAway = undefined; if (snap) render(snap);
}
for (const id of ['close', 'gear']) $(id).onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') $(id).click(); };
// first run is handled by the onboarding window; clicking the HUD reopens it if it was closed
$('hud').onclick = () => { if (snap && snap.needs_title) I('reopen_onboarding'); };

(async () => {
  ch = await LWCharacter.mount($('charHost'));
  desk = await LWCharacter.mount($('deskHost'), 'desk.svg');
  const g = await LWCharacter.button($('gear'), 'ui-gear.svg', '⚙'); g.classList.add('lw-ui', 'lw-ui-gear');
  const x = await LWCharacter.button($('close'), 'ui-close.svg', '×'); x.classList.add('lw-ui', 'lw-ui-close');
  const s = await I('get_snapshot'); if (s) render(s);
  T.event.listen('companion-state', e => render(e.payload));
  // BUG-23: runner arrived -> show the typing desk buddy on the same event the overlay hides the runner
  T.event.listen('handoff', () => {
    if (Date.now() < proudUntil) return;
    $('deskHost').classList.remove('on'); $('charHost').style.visibility = 'visible'; ch.setState('typing');
    lastAway = false; lastMode = 'race_back'; handedOff = true;
  });
  T.event.listen('project-complete', () => { proudUntil = Date.now() + 6000; lastMode = 'proud'; $('deskHost').classList.remove('on'); $('charHost').style.visibility = 'visible'; lastAway = false; ch.setState('proud'); });
  T.event.listen('notice', e => notice(e.payload));
  T.event.listen('take-snapshot', () => snapshot());
})();
