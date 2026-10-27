// Pure hide/peek geometry (no DOM) so it can be unit-tested with node --test.
// Rects are {x0,y0,x1,y1} in overlay CSS px. side = which side of the sprite is hidden.
(function (root) {
  const VIS = 0.45; // fraction of the sprite left visible while hiding
  const LWHide = {
    VIS,
    /** Sprite position + clip line for hiding at a window edge, keeping the same relative height (yFrac 0..1). */
    windowGeom(side, yFrac, r, w, h) {
      const y = r.y0 + Math.max(0, r.y1 - r.y0 - h) * yFrac;
      return side === 'right' ? { line: r.x0, pos: [r.x0 - w * VIS, y] } : { line: r.x1, pos: [r.x1 - w * (1 - VIS), y] };
    },
    /** Big enough to hide behind? */
    fits(r, w, h) { return r.x1 - r.x0 >= 2 * w && r.y1 - r.y0 >= 1.2 * h; },
    /** Decide what to do with a live target update: 'ok' (re-clip/reposition) or 'popout'. */
    verdict(t, r, w, h) { return t && t.state === 'ok' && r && LWHide.fits(r, w, h) ? 'ok' : 'popout'; },
    /** Clip insets (px, in scaled sprite space) for a sprite at x with width w. */
    clip(x, w, line, side) {
      return side === 'right' ? { l: 0, r: Math.min(w, Math.max(0, x + w - line)) } : { l: Math.min(w, Math.max(0, line - x)), r: 0 };
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LWHide; else root.LWHide = LWHide;
})(this);
