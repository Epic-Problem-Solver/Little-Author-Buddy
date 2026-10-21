//! Focused-window title and rectangle, plus whether Now Playing is active.
//! Titles stay in the returned struct for distraction matching. They are not logged.
//! Now Playing contributes only a playing/not-playing flag.

use super::{cocoa_top, Fg, Target};
use block::ConcreteBlock;
use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use objc::runtime::{Class, Object};
use objc::{msg_send, sel, sel_impl};
use std::ffi::{CStr, CString, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;
use std::time::Duration;

#[repr(C)]
struct CGPoint { x: f64, y: f64 }
#[repr(C)]
struct CGSize { width: f64, height: f64 }
#[repr(C)]
struct CGRect { origin: CGPoint, size: CGSize }

#[link(name = "System", kind = "dylib")]
extern "C" {
    fn dispatch_get_global_queue(identifier: isize, flags: usize) -> *mut c_void;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> *const c_void;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    fn CGEventCreate(source: *mut c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// Quartz global display coordinates, origin at the top-left.
pub fn cursor_pos() -> Option<(i32, i32)> {
    unsafe {
        let event = CGEventCreate(std::ptr::null_mut());
        if event.is_null() { return None; }
        let p = CGEventGetLocation(event);
        CFRelease(event as *const c_void);
        Some((p.x.round() as i32, p.y.round() as i32))
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementCopyAttributeValue(element: *mut c_void, attribute: CFStringRef, value: *mut *const c_void) -> i32;
    fn AXValueGetValue(value: *const c_void, kind: u32, out: *mut c_void) -> u8;
    fn _AXUIElementGetWindow(element: *mut c_void, id: *mut u32) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFGetTypeID(cf: *const c_void) -> usize;
    fn CFDictionaryGetValue(dict: *const c_void, key: CFStringRef) -> *const c_void;
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFNumberGetValue(number: *const c_void, kind: isize, out: *mut c_void) -> u8;
    fn CFDictionaryGetTypeID() -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFBooleanGetValue(value: *const c_void) -> u8;
}

struct Pool(*mut Object);
impl Pool {
    fn new() -> Option<Self> {
        unsafe {
            let cls = Class::get("NSAutoreleasePool")?;
            let pool: *mut Object = msg_send![cls, new];
            if pool.is_null() { None } else { Some(Pool(pool)) }
        }
    }
}
impl Drop for Pool {
    fn drop(&mut self) { unsafe { let _: () = msg_send![self.0, drain]; } }
}

fn frontmost() -> Option<(i32, String)> {
    unsafe {
        let cls = Class::get("NSWorkspace")?;
        let ws: *mut Object = msg_send![cls, sharedWorkspace];
        if ws.is_null() { return None; }
        let app: *mut Object = msg_send![ws, frontmostApplication];
        if app.is_null() { return None; }
        let pid: i32 = msg_send![app, processIdentifier];
        if pid <= 0 || pid as u32 == std::process::id() { return None; }
        let ns: *mut Object = msg_send![app, localizedName];
        let name = if ns.is_null() { String::new() } else {
            let p: *const i8 = msg_send![ns, UTF8String];
            if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
        };
        Some((pid, name))
    }
}

fn copy_value(element: *mut c_void, attr: &str) -> Option<*const c_void> {
    let key = CFString::new(attr);
    let mut value: *const c_void = std::ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value) };
    if err != 0 || value.is_null() { None } else { Some(value) }
}

fn owned_string(value: *const c_void) -> Option<String> {
    unsafe {
        if CFGetTypeID(value) != CFStringGetTypeID() { CFRelease(value); return None; }
        let text = CFString::wrap_under_create_rule(value as _).to_string();
        let text: String = text.chars().take(512).collect();
        if text.is_empty() { None } else { Some(text) }
    }
}

fn ax_string(element: *const c_void, attr: &str) -> Option<String> {
    owned_string(copy_value(element as *mut c_void, attr)?)
}

fn ax_point_size(element: *const c_void) -> Option<(f64, f64, f64, f64)> {
    let pos = copy_value(element as *mut c_void, "AXPosition")?;
    let Some(size) = copy_value(element as *mut c_void, "AXSize") else { unsafe { CFRelease(pos); } return None; };
    let mut point = CGPoint { x: 0.0, y: 0.0 };
    let mut sz = CGSize { width: 0.0, height: 0.0 };
    let ok_p = unsafe { AXValueGetValue(pos, 1, &mut point as *mut CGPoint as *mut c_void) };
    let ok_s = unsafe { AXValueGetValue(size, 2, &mut sz as *mut CGSize as *mut c_void) };
    unsafe { CFRelease(pos); CFRelease(size); }
    if ok_p == 0 || ok_s == 0 { None } else { Some((point.x, point.y, sz.width, sz.height)) }
}

fn window_id(element: *const c_void) -> Option<u32> {
    let mut id = 0u32;
    let err = unsafe { _AXUIElementGetWindow(element as *mut c_void, &mut id) };
    if err == 0 && id != 0 { Some(id) } else { None }
}

fn lookup(dict: *const c_void, key: &str) -> *const c_void {
    let k = CFString::new(key);
    unsafe { CFDictionaryGetValue(dict, k.as_concrete_TypeRef()) }
}

fn as_f64(value: *const c_void) -> Option<f64> {
    if value.is_null() { return None; }
    unsafe {
        if CFGetTypeID(value) != CFNumberGetTypeID() { return None; }
        let mut out = 0f64;
        if CFNumberGetValue(value, 6, &mut out as *mut f64 as *mut c_void) != 0 { return Some(out); }
        let mut i = 0i64;
        if CFNumberGetValue(value, 4, &mut i as *mut i64 as *mut c_void) != 0 { return Some(i as f64); }
        None
    }
}

fn as_bool(value: *const c_void) -> Option<bool> {
    if value.is_null() { return None; }
    unsafe {
        if CFGetTypeID(value) != CFBooleanGetTypeID() { return None; }
        Some(CFBooleanGetValue(value) != 0)
    }
}

struct Geom { x: i32, y: i32, w: i32, h: i32, onscreen: bool }

fn geom_of(id: u32) -> Option<Geom> {
    let list = unsafe { CGWindowListCopyWindowInfo(0, 0) };
    if list.is_null() { return None; }
    let mut found = None;
    unsafe {
        if CFGetTypeID(list) == CFArrayGetTypeID() {
            let n = CFArrayGetCount(list);
            for i in 0..n {
                let item = CFArrayGetValueAtIndex(list, i);
                if item.is_null() || CFGetTypeID(item) != CFDictionaryGetTypeID() { continue; }
                let Some(num) = as_f64(lookup(item, "kCGWindowNumber")) else { continue };
                if num as u32 != id { continue; }
                let bounds = lookup(item, "kCGWindowBounds");
                if bounds.is_null() || CFGetTypeID(bounds) != CFDictionaryGetTypeID() { continue; }
                let (Some(x), Some(y), Some(w), Some(h)) = (
                    as_f64(lookup(bounds, "X")), as_f64(lookup(bounds, "Y")),
                    as_f64(lookup(bounds, "Width")), as_f64(lookup(bounds, "Height")),
                ) else { continue };
                let onscreen = as_bool(lookup(item, "kCGWindowIsOnscreen")).unwrap_or(false);
                found = Some(Geom { x: x.round() as i32, y: y.round() as i32, w: w.round() as i32, h: h.round() as i32, onscreen });
                break;
            }
        }
        CFRelease(list);
    }
    found
}

fn main_height() -> f64 {
    let b = unsafe { CGDisplayBounds(CGMainDisplayID()) };
    b.size.height
}

pub fn foreground() -> Option<Fg> {
    let _pool = Pool::new()?;
    let (pid, app_name) = frontmost()?;
    let app = unsafe { AXUIElementCreateApplication(pid) };
    if app.is_null() { return None; }
    let Some(window) = copy_value(app, "AXFocusedWindow") else {
        unsafe { CFRelease(app); }
        return None;
    };
    unsafe { CFRelease(app); }
    let title = ax_string(window, "AXTitle").unwrap_or(app_name);
    let id = window_id(window).unwrap_or(0) as u64;
    let rect = if id != 0 { geom_of(id as u32).map(|g| (g.x, g.y, g.w, g.h)) } else { None };
    let (x, y, w, h) = if let Some(r) = rect { r } else if let Some((cx, cy, ww, hh)) = ax_point_size(window) {
        (cx.round() as i32, cocoa_top(main_height(), cy, hh), ww.round() as i32, hh.round() as i32)
    } else {
        unsafe { CFRelease(window); }
        return None;
    };
    unsafe { CFRelease(window); }
    if w <= 0 || h <= 0 { return None; }
    Some(Fg { id, title, x, y, w, h })
}

pub fn target_rect(id: u64) -> Target {
    if id == 0 || id > u32::MAX as u64 { return Target::Gone; }
    match geom_of(id as u32) {
        Some(g) if g.onscreen && g.w > 0 && g.h > 0 => Target::Ok { x: g.x, y: g.y, w: g.w, h: g.h },
        Some(_) => Target::Minimized,
        None => Target::Gone,
    }
}

static PLAYING: AtomicBool = AtomicBool::new(false);
static MEDIA: Once = Once::new();

pub fn media_playing() -> bool {
    MEDIA.call_once(|| { let _ = std::thread::Builder::new().name("lwc-media".into()).spawn(watch_media); });
    PLAYING.load(Ordering::Relaxed)
}

fn watch_media() {
    let path = CString::new("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote").unwrap();
    let handle = unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_LAZY) };
    if handle.is_null() { eprintln!("media detection unavailable"); return; }
    let sym_name = CString::new("MRMediaRemoteGetNowPlayingApplicationIsPlaying").unwrap();
    let sym = unsafe { libc::dlsym(handle, sym_name.as_ptr()) };
    if sym.is_null() { eprintln!("media detection unavailable"); return; }
    type IsPlaying = unsafe extern "C" fn(*mut c_void, *mut c_void);
    let ask: IsPlaying = unsafe { std::mem::transmute(sym) };
    let block = ConcreteBlock::new(|playing: u8| { PLAYING.store(playing != 0, Ordering::Relaxed); });
    let block = Box::leak(Box::new(block.copy()));
    let ptr = (&**block) as *const _ as *mut c_void;
    loop {
        let queue = unsafe { dispatch_get_global_queue(0, 0) };
        unsafe { ask(queue, ptr); }
        std::thread::sleep(Duration::from_secs(2));
    }
}
