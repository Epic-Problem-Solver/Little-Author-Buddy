// Character component. Interface:
//   const c = await LWCharacter.mount(hostEl)
//   c.setState(mode)   // typing|asleep|wander|watch|race_back|proud|paused -> face/body mapping
//   c.setFace(f); c.setBody(b); c.setDir('left'|'right'); c.setTool('pen'|'typewriter'|'laptop')
//   c.setColors({body, shade, hands, outline, desk, desk_shade, tool, ...})  // '_' -> '-' CSS var
//   c.setHat({id, color, extra, svg}|null)  // supporter hat.svg, sanitized, into the hat anchors
// Only the SVG root is touched (no inner selectors), so Animator's layer split (.lw-rig-back/.lw-rig-front) is safe.
window.LWCharacter = (() => {
  const MAP = {
    typing: ['focused', 'typing'], asleep: ['asleep', 'sleeping'], wander: ['idle', 'walking'],
    watch: ['curious', 'peeking'], race_back: ['excited', 'racing'], proud: ['proud', 'typing'], paused: ['sleepy', 'sleeping'],
  };
  const TOOLS = ['pen', 'typewriter', 'laptop'];
  const FALLBACK = '<svg class="lw-char" viewBox="0 0 240 220"><circle cx="120" cy="110" r="62" fill="var(--body,#e8cfa9)" stroke="var(--outline,#241414)" stroke-width="8"/><circle cx="100" cy="100" r="6" fill="var(--outline,#241414)"/><circle cx="140" cy="100" r="6" fill="var(--outline,#241414)"/></svg>';
  const SVG_OK = { 'character.svg': 1, 'desk.svg': 1, 'ui-close.svg': 1, 'ui-gear.svg': 1, 'ui-game.svg': 1 };
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
  const HAT_TAG = { g: 1, path: 1, circle: 1, ellipse: 1, rect: 1, line: 1, polygon: 1, polyline: 1 };
  const HAT_ATTR = { class: 1, d: 1, fill: 1, stroke: 1, 'stroke-width': 1, 'stroke-linejoin': 1, 'stroke-linecap': 1, cx: 1, cy: 1, r: 1, rx: 1, ry: 1, x: 1, y: 1, width: 1, height: 1, points: 1, transform: 1, opacity: 1 };
  const HAT_SLOT = { 'lw-hat-back': 'lw-hat-back', 'lw-hat-front': 'lw-hat', 'lw-hat-face': 'lw-hat-face' };
  function cleanHat(node, doc) {
    if (node.nodeType !== 1 || !HAT_TAG[node.localName]) return null;
    const el = doc.createElementNS('http://www.w3.org/2000/svg', node.localName);
    for (const a of node.attributes) {
      if (!HAT_ATTR[a.name]) continue;
      if (a.name === 'class' && !/^[a-zA-Z0-9 _-]+$/.test(a.value)) continue;
      if ((a.name === 'fill' || a.name === 'stroke') && /url\(|javascript:|</i.test(a.value)) continue;
      if (a.name === 'transform' && !/^(?:rotate|translate)\([0-9.+\s,-]+\)$/.test(a.value)) continue;
      el.setAttribute(a.name, a.value);
    }
    for (const child of node.childNodes) { const n = cleanHat(child, doc); if (n) el.appendChild(n); }
    return el;
  }
  function clearSlot(svg, slot) {
    const host = svg.querySelector('.' + slot);
    if (host) while (host.firstChild) host.removeChild(host.firstChild);
  }
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
      // Rebuild the hat layers only when the pack art changes. Colour and the extra flag are attributes.
      setHat(spec) {
        const id = spec && spec.id || '';
        const svgText = spec && spec.svg || '';
        const key = id + '\n' + svgText.length;
        if (api._hatKey !== key) {
          api._hatKey = key;
          for (const slot of Object.values(HAT_SLOT)) clearSlot(svg, slot);
          if (svgText) {
            const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
            const root = parsed.documentElement;
            if (root && !parsed.querySelector('parsererror')) {
              for (const g of root.children) {
                const cls = (g.getAttribute('class') || '').split(/\s+/);
                const slot = HAT_SLOT[cls.find(c => HAT_SLOT[c])];
                if (!slot) continue;
                const host = svg.querySelector('.' + slot);
                if (!host) continue;
                for (const child of g.childNodes) { const n = cleanHat(child, svg.ownerDocument); if (n) host.appendChild(n); }
              }
            }
          }
        }
        const color = spec && spec.color || '';
        if (api._hatColor !== color) {
          api._hatColor = color;
          if (color && window.lwDeriveShade) {
            svg.style.setProperty('--hat', color);
            svg.style.setProperty('--hat-shade', window.lwDeriveShade(color));
          } else {
            svg.style.removeProperty('--hat');
            svg.style.removeProperty('--hat-shade');
          }
        }
        const extra = !!(spec && spec.extra);
        if (api._hatExtra !== extra) {
          api._hatExtra = extra;
          if (extra) svg.setAttribute('data-hat-extra', 'on'); else svg.removeAttribute('data-hat-extra');
        }
      },
    };
    return api;
  }
  // Snapshot ticks often. Reload the pack list once when the chosen id is missing, then skip unchanged frames.
  function bindHats(invoke, character, getSnap) {
    let hats = [], sig = '', pending = false, failed = false, miss = '';
    async function refresh() {
      try { hats = await invoke('list_hats') || []; failed = false; }
      catch (_) { failed = true; }
    }
    function apply(s) {
      const id = (s && s.hat) || '';
      if (id && !hats.some(h => h.id === id)) {
        if (!failed && !pending && miss !== id) {
          miss = id; pending = true;
          refresh().then(() => { pending = false; sig = ''; apply(getSnap()); });
        }
        return;
      }
      miss = '';
      const color = (s && s.hat_color) || '';
      const extra = !!(s && s.hat_extra);
      const pack = id && hats.find(h => h.id === id);
      const next = (pack ? pack.id : '') + '|' + color + '|' + (extra ? '1' : '0') + '|' + (pack ? pack.svg.length : 0);
      if (next === sig) return;
      sig = next;
      character.setHat(pack ? { id: pack.id, color: color || pack.default_color, extra: extra && !!pack.extra, svg: pack.svg } : null);
    }
    return { refresh, apply };
  }
  // UI buttons (ui-close.svg / ui-gear.svg / ui-game.svg) inlined so their CSS vars + hover styles apply
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
  return { mount, button, setVars, supportsBody, rushBody, applyColors, bindHats };
})();
