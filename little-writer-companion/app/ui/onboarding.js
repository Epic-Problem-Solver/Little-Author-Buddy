// First-run onboarding: hello, name, any colour, where the desk controls are, what Settings changes, first story.
const I = (c, a) => window.__TAURI__.core.invoke(c, a), $ = id => document.getElementById(id);
const chromeDesk = document.documentElement.dataset.desk === 'chrome';
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const STEPS = 6;
const TITLES = ['', 'Meet your writing buddy', 'Name your buddy', 'Pick a colour', 'Where things are', 'What you can change', 'Your first story'];
const DEMO = ['#e8cfa9', '#cfe6ff', '#ffd0dc', '#d6f0c4', '#d7c2ff'];
let ch, colors = LWPalette.colors('Beige');
let playTimer = 0, colorTimer = 0, toolTimer = 0, pickBeat = null;

const sync = () => {
  document.querySelectorAll('[data-c]').forEach(i => { if (colors[i.dataset.c]) i.value = colors[i.dataset.c]; });
  const named = LWPalette.markPreset($('presets'), colors.body);
  const any = document.querySelector('.any-color');
  if (any) any.classList.toggle('on', !named);
  if (ch) ch.setColors(colors);
};

function deskBeats() {
  return [
    { spot: 'games', label: 'Games', state: 'typing', scene: 'desk',
      caption: chromeDesk
        ? 'Games. This button opens the list. Play runs in this window, then the desk comes back.'
        : 'Games. This button opens the list. Play starts a short game.' },
    { spot: 'gear', label: 'Gear', state: 'typing', scene: 'desk',
      caption: chromeDesk
        ? 'Settings. The gear changes the name, colour, size, and how soon a nap starts.'
        : 'Settings. The gear changes the name, colour, size, walk speed, and nap time. Pause listening is in the tray icon.' },
    { spot: 'close', label: 'Quit', state: 'typing', scene: 'desk',
      caption: chromeDesk
        ? 'Close. This closes the desk window.'
        : 'Quit. This closes Little Author Buddy and saves first.' },
    { spot: 'story', label: 'Story', state: 'typing', scene: 'desk',
      caption: 'The story line. It shows the title and how many words are in. Drag the desk to move it.' },
    { spot: 'roam', label: 'Break', state: chromeDesk ? 'asleep' : 'wander', scene: chromeDesk ? 'desk' : 'roam',
      caption: chromeDesk
        ? 'A break. When typing stops, Buddy sleeps at the desk. A letter or a digit wakes Buddy.'
        : 'A break. When typing stops, Buddy naps, then wanders the screen. A letter or a digit brings Buddy back.' },
    { spot: 'peek', label: chromeDesk ? 'Window' : 'Peek', state: chromeDesk ? 'asleep' : 'watch', scene: chromeDesk ? 'desk' : 'peek',
      caption: chromeDesk
        ? 'Leave the writing window short of full screen. A full-screen page covers this desk.'
        : 'A peek. Buddy can look out from the edge of another window, then race back when you write.' },
  ];
}

function tuneBeats() {
  return [
    { spot: 'color', label: 'Colour', caption: 'Any colour. The four chips are examples. Any colour opens the full picker. Shading and hands follow. The outline, desk, and tools stay put.',
      apply() {
        let k = 0;
        const paint = () => { if (ch) ch.setColors(LWPalette.normalize({ body: DEMO[k++ % DEMO.length] })); };
        paint();
        if (!reduce) colorTimer = setInterval(paint, 700);
      } },
    { spot: 'size', label: 'Size', state: chromeDesk ? 'proud' : 'wander', scene: 'grow',
      caption: chromeDesk
        ? 'Size and bubble text. Those sliders are in Settings, under the colours.'
        : 'Size, walk speed, and bubble text. Those sliders are in Settings, under the colours.' },
    { spot: 'nap', label: 'Nap', state: 'asleep',
      caption: 'Nap time. Settings asks how many idle seconds before sleep. It starts at 20 seconds.' },
    { spot: 'tool', label: 'Tools', state: 'typing',
      caption: 'Writing tools. The feather pen is ready now. A finished short story brings the typewriter. A finished novella brings the laptop.',
      apply() {
        if (ch) ch.setState('typing');
        const tools = ['pen', 'typewriter', 'laptop'];
        let k = 0;
        const next = () => { if (ch) ch.setTool(tools[k++ % tools.length]); };
        next();
        if (!reduce) toolTimer = setInterval(next, 1100);
      } },
    { spot: 'more', label: 'Later', state: 'proud',
      caption: 'Also in Settings: projects, the letter journal, and supporter hats. A hat can have its own colour. None of that changes the word count.' },
  ];
}

function stopPlay() {
  clearInterval(playTimer); playTimer = 0;
  clearInterval(colorTimer); colorTimer = 0;
  clearInterval(toolTimer); toolTimer = 0;
  pickBeat = null;
  const scene = $('scene');
  scene.classList.remove('desk', 'roam', 'peek', 'grow');
  $('caption').hidden = true;
  $('dots').hidden = true;
  $('captionList').hidden = true;
  $('miniBar').hidden = true;
  $('storyLine').hidden = true;
  $('win').hidden = true;
  document.querySelectorAll('.hot').forEach(el => el.classList.remove('hot'));
}

function showBeat(beats, index, desk) {
  clearInterval(colorTimer); colorTimer = 0;
  clearInterval(toolTimer); toolTimer = 0;
  const beat = beats[index];
  const scene = $('scene');
  scene.classList.toggle('desk', desk && beat.scene !== 'grow');
  scene.classList.toggle('roam', beat.scene === 'roam');
  scene.classList.toggle('peek', beat.scene === 'peek');
  scene.classList.toggle('grow', beat.scene === 'grow');
  $('win').hidden = beat.scene !== 'peek';
  $('miniBar').hidden = !desk;
  $('storyLine').hidden = !desk || beat.scene === 'roam' || beat.scene === 'peek';
  document.querySelectorAll('[data-spot]').forEach(el => el.classList.toggle('hot', el.dataset.spot === beat.spot));
  $('caption').textContent = beat.caption;
  $('dots').querySelectorAll('button').forEach((b, n) => b.classList.toggle('on', n === index));
  if (!ch) return;
  ch.setColors(colors);
  ch.setTool('pen');
  ch.setState(beat.state || 'typing');
  if (beat.apply) beat.apply();
}

function play(beats, desk) {
  const list = $('captionList');
  list.replaceChildren();
  for (const beat of beats) {
    const li = document.createElement('li');
    li.textContent = beat.caption;
    list.append(li);
  }
  list.hidden = !reduce;
  $('caption').hidden = reduce;
  $('dots').hidden = false;
  const host = $('dots');
  host.replaceChildren();
  let index = 0;
  const arm = () => {
    clearInterval(playTimer);
    if (reduce) return;
    playTimer = setInterval(() => { index = (index + 1) % beats.length; showBeat(beats, index, desk); }, 3600);
  };
  const pick = n => { index = n; showBeat(beats, index, desk); arm(); };
  pickBeat = spot => {
    const n = beats.findIndex(b => b.spot === spot);
    if (n >= 0) pick(n);
  };
  beats.forEach((beat, n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = beat.label;
    b.onclick = () => pick(n);
    host.append(b);
  });
  showBeat(beats, 0, desk);
  arm();
}

function go(n) {
  stopPlay();
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('on', s.id === 's' + n));
  $('progress').textContent = n + ' of ' + STEPS;
  $('stepTitle').textContent = TITLES[n] || '';
  if (n === 4) play(deskBeats(), true);
  else if (n === 5) play(tuneBeats(), false);
  else if (ch) {
    ch.setTool('pen');
    ch.setColors(colors);
    ch.setState({ 1: chromeDesk ? 'asleep' : 'wander', 2: 'proud', 3: 'proud', 6: 'typing' }[n] || 'proud');
  }
  const field = { 2: 'buddy', 6: 'title' }[n];
  if (field) setTimeout(() => $(field).focus(), 0);
}

document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
$('stage').addEventListener('click', e => {
  const spot = e.target.closest('[data-spot]');
  if (spot && pickBeat) pickBeat(spot.dataset.spot);
});
LWPalette.fillPresets($('presets'), (_name, next) => {
  document.querySelector('.any-color')?.classList.remove('nudge');
  colors = next;
  sync();
});
document.querySelectorAll('[data-c]').forEach(i => {
  const apply = () => {
    if (i.dataset.c === 'body' && !LWPalette.bodyAllowed(i.value)) { i.value = colors.body; return; }
    document.querySelector('.any-color')?.classList.remove('nudge');
    colors = LWPalette.normalize({ body: i.dataset.c === 'body' ? i.value : colors.body });
    sync();
  };
  i.oninput = apply;
  i.onchange = apply;
});
$('buddy').oninput = () => document.title = `Welcome to Little Author — ${$('buddy').value || 'your buddy'}`;
$('finish').onclick = async () => {
  $('finish').disabled = true;
  try { await I('finish_onboarding', { buddy: $('buddy').value, colors, title: $('title').value }); }
  catch (e) { alert(e); $('finish').disabled = false; }
};
$('title').onkeydown = e => { if (e.key === 'Enter') $('finish').click(); };
$('buddy').onkeydown = e => { if (e.key === 'Enter') go(3); };

(async () => {
  const bar = $('miniBar');
  for (const [id, file, glyph, label] of [['games', 'ui-game.svg', '🎮', 'Games'], ['gear', 'ui-gear.svg', '⚙', 'Settings'], ['close', 'ui-close.svg', '×', 'Quit']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.spot = id;
    b.setAttribute('aria-label', label);
    bar.append(b);
    await LWCharacter.button(b, file, glyph);
  }
  ch = await LWCharacter.mount($('preview'));
  ch.setSide('right');
  ch.setTool('pen');
  sync();
  go(1);
})();
