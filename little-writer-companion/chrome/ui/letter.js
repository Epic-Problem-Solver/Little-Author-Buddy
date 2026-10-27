// Same letter as the desktop overlay, drawn in its own window. Text only.
(async () => {
  let p = {};
  try { p = JSON.parse(new URLSearchParams(location.search).get('p') || '{}'); } catch (_) {}
  await LWContent.ready;
  const buddy = p.buddy || 'Buddy';
  const count = Number(p.completed_count) || 1;
  const L = LWContent.letter({
    buddy,
    projectTitle: p.name || '',
    tier: String(p.tier || '').replace('_', ' '),
    wordCount: Number(p.target_words || 0).toLocaleString(),
  }, count - 1, (p.name || '') + ':' + (p.completed_at || ''));
  document.getElementById('cat').textContent = 'A fan letter (' + L.category + ')';
  document.getElementById('letterBody').textContent = L.body;
  document.getElementById('from').textContent = '— ' + L.from;
  const note = document.getElementById('note');
  try {
    await window.__TAURI__.core.invoke('save_letter', {
      category: L.category, from: L.from, body: L.body, project: p.name || '',
    });
    note.textContent = 'Saved to journal';
  } catch (e) {
    note.textContent = 'Journal save failed: ' + e;
  }
  setTimeout(() => window.close(), 15000);
})();
