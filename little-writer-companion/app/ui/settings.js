const I = window.__TAURI__.core.invoke, $ = id => document.getElementById(id);
// Presets set the body colour. Shade and hands are derived. The outline stays #241414.
const TIER_UNLOCK = LWDomain.TIER_UNLOCK, TOOL_UNLOCK = LWDomain.TOOL_UNLOCK;
let data, ch;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let curTab = 'settings';
function tab(t0) { const t = t0 || (location.hash ? location.hash.slice(1) : curTab); curTab = t; document.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.id === t)); document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.hash === '#' + t)); load(); }
let lastBody = LWPalette.PRESETS.Beige.body;
function colors() {
  const body = document.querySelector('[data-c=body]');
  if (body && !LWPalette.bodyAllowed(body.value)) body.value = lastBody;
  else if (body) lastBody = body.value;
  return LWPalette.normalize({ body: body ? body.value : lastBody });
}
async function load() {
  data = await I('get_data'); const s = data.settings, snap = await I('get_snapshot');
  $('warns').innerHTML = (await I('get_warnings')).map(w => `<div>${esc(w)}</div>`).join('');
  const shown = LWPalette.normalize(s.colors); lastBody = shown.body;
  document.querySelectorAll('[data-c]').forEach(i => { if (shown[i.dataset.c]) i.value = shown[i.dataset.c]; });
  ch && ch.setColors(shown);
  $('kpw').value = Math.min(5, Math.max(1, s.keys_per_word)); $('kpwv').textContent = $('kpw').value; $('idle').value = Math.round(s.idle_threshold_ms / 1000);
  $('t1').value = s.tiers.short_story; $('t2').value = s.tiers.novella; $('t3').value = s.tiers.novel;
    $('dt').checked = s.detect_titles; $('dm').checked = s.detect_media; $('ds').checked = s.detect_scroll; $('titles').value = s.distraction_titles.join('\n');
  $('roam').checked = s.roam_all_monitors;
  const mons = (snap && snap.monitors) || [];
  $('desk').innerHTML = '<option value="">Primary monitor</option>' + mons.map((m, i) => `<option value="${i}">Monitor ${i + 1}: ${m.w}×${m.h} @${m.scale}x${m.primary ? ' (primary)' : ''}</option>`).join('');
  $('desk').value = s.desk_monitor == null ? '' : String(s.desk_monitor);
  $('jdir').value = s.journal_dir || await I('default_journal_dir');
  // same rule as the backend (store.rs real_level): derived from completed projects, or 2 with Unlock all
  const real = LWDomain.realLevel(data.completed);
  const level = s.unlock_all ? 2 : real;
  const lockNote = { novella: ' 🔒 finish a Short Story', novel: ' 🔒 finish a Novella' };
  $('ptier').innerHTML = [['short_story', 'Short story', s.tiers.short_story], ['novella', 'Novella', s.tiers.novella], ['novel', 'Novel', s.tiers.novel]]
    .map(([v, n, w]) => `<option value="${v}" ${TIER_UNLOCK[v] > level ? 'disabled' : ''}>${n} (${w.toLocaleString()})${TIER_UNLOCK[v] > level ? lockNote[v] : ''}</option>`).join('');
  [...$('tool').options].forEach(o => { o.disabled = TOOL_UNLOCK[o.value] > level; o.textContent = o.textContent.replace(/ 🔒.*/, '') + (o.disabled ? (o.value === 'typewriter' ? ' 🔒 finish a Short Story' : ' 🔒 finish a Novella') : ''); });
  $('tool').value = TOOL_UNLOCK[s.tool] <= level ? s.tool : LWDomain.TOOLS[level]; ch && ch.setTool($('tool').value);
  $('unlockall').checked = !!s.unlock_all;
  $('bs').value = s.buddy_scale; $('ws').value = s.walk_speed; $('bp').value = s.bubble_px; $('buddy').value = s.buddy_name;
  for (const id of ['bs', 'ws', 'bp']) $(id).dispatchEvent(new Event('input'));
  const a = data.active, kpw = s.keys_per_word, carry = Math.floor(data.carry_keystrokes / kpw);
  $('await').innerHTML = data.awaiting_next ? `🎉 Project complete! ${carry ? `${carry.toLocaleString()} extra words will carry into the next project. ` : ''}` +
    (data.queue.length ? `<button id="startnext">Start “${esc(data.queue[0].name)}”</button> or add a new one below.` : 'Add a new project below to continue.') : '';
  if ($('startnext')) $('startnext').onclick = async () => { await I('start_next'); load(); };
  $('cur').textContent = a ? `Active: ${a.name} (${a.tier.replace('_', ' ')}), ${Math.floor(a.keystrokes / kpw).toLocaleString()} / ${a.target_words.toLocaleString()} words.` : 'No active project.';
  $('queue').innerHTML = data.queue.length ? 'Queued: ' + data.queue.map(q => esc(q.name)).join(', ') : '';
  $('done').innerHTML = '<h4>Completed</h4>' + (data.completed.map(p => `<div>${esc(p.name)} — ${p.target_words.toLocaleString()} words</div>`).join('') || 'None yet.');
  $('letters').innerHTML = data.journal.slice().reverse().map(l => `<div class="letter"><small>${esc(l.category)} · ${esc(l.project)} · ${new Date(l.received_at).toLocaleString()}</small><p>${esc(l.body)}</p><i>— ${esc(l.from)}</i></div>`).join('') || 'No fan letters yet — finish a project!';
}
for (const n of Object.keys(LWPalette.PRESETS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = n;
  b.onclick = () => { const c = LWPalette.colors(n); lastBody = c.body; document.querySelector('[data-c=body]').value = c.body; deriveInputs(); const shown = colors(); ch.setColors(shown); mp && mp.setColors(shown); };
  $('presets').append(b);
}
// Body picker only. Shading and hands are derived. A body with OKLCH L < 0.42 snaps back.
function deriveInputs() { const d = LWPalette.derive(document.querySelector('[data-c=body]').value); if (d) for (const k in d) document.querySelector(`[data-c=${k}]`).value = d[k]; }
document.querySelectorAll('[data-c]').forEach(i => {
  const apply = () => {
    if (i.dataset.c === 'body' && !LWPalette.bodyAllowed(i.value)) { i.value = lastBody; return; }
    if (i.dataset.c === 'body') { lastBody = i.value; deriveInputs(); }
    const shown = colors(); ch.setColors(shown); mp && mp.setColors(shown);
  };
  i.oninput = apply; i.onchange = apply;
});
$('kpw').oninput = () => $('kpwv').textContent = $('kpw').value;
$('save').onclick = async () => {
  const s = { ...data.settings, colors: colors(), keys_per_word: Math.min(5, Math.max(1, +$('kpw').value | 0)), idle_threshold_ms: Math.max(5, +$('idle').value) * 1000,
    tiers: { short_story: Math.max(1, +$('t1').value | 0), novella: Math.max(1, +$('t2').value | 0), novel: Math.max(1, +$('t3').value | 0) },
    desk_monitor: $('desk').value === '' ? null : +$('desk').value, roam_all_monitors: $('roam').checked, journal_dir: $('jdir').value.trim() || null,
    buddy_scale: +$('bs').value, walk_speed: +$('ws').value, bubble_px: +$('bp').value, buddy_name: $('buddy').value.trim() || data.settings.buddy_name,
    tool: $('tool').value, unlock_all: $('unlockall').checked, detect_titles: $('dt').checked, detect_media: $('dm').checked, detect_scroll: $('ds').checked, distraction_titles: $('titles').value.split('\n').map(x => x.trim()).filter(Boolean) };
  try { await I('update_settings', { settings: s }); $('msg').textContent = 'Saved'; setTimeout(() => $('msg').textContent = '', 2000); load(); }
  catch (e) { $('msg').textContent = String(e); }
};
$('padd').onclick = async () => { try { await I('new_project', { name: $('pname').value || 'Untitled', tier: $('ptier').value, targetWords: null }); } catch (e) { alert(e); } load(); };
$('tool').onchange = () => ch.setTool($('tool').value);
// Unlock-all applies immediately (it only changes what is unlocked, not progress)
$('unlockall').onchange = async () => {
  try { await I('update_settings', { settings: { ...data.settings, unlock_all: $('unlockall').checked } }); }
  catch (e) { $('msg').textContent = String(e); }
  load();
};
$('exp').onclick = async () => { try { $('expmsg').textContent = await I('export_journal'); } catch (e) { $('expmsg').textContent = 'Export failed: ' + e; } };
window.onhashchange = () => tab();
// The backend tells us which tab to show (no '#fragment' in the asset URL; it breaks the Windows bundle)
window.__TAURI__.event.listen('show-tab', e => tab(e.payload));
window.__TAURI__.event.listen('settings-changed', () => load());
LWCharacter.mount($('preview')).then(async c => { ch = c; c.setState('typing'); tab((await I('initial_tab')) || 'settings'); });
// live motion preview: a small buddy walking at the chosen speed and size, with a sample bubble
let mp, mpX = 0, mpV = 0, mpDir = 1, mpT = null;
LWCharacter.mount($('mpChar')).then(c => { mp = c; c.setState('wander'); requestAnimationFrame(mpFrame); });
function mpFrame(t) {
  const dt = mpT == null ? 0 : LWMotion.clampDt(t - mpT); mpT = t;
  const k = +$('bs').value || 1, w = $('motionPreview').clientWidth - 60 * k;
  const n = LWMotion.step([mpX, 0], [mpDir > 0 ? w : 0, 0], mpV, +$('ws').value || 96, dt, 1);
  mpX = n.pos[0]; mpV = n.v; if (n.arrived) { mpDir = -mpDir; mp.setDir(mpDir < 0 ? 'left' : 'right'); }
  $('mpWalker').style.transform = `translateX(${mpX}px) scale(${k})`;
  $('mpBubble').style.fontSize = (+$('bp').value || 12) + 'px'; // scaled with the buddy, like the overlay
  mp.setColors(colors());
  requestAnimationFrame(mpFrame);
}
for (const [id, fmt] of [['bs', v => Math.round(v * 100) + '%'], ['ws', v => v], ['bp', v => v]]) $(id).addEventListener('input', () => $(id + 'v').textContent = fmt(+$(id).value));
