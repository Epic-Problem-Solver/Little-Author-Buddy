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

test('red light wins on a still reach and steps away when the cursor moves', () => {
  const box = { x0: 0, y0: 0, x1: 400, y1: 300 };
  const close = { phase: 'green', left: 1, from: null, moved: false, pushed: false };
  const hit = G.redlight([100, 100], [110, 100], 0, 20, box, close);
  assert.equal(hit.caught, true);
  assert.equal(hit.pushed, false);

  const look = { phase: 'red', left: 1, from: [0, 100], moved: false, pushed: false };
  const pushed = G.redlight([100, 100], [40, 100], 0, 20, box, look);
  assert.equal(pushed.caught, false);
  assert.equal(pushed.pushed, true);
  assert.ok(pushed.anchor[0] > 100);

  const frozen = { phase: 'red', left: 1, from: [100, 100], moved: false, pushed: false };
  const still = G.redlight([100, 100], [105, 100], 0, 20, box, frozen);
  assert.equal(still.caught, true);

  const turn = { phase: 'green', left: 0.2, from: null, moved: false, pushed: false };
  const next = G.redlight([0, 0], [200, 0], 0.3, 10, box, turn);
  assert.equal(next.phase, 'red');
  assert.equal(turn.moved, false);
});

test('high five takes three happy clicks in a row', () => {
  const mem = { happy: true, left: G.HIGHFIVE_HAPPY, hits: 0 };
  let r = G.highfive(mem, 0, true);
  assert.equal(r.hits, 1);
  assert.equal(r.caught, false);
  r = G.highfive(mem, G.HIGHFIVE_PLAIN, false);
  assert.equal(mem.happy, true);
  r = G.highfive(mem, 0, true);
  assert.equal(r.hits, 2);
  r = G.highfive(mem, G.HIGHFIVE_PLAIN, false);
  r = G.highfive(mem, 0, true);
  assert.equal(r.hits, 3);
  assert.equal(r.caught, true);

  const miss = { happy: true, left: 0.1, hits: 2 };
  G.highfive(miss, 0.2, false);
  assert.equal(miss.hits, 0);
  const plain = { happy: false, left: 1, hits: 2 };
  G.highfive(plain, 0, true);
  assert.equal(plain.hits, 0);
});

test('warmer and colder follow the distance to Buddy', () => {
  assert.equal(G.warmerWord(40, null), '');
  assert.equal(G.warmerWord(20, 40), 'warmer');
  assert.equal(G.warmerWord(60, 40), 'colder');
  assert.equal(G.warmerWord(45, 40), '');
});

test('focus speech stays with the buddy who is on screen', () => {
  assert.equal(D.focusAtDesk({ focus_phase: 'idle', mode: 'typing', paused: false }), true);
  assert.equal(D.focusAtDesk({ focus_phase: 'explain', mode: 'paused', paused: true }), false);
  assert.equal(D.focusAtDesk({ focus_phase: 'ask', mode: 'typing', paused: false }), false);
  assert.equal(D.focusAtDesk({ focus_phase: 'back', mode: 'typing', paused: false }), false);
  assert.equal(D.focusAtDesk({ focus_phase: 'play', mode: 'typing', paused: false }), false);
  assert.equal(D.focusAtDesk({ focus_phase: 'explain', mode: 'wander', paused: false }), false);
  assert.equal(D.focusAtDesk(null), false);
});
