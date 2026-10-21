//! Cross-thread flags. Hook callbacks and the window-drag handler do not take the app mutex.
//! The keyboard hook may read FOCUS_ASK and set FOCUS_ANSWER. It does not store the key.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8};
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
/// True only while a focus game is playing, so the cursor is not sampled the rest of the time.
pub static GAME_CURSOR: AtomicBool = AtomicBool::new(false);
/// True only while Buddy is waiting for Y or N. The hook reads this and does not keep the key.
pub static FOCUS_ASK: AtomicBool = AtomicBool::new(false);
/// 0 none, 1 yes, 2 no. The hook sets the first answer. The tick takes it.
pub static FOCUS_ANSWER: AtomicU8 = AtomicU8::new(0);
/// True while the tag click-catcher window should exist.
pub static TAG_HIT: AtomicBool = AtomicBool::new(false);
