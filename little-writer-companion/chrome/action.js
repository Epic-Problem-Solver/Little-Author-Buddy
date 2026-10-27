const $ = id => document.getElementById(id);

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res || res.ok === false) throw new Error((res && res.error) || 'request failed');
  return res;
}

async function refresh() {
  let s;
  try { s = await send({ type: 'status' }); }
  catch (e) { $('state').textContent = e.message || String(e); return; }
  $('state').textContent = s.quit
    ? 'The desk is closed.'
    : s.paused ? 'Paused. Letter keys are not counted.' : 'Listening on web pages.';
  $('pause').textContent = s.paused ? 'Resume' : 'Pause';
  $('pause').disabled = !!s.quit;
  $('desk').hidden = !s.quit;
  for (const id of ['projects', 'settings', 'journal', 'privacy', 'quit']) $(id).disabled = !!s.quit;
}

function openTab(tab) {
  return send({ type: 'invoke', cmd: 'open_settings', args: { tab } }).then(() => window.close());
}

$('pause').onclick = () => send({ type: 'invoke', cmd: 'toggle_pause', args: {} }).then(refresh).catch(e => { $('state').textContent = e.message || String(e); });
$('projects').onclick = () => openTab('projects');
$('settings').onclick = () => openTab('settings');
$('journal').onclick = () => openTab('journal');
$('privacy').onclick = () => openTab('privacy');
$('quit').onclick = () => send({ type: 'invoke', cmd: 'quit_app', args: {} }).then(() => window.close()).catch(() => window.close());
$('desk').onclick = () => send({ type: 'resume' }).then(() => window.close());

refresh();
