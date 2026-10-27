//! Cross-thread flags. Hook callbacks and the window-drag handler do not take the app mutex.
//! The hook counts letter keys and does not store them.

use crate::idle::Mode;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, OnceLock};

/// How long a dashboard mode stays put. A letter key or another event ends it sooner.
pub const DASH_HOLD_MS: u64 = 120_000;

/// A mode the Events window asked the tick to keep. The tick applies it before the idle step.
#[derive(Clone, Copy, Debug)]
pub struct DashHold {
    pub mode: Mode,
    pub until: u64,
}

pub static DASH_HOLD: Mutex<Option<DashHold>> = Mutex::new(None);

/// The preview still in force, or none once the deadline or a letter key has passed.
pub fn dash_peek(now: u64, keys: u64) -> Option<DashHold> {
    let mut g = DASH_HOLD.lock().unwrap();
    match *g {
        Some(h) if now < h.until && keys == 0 => Some(h),
        Some(_) => { *g = None; None }
        None => None,
    }
}

/// Arrival ended the rush. Drop the race preview so the next tick does not start it again.
pub fn dash_clear_if_race() {
    let mut g = DASH_HOLD.lock().unwrap();
    if matches!(g.as_ref().map(|h| h.mode), Some(Mode::RaceBack)) { *g = None; }
}

pub static RACE_ARRIVED: AtomicBool = AtomicBool::new(false);
pub static TRACK: Mutex<Option<u64>> = Mutex::new(None);
/// Foreground window id from the latest idle sample. 0 means none (HWND 0 is not a window).
pub static LAST_FG: AtomicU64 = AtomicU64::new(0);
pub static SETTINGS_TAB: Mutex<String> = Mutex::new(String::new());
/// Real monitors, recorded before a missing compositor shrinks the overlay to a corner box.
pub static REAL_MONS: Mutex<Vec<(i32, i32, u32, u32)>> = Mutex::new(Vec::new());
pub static HOME_RESIZED_ONCE: AtomicBool = AtomicBool::new(false);
pub static COMPOSITOR: OnceLock<bool> = OnceLock::new();
/// True only while a sprint game is playing, so the cursor is not sampled the rest of the time.
pub static GAME_CURSOR: AtomicBool = AtomicBool::new(false);
/// True while the tag click-catcher window should exist.
pub static TAG_HIT: AtomicBool = AtomicBool::new(false);
