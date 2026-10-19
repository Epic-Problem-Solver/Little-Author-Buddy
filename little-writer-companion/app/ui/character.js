// Character component. Interface:
//   const c = await LWCharacter.mount(hostEl)
//   c.setState(mode)   // typing|asleep|wander|watch|race_back|proud|paused -> face/body mapping
//   c.setFace(f); c.setBody(b); c.setDir('left'|'right'); c.setTool('pen'|'typewriter'|'laptop')
//   c.setColors({body, shade, hands, outline, desk, desk_shade, tool, ...})  // '_' -> '-' CSS var
// Only the SVG root is touched (no inner selectors), so Animator's layer split (.lw-rig-back/.lw-rig-front) is safe.
window.LWCharacter = (() => {
  const MAP = {
    typing: ['focused', 'typing'], asleep: ['asleep', 'sleeping'], wander: ['idle', 'walking'],
    watch: ['curious', 'peeking'], race_back: ['excited', 'racing'], proud: ['proud', 'typing'], paused: ['sleepy', 'sleeping'],
  };
  const TOOLS = ['pen', 'typewriter', 'laptop'];
  const FALLBACK = '<svg class="lw-char" viewBox="0 0 240 220"><circle cx="120" cy="110" r="62" fill="var(--body,#e8cfa9)" stroke="var(--outline,#241414)" stroke-width="8"/><circle cx="100" cy="100" r="6" fill="var(--outline,#241414)"/><circle cx="140" cy="100" r="6" fill="var(--outline,#241414)"/></svg>';
  const SVG_OK = { 'character.svg': 1, 'desk.svg': 1, 'ui-close.svg': 1, 'ui-gear.svg': 1 };
  const cache = {};
  async function svgText(name, fallback) {
    if (!Object.hasOwn(SVG_OK, name)) return fallback;
    if (!Object.hasOwn(cache, name)) cache[name] = fetch('assets/' + name).then(r => (r.ok ? r.text() : fallback)).catch(() => fallback);
    return cache[name];
  }
  // v0.7: --shade/--hands are derived from --body. lwApplyColor keeps that as plain hex on every webview.
  function applyColors(el, c) {
    const { shade, hands, ...rest } = c; setVars(el, rest);
    if (c.body && window.lwApplyColor) window.lwApplyColor(el, c.body);
    else { if (shade) el.style.setProperty('--shade', shade); if (hands) el.style.setProperty('--hands', hands); }
  }
  function setVars(el, c) { for (const k in c) if (c[k]) el.style.setProperty('--' + k.replace(/_/g, '-'), c[k]); }
  // file: 'character.svg' (default) or 'desk.svg' (v0.7 desk-alone layer, same geometry)
  async function mount(host, file = 'character.svg') {
    host.innerHTML = await svgText(file, file === 'desk.svg' ? '<svg class="lw-char" viewBox="0 0 240 220"></svg>' : FALLBACK);
    const svg = host.querySelector('svg');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('data-tool', 'pen'); // always explicit (missing/unknown shows the laptop)
    const api = {
      el: svg,
      setFace: f => svg.setAttribute('data-face', f),
      setBody: b => svg.setAttribute('data-body', b),
      setDir: d => d === 'left' ? svg.setAttribute('data-dir', 'left') : svg.removeAttribute('data-dir'),
      setTool: t => svg.setAttribute('data-tool', TOOLS.includes(t) ? t : 'pen'),
      setColors: c => applyColors(svg, c || {}),
      setState(mode) { const m = MAP[mode] || MAP.typing; api.setFace(m[0]); api.setBody(m[1] === 'racing' ? rushBody() : m[1]); },
      // travel direction (walking/rushing/racing face it; hand layering follows): data-dir=left, absent = right
      setWalkDir(d) { api.setDir(d); },
      setSide: side => svg.setAttribute('data-side', side === 'left' ? 'left' : 'right'),
    };
    return api;
  }
  // UI buttons (ui-close.svg / ui-gear.svg) inlined so their CSS vars + hover styles apply
  async function button(host, name, fallbackGlyph) {
    host.innerHTML = await svgText(name, `<svg class="lw-ui" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#e8cfa9" stroke="#241414" stroke-width="3"/><text x="16" y="21" font-size="14" text-anchor="middle">${fallbackGlyph}</text></svg>`);
    return host.querySelector('svg');
  }
  // Does Animator's CSS define a given data-body (e.g. the 'watching' back-turned pose)?
  const bodyCache = {};
  function supportsBody(name) {
    if (name in bodyCache) return bodyCache[name];
    let ok = false;
    try { for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.selectorText && r.selectorText.replace(/["']/g, '').includes('data-body=' + name)) { ok = true; break; } } catch (_) {}
    return (bodyCache[name] = ok);
  }
  // Animator v0.7 'rushing' (race back); 'racing' is the legacy fallback
  const rushBody = () => (supportsBody('rushing') ? 'rushing' : 'racing');
  return { mount, button, setVars, supportsBody, rushBody, applyColors };
})();
