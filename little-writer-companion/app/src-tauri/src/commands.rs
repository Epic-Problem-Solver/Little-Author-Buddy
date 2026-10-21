//! Invoke handlers. Window creation stays async so WebView2 does not deadlock.

use crate::focus::{self, Phase};
use crate::games;
use crate::packs;
use crate::platform;
use crate::signals;
use crate::state::{self, AppState};
use crate::store::{self, Tier};
use crate::windows;
use rand::Rng;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_snapshot(st: State<AppState>) -> Option<state::Snapshot> { st.lock().unwrap().snap.clone() }

/// Installed supporter hats. The SVG is read once here; the paint snapshot only carries the choice.
#[tauri::command]
pub fn list_hats(st: State<AppState>) -> Vec<packs::HatInfo> {
    let dir = { let s = st.lock().unwrap(); packs::packs_dir(&s.path) };
    packs::list(&dir)
}

/// Installed supporter games. Lines only. The app runs the known engines. Pack scripts are not loaded.
#[tauri::command]
pub fn list_games(st: State<AppState>) -> Vec<games::GameInfo> {
    let dir = { let s = st.lock().unwrap(); packs::packs_dir(&s.path) };
    games::list(&dir)
}

fn publish(st: &mut state::Shared, spoken: Option<focus::Spoken>) -> (Option<state::Snapshot>, Option<games::FocusSay>) {
    signals::FOCUS_ASK.store(st.focus.phase == Phase::Ask, Ordering::Relaxed);
    if let Some(snap) = st.snap.as_mut() { state::write_focus(snap, &st.focus, st.data.settings.focus_minutes); }
    let say = spoken.map(|sp| games::say_event(sp.kind, &sp.game, &st.data.settings.buddy_name, &packs::packs_dir(&st.path)));
    (st.snap.clone(), say)
}

fn chrome(s: &state::Shared) -> (bool, bool) {
    let play = s.focus.phase == Phase::Play;
    let hit = s.focus.phase == Phase::Explain || (play && games::wants_hit(&s.focus.game));
    (play, hit)
}

/// An invite becomes one random installed game. No pack means he stays at the desk.
pub(crate) fn settle_spoken(st: &AppState, spoken: Option<focus::Spoken>) -> Option<focus::Spoken> {
    match spoken {
        Some(sp) if sp.kind == focus::Kind::Invite => offer_random(st),
        other => other,
    }
}

fn offer_random(st: &AppState) -> Option<focus::Spoken> {
    let ids = {
        let s = st.lock().unwrap();
        games::list(&packs::packs_dir(&s.path)).into_iter().map(|g| g.id).collect::<Vec<_>>()
    };
    let Some(id) = focus::choose_id(&ids, rand::thread_rng().gen()) else { return None };
    let anchor = platform::foreground()
        .filter(|f| !f.title.contains("Little Author"))
        .map(|f| (f.x, f.y, f.w, f.h));
    let mut s = st.lock().unwrap();
    let spoken = s.focus.begin_ask(&id, anchor);
    signals::FOCUS_ASK.store(s.focus.phase == Phase::Ask, Ordering::Relaxed);
    let minutes = s.data.settings.focus_minutes;
    let focus = s.focus.clone();
    if let Some(snap) = s.snap.as_mut() { state::write_focus(snap, &focus, minutes); }
    spoken
}

fn emit_settled(app: &AppHandle, st: &AppState, spoken: Option<focus::Spoken>) {
    let spoken = settle_spoken(st, spoken);
    let (snap, say, play, hit) = {
        let s = st.lock().unwrap();
        let say = spoken.map(|sp| games::say_event(sp.kind, &sp.game, &s.data.settings.buddy_name, &packs::packs_dir(&s.path)));
        let (play, hit) = chrome(&s);
        (s.snap.clone(), say, play, hit)
    };
    windows::sync_game_chrome(app, play, hit);
    emit_focus(app, snap, say);
}

fn emit_focus(app: &AppHandle, snap: Option<state::Snapshot>, say: Option<games::FocusSay>) {
    if let Some(snap) = snap { let _ = app.emit("companion-state", &snap); }
    if let Some(say) = say { let _ = app.emit("focus-say", &say); }
}

/// Desk Start. Begins a session, resumes Pause, or starts a finished one over.
#[tauri::command]
pub fn focus_start(app: AppHandle, st: State<AppState>) {
    let snap = {
        let mut s = st.lock().unwrap();
        if s.data.settings.focus_minutes == 0 || !s.focus.start() { return; }
        publish(&mut s, None).0
    };
    emit_focus(&app, snap, None);
}

/// Desk Pause. Freezes a running timer until Start.
#[tauri::command]
pub fn focus_pause(app: AppHandle, st: State<AppState>) {
    let snap = {
        let mut s = st.lock().unwrap();
        if !s.focus.pause() { return; }
        publish(&mut s, None).0
    };
    emit_focus(&app, snap, None);
}

/// The overlay reports a catch, a tag, or that the celebration is over.
#[tauri::command]
pub fn focus_finish(app: AppHandle, st: State<AppState>) {
    let snap = {
        let mut s = st.lock().unwrap();
        if !s.focus.finish() { return; }
        publish(&mut s, None).0
    };
    windows::sync_game_chrome(&app, false, false);
    emit_focus(&app, snap, None);
}

/// The click catcher. During the explanation it starts play. During a click game it counts the click.
#[tauri::command]
pub fn focus_tag(app: AppHandle, st: State<AppState>) {
    enum Hit { Start(Option<state::Snapshot>, bool, bool), Tag }
    let hit = {
        let mut s = st.lock().unwrap();
        if s.focus.phase == Phase::Explain && s.focus.ready_click() {
            let snap = publish(&mut s, None).0;
            let (play, tag) = chrome(&s);
            Hit::Start(snap, play, tag)
        } else if s.focus.phase == Phase::Play && games::wants_hit(&s.focus.game) {
            Hit::Tag
        } else {
            return;
        }
    };
    match hit {
        Hit::Tag => { let _ = app.emit("tag-click", ()); }
        Hit::Start(snap, play, tag) => {
            windows::sync_game_chrome(&app, play, tag);
            emit_focus(&app, snap, None);
        }
    }
}

/// Move the click catcher over Buddy. Physical pixels. Used for the ready click and for a click game.
#[tauri::command]
pub fn place_tag_hit(app: AppHandle, st: State<AppState>, x: i32, y: i32, w: u32, h: u32) {
    let ok = {
        let s = st.lock().unwrap();
        s.focus.phase == Phase::Explain || (s.focus.phase == Phase::Play && games::wants_hit(&s.focus.game))
    };
    if ok { windows::place_tag_window(&app, x, y, w, h); }
}

/// Settings, or any caller, sets the writing-minute goal directly.
#[tauri::command]
pub fn set_focus_minutes(app: AppHandle, st: State<AppState>, minutes: u32) {
    let minutes = store::clamp_focus_minutes(minutes);
    let spoken = {
        let mut s = st.lock().unwrap();
        if s.data.settings.focus_minutes == minutes { return; }
        s.data.settings.focus_minutes = minutes;
        let spoken = s.focus.limit(focus::limit_ms(minutes));
        s.save();
        publish(&mut s, None);
        spoken
    };
    emit_settled(&app, st.inner(), spoken);
    let _ = app.emit_to("settings", "settings-changed", ());
}

/// He reached the desk after declining the game.
#[tauri::command]
pub fn focus_back(app: AppHandle, st: State<AppState>) {
    let snap = {
        let mut s = st.lock().unwrap();
        if !s.focus.back_arrived() { return; }
        publish(&mut s, None).0
    };
    windows::sync_game_chrome(&app, false, false);
    emit_focus(&app, snap, None);
}

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
pub fn update_settings(app: AppHandle, st: State<AppState>, settings: store::Settings) -> Result<(), String> {
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
    v.distraction_titles = store::clamp_titles(v.distraction_titles);
    v.journal_dir = match v.journal_dir.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        None => None,
        Some(p) if store::journal_dir_ok(p) => Some(p.to_string()),
        Some(_) => return Err("journal folder must be an absolute path without ..".into()),
    };
    packs::clamp_saved(&mut v.hat, &mut v.hat_color, &mut v.hat_extra, &packs::packs_dir(&s.path));
    v.focus_minutes = store::clamp_focus_minutes(v.focus_minutes);
    let focus_changed = v.focus_minutes != s.data.settings.focus_minutes;
    s.data.settings = v;
    let minutes = s.data.settings.focus_minutes;
    let spoken = if focus_changed { s.focus.limit(focus::limit_ms(minutes)) } else { None };
    s.save();
    publish(&mut s, None);
    drop(s);
    emit_settled(&app, st.inner(), spoken);
    Ok(())
}

const CATEGORY_MAX: usize = 64;
const FROM_MAX: usize = 120;
const BODY_MAX: usize = 4000;
const PROJECT_MAX: usize = 120;

fn take_chars(s: &str, n: usize) -> String { s.chars().take(n).collect() }

fn clip_letter(category: String, from: String, body: String, project: String) -> (String, String, String, String) {
    (
        take_chars(category.trim(), CATEGORY_MAX),
        take_chars(from.trim(), FROM_MAX),
        take_chars(&body, BODY_MAX),
        take_chars(project.trim(), PROJECT_MAX),
    )
}

fn fallback_journal_dir(app: &AppHandle) -> PathBuf {
    app.path().document_dir().unwrap_or_else(|_| app.path().home_dir().unwrap_or_default()).join("Little Author Journal")
}

/// Saved folder when it is absolute and has no `..`, otherwise Documents/Little Author Journal.
fn journal_dir_display(app: &AppHandle, d: &store::Data) -> PathBuf {
    match d.settings.journal_dir.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) if store::journal_dir_ok(p) => PathBuf::from(p),
        _ => fallback_journal_dir(app),
    }
}

/// Create the journal folder and return its canonical path. Refuses `..` and relative paths.
fn open_journal_dir(path: PathBuf) -> Result<PathBuf, String> {
    let shown = path.to_string_lossy();
    if !path.is_absolute() || shown.contains("..") || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("journal folder must be an absolute path without ..".into());
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let canon = path.canonicalize().map_err(|e| e.to_string())?;
    if canon.to_string_lossy().contains("..") { return Err("journal folder must be an absolute path without ..".into()); }
    Ok(canon)
}

fn journal_dir(app: &AppHandle, d: &store::Data) -> Result<PathBuf, String> {
    open_journal_dir(journal_dir_display(app, d))
}

fn letter_md(l: &store::Letter) -> (String, String) {
    let day = store::day_string(l.received_at);
    let slug: String = l.project.chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
    (format!("{day}-{slug}-{}.md", l.received_at),
     format!("# Fan letter — {}\n\n*{} · {}*\n\n{}\n\n— {}\n", l.project, l.category, day, l.body, l.from))
}

/// A generated markdown name only. A name with a separator or `..` is refused.
fn journal_file(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.ends_with(".md") || name.contains(['/', '\\', '\0']) || name.contains("..") {
        return Err("journal file name is not allowed".into());
    }
    let path = dir.join(name);
    match path.parent() {
        Some(parent) if parent == dir => Ok(path),
        _ => Err("journal file escaped its folder".into()),
    }
}

fn write_journal_file(dir: &Path, letter: &store::Letter) -> Result<PathBuf, String> {
    let (name, md) = letter_md(letter);
    let path = journal_file(dir, &name)?;
    std::fs::write(&path, md).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub fn save_letter(app: AppHandle, st: State<AppState>, category: String, from: String, body: String, project: String) -> Result<String, String> {
    let (category, from, body, project) = clip_letter(category, from, body, project);
    let mut s = st.lock().unwrap();
    let l = store::Letter { category, from, body, project, received_at: state::now_ms() };
    s.data.journal.push(l.clone());
    s.save();
    let dir = journal_dir(&app, &s.data)?;
    Ok(write_journal_file(&dir, &l)?.display().to_string())
}

#[tauri::command]
pub fn export_journal(app: AppHandle, st: State<AppState>) -> Result<String, String> {
    let s = st.lock().unwrap();
    let dir = journal_dir(&app, &s.data)?;
    for l in &s.data.journal { write_journal_file(&dir, l)?; }
    Ok(format!("{} letters exported to {}", s.data.journal.len(), dir.display()))
}

#[tauri::command]
pub fn default_journal_dir(app: AppHandle, st: State<AppState>) -> String {
    journal_dir_display(&app, &st.lock().unwrap().data).display().to_string()
}

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

/// Track only the foreground window id Rust last published, or clear tracking.
#[tauri::command]
pub fn track_window(id: Option<u64>) -> Result<(), String> {
    match id {
        None => { *signals::TRACK.lock().unwrap() = None; Ok(()) }
        Some(id) => {
            let last = signals::LAST_FG.load(Ordering::Relaxed);
            if id != 0 && id == last {
                *signals::TRACK.lock().unwrap() = Some(id);
                Ok(())
            } else {
                Err("not the foreground window".into())
            }
        }
    }
}

#[tauri::command]
pub fn race_arrived(app: AppHandle) {
    signals::RACE_ARRIVED.store(true, Ordering::Relaxed);
    let _ = app.emit_to("home", "handoff", ());
    let _ = app.emit_to("overlay", "handoff", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_files_stay_inside_the_folder_and_fields_are_capped() {
        let root = std::env::temp_dir().join(format!("lwc-journal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let dir = open_journal_dir(root.join("letters")).unwrap();
        let letter = store::Letter {
            category: "encouragement".into(), from: "Ada".into(), body: "hello".into(),
            project: "../outside".into(), received_at: 1_700_000_000_000,
        };
        let path = write_journal_file(&dir, &letter).unwrap();
        assert_eq!(path.parent().unwrap().canonicalize().unwrap(), dir);
        let name = path.file_name().unwrap().to_string_lossy();
        assert!(!name.contains("..") && !name.contains('/') && !name.contains('\\'));
        assert!(journal_file(&dir, "../x.md").is_err());
        assert!(journal_file(&dir, r"..\x.md").is_err());
        assert!(journal_file(&dir, "nested/x.md").is_err());
        assert!(!store::journal_dir_ok("relative/journal"));
        let escaped = format!("{}{}..{}outside", dir.display(), std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR);
        assert!(!store::journal_dir_ok(&escaped));
        assert!(store::journal_dir_ok(&dir.display().to_string()));
        let (c, f, b, p) = clip_letter("c".repeat(200), "f".repeat(300), "b".repeat(5000), "p".repeat(200));
        assert_eq!(c.chars().count(), 64);
        assert_eq!(f.chars().count(), 120);
        assert_eq!(b.chars().count(), 4000);
        assert_eq!(p.chars().count(), 120);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn track_window_accepts_only_the_published_foreground() {
        signals::LAST_FG.store(0, Ordering::Relaxed);
        *signals::TRACK.lock().unwrap() = None;
        assert!(track_window(Some(99)).is_err());
        assert!(signals::TRACK.lock().unwrap().is_none());
        assert!(track_window(Some(0)).is_err());
        signals::LAST_FG.store(42, Ordering::Relaxed);
        assert!(track_window(Some(42)).is_ok());
        assert_eq!(*signals::TRACK.lock().unwrap(), Some(42));
        assert!(track_window(Some(7)).is_err());
        assert_eq!(*signals::TRACK.lock().unwrap(), Some(42));
        assert!(track_window(None).is_ok());
        assert!(signals::TRACK.lock().unwrap().is_none());
        signals::LAST_FG.store(0, Ordering::Relaxed);
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
