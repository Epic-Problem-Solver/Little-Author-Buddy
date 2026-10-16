// First-run onboarding: welcome -> buddy name -> colours (live preview) -> first project title.
const I = (c, a) => window.__TAURI__.core.invoke(c, a), $ = id => document.getElementById(id);
let ch, colors = LWPalette.colors('Beige');
const sync = () => { document.querySelectorAll('[data-c]').forEach(i => i.value = colors[i.dataset.c]); ch && ch.setColors(colors); };
function go(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('on', s.id === 's' + n));
  if (ch) ch.setState(n === 4 ? 'typing' : n === 1 ? 'wander' : 'proud');
  const f = { 2: 'buddy', 4: 'title' }[n]; if (f) setTimeout(() => $(f).focus(), 0);
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
for (const n of Object.keys(LWPalette.PRESETS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = n;
  b.onclick = () => { colors = LWPalette.colors(n); sync(); }; $('presets').append(b);
}
document.querySelectorAll('[data-c]').forEach(i => i.oninput = () => { colors[i.dataset.c] = i.value; if (i.dataset.c === 'body') Object.assign(colors, LWPalette.derive(i.value) || {}); ch.setColors(colors); });
$('buddy').oninput = () => document.title = `Welcome to Little Writer — ${$('buddy').value || 'your buddy'}`;
$('finish').onclick = async () => {
  $('finish').disabled = true;
  try { await I('finish_onboarding', { buddy: $('buddy').value, colors, title: $('title').value }); }
  catch (e) { alert(e); $('finish').disabled = false; }
};
$('title').onkeydown = e => { if (e.key === 'Enter') $('finish').click(); };
$('buddy').onkeydown = e => { if (e.key === 'Enter') go(3); };
LWCharacter.mount($('preview')).then(c => { ch = c; ch.setTool('pen'); sync(); go(1); });
