//! Tray, overlay, desk, settings, and onboarding windows.

use crate::home_geo;
use crate::input;
use crate::signals;
use crate::state::{self, AppState, MonitorRect};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

pub struct TrayItems { pub pause: MenuItem<tauri::Wry>, pub interact: MenuItem<tauri::Wry> }

/// Monitor rect for placement: (x, y, w, h, scale, primary), physical px.
pub type MonRect = (i32, i32, u32, u32, f64, bool);

/// Which side of its monitor the desk sits on, so it angles toward that monitor's centre.
/// `rect` is the home window (x, y, w, h). `mons` is (x, y, w, h). Off-screen falls back to the nearest monitor.
pub fn desk_side(rect: (i32, i32, u32, u32), mons: &[(i32, i32, u32, u32)]) -> &'static str {
    let (cx, cy) = (rect.0 as i64 + rect.2 as i64 / 2, rect.1 as i64 + rect.3 as i64 / 2);
    let dist = |m: &&(i32, i32, u32, u32)| {
        let dx = (m.0 as i64 - cx).max(0).max(cx - (m.0 as i64 + m.2 as i64));
        let dy = (m.1 as i64 - cy).max(0).max(cy - (m.1 as i64 + m.3 as i64));
        dx * dx + dy * dy
    };
    match mons.iter().min_by_key(dist) {
        Some(m) if cx >= m.0 as i64 + m.2 as i64 / 2 => "right",
        Some(_) => "left",
        None => "right",
    }
}

/// Place the home window using its real outer size. A saved position is clamped onto the monitor
/// it mostly sits on. No saved position goes to the bottom-right of the primary monitor.
pub fn place_home(saved: Option<(i32, i32)>, size: (u32, u32), mons: &[MonRect]) -> Option<(i32, i32)> {
    let (w, h) = (size.0 as i64, size.1 as i64);
    let clamp_on = |m: &MonRect, x: i64, y: i64| {
        let (mx, my, mw, mh) = (m.0 as i64, m.1 as i64, m.2 as i64, m.3 as i64);
        ((x.min(mx + mw - w)).max(mx) as i32, (y.min(my + mh - h)).max(my) as i32)
    };
    if let Some((x, y)) = saved {
        let (cx, cy) = (x as i64 + w / 2, y as i64 + h / 2);
        let near = mons.iter().min_by_key(|m| {
            let dx = (m.0 as i64 - cx).max(0).max(cx - (m.0 as i64 + m.2 as i64));
            let dy = (m.1 as i64 - cy).max(0).max(cy - (m.1 as i64 + m.3 as i64));
            dx * dx + dy * dy
        })?;
        return Some(clamp_on(near, x as i64, y as i64));
    }
    let m = mons.iter().find(|m| m.5).or(mons.first())?;
    Some(clamp_on(m, m.0 as i64 + m.2 as i64 - w - (20.0 * m.4) as i64, m.1 as i64 + m.3 as i64 - h - (60.0 * m.4) as i64))
}

pub fn home_position(app: &AppHandle, saved: Option<(i32, i32)>, size: (u32, u32)) -> Option<(i32, i32)> {
    let w = app.get_webview_window("overlay")?;
    let prim = w.primary_monitor().ok().flatten().map(|m| (m.position().x, m.position().y));
    let mons: Vec<MonRect> = w.available_monitors().ok()?.iter().map(|m| (
        m.position().x, m.position().y, m.size().width, m.size().height,
        m.scale_factor(), prim == Some((m.position().x, m.position().y)),
    )).collect();
    place_home(saved, size, &mons)
}

/// Re-read the home window's real outer size and clamp it on screen. Main thread only.
pub fn reclamp_home(app: &AppHandle) {
    let Some(home) = app.get_webview_window("home") else { return };
    let (Ok(z), Ok(p)) = (home.outer_size(), home.outer_position()) else { return };
    home_geo::sized(z.width, z.height);
    if let Some((x, y)) = home_position(app, Some((p.x, p.y)), (z.width, z.height)) {
        if (x, y) != (p.x, p.y) { let _ = home.set_position(PhysicalPosition::new(x, y)); }
        home_geo::moved(x, y);
    }
}

/// Size the overlay to the bounding box of every monitor, in physical pixels.
pub fn fit_overlay(app: &AppHandle) -> ((i32, i32), Vec<MonitorRect>) {
    let Some(w) = app.get_webview_window("overlay") else { return ((0, 0), vec![]) };
    let prim = w.primary_monitor().ok().flatten().map(|m| (m.position().x, m.position().y));
    let mons: Vec<MonitorRect> = w.available_monitors().unwrap_or_default().iter().map(|m| MonitorRect {
        x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height, scale: m.scale_factor(),
        primary: prim == Some((m.position().x, m.position().y)),
    }).collect();
    if mons.is_empty() { return ((0, 0), mons) }
    *signals::REAL_MONS.lock().unwrap() = mons.iter().map(|m| (m.x, m.y, m.w, m.h)).collect();
    let mons = if *signals::COMPOSITOR.get().unwrap_or(&true) { mons } else {
        let p = mons.iter().find(|m| m.primary).unwrap_or(&mons[0]).clone();
        let (bw, bh) = ((460.0 * p.scale) as u32, (380.0 * p.scale) as u32);
        vec![MonitorRect { x: p.x + p.w as i32 - bw as i32, y: p.y + p.h as i32 - bh as i32, w: bw, h: bh, scale: p.scale, primary: true }]
    };
    let x0 = mons.iter().map(|m| m.x).min().unwrap();
    let y0 = mons.iter().map(|m| m.y).min().unwrap();
    let x1 = mons.iter().map(|m| m.x + m.w as i32).max().unwrap();
    let y1 = mons.iter().map(|m| m.y + m.h as i32).max().unwrap();
    if w.outer_position().map(|p| (p.x, p.y)).ok() != Some((x0, y0)) { let _ = w.set_position(PhysicalPosition::new(x0, y0)); }
    if w.inner_size().map(|s| (s.width, s.height)).ok() != Some(((x1 - x0) as u32, (y1 - y0) as u32)) {
        let _ = w.set_size(PhysicalSize::new((x1 - x0) as u32, (y1 - y0) as u32));
    }
    ((x0, y0), mons)
}

pub fn do_toggle(app: &AppHandle, c: &input::Counters) -> bool {
    let p = !c.paused.load(Ordering::Relaxed);
    c.paused.store(p, Ordering::Relaxed);
    if let Some(t) = app.try_state::<TrayItems>() {
        let _ = t.pause.set_text(if p { "Resume listening" } else { "Pause listening" });
    }
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(if p { "Little Author — Paused" } else { "Little Author — Listening" }));
    }
    p
}

/// Let the overlay take clicks, then revert so the desktop is not blocked for long.
pub fn set_interactive(app: &AppHandle, st: &AppState, on: bool) {
    st.lock().unwrap().interactive_until = if on { state::now_ms() + 30_000 } else { 0 };
    if let Some(w) = app.get_webview_window("overlay") { let _ = w.set_ignore_cursor_events(!on); }
    if let Some(t) = app.try_state::<TrayItems>() {
        let _ = t.interact.set_text(if on { "Make click-through again" } else { "Interact with companion (30 s)" });
    }
}

pub fn quit(app: &AppHandle) {
    if let Some(st) = app.try_state::<AppState>() { st.lock().unwrap().save(); }
    app.exit(0);
}

pub fn initial_tab() -> String { signals::SETTINGS_TAB.lock().unwrap().clone() }

/// Queue window work onto the main thread. The caller does not block.
pub fn open_window(app: &AppHandle, tab: &str) {
    let tab: String = tab.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    *signals::SETTINGS_TAB.lock().unwrap() = tab.clone();
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = h.get_webview_window("settings") {
            let _ = h.emit_to("settings", "show-tab", tab);
            let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus();
            return;
        }
        let _ = tauri::WebviewWindowBuilder::new(&h, "settings", tauri::WebviewUrl::App("settings.html".into()))
            .title("Little Author Buddy").inner_size(580.0, 680.0).content_protected(false).build();
    });
}

pub fn open_onboarding(app: &AppHandle) {
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = h.get_webview_window("onboarding") { let _ = w.show(); let _ = w.set_focus(); return; }
        let _ = tauri::WebviewWindowBuilder::new(&h, "onboarding", tauri::WebviewUrl::App("onboarding.html".into()))
            .title("Welcome to Little Author").inner_size(480.0, 600.0).resizable(false).center()
            .always_on_top(true).content_protected(false).build();
    });
}

pub fn install_tray(app: &AppHandle, st: &AppState, counters: &Arc<input::Counters>) -> tauri::Result<()> {
    let pause = MenuItem::with_id(app, "pause", "Pause listening", true, None::<&str>)?;
    let interact = MenuItem::with_id(app, "interact", "Interact with companion (30 s)", true, None::<&str>)?;
    let projects = MenuItem::with_id(app, "projects", "Projects…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let journal = MenuItem::with_id(app, "journal", "Letter journal…", true, None::<&str>)?;
    let privacy = MenuItem::with_id(app, "privacy", "Privacy…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&pause, &interact, &projects, &settings, &journal, &privacy, &sep, &quit_item])?;
    app.manage(TrayItems { pause, interact });
    let st_q = st.clone();
    let c_t = counters.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Little Author — Listening")
        .menu(&menu)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "pause" => { do_toggle(app, &c_t); }
            "interact" => { let on = st_q.lock().unwrap().interactive_until == 0; set_interactive(app, &st_q, on); }
            "settings" | "journal" | "projects" | "privacy" => open_window(app, ev.id().as_ref()),
            "quit" => quit(app),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Open or close the small window that catches a click on Buddy during tag.
/// The overlay stays click-through, so the rest of the desktop still receives clicks.
pub fn set_tag_window(app: &AppHandle, on: bool) {
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        if on {
            if h.get_webview_window("taghit").is_some() { return; }
            let _ = tauri::WebviewWindowBuilder::new(&h, "taghit", tauri::WebviewUrl::App("hit.html".into()))
                .title("Little Author — Tag")
                .inner_size(80.0, 80.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .background_color(tauri::window::Color(0, 0, 0, 0))
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)
                .focused(false)
                .visible(true)
                .content_protected(false)
                .build();
        } else if let Some(w) = h.get_webview_window("taghit") {
            let _ = w.close();
        }
    });
}

pub fn place_tag_window(app: &AppHandle, x: i32, y: i32, w: u32, h: u32) {
    let hnd = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(win) = hnd.get_webview_window("taghit") else { return };
        let _ = win.set_position(PhysicalPosition::new(x, y));
        let _ = win.set_size(PhysicalSize::new(w.max(8), h.max(8)));
    });
}

/// Sample the cursor only during play, and keep the tag catcher in step with the session.
pub fn sync_game_chrome(app: &AppHandle, play: bool, tag: bool) {
    signals::GAME_CURSOR.store(play, Ordering::Relaxed);
    if signals::TAG_HIT.swap(tag, Ordering::Relaxed) != tag { set_tag_window(app, tag); }
}

pub fn show_overlay(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.show();
        let _ = w.set_ignore_cursor_events(true);
    }
}

pub fn create_home(app: &AppHandle, saved: Option<(i32, i32)>) -> tauri::Result<()> {
    let (hw, hh) = (200.0, 200.0);
    let home = tauri::WebviewWindowBuilder::new(app, "home", tauri::WebviewUrl::App("home.html".into()))
        .title("Little Author — Home").inner_size(hw, hh).resizable(false).decorations(false)
        .transparent(true).background_color(tauri::window::Color(0, 0, 0, 0)).always_on_top(true).skip_taskbar(true)
        .shadow(false).visible(false).content_protected(false).build()?;
    let size = home.outer_size().map(|z| (z.width, z.height)).unwrap_or(((hw * 1.0) as u32, (hh * 1.0) as u32));
    home_geo::sized(size.0, size.1);
    home_geo::scaled(home.scale_factor().unwrap_or(1.0));
    if let Some((x, y)) = home_position(app, saved, size) { let _ = home.set_position(PhysicalPosition::new(x, y)); home_geo::moved(x, y); }
    let _ = home.show();
    if let Ok(z) = home.outer_size() {
        if (z.width, z.height) != size {
            home_geo::sized(z.width, z.height);
            let cur = home.outer_position().ok().map(|p| (p.x, p.y)).or(saved);
            if let Some((x, y)) = home_position(app, cur, (z.width, z.height)) { let _ = home.set_position(PhysicalPosition::new(x, y)); home_geo::moved(x, y); }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let _ = home.set_focus();
        let h = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2500));
            let h2 = h.clone();
            let _ = h.run_on_main_thread(move || {
                if let Some(w) = h2.get_webview_window("home") { let _ = w.set_focus(); }
                if let Some(w) = h2.get_webview_window("onboarding") { let _ = w.set_focus(); }
            });
        });
    }
    if let Ok(p) = home.outer_position() { home_geo::moved(p.x, p.y); }
    let rh = app.clone();
    home.on_window_event(move |ev| match ev {
        tauri::WindowEvent::Moved(p) => home_geo::moved(p.x, p.y),
        tauri::WindowEvent::Resized(z) => {
            home_geo::sized(z.width, z.height);
            if !signals::HOME_RESIZED_ONCE.swap(true, Ordering::Relaxed) {
                let h = rh.clone(); let h2 = rh.clone();
                let _ = h.run_on_main_thread(move || reclamp_home(&h2));
            }
        }
        tauri::WindowEvent::ScaleFactorChanged { scale_factor, .. } => home_geo::scaled(*scale_factor),
        _ => {}
    });
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || reclamp_home(&h2));
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_clamped_with_real_size() {
        let m = [(0, 0, 1920, 1080, 1.0, true)];
        let (x, y) = place_home(None, (200, 200), &m).unwrap();
        assert!(y + 200 <= 1080 && x + 200 <= 1920, "{x},{y}");
        assert_eq!(place_home(Some((100, 950)), (200, 200), &m), Some((100, 880)));
        assert_eq!(place_home(Some((1900, -50)), (200, 200), &m), Some((1720, 0)));
        let m2 = [(0, 0, 1920, 1080, 1.0, true), (1920, 0, 2560, 1440, 1.5, false)];
        assert_eq!(place_home(Some((4400, 1300)), (300, 300), &m2), Some((4180, 1140)));
        assert_eq!(place_home(Some((500, 500)), (200, 200), &m2), Some((500, 500)));
    }

    #[test]
    fn desk_faces_its_monitor_centre() {
        let m = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        assert_eq!(desk_side((1700, 880, 200, 200), &m), "right");
        assert_eq!(desk_side((40, 880, 200, 200), &m), "left");
        assert_eq!(desk_side((2000, 100, 200, 200), &m), "left");
        assert_eq!(desk_side((4300, 1200, 200, 200), &m), "right");
        assert_eq!(desk_side((-500, 500, 200, 200), &m), "left");
    }
}
