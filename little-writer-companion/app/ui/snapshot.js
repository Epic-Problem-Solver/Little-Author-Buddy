// Serialize an inline (CSS-styled, animated) SVG into a self-contained static SVG: computed colours/visibility
// and the current transforms are inlined as attributes so Rust (resvg) can render it without CSS support.
window.LWSnapshot = (() => {
  const PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'font-size', 'font-family', 'font-weight', 'text-anchor'];
  function serialize(svg) {
    svg.classList.add('lw-snap'); // pauses animations at the current frame (see home.css)
    const clone = svg.cloneNode(true);
    const orig = [svg, ...svg.querySelectorAll('*')], copy = [clone, ...clone.querySelectorAll('*')];
    const drop = [];
    orig.forEach((el, i) => {
      const c = copy[i];
      if (el.closest('defs, clipPath, mask')) return; // referenced resources: keep as authored
      const cs = getComputedStyle(el);
      if (i && (cs.display === 'none' || cs.visibility === 'hidden')) { drop.push(c); return; }
      // the laptop's pulsing screen light is an animated-opacity effect; resvg draws it as an opaque shape -> drop it
      if (el.classList && el.classList.contains('lw-laptop-glow')) { drop.push(c); return; }
      for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v && v !== 'normal') c.setAttribute(p, v); }
      if (i && el.getCTM && el.parentNode.getCTM) {
        const a = el.getCTM(), b = el.parentNode.getCTM();
        if (a && b) { const m = b.inverse().multiply(a); c.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`); }
      }
      c.removeAttribute('class'); c.removeAttribute('style');
    });
    svg.classList.remove('lw-snap');
    drop.forEach(d => d.remove());
    clone.querySelectorAll('style, script').forEach(n => n.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // BUG-21: the tilted desk (data-side) can poke outside the viewBox: grow it to the drawn bbox + padding
    const vb = (svg.getAttribute('viewBox') || '0 0 240 220').split(/[\s,]+/).map(Number);
    let [x0, y0, x1, y1] = [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]];
    try { const b = svg.getBBox(); if (b.width && b.height) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); } } catch (_) {}
    const P = 8; x0 = Math.floor(x0 - P); y0 = Math.floor(y0 - P); x1 = Math.ceil(x1 + P); y1 = Math.ceil(y1 + P);
    clone.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    clone.setAttribute('width', x1 - x0); clone.setAttribute('height', y1 - y0);
    return new XMLSerializer().serializeToString(clone);
  }
  return { serialize };
})();
