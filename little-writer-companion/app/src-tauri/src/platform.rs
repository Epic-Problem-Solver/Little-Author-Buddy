//! Foreground window title/rect and media-playing detection. Titles only, never contents.
/// Foreground window. `title` stays in memory for distraction matching and is never serialized.
#[derive(Clone, Debug, serde::Serialize)]
pub struct Fg {
    pub id: u64,
    #[serde(skip)]
    pub title: String,
    pub x: i32, pub y: i32, pub w: i32, pub h: i32,
}

/// Live state of a tracked (hide-target) window.
#[derive(Clone, Debug, serde::Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Target { Ok { x: i32, y: i32, w: i32, h: i32 }, Minimized, Gone }

#[cfg(windows)]
pub fn foreground() -> Option<Fg> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowTextW};
    unsafe {
        let h = GetForegroundWindow();
        if h.0.is_null() { return None; }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(h, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let mut r = RECT::default();
        GetWindowRect(h, &mut r).ok()?;
        Some(Fg { id: h.0 as usize as u64, title, x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
    }
}

#[cfg(windows)]
pub fn target_rect(id: u64) -> Target {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, IsWindow, IsWindowVisible};
    unsafe {
        let h = HWND(id as usize as *mut core::ffi::c_void);
        if !IsWindow(Some(h)).as_bool() { return Target::Gone; }
        if IsIconic(h).as_bool() || !IsWindowVisible(h).as_bool() { return Target::Minimized; }
        let mut r = RECT::default();
        if GetWindowRect(h, &mut r).is_err() { return Target::Gone; }
        Target::Ok { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }
    }
}

#[cfg(windows)]
pub fn media_playing() -> bool {
    use windows::Media::Control::{GlobalSystemMediaTransportControlsSessionManager as M, GlobalSystemMediaTransportControlsSessionPlaybackStatus as S};
    let f = || -> windows::core::Result<bool> {
        let mgr = M::RequestAsync()?.get()?;
        let s = mgr.GetCurrentSession()?;
        Ok(s.GetPlaybackInfo()?.PlaybackStatus()? == S::Playing)
    };
    f().unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let o = std::process::Command::new(cmd).args(args).output().ok()?;
    if !o.status.success() { return None; }
    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
pub fn foreground() -> Option<Fg> {
    // X11 via xdotool if installed (optional runtime dependency)
    let id: u64 = run("xdotool", &["getactivewindow"])?.parse().ok()?;
    let ids = id.to_string();
    let title = run("xdotool", &["getwindowname", &ids])?;
    match target_rect(id) {
        Target::Ok { x, y, w, h } => Some(Fg { id, title, x, y, w, h }),
        _ => None,
    }
}

/// Parse `xwininfo -id` output (pure; unit-tested).
#[cfg(target_os = "linux")]
pub fn parse_xwininfo(out: &str) -> Target {
    let get = |k: &str| out.lines().find_map(|l| l.trim().strip_prefix(k)).and_then(|v| v.trim().parse::<i32>().ok());
    if out.contains("Map State: IsUnMapped") || out.contains("Map State: IsUnviewable") { return Target::Minimized; }
    match (get("Absolute upper-left X:"), get("Absolute upper-left Y:"), get("Width:"), get("Height:")) {
        (Some(x), Some(y), Some(w), Some(h)) => Target::Ok { x, y, w, h },
        _ => Target::Gone,
    }
}

/// Live rect of a window by id (xwininfo; exits non-zero when the window is gone).
#[cfg(target_os = "linux")]
pub fn target_rect(id: u64) -> Target {
    match run("xwininfo", &["-id", &id.to_string()]) { Some(o) => parse_xwininfo(&o), None => Target::Gone }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    #[test]
    fn xwininfo_parse() {
        let ok = "  Absolute upper-left X:  100\n  Absolute upper-left Y:  50\n  Width: 800\n  Height: 600\n  Map State: IsViewable\n";
        assert_eq!(parse_xwininfo(ok), Target::Ok { x: 100, y: 50, w: 800, h: 600 });
        assert_eq!(parse_xwininfo(&ok.replace("IsViewable", "IsUnMapped")), Target::Minimized);
        assert_eq!(parse_xwininfo("garbage"), Target::Gone);
    }
}

#[cfg(target_os = "linux")]
pub fn media_playing() -> bool {
    // MPRIS via playerctl if installed
    run("playerctl", &["status"]).map(|s| s == "Playing").unwrap_or(false)
}

/// Is a compositing manager running? Without one, the "transparent" overlay is drawn opaque.
#[cfg(windows)]
pub fn has_compositor() -> bool { true } // DWM composition is always on (Win8+)

#[cfg(target_os = "linux")]
pub fn has_compositor() -> bool {
    use x11::xlib;
    unsafe {
        let d = xlib::XOpenDisplay(std::ptr::null());
        if d.is_null() { return true; } // Wayland-only: the compositor is the display server
        let screen = xlib::XDefaultScreen(d);
        let name = std::ffi::CString::new(format!("_NET_WM_CM_S{screen}")).unwrap();
        let atom = xlib::XInternAtom(d, name.as_ptr(), 0);
        let owner = xlib::XGetSelectionOwner(d, atom);
        xlib::XCloseDisplay(d);
        owner != 0
    }
}

/// Cursor position in physical pixels, top-left origin. Only called while a sprint game is playing.
#[cfg(windows)]
pub fn cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut p = POINT::default();
        GetCursorPos(&mut p).ok()?;
        Some((p.x, p.y))
    }
}

#[cfg(target_os = "linux")]
pub fn cursor_pos() -> Option<(i32, i32)> {
    use x11::xlib;
    unsafe {
        let d = xlib::XOpenDisplay(std::ptr::null());
        if d.is_null() { return None; }
        let root = xlib::XDefaultRootWindow(d);
        let mut root_r: xlib::Window = 0;
        let mut child: xlib::Window = 0;
        let mut rx = 0i32;
        let mut ry = 0i32;
        let mut wx = 0i32;
        let mut wy = 0i32;
        let mut mask = 0u32;
        let ok = xlib::XQueryPointer(d, root, &mut root_r, &mut child, &mut rx, &mut ry, &mut wx, &mut wy, &mut mask);
        xlib::XCloseDisplay(d);
        if ok == 0 { None } else { Some((rx, ry)) }
    }
}

#[cfg(target_os = "macos")]
pub fn cursor_pos() -> Option<(i32, i32)> { macos_wm::cursor_pos() }

/// Cocoa's window position uses a bottom-left origin on the main display.
/// Quartz and the rest of this app use a top-left origin, y growing downward.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn cocoa_top(main_h: f64, cocoa_y: f64, height: f64) -> i32 {
    (main_h - cocoa_y - height).round() as i32
}

#[cfg(target_os = "macos")]
#[path = "macos_wm.rs"]
mod macos_wm;

#[cfg(target_os = "macos")]
pub fn foreground() -> Option<Fg> { macos_wm::foreground() }

#[cfg(target_os = "macos")]
pub fn target_rect(id: u64) -> Target { macos_wm::target_rect(id) }

#[cfg(target_os = "macos")]
pub fn media_playing() -> bool { macos_wm::media_playing() }

#[cfg(target_os = "macos")]
pub fn has_compositor() -> bool { true }

#[cfg(test)]
mod cocoa_tests {
    use super::cocoa_top;
    #[test]
    fn cocoa_origin_becomes_top_left() {
        assert_eq!(cocoa_top(1000.0, 100.0, 200.0), 700);
        assert_eq!(cocoa_top(900.0, 0.0, 100.0), 800);
        assert_eq!(cocoa_top(800.0, 800.0, 50.0), -50);
    }
}
