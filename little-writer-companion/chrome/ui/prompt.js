// Sprint question. Ask and the explanation live here. Play stays on the overlay.
const T = window.__TAURI__;
const $ = id => document.getElementById(id);
let ch, snap = null, hatsApi = null;

function showLine(text) {
  const b = $('bubble');
  if (!text) { b.textContent = ''; b.classList.remove('on'); return; }
  b.textContent = text;
  b.classList.add('on');
}

function paint(s) {
  snap = s;
  if (!ch || !s) return;
  ch.setColors(s.colors || {});
  ch.setTool(s.tool || 'pen');
  const asking = s.focus_phase === 'ask';
  $('choices').classList.toggle('off', !asking);
  $('hit').classList.toggle('on', s.focus_phase === 'explain');
  if (s.focus_phase === 'ask' || s.focus_phase === 'explain') {
    ch.setFace('curious');
    ch.setBody('idle');
  }
  if (hatsApi) hatsApi.apply(s);
}

async function loadLine() {
  if (!T) return;
  try {
    const p = await T.core.invoke('prompt_line');
    if (p && p.text) showLine(p.text);
  } catch (_) {}
}

$('yes').onclick = () => { if (T) T.core.invoke('focus_answer', { yes: true }).catch(() => {}); };
$('no').onclick = () => { if (T) T.core.invoke('focus_answer', { yes: false }).catch(() => {}); };
$('hit').onclick = () => {
  if (!T || !snap || snap.focus_phase !== 'explain') return;
  T.core.invoke('focus_tag').catch(() => {});
};

(async () => {
  ch = await LWCharacter.mount($('charHost'));
  ch.setFace('curious');
  ch.setBody('idle');
  if (!T) return;
  hatsApi = LWCharacter.bindHats((c, a) => T.core.invoke(c, a), ch, () => snap);
  await hatsApi.refresh();
  const s = await T.core.invoke('get_snapshot');
  if (s) paint(s);
  await loadLine();
  T.event.listen('companion-state', e => paint(e.payload));
  T.event.listen('focus-say', e => { const p = e.payload || {}; if (p.text) showLine(p.text); });
})();
