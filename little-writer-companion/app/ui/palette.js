// Colour presets shared by Settings and onboarding. Body colours from Animator's presets;
// desk/tool/paper colours chosen to match each palette. Keys map to CSS vars ('_' -> '-').
var window = typeof window !== 'undefined' ? window : globalThis;
window.LWPalette = {
  KEYS: ['body', 'shade', 'hands', 'outline', 'desk', 'desk_shade', 'tool', 'tool_shade', 'screen', 'ink', 'feather', 'feather_shade', 'paper', 'paper_shade'],
  PRESETS: {
    Beige: '#e8cfa9,#b77d48,#b77d48,#241414,#8a5a35,#6e4527,#7d8aa0,#56627a,#9fe3ff,#2f3a66,#f4f0ea,#cbbfae,#f6efe2,#d9cdb8',
    Sky: '#cfe6ff,#6f9fd6,#6f9fd6,#1b2340,#6d7f99,#4e5d74,#a3b4cc,#6f819c,#c8f1ff,#1b2340,#ffffff,#b9c9de,#f4f8ff,#cdd8e8',
    Rose: '#ffd0dc,#e07a99,#e07a99,#3a1424,#9b5a6a,#77404f,#c79aa8,#9a6c7b,#ffe1ea,#5a1a33,#fff4f7,#e3b8c5,#fff6f8,#e9cdd5',
    Mint: '#d6f0c4,#7ab35a,#5d8f42,#1d2b14,#7a6a45,#5a4e31,#8fa38a,#647a5f,#d9ffd0,#1d2b14,#f5fbef,#bfd6b2,#f7fbf2,#d3dfc8',
  },
  /** preset name -> {key: colour}; shade + hands derived from body (same as the app does on save) */
  colors(name) { const v = this.PRESETS[name].split(','); const c = Object.fromEntries(this.KEYS.map((k, i) => [k, v[i]])); return Object.assign(c, this.derive(c.body) || {}); },
  /** v0.7: shade = hands = Animator's OKLCH rule (assets/lw-color.js lwDeriveShade; mirrored in store.rs derive_body) */
  derive(body) {
    if (!/^#?[0-9a-f]{6}$/i.test(String(body).trim())) return null;
    const f = globalThis.lwDeriveShade || (typeof require !== 'undefined' && require('./assets/lw-color.js').lwDeriveShade);
    const shade = f(String(body).trim()); return { shade, hands: shade };
  },
};

if (typeof module !== 'undefined') module.exports = window.LWPalette;
