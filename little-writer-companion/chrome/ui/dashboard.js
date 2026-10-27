// Events window for this test build. Each button calls dash_event.
const T = window.__TAURI__;
const $ = id => document.getElementById(id);
const GROUPS = [
  ['modes', [
    ['typing', 'Typing'],
    ['asleep', 'Asleep'],
    ['wander', 'Wander'],
    ['watch', 'Watching'],
    ['race', 'Race home'],
  ]],
  ['games', [
    ['play-chase', 'Chase the Mouse'],
    ['play-tag', 'Tag the Buddy'],
    ['play-redlight', 'Red Light Green Light'],
    ['play-highfive', 'High Five'],
    ['play-warmer', 'Hide and Seek'],
    ['away', 'Game over'],
  ]],
  ['desk', [
    ['suggest', 'Suggest a game'],
    ['letter', 'Fan letter'],
    ['notice', 'Unlock notice'],
  ]],
];

function say(text) { $('status').textContent = text; }

for (const [group, items] of GROUPS) {
  const host = $(group);
  for (const [id, label] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = async () => {
      if (!T) { say(label); return; }
      say('…');
      try {
        const msg = await T.core.invoke('dash_event', { id });
        say(msg || label);
      } catch (e) {
        const msg = e && e.message ? e.message : e;
        say(typeof msg === 'string' ? msg : 'Could not run that event.');
      }
    };
    host.appendChild(b);
  }
}
