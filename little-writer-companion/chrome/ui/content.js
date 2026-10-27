// Loads Writer's content JSON (content/fan_letters.json, content/flavour.json) with built-in fallback.
var window = typeof window !== 'undefined' ? window : globalThis;
window.LWContent = (() => {
  const FB = {
    letters: { categories: {
      encouragement: [{ from: 'A reader', body: 'I loved {projectTitle}! {wordCount} words — keep going.' }],
      inspirational: [{ from: 'Anonymous', body: '"Start writing, no matter what. The water does not flow until the faucet is turned on." — Louis L\'Amour' }],
      humorous: [{ from: 'Your cat', body: 'You typed {wordCount} words and none of them were "feed the cat". Disappointed.' }],
    } },
    flavour: { states: { sleeping: ['zzz…'], wandering: ['Just stretching…'], watchingVideo: ['Ooh, what\'s this?'], backToWork: ['Back to it!'], projectComplete: ['We did it!'], focusBreak: ['Ooh! Time for a game!'] } },
  };
  let letters = FB.letters, flavour = FB.flavour;
  const get = async p => { try { const r = await fetch(p); if (r.ok) return await r.json(); } catch (_) {} return null; };
  const ready = (async () => {
    const l = await get('content/fan_letters.json'); if (l && l.categories) letters = l;
    const f = await get('content/flavour.json'); if (f && f.states) flavour = f;
  })();
  const BUDDY_BIAS = 0.5;
  const pick = (a, r = Math.random) => a && a.length ? a[Math.floor(r() * a.length)] : '';
  // BUG-09: seeded RNG (mulberry32) so a given completion always yields the same letter
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

  return {
    ready,
    line: (key, vars = {}) => fill(pick((flavour.states || {})[key]) || '', vars),
    // index = completion number (persistent) -> category rotation guarantees each category every N completions
    letter(vars, index, seed) {
      const cats = Object.keys(letters.categories), cat = cats[((index % cats.length) + cats.length) % cats.length];
      // v0.6.1: letters that name the buddy are favoured (half the draws in a category that has any), so {buddy}
      // shows up reasonably often instead of ~1 in 6.
      const r = rng(hash(seed)), all = letters.categories[cat] || [];
      const named = vars && vars.buddy ? all.filter(x => /\{buddy\}/.test(x.body || x.text || '')) : [];
      const L = pick(named.length && r() < BUDDY_BIAS ? named : all, r) || {};
      return { category: cat, from: L.from || '', body: fill(L.body || L.text || '', vars) };
    },
  };
})();

if (typeof module !== 'undefined') module.exports = window.LWContent;
