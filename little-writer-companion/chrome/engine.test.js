const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('../app/ui/assets/lw-color.js');
const LWC = require('./engine.js');

function session(now, saved) {
  const s = LWC.createSession(now || 0, saved);
  s.rng = () => 0;
  return s;
}
function tick(s, now, extra) {
  return LWC.tick(s, now, extra || {});
}

test('idle sleep stays at the desk until a letter key', () => {
  const s = session(0);
  s.data.settings.idle_threshold_ms = 20000;
  s.keys = 3;
  tick(s, 1000);
  assert.equal(s.machine.mode, 'typing');
  tick(s, 15000);
  assert.equal(s.machine.mode, 'typing');
  tick(s, 21000);
  assert.equal(s.machine.mode, 'asleep');
  tick(s, 60000);
  assert.equal(s.machine.mode, 'asleep');
  s.tickN = 3;
  tick(s, 90000, { fg: { id: 1, title: 'YouTube - Chrome', x: 1, y: 2, w: 3, h: 4 } });
  assert.equal(s.machine.mode, 'asleep');
  assert.equal(s.snap.watch, null);
  s.keys += 1;
  tick(s, 91000);
  assert.equal(s.machine.mode, 'typing');
});

test('an idle foreground title is not saved and does not pull Buddy off the desk', () => {
  const s = session(0);
  s.data.settings.idle_threshold_ms = 1000;
  s.machine.lastKey = 0;
  s.tickN = 3;
  const secret = 'TopSecretWindowTitle';
  tick(s, 5000, { fg: { id: 42, title: secret + ' YouTube', x: 10, y: 20, w: 30, h: 40 } });
  assert.equal(s.snap.mode, 'asleep');
  assert.equal(s.snap.watch, null);
  const json = JSON.stringify(s.snap);
  assert.equal(json.includes(secret), false);
  assert.equal(LWC.saveJson(s).includes(secret), false);
  assert.equal(LWC.saveJson(s).includes('lastKey'), false);
});

test('credit holds keys until a story has a title, then completes and carries overflow', () => {
  const s = session(0);
  s.keys = 10;
  tick(s, 1000);
  assert.equal(s.data.carry_keystrokes, 10);
  assert.equal(s.data.active, null);
  assert.equal(s.snap.needs_title, true);
  LWC.invoke(s, 'finish_onboarding', { buddy: 'Ada', colors: { body: '#e8cfa9' }, title: 'S' }, 2000);
  s.data.active.keystrokes = 0;
  s.data.active.target_words = 2;
  s.data.settings.keys_per_word = 5;
  s.keys += 12;
  const out = tick(s, 3000);
  assert.equal(s.data.active, null);
  assert.equal(s.data.awaiting_next, true);
  assert.equal(s.data.carry_keystrokes, 2);
  assert.equal(s.data.completed[0].keystrokes, 10);
  assert.ok(out.events.some(e => e.name === 'notice' && e.payload === 'Unlocked: Novella + typewriter!'));
  s.keys += 4;
  tick(s, 4000);
  assert.equal(s.data.carry_keystrokes, 6);
});

test('fifteen minutes of writing suggests a game and sleep starts the wait over', () => {
  const s = session(0);
  const suggestMs = 15 * 60 * 1000;
  s.data.settings.focus_minutes = 0;
  s.data.settings.idle_threshold_ms = 20000;
  tick(s, 1000);
  assert.equal(s.machine.mode, 'typing');
  assert.equal(s.focus.phase, 'idle');
  assert.equal(s.focus.elapsed_ms, 1000);
  s.paused = true;
  tick(s, 3000);
  assert.equal(s.focus.elapsed_ms, 1000);
  s.paused = false;
  tick(s, 23000);
  assert.equal(s.machine.mode, 'asleep');
  assert.equal(s.focus.elapsed_ms, 0);
  s.machine.lastKey = 40000;
  s.focus.elapsed_ms = suggestMs - 500;
  s.focusAt = 40000;
  const named = tick(s, 41000);
  assert.equal(s.machine.mode, 'typing');
  assert.equal(s.focus.phase, 'idle');
  assert.equal(s.focus.elapsed_ms, 0);
  const say = named.events.find(e => e.name === 'focus-say');
  assert.equal(say.payload.kind, 'suggest');
  assert.equal(say.payload.game, 'chase');
  assert.equal(say.payload.text, 'Ooh! How about Chase the Mouse?');
  assert.equal(JSON.stringify(s.snap).includes('"title"'), false);
  s.games = [{ id: 'chase', name: 'Cursor chase', order: 1, explain: 'Ooh! {buddy} chases.', cheer: 'Got', away: '' }];
  s.focus.elapsed_ms = suggestMs - 500;
  s.focusAt = 41000;
  s.machine.lastKey = 41000;
  const packed = tick(s, 42000);
  assert.equal(packed.events.find(e => e.name === 'focus-say').payload.text, 'Ooh! How about Cursor chase?');
  assert.equal(s.focus.phase, 'idle');
});

test('the games list includes every game and play does not need a pack', () => {
  const s = session(0);
  s.data.settings.buddy_name = 'Ada';
  const cards = LWC.invoke(s, 'game_catalog', {}, 1).value;
  assert.deepEqual(cards.map(c => c.id), ['chase', 'tag', 'redlight', 'highfive', 'warmer']);
  assert.equal(cards[0].name, 'Chase the Mouse');
  assert.match(cards.find(c => c.id === 'warmer').blurb, /Ada hides behind a shape in this window/);
  assert.equal(cards.map(c => c.blurb).join(' ').includes('{buddy}'), false);
  s.games = [
    { id: 'tag', name: 'Tag', order: 2, explain: 'Ooh! {buddy} runs.', cheer: 'Got', away: '' },
    { id: 'warmer', name: 'Window warm', order: 5, explain: 'Ooh! Find {buddy} by the window.', cheer: 'Found', away: '' },
  ];
  const tagged = LWC.invoke(s, 'game_catalog', {}, 2).value.find(c => c.id === 'tag');
  assert.equal(tagged.name, 'Tag');
  assert.equal(tagged.blurb, 'Ooh! Ada runs.');
  const warm = LWC.invoke(s, 'game_catalog', {}, 3).value.find(c => c.id === 'warmer');
  assert.equal(warm.name, 'Window warm');
  assert.match(warm.blurb, /shape in this window/);
  assert.equal(warm.blurb.includes('by the window'), false);
  const open = LWC.invoke(s, 'open_games', {}, 4);
  assert.equal(open.events[0].name, 'open-games');
  assert.equal(open.events[0].internal, true);
  s.focus.game = 'tag';
  assert.throws(() => LWC.invoke(s, 'play_game', { id: 'nope' }, 5), /Unknown game/);
  assert.equal(s.focus.phase, 'idle');
  assert.equal(s.focus.game, 'tag');
  const play = LWC.invoke(s, 'play_game', { id: 'warmer' }, 6);
  assert.equal(s.focus.phase, 'play');
  assert.equal(s.focus.game, 'warmer');
  assert.equal(play.events.some(e => e.name === 'focus-say'), false);
  assert.equal(play.events[0].payload.focus_phase, 'play');
  s.keys += 1;
  s.focusAt = 6;
  s.machine.lastKey = 6;
  const ended = tick(s, 7);
  assert.equal(s.focus.phase, 'idle');
  assert.equal(ended.events.some(e => e.name === 'focus-say'), false);
  assert.equal(LWC.sayEvent('suggest', '', 'Ada', []).text, 'Ooh! Time for a game!');
  assert.equal(LWC.sayEvent('suggest', 'redlight', 'Ada', []).text, 'Ooh! How about Red Light Green Light?');
  assert.match(LWC.sayEvent('explain', 'warmer', 'Ada', [], {}).text, /hides behind a shape in this window/);
});

test('the window colour is a hex setting', () => {
  const s = session(0);
  assert.equal(s.snap.page_color, '#f6efe2');
  LWC.invoke(s, 'update_settings', { settings: Object.assign({}, s.data.settings, { page_color: '#112233' }) }, 1);
  assert.equal(s.data.settings.page_color, '#112233');
  assert.equal(s.snap.page_color, '#112233');
  LWC.invoke(s, 'update_settings', { settings: Object.assign({}, s.data.settings, { page_color: 'red' }) }, 2);
  assert.equal(s.data.settings.page_color, '#f6efe2');
  assert.equal(s.snap.page_color, '#f6efe2');
});

test('pause drops letter keys and the save never stores a character', () => {
  const s = session(0);
  LWC.invoke(s, 'finish_onboarding', { buddy: 'Buddy', colors: { body: '#cfe6ff' }, title: 'Notes' }, 1);
  LWC.invoke(s, 'toggle_pause', {}, 1);
  LWC.addInput(s, 5, 2);
  tick(s, 2000);
  assert.equal(s.data.total_keystrokes, 0);
  LWC.invoke(s, 'toggle_pause', {}, 2);
  LWC.addInput(s, 5, 0);
  tick(s, 3000);
  assert.equal(s.data.total_keystrokes, 5);
  assert.equal(s.data.active.keystrokes, 5);
  const saved = LWC.saveJson(s);
  assert.equal(saved.includes('"title"'), false);
  assert.equal(saved.includes('key_char'), false);
});

test('supporter packs load in order and a newer pack is refused', () => {
  const root = path.join(__dirname, '..', 'supporter');
  const read = (dir, id) => {
    const files = {};
    for (const name of ['manifest.json', 'hat.svg', 'game.json']) {
      const p = path.join(dir, id, name);
      if (fs.existsSync(p)) files[name] = fs.readFileSync(p, 'utf8');
    }
    return { id, files };
  };
  const games = fs.readdirSync(path.join(root, 'games')).map(id => read(path.join(root, 'games'), id));
  const hats = fs.readdirSync(path.join(root, 'hats')).map(id => read(path.join(root, 'hats'), id));
  const s = session(0);
  LWC.setPackFiles(s, games.concat(hats));
  assert.deepEqual(s.games.map(g => g.id), ['chase', 'tag', 'redlight', 'highfive', 'warmer']);
  assert.deepEqual(s.games.map(g => g.name), ['Chase the Mouse', 'Tag the Buddy', 'Red Light Green Light', 'High Five', 'Hide and Seek']);
  assert.deepEqual(s.hats.map(h => h.info.id), ['beret', 'beanie', 'party', 'cowboy', 'cap']);
  const say = LWC.sayEvent('explain', 'chase', 'Ada', s.games);
  assert.match(say.text, /Ada/);
  assert.match(say.text, /Click when you're ready/);
  LWC.setPackFiles(s, [{
    id: 'chase',
    files: {
      'manifest.json': JSON.stringify({ id: 'chase', kind: 'game', name: 'Chase', minAppVersion: '9.0.0', engine: 'chase', files: ['game.json'] }),
      'game.json': JSON.stringify({ explain: 'Hi', cheer: 'Yes' }),
    },
  }]);
  assert.equal(s.games.length, 0);
});

test('a journal folder with .. is refused and a letter file name stays inside the folder', () => {
  const s = session(0);
  assert.throws(() => LWC.invoke(s, 'update_settings', { settings: Object.assign({}, s.data.settings, { journal_dir: 'C:\\docs\\..\\secret' }) }, 1));
  LWC.invoke(s, 'update_settings', { settings: Object.assign({}, s.data.settings, { journal_dir: 'Little Author Journal' }) }, 1);
  assert.equal(s.data.settings.journal_dir, null);
  const saved = LWC.invoke(s, 'save_letter', { category: 'encouragement', from: 'A reader', body: 'Hello', project: 'My Tale' }, 50);
  assert.match(saved.value, /\.md$/);
  const file = saved.events.find(e => e.name === 'journal-file').payload;
  assert.equal(file.name.includes('..'), false);
  assert.equal(file.name.includes('/'), false);
  assert.match(file.markdown, /Hello/);
});

test('placeHome clamps the desk onto a monitor', () => {
  const mons = [{ x: 0, y: 0, w: 1920, h: 1080, scale: 1, primary: true }];
  const p = LWC.placeHome(null, [200, 200], mons);
  assert.ok(p[1] + 200 <= 1080 && p[0] + 200 <= 1920);
  assert.deepEqual(LWC.placeHome([100, 950], [200, 200], mons), [100, 880]);
  assert.deepEqual(LWC.placeHome([1900, -50], [200, 200], mons), [1720, 0]);
});

test('update judgement reads only the release tag', () => {
  assert.equal(LWC.judgeUpdate('0.8.0', 'v0.8.0').state, 'current');
  assert.equal(LWC.judgeUpdate('0.8.0', 'v0.9.0').state, 'newer');
  assert.equal(LWC.judgeUpdate('0.8.0', 'v0.7.0').state, 'ahead');
  assert.equal(LWC.tagName('{"tag_name":"v0.8.0","html_url":"https://evil.example"}'), 'v0.8.0');
  assert.equal(LWC.tagName('{"tag_name":"v0.8.0\\n"}'), null);
});

const zlib = require('zlib');

function crc32(bytes) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipOf(files, method) {
  method = method || 0;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const raw = Buffer.from(data);
    const payload = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, payload);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    offset += local.length + payload.length;
  }
  const centralBlob = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([centralBlob, eocd]));
}

function inflate(buf, limit) {
  return zlib.inflateRawSync(buf, { maxOutputLength: limit });
}

function hatFiles(id, name, min) {
  return [
    [id + '/manifest.json', JSON.stringify({
      id, kind: 'hat', name, minAppVersion: min || '0.6.2', color: 'free', defaultColor: '#c4534a', files: ['hat.svg'], order: 1,
    })],
    [id + '/hat.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
  ];
}

function gameFiles(id) {
  return [
    [id + '/manifest.json', JSON.stringify({
      id, kind: 'game', name: 'Chase', minAppVersion: '0.6.2', engine: id, order: 1, files: ['game.json'],
    })],
    [id + '/game.json', JSON.stringify({ explain: 'Ooh! {buddy} chases the cursor.', cheer: 'Got it!' })],
  ];
}

test('a supporter zip installs hats and games and replaces the same id', async () => {
  const zip = zipOf(hatFiles('beanie', 'Knit beanie').concat(gameFiles('chase'), [['LICENSE', 'MIT'], ['README.txt', 'hi']]));
  const installed = await LWC.installZip(zip, null);
  assert.equal(installed.message, 'Installed 1 hat and 1 game.');
  assert.equal(installed.installed, true);
  assert.deepEqual(installed.packs.map(p => p.id).sort(), ['beanie', 'chase']);
  const again = await LWC.installZip(zipOf(gameFiles('chase'), 8), inflate);
  const merged = LWC.mergePacks(
    [{ id: 'tag', files: { 'manifest.json': 'keep' } }].concat(installed.packs),
    again.packs
  );
  assert.equal(merged.length, 3);
  assert.equal(merged.find(p => p.id === 'tag').files['manifest.json'], 'keep');
  assert.match(merged.find(p => p.id === 'chase').files['game.json'], /chases the cursor/);
});

test('a path that leaves the zip installs nothing', async () => {
  const bad = zipOf(hatFiles('beanie', 'Knit beanie').concat([['../secret.txt', 'no']]));
  await assert.rejects(() => LWC.installZip(bad, null), e => e.install === 'Unsafe');
  assert.equal(LWC.installErrorMessage('Unsafe'), 'That zip could not be used.');
  const empty = await LWC.installZip(zipOf([['README.txt', 'hi']]), null);
  assert.equal(empty.installed, false);
  assert.equal(empty.message, 'This zip had no supporter packs the app could use.');
  assert.deepEqual(empty.packs, []);
});

test('a newer pack is named and an extra file leaves that pack out', async () => {
  const zip = zipOf([
    ['later/manifest.json', JSON.stringify({
      id: 'later', name: 'Later hat', minAppVersion: '99.0.0', order: 2,
    })],
    ['soon/manifest.json', JSON.stringify({
      id: 'soon', name: 'Soon hat', minAppVersion: '99.0.1', order: 1,
    })],
  ].concat(hatFiles('beanie', 'Knit beanie'), [['beanie/notes.txt', 'extra']]));
  const result = await LWC.installZip(zip, null);
  assert.equal(result.installed, false);
  assert.equal(result.message, 'Soon hat and Later hat need a newer Little Author Buddy, so they were left out. Some packs in that zip were left out.');
  const kept = await LWC.installZip(zipOf(gameFiles('chase').concat([['chase/notes.txt', 'extra'], ...hatFiles('beanie', 'Knit beanie')])), null);
  assert.equal(kept.message, 'Installed 1 hat. Some packs in that zip were left out.');
  assert.deepEqual(kept.packs.map(p => p.id), ['beanie']);
});

test('the shipped supporter zip installs five hats and five games', async () => {
  const zip = fs.readFileSync(path.join(__dirname, '..', 'Little Author Buddy DLC.zip'));
  const result = await LWC.installZip(zip, inflate);
  assert.equal(result.message, 'Installed 5 hats and 5 games.');
  assert.equal(result.installed, true);
  assert.equal(result.packs.length, 10);
  const gameNames = result.packs
    .filter(p => p.files['game.json'])
    .map(p => JSON.parse(p.files['manifest.json']).name)
    .sort();
  assert.deepEqual(gameNames, ['Chase the Mouse', 'Hide and Seek', 'High Five', 'Red Light Green Light', 'Tag the Buddy']);
});

test('welcome notes follow the saved version and describe the Chrome desk', () => {
  assert.equal(LWC.pendingWelcome('', false, '0.8.0'), null);
  const all = LWC.pendingWelcome('', true, '0.8.0');
  assert.deepEqual(all.map(s => s.version), ['0.7.0', '0.8.0']);
  assert.match(all.map(s => s.lines.join(' ')).join(' '), /suggests a game/);
  assert.match(all.map(s => s.lines.join(' ')).join(' '), /fills this window/);
  assert.equal(all.map(s => s.lines.join('\n')).join('\n').includes('wandering'), false);
  assert.equal(all.map(s => s.lines.join('\n')).join('\n').includes('active window'), false);
  const jumped = session(0, { onboarded: true, seen_version: '0.7.0', settings: { buddy_name: 'Ada' } });
  assert.equal(jumped.welcomeDue, true);
  assert.deepEqual(jumped.welcome.map(s => s.version), ['0.8.0', '0.9.0']);
  const view = LWC.invoke(jumped, 'get_welcome', {}, 1).value;
  assert.equal(view.buddy, 'Ada');
  assert.equal(view.sections[0].version, '0.8.0');
  const dismiss = LWC.invoke(jumped, 'dismiss_welcome', {}, 2);
  assert.equal(dismiss.events.some(e => e.name === 'close-welcome'), true);
  assert.equal(jumped.data.seen_version, '0.7.0');
  assert.equal(LWC.pendingWelcome('0.8.0', true, '0.8.0'), null);
  assert.equal(LWC.pendingWelcome('0.9.0', true, '0.8.0'), null);
  assert.deepEqual(LWC.pendingWelcome('0.8.0', true, '0.9.0').map(s => s.version), ['0.9.0']);
  assert.deepEqual(LWC.pendingWelcome('0.9.0', true, '0.10.0'), []);
  const fresh = session(0);
  assert.equal(fresh.welcomeDue, false);
  LWC.invoke(fresh, 'finish_onboarding', { buddy: 'Ada', colors: { body: '#cfe6ff' }, title: 'Notes' }, 1);
  assert.equal(fresh.data.seen_version, '0.9.0');
  assert.equal(LWC.pendingWelcome(fresh.data.seen_version, true, LWC.APP_VERSION), null);
});
