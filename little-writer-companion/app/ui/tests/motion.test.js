const test = require('node:test');
const assert = require('node:assert');
const M = require('../motion.js');
test('dt clamp', () => {
  assert.strictEqual(M.clampDt(16), 0.016);
  assert.strictEqual(M.clampDt(5000), M.MAX_DT); // stall after sleep / hidden tab
  assert.strictEqual(M.clampDt(-3), 0); assert.strictEqual(M.clampDt(NaN), 0);
});
test('speed cap and no per-frame jump', () => {
  let s = { pos: [0, 0], v: 0 };
  let maxStep = 0;
  for (let i = 0; i < 2000; i++) {
    const dt = M.clampDt(i % 50 === 0 ? 10000 : 16.7); // periodic stalls
    const n = M.step(s.pos, [100000, 0], s.v, 1e9, dt, 1);
    maxStep = Math.max(maxStep, n.pos[0] - s.pos[0]);
    assert.ok(n.v <= M.MAX_SPEED + 1e-9);
    s = n;
  }
  assert.ok(maxStep <= M.MAX_SPEED * M.MAX_DT + 1e-9, `max step ${maxStep}`);
});
test('eases in and out, never overshoots', () => {
  let s = { pos: [0, 0], v: 0 }, vs = [];
  for (let i = 0; i < 600 && !s.arrived; i++) { s = M.step(s.pos, [300, 0], s.v, 400, 1 / 60, 1); vs.push(s.v); assert.ok(s.pos[0] <= 300); }
  assert.ok(s.arrived);
  assert.ok(vs[0] < vs[5] && vs[5] < 400, 'ease-in');
  const peak = Math.max(...vs); assert.ok(vs[vs.length - 2] < peak / 2, 'ease-out');
});
test('scale per monitor and smooth transition', () => {
  assert.strictEqual(M.scaleFor(2, 1, 1), 2);          // 200% monitor, overlay at 100%
  assert.strictEqual(M.scaleFor(1, 2, 1), 0.5);        // 100% monitor, overlay at 200%
  assert.strictEqual(M.scaleFor(1.5, 1.5, 1.2), 1.2);  // user size multiplies
  let k = 1; for (let i = 0; i < 60; i++) k = M.smoothScale(k, 2, 1 / 60);
  assert.ok(k > 1.9 && k < 2);                        // ~1 s to settle, no jump
  assert.ok(M.smoothScale(1, 2, 1 / 60) - 1 < 0.2);
});
test('speed in logical px converts by k', () => {
  const a = M.step([0, 0], [1000, 0], 200, 200, 0.05, 1), b = M.step([0, 0], [1000, 0], 200, 200, 0.05, 2);
  assert.ok(Math.abs(b.pos[0] - 2 * a.pos[0]) < 1e-9);
  assert.strictEqual(M.modeSpeed('race_back', 500), M.MAX_SPEED);
});

test('race-back target = desk buddy body centre, per side and size (100/130/160 -> capped 1.3)', () => {
  const M = require('../motion.js');
  const home = [1400, 600];
  const exp = { // body centre computed by hand from the home layout (host 40,30; origin 60,110; svg x0.5)
    right: { 1: [1400 + 40 + 86, 600 + 30 + 55], 1.3: [1400 + 40 + 60 + 26 * 1.3, 600 + 30 + 110 - 55 * 1.3] },
    left: { 1: [1400 + 40 + 34, 600 + 30 + 55], 1.3: [1400 + 40 + 60 - 26 * 1.3, 600 + 30 + 110 - 55 * 1.3] },
  };
  for (const side of ['right', 'left']) for (const u of [1, 1.3, 1.6]) {
    const hs = Math.min(u, 1.3), k = M.deskScale(1, u);
    assert.equal(k, hs);
    const { body, target } = M.deskBodyTarget(home, 1, side, u, k);
    assert.ok(Math.abs(body[0] - exp[side][hs][0]) < 1e-9 && Math.abs(body[1] - exp[side][hs][1]) < 1e-9, `${side} ${u}: ${body}`);
    // runner (away pose, body centre svg 120,110 = 60k,55k from its top-left) lands exactly on the desk body: no snap
    assert.ok(Math.abs(target[0] + 60 * k - body[0]) < 1e-9 && Math.abs(target[1] + 55 * k - body[1]) < 1e-9);
  }
  // HiDPI: home window at 150% seen from a 100% overlay
  const t = M.deskBodyTarget([0, 0], 1.5, 'right', 1, M.deskScale(1.5, 1));
  assert.deepEqual(t.body, [(40 + 86) * 1.5, (30 + 55) * 1.5]);
});
