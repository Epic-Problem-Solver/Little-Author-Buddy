const test = require('node:test'), assert = require('node:assert');
const P = require('../palette.js');
const { lwDeriveShade } = require('../assets/lw-color.js');
test('derive = Animator lwDeriveShade, hands = shade', () => {
  for (const b of ['#e8cfa9', '#1d2a4a', '#cfe6ff']) { const d = P.derive(b); assert.equal(d.shade, lwDeriveShade(b)); assert.equal(d.hands, d.shade); }
});
test('light body -> darker shade, dark body -> lighter shade', () => {
  const lum = h => [0, 2, 4].reduce((a, i, k) => a + [0.2126, 0.7152, 0.0722][k] * parseInt(h.slice(1 + i, 3 + i), 16), 0);
  assert.ok(lum(P.derive('#e8cfa9').shade) < lum('#e8cfa9'));
  assert.ok(lum(P.derive('#1d2a4a').shade) > lum('#1d2a4a'));
});
test('Rust store.rs derive_body uses the same fixture', () => {
  for (const [b, s] of Object.entries(require('./derive_fixture.json'))) assert.equal(P.derive(b).shade, s, b);
});
test('invalid input -> null; presets carry derived shade', () => {
  assert.equal(P.derive('nope'), null);
  const c = P.colors('Sky'); assert.equal(c.shade, P.derive(c.body).shade);
});
