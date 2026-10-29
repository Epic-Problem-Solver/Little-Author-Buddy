mod activate;
mod commands;
mod distraction;
mod focus;
mod games;
mod packs;
mod home_geo;
mod idle;
mod input;
mod layout;
mod platform;
mod signals;
mod state;
mod store;
mod tick;
mod update;
mod welcome;
mod windows;

use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

/// WebKitGTK accelerated compositing leaves the previous transparent frame on X11,
/// and its monitor-sized child window is what makes Cinnamon hide the panel.
/// Shared-memory frames repaint the whole view. A value already in the environment stays.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn prefer_shared_webkit_frames() {
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        // Before the builder and before any worker thread, so nothing else is reading the environment.
        unsafe { std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1"); }
    }
}

pub fn run() {
    #[cfg(target_os = "linux")]
    prefer_shared_webkit_frames();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::race_arrived, commands::get_snapshot, commands::list_hats, commands::list_games,
            commands::game_catalog, commands::open_games, commands::play_game,
            commands::focus_start, commands::focus_pause, commands::focus_back, commands::focus_finish, commands::focus_tag, commands::set_focus_minutes, commands::place_tag_hit,
            commands::get_data, commands::get_warnings,
            commands::new_project, commands::start_next, commands::update_settings,
            commands::save_letter, commands::export_journal, commands::default_journal_dir, commands::open_settings,
            commands::quit_app, commands::track_window, commands::initial_tab,
            commands::finish_onboarding, commands::reopen_onboarding,
            commands::get_welcome, commands::dismiss_welcome,
            update::check_update, update::open_download_page,
            activate::activate_supporter,
            commands::dash_event
        ])
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("state.json");
            let (data, issue) = store::load(&path, state::now_ms());
            let welcome = welcome::pending(&data.seen_version, data.onboarded == Some(true), env!("CARGO_PKG_VERSION"));
            let show_welcome = welcome.is_some();
            let welcome_sections = welcome.unwrap_or_default();
            let mut warnings = vec![];
            let no_save = issue.as_ref().map_or(false, |i| i.block_save());
            if let Some(i) = issue { let m = i.message(); eprintln!("{m}"); warnings.push(m); }
            let comp = platform::has_compositor();
            let _ = signals::COMPOSITOR.set(comp);
            if !comp {
                warnings.push("No compositor detected: transparency is unavailable, so the companion stays in a small box in the corner of the primary monitor. Start a compositor (e.g. picom) and restart for full-screen wandering.".into());
            }
            if std::env::var("XDG_SESSION_TYPE").map_or(false, |v| v == "wayland") {
                warnings.push("Wayland session: v1 only sees keystrokes in X11/XWayland apps; use an X11 session for full counting.".into());
            }
            let counters = Arc::new(input::Counters::default());
            let st: state::AppState = Arc::new(std::sync::Mutex::new(state::Shared {
                data, path, dirty: false, snap: None, warnings, no_save, interactive_until: 0,
                focus: focus::Session::default(), welcome: welcome_sections,
            }));
            app.manage(st.clone());
            app.manage(counters.clone());
            let handle = app.handle().clone();
            windows::install_tray(&handle, &st, &counters)?;
            windows::show_overlay(&handle);

            let st_sig = st.clone();
            let _ = ctrlc::set_handler(move || { if let Ok(mut s) = st_sig.lock() { s.save(); } std::process::exit(0); });
            if let Ok(t) = std::env::var("LWC_OPEN") {
                let h = handle.clone();
                std::thread::spawn(move || { std::thread::sleep(Duration::from_secs(2)); windows::open_window(&h, &t); });
            }
            input::spawn(counters.clone());
            let saved = st.lock().unwrap().data.settings.home_pos;
            windows::create_home(&handle, saved)?;
            for w in app.webview_windows().values() { let _ = w.set_content_protected(false); }
            if !st.lock().unwrap().data.onboarded.unwrap_or(true) { windows::open_onboarding(&handle); }
            else if show_welcome { windows::open_welcome(&handle); }
            windows::open_dashboard(&handle);
            let h = handle.clone();
            std::thread::spawn(move || tick::tick_loop(h, st, counters));
            let h2 = handle.clone();
            std::thread::spawn(move || tick::tracker_loop(h2));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, ev| match ev {
            tauri::RunEvent::Exit => { if let Some(st) = app.try_state::<state::AppState>() { st.lock().unwrap().save(); } }
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "home" => {
                api.prevent_close();
                windows::quit(app);
            }
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if code.is_none() { api.prevent_exit(); }
            }
            _ => {}
        });
}
