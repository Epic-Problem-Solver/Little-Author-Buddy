//! Tray, overlay, desk, settings, onboarding, and the Events test window.

use crate::focus;
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

/// Work area when one was reported. An empty report falls back to the full monitor.
pub fn usable_rect(full: (i32, i32, u32, u32), work: (i32, i32, u32, u32)) -> (i32, i32, u32, u32) {
    if work.2 > 0 && work.3 > 0 { work } else { full }
}

fn rect_span(rects: &[(i32, i32, u32, u32)]) -> Option<(i32, i32, u32, u32)> {
    if rects.is_empty() { return None; }
    let mut x0 = i64::MAX;
    let mut y0 = i64::MAX;
    let mut x1 = i64::MIN;
    let mut y1 = i64::MIN;
    for r in rects {
        x0 = x0.min(r.0 as i64);
        y0 = y0.min(r.1 as i64);
        x1 = x1.max(r.0 as i64 + r.2 as i64);
        y1 = y1.max(r.1 as i64 + r.3 as i64);
    }
    let (w, h) = (x1 - x0, y1 - y0);
    if w <= 0 || h <= 0 || w > u32::MAX as i64 || h > u32::MAX as i64 { return None; }
    if x0 < i32::MIN as i64 || y0 < i32::MIN as i64 || x0 > i32::MAX as i64 || y0 > i32::MAX as i64 { return None; }
    Some((x0 as i32, y0 as i32, w as u32, h as u32))
}

/// Bounding box of the usable rects, and those rects for roaming.
/// A box that is exactly one full monitor drops one pixel of height, and every roam rect
/// that forms that bottom edge drops the same pixel. Cinnamon hides the panel for a monitor-sized window.
pub fn overlay_frame(full: &[(i32, i32, u32, u32)], usable: &[(i32, i32, u32, u32)]) -> Option<((i32, i32, u32, u32), Vec<(i32, i32, u32, u32)>)> {
    let mut frame = rect_span(usable)?;
    let mut roam = usable.to_vec();
    if full.iter().any(|m| *m == frame) && frame.3 > 1 {
        let bottom = frame.1 as i64 + frame.3 as i64;
        let touch: Vec<usize> = roam.iter().enumerate()
            .filter(|(_, r)| r.1 as i64 + r.3 as i64 == bottom)
            .map(|(i, _)| i)
            .collect();
        if !touch.is_empty() && touch.iter().all(|&i| roam[i].3 > 1) {
            frame.3 -= 1;
            for i in touch { roam[i].3 -= 1; }
        }
    }
    Some((frame, roam))
}

/// Full monitor geometry and the usable rect the desk and the overlay may occupy.
fn monitor_lists(app: &AppHandle) -> Option<(Vec<(i32, i32, u32, u32)>, Vec<MonitorRect>)> {
    let w = app.get_webview_window("overlay")?;
    let prim = w.primary_monitor().ok().flatten().map(|m| (m.position().x, m.position().y));
    let listed = w.available_monitors().ok()?;
    let mut full = Vec::with_capacity(listed.len());
    let mut usable = Vec::with_capacity(listed.len());
    for m in &listed {
        let f = (m.position().x, m.position().y, m.size().width, m.size().height);
        let wa = m.work_area();
        let u = usable_rect(f, (wa.position.x, wa.position.y, wa.size.width, wa.size.height));
        full.push(f);
        usable.push(MonitorRect {
            x: u.0, y: u.1, w: u.2, h: u.3, scale: m.scale_factor(),
            primary: prim == Some((f.0, f.1)),
        });
    }
    Some((full, usable))
}

pub fn home_position(app: &AppHandle, saved: Option<(i32, i32)>, size: (u32, u32)) -> Option<(i32, i32)> {
    let (_, mons) = monitor_lists(app)?;
    let rows: Vec<MonRect> = mons.into_iter().map(|m| (m.x, m.y, m.w, m.h, m.scale, m.primary)).collect();
    place_home(saved, size, &rows)
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

/// Size the overlay to the bounding box of every monitor's work area, in physical pixels.
/// A box that is still exactly one monitor loses one pixel of height so it is not treated as fullscreen.
pub fn fit_overlay(app: &AppHandle) -> ((i32, i32), Vec<MonitorRect>) {
    let Some((full, mut mons)) = monitor_lists(app) else { return ((0, 0), vec![]) };
    if mons.is_empty() { return ((0, 0), mons) }
    *signals::REAL_MONS.lock().unwrap() = mons.iter().map(|m| (m.x, m.y, m.w, m.h)).collect();
    if !*signals::COMPOSITOR.get().unwrap_or(&true) {
        let p = mons.iter().find(|m| m.primary).unwrap_or(&mons[0]).clone();
        let (bw, bh) = ((460.0 * p.scale) as u32, (380.0 * p.scale) as u32);
        mons = vec![MonitorRect { x: p.x + p.w as i32 - bw as i32, y: p.y + p.h as i32 - bh as i32, w: bw, h: bh, scale: p.scale, primary: true }];
    }
    let usable: Vec<_> = mons.iter().map(|m| (m.x, m.y, m.w, m.h)).collect();
    let Some(((x0, y0, fw, fh), roam)) = overlay_frame(&full, &usable) else { return ((0, 0), mons) };
    for (m, r) in mons.iter_mut().zip(&roam) {
        m.x = r.0; m.y = r.1; m.w = r.2; m.h = r.3;
    }
    let Some(w) = app.get_webview_window("overlay") else { return ((x0, y0), mons) };
    if w.outer_position().map(|p| (p.x, p.y)).ok() != Some((x0, y0)) { let _ = w.set_position(PhysicalPosition::new(x0, y0)); }
    if w.inner_size().map(|s| (s.width, s.height)).ok() != Some((fw, fh)) {
        let _ = w.set_size(PhysicalSize::new(fw, fh));
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

/// A new webview built on the UI thread never finishes on Windows, and the desk stops taking clicks.
fn off_ui<F: FnOnce() + Send + 'static>(f: F) {
    std::thread::spawn(f);
}

/// Queue window work off the UI thread. The caller does not block.
pub fn open_window(app: &AppHandle, tab: &str) {
    let tab: String = tab.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    *signals::SETTINGS_TAB.lock().unwrap() = tab.clone();
    let h = app.clone();
    off_ui(move || {
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
    off_ui(move || {
        if let Some(w) = h.get_webview_window("onboarding") { let _ = w.show(); let _ = w.set_focus(); return; }
        let _ = tauri::WebviewWindowBuilder::new(&h, "onboarding", tauri::WebviewUrl::App("onboarding.html".into()))
            .title("Welcome to Little Author").inner_size(480.0, 600.0).resizable(false).center()
            .always_on_top(true).content_protected(false).build();
    });
}

/// Returning desk. The version is stored only after the window is created.
pub fn open_welcome(app: &AppHandle) {
    let h = app.clone();
    off_ui(move || {
        let due = match h.try_state::<AppState>() {
            Some(st) => {
                let s = st.lock().unwrap();
                crate::welcome::pending(&s.data.seen_version, s.data.onboarded == Some(true), env!("CARGO_PKG_VERSION")).is_some()
            }
            None => false,
        };
        if !due { return; }
        if h.get_webview_window("welcome").is_some() { return; }
        let built = tauri::WebviewWindowBuilder::new(&h, "welcome", tauri::WebviewUrl::App("welcome.html".into()))
            .title("Welcome back").inner_size(440.0, 560.0).resizable(false).center()
            .always_on_top(true).content_protected(false).build();
        if built.is_err() { return; }
        if let Some(st) = h.try_state::<AppState>() {
            let mut s = st.lock().unwrap();
            let current = env!("CARGO_PKG_VERSION");
            if crate::welcome::pending(&s.data.seen_version, s.data.onboarded == Some(true), current).is_some() {
                s.data.seen_version = current.to_string();
                s.save();
            }
        }
    });
}

/// Games list. Decorated, centered, and left off the always-on-top stack.
pub fn open_games(app: &AppHandle) {
    let h = app.clone();
    off_ui(move || {
        if let Some(w) = h.get_webview_window("games") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let _ = tauri::WebviewWindowBuilder::new(&h, "games", tauri::WebviewUrl::App("games.html".into()))
            .title("Little Author — Games")
            .inner_size(420.0, 560.0)
            .center()
            .content_protected(false)
            .build();
    });
}

/// Test build. Buttons in this window run real companion events.
pub fn open_dashboard(app: &AppHandle) {
    let h = app.clone();
    off_ui(move || {
        if let Some(w) = h.get_webview_window("dashboard") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let _ = tauri::WebviewWindowBuilder::new(&h, "dashboard", tauri::WebviewUrl::App("dashboard.html".into()))
            .title("Little Author — Events")
            .inner_size(400.0, 560.0)
            .position(16.0, 16.0)
            .always_on_top(true)
            .content_protected(false)
            .build();
    });
}

pub fn install_tray(app: &AppHandle, st: &AppState, counters: &Arc<input::Counters>) -> tauri::Result<()> {
    let pause = MenuItem::with_id(app, "pause", "Pause listening", true, None::<&str>)?;
    let interact = MenuItem::with_id(app, "interact", "Interact with companion (30 s)", true, None::<&str>)?;
    let events = MenuItem::with_id(app, "events", "Events…", true, None::<&str>)?;
    let projects = MenuItem::with_id(app, "projects", "Projects…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let journal = MenuItem::with_id(app, "journal", "Letter journal…", true, None::<&str>)?;
    let privacy = MenuItem::with_id(app, "privacy", "Privacy…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&pause, &interact, &events, &projects, &settings, &journal, &privacy, &sep, &quit_item])?;
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
            "events" => open_dashboard(app),
            "settings" | "journal" | "projects" | "privacy" => open_window(app, ev.id().as_ref()),
            "quit" => quit(app),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn apply_tag_place(app: &AppHandle) {
    if !signals::TAG_HIT.load(Ordering::Relaxed) { return; }
    let Some((x, y, w, h)) = *signals::TAG_PLACE.lock().unwrap() else { return };
    let Some(win) = app.get_webview_window("taghit") else { return };
    if !signals::TAG_HIT.load(Ordering::Relaxed) { return; }
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_size(PhysicalSize::new(w.max(8), h.max(8)));
    let _ = win.show();
    // Show is posted. A game that ended in between has to close after that post, or the window stays up.
    if !signals::TAG_HIT.load(Ordering::Relaxed) { let _ = win.close(); }
}

/// Open or close the small window that catches a click on Buddy during a click game.
/// The overlay stays click-through, so the rest of the desktop still receives clicks.
pub fn set_tag_window(app: &AppHandle, on: bool) {
    if !on {
        *signals::TAG_PLACE.lock().unwrap() = None;
        if let Some(w) = app.get_webview_window("taghit") { let _ = w.close(); }
        return;
    }
    let h = app.clone();
    off_ui(move || {
        if h.get_webview_window("taghit").is_some() { return; }
        let built = tauri::WebviewWindowBuilder::new(&h, "taghit", tauri::WebviewUrl::App("hit.html".into()))
            .title("Little Author — Tag the Buddy")
            .inner_size(80.0, 80.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(tauri::window::Color(0, 0, 0, 0))
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false)
            .visible(false)
            .content_protected(false)
            .build();
        if built.is_err() { return; }
        if !signals::TAG_HIT.load(Ordering::Relaxed) {
            if let Some(w) = h.get_webview_window("taghit") { let _ = w.close(); }
            return;
        }
        apply_tag_place(&h);
    });
}

pub fn place_tag_window(app: &AppHandle, x: i32, y: i32, w: u32, h: u32) {
    *signals::TAG_PLACE.lock().unwrap() = Some((x, y, w, h));
    apply_tag_place(app);
}

/// Sample the cursor only during play. The click catcher is up only during a click game.
pub fn sync_game_chrome(app: &AppHandle, play: bool, tag: bool) {
    signals::GAME_CURSOR.store(play, Ordering::Relaxed);
    if signals::TAG_HIT.swap(tag, Ordering::Relaxed) != tag { set_tag_window(app, tag); }
}

/// Logical size used when a game is placed on a monitor. Physical size is this times the monitor scale.
const PROMPT_W: f64 = 300.0;
const PROMPT_H: f64 = 280.0;

fn rect_overlap(a: (i32, i32, i32, i32), m: &MonRect) -> i64 {
    let (ax, ay, aw, ah) = a;
    let x0 = (ax as i64).max(m.0 as i64);
    let y0 = (ay as i64).max(m.1 as i64);
    let x1 = (ax as i64 + aw as i64).min(m.0 as i64 + m.2 as i64);
    let y1 = (ay as i64 + ah as i64).min(m.1 as i64 + m.3 as i64);
    (x1 - x0).max(0) * (y1 - y0).max(0)
}

fn point_in(m: &MonRect, x: i32, y: i32) -> bool {
    let (x, y) = (x as i64, y as i64);
    x >= m.0 as i64 && y >= m.1 as i64 && x < m.0 as i64 + m.2 as i64 && y < m.1 as i64 + m.3 as i64
}

/// Monitor index for the question. The anchor's largest overlap wins.
/// No overlap uses the desk point, then the primary monitor.
fn holding_monitor(anchor: Option<focus::Anchor>, desk: Option<(i32, i32)>, mons: &[MonRect]) -> Option<usize> {
    if mons.is_empty() { return None; }
    if let Some((x, y, w, h)) = anchor {
        if w > 0 && h > 0 {
            let mut best = None;
            let mut area = 0i64;
            for (i, m) in mons.iter().enumerate() {
                let a = rect_overlap((x, y, w, h), m);
                if a > area { area = a; best = Some(i); }
            }
            if best.is_some() { return best; }
        }
    }
    if let Some((x, y)) = desk {
        if let Some(i) = mons.iter().position(|m| point_in(m, x, y)) { return Some(i); }
    }
    mons.iter().position(|m| m.5).or(Some(0))
}

/// Physical top-left and size, centered on the monitor from `holding_monitor`.
pub fn prompt_place(anchor: Option<focus::Anchor>, desk: Option<(i32, i32)>, mons: &[MonRect]) -> Option<((i32, i32), (u32, u32))> {
    let m = &mons[holding_monitor(anchor, desk, mons)?];
    let scale = if m.4.is_finite() && m.4 > 0.0 { m.4 } else { 1.0 };
    let pw = (PROMPT_W * scale).round().max(1.0) as i64;
    let ph = (PROMPT_H * scale).round().max(1.0) as i64;
    let (mw, mh) = (m.2 as i64, m.3 as i64);
    let x = if pw >= mw { m.0 as i64 } else { m.0 as i64 + (mw - pw) / 2 };
    let y = if ph >= mh { m.1 as i64 } else { m.1 as i64 + (mh - ph) / 2 };
    Some(((x as i32, y as i32), (pw as u32, ph as u32)))
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
                if let Some(w) = h2.get_webview_window("welcome") { let _ = w.set_focus(); }
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

    #[test]
    fn the_question_sits_on_the_monitor_that_holds_the_window() {
        let mons = [(0, 0, 1920, 1080, 1.0, true), (1920, 0, 2560, 1440, 1.5, false)];
        let on_second = prompt_place(Some((2000, 100, 800, 600)), None, &mons).unwrap();
        assert_eq!(on_second.1, (450, 420));
        assert_eq!(on_second.0, (1920 + (2560 - 450) / 2, (1440 - 420) / 2));
        let primary = prompt_place(None, None, &mons).unwrap();
        assert_eq!(primary.1, (300, 280));
        assert_eq!(primary.0, ((1920 - 300) / 2, (1080 - 280) / 2));
        let desk = prompt_place(None, Some((2000, 80)), &mons).unwrap();
        assert_eq!(desk.1, (450, 420));
        assert_eq!(desk.0.0, on_second.0.0);
        let missed = prompt_place(Some((-4000, -4000, 10, 10)), None, &mons).unwrap();
        assert_eq!(missed.0, primary.0);
        let overlap = prompt_place(Some((1800, 0, 400, 100)), None, &mons).unwrap();
        assert_eq!(overlap.1, (450, 420));
        assert!(prompt_place(None, None, &[]).is_none());
    }

    #[test]
    fn empty_work_area_falls_back_to_the_monitor() {
        assert_eq!(usable_rect((0, 0, 1920, 1080), (0, 0, 0, 0)), (0, 0, 1920, 1080));
        assert_eq!(usable_rect((10, 20, 800, 600), (0, 0, 100, 0)), (10, 20, 800, 600));
        assert_eq!(usable_rect((0, 0, 1920, 1080), (0, 40, 1920, 1040)), (0, 40, 1920, 1040));
    }

    #[test]
    fn a_reported_panel_is_left_out_of_the_overlay() {
        let full = [(0, 0, 1920, 1080)];
        let bottom = [(0, 0, 1920, 1040)];
        let (frame, roam) = overlay_frame(&full, &bottom).unwrap();
        assert_eq!(frame, bottom[0]);
        assert_eq!(roam, bottom.to_vec());
        let top = [(0, 40, 1920, 1040)];
        assert_eq!(overlay_frame(&full, &top).unwrap().0, top[0]);
        let side = [(48, 0, 1872, 1080)];
        assert_eq!(overlay_frame(&full, &side).unwrap().0, side[0]);
    }

    #[test]
    fn a_monitor_sized_overlay_drops_one_pixel() {
        let full = [(0, 0, 1920, 1080)];
        let (frame, roam) = overlay_frame(&full, &full).unwrap();
        assert_eq!(frame, (0, 0, 1920, 1079));
        assert_eq!(roam, vec![(0, 0, 1920, 1079)]);
        let shifted = [(-1920, -40, 1920, 1080)];
        assert_eq!(overlay_frame(&shifted, &shifted).unwrap().0, (-1920, -40, 1920, 1079));
        let tiny = [(0, 0, 100, 1)];
        assert_eq!(overlay_frame(&tiny, &tiny).unwrap().0, tiny[0]);
    }

    #[test]
    fn only_the_bottom_edge_shrinks_when_the_union_is_one_monitor() {
        let full = [(0, 0, 1920, 1080)];
        let usable = [(0, 0, 1920, 500), (0, 500, 1920, 580)];
        let (frame, roam) = overlay_frame(&full, &usable).unwrap();
        assert_eq!(frame, (0, 0, 1920, 1079));
        assert_eq!(roam, vec![(0, 0, 1920, 500), (0, 500, 1920, 579)]);
    }

    #[test]
    fn a_span_of_monitors_is_not_shortened() {
        let full = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        let (frame, roam) = overlay_frame(&full, &full).unwrap();
        assert_eq!(frame, (0, 0, 4480, 1440));
        assert_eq!(roam, full.to_vec());
        let corner = [(1920 - 460, 1080 - 380, 460, 380)];
        assert_eq!(overlay_frame(&[(0, 0, 1920, 1080)], &corner).unwrap().0, corner[0]);
        assert!(overlay_frame(&[], &[]).is_none());
    }
}
