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
test('every preset keeps the beige desk and writing tools', () => {
  const beige = P.colors('Beige');
  const keys = ['desk', 'desk_shade', 'tool', 'tool_shade', 'screen', 'ink', 'feather', 'feather_shade', 'paper', 'paper_shade'];
  for (const name of ['Sky', 'Rose', 'Mint']) {
    const c = P.colors(name);
    for (const k of keys) assert.equal(c[k], beige[k], `${name} ${k}`);
    assert.notEqual(c.body, beige.body);
    assert.equal(c.outline, P.OUTLINE);
    assert.equal(c.desk, '#8a5a35');
    assert.equal(c.tool, '#7d8aa0');
    assert.equal(c.paper, '#f6efe2');
  }
});
test('bodies that would invert cannot be chosen; light presets can', () => {
  assert.equal(P.bodyAllowed('#1d2a4a'), false);
  assert.equal(P.bodyAllowed('#000000'), false);
  assert.equal(P.bodyAllowed('#3a1424'), false);
  assert.equal(P.bodyAllowed('nope'), false);
  assert.equal(P.bodyAllowed('#e8cfa9'), true);
  assert.equal(P.bodyAllowed('#777777'), true);
  for (const name of Object.keys(P.PRESETS)) assert.equal(P.bodyAllowed(P.PRESETS[name].body), true, name);
  const fixed = P.normalize({ body: '#1d2a4a', outline: '#abcdef', desk: '#000000', tool: '#111111' });
  assert.equal(fixed.body, P.PRESETS.Beige.body);
  assert.equal(fixed.outline, P.OUTLINE);
  assert.equal(fixed.desk, '#8a5a35');
  assert.equal(fixed.tool, '#7d8aa0');
  assert.equal(fixed.shade, P.derive(fixed.body).shade);
});
