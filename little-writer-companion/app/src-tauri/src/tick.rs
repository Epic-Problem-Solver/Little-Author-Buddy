//! The 250 ms session loop. It samples input, asks the state machine and the
//! progress model what changed, then emits the paint view.

use crate::distraction::{self, Policy};
use crate::focus::{self, Phase};
use crate::games;
use crate::home_geo;
use crate::idle::{Inputs, Machine, Mode, Params};
use crate::input;
use crate::layout::{RACE_HOLD_MS, RACE_SAFETY_MS};
use crate::platform;
use crate::signals;
use crate::state::{self, AppState, Frame};
use crate::commands;
use crate::windows;
use rand::Rng;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct TargetEvent { id: u64, #[serde(flatten)] target: platform::Target }

#[derive(Serialize, Clone)]
struct CursorEv { x: i32, y: i32 }

struct TickCfg {
    idle_ms: u64,
    wander_min_ms: u64,
    wander_max_ms: u64,
    race_back_ms: u64,
    scroll_window_ms: u64,
    policy: Policy,
    interactive_until: u64,
}

impl TickCfg {
    fn from_shared(s: &state::Shared) -> Self {
        let g = &s.data.settings;
        Self {
            idle_ms: g.idle_threshold_ms,
            wander_min_ms: g.wander_min_ms,
            wander_max_ms: g.wander_max_ms,
            race_back_ms: g.race_back_ms,
            scroll_window_ms: g.scroll_window_ms,
            interactive_until: s.interactive_until,
            policy: Policy {
                detect_titles: g.detect_titles,
                detect_media: g.detect_media,
                detect_scroll: g.detect_scroll,
                titles: g.distraction_titles.clone(),
                scroll_events_threshold: g.scroll_events_threshold,
            },
        }
    }
}

pub fn tracker_loop(app: AppHandle) {
    loop {
        std::thread::sleep(Duration::from_millis(40));
        let id = *signals::TRACK.lock().unwrap();
        if let Some(id) = id { let _ = app.emit("target-rect", TargetEvent { id, target: platform::target_rect(id) }); }
        if signals::GAME_CURSOR.load(Ordering::Relaxed) {
            if let Some((x, y)) = platform::cursor_pos() { let _ = app.emit("game-cursor", CursorEv { x, y }); }
        }
    }
}

pub fn tick_loop(app: AppHandle, st: AppState, c: Arc<input::Counters>) {
    let mut machine = Machine::new(state::now_ms());
    let mut last_keys = 0u64;
    let mut last_wheel = 0u64;
    let mut wheel_hist: VecDeque<(u64, u64)> = VecDeque::new();
    let mut tick: u64 = 0;
    let (mut origin, mut monitors) = windows::fit_overlay(&app);
    let mut fg: Option<platform::Fg> = None;
    let mut media = false;
    let mut last_save = state::now_ms();
    let mut home_db = state::Debounce::new(st.lock().unwrap().data.settings.home_pos);
    let mut focus_at = state::now_ms();
    let mut scroll_latched = false;
    loop {
        std::thread::sleep(Duration::from_millis(250));
        tick += 1;
        let now = state::now_ms();
        let keys = c.keys.load(Ordering::Relaxed);
        let wheel = c.wheel.load(Ordering::Relaxed);
        let dk = keys - last_keys; last_keys = keys;
        let dw = wheel - last_wheel; last_wheel = wheel;
        if tick % 20 == 0 { let r = windows::fit_overlay(&app); origin = r.0; monitors = r.1; }

        if let Some((x, y, ..)) = home_geo::get() { home_db.note((x, y), now); }
        if let Some(p) = home_db.settled(now, 600) {
            let mut s = st.lock().unwrap();
            s.data.settings.home_pos = Some(p);
            s.dirty = true;
        }
        let cfg = { TickCfg::from_shared(&st.lock().unwrap()) };
        if cfg.interactive_until != 0 && now > cfg.interactive_until { windows::set_interactive(&app, &st, false); }
        let preview = signals::dash_peek(now, dk);
        if let Some(h) = preview { machine.hold(h.mode, now, h.until); }
        let dash_watch = preview.is_some_and(|h| h.mode == Mode::Watch);
        let idle = now.saturating_sub(machine.last_key) >= cfg.idle_ms;
        let (title, scrolls) = sample_distraction(&cfg, idle, tick, &mut fg, &mut media, &mut wheel_hist, now, dw);
        scroll_latched = idle && cfg.policy.detect_scroll && distraction::scroll_active(scroll_latched, scrolls, cfg.policy.scroll_events_threshold);
        let scrolls_for_reason = if scroll_latched { cfg.policy.scroll_events_threshold as u64 } else { 0 };
        let reason = if idle { distraction::reason(&cfg.policy, title.as_deref(), media, scrolls_for_reason) } else { None };
        if dash_watch && fg.is_none() { fg = watch_preview(&monitors); }

        let mode = machine.step(
            &Inputs { now, new_keys: dk, distracted: reason.is_some() || dash_watch, arrived: signals::RACE_ARRIVED.swap(false, Ordering::Relaxed) },
            &Params { idle_ms: cfg.idle_ms, race_ms: RACE_SAFETY_MS.max(cfg.race_back_ms) + RACE_HOLD_MS },
            || rand::thread_rng().gen_range(cfg.wander_min_ms..=cfg.wander_max_ms.max(cfg.wander_min_ms)),
        );
        if preview.is_some_and(|h| h.mode == Mode::RaceBack) && mode != Mode::RaceBack {
            signals::dash_clear_if_race();
        }

        let home = home_geo::get();
        let home_side = home.map_or("right", |h| windows::desk_side((h.0, h.1, h.2, h.3), &signals::REAL_MONS.lock().unwrap()));
        let dt = now.saturating_sub(focus_at).min(2_000);
        focus_at = now;
        let (view, credit, spoken) = {
            let mut s = st.lock().unwrap();
            let credit = s.data.credit(dk, now);
            if credit.changed { s.dirty = true; }
            if credit.completed.is_some() { s.save(); last_save = now; }
            let limit_ms = focus::limit_ms(s.data.settings.focus_minutes);
            let paused = c.paused.load(Ordering::Relaxed);
            let spoken = s.focus.tick(focus::TickIn { dt_ms: dt, mode, paused, keys: dk, limit_ms });
            let listener_error = c.listener_error.lock().unwrap().clone();
            let view = state::paint(&s, Frame {
                mode, paused, origin, monitors: monitors.clone(),
                fg: fg.clone(), reason: reason.clone(), home, home_side,
                force_hide: std::env::var("LWC_FORCE_HIDE").is_ok(), listener_error,
            });
            s.snap = Some(view.clone());
            if s.dirty && now - last_save > 2_000 { s.save(); last_save = now; }
            (view, credit, spoken)
        };
        let spoken = commands::settle_spoken(&st, spoken);
        let view = st.lock().unwrap().snap.clone().unwrap_or(view);
        let say = {
            let s = st.lock().unwrap();
            spoken.map(|sp| games::say_event(sp.kind, &sp.game, &s.data.settings.buddy_name, &crate::packs::packs_dir(&s.path), s.focus.prompt, s.focus.sprint_minutes))
        };
        let play = view.focus_phase == Phase::Play;
        let hit = play && games::wants_hit(&view.focus_game);
        windows::sync_game_chrome(&app, play, hit);
        let _ = app.emit("companion-state", &view);
        if let Some(say) = say { let _ = app.emit("focus-say", &say); }
        if let Some(n) = credit.notice { let _ = app.emit("notice", n); }
        if let Some(done) = credit.completed {
            let _ = app.emit("project-complete", &done);
            windows::open_window(&app, "projects");
        }
    }
}

/// A window-shaped rect on the primary monitor, so a Watch preview has somewhere to stand.
fn watch_preview(monitors: &[state::MonitorRect]) -> Option<platform::Fg> {
    let m = monitors.iter().find(|m| m.primary).or_else(|| monitors.first())?;
    let w = (m.w as i32 / 2).max(200).min(m.w as i32);
    let h = (m.h as i32 / 2).max(160).min(m.h as i32);
    Some(platform::Fg { id: 1, title: String::new(), x: m.x.saturating_add(48), y: m.y.saturating_add(48), w, h })
}

fn remember_fg(fg: &Option<platform::Fg>) {
    let id = fg.as_ref().map(|f| f.id).filter(|id| *id != 0).unwrap_or(0);
    signals::LAST_FG.store(id, Ordering::Relaxed);
}

fn sample_distraction(cfg: &TickCfg, idle: bool, tick: u64, fg: &mut Option<platform::Fg>, media: &mut bool, wheel_hist: &mut VecDeque<(u64, u64)>, now: u64, dw: u64) -> (Option<String>, u64) {
    if !idle { wheel_hist.clear(); *fg = None; remember_fg(fg); return (None, 0); }
    if tick % 4 == 0 { *fg = platform::foreground().filter(|f| !f.title.contains("Little Author")); }
    remember_fg(fg);
    if cfg.policy.detect_media && tick % 8 == 0 { *media = platform::media_playing(); }
    wheel_hist.push_back((now, dw));
    while wheel_hist.front().map_or(false, |(t, _)| now - t > cfg.scroll_window_ms) { wheel_hist.pop_front(); }
    let scrolls = wheel_hist.iter().map(|x| x.1).sum();
    (fg.as_ref().map(|f| f.title.clone()), scrolls)
}
