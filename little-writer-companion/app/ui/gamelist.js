// Games window. Each card is one engine. Play starts it on the overlay.
const T = window.__TAURI__;
const $ = id => document.getElementById(id);

function say(text) { $('status').textContent = text; }

function card(game) {
  const art = document.createElement('article');
  const h = document.createElement('h2');
  h.textContent = game.name || game.id;
  const p = document.createElement('p');
  p.textContent = game.blurb || '';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Play';
  b.onclick = async () => {
    if (!T) { say(game.name || game.id); return; }
    say('…');
    try {
      await T.core.invoke('play_game', { id: game.id });
      say('Playing ' + (game.name || game.id) + '.');
    } catch (e) {
      const msg = e && e.message ? e.message : e;
      say(typeof msg === 'string' ? msg : 'Could not start that game.');
    }
  };
  art.append(h, p, b);
  return art;
}

(async () => {
  if (!T) return;
  try {
    const games = await T.core.invoke('game_catalog');
    const host = $('list');
    for (const g of games || []) host.appendChild(card(g));
  } catch (_) {
    say('Could not list the games.');
  }
})();
