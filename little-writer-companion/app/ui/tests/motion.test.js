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

test('a bubble keeps its monitor while the buddy ditheres on the seam', () => {
  const left = { i: 0, x: 0, y: 0, w: 1000, h: 800 }, right = { i: 1, x: 1000, y: 0, w: 1000, h: 800 };
  const ms = [left, right];
  assert.equal(M.bubbleMonitor(null, [400, 100], ms).i, 0);
  assert.equal(M.bubbleMonitor(left, [1000, 100], ms).i, 0); // exactly on the seam
  assert.equal(M.bubbleMonitor(left, [1006, 100], ms).i, 0); // a few px across is not enough
  assert.equal(M.bubbleMonitor(left, [1012, 100], ms).i, 1); // clearly on the next screen
  assert.equal(M.bubbleMonitor(right, [1005, 100], ms).i, 1); // wobbling back does not flip again
  assert.equal(M.bubbleMonitor(right, [988, 100], ms).i, 0);
});

test('a bubble box is shifted fully onto one monitor', () => {
  const left = { x: 0, y: 0, w: 1000, h: 800 }, right = { x: 1000, y: 0, w: 1000, h: 800 };
  assert.deepEqual(M.fitBox(100, 80, 90, 28, left), [100, 80]);
  const ontoLeft = M.fitBox(960, 100, 80, 24, left, 0);
  assert.ok(ontoLeft[0] >= left.x && ontoLeft[0] + 80 <= left.x + left.w, ontoLeft);
  assert.equal(ontoLeft[1], 100);
  const ontoRight = M.fitBox(960, 100, 80, 24, right, 0);
  assert.ok(ontoRight[0] >= right.x && ontoRight[0] + 80 <= right.x + right.w, ontoRight);
  const above = M.fitBox(40, -12, 80, 24, left, 4);
  assert.equal(above[1], 4);
  assert.equal(above[0], 40);
  const tooWide = M.fitBox(50, 20, 2000, 24, left, 4);
  assert.equal(tooWide[0], 4);
});

test('race-back target = desk buddy body centre, per side and size (100/130/160 -> capped 1.3)', () => {
  const M = require('../motion.js');
  const home = [1400, 600];
  const deskY = 47.25; // svg 94.5 * 0.5: rig scale 1.25 about (120,172), then translate(60,0)
  const exp = { // body centre computed by hand from the home layout (host 40,30; origin 60,110; svg x0.5)
    right: { 1: [1400 + 40 + 90, 600 + 30 + deskY], 1.3: [1400 + 40 + 60 + 30 * 1.3, 600 + 30 + 110 + (deskY - 110) * 1.3] },
    left: { 1: [1400 + 40 + 30, 600 + 30 + deskY], 1.3: [1400 + 40 + 60 - 30 * 1.3, 600 + 30 + 110 + (deskY - 110) * 1.3] },
  };
  for (const side of ['right', 'left']) for (const u of [1, 1.3, 1.6]) {
    const hs = Math.min(u, 1.3), k = M.deskScale(1, u);
    assert.equal(k, hs);
    const { body, target } = M.deskBodyTarget(home, 1, side, u, k);
    assert.ok(Math.abs(body[0] - exp[side][hs][0]) < 1e-9 && Math.abs(body[1] - exp[side][hs][1]) < 1e-9, `${side} ${u}: ${body}`);
    // runner body centre is the middle of the wander box (svg 120,110)
    assert.ok(Math.abs(target[0] + (M.SPRITE_W / 2) * k - body[0]) < 1e-9 && Math.abs(target[1] + (M.SPRITE_H / 2) * k - body[1]) < 1e-9);
  }
  // HiDPI: home window at 150% seen from a 100% overlay
  const t = M.deskBodyTarget([0, 0], 1.5, 'right', 1, M.deskScale(1.5, 1));
  assert.deepEqual(t.body, [(40 + 90) * 1.5, (30 + 47.25) * 1.5]);
});

test('watch stands on the monitor that holds most of the window', () => {
  const ms = [
    { i: 0, x: 0, y: 0, w: 1920, h: 1080, k: 1 },
    { i: 1, x: 1920, y: 0, w: 1920, h: 1080, k: 1 },
  ];
  // Bottom-right corner is on the right monitor, but most of the window is on the left.
  const left = M.monitorForWindow(1600, 100, 2100, 800, ms);
  assert.equal(left.i, 0);
  const goal = M.watchGoal(1600, 100, 2100, 800, left, 120, 110, 1);
  assert.equal(goal[0], 1700); // centre of the on-monitor span 1600..1920, minus half the sprite
  assert.equal(goal[1], 680);  // 10px above the window bottom
  assert.ok(goal[0] >= 0 && goal[0] + 120 <= 1920);
  assert.ok(goal[1] >= 0 && goal[1] + 110 <= 1080);
  // The other way: a corner still on the left, most of the window on the right.
  const right = M.monitorForWindow(1800, 100, 2500, 800, ms);
  assert.equal(right.i, 1);
  const far = M.watchGoal(1800, 100, 2500, 800, right, 120, 110, 1);
  assert.equal(far[0], 2150); // centre of 1920..2500
  assert.ok(far[0] >= 1920 && far[0] + 120 <= 3840);
  // Fully on the right monitor: stand centred on the window, not on its right edge.
  const only = M.monitorForWindow(2000, 200, 2600, 900, ms);
  assert.equal(only.i, 1);
  assert.deepEqual(M.watchGoal(2000, 200, 2600, 900, only, 120, 110, 1), [2240, 780]);
});

test('a window jittering on the seam stays on the monitor he already chose', () => {
  const ms = [
    { i: 0, x: 0, y: 0, w: 1920, h: 1080, k: 1 },
    { i: 1, x: 1920, y: 0, w: 1920, h: 1080, k: 1 },
  ];
  const left = ms[0];
  // Almost even. One pixel of jitter would flip a fresh choice, but not a held one.
  assert.equal(M.monitorForWindow(960, 100, 2881, 900, ms, left).i, 0);
  assert.equal(M.monitorForWindow(959, 100, 2880, 900, ms, left).i, 0);
  // Clearly moved onto the right monitor: follow it.
  assert.equal(M.monitorForWindow(1800, 100, 3600, 900, ms, left).i, 1);
  // The held monitor no longer touches the window.
  assert.equal(M.monitorForWindow(2000, 100, 2800, 900, ms, left).i, 1);
});

test('a tied window overlap prefers the monitor that contains its centre', () => {
  const ms = [
    { i: 0, x: 0, y: 0, w: 1000, h: 600, k: 1 },
    { i: 1, x: 1000, y: 0, w: 1000, h: 300, k: 1 },
  ];
  // 300*600 on the left, 600*300 on the right. Centre (1150, 300) is on the right.
  assert.equal(M.monitorForWindow(700, 0, 1600, 600, ms).i, 1);
  // No overlap at all: nearest monitor to the centre.
  assert.equal(M.monitorForWindow(-400, 100, -100, 200, ms).i, 0);
});

test('a watch goal stays fully on its monitor when the window runs off the edge', () => {
  const m = { i: 1, x: 1920, y: 0, w: 1920, h: 1080, k: 1 };
  const g = M.watchGoal(3780, 40, 4100, 40, m, 120, 110, 1);
  assert.ok(g[0] >= m.x + 8 && g[0] + 120 <= m.x + m.w - 8, g);
  assert.ok(g[1] >= m.y + 8 && g[1] + 110 <= m.y + m.h - 8, g);
});

test('still facing points at the window, then the monitor centre', () => {
  assert.equal(M.lookToward(500, 800, 960), 'right');
  assert.equal(M.lookToward(500, 200, 960), 'left');
  // Window is straight ahead, so look toward the monitor centre instead.
  assert.equal(M.lookToward(500, 510, 200), 'left');
  // Both are straight ahead: keep the current direction.
  assert.equal(M.lookToward(500, 510, 505), null);
  assert.equal(M.lookToward(500, 476, 960), 'left'); // 24px is outside the dead zone
});

test('peek and watch data-dir is the opposite of the way they look', () => {
  assert.equal(M.hideLook('right', false), 'left'); // screen's right edge looks inward
  assert.equal(M.hideLook('left', false), 'right');
  assert.equal(M.hideLook('right', true), 'right'); // pressed to a window's left side, look at it
  assert.equal(M.hideLook('left', true), 'left');
  assert.equal(M.dirForLook('walking', 'right'), 'right');
  assert.equal(M.dirForLook('rushing', 'left'), 'left');
  assert.equal(M.dirForLook('watching', 'right'), 'left');
  assert.equal(M.dirForLook('peeking', 'left'), 'right');
  assert.equal(M.dirForLook('idle', 'right'), 'left');
});
