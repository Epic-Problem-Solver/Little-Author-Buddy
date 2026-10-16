// Little Writer companion colour helper (fallback for browsers/webviews without CSS relative colour).
// lwApplyColor(el, '#e8cfa9') sets --body, --shade and --hands (shade = hands = ~25% darker in OKLCH,
// or lighter when the body is very dark). Same rule as the CSS default in lw-character.css.
(function (g) {
  const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const fromLin = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function hexToOklch(hex) {
    hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
    const [r, gg, b] = [0, 2, 4].map(i => toLin(parseInt(hex.slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gg + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gg + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gg + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(A, B), Math.atan2(B, A)];
  }
  function oklchToHex(L, C, H) {
    const A = C * Math.cos(H), B = C * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, fromLin(v))) * 255).toString(16).padStart(2, '0')).join('');
  }
  function lwDeriveShade(hex) {
    const [L, C, H] = hexToOklch(hex);
    return oklchToHex(L >= 0.42 ? L * 0.75 : Math.min(1, L + 0.18), Math.min(0.25, C * 1.8), H);
  }
  function lwApplyColor(el, hex) {
    const shade = lwDeriveShade(hex);
    el.style.setProperty('--body', hex);
    el.style.setProperty('--shade', shade);
    el.style.setProperty('--hands', shade);
    return shade;
  }
  g.lwApplyColor = lwApplyColor; g.lwDeriveShade = lwDeriveShade;
  if (typeof module !== 'undefined') module.exports = { lwApplyColor, lwDeriveShade };
})(typeof window !== 'undefined' ? window : globalThis);
