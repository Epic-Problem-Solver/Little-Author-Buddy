const test = require('node:test'), assert = require('node:assert');
const M = require('../motion.js');
const D = require('../domain.js');
const fx = require('./layout_fixture.json');

test('motion geometry matches the shared layout fixture', () => {
  assert.equal(M.HOME_MAX_SCALE, fx.home_max_scale);
  assert.equal(M.DESK_ANCHOR_X, fx.desk_anchor_x);
  assert.equal(M.DESK_ANCHOR_Y, fx.desk_anchor_y);
  assert.equal(M.BODY_CENTER_RIGHT, fx.body_center_right);
  assert.equal(M.BODY_CENTER_LEFT, fx.body_center_left);
  assert.equal(M.BODY_CENTER_AWAY, fx.body_center_away);
  assert.equal(M.BODY_CENTER_Y, fx.body_center_y);
  assert.equal(M.DESK_BODY_CENTER_Y, fx.desk_body_center_y);
  assert.equal(M.SPRITE_W, fx.sprite_w);
  assert.equal(M.SPRITE_H, fx.sprite_h);
});

test('race hold and home modes live in one domain module', () => {
  assert.equal(D.RACE_HOLD_MS, fx.race_hold_ms);
  assert.equal(D.atHome('typing'), true);
  assert.equal(D.atHome('asleep'), true);
  assert.equal(D.atHome('paused'), true);
  assert.equal(D.atHome('wander'), false);
  assert.equal(D.realLevel([{ tier: 'short_story' }]), 1);
  assert.equal(D.realLevel([{ tier: 'novella' }]), 2);
  assert.equal(D.realLevel([]), 0);
});

test('route stays on one monitor and crosses a vertical seam', () => {
  const ms = [
    { i: 0, x: 0, y: 0, w: 1000, h: 800, k: 1 },
    { i: 1, x: 1000, y: 0, w: 1000, h: 800, k: 1 },
  ];
  const center = p => [p[0] + 60, p[1] + 55];
  assert.deepEqual(M.route([10, 10], [20, 20], ms, center), [[20, 20]]);
  const hops = M.route([100, 400], [1200, 400], ms, center);
  assert.equal(hops.length, 2);
  assert.equal(hops[1][0], 1200);
  assert.ok(M.seam(ms[0], ms[1]));
});
