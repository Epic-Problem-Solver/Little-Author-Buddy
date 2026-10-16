//! JSON persistence for settings and projects. Only counts are stored, never key contents.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Writing-project size. Wire values stay `short_story` / `novella` / `novel`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Tier { ShortStory, Novella, Novel }

impl Default for Tier { fn default() -> Self { Tier::ShortStory } }

impl Tier {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s { "short_story" => Self::ShortStory, "novella" => Self::Novella, "novel" => Self::Novel, _ => return None })
    }
    pub fn as_str(self) -> &'static str {
        match self { Self::ShortStory => "short_story", Self::Novella => "novella", Self::Novel => "novel" }
    }
    pub fn index(self) -> usize {
        match self { Self::ShortStory => 0, Self::Novella => 1, Self::Novel => 2 }
    }
}

/// Desk tool. Wire values stay `pen` / `typewriter` / `laptop`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Tool { Pen, Typewriter, Laptop }

impl Default for Tool { fn default() -> Self { Tool::Pen } }

impl Tool {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s { "pen" => Self::Pen, "typewriter" => Self::Typewriter, "laptop" => Self::Laptop, _ => return None })
    }
    pub fn as_str(self) -> &'static str {
        match self { Self::Pen => "pen", Self::Typewriter => "typewriter", Self::Laptop => "laptop" }
    }
    pub fn index(self) -> usize {
        match self { Self::Pen => 0, Self::Typewriter => 1, Self::Laptop => 2 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub keys_per_word: u64,
    pub idle_threshold_ms: u64,
    pub wander_min_ms: u64,
    pub wander_max_ms: u64,
    pub race_back_ms: u64,
    pub distraction_titles: Vec<String>,
    pub detect_titles: bool,
    pub detect_media: bool,
    pub detect_scroll: bool,
    /// wheel events within `scroll_window_ms` needed to count as browsing
    pub scroll_events_threshold: u32,
    pub scroll_window_ms: u64,
    pub colors: Colors,
    pub tiers: Tiers,
    /// Index into the OS monitor list for the desk; None = primary monitor.
    pub desk_monitor: Option<usize>,
    pub roam_all_monitors: bool,
    /// Folder for exported journal .md files; None = <Documents>/Little Writer Journal
    pub journal_dir: Option<String>,
    /// Selected writing tool; only used if unlocked.
    pub tool: Tool,
    /// Testing aid: treat every tier/tool as unlocked without touching real progress.
    pub unlock_all: bool,
    /// Home (desk) window top-left in physical px; validated against monitors on load.
    pub home_pos: Option<(i32, i32)>,
    /// The buddy's name (onboarding); used for {buddy} in bubbles and letters.
    pub buddy_name: String,
    /// Buddy size multiplier (also auto-scaled per monitor), 0.6-1.6
    pub buddy_scale: f64,
    /// Wander speed in logical px/s (other modes are multiples), 40-300
    pub walk_speed: f64,
    /// Speech-bubble font size in logical px, 9-20
    pub bubble_px: f64,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Tiers { pub short_story: u64, pub novella: u64, pub novel: u64 }
impl Tiers {
    pub fn target(&self, tier: Tier) -> u64 {
        match tier { Tier::Novella => self.novella, Tier::Novel => self.novel, Tier::ShortStory => self.short_story }.max(1)
    }
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Colors {
    pub body: String, pub shade: String, pub hands: String, pub outline: String,
    // v0.4 desk/tool colours (CSS vars --desk, --desk-shade, --tool, ... ; '_' -> '-')
    pub desk: String, pub desk_shade: String, pub tool: String, pub tool_shade: String,
    pub screen: String, pub ink: String, pub feather: String, pub feather_shade: String,
    pub paper: String, pub paper_shade: String,
}
/// v0.6/v0.7: one body picker. Shade + hands are one colour derived from the body with Animator's rule
/// (assets/lw-color.js `lwDeriveShade`, same as the CSS default): in OKLCH, L x0.75 and chroma x1.8 (max .25);
/// when the body is dark (OKLCH L < DARK_L) the shade flips lighter (L + 0.18).
pub const DARK_L: f64 = 0.42;
fn parse_hex(h: &str) -> Option<(f64, f64, f64)> {
    let h = h.trim().trim_start_matches('#');
    if h.len() != 6 || !h.is_ascii() { return None; }
    let v = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|x| x as f64 / 255.0);
    Some((v(0)?, v(2)?, v(4)?))
}
fn to_lin(c: f64) -> f64 { if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) } }
fn from_lin(c: f64) -> f64 { if c <= 0.0031308 { 12.92 * c } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 } }
/// #rrggbb -> (L, C, H) in OKLCH
pub fn oklch(hex: &str) -> Option<(f64, f64, f64)> {
    let (r, g, b) = parse_hex(hex)?; let (r, g, b) = (to_lin(r), to_lin(g), to_lin(b));
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    let ll = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    let a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    let bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    Some((ll, a.hypot(bb), bb.atan2(a)))
}
fn oklch_hex(ll: f64, c: f64, h: f64) -> String {
    let (a, b) = (c * h.cos(), c * h.sin());
    let l = (ll + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m = (ll - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s = (ll - 0.0894841775 * a - 1.291485548 * b).powi(3);
    let rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    let c8 = |v: f64| (from_lin(v).clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", c8(rgb[0]), c8(rgb[1]), c8(rgb[2]))
}
/// Returns (shade, hands) for a body colour, or None if it is not #rrggbb.
pub fn derive_body(body: &str) -> Option<(String, String)> {
    let (l, c, h) = oklch(body)?;
    let shade = oklch_hex(if l >= DARK_L { l * 0.75 } else { (l + 0.18).min(1.0) }, (c * 1.8).min(0.25), h);
    Some((shade.clone(), shade))
}
impl Colors {
    /// Recompute shade + hands from body (keeps body; invalid body falls back to the default palette).
    pub fn derive(&mut self) {
        match derive_body(&self.body) {
            Some((s, h)) => { self.shade = s; self.hands = h; }
            None => { let d = Colors::default(); self.body = d.body; self.shade = d.shade; self.hands = d.hands; }
        }
    }
}

impl Default for Colors {
    fn default() -> Self { // Animator "Beige" preset + lw-character.css defaults
        let c = |s: &str| s.to_string();
        Colors { body: c("#e8cfa9"), shade: c("#b77d48"), hands: c("#b77d48"), outline: c("#241414"),
            desk: c("#8a5a35"), desk_shade: c("#6e4527"), tool: c("#7d8aa0"), tool_shade: c("#56627a"),
            screen: c("#9fe3ff"), ink: c("#2f3a66"), feather: c("#f4f0ea"), feather_shade: c("#cbbfae"),
            paper: c("#f6efe2"), paper_shade: c("#d9cdb8") }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            keys_per_word: 5,
            idle_threshold_ms: 20_000,
            wander_min_ms: 60_000,
            wander_max_ms: 300_000,
            race_back_ms: 1_500,
            distraction_titles: ["YouTube", "Netflix", "Reddit", "VLC", "Twitch", "Disney+", "Prime Video", "TikTok"]
                .iter().map(|s| s.to_string()).collect(),
            detect_titles: true,
            detect_media: true,
            detect_scroll: true,
            scroll_events_threshold: 12,
            scroll_window_ms: 6_000,
            tiers: Tiers { short_story: 3_000, novella: 30_000, novel: 60_000 },
            desk_monitor: None,
            roam_all_monitors: true,
            journal_dir: None,
            tool: Tool::Pen,
            unlock_all: false,
            home_pos: None,
            buddy_name: DEFAULT_BUDDY.into(),
            buddy_scale: 1.0,
            walk_speed: 96.0,
            bubble_px: 12.0,
            colors: Colors::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub name: String,
    pub tier: Tier,
    pub target_words: u64,
    pub keystrokes: u64,
    pub started_at: u64,
    pub completed_at: Option<u64>,
}
impl Project {
    pub fn new(name: &str, tier: Tier, target: u64, now: u64) -> Self {
        Self { name: name.into(), tier, target_words: target, keystrokes: 0, started_at: now, completed_at: None }
    }
}


#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Data {
    pub settings: Settings,
    pub active: Option<Project>,
    pub queue: Vec<Project>,
    pub completed: Vec<Project>,
    pub total_keystrokes: u64,
    /// Aggregate per-UTC-day keystroke totals. No per-key timestamps are ever stored.
    pub daily: Vec<DayStat>,
    /// Received fan letters (letter journal).
    pub journal: Vec<Letter>,
    /// After a completion: overflow keystrokes waiting for the next project, and whether we're waiting for the user.
    pub carry_keystrokes: u64,
    pub awaiting_next: bool,
    /// None = save from before v0.5 (migrated on load); Some(false) = first run, show onboarding.
    pub onboarded: Option<bool>,
}

pub const DEFAULT_BUDDY: &str = "Inky";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DayStat { pub day: String, pub keystrokes: u64 }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Letter { pub category: String, pub from: String, pub body: String, pub project: String, pub received_at: u64 }

/// Local calendar date "YYYY-MM-DD" for a unix-ms timestamp (BUG-15: local, not UTC).
pub fn day_string(ms: u64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(ms as i64).single().map(|t| t.format("%Y-%m-%d").to_string()).unwrap_or_else(|| "1970-01-01".into())
}

impl Data {
    pub fn add_daily(&mut self, now: u64, n: u64) {
        if n == 0 { return; }
        let day = day_string(now);
        match self.daily.last_mut() {
            Some(d) if d.day == day => d.keystrokes += n,
            _ => self.daily.push(DayStat { day, keystrokes: n }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_is_backed_up() {
        let dir = std::env::temp_dir().join(format!("lwc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("state.json");
        std::fs::write(&p, "{\"active\": {broken").unwrap();
        let (d, w) = load(&p, 42);
        assert!(matches!(w.as_ref().unwrap().kind, LoadErrorKind::Parse(_)) && !w.unwrap().block_save() && d.active.is_none());
        assert!(!p.exists());
        assert_eq!(std::fs::read_to_string(dir.join("state.corrupt-42.json")).unwrap(), "{\"active\": {broken");
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn invalid_utf8_is_backed_up() {
        let dir = std::env::temp_dir().join(format!("lwc-utf8-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("state.json");
        let bytes = b"{\"total_keystrokes\": 999, \"x\":\"\xff\xfe\"}".to_vec();
        std::fs::write(&p, &bytes).unwrap();
        let (d, w) = load(&p, 7);
        let w = w.expect("issue reported");
        assert_eq!(d.total_keystrokes, 0);
        assert!(matches!(w.kind, LoadErrorKind::Encoding(_)));
        assert!(!w.block_save() && !p.exists());
        assert_eq!(std::fs::read(dir.join("state.corrupt-7.json")).unwrap(), bytes);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn unreadable_blocks_save_when_not_movable() {
        // a directory at the path: read fails (not NotFound) and rename to a missing parent fails
        let dir = std::env::temp_dir().join(format!("lwc-dir-{}", std::process::id()));
        let p = dir.join("state.json");
        std::fs::create_dir_all(&p).unwrap();
        let issue = LoadIssue { kind: LoadErrorKind::Read(std::io::Error::other("x")), backup: None };
        assert!(issue.block_save());
        let (_, w) = load(&p, 9);
        let w = w.expect("issue reported");
        assert!(matches!(w.kind, LoadErrorKind::Read(_)));
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn kpw_clamp_and_migration() {
        assert_eq!(clamp_kpw(0), 1); assert_eq!(clamp_kpw(3), 3); assert_eq!(clamp_kpw(7), 5); assert_eq!(clamp_kpw(50), 5);
        assert_eq!(Settings::default().keys_per_word, 5);
        let dir = std::env::temp_dir().join(format!("lwc-mig-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("state.json");
        // v0.2 file: BOM + kpw 12 + obsolete ignore_keys -> loads, kpw clamped, ignore_keys dropped
        let mut b = b"\xEF\xBB\xBF".to_vec();
        b.extend_from_slice(br#"{"settings":{"keys_per_word":12,"ignore_keys":["ShiftLeft"]},"total_keystrokes":5}"#);
        std::fs::write(&p, b).unwrap();
        let (d, w) = load(&p, 1);
        assert!(w.is_none());
        assert_eq!(d.settings.keys_per_word, 5);
        assert_eq!(d.total_keystrokes, 5);
        assert!(!serde_json::to_string(&d).unwrap().contains("ignore_keys"));
        let _ = std::fs::remove_dir_all(dir);
    }
    fn done(tier: Tier) -> Project { let mut p = Project::new("x", tier, 1, 0); p.completed_at = Some(1); p }
    #[test]
    fn progression() {
        let mut d = Data::default();
        assert!(d.needs_title());
        assert_eq!(d.unlocked_tiers(), vec!["short_story"]); assert_eq!(d.unlocked_tools(), vec!["pen"]);
        assert!(!d.tier_unlocked("novella") && !d.tool_unlocked("typewriter"));
        d.completed.push(done(Tier::ShortStory));
        assert!(d.tier_unlocked("novella") && d.tool_unlocked("typewriter") && !d.tier_unlocked("novel") && !d.tool_unlocked("laptop"));
        d.completed.push(done(Tier::Novella));
        assert!(d.tier_unlocked("novel") && d.tool_unlocked("laptop"));
        assert!(!d.tier_unlocked("bogus") && !d.tool_unlocked("bogus"));
    }
    #[test]
    fn migration_from_completed() {
        // a v0.3 save with only a novel completed (e.g. created by hand) unlocks everything
        let d: Data = serde_json::from_str(r#"{"completed":[{"name":"n","tier":"novel","target_words":1,"keystrokes":5,"started_at":0,"completed_at":1}]}"#).unwrap();
        assert_eq!(d.level(), 2);
        assert_eq!(d.settings.tool, Tool::Pen);
    }
    #[test]
    fn unlock_all_is_reversible() {
        let mut d = Data::default();
        d.settings.tool = Tool::Laptop;
        assert_eq!(d.effective_tool(), Tool::Pen);
        d.settings.unlock_all = true;
        assert_eq!(d.level(), 2); assert_eq!(d.real_level(), 0); assert_eq!(d.effective_tool(), Tool::Laptop);
        assert!(d.completed.is_empty());
        d.settings.unlock_all = false;
        assert_eq!(d.level(), 0); assert_eq!(d.effective_tool(), Tool::Pen);
        d.completed.push(done(Tier::ShortStory));
        assert_eq!(d.effective_tool(), Tool::Typewriter);
    }
    #[test]
    fn credit_holds_keystrokes_until_the_story_has_a_title() {
        let mut d = Data::default();
        let c = d.credit(10, 1_000);
        assert!(c.completed.is_none() && c.notice.is_none() && c.changed);
        assert_eq!(d.carry_keystrokes, 10);
        assert!(d.needs_title());
    }
    #[test]
    fn credit_completes_and_carries_overflow() {
        let mut d = Data::default();
        d.active = Some(Project::new("S", Tier::ShortStory, 2, 0));
        d.settings.keys_per_word = 5;
        let c = d.credit(12, 50);
        let done = c.completed.expect("completed");
        assert_eq!(done.keystrokes, 10);
        assert_eq!(d.carry_keystrokes, 2);
        assert!(d.awaiting_next && d.active.is_none());
        assert_eq!(c.notice.as_deref(), Some("Unlocked: Novella + typewriter!"));
    }
    #[test]
    fn credit_while_choosing_the_next_project_keeps_carry() {
        let mut d = Data::default();
        d.awaiting_next = true;
        d.carry_keystrokes = 3;
        d.credit(4, 10);
        assert_eq!(d.carry_keystrokes, 7);
        assert!(d.active.is_none());
    }
    #[test]
    fn credit_starts_a_short_story_when_nothing_is_active() {
        let mut d = Data::default();
        d.completed.push(done(Tier::ShortStory));
        let c = d.credit(5, 10);
        let active = d.active.expect("started");
        assert_eq!(active.name, "My Short Story");
        assert_eq!(active.keystrokes, 5);
        assert_eq!(c.notice.as_deref(), Some("Started a new Short Story for you — change it in Projects."));
    }
    #[test]
    fn onboarding_migration() {
        let dir = std::env::temp_dir().join(format!("lwc-onb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("state.json");
        let (d, _) = load(&p, 1); // fresh install
        assert_eq!(d.onboarded, Some(false));
        std::fs::write(&p, r#"{"active":{"name":"Old","tier":"short_story","target_words":3000,"keystrokes":10,"started_at":0,"completed_at":null}}"#).unwrap();
        let (d, _) = load(&p, 1); // v0.4 save
        assert_eq!(d.onboarded, Some(true));
        assert_eq!(d.settings.buddy_name, DEFAULT_BUDDY);
        std::fs::write(&p, r#"{"onboarded":false}"#).unwrap();
        assert_eq!(load(&p, 1).0.onboarded, Some(false));
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn motion_settings_clamp() {
        let mut s = Settings::default();
        assert_eq!((s.buddy_scale, s.walk_speed, s.bubble_px), (1.0, 96.0, 12.0));
        s.buddy_scale = 9.0; s.walk_speed = 1.0; s.bubble_px = f64::NAN;
        clamp_motion(&mut s);
        assert_eq!((s.buddy_scale, s.walk_speed, s.bubble_px), (1.6, 40.0, 12.0));
    }
    #[test]
    fn days() {
        use chrono::TimeZone;
        let t = chrono::Local.with_ymd_and_hms(2026, 10, 14, 23, 30, 0).unwrap().timestamp_millis() as u64;
        assert_eq!(day_string(t), "2026-10-14"); // 23:30 local stays on the local day even if UTC has rolled over
    }
    #[test]
    fn no_per_key_fields_persisted() {
        let mut d = Data::default();
        d.add_daily(1_792_000_000_000, 3); d.add_daily(1_792_000_001_000, 2);
        assert_eq!(d.daily.len(), 1); assert_eq!(d.daily[0].keystrokes, 5);
        let j = serde_json::to_string(&d).unwrap();
        assert!(!j.contains("last_key") && !j.contains("\"title\""));
    }
}

pub const TIERS: [Tier; 3] = [Tier::ShortStory, Tier::Novella, Tier::Novel];
pub const TOOLS: [Tool; 3] = [Tool::Pen, Tool::Typewriter, Tool::Laptop];

/// What `Data::credit` did with one batch of letter keystrokes.
pub struct Credit {
    pub completed: Option<Project>,
    pub notice: Option<String>,
    /// Keystrokes arrived, or a project was auto-started.
    pub changed: bool,
}

/// Progression level derived from completed projects (so old saves migrate automatically):
/// 0 = start (short story + pen), 1 = a short story done (+ novella, typewriter), 2 = a novella done (+ novel, laptop).
pub fn real_level(completed: &[Project]) -> usize {
    if completed.iter().any(|p| matches!(p.tier, Tier::Novella | Tier::Novel)) { 2 }
    else if completed.iter().any(|p| p.tier == Tier::ShortStory) { 1 } else { 0 }
}

impl Data {
    pub fn real_level(&self) -> usize { real_level(&self.completed) }
    pub fn level(&self) -> usize { if self.settings.unlock_all { 2 } else { self.real_level() } }
    pub fn tier_unlocked(&self, tier: &str) -> bool { Tier::parse(tier).map_or(false, |t| t.index() <= self.level()) }
    pub fn tool_unlocked(&self, tool: &str) -> bool { Tool::parse(tool).map_or(false, |t| t.index() <= self.level()) }
    #[allow(dead_code)]
    pub fn unlocked_tiers(&self) -> Vec<String> { TIERS[..=self.level()].iter().map(|t| t.as_str().to_string()).collect() }
    #[allow(dead_code)]
    pub fn unlocked_tools(&self) -> Vec<String> { TOOLS[..=self.level()].iter().map(|t| t.as_str().to_string()).collect() }
    /// The tool actually shown: the chosen one if unlocked, else the best unlocked one.
    pub fn effective_tool(&self) -> Tool {
        if self.tool_unlocked(self.settings.tool.as_str()) { self.settings.tool } else { TOOLS[self.level()] }
    }
    /// First launch: nothing active, queued or completed -> ask for a title before starting.
    pub fn needs_title(&self) -> bool { self.active.is_none() && self.queue.is_empty() && self.completed.is_empty() && !self.awaiting_next }

    pub fn make_project(&self, name: &str, tier: Tier, target: Option<u64>, now: u64) -> Project {
        let words = target.unwrap_or_else(|| self.settings.tiers.target(tier)).max(1);
        Project::new(name, tier, words, now)
    }

    /// Move carry-over keystrokes onto `p` and make it the active project.
    pub fn start_project(&mut self, mut p: Project, now: u64) {
        p.keystrokes += std::mem::take(&mut self.carry_keystrokes);
        p.started_at = now;
        self.active = Some(p);
        self.awaiting_next = false;
    }

    /// Apply `dk` letter keystrokes counted since the previous tick.
    ///
    /// Holds them on `carry_keystrokes` until a story has a title or the reader picks the next
    /// project. Otherwise credits the active project, carries overflow past the word target,
    /// and records a completion.
    pub fn credit(&mut self, dk: u64, now: u64) -> Credit {
        self.total_keystrokes += dk;
        self.add_daily(now, dk);
        let mut changed = dk > 0;
        let mut notice = None;
        if self.needs_title() {
            self.carry_keystrokes += dk;
            return Credit { completed: None, notice, changed };
        }
        if self.active.is_none() && !self.awaiting_next {
            let p = self.make_project("My Short Story", Tier::ShortStory, None, now);
            self.start_project(p, now);
            changed = true;
            notice = Some("Started a new Short Story for you — change it in Projects.".to_string());
        }
        if self.awaiting_next {
            self.carry_keystrokes += dk;
            return Credit { completed: None, notice, changed };
        }
        let kpw = self.settings.keys_per_word.max(1);
        let Some(p) = self.active.as_mut() else { return Credit { completed: None, notice, changed } };
        p.keystrokes += dk;
        p.target_words = p.target_words.max(1);
        if p.keystrokes / kpw < p.target_words { return Credit { completed: None, notice, changed } };
        let mut done = p.clone();
        done.completed_at = Some(now);
        self.carry_keystrokes += done.keystrokes - done.target_words * kpw;
        done.keystrokes = done.target_words * kpw;
        let before = real_level(&self.completed);
        self.completed.push(done.clone());
        self.active = None;
        self.awaiting_next = true;
        if self.real_level() > before {
            notice = Some(if self.real_level() == 1 { "Unlocked: Novella + typewriter!" } else { "Unlocked: Novel + laptop!" }.to_string());
        }
        Credit { completed: Some(done), notice, changed }
    }
}

/// Keystrokes-per-word slider range is 1..=5 (v0.3); older files may hold larger values.
pub fn clamp_kpw(v: u64) -> u64 { v.clamp(1, 5) }

/// Clamp the motion/size sliders to their ranges (NaN -> default).
pub fn clamp_motion(s: &mut Settings) {
    let f = |v: f64, lo: f64, hi: f64, d: f64| if v.is_finite() { v.clamp(lo, hi) } else { d };
    s.buddy_scale = f(s.buddy_scale, 0.6, 1.6, 1.0);
    s.walk_speed = f(s.walk_speed, 40.0, 300.0, 96.0);
    s.bubble_px = f(s.bubble_px, 9.0, 20.0, 12.0);
}

/// Why the saved file could not be used.
#[derive(Debug)]
pub enum LoadErrorKind { Read(std::io::Error), Encoding(std::str::Utf8Error), Parse(serde_json::Error) }

#[derive(Debug)]
pub struct LoadIssue {
    pub kind: LoadErrorKind,
    /// Where the unusable file was moved. None = could not be moved; saving must stay blocked.
    pub backup: Option<PathBuf>,
}
impl LoadIssue {
    pub fn block_save(&self) -> bool { self.backup.is_none() }
    pub fn message(&self) -> String {
        let why = match &self.kind { LoadErrorKind::Read(e) => format!("could not be read ({e})"), LoadErrorKind::Encoding(e) => format!("was not valid UTF-8 ({e})"), LoadErrorKind::Parse(e) => format!("was corrupt ({e})") };
        match &self.backup {
            Some(b) => format!("Saved data {why}. The old file was backed up to {} and a fresh profile started.", b.display()),
            None => format!("Saved data {why} and could not be backed up; it will not be overwritten this session."),
        }
    }
}

/// Missing file -> defaults. Any other read error, invalid UTF-8 or bad JSON -> the file is moved aside to
/// state.corrupt-<ms>.json and an issue returned; if it can't be moved, the caller must not save.
pub fn load(path: &PathBuf, now: u64) -> (Data, Option<LoadIssue>) {
    let kind = match std::fs::read(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Data { onboarded: Some(false), ..Data::default() }, None),
        Err(e) => LoadErrorKind::Read(e),
        // serde_json skips unknown fields without validating them, so check UTF-8 for the whole file first
        // BUG-18: tolerate a UTF-8 BOM (e.g. file edited in Notepad)
        Ok(bytes) => match std::str::from_utf8(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)) { Err(e) => LoadErrorKind::Encoding(e), Ok(text) => match serde_json::from_str::<Data>(text) {
            Ok(mut d) => {
                if let Some(a) = d.active.as_mut() { a.target_words = a.target_words.max(1); }
                for q in d.queue.iter_mut() { q.target_words = q.target_words.max(1); }
                d.settings.keys_per_word = clamp_kpw(d.settings.keys_per_word);
                clamp_motion(&mut d.settings);
                // v0.5 migration: existing saves skip onboarding (default buddy name), fresh-looking ones get it
                if d.onboarded.is_none() { d.onboarded = Some(!d.needs_title()); }
                d.settings.colors.derive(); // v0.6 migration: keep body, recompute shade + hands
                return (d, None);
            }
            Err(e) => LoadErrorKind::Parse(e),
        }},
    };
    let bak = path.with_file_name(format!("state.corrupt-{now}.json"));
    let backup = std::fs::rename(path, &bak).ok().map(|_| bak);
    (Data { onboarded: Some(false), ..Data::default() }, Some(LoadIssue { kind, backup }))
}

pub fn save(path: &PathBuf, data: &Data) {
    if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
    let tmp = path.with_extension("json.tmp");
    if let Ok(s) = serde_json::to_string_pretty(data) {
        if std::fs::write(&tmp, s).is_ok() { let _ = std::fs::rename(&tmp, path); }
    }

}

#[cfg(test)]
mod colour_tests {
    use super::*;
    #[test]
    fn colour_derivation() {
        // light body -> darker shade, dark body -> lighter shade; hands follow shade
        let (s, h) = derive_body("#e8cfa9").unwrap();
        assert_eq!(s, h);
        assert!(oklch(&s).unwrap().0 < oklch("#e8cfa9").unwrap().0);
        let (s2, _) = derive_body("#1d2a4a").unwrap();
        assert!(oklch("#1d2a4a").unwrap().0 < DARK_L);
        assert!(oklch(&s2).unwrap().0 > oklch("#1d2a4a").unwrap().0);
        // extremes stay valid hex
        for b in ["#000000", "#ffffff", "#ff0000", "#777777"] { let (s, _) = derive_body(b).unwrap(); assert!(parse_hex(&s).is_some(), "{b}->{s}"); assert_ne!(s, b); }
        assert!(derive_body("nope").is_none());
        // fixture shared with ui/tests/palette.test.js so JS and Rust stay identical
        let fx: std::collections::BTreeMap<String, String> = serde_json::from_str(include_str!("../../ui/tests/derive_fixture.json")).unwrap();
        for (b, s) in fx { assert_eq!(derive_body(&b).unwrap().0, s, "{b}"); }
        let mut c = Colors { body: "#cfe6ff".into(), shade: "#000000".into(), hands: "#000000".into(), ..Colors::default() };
        c.derive(); assert_eq!(c.body, "#cfe6ff"); assert_ne!(c.shade, "#000000"); assert_eq!(c.shade, c.hands);
    }
}
