// Click catcher for the ready click and for tag. It covers Buddy only, so the rest of the desktop still receives clicks.
const T = window.__TAURI__;
document.documentElement.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  if (T) T.core.invoke('focus_tag').catch(() => {});
});
