//! Pure idle state machine (no I/O) so it can be unit-tested.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode { Typing, Asleep, Wander, Watch, RaceBack }

/// `arrived`: the overlay reported that the race-back runner reached the desk (BUG-23: arrival-driven hand-off).
pub struct Inputs { pub now: u64, pub new_keys: u64, pub distracted: bool, pub arrived: bool }

/// race_ms is now only a SAFETY timeout for the race-back (normally it ends when the runner arrives).
pub struct Params { pub idle_ms: u64, pub race_ms: u64 }

pub struct Machine {
    pub mode: Mode,
    pub last_key: u64,
    pub wander_at: u64,
    race_until: u64,
}

impl Machine {
    pub fn new(now: u64) -> Self { Self { mode: Mode::Typing, last_key: now, wander_at: u64::MAX, race_until: 0 } }

    /// `wander_delay` is called when falling asleep to pick a random 1-5 min delay.
    pub fn step(&mut self, i: &Inputs, p: &Params, mut wander_delay: impl FnMut() -> u64) -> Mode {
        use Mode::*;
        if self.mode == RaceBack && i.arrived { self.mode = Typing; self.last_key = self.last_key.max(i.now.saturating_sub(1)); return self.mode; }
        if i.new_keys > 0 {
            self.last_key = i.now;
            self.mode = match self.mode {
                Asleep | Wander | Watch => { self.race_until = i.now + p.race_ms; RaceBack }
                RaceBack if i.now < self.race_until => RaceBack,
                _ => Typing,
            };
            return self.mode;
        }
        if self.mode == RaceBack {
            if i.now >= self.race_until { self.mode = Typing; }
            return self.mode;
        }
        let idle = i.now.saturating_sub(self.last_key);
        if idle < p.idle_ms { self.mode = Typing; return self.mode; }
        if i.distracted { self.mode = Watch; return self.mode; }
        match self.mode {
            Typing => { self.mode = Asleep; self.wander_at = i.now + wander_delay(); }
            // distraction ended: resume wandering instead of re-sleeping (BUG-12)
            Watch => self.mode = Wander,
            Asleep if i.now >= self.wander_at => self.mode = Wander,
            _ => {}
        }
        self.mode
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(m: &mut Machine, now: u64, keys: u64, d: bool) -> Mode {
        m.step(&Inputs { now, new_keys: keys, distracted: d, arrived: false }, &Params { idle_ms: 20_000, race_ms: 1_500 }, || 60_000)
    }
    #[test]
    fn full_cycle() {
        let mut m = Machine::new(0);
        assert_eq!(run(&mut m, 1_000, 3, false), Mode::Typing);
        assert_eq!(run(&mut m, 15_000, 0, false), Mode::Typing);
        assert_eq!(run(&mut m, 21_000, 0, false), Mode::Asleep);
        assert_eq!(run(&mut m, 60_000, 0, false), Mode::Asleep);
        assert_eq!(run(&mut m, 81_000, 0, false), Mode::Wander);
        assert_eq!(run(&mut m, 90_000, 0, true), Mode::Watch);
        assert_eq!(run(&mut m, 91_000, 1, false), Mode::RaceBack);
        assert_eq!(run(&mut m, 92_000, 1, false), Mode::RaceBack);
        assert_eq!(run(&mut m, 92_600, 0, false), Mode::Typing);
    }
    #[test]
    fn distraction_overrides_sleep_then_returns() {
        let mut m = Machine::new(0);
        assert_eq!(run(&mut m, 25_000, 0, false), Mode::Asleep);
        assert_eq!(run(&mut m, 26_000, 0, true), Mode::Watch);
        assert_eq!(run(&mut m, 27_000, 0, false), Mode::Wander);
    }

    #[test]
    fn race_back_ends_on_arrival_not_timer() {
        let p = Params { idle_ms: 20_000, race_ms: 9_000 };
        let st = |m: &mut Machine, now, keys, arrived| m.step(&Inputs { now, new_keys: keys, distracted: false, arrived }, &p, || 60_000);
        let mut m = Machine::new(0);
        assert_eq!(st(&mut m, 30_000, 0, false), Mode::Asleep);
        assert_eq!(st(&mut m, 31_000, 3, false), Mode::RaceBack);
        // a long run: still racing well past the old 1.5 s + 1 s timer, keys keep coming (and keep counting)
        assert_eq!(st(&mut m, 34_000, 2, false), Mode::RaceBack);
        assert_eq!(st(&mut m, 35_000, 0, false), Mode::RaceBack);
        // runner reports arrival -> hand-off right away
        assert_eq!(st(&mut m, 35_100, 0, true), Mode::Typing);
        // a stale arrival outside a race does nothing
        assert_eq!(st(&mut m, 35_200, 1, true), Mode::Typing);
        // safety timeout if the UI never reports
        let mut m = Machine::new(0);
        st(&mut m, 30_000, 0, false); st(&mut m, 31_000, 1, false);
        assert_eq!(st(&mut m, 39_999, 0, false), Mode::RaceBack);
        assert_eq!(st(&mut m, 40_000, 0, false), Mode::Typing);
    }
}
