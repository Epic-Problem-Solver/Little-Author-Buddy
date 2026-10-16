//! Invoke handlers. Window creation stays async so WebView2 does not deadlock.

use crate::input;
use crate::signals;
use crate::state::{self, AppState};
use crate::store::{self, Tier};
use crate::windows;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_snapshot(st: State<AppState>) -> Option<state::Snapshot> { st.lock().unwrap().snap.clone() }

/// Settings document: projects, queue, journal, and the form. The overlay uses `get_snapshot` instead.
#[tauri::command]
pub fn get_data(st: State<AppState>) -> store::Data { st.lock().unwrap().data.clone() }

#[tauri::command]
pub fn get_warnings(st: State<AppState>) -> Vec<String> { st.lock().unwrap().warnings.clone() }

#[tauri::command]
pub fn new_project(st: State<AppState>, name: String, tier: String, target_words: Option<u64>) -> Result<(), String> {
    let mut s = st.lock().unwrap();
    if !s.data.tier_unlocked(&tier) { return Err(format!("The {tier} tier is locked")); }
    let tier = Tier::parse(&tier).ok_or_else(|| format!("The {tier} tier is locked"))?;
    let name = if name.trim().is_empty() { "Untitled".to_string() } else { name.trim().chars().take(120).collect() };
    let now = state::now_ms();
    let p = s.data.make_project(&name, tier, target_words, now);
    if s.data.active.is_none() { s.data.start_project(p, now) } else { s.data.queue.push(p) }
    s.save();
    Ok(())
}

#[tauri::command]
pub fn start_next(st: State<AppState>) -> bool {
    let mut s = st.lock().unwrap();
    if s.data.active.is_some() || s.data.queue.is_empty() { return false; }
    if !s.data.tier_unlocked(s.data.queue[0].tier.as_str()) { return false; }
    let p = s.data.queue.remove(0);
    s.data.start_project(p, state::now_ms());
    s.dirty = true;
    true
}

#[tauri::command]
pub fn update_settings(st: State<AppState>, settings: store::Settings) {
    let mut s = st.lock().unwrap();
    let mut v = settings;
    v.keys_per_word = store::clamp_kpw(v.keys_per_word);
    store::clamp_motion(&mut v);
    v.colors.derive();
    if v.buddy_name.trim().is_empty() { v.buddy_name = s.data.settings.buddy_name.clone(); }
    v.buddy_name = v.buddy_name.trim().chars().take(40).collect();
    v.wander_max_ms = v.wander_max_ms.max(v.wander_min_ms);
    v.tiers.short_story = v.tiers.short_story.max(1);
    v.tiers.novella = v.tiers.novella.max(1);
    v.tiers.novel = v.tiers.novel.max(1);
    v.home_pos = s.data.settings.home_pos;
    s.data.settings = v;
    s.save();
}

fn journal_dir(app: &AppHandle, d: &store::Data) -> PathBuf {
    d.settings.journal_dir.as_ref().filter(|p| !p.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| {
        app.path().document_dir().unwrap_or_else(|_| app.path().home_dir().unwrap_or_default()).join("Little Writer Journal")
    })
}

fn letter_md(l: &store::Letter) -> (String, String) {
    let day = store::day_string(l.received_at);
    let slug: String = l.project.chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
    (format!("{day}-{}-{}.md", slug, l.received_at),
     format!("# Fan letter — {}\n\n*{} · {}*\n\n{}\n\n— {}\n", l.project, l.category, day, l.body, l.from))
}

#[tauri::command]
pub fn save_letter(app: AppHandle, st: State<AppState>, category: String, from: String, body: String, project: String) -> Result<String, String> {
    let mut s = st.lock().unwrap();
    let l = store::Letter { category, from, body, project, received_at: state::now_ms() };
    s.data.journal.push(l.clone());
    s.save();
    let dir = journal_dir(&app, &s.data);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (name, md) = letter_md(&l);
    std::fs::write(dir.join(&name), md).map_err(|e| e.to_string())?;
    Ok(dir.join(name).display().to_string())
}

#[tauri::command]
pub fn export_journal(app: AppHandle, st: State<AppState>, dir: Option<String>) -> Result<String, String> {
    let s = st.lock().unwrap();
    let d = dir.filter(|x| !x.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| journal_dir(&app, &s.data));
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    for l in &s.data.journal { let (n, md) = letter_md(l); std::fs::write(d.join(n), md).map_err(|e| e.to_string())?; }
    Ok(format!("{} letters exported to {}", s.data.journal.len(), d.display()))
}

#[tauri::command]
pub fn default_journal_dir(app: AppHandle, st: State<AppState>) -> String { journal_dir(&app, &st.lock().unwrap().data).display().to_string() }

#[tauri::command]
pub async fn open_settings(app: AppHandle, tab: Option<String>) { windows::open_window(&app, tab.as_deref().unwrap_or("settings")) }

#[tauri::command]
pub fn initial_tab() -> String { windows::initial_tab() }

#[tauri::command]
pub async fn finish_onboarding(app: AppHandle, buddy: String, colors: store::Colors, title: String) -> Result<(), String> {
    {
        let st = app.state::<AppState>();
        let mut s = st.lock().unwrap();
        let buddy: String = buddy.trim().chars().take(40).collect();
        s.data.settings.buddy_name = if buddy.is_empty() { store::DEFAULT_BUDDY.into() } else { buddy };
        s.data.settings.colors = colors;
        s.data.settings.colors.derive();
        s.data.onboarded = Some(true);
        if s.data.active.is_none() && s.data.queue.is_empty() {
            let title = if title.trim().is_empty() { "My Short Story".to_string() } else { title.trim().chars().take(120).collect() };
            let now = state::now_ms();
            let p = s.data.make_project(&title, Tier::ShortStory, None, now);
            s.data.start_project(p, now);
        }
        s.save();
    }
    if let Some(w) = app.get_webview_window("onboarding") { let _ = w.close(); }
    let _ = app.emit_to("settings", "settings-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn reopen_onboarding(app: AppHandle) { windows::open_onboarding(&app) }

#[tauri::command]
pub async fn quit_app(app: AppHandle) { windows::quit(&app) }

/// Render a self-contained SVG (styles already inlined by the UI) to a transparent PNG.
pub fn render_png(svg: &str, scale: f32) -> Result<Vec<u8>, String> {
    use resvg::{tiny_skia, usvg};
    let mut opt = usvg::Options::default();
    opt.fontdb_mut().load_system_fonts();
    let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| e.to_string())?;
    let size = tree.size().to_int_size().scale_by(scale).ok_or("bad size")?;
    let mut pix = tiny_skia::Pixmap::new(size.width(), size.height()).ok_or("bad size")?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pix.as_mut());
    pix.encode_png().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_snapshot(app: AppHandle, svg: String) -> Result<String, String> {
    let png = render_png(&svg, 2.0)?;
    let dir = app.path().picture_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?.join("Little Writer");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("little-writer-{}.png", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"));
    let path = dir.join(&name);
    std::fs::write(&path, png).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn track_window(id: Option<u64>) { *signals::TRACK.lock().unwrap() = id; }

#[tauri::command]
pub fn race_arrived(app: AppHandle) {
    signals::RACE_ARRIVED.store(true, Ordering::Relaxed);
    let _ = app.emit_to("home", "handoff", ());
    let _ = app.emit_to("overlay", "handoff", ());
}

#[tauri::command]
pub fn toggle_pause(app: AppHandle, c: State<Arc<input::Counters>>) -> bool { windows::do_toggle(&app, &c) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_png_with_alpha() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" width="240" height="220"><circle cx="120" cy="110" r="62" fill="#e8cfa9" stroke="#241414" stroke-width="8"/></svg>"##;
        let png = render_png(svg, 2.0).unwrap();
        let pix = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
        assert_eq!((pix.width(), pix.height()), (480, 440));
        assert_eq!(pix.pixel(0, 0).unwrap().alpha(), 0, "corner must be transparent");
        assert_eq!(pix.pixel(240, 220).unwrap().alpha(), 255, "body must be opaque");
    }

    #[test]
    fn open_settings_is_async() {
        const COMMANDS: &str = include_str!("commands.rs");
        const WINDOWS: &str = include_str!("windows.rs");
        assert!(COMMANDS.contains("pub async fn open_settings("), "window-creating commands must be async (WebView2 deadlock)");
        assert!(COMMANDS.contains("pub async fn finish_onboarding("));
        assert!(WINDOWS.matches("WebviewWindowBuilder::new(&h,").count() >= 2);
        assert!(!COMMANDS.contains(concat!("settings.html", "#")), "no fragment in the asset URL");
        assert!(!WINDOWS.contains(concat!("settings.html", "#")));
    }
}
