//! Key and scroll tap. Keycodes are classified and discarded.
//! The unshifted character used to build the layout table is never stored or logged.
//! Golden Gate 27.2 still returns a listen-only port after it clears key-down and key-up,
//! so a port is kept only when those bits remain. Otherwise an active tap is used and
//! every event is returned unchanged. The tap is attached to the main run loop, which is
//! where Golden Gate delivers keystrokes for an AppKit process.

use super::{install_layout, with_down, COUNTERS};
use core_foundation::base::{CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::mach_port::{CFMachPort, CFMachPortRef};
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_foundation::string::{CFString, CFStringRef};
use std::ffi::c_void;
use std::sync::atomic::{AtomicPtr, Ordering};

static TAP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

const KEY_DOWN: u32 = 10;
const KEY_UP: u32 = 11;
const SCROLL: u32 = 22;
const TAP_DISABLED_TIMEOUT: u32 = 0xFFFF_FFFE;
const TAP_DISABLED_USER: u32 = 0xFFFF_FFFF;
const KEYCODE_FIELD: u32 = 9; // kCGKeyboardEventKeycode

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32, place: u32, options: u32, events: u64,
        callback: unsafe extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void,
        user: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventGetIntegerValueField(event: *mut c_void, field: u32) -> i64;
    fn CGEventGetType(event: *mut c_void) -> u32;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: u8);
    fn CGRequestListenEventAccess() -> u8;
    fn CGPreflightListenEventAccess() -> u8;
    fn CGGetEventTapList(max_number: u32, list: *mut CGEventTapInformation, count: *mut u32) -> i32;
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGEventTapInformation {
    _event_tap_id: u32,
    tap_point: u32,
    options: u32,
    events_of_interest: u64,
    tapping_process: i32,
    _process_being_tapped: i32,
    _enabled: u8,
    _min_usec_latency: f32,
    _avg_usec_latency: f32,
    _max_usec_latency: f32,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> u8;
}

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn UCKeyTranslate(
        layout: *const u8, virtual_key: u16, action: u16, modifiers: u32, keyboard_type: u32,
        options: u32, dead_key: *mut u32, max_len: usize, actual_len: *mut usize, out: *mut u16,
    ) -> i32;
    fn LMGetKbdType() -> u8;
    fn TISCopyCurrentKeyboardLayoutInputSource() -> *mut c_void;
    fn TISCopyCurrentKeyboardInputSource() -> *mut c_void;
    fn TISGetInputSourceProperty(source: *mut c_void, key: CFStringRef) -> *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFGetTypeID(cf: *const c_void) -> usize;
    fn CFDataGetTypeID() -> usize;
    fn CFNotificationCenterGetDistributedCenter() -> *mut c_void;
    fn CFNotificationCenterAddObserver(
        center: *mut c_void, observer: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_void, *const c_void, *const c_void),
        name: CFStringRef, object: *const c_void, suspension: isize,
    );
}

fn fail(msg: &str) {
    if let Some(c) = COUNTERS.get() { c.fail(msg.to_string()); }
}

fn request_access() {
    unsafe {
        CGRequestListenEventAccess();
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), CFBoolean::true_value().as_CFType())]);
        AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as CFTypeRef);
    }
}

fn layout_bytes() -> Option<Vec<u8>> {
    unsafe fn from(source: *mut c_void) -> Option<Vec<u8>> {
        if source.is_null() { return None; }
        let key = CFString::new("TISPropertyUnicodeKeyLayoutData");
        let data = TISGetInputSourceProperty(source, key.as_concrete_TypeRef());
        let bytes = if !data.is_null() && CFGetTypeID(data) == CFDataGetTypeID() {
            let len = CFDataGetLength(data);
            let ptr = CFDataGetBytePtr(data);
            if len > 0 && !ptr.is_null() { Some(std::slice::from_raw_parts(ptr, len as usize).to_vec()) } else { None }
        } else { None };
        CFRelease(source);
        bytes
    }
    unsafe {
        if let Some(b) = from(TISCopyCurrentKeyboardLayoutInputSource()) { return Some(b); }
        from(TISCopyCurrentKeyboardInputSource())
    }
}

fn unshifted_pairs() -> Vec<(u32, u32)> {
    let Some(layout) = layout_bytes() else { return Vec::new() };
    let kbd = unsafe { LMGetKbdType() } as u32;
    let mut pairs = Vec::new();
    for code in 0..128u16 {
        let mut dead = 0u32;
        let mut buf = [0u16; 4];
        let mut n = 0usize;
        let status = unsafe {
            UCKeyTranslate(layout.as_ptr(), code, 3, 0, kbd, 1, &mut dead, buf.len(), &mut n, buf.as_mut_ptr())
        };
        if status == 0 && n > 0 { pairs.push((code as u32, buf[0] as u32)); }
    }
    pairs
}

fn rebuild_layout() {
    let pairs = unshifted_pairs();
    let n = pairs.iter().filter(|(_, ch)| *ch < 128 && (*ch as u8).is_ascii_alphabetic()).count();
    install_layout(pairs);
    if n >= 20 { eprintln!("keymap: {n} letter keycodes from the macOS layout"); }
    else { eprintln!("keymap: macOS layout has {n} Latin letters (using ANSI fallback)"); }
}

unsafe extern "C" fn layout_changed(_: *mut c_void, _: *mut c_void, _: *const c_void, _: *const c_void, _: *const c_void) {
    rebuild_layout();
}

fn event_type(ty: u32, event: *mut c_void) -> u32 {
    if matches!(ty, KEY_DOWN | KEY_UP | SCROLL | TAP_DISABLED_TIMEOUT | TAP_DISABLED_USER) { return ty; }
    if event.is_null() { return ty; }
    // Golden Gate can pass a null type argument for a real key event. The event's own type is the one to count.
    let real = unsafe { CGEventGetType(event) };
    if matches!(real, KEY_DOWN | KEY_UP | SCROLL) { real } else { ty }
}

/// Mask of this process's tap at `location` with `options`, if the tap list names one.
/// `Err` means the list could not be read. `Ok(None)` means that tap is not listed.
fn listed_key_mask(location: u32, options: u32) -> Result<Option<u64>, ()> {
    let mut count = 0u32;
    if unsafe { CGGetEventTapList(0, std::ptr::null_mut(), &mut count) } != 0 { return Err(()); }
    if count == 0 || count > 64 { return Ok(None); }
    let mut taps = vec![unsafe { std::mem::zeroed::<CGEventTapInformation>() }; count as usize];
    let mut got = 0u32;
    if unsafe { CGGetEventTapList(count, taps.as_mut_ptr(), &mut got) } != 0 { return Err(()); }
    let pid = std::process::id() as i32;
    let mut found = false;
    let mut best = 0u64;
    let bits = (1u64 << KEY_DOWN) | (1u64 << KEY_UP);
    for tap in taps.iter().take(got as usize) {
        if tap.tapping_process != pid || tap.tap_point != location || tap.options != options { continue; }
        found = true;
        if tap.events_of_interest & bits == bits { best = tap.events_of_interest; }
    }
    if !found { Ok(None) } else { Ok(Some(best)) }
}

unsafe extern "C" fn tap_cb(_proxy: *mut c_void, ty: u32, event: *mut c_void, _user: *mut c_void) -> *mut c_void {
    let ty = event_type(ty, event);
    if ty == TAP_DISABLED_TIMEOUT || ty == TAP_DISABLED_USER {
        let tap = TAP.load(Ordering::Relaxed) as CFMachPortRef;
        if !tap.is_null() { CGEventTapEnable(tap, 1); }
        return event;
    }
    if event.is_null() { return event; }
    if ty == SCROLL {
        if let Some(c) = COUNTERS.get() { c.wheel_tick(); }
        return event;
    }
    if ty == KEY_DOWN || ty == KEY_UP {
        let code = CGEventGetIntegerValueField(event, KEYCODE_FIELD);
        if (0..=255).contains(&code) {
            let code = code as u32;
            // Always returned, including from an active tap, so the key still reaches the document.
            match ty {
                KEY_DOWN => { if let Some(c) = COUNTERS.get() { with_down(|d| { let _ = c.key_down(code, d); }); } }
                KEY_UP => { with_down(|d| { d.remove(&code); }); }
                _ => {}
            }
        }
    }
    event
}

pub fn run() {
    request_access();
    rebuild_layout();
    let name = CFString::new("com.apple.Carbon.TISNotifySelectedKeyboardInputSourceChanged");
    unsafe {
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDistributedCenter(), std::ptr::null_mut(), layout_changed,
            name.as_concrete_TypeRef(), std::ptr::null(), 4,
        );
    }
    let mask = (1u64 << KEY_DOWN) | (1u64 << KEY_UP) | (1u64 << SCROLL);
    let listen = unsafe { CGPreflightListenEventAccess() != 0 };
    let mut chosen: CFMachPortRef = std::ptr::null_mut();
    for &(location, options) in super::mac_tap_attempts(listen) {
        // place 0 is head insert. The callback returns the event either way.
        let raw = unsafe { CGEventTapCreate(location, 0, options, mask, tap_cb, std::ptr::null_mut()) };
        if raw.is_null() { continue; }
        unsafe { CGEventTapEnable(raw, 1); }
        let counts = super::mac_tap_mask_counts(listed_key_mask(location, options).unwrap_or(None));
        if counts {
            chosen = raw;
            break;
        }
        unsafe { CFRelease(raw as *const c_void); }
    }
    if chosen.is_null() {
        fail("Keystroke counting needs permission. Enable Little Author Buddy in System Settings, Privacy & Security, under Input Monitoring or Accessibility, then restart.");
        return;
    }
    TAP.store(chosen as *mut c_void, Ordering::Relaxed);
    let port = unsafe { CFMachPort::wrap_under_create_rule(chosen) };
    let source = match port.create_runloop_source(0) {
        Ok(s) => s,
        Err(()) => {
            TAP.store(std::ptr::null_mut(), Ordering::Relaxed);
            fail("input listener failed: no run-loop source");
            return;
        }
    };
    // The main run loop is already running. A private thread's loop does not receive
    // Golden Gate keystrokes. This thread stays in its own loop for layout notifications.
    CFRunLoop::get_main().add_source(&source, unsafe { kCFRunLoopCommonModes });
    std::mem::forget(port);
    std::mem::forget(source);
    CFRunLoop::run_current();
}
