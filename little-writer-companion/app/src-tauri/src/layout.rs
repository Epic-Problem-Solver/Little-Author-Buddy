//! Layout and timing numbers shared with `ui/domain.js` and `ui/motion.js`.
//! `ui/tests/layout_fixture.json` is the contract that keeps the two sides equal.

pub const RACE_HOLD_MS: u64 = 1_000;
/// The race ends when the overlay reports arrival. This is only the safety net.
pub const RACE_SAFETY_MS: u64 = 8_000;
// The desk draws these in ui/motion.js. They stay here so the layout fixture can fail a Rust
// build when the two sides drift. Nothing in this crate reads them at runtime.
#[allow(dead_code)]
pub const HOME_MAX_SCALE: f64 = 1.3;
#[allow(dead_code)] pub const DESK_ANCHOR_X: f64 = 40.0;
#[allow(dead_code)] pub const DESK_ANCHOR_Y: f64 = 30.0;
#[allow(dead_code)] pub const BODY_CENTER_RIGHT: f64 = 180.0;
#[allow(dead_code)] pub const BODY_CENTER_LEFT: f64 = 60.0;
#[allow(dead_code)] pub const BODY_CENTER_AWAY: f64 = 120.0;
#[allow(dead_code)] pub const BODY_CENTER_Y: f64 = 110.0;
/// Desk pose only. The rig is scaled 1.25 about (120, 172) and shifted +60, so the body centre drops to y 94.5.
#[allow(dead_code)] pub const DESK_BODY_CENTER_Y: f64 = 94.5;
/// Wander sprite. 1.25× the 120×110 home host so the body matches the desk rig.
#[allow(dead_code)] pub const SPRITE_W: f64 = 150.0;
#[allow(dead_code)] pub const SPRITE_H: f64 = 137.5;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_js_layout_fixture() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../ui/tests/layout_fixture.json")).unwrap();
        let n = |k: &str| v[k].as_f64().unwrap();
        assert_eq!(n("race_hold_ms") as u64, RACE_HOLD_MS);
        assert_eq!(n("home_max_scale"), HOME_MAX_SCALE);
        assert_eq!(n("desk_anchor_x"), DESK_ANCHOR_X);
        assert_eq!(n("desk_anchor_y"), DESK_ANCHOR_Y);
        assert_eq!(n("body_center_right"), BODY_CENTER_RIGHT);
        assert_eq!(n("body_center_left"), BODY_CENTER_LEFT);
        assert_eq!(n("body_center_away"), BODY_CENTER_AWAY);
        assert_eq!(n("body_center_y"), BODY_CENTER_Y);
        assert_eq!(n("desk_body_center_y"), DESK_BODY_CENTER_Y);
        assert_eq!(n("sprite_w"), SPRITE_W);
        assert_eq!(n("sprite_h"), SPRITE_H);
    }
}
