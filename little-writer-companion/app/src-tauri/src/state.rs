//! App state and the paint view the overlay and desk actually render.
//! Journal, queue, and the settings form stay on `get_data`.

use crate::focus::{self, Phase};
use crate::idle::Mode;
use crate::platform;
use crate::store;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }

/// A position is persisted once it has been stable for `quiet_ms`.
#[derive(Default)]
pub struct Debounce { pending: Option<(i32, i32)>, since: u64, saved: Option<(i32, i32)> }
impl Debounce {
    pub fn new(saved: Option<(i32, i32)>) -> Self { Self { pending: None, since: 0, saved } }
    pub fn note(&mut self, pos: (i32, i32), now: u64) {
        if self.pending != Some(pos) { self.pending = Some(pos); self.since = now; }
    }
    pub fn settled(&mut self, now: u64, quiet_ms: u64) -> Option<(i32, i32)> {
        let p = self.pending?;
        if now.saturating_sub(self.since) >= quiet_ms && self.saved != Some(p) { self.saved = Some(p); return Some(p); }
        None
    }
}

#[derive(Serialize, Clone)]
pub struct MonitorRect { pub x: i32, pub y: i32, pub w: u32, pub h: u32, pub scale: f64, pub primary: bool }

/// Word progress. Flattened into the paint view so the UI still reads `words` and `project_name`.
#[derive(Serialize, Clone)]
pub struct Progress {
    pub words: u64,
    pub target_words: u64,
    pub project_name: String,
    pub tier: String,
    pub completed_count: usize,
    pub awaiting_next: bool,
    pub carry_words: u64,
    pub needs_title: bool,
}

/// What the overlay and the desk paint. It does not include the journal or the project queue.
#[derive(Serialize, Clone)]
pub struct Snapshot {
    pub mode: Mode,
    pub paused: bool,
    #[serde(flatten)]
    pub progress: Progress,
    pub watch: Option<platform::Fg>,
    pub distraction_reason: Option<String>,
    pub fg_rect: Option<(i32, i32, i32, i32)>,
    pub fg_id: Option<u64>,
    pub force_hide: bool,
    pub origin: (i32, i32),
    pub monitors: Vec<MonitorRect>,
    pub desk_monitor: usize,
    pub roam_all_monitors: bool,
    pub colors: store::Colors,
    pub warnings: Vec<String>,
    pub interactive: bool,
    pub buddy: String,
    pub onboarded: bool,
    pub buddy_scale: f64,
    pub walk_speed: f64,
    pub bubble_px: f64,
    pub tool: store::Tool,
    pub level: usize,
    pub real_level: usize,
    pub unlock_all: bool,
    pub home: Option<(i32, i32, u32, u32, f64)>,
    pub home_side: &'static str,
    pub hat: String,
    pub hat_color: String,
    pub hat_extra: bool,
    /// Quiet time counted toward the focus game, and the limit. `focus_limit_ms` 0 is off.
    pub focus_ms: u64,
    pub focus_limit_ms: u64,
    pub focus_ready: bool,
    pub focus_phase: Phase,
    pub focus_game: String,
}

/// Samples the tick already collected. `paint` does not call into windows.
pub struct Frame {
    pub mode: Mode,
    pub paused: bool,
    pub origin: (i32, i32),
    pub monitors: Vec<MonitorRect>,
    pub fg: Option<platform::Fg>,
    pub reason: Option<String>,
    pub home: Option<(i32, i32, u32, u32, f64)>,
    pub home_side: &'static str,
    pub force_hide: bool,
    pub listener_error: Option<String>,
}

pub struct Shared {
    pub data: store::Data,
    pub path: PathBuf,
    pub dirty: bool,
    pub snap: Option<Snapshot>,
    pub warnings: Vec<String>,
    /// A corrupt file could not be moved aside: never write over it.
    pub no_save: bool,
    pub interactive_until: u64,
    /// Focus streak and the game it unlocked. Not written to state.json.
    pub focus: focus::Session,
}

impl Shared {
    pub fn save(&mut self) {
        if !self.no_save { store::save(&self.path, &self.data); }
        self.dirty = false;
    }
}

pub type AppState = Arc<Mutex<Shared>>;

fn progress_of(data: &store::Data) -> Progress {
    let kpw = data.settings.keys_per_word.max(1);
    let (project_name, tier, words, target_words) = match (&data.active, data.completed.last()) {
        (Some(p), _) => (p.name.clone(), p.tier.as_str().to_string(), p.keystrokes / kpw, p.target_words),
        (None, Some(p)) => (p.name.clone(), p.tier.as_str().to_string(), p.target_words, p.target_words),
        _ => (String::new(), String::new(), 0, 1),
    };
    Progress {
        words, target_words, project_name, tier,
        completed_count: data.completed.len(),
        awaiting_next: data.awaiting_next,
        carry_words: data.carry_keystrokes / kpw,
        needs_title: data.needs_title(),
    }
}

pub fn paint(shared: &Shared, frame: Frame) -> Snapshot {
    let data = &shared.data;
    let desk = data.settings.desk_monitor.filter(|&i| i < frame.monitors.len())
        .or_else(|| frame.monitors.iter().position(|m| m.primary)).unwrap_or(0);
    let mut warnings = shared.warnings.clone();
    if let Some(e) = frame.listener_error { warnings.push(e); }
    let snap = Snapshot {
        mode: frame.mode,
        paused: frame.paused,
        progress: progress_of(data),
        watch: if frame.mode == Mode::Watch { frame.fg.clone() } else { None },
        distraction_reason: frame.reason.clone(),
        fg_rect: frame.fg.as_ref().map(|f| (f.x, f.y, f.w, f.h)),
        fg_id: frame.fg.as_ref().map(|f| f.id),
        force_hide: frame.force_hide,
        origin: frame.origin,
        monitors: frame.monitors,
        desk_monitor: desk,
        roam_all_monitors: data.settings.roam_all_monitors,
        colors: data.settings.colors.clone(),
        warnings,
        interactive: shared.interactive_until != 0,
        buddy: data.settings.buddy_name.clone(),
        onboarded: data.onboarded.unwrap_or(true),
        buddy_scale: data.settings.buddy_scale,
        walk_speed: data.settings.walk_speed,
        bubble_px: data.settings.bubble_px,
        tool: data.effective_tool(),
        level: data.level(),
        real_level: data.real_level(),
        unlock_all: data.settings.unlock_all,
        home: frame.home,
        home_side: frame.home_side,
        hat: data.settings.hat.clone(),
        hat_color: data.settings.hat_color.clone(),
        hat_extra: data.settings.hat_extra,
        focus_ms: shared.focus.elapsed_ms,
        focus_limit_ms: focus::limit_ms(data.settings.focus_minutes),
        focus_ready: shared.focus.ready,
        focus_phase: shared.focus.phase,
        focus_game: shared.focus.game.clone(),
    };
    snap
}

pub fn write_focus(snap: &mut Snapshot, focus: &focus::Session, minutes: u32) {
    snap.focus_ms = focus.elapsed_ms;
    snap.focus_limit_ms = focus::limit_ms(minutes);
    snap.focus_ready = focus.ready;
    snap.focus_phase = focus.phase;
    snap.focus_game = focus.game.clone();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debounce_saves_once_settled() {
        let mut d = Debounce::new(Some((0, 0)));
        d.note((10, 10), 0); assert_eq!(d.settled(100, 600), None);
        d.note((20, 20), 200); assert_eq!(d.settled(700, 600), None);
        assert_eq!(d.settled(800, 600), Some((20, 20)));
        assert_eq!(d.settled(2000, 600), None);
        d.note((0, 0), 3000); assert_eq!(d.settled(4000, 600), Some((0, 0)));
    }

    #[test]
    fn paint_omits_the_journal_and_takes_no_window_handle() {
        const SRC: &str = include_str!("state.rs");
        let i = SRC.find("pub fn paint(").unwrap();
        let block = &SRC[i..SRC[i..].find("\n#[cfg(test)]").unwrap_or(SRC.len() - i) + i];
        assert!(!block.contains("get_webview_window") && !block.contains("outer_position"), "paint reads state, it does not call windows");
        assert!(!block.contains("journal"));
    }

    #[test]
    fn watch_snapshot_has_no_window_title() {
        let secret = "TopSecretWindowTitle";
        let shared = Shared {
            data: store::Data::default(), path: PathBuf::new(), dirty: false, snap: None,
            warnings: vec![], no_save: true, interactive_until: 0, focus: focus::Session::default(),
        };
        let frame = Frame {
            mode: Mode::Watch, paused: false, origin: (0, 0), monitors: vec![],
            fg: Some(platform::Fg { id: 42, title: secret.into(), x: 10, y: 20, w: 30, h: 40 }),
            reason: Some("title:YouTube".into()), home: None, home_side: "right",
            force_hide: false, listener_error: None,
        };
        let json = serde_json::to_value(paint(&shared, frame)).unwrap();
        assert!(json["watch"].get("title").is_none(), "{json}");
        assert_eq!(json["watch"]["x"], 10);
        assert_eq!(json["watch"]["w"], 30);
        assert_eq!(json["fg_id"], 42);
        assert_eq!(json["distraction_reason"], "title:YouTube");
        assert!(!json.to_string().contains(secret));
    }
}
