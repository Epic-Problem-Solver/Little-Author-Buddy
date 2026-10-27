// Counts letter keys and wheel ticks in web pages. The message is a count.
// The key, the code, and the page address are not sent. Y and N during a game
// question are swallowed so they are not typed into the document.
let letters = 0, wheels = 0, asking = false, live = true;

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
function isLetter(e) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = e.key || '';
  if (k.length === 1) {
    const c = k.toLowerCase();
    return c >= 'a' && c <= 'z';
  }
  return (k === 'Process' || k === 'Unidentified' || k === 'Dead') && /^Key[A-Z]$/.test(e.code || '');
}

document.addEventListener('keydown', e => {
  if (!live) return;
  if (isAnswer(e)) {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'answer', yes: e.key.toLowerCase() === 'y' }).catch(() => {});
    return;
  }
  if (isLetter(e)) letters++;
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
  if (!letters && !wheels) return;
  const msg = { type: 'input', letters, wheels };
  letters = 0;
  wheels = 0;
  chrome.runtime.sendMessage(msg).catch(() => {});
}, 200);
