const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
globalThis.fetch = async p => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8')) });
const C = require('../content.js');
const V = { buddy: 'Pip', projectTitle: 'Harbor', tier: 'short story', wordCount: '3,000' };
test('a {buddy} letter is reachable with a fixed seed and the name is filled in', async () => {
  await C.ready;
  const L = C.letter(V, 0, 'Harbor:1'); // index 0 = encouragement
  assert.match(L.body + L.from, /Pip/);
  assert.doesNotMatch(L.body, /\{buddy\}/);
});
test('{buddy} letters show up often (>= 25% over 300 completions)', async () => {
  await C.ready;
  let n = 0; for (let i = 0; i < 300; i++) if (/Pip/.test(C.letter(V, i, 'p' + i).body)) n++;
  assert.ok(n >= 75, `only ${n}/300`);
});
