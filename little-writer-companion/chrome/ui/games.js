// Supporter games, in overlay CSS pixels. Callers pass a clamped dt (seconds).
// Chase follows the cursor. Tag flees it. Red light stands still and watches.
// High five counts happy-face clicks. Warmer reports whether the cursor got closer.
(function (root) {
  const G = {
    BODY_X: 75,
    BODY_Y: 68.75,
    CATCH_R: 40,
    REDLIGHT_GREEN: 1.7,
    REDLIGHT_RED: 0.8,
    STILL_PX: 10,
    STEP_PX: 84,
    HIGHFIVE_HAPPY: 0.7,
    HIGHFIVE_PLAIN: 0.85,
    HIGHFIVE_GOAL: 3,
    WARMER_PX: 12,
    chase(center, cursor, dt, speed, catchR) {
      const dx = cursor[0] - center[0], dy = cursor[1] - center[1];
      const dist = Math.hypot(dx, dy);
      if (!Number.isFinite(dist) || dist <= catchR) return { pos: center.slice(), caught: true };
      const move = Math.min(Math.max(0, dist - catchR), Math.max(0, speed) * Math.max(0, dt));
      return {
        pos: [center[0] + dx / dist * move, center[1] + dy / dist * move],
        caught: dist - move <= catchR,
      };
    },
    tag(center, cursor, dt, speed, box) {
      let dx = center[0] - cursor[0], dy = center[1] - cursor[1];
      let dist = Math.hypot(dx, dy);
      if (!Number.isFinite(dist) || dist < 1) { dx = 1; dy = 0; dist = 1; }
      const step = Math.max(0, speed) * Math.max(0, dt);
      const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
      const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
      return [
        Math.min(x1, Math.max(x0, center[0] + dx / dist * step)),
        Math.min(y1, Math.max(y0, center[1] + dy / dist * step)),
      ];
    },
    // Green: back turned, and reaching him wins. Red: movement sends him one step away.
    // A reach during red wins only while the cursor has stayed within STILL_PX.
    redlight(anchor, cursor, dt, catchR, box, mem) {
      if (mem.phase === 'red') {
        if (!mem.from) mem.from = cursor.slice();
        if (Math.hypot(cursor[0] - mem.from[0], cursor[1] - mem.from[1]) > G.STILL_PX) mem.moved = true;
      }
      let next = anchor.slice();
      let pushed = false;
      if (mem.phase === 'red' && mem.moved && !mem.pushed) {
        next = G.tag(anchor, cursor, 1, G.STEP_PX, box);
        mem.pushed = true;
        pushed = true;
      }
      const dist = Math.hypot(cursor[0] - next[0], cursor[1] - next[1]);
      const caught = Number.isFinite(dist) && dist <= catchR && !mem.moved;
      if (!caught) {
        mem.left -= Math.max(0, dt);
        if (mem.left <= 0) {
          if (mem.phase === 'green') {
            mem.phase = 'red';
            mem.left = G.REDLIGHT_RED;
            mem.from = cursor.slice();
          } else {
            mem.phase = 'green';
            mem.left = G.REDLIGHT_GREEN;
            mem.from = null;
          }
          mem.moved = false;
          mem.pushed = false;
        }
      }
      return { anchor: next, phase: mem.phase, caught, pushed };
    },
    // Click during a happy window adds one. Three in a row wins.
    // A click while the face is plain, or a happy window with no click, clears the row.
    highfive(mem, dt, clicked) {
      let caught = false;
      let scored = false;
      if (clicked && mem.happy) {
        mem.hits += 1;
        scored = true;
        mem.happy = false;
        mem.left = G.HIGHFIVE_PLAIN;
        caught = mem.hits >= G.HIGHFIVE_GOAL;
      } else if (clicked) {
        mem.hits = 0;
      }
      if (!scored) {
        mem.left -= Math.max(0, dt);
        if (mem.left <= 0) {
          if (mem.happy) mem.hits = 0;
          mem.happy = !mem.happy;
          mem.left = mem.happy ? G.HIGHFIVE_HAPPY : G.HIGHFIVE_PLAIN;
        }
      }
      return { happy: mem.happy, hits: mem.hits, caught };
    },
    // Empty when the cursor has not moved enough to call. Otherwise warmer or colder.
    warmerWord(dist, prev) {
      if (prev == null || !Number.isFinite(dist) || !Number.isFinite(prev)) return '';
      if (dist + G.WARMER_PX < prev) return 'warmer';
      if (dist > prev + G.WARMER_PX) return 'colder';
      return '';
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = G; else root.LWGames = G;
})(this);
