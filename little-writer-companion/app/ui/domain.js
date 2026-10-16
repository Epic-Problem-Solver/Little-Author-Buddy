// Domain names shared by the desk, the overlay, and settings.
// Layout numbers that the race-back also uses live in motion.js. Rust mirrors both in layout.rs.
(function (root) {
  const TIER = Object.freeze({ shortStory: 'short_story', novella: 'novella', novel: 'novel' });
  const TOOL = Object.freeze({ pen: 'pen', typewriter: 'typewriter', laptop: 'laptop' });
  const TOOLS = Object.freeze([TOOL.pen, TOOL.typewriter, TOOL.laptop]);
  const TIER_UNLOCK = Object.freeze({ short_story: 0, novella: 1, novel: 2 });
  const TOOL_UNLOCK = Object.freeze({ pen: 0, typewriter: 1, laptop: 2 });
  const HOME_MODES = Object.freeze(['typing', 'asleep', 'paused']);
  const RACE_HOLD_MS = 1000;

  function atHome(mode) { return HOME_MODES.includes(mode); }
  function realLevel(completed) {
    if (completed.some(p => p.tier === TIER.novella || p.tier === TIER.novel)) return 2;
    if (completed.some(p => p.tier === TIER.shortStory)) return 1;
    return 0;
  }

  const D = { TIER, TOOL, TOOLS, TIER_UNLOCK, TOOL_UNLOCK, HOME_MODES, RACE_HOLD_MS, atHome, realLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = D; else root.LWDomain = D;
})(this);
