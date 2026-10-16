const test = require('node:test');
const assert = require('node:assert');
const H = require('../hide.js');
const W = 120, Hh = 110;
test('re-clip follows a moved window', () => {
  const r1 = { x0: 500, y0: 100, x1: 1300, y1: 900 };
  const g1 = H.windowGeom('right', 0.5, r1, W, Hh);
  assert.strictEqual(g1.line, 500);
  assert.deepStrictEqual(H.clip(g1.pos[0], W, g1.line, 'right'), { l: 0, r: W * (1 - H.VIS) });
  const r2 = { x0: 700, y0: 300, x1: 1500, y1: 1100 }; // moved +200,+200
  const g2 = H.windowGeom('right', 0.5, r2, W, Hh);
  assert.strictEqual(g2.line, 700);
  assert.deepStrictEqual([g2.pos[0] - g1.pos[0], g2.pos[1] - g1.pos[1]], [200, 200]);
  // stale clip would expose: sprite at old position vs new line -> nothing clipped
  assert.strictEqual(H.clip(g1.pos[0], W, g2.line, 'right').r, 0);
});
test('left-side hide uses the right edge', () => {
  const r = { x0: 0, y0: 0, x1: 800, y1: 600 };
  const g = H.windowGeom('left', 0, r, W, Hh);
  assert.strictEqual(g.line, 800);
  const c = H.clip(g.pos[0], W, g.line, 'left');
  assert.ok(Math.abs(c.l - W * (1 - H.VIS)) < 1e-9 && c.r === 0);
});
test('resize keeps relative height', () => {
  const g = H.windowGeom('right', 1, { x0: 0, y0: 0, x1: 800, y1: 1000 }, W, Hh);
  assert.strictEqual(g.pos[1], 1000 - Hh);
});
test('pop-out when too small, minimised or gone', () => {
  const big = { x0: 0, y0: 0, x1: 800, y1: 600 };
  assert.strictEqual(H.verdict({ state: 'ok' }, big, W, Hh), 'ok');
  assert.strictEqual(H.verdict({ state: 'ok' }, { x0: 0, y0: 0, x1: 200, y1: 600 }, W, Hh), 'popout');
  assert.strictEqual(H.verdict({ state: 'ok' }, { x0: 0, y0: 0, x1: 800, y1: 100 }, W, Hh), 'popout');
  assert.strictEqual(H.verdict({ state: 'minimized' }, big, W, Hh), 'popout');
  assert.strictEqual(H.verdict({ state: 'gone' }, null, W, Hh), 'popout');
});
