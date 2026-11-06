//! Cross-thread flags. Hook callbacks and the window-drag handler do not take the app mutex.
//! The hook counts letter keys and does not store them.

use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, OnceLock};

pub static RACE_ARRIVED: AtomicBool = AtomicBool::new(false);
pub static TRACK: Mutex<Option<u64>> = Mutex::new(None);
/// Foreground window id from the latest idle sample. 0 means none (HWND 0 is not a window).
pub static LAST_FG: AtomicU64 = AtomicU64::new(0);
pub static SETTINGS_TAB: Mutex<String> = Mutex::new(String::new());
/// Usable monitor rects (work area, or the full monitor when none was reported),
/// recorded before a missing compositor shrinks the overlay to a corner box.
pub static REAL_MONS: Mutex<Vec<(i32, i32, u32, u32)>> = Mutex::new(Vec::new());
pub static HOME_RESIZED_ONCE: AtomicBool = AtomicBool::new(false);
pub static COMPOSITOR: OnceLock<bool> = OnceLock::new();
/// True only while a sprint game is playing, so the cursor is not sampled the rest of the time.
pub static GAME_CURSOR: AtomicBool = AtomicBool::new(false);
/// True while the tag click-catcher window should exist.
pub static TAG_HIT: AtomicBool = AtomicBool::new(false);
/// Latest physical rect for that window. Applied once the window exists, including a place that arrived first.
pub static TAG_PLACE: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);
