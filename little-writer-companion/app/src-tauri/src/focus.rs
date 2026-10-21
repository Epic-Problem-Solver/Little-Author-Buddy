//! Focus streak. Quiet time counts. A distraction clears it. The game waits for a click.
//! Setting the limit to 0 turns the invitation off. Nothing here reads the cursor.

use crate::idle::Mode;
use serde::Serialize;

pub const MAX_MINUTES: u32 = crate::store::MAX_FOCUS_MINUTES;
const PLAY_MS: u64 = 45_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase { Idle, Explain, Play }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind { Invite, Explain, Away }

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self { Kind::Invite => "invite", Kind::Explain => "explain", Kind::Away => "away" }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spoken { pub kind: Kind, pub game: String }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Session {
    pub elapsed_ms: u64,
    pub ready: bool,
    pub phase: Phase,
    pub game: String,
    pub play_ms: u64,
}

impl Default for Session {
    fn default() -> Self {
        Self { elapsed_ms: 0, ready: false, phase: Phase::Idle, game: String::new(), play_ms: 0 }
    }
}

pub struct TickIn {
    pub dt_ms: u64,
    pub mode: Mode,
    pub paused: bool,
    pub keys: u64,
    pub limit_ms: u64,
}

pub fn limit_ms(minutes: u32) -> u64 { (minutes.min(MAX_MINUTES) as u64) * 60_000 }

impl Session {
    fn clear(&mut self) { *self = Session::default(); }

    /// Advance the streak. `dt_ms` is this tick only. A distraction (`Watch`) clears it.
    /// Paused time does not count. Reaching the limit invites once and then waits.
    pub fn tick(&mut self, t: TickIn) -> Option<Spoken> {
        if t.limit_ms == 0 { self.clear(); return None; }
        if self.phase == Phase::Play {
            if t.paused { return None; }
            if t.keys > 0 || t.mode == Mode::Watch { self.clear(); return None; }
            self.play_ms = self.play_ms.saturating_add(t.dt_ms);
            if self.play_ms >= PLAY_MS {
                let game = self.game.clone();
                self.clear();
                return Some(Spoken { kind: Kind::Away, game });
            }
            return None;
        }
        if t.paused { return None; }
        if t.mode == Mode::Watch { self.clear(); return None; }
        if self.ready { return None; }
        self.elapsed_ms = self.elapsed_ms.saturating_add(t.dt_ms);
        if self.elapsed_ms >= t.limit_ms {
            self.elapsed_ms = t.limit_ms;
            self.ready = true;
            return Some(Spoken { kind: Kind::Invite, game: String::new() });
        }
        None
    }

    /// A desk click. The first names the game and asks Buddy to explain it.
    /// The next click on that same game starts play. Writing is not interrupted before that.
    pub fn press(&mut self, game: &str) -> Option<Spoken> {
        if !self.ready || self.phase == Phase::Play || game.is_empty() { return None; }
        if self.phase == Phase::Explain && self.game == game {
            self.phase = Phase::Play;
            self.play_ms = 0;
            self.elapsed_ms = 0;
            self.ready = false;
            return None;
        }
        self.phase = Phase::Explain;
        self.game = game.to_string();
        Some(Spoken { kind: Kind::Explain, game: game.to_string() })
    }

    /// The break is over. A second call does nothing, so a late click cannot clear a new streak.
    pub fn finish(&mut self) -> bool {
        if self.phase != Phase::Play { return false; }
        self.clear();
        true
    }

    /// The minute setting changed. A longer goal drops a waiting invitation and keeps elapsed time.
    /// A game that already started is left alone.
    pub fn limit(&mut self, limit_ms: u64) -> Option<Spoken> {
        if self.phase == Phase::Play { return None; }
        if limit_ms == 0 { self.clear(); return None; }
        if self.elapsed_ms >= limit_ms {
            self.elapsed_ms = limit_ms;
            let fresh = !self.ready;
            self.ready = true;
            if fresh {
                self.phase = Phase::Idle;
                self.game.clear();
                return Some(Spoken { kind: Kind::Invite, game: String::new() });
            }
            None
        } else {
            self.ready = false;
            self.phase = Phase::Idle;
            self.game.clear();
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tick(s: &mut Session, dt: u64, mode: Mode, paused: bool, keys: u64, limit_ms: u64) -> Option<Spoken> {
        s.tick(TickIn { dt_ms: dt, mode, paused, keys, limit_ms })
    }

    #[test]
    fn quiet_modes_count_and_watch_resets() {
        let mut s = Session::default();
        let limit = 10_000;
        assert!(tick(&mut s, 3_000, Mode::Typing, false, 0, limit).is_none());
        assert_eq!(s.elapsed_ms, 3_000);
        assert!(tick(&mut s, 2_000, Mode::Asleep, false, 0, limit).is_none());
        assert!(tick(&mut s, 2_000, Mode::Wander, false, 0, limit).is_none());
        assert!(tick(&mut s, 1_000, Mode::RaceBack, false, 0, limit).is_none());
        assert_eq!(s.elapsed_ms, 8_000);
        assert!(tick(&mut s, 1_000, Mode::Watch, false, 0, limit).is_none());
        assert_eq!(s.elapsed_ms, 0);
        assert!(!s.ready);
    }

    #[test]
    fn paused_does_not_count() {
        let mut s = Session::default();
        assert!(tick(&mut s, 5_000, Mode::Typing, true, 0, 10_000).is_none());
        assert_eq!(s.elapsed_ms, 0);
    }

    #[test]
    fn zero_minutes_stays_off() {
        let mut s = Session::default();
        s.elapsed_ms = 50_000;
        s.ready = true;
        assert!(tick(&mut s, 1_000, Mode::Typing, false, 0, 0).is_none());
        assert_eq!(s, Session::default());
    }

    #[test]
    fn invite_fires_once_and_waits_for_a_click() {
        let mut s = Session::default();
        let n = tick(&mut s, 500, Mode::Typing, false, 0, 1_000);
        assert!(n.is_none());
        let n = tick(&mut s, 500, Mode::Asleep, false, 0, 1_000).unwrap();
        assert_eq!(n.kind, Kind::Invite);
        assert!(s.ready);
        assert_eq!(s.elapsed_ms, 1_000);
        assert!(tick(&mut s, 5_000, Mode::Wander, false, 0, 1_000).is_none());
        assert_eq!(s.elapsed_ms, 1_000);
        assert_eq!(s.phase, Phase::Idle);
    }

    #[test]
    fn watch_cancels_a_waiting_invitation() {
        let mut s = Session::default();
        tick(&mut s, 1_000, Mode::Typing, false, 0, 1_000);
        s.press("chase");
        assert_eq!(s.phase, Phase::Explain);
        tick(&mut s, 100, Mode::Watch, false, 0, 1_000);
        assert_eq!(s, Session::default());
    }

    #[test]
    fn two_clicks_explain_then_play() {
        let mut s = Session::default();
        tick(&mut s, 1_000, Mode::Typing, false, 0, 1_000);
        let n = s.press("chase").unwrap();
        assert_eq!(n.kind, Kind::Explain);
        assert_eq!(s.phase, Phase::Explain);
        assert!(s.press("chase").is_none());
        assert_eq!(s.phase, Phase::Play);
        assert!(!s.ready);
        assert_eq!(s.elapsed_ms, 0);
        assert!(tick(&mut s, 10_000, Mode::Typing, false, 0, 1_000).is_none());
        assert_eq!(s.phase, Phase::Play);
        assert!(!s.ready);
    }

    #[test]
    fn a_different_game_explains_again() {
        let mut s = Session::default();
        s.ready = true;
        s.press("chase");
        let n = s.press("tag").unwrap();
        assert_eq!(n.game, "tag");
        assert_eq!(s.phase, Phase::Explain);
        assert!(s.press("tag").is_none());
        assert_eq!(s.phase, Phase::Play);
        assert_eq!(s.game, "tag");
    }

    #[test]
    fn keys_end_play_without_a_line() {
        let mut s = Session::default();
        s.phase = Phase::Play;
        s.game = "tag".into();
        assert!(tick(&mut s, 100, Mode::RaceBack, false, 3, 60_000).is_none());
        assert_eq!(s.phase, Phase::Idle);
    }

    #[test]
    fn play_times_out_with_an_away_line() {
        let mut s = Session::default();
        s.phase = Phase::Play;
        s.game = "tag".into();
        assert!(tick(&mut s, 44_000, Mode::Wander, false, 0, 60_000).is_none());
        let n = tick(&mut s, 1_000, Mode::Wander, false, 0, 60_000).unwrap();
        assert_eq!(n.kind, Kind::Away);
        assert_eq!(n.game, "tag");
        assert_eq!(s.phase, Phase::Idle);
    }

    #[test]
    fn paused_play_does_not_run_out() {
        let mut s = Session::default();
        s.phase = Phase::Play;
        s.game = "chase".into();
        tick(&mut s, 50_000, Mode::Typing, true, 0, 60_000);
        assert_eq!(s.phase, Phase::Play);
        assert_eq!(s.play_ms, 0);
    }

    #[test]
    fn longer_goal_keeps_elapsed_and_drops_ready() {
        let mut s = Session::default();
        s.elapsed_ms = 1_000;
        s.ready = true;
        s.phase = Phase::Explain;
        s.game = "chase".into();
        assert!(s.limit(5_000).is_none());
        assert!(!s.ready);
        assert_eq!(s.elapsed_ms, 1_000);
        assert_eq!(s.phase, Phase::Idle);
    }

    #[test]
    fn shorter_goal_invites_once() {
        let mut s = Session::default();
        s.elapsed_ms = 5_000;
        let n = s.limit(2_000).unwrap();
        assert_eq!(n.kind, Kind::Invite);
        assert!(s.ready);
        assert!(s.limit(2_000).is_none());
    }

    #[test]
    fn finish_only_ends_play() {
        let mut s = Session::default();
        s.ready = true;
        s.elapsed_ms = 30;
        assert!(!s.finish());
        assert!(s.ready);
        s.phase = Phase::Play;
        assert!(s.finish());
        assert_eq!(s, Session::default());
        assert!(!s.finish());
    }

    #[test]
    fn old_save_defaults_focus_to_thirty_minutes() {
        let d: crate::store::Data = serde_json::from_str(r#"{"settings":{"buddy_name":"Inky"}}"#).unwrap();
        assert_eq!(d.settings.focus_minutes, 30);
    }
}
