// Pure motion math (no DOM), shared by the overlay and unit-tested with node --test.
// Positions are overlay CSS px; speeds are given in LOGICAL px/s of the monitor the buddy is on and converted
// with k = monitorScale / overlayDpr, so the buddy moves (and looks) the same physical size on every monitor.
(function (root) {
  const M = {
    MAX_DT: 0.05,        // s; a longer frame (tab hidden, sleep, stall) is clamped, so there are no jumps
    MAX_SPEED: 1200,     // logical px/s hard cap
    ACCEL: 900,          // logical px/s^2 (ease-in) ; the same decel gives ease-out on arrival
    HOME_MAX_SCALE: 1.3,
    DESK_ANCHOR_X: 40,
    DESK_ANCHOR_Y: 30,
    BODY_CENTER_RIGHT: 180,
    BODY_CENTER_LEFT: 60,
    BODY_CENTER_AWAY: 120,
    BODY_CENTER_Y: 110,
    // Desk pose scales the rig 1.25 about (120,172) then translates +60. Centre x is 180 / 60.
    // Centre y: 172 + (110-172)*1.25 = 94.5. The runner still uses BODY_CENTER_Y.
    DESK_BODY_CENTER_Y: 94.5,
    SCALE_ORIGIN_X: 60,
    SCALE_ORIGIN_Y: 110,
    // Wander box is 1.25× the 120×110 home host, so the unscaled body matches the desk rig's 1.25 scale.
    // 150/240 = 137.5/220 = 0.625. The home host stays 120×110 (svg scale 0.5).
    SPRITE_W: 150,
    SPRITE_H: 137.5,
    /**
     * BUG-23: where the race-back runner must stop so its body centre is exactly on the desk buddy's rendered body
     * centre. Mirrors the home window layout: the 120x110 host at (40,30) CSS px, svg 240x220 -> x0.5, scaled by
     * min(userScale, 1.3) around its bottom-centre (60,110). Desk-scene body centre svg x is 180 (right) or
     * 60 (left). The 1.25 desk scale drops that centre to svg y DESK_BODY_CENTER_Y. homeCss = home window
     * top-left in overlay CSS px, f = home CSS px -> overlay CSS px (home scale / overlay DPR), k = the
     * runner's current sprite scale (its away-pose body centre stays svg (120,110), which is the centre of
     * the SPRITE_W×SPRITE_H box).
     * Returns { body: [x,y], target: top-left for the runner }.
     */
    deskBodyTarget(homeCss, f, side, userScale, k) {
      const hsc = Math.min(userScale || 1, M.HOME_MAX_SCALE);
      const bx = (side === 'left' ? M.BODY_CENTER_LEFT : M.BODY_CENTER_RIGHT) * 0.5;
      const by = M.DESK_BODY_CENTER_Y * 0.5;
      const px = M.SCALE_ORIGIN_X + (bx - M.SCALE_ORIGIN_X) * hsc;
      const py = M.SCALE_ORIGIN_Y + (by - M.SCALE_ORIGIN_Y) * hsc;
      const body = [homeCss[0] + (M.DESK_ANCHOR_X + px) * f, homeCss[1] + (M.DESK_ANCHOR_Y + py) * f];
      return { body, target: [body[0] - (M.SPRITE_W / 2) * k, body[1] - (M.SPRITE_H / 2) * k] };
    },
    /** Top-left of the runner when its body centre meets the desk buddy. */
    raceTarget(homeCss, f, side, userScale, k) { return M.deskBodyTarget(homeCss, f, side, userScale, k).target; },
    /** Monitor containing `p`, else the nearest. `ms` items are {i,x,y,w,h}. */
    monitorAt(p, ms) {
      let best = ms[0], bd = Infinity;
      for (const m of ms) {
        const dx = Math.max(m.x - p[0], 0, p[0] - (m.x + m.w)), dy = Math.max(m.y - p[1], 0, p[1] - (m.y + m.h)), d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    },
    /** Shared edge between two monitors, as a sprite top-left on that seam, or null. */
    seam(a, b, bw = M.SPRITE_W, bh = M.SPRITE_H) {
      const E = 2;
      const vy0 = Math.max(a.y, b.y), vy1 = Math.min(a.y + a.h, b.y + b.h);
      const hx0 = Math.max(a.x, b.x), hx1 = Math.min(a.x + a.w, b.x + b.w);
      const k = Math.max(a.k, b.k), w = bw * k, h = bh * k;
      if (vy1 - vy0 > h && (Math.abs(a.x + a.w - b.x) < E || Math.abs(b.x + b.w - a.x) < E)) {
        const x = Math.abs(a.x + a.w - b.x) < E ? b.x : a.x;
        return [x - w / 2, Math.min(vy1 - h - 20, Math.max(vy0, vy1 - h - 60))];
      }
      if (hx1 - hx0 > w && (Math.abs(a.y + a.h - b.y) < E || Math.abs(b.y + b.h - a.y) < E)) {
        const y = Math.abs(a.y + a.h - b.y) < E ? b.y : a.y;
        return [(hx0 + hx1) / 2 - w / 2, y - h / 2];
      }
      return null;
    },
    /** Waypoints along shared monitor edges from `from` to `to`. `centerOf` maps a top-left to a sprite centre. */
    route(from, to, ms, centerOf) {
      const A = M.monitorAt(centerOf(from), ms), B = M.monitorAt(centerOf(to), ms);
      if (A.i === B.i) return [to];
      const prev = { [A.i]: null }, q = [A];
      while (q.length) {
        const m = q.shift(); if (m.i === B.i) break;
        for (const n of ms) if (!(n.i in prev) && M.seam(m, n)) { prev[n.i] = m; q.push(n); }
      }
      if (!(B.i in prev)) return [to];
      const hops = []; for (let m = B; prev[m.i]; m = prev[m.i]) hops.unshift(M.seam(prev[m.i], m));
      return [...hops, to];
    },
    /** The runner scale that matches the desk buddy's size: same cap, same home->overlay factor. */
    deskScale(f, userScale) { return f * Math.min(userScale || 1, M.HOME_MAX_SCALE); },
    /**
     * Move the box (x, y, w, h) the smallest amount that puts it fully inside monitor m {x,y,w,h}.
     * pad insets the monitor. A box wider or taller than the monitor stays pinned to the padded
     * start, so it remains on this monitor instead of straddling the next one.
     */
    fitBox(x, y, w, h, m, pad = 0) {
      const left = m.x + pad, top = m.y + pad, right = m.x + m.w - pad, bottom = m.y + m.h - pad;
      let nx = x, ny = y;
      if (nx < left) nx = left;
      if (nx + w > right) nx = right - w;
      if (nx < left) nx = left;
      if (ny < top) ny = top;
      if (ny + h > bottom) ny = bottom - h;
      if (ny < top) ny = top;
      return [nx, ny];
    },
    /**
     * Monitor a bubble stays on. `cur` is the monitor from the previous frame (or null).
     * `anchor` is the buddy centre. Switching waits until that point is `margin` px inside
     * a different monitor, so a centre that ditheres on the seam cannot flip the bubble
     * back and forth.
     */
    bubbleMonitor(cur, anchor, ms, margin = 12) {
      const inside = (m) => anchor[0] >= m.x + margin && anchor[0] <= m.x + m.w - margin
        && anchor[1] >= m.y + margin && anchor[1] <= m.y + m.h - margin;
      const fresh = cur && ms.find(m => m.i === cur.i);
      if (!fresh) return ms.find(inside) || M.monitorAt(anchor, ms);
      if (inside(fresh)) return fresh;
      return ms.find(m => m.i !== fresh.i && inside(m)) || fresh;
    },
    /**
     * Monitor that actually holds the window (x0,y0)-(x1,y1). Largest overlap wins.
     * An equal overlap goes to the monitor that contains the window centre, then to
     * whichever of those is nearest that centre. A window on no monitor uses monitorAt.
     */
    monitorForWindow(x0, y0, x1, y1, ms) {
      const area = (m) => {
        const w = Math.min(x1, m.x + m.w) - Math.max(x0, m.x);
        const h = Math.min(y1, m.y + m.h) - Math.max(y0, m.y);
        return w > 0 && h > 0 ? w * h : 0;
      };
      let bestA = 0, tied = [];
      for (const m of ms) {
        const a = area(m);
        if (a > bestA + 0.5) { bestA = a; tied = [m]; }
        else if (a > 0 && Math.abs(a - bestA) <= 0.5) tied.push(m);
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (!tied.length) return M.monitorAt([cx, cy], ms);
      if (tied.length === 1) return tied[0];
      const holds = tied.filter(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h);
      return M.monitorAt([cx, cy], holds.length ? holds : tied);
    },
    /**
     * Top-left where the sprite stands to watch the window, fully on `m`.
     * Horizontally centred on the part of the window that lies on that monitor.
     * Vertically just above the window bottom, then clamped onto the monitor.
     */
    watchGoal(x0, y0, x1, y1, m, bw, bh, k, margin = 8) {
      const sw = bw * k, sh = bh * k;
      const left = Math.max(x0, m.x), right = Math.min(x1, m.x + m.w);
      const cx = left < right ? (left + right) / 2 : m.x + m.w / 2;
      const winBottom = Math.min(Math.max(y1, m.y), m.y + m.h);
      return M.fitBox(cx - sw / 2, winBottom - sh - 10, sw, sh, m, margin);
    },
    /**
     * Visual look once standing still. Prefer `primary` (the window centre).
     * Within `dead` px, use `fallback` (the monitor centre). Within `dead` of that
     * too, return null so the caller keeps the direction already on screen.
     * Returns 'left' | 'right' | null. This is the look, not the data-dir value.
     */
    lookToward(spriteCx, primary, fallback, dead = 24) {
      const pick = (t) => (Math.abs(t - spriteCx) < dead ? null : (t > spriteCx ? 'right' : 'left'));
      return pick(primary) || pick(fallback);
    },
    /**
     * data-dir for a visual look. Walking, rushing, and racing face the named way.
     * Peeking, watching, and the other still poses face the opposite name: the art
     * faces left, and data-dir=left mirrors it.
     */
    dirForLook(body, look) {
      const travel = body === 'walking' || body === 'rushing' || body === 'racing';
      if (travel) return look === 'left' ? 'left' : 'right';
      return look === 'right' ? 'left' : 'right';
    },
    /**
     * Which way a hide spot should look. A screen edge's `side` is the outer edge,
     * so look inward. A window's `side` is the sprite side pressed against the glass:
     * 'right' means the character is left of the window and should look right.
     */
    hideLook(side, atWindow) {
      const lookRight = atWindow ? side === 'right' : side === 'left';
      return lookRight ? 'right' : 'left';
    },
    clampDt(ms) { return Number.isFinite(ms) && ms > 0 ? Math.min(ms / 1000, M.MAX_DT) : 0; },
    /** Sprite scale on a monitor: monitor scale relative to the overlay's DPR, times the user's size setting. */
    scaleFor(monitorScale, overlayDpr, userScale = 1) { return ((monitorScale || 1) / (overlayDpr || 1)) * (userScale || 1); },
    /** Exponential smoothing toward a target scale (frame-rate independent). */
    smoothScale(cur, target, dt, rate = 6) { return target + (cur - target) * Math.exp(-rate * dt); },
    /** Mode speed in logical px/s from the user's walk speed, capped. */
    modeSpeed(mode, walk) {
      const f = { wander: 1, watch: 2.5, race_back: 10, home: 6 }[mode] || 6;
      return Math.min(M.MAX_SPEED, walk * f);
    },
    /**
     * One eased step toward `to`. v = current speed (logical px/s). k converts logical -> CSS px.
     * Accelerates by ACCEL up to vmax (ease-in) and limits speed to sqrt(2*ACCEL*dist) (ease-out).
     * Returns { pos, v, arrived }. Never overshoots.
     */
    step(pos, to, v, vmax, dt, k = 1) {
      const dx = to[0] - pos[0], dy = to[1] - pos[1], dist = Math.hypot(dx, dy);
      if (dist < 0.5 || dt <= 0) return { pos: dist < 0.5 ? [to[0], to[1]] : pos, v: dist < 0.5 ? 0 : v, arrived: dist < 0.5 };
      const cap = Math.min(vmax, M.MAX_SPEED);
      const brake = Math.sqrt(2 * M.ACCEL * (dist / k)); // logical px/s allowed so we can stop at the target
      const nv = Math.min(cap, brake, v + M.ACCEL * dt);
      const move = Math.min(dist, nv * k * dt);
      if (move >= dist) return { pos: [to[0], to[1]], v: 0, arrived: true };
      return { pos: [pos[0] + dx / dist * move, pos[1] + dy / dist * move], v: nv, arrived: false };
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.LWMotion = M;
})(this);
