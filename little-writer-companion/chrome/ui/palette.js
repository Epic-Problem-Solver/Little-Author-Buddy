// Colour presets shared by Settings and onboarding.
// Body comes from the named preset. Outline, desk, pen, typewriter, laptop, ink, feather,
// and paper always stay on the Beige defaults (same hexes as Colors::default in store.rs).
var window = typeof window !== 'undefined' ? window : globalThis;
window.LWPalette = {
  KEYS: ['body', 'shade', 'hands', 'outline', 'desk', 'desk_shade', 'tool', 'tool_shade', 'screen', 'ink', 'feather', 'feather_shade', 'paper', 'paper_shade'],
  // OKLCH L below this would flip the shade lighter. Those bodies cannot be chosen.
  DARK_L: 0.42,
  FURNITURE: {
    desk: '#8a5a35', desk_shade: '#6e4527', tool: '#7d8aa0', tool_shade: '#56627a',
    screen: '#9fe3ff', ink: '#2f3a66', feather: '#f4f0ea', feather_shade: '#cbbfae',
    paper: '#f6efe2', paper_shade: '#d9cdb8',
  },
  OUTLINE: '#241414',
  PRESETS: {
    Beige: { body: '#e8cfa9' },
    Sky: { body: '#cfe6ff' },
    Rose: { body: '#ffd0dc' },
    Mint: { body: '#d6f0c4' },
  },
  /** preset name -> {key: colour}; shade + hands derived from body; outline and furniture always Beige */
  colors(name) {
    const p = this.PRESETS[name];
    return this.normalize({ body: p.body });
  },
  /** Reject a body that would invert. Outline, desk, and writing tools stay on the Beige defaults. */
  normalize(raw) {
    const src = raw || {};
    const body = this.bodyAllowed(src.body) ? String(src.body).trim() : this.PRESETS.Beige.body;
    return Object.assign({ ...this.FURNITURE, body, outline: this.OUTLINE }, this.derive(body) || {});
  },
  /** v0.7: shade = hands = Animator's OKLCH rule (assets/lw-color.js lwDeriveShade; mirrored in store.rs derive_body) */
  derive(body) {
    if (!/^#?[0-9a-f]{6}$/i.test(String(body).trim())) return null;
    const f = globalThis.lwDeriveShade || (typeof require !== 'undefined' && require('./assets/lw-color.js').lwDeriveShade);
    const shade = f(String(body).trim()); return { shade, hands: shade };
  },
  /** False for invalid hex and for bodies whose OKLCH lightness is below DARK_L. */
  bodyAllowed(body) {
    const f = globalThis.lwBodyAllowed || (typeof require !== 'undefined' && require('./assets/lw-color.js').lwBodyAllowed);
    return f(body);
  },
};

if (typeof module !== 'undefined') module.exports = window.LWPalette;
