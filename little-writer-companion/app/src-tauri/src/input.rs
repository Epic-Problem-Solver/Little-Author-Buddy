//! Global input listener. Counts key-downs and wheel ticks only.
//! v0.3: ONLY letter keys A-Z count (by physical/virtual code, never by translation):
//! - Windows: vkCode 0x41-0x5A. IME: when the IME delivers VK_PROCESSKEY (0xE5) we map the hardware scanCode
//!   through a fixed Set-1 table of the A-Z key positions (QWERTY rows), so composition keystrokes on letter
//!   keys still count. No ToUnicodeEx / keyboard-layout lookup is ever done.
//! - Linux: fixed X11 keycode table (evdev + 8) of the A-Z key positions; no keysym lookup.
//! - macOS: the current layout's unshifted character, tested as A–Z and then discarded.
//! The code is only compared against these tables and for auto-repeat; it is never stored or logged.
//! - Windows: our own WH_KEYBOARD_LL + WH_MOUSE_LL hooks on a dedicated thread with a message loop.
//!   No ToUnicodeEx / GetKeyboardState / MapVirtualKey calls, so dead keys and IMEs are unaffected.
//! - Linux: X11 RECORD extension, reading only the event type and keycode byte (no XLookupString).
//! - macOS: a listen-only session event tap. The character used to classify a key is not stored.
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Default)]
pub struct Counters {
    pub keys: AtomicU64,
    pub wheel: AtomicU64,
    pub paused: AtomicBool,
    pub listener_error: Mutex<Option<String>>,
}

impl Counters {
    fn key_down(&self, code: u32, down: &mut HashSet<u32>) {
        // auto-repeat: repeated key-down without key-up
        if down.insert(code) && !self.paused.load(Ordering::Relaxed) && is_letter(code) {
            self.keys.fetch_add(1, Ordering::Relaxed);
        }
    }
    fn wheel_tick(&self) { if !self.paused.load(Ordering::Relaxed) { self.wheel.fetch_add(1, Ordering::Relaxed); } }
    fn fail(&self, msg: String) { eprintln!("{msg}"); *self.listener_error.lock().unwrap() = Some(msg); }
}

static COUNTERS: OnceLock<Arc<Counters>> = OnceLock::new();
// Held-key set for auto-repeat detection. Thread-local: only ever touched on the hook/listener thread,
// so hook callbacks take no locks and return immediately (Windows silently drops LL hooks that exceed
// LowLevelHooksTimeout). Counts are published with lock-free atomics, read by the tick thread.
thread_local! { static DOWN: std::cell::RefCell<HashSet<u32>> = std::cell::RefCell::new(HashSet::new()); }
fn with_down<R>(f: impl FnOnce(&mut HashSet<u32>) -> R) -> R { DOWN.with(|d| f(&mut d.borrow_mut())) }

/// Scan codes (PC Set 1) of the physical A-Z key positions: Q..P, A..L, Z..M.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn scan_is_letter(sc: u32) -> bool { matches!(sc, 0x10..=0x19 | 0x1E..=0x26 | 0x2C..=0x32) }
/// Synthetic code for a VK_PROCESSKEY press, keyed by scan code so auto-repeat detection still works.
#[cfg_attr(not(windows), allow(dead_code))]
pub const PROCESSKEY_BASE: u32 = 0x1_0000;

/// Does this raw code count toward words?
#[cfg(windows)]
pub fn is_letter(code: u32) -> bool {
    (0x41..=0x5A).contains(&code) || (code >= PROCESSKEY_BASE && scan_is_letter(code - PROCESSKEY_BASE))
}
/// Fallback: X11 keycodes (evdev + 8) of the US A-Z key positions: q..p = 24-33, a..l = 38-46, z..m = 52-58.
#[cfg(target_os = "linux")]
pub fn fixed_is_letter(code: u32) -> bool { matches!(code, 24..=33 | 38..=46 | 52..=58) }

/// BUG-19: keycode -> "is a letter" table built from the XKB layout (group 0, level 0 keysym in a..z),
/// rebuilt once per mapping change; None until built (then the fixed US table is used).
#[cfg(target_os = "linux")]
static XKB_LETTERS: std::sync::RwLock<Option<[bool; 256]>> = std::sync::RwLock::new(None);

/// Build the table from (keycode, base keysym) pairs. Pure, so it is unit-testable.
#[cfg(target_os = "linux")]
pub fn letters_from_keysyms(pairs: impl IntoIterator<Item = (u32, u64)>) -> Option<[bool; 256]> {
    const XK_A_LOWER: u64 = 0x61; const XK_Z_LOWER: u64 = 0x7a;
    let mut t = [false; 256];
    let mut n = 0;
    for (kc, sym) in pairs { if kc < 256 && (XK_A_LOWER..=XK_Z_LOWER).contains(&sym) { t[kc as usize] = true; n += 1; } }
    if n >= 20 { Some(t) } else { None } // implausible layout (e.g. non-Latin group 0) -> keep fallback
}

#[cfg(target_os = "linux")]
pub fn is_letter(code: u32) -> bool {
    match &*XKB_LETTERS.read().unwrap() { Some(t) => code < 256 && t[code as usize], None => fixed_is_letter(code) }
}

/// ANSI virtual keycodes of the US A–Z key positions. Used until the layout table exists,
/// and when that table has fewer than 20 Latin letters.
#[cfg(target_os = "macos")]
const ANSI_LETTERS: &[u32] = &[
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
    0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x1F, 0x20, 0x22,
    0x23, 0x25, 0x26, 0x28, 0x2D, 0x2E,
];

#[cfg(target_os = "macos")]
pub fn fixed_is_letter(code: u32) -> bool { ANSI_LETTERS.contains(&code) }

#[cfg(target_os = "macos")]
static MAC_LETTERS: std::sync::RwLock<Option<[bool; 256]>> = std::sync::RwLock::new(None);

/// `(keycode, unshifted scalar)` pairs. The scalar is only tested for ASCII A–Z and is not kept.
#[cfg(target_os = "macos")]
pub fn letters_from_unshifted(pairs: impl IntoIterator<Item = (u32, u32)>) -> Option<[bool; 256]> {
    let mut t = [false; 256];
    let mut n = 0;
    for (kc, ch) in pairs {
        if kc < 256 && ch < 128 && (ch as u8).is_ascii_alphabetic() {
            t[kc as usize] = true;
            n += 1;
        }
    }
    if n >= 20 { Some(t) } else { None }
}

#[cfg(target_os = "macos")]
pub fn install_layout(pairs: impl IntoIterator<Item = (u32, u32)>) {
    *MAC_LETTERS.write().unwrap() = letters_from_unshifted(pairs);
}

#[cfg(target_os = "macos")]
pub fn is_letter(code: u32) -> bool {
    match &*MAC_LETTERS.read().unwrap() { Some(t) => code < 256 && t[code as usize], None => fixed_is_letter(code) }
}

pub fn spawn(c: Arc<Counters>) {
    let _ = COUNTERS.set(c);
    std::thread::Builder::new().name("lwc-input".into()).spawn(platform::run).ok();
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, KBDLLHOOKSTRUCT, MSG,
        WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_MOUSEHWHEEL, WM_MOUSEWHEEL, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    unsafe extern "system" fn kb(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 {
            // read vkCode only; flags (injected etc.) are not needed for counting
            let k = &*(l.0 as *const KBDLLHOOKSTRUCT);
            // VK_PROCESSKEY (IME composing): use the hardware scan code position instead of a translation
            let vk = if k.vkCode == 0xE5 { PROCESSKEY_BASE + k.scanCode } else { k.vkCode };
            match w.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => { if let Some(c) = COUNTERS.get() { with_down(|d| c.key_down(vk, d)); } }
                WM_KEYUP | WM_SYSKEYUP => { with_down(|d| d.remove(&vk)); }
                _ => {}
            }
        }
        CallNextHookEx(None, code, w, l)
    }
    unsafe extern "system" fn mouse(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 && matches!(w.0 as u32, WM_MOUSEWHEEL | WM_MOUSEHWHEEL) { if let Some(c) = COUNTERS.get() { c.wheel_tick(); } }
        CallNextHookEx(None, code, w, l)
    }

    pub fn run() {
        unsafe {
            let k = SetWindowsHookExW(WH_KEYBOARD_LL, Some(kb), Some(HINSTANCE::default()), 0);
            let m = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), Some(HINSTANCE::default()), 0);
            if let Err(e) = &k { if let Some(c) = COUNTERS.get() { c.fail(format!("keyboard hook failed: {e}")); } return; }
            if let Err(e) = &m { if let Some(c) = COUNTERS.get() { c.fail(format!("mouse hook failed: {e}")); } }
            // LL hooks are serviced by this thread's message loop
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() { let _ = TranslateMessage(&msg); DispatchMessageW(&msg); }
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::os::raw::c_char;
    use std::ptr::null;
    use x11::xlib;
    use x11::xrecord::*;

    const KEY_PRESS: u8 = 2;
    const KEY_RELEASE: u8 = 3;
    const BUTTON_PRESS: u8 = 4;

    unsafe extern "C" fn cb(_: *mut c_char, d: *mut XRecordInterceptData) {
        let data = &*d;
        if data.category == XRecordFromServer && !data.data.is_null() && data.data_len >= 1 {
            // xEvent header: byte 0 = type, byte 1 = detail (keycode / button). Nothing else is read.
            let ty = *data.data & 0x7f;
            let detail = *data.data.add(1) as u32;
            if let Some(c) = COUNTERS.get() {
                match ty {
                    KEY_PRESS => with_down(|d| c.key_down(detail, d)),
                    KEY_RELEASE => { with_down(|d| d.remove(&detail)); }
                    BUTTON_PRESS if (4..=7).contains(&detail) => c.wheel_tick(),
                    _ => {}
                }
            }
        }
        XRecordFreeData(d);
    }

    unsafe fn rebuild(d: *mut xlib::Display) {
        let (mut lo, mut hi) = (0, 0);
        xlib::XDisplayKeycodes(d, &mut lo, &mut hi);
        let pairs: Vec<(u32, u64)> = (lo.max(0)..=hi.min(255)).map(|kc| (kc as u32, xlib::XkbKeycodeToKeysym(d, kc as u8, 0, 0) as u64)).collect();
        let t = letters_from_keysyms(pairs);
        eprintln!("keymap: {} letter keycodes from XKB{}", t.map_or(0, |t| t.iter().filter(|b| **b).count()), if t.is_none() { " (using US fallback)" } else { "" });
        *XKB_LETTERS.write().unwrap() = t;
    }

    /// Watches keyboard mapping changes (core MappingNotify + XKB NewKeyboard/Map notify) and rebuilds the table.
    fn keymap_watcher() {
        unsafe {
            let d = xlib::XOpenDisplay(null());
            if d.is_null() { return; }
            let (mut op, mut ev, mut er, mut maj, mut min) = (0, 0, 0, 1, 0);
            let xkb = xlib::XkbQueryExtension(d, &mut op, &mut ev, &mut er, &mut maj, &mut min) != 0;
            if xkb { xlib::XkbSelectEvents(d, 0x100, 0b11, 0b11); } // XkbUseCoreKbd; NewKeyboardNotify | MapNotify
            rebuild(d);
            let mut e: xlib::XEvent = std::mem::zeroed();
            loop {
                xlib::XNextEvent(d, &mut e);
                let ty = e.get_type();
                if ty == xlib::MappingNotify { xlib::XRefreshKeyboardMapping(&mut e.mapping); rebuild(d); }
                else if xkb && ty == ev { rebuild(d); }
            }
        }
    }

    pub fn run() {
        std::thread::Builder::new().name("lwc-keymap".into()).spawn(keymap_watcher).ok();
        let fail = |m: &str| { if let Some(c) = COUNTERS.get() { c.fail(format!("input listener failed: {m}")); } };
        unsafe {
            let ctrl = xlib::XOpenDisplay(null());
            let data = xlib::XOpenDisplay(null());
            if ctrl.is_null() || data.is_null() { return fail("cannot open X display (Wayland-only session?)"); }
            let (mut maj, mut min) = (0, 0);
            if XRecordQueryVersion(ctrl, &mut maj, &mut min) == 0 { return fail("X RECORD extension unavailable"); }
            let range = XRecordAllocRange();
            (*range).device_events.first = KEY_PRESS;
            (*range).device_events.last = BUTTON_PRESS;
            let mut clients: XRecordClientSpec = XRecordAllClients;
            let mut r = range;
            let ctx = XRecordCreateContext(ctrl, 0, &mut clients, 1, &mut r, 1);
            if ctx == 0 { return fail("XRecordCreateContext failed"); }
            xlib::XSync(ctrl, 0);
            if XRecordEnableContext(data, ctx, Some(cb), std::ptr::null_mut()) == 0 { fail("XRecordEnableContext failed"); }
        }
    }
}

#[cfg(target_os = "macos")]
#[path = "macos_input.rs"]
mod platform;

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    const A: u32 = 38; // X keycode of the "A" position
    #[cfg(target_os = "linux")]
    const OTHERS: &[u32] = &[10, 19, 20, 21, 22, 23, 36, 50, 62, 37, 64, 65, 67, 79, 87, 90, 111, 119, 59, 60, 61, 47, 48, 34, 35, 51];
    #[cfg(windows)]
    const A: u32 = 0x41;
    #[cfg(windows)]
    const OTHERS: &[u32] = &[0x30, 0x39, 0x20, 0x0D, 0x08, 0x09, 0x2E, 0x10, 0xA0, 0x70, 0x26, 0x60, 0x6A, 0xBA, 0xBC];
    #[cfg(target_os = "macos")]
    const A: u32 = 0x00; // ANSI A
    #[cfg(target_os = "macos")]
    const OTHERS: &[u32] = &[0x12, 0x24, 0x30, 0x31, 0x33, 0x35, 0x36, 0x37, 0x38, 0x3A, 0x3B, 0x7B, 0x7C, 0x7E];

    #[test]
    fn letters_only() {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        { let n = (0..256).filter(|&c| is_letter(c)).count(); assert_eq!(n, 26); }
        #[cfg(windows)]
        { let n = (0..256).filter(|&c| is_letter(c)).count(); assert_eq!(n, 26); assert!(is_letter(PROCESSKEY_BASE + 0x1E)); assert!(!is_letter(PROCESSKEY_BASE + 0x02)); }
        assert!(is_letter(A));
        for &o in OTHERS { assert!(!is_letter(o), "code {o} must not count"); }
        assert_eq!((0..256).filter(|&s| scan_is_letter(s)).count(), 26);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn xkb_azerty_table() {
        // AZERTY: the US "q" position (24) yields 'a', US "a" (38) yields 'q', US "z" (52) yields 'w', US "m" (58) yields ','
        // and the US ";" position (47) yields 'm'.
        let mut pairs: Vec<(u32, u64)> = vec![];
        let row1 = "azertyuiop"; let row2 = "qsdfghjklm"; let row3 = "wxcvbn";
        for (i, c) in row1.chars().enumerate() { pairs.push((24 + i as u32, c as u64)); }
        for (i, c) in row2.chars().enumerate() { pairs.push((38 + i as u32, c as u64)); }
        for (i, c) in row3.chars().enumerate() { pairs.push((52 + i as u32, c as u64)); }
        pairs.push((58, 0x2c)); pairs.push((10, 0x26)); pairs.push((65, 0x20));
        let t = letters_from_keysyms(pairs).unwrap();
        assert_eq!(t.iter().filter(|b| **b).count(), 26);
        assert!(t[47] && !t[58] && !t[10] && !t[65]);
        // non-Latin / empty layout -> fallback
        assert!(letters_from_keysyms(vec![(24, 0x6c9)]).is_none());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn layout_table_counts_unshifted_letters_only() {
        let mut pairs: Vec<(u32, u32)> = Vec::new();
        for (i, kc) in ANSI_LETTERS.iter().enumerate() {
            pairs.push((*kc, b'a' as u32 + i as u32));
        }
        pairs.push((0x0C, b'a' as u32)); // physical Q produces a, still one letter key
        let t = letters_from_unshifted(pairs).unwrap();
        assert_eq!(t.iter().filter(|b| **b).count(), 26);
        assert!(t[0x0C] && !t[0x31] && !t[0x24]);
        assert!(letters_from_unshifted(vec![(0x0C, 0x6C9)]).is_none());
    }
    #[test]
    fn counting_and_repeat() {
        let c = Counters::default();
        let mut d = HashSet::new();
        c.key_down(OTHERS[0], &mut d);
        c.key_down(A, &mut d); c.key_down(A, &mut d); // auto-repeat
        d.remove(&A); c.key_down(A, &mut d);
        assert_eq!(c.keys.load(Ordering::Relaxed), 2);
    }
}
