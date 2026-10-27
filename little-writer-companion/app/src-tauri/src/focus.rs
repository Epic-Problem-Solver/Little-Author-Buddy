//! Silent writing wait. Fifteen minutes of typing suggests one game from the desk.
//! Sleep, wandering, and watching start that wait over. Typing is not stopped.
//! Nothing here reads the cursor or a window title.

use crate::idle::Mode;
use serde::Serialize;

pub const MAX_MINUTES: u32 = crate::store::MAX_FOCUS_MINUTES;
const PLAY_MS: u64 = 45_000;
/// Uninterrupted writing before Buddy suggests a game. Not shown on the desk.
pub const SUGGEST_MS: u64 = 15 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Ask,
    Explain,
    Play,
    Back,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind { Invite, Ask, Explain, Decline, Away, Sprint, Suggest }

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Invite => "invite",
            Kind::Ask => "ask",
            Kind::Explain => "explain",
            Kind::Decline => "decline",
            Kind::Away => "away",
            Kind::Sprint => "sprint",
            Kind::Suggest => "suggest",
        }
    }
}

/// Which question the sprint window is asking. `Sprint` is the follow-up after a no.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Prompt {
    #[default]
    Game,
    Sprint,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spoken { pub kind: Kind, pub game: String }

/// Active-window rectangle in physical pixels. The title is never stored.
pub type Anchor = (i32, i32, i32, i32);

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Session {
    pub elapsed_ms: u64,
    pub ready: bool,
    pub running: bool,
    pub held: bool,
    pub phase: Phase,
    pub game: String,
    pub play_ms: u64,
    pub anchor: Option<Anchor>,
    pub prompt: Prompt,
    /// Writing time of the sprint that just finished, rounded to minutes, at least 1.
    pub sprint_minutes: u32,
}

pub struct TickIn {
    pub dt_ms: u64,
    pub mode: Mode,
    pub paused: bool,
    pub keys: u64,
    /// Still passed in from the saved minute setting. The suggestion wait does not read it.
    #[allow(dead_code)]
    pub limit_ms: u64,
}

pub fn limit_ms(minutes: u32) -> u64 { (minutes.min(MAX_MINUTES) as u64) * 60_000 }

/// `roll` picks one id. An empty list offers nothing.
pub fn choose_id(ids: &[String], roll: u64) -> Option<String> {
    if ids.is_empty() { None } else { Some(ids[(roll as usize) % ids.len()].clone()) }
}

impl Session {
    fn clear(&mut self) { *self = Session::default(); }

    /// Begin or resume. A second Start on a running timer leaves the time alone.
    /// A finished timer starts over. Ask, explain, play, and the walk back ignore it.
    pub fn start(&mut self) -> bool {
        if self.phase != Phase::Idle { return false; }
        if self.held {
            self.held = false;
            self.running = true;
            return true;
        }
        if self.running { return false; }
        if self.ready {
            self.ready = false;
            self.elapsed_ms = 0;
            self.game.clear();
            self.anchor = None;
        }
        self.running = true;
        true
    }

    /// Freeze a running idle timer. Resume with Start.
    pub fn pause(&mut self) -> bool {
        if self.phase != Phase::Idle || !self.running { return false; }
        self.running = false;
        self.held = true;
        true
    }

    /// Advance one tick. Writing time suggests a game and then starts over.
    /// Sleep, wandering, and watching clear that wait. Tray pause holds it.
    /// Play is unchanged: letter keys end it, and 45 seconds says the away line.
    pub fn tick(&mut self, t: TickIn) -> Option<Spoken> {
        if self.phase == Phase::Play {
            if t.paused { return None; }
            if t.keys > 0 { self.clear(); return None; }
            self.play_ms = self.play_ms.saturating_add(t.dt_ms);
            if self.play_ms >= PLAY_MS {
                let game = self.game.clone();
                self.clear();
                return Some(Spoken { kind: Kind::Away, game });
            }
            return None;
        }
        if self.phase != Phase::Idle { return None; }
        if matches!(t.mode, Mode::Asleep | Mode::Wander | Mode::Watch) {
            self.elapsed_ms = 0;
            return None;
        }
        if t.mode != Mode::Typing || t.paused { return None; }
        self.elapsed_ms = self.elapsed_ms.saturating_add(t.dt_ms);
        if self.elapsed_ms >= SUGGEST_MS {
            self.elapsed_ms = 0;
            return Some(Spoken { kind: Kind::Suggest, game: String::new() });
        }
        None
    }

    /// Start one game from the Games window. The desk wait starts over afterwards.
    pub fn begin_play(&mut self, game: &str, anchor: Option<Anchor>) -> bool {
        if !crate::games::known(game) { return false; }
        self.clear();
        self.phase = Phase::Play;
        self.game = game.to_string();
        self.anchor = anchor;
        self.play_ms = 0;
        true
    }

    fn note_minutes(&mut self) {
        let rounded = (self.elapsed_ms.saturating_add(30_000) / 60_000).max(1);
        self.sprint_minutes = u32::try_from(rounded).unwrap_or(u32::MAX);
    }

    /// The timer finished and a pack is installed. Buddy asks about that game.
    pub fn begin_ask(&mut self, game: &str, anchor: Option<Anchor>) -> Option<Spoken> {
        if !self.ready || self.phase != Phase::Idle || game.is_empty() { return None; }
        self.phase = Phase::Ask;
        self.prompt = Prompt::Game;
        self.game = game.to_string();
        self.anchor = anchor;
        self.running = false;
        self.held = false;
        Some(Spoken { kind: Kind::Ask, game: self.game.clone() })
    }

    /// No pack is installed, or the writer declined the game. Ask about another sprint.
    pub fn begin_sprint_ask(&mut self) -> Option<Spoken> {
        if !self.ready || self.phase != Phase::Idle { return None; }
        self.phase = Phase::Ask;
        self.prompt = Prompt::Sprint;
        self.game.clear();
        self.anchor = None;
        self.running = false;
        self.held = false;
        Some(Spoken { kind: Kind::Ask, game: String::new() })
    }

    /// Y on a game explains it. N asks about another sprint.
    /// Y on that sprint starts it. N ends the question. Ignored unless he is asking.
    pub fn answer(&mut self, yes: bool) -> Option<Spoken> {
        if self.phase != Phase::Ask { return None; }
        if self.prompt == Prompt::Sprint {
            if yes {
                self.clear();
                self.running = true;
                return Some(Spoken { kind: Kind::Sprint, game: String::new() });
            }
            let game = self.game.clone();
            self.clear();
            return Some(Spoken { kind: Kind::Decline, game });
        }
        if yes {
            self.phase = Phase::Explain;
            self.prompt = Prompt::Game;
            return Some(Spoken { kind: Kind::Explain, game: self.game.clone() });
        }
        self.phase = Phase::Ask;
        self.prompt = Prompt::Sprint;
        self.game.clear();
        self.anchor = None;
        self.running = false;
        self.held = false;
        Some(Spoken { kind: Kind::Ask, game: String::new() })
    }

    /// The question window closed. That is a no. Closing during the explanation
    /// ends the question and does not start play.
    pub fn dismiss(&mut self) -> Option<Spoken> {
        match self.phase {
            Phase::Ask => self.answer(false),
            Phase::Explain => {
                let game = self.game.clone();
                self.clear();
                Some(Spoken { kind: Kind::Decline, game })
            }
            Phase::Idle | Phase::Play | Phase::Back => None,
        }
    }

    /// The click after the explanation starts play.
    pub fn ready_click(&mut self) -> bool {
        if self.phase != Phase::Explain { return false; }
        self.phase = Phase::Play;
        self.play_ms = 0;
        self.elapsed_ms = 0;
        self.ready = false;
        self.running = false;
        self.held = false;
        true
    }

    /// He reached the desk after a no. The next Start is a new session.
    pub fn back_arrived(&mut self) -> bool {
        if self.phase != Phase::Back { return false; }
        self.clear();
        true
    }

    /// The break is over. A second call does nothing, so a late click cannot clear a new streak.
    pub fn finish(&mut self) -> bool {
        if self.phase != Phase::Play { return false; }
        self.clear();
        true
    }

    /// The minute setting changed. A game already under way is left alone.
    /// A shorter goal that is already past invites once.
    pub fn limit(&mut self, limit_ms: u64) -> Option<Spoken> {
        if limit_ms == 0 { self.clear(); return None; }
        if self.phase != Phase::Idle { return None; }
        if self.elapsed_ms >= limit_ms {
            self.elapsed_ms = limit_ms;
            self.running = false;
            self.held = false;
            if self.ready { return None; }
            self.ready = true;
            self.note_minutes();
            self.game.clear();
            self.anchor = None;
            return Some(Spoken { kind: Kind::Invite, game: String::new() });
        }
        self.ready = false;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tick(s: &mut Session, dt: u64, mode: Mode, paused: bool, keys: u64, limit_ms: u64) -> Option<Spoken> {
        s.tick(TickIn { dt_ms: dt, mode, paused, keys, limit_ms })
    }

    #[test]
    fn fifteen_minutes_of_writing_suggests_without_leaving_the_desk() {
        let mut s = Session::default();
        assert!(tick(&mut s, 5_000, Mode::Typing, false, 0, 0).is_none());
        assert_eq!(s.elapsed_ms, 5_000);
        assert_eq!(s.phase, Phase::Idle);
        assert!(tick(&mut s, SUGGEST_MS - 5_001, Mode::Typing, false, 0, 0).is_none());
        assert_eq!(s.elapsed_ms, SUGGEST_MS - 1);
        let n = tick(&mut s, 1, Mode::Typing, false, 0, 0).unwrap();
        assert_eq!(n.kind, Kind::Suggest);
        assert_eq!(s.elapsed_ms, 0);
        assert_eq!(s.phase, Phase::Idle);
        assert!(!s.ready);
        tick(&mut s, 60_000, Mode::Typing, false, 0, 0);
        assert_eq!(s.elapsed_ms, 60_000);
        for mode in [Mode::Asleep, Mode::Wander, Mode::Watch] {
            assert!(tick(&mut s, 2_000, mode, false, 0, 0).is_none());
            assert_eq!(s.elapsed_ms, 0);
        }
        tick(&mut s, 4_000, Mode::Typing, false, 0, 0);
        assert!(tick(&mut s, 2_000, Mode::RaceBack, false, 0, 0).is_none());
        assert_eq!(s.elapsed_ms, 4_000);
        assert!(tick(&mut s, SUGGEST_MS, Mode::Typing, false, 0, 0).unwrap().kind == Kind::Suggest);
        assert!(s.begin_play("chase", None));
        assert_eq!(s.phase, Phase::Play);
        assert!(!s.begin_play("nope", None));
    }

    #[test]
    fn start_and_pause_do_not_gate_the_wait() {
        let mut s = Session::default();
        assert!(s.start());
        assert!(!s.start());
        tick(&mut s, 3_000, Mode::Typing, false, 0, 0);
        assert!(s.pause());
        assert!(s.held);
        tick(&mut s, 2_000, Mode::Typing, false, 0, 0);
        assert_eq!(s.elapsed_ms, 5_000);
        assert!(s.start());
        assert!(!s.held);
    }

    #[test]
    fn tray_pause_does_not_count() {
        let mut s = Session::default();
        tick(&mut s, 4_000, Mode::Typing, false, 0, 0);
        assert!(tick(&mut s, 5_000, Mode::Typing, true, 0, 0).is_none());
        assert_eq!(s.elapsed_ms, 4_000);
    }

    #[test]
    fn the_minute_setting_does_not_stop_the_wait() {
        let mut s = Session::default();
        assert!(tick(&mut s, 1_000, Mode::Typing, false, 0, 0).is_none());
        assert_eq!(s.elapsed_ms, 1_000);
        assert_eq!(s.phase, Phase::Idle);
    }

    #[test]
    fn watch_does_not_cancel_an_explanation() {
        let mut s = Session::default();
        s.ready = true;
        s.begin_ask("chase", None);
        s.answer(true);
        tick(&mut s, 100, Mode::Watch, false, 0, 1_000);
        assert_eq!(s.phase, Phase::Explain);
        assert_eq!(s.game, "chase");
    }

    #[test]
    fn choose_id_stays_inside_the_list() {
        assert!(choose_id(&[], 3).is_none());
        let ids = ["chase", "tag", "redlight"].map(str::to_string);
        for roll in 0..12 {
            let id = choose_id(&ids, roll).unwrap();
            assert!(ids.iter().any(|s| s == &id));
        }
        assert_eq!(choose_id(&ids, 0).unwrap(), "chase");
        assert_eq!(choose_id(&ids, 4).unwrap(), "tag");
    }

    #[test]
    fn y_explains_and_the_click_starts_play() {
        let mut s = Session::default();
        s.ready = true;
        let n = s.begin_ask("chase", Some((8, 9, 200, 100))).unwrap();
        assert_eq!(n.kind, Kind::Ask);
        assert_eq!(s.anchor, Some((8, 9, 200, 100)));
        let n = s.answer(true).unwrap();
        assert_eq!(n.kind, Kind::Explain);
        assert_eq!(s.phase, Phase::Explain);
        assert!(s.ready_click());
        assert_eq!(s.phase, Phase::Play);
        assert!(!s.ready);
        assert_eq!(s.elapsed_ms, 0);
        assert_eq!(s.game, "chase");
        assert!(tick(&mut s, 10_000, Mode::Typing, false, 0, 1_000).is_none());
        assert_eq!(s.phase, Phase::Play);
    }

    #[test]
    fn closing_the_question_is_a_no() {
        let mut ask = Session::default();
        ask.ready = true;
        ask.sprint_minutes = 12;
        ask.begin_ask("chase", Some((1, 2, 3, 4)));
        let n = ask.dismiss().unwrap();
        assert_eq!(n.kind, Kind::Ask);
        assert_eq!(ask.phase, Phase::Ask);
        assert_eq!(ask.prompt, Prompt::Sprint);
        assert_eq!(ask.sprint_minutes, 12);
        let n = ask.dismiss().unwrap();
        assert_eq!(n.kind, Kind::Decline);
        assert_eq!(ask.phase, Phase::Idle);

        let mut explained = Session::default();
        explained.ready = true;
        explained.begin_ask("tag", None);
        explained.answer(true);
        let n = explained.dismiss().unwrap();
        assert_eq!(n.kind, Kind::Decline);
        assert_eq!(explained.phase, Phase::Idle);
        assert!(explained.game.is_empty());

        let mut playing = Session::default();
        playing.phase = Phase::Play;
        playing.game = "chase".into();
        assert!(playing.dismiss().is_none());
        assert_eq!(playing.phase, Phase::Play);
        assert!(Session::default().dismiss().is_none());
    }

    #[test]
    fn n_asks_about_another_sprint_and_y_starts_it() {
        let mut s = Session::default();
        s.ready = true;
        s.elapsed_ms = 90_000;
        s.note_minutes();
        assert_eq!(s.sprint_minutes, 2);
        s.begin_ask("tag", Some((1, 2, 3, 4)));
        let n = s.answer(false).unwrap();
        assert_eq!(n.kind, Kind::Ask);
        assert_eq!(s.prompt, Prompt::Sprint);
        assert_eq!(s.phase, Phase::Ask);
        let n = s.answer(true).unwrap();
        assert_eq!(n.kind, Kind::Sprint);
        assert!(s.running);
        assert_eq!(s.phase, Phase::Idle);
        assert_eq!(s.elapsed_ms, 0);
    }

    #[test]
    fn a_second_no_clears_the_question() {
        let mut s = Session::default();
        s.ready = true;
        s.begin_ask("tag", Some((1, 2, 3, 4)));
        s.answer(false);
        let n = s.answer(false).unwrap();
        assert_eq!(n.kind, Kind::Decline);
        assert_eq!(s, Session::default());
        assert!(!s.back_arrived());
    }

    #[test]
    fn no_pack_asks_about_another_sprint() {
        let mut s = Session::default();
        s.ready = true;
        s.sprint_minutes = 5;
        let n = s.begin_sprint_ask().unwrap();
        assert_eq!(n.kind, Kind::Ask);
        assert_eq!(s.prompt, Prompt::Sprint);
        assert!(s.begin_sprint_ask().is_none());
    }

    #[test]
    fn y_and_n_outside_the_question_do_nothing() {
        let mut s = Session::default();
        s.start();
        s.elapsed_ms = 40;
        assert!(s.answer(true).is_none());
        assert!(s.answer(false).is_none());
        assert!(!s.ready_click());
        assert_eq!(s.elapsed_ms, 40);
        assert_eq!(s.phase, Phase::Idle);
        assert!(s.running);
    }

    #[test]
    fn start_and_pause_wait_during_the_question() {
        let mut s = Session::default();
        s.ready = true;
        s.begin_ask("chase", None);
        assert!(!s.start());
        assert!(!s.pause());
        assert_eq!(s.phase, Phase::Ask);
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
        let n = tick(&mut s, 1_000, Mode::Watch, false, 0, 60_000).unwrap();
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
    fn longer_goal_keeps_elapsed() {
        let mut s = Session::default();
        s.start();
        s.elapsed_ms = 1_000;
        assert!(s.limit(5_000).is_none());
        assert!(!s.ready);
        assert!(s.running);
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
        assert!(!s.running);
        assert!(s.limit(2_000).is_none());
    }

    #[test]
    fn a_game_under_way_keeps_its_phase_when_minutes_change() {
        let mut s = Session::default();
        s.phase = Phase::Explain;
        s.game = "chase".into();
        assert!(s.limit(5_000).is_none());
        assert_eq!(s.phase, Phase::Explain);
        assert_eq!(s.game, "chase");
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
        let d: crate::store::Data = serde_json::from_str(r#"{"settings":{"buddy_name":"Buddy"}}"#).unwrap();
        assert_eq!(d.settings.focus_minutes, 30);
    }
}
