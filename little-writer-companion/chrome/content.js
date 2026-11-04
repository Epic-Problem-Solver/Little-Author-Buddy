// Counts words and wheel ticks in web pages. The message is marks: L (letter or
// digit), G (space, enter, tab), B (backspace). The key and the page address
// are not sent. Y and N during a game question are swallowed so they are not
// typed into the document.
let marks = '', wheels = 0, asking = false, live = true;

chrome.storage.session.get(['asking', 'live']).then(s => {
  if (s.asking != null) asking = !!s.asking;
  if (s.live != null) live = !!s.live;
}).catch(() => {});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'session') return;
  if (ch.asking) asking = !!ch.asking.newValue;
  if (ch.live) live = ch.live.newValue !== false;
});

function isAnswer(e) {
  if (!asking || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = e.key;
  if (!k || k.length !== 1) return false;
  const c = k.toLowerCase();
  return c === 'y' || c === 'n';
}

// A hyphen or an apostrophe returns nothing, so it stays inside the word.
// Backspace repeats shrink it. A held letter or digit counts once.
function markOf(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return '';
  const k = e.key || '';
  const code = e.code || '';
  if (k === 'Backspace' || code === 'Backspace') return 'B';
  if (e.repeat) return '';
  if (k === ' ' || k === 'Enter' || k === 'Tab' || code === 'Space' || code === 'Enter' || code === 'NumpadEnter' || code === 'Tab') return 'G';
  if (k.length === 1) {
    const c = k.toLowerCase();
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) return 'L';
    return '';
  }
  if (k === 'Process' || k === 'Unidentified' || k === 'Dead') {
    if (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || /^Numpad[0-9]$/.test(code)) return 'L';
  }
  return '';
}

document.addEventListener('keydown', e => {
  if (!live) return;
  if (isAnswer(e)) {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'answer', yes: e.key.toLowerCase() === 'y' }).catch(() => {});
    return;
  }
  const m = markOf(e);
  if (m && marks.length < 256) marks += m;
}, true);
document.addEventListener('keyup', e => {
  if (!live || !asking) return;
  const k = e.key;
  if (!k || k.length !== 1) return;
  const c = k.toLowerCase();
  if (c === 'y' || c === 'n') { e.preventDefault(); e.stopPropagation(); }
}, true);
window.addEventListener('wheel', () => { if (live) wheels++; }, { capture: true, passive: true });

setInterval(() => {
  if (!marks && !wheels) return;
  const msg = { type: 'input', marks, wheels };
  marks = '';
  wheels = 0;
  chrome.runtime.sendMessage(msg).catch(() => {});
}, 200);
