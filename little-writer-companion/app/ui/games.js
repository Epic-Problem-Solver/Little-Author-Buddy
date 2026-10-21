// Chase and tag, in overlay CSS pixels. Callers pass a clamped dt (seconds) and a speed in CSS px/s.
(function (root) {
  const G = {
    BODY_X: 75,
    BODY_Y: 68.75,
    CATCH_R: 40,
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
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = G; else root.LWGames = G;
})(this);
