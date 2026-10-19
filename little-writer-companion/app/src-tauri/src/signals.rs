//! Cross-thread flags. Hook callbacks and the window-drag handler do not touch these.

use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, OnceLock};

pub static RACE_ARRIVED: AtomicBool = AtomicBool::new(false);
pub static TRACK: Mutex<Option<u64>> = Mutex::new(None);
/// Foreground window id from the latest idle sample. 0 means none (HWND 0 is not a window).
pub static LAST_FG: AtomicU64 = AtomicU64::new(0);
pub static SETTINGS_TAB: Mutex<String> = Mutex::new(String::new());
/// Real monitors, recorded before a missing compositor shrinks the overlay to a corner box.
pub static REAL_MONS: Mutex<Vec<(i32, i32, u32, u32)>> = Mutex::new(Vec::new());
pub static HOME_RESIZED_ONCE: AtomicBool = AtomicBool::new(false);
pub static COMPOSITOR: OnceLock<bool> = OnceLock::new();
