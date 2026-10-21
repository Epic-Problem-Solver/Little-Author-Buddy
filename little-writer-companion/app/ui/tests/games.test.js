const test = require('node:test');
const assert = require('node:assert');
const G = require('../games.js');
const D = require('../domain.js');

test('chase moves toward the cursor and does not jump past this step', () => {
  const n = G.chase([0, 0], [100, 0], 0.5, 40, 10);
  assert.ok(Math.abs(n.pos[0] - 20) < 1e-6);
  assert.equal(n.caught, false);
  const hit = G.chase([0, 0], [30, 0], 1, 100, 10);
  assert.equal(hit.caught, true);
  assert.ok(hit.pos[0] <= 20 + 1e-6);
});

test('tag flees and stays inside the box', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 80 };
  const n = G.tag([40, 40], [0, 40], 1, 30, box);
  assert.ok(n[0] > 40);
  assert.equal(n[1], 40);
  const pinned = G.tag([100, 80], [0, 0], 1, 500, box);
  assert.equal(pinned[0], 100);
  assert.equal(pinned[1], 80);
  const stuck = G.tag([10, 10], [10, 10], 0.5, 20, box);
  assert.ok(stuck[0] > 10);
});

test('focus speech stays with the buddy who is on screen', () => {
  assert.equal(D.focusAtDesk({ focus_phase: 'idle', mode: 'typing', paused: false }), true);
  assert.equal(D.focusAtDesk({ focus_phase: 'explain', mode: 'paused', paused: true }), true);
  assert.equal(D.focusAtDesk({ focus_phase: 'play', mode: 'typing', paused: false }), false);
  assert.equal(D.focusAtDesk({ focus_phase: 'explain', mode: 'wander', paused: false }), false);
  assert.equal(D.focusAtDesk(null), false);
});
