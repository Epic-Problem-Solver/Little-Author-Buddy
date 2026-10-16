# Test Results: v0.6.1 (art v0.8). Linux Xvfb :85 + xfwm4 compositor
Tester, 2026-10-15. Time-box about 40 min. Evidence: test-evidence/v0.6.1/

| Check | Result | Evidence |
|---|---|---|
| Build fresh | PASS | newest source lib.rs 11:07:15; deb 11:09:43, binary/AppImage 11:10:34, NSIS 11:12:16 |
| Unit tests | PASS | cargo 25/25; node --test 15/15 |
| BUG-22 fresh profile | PASS | xwininfo: 1720,880 200x200 → bottom 1080, fully on-screen |
| BUG-22 saved [100,950] | PASS | xwininfo: 100,880 200x200 |
| Race-back end, R100 (desk right half, 100%) | FAIL (pop) | ffmpeg x11grab 30 fps; head blob tracked per frame. Running buddy still moving about 18 px/frame: f94 (1424,706), f95 (1442,696). f96: BOTH sprites visible (runner at 1448,693 and desk buddy at 1525,677). f97: runner gone. **Jump Δx=+77, Δy=−16 px**, one frame of double image, runner drawn partly behind the desk. Size matches (head 50 px both). raceback_R100_f92-97.png, raceback_R100.gif |
| Race-back end, L100 | PASS (small snap) | runner eases in to (387,677) by f90; desk buddy appears at (373,677) at f93 → Δx −14, Δy 0. Size match. raceback_L100_f86-94.png |
| Race-back end, R130 | PASS (small snap) | runner settles at (1515,659) f87–95; desk buddy at (1533,659) at f98 → Δx +18, Δy 0. Size match (65 px both). raceback_R130_f93-99.png |
| Race-back end, L130 | PASS | runner eases 402→365 (f93–97); desk buddy at 365–366 → Δ ≈ 0-1 px, no size change. raceback_L130_f92-98.png |
| Hand layering running left | PASS | L130 f80–86: face toward the left, both hands trail on the right (hands_left_L130_f80-86.png) |
| 1.3x desk cap | PASS | desk-buddy head width: 100% → 66 px, 130% → 86 px, 160% → 86–88 px (ratio 1.30) (desk_scale_100_130_160.png) |
| {buddy} in live letters | PASS | 8 live completions (keys per word 1, target 3), buddy "Zorbo": 2 letters named Zorbo ("Zorbo deserves a tiny trophy…", "…about your short story, and about Zorbo…"). Both were encouragement; 2 of 3 encouragement draws were named |
| {buddy} in humour letters | NOTE | fan_letters.json humorousSaying has 0/45 `{buddy}` letters (encouragement 12/52, quotes 0/40), so the "encouragement and humour" claim holds only for encouragement. content.js:31-34 only favours categories that have named letters |
| Privacy: network | PASS | strace: 20 connect(), all AF_UNIX/AF_NETLINK |
| Privacy: canary on disk | PASS | "qzxvcanary" not found under the test home (except my harness logs) |

## Bugs
- **BUG-23 (medium, visual): race-back hand-off pops when the run is long.** Repro: desk on the right half (home 1400,600), Buddy size 100%, wander settings idle 3 s / wander 1–2 s, type when the buddy is ~750 px away. The desk swap happens while the runner is still moving (~18 px/frame) and 77 px short of the desk-buddy spot. There is one frame with both sprites, and the runner is visible behind the desk. Likely cause: the Rust race window (race_back_ms + RACE_HOLD_MS, lib.rs idle/race logic) ends before the runner arrives, and the swap is time-based rather than arrival-based. Suggest swapping on arrival (or extending the window by distance / walk speed) and hiding the runner on the same frame the desk buddy appears. Short runs (L100, R130, L130) end within 0–18 px.
- Minor offset: even after a full arrival there is a 14–18 px horizontal snap (L100 −14, R130 +18); the target x (172/68) vs the drawn desk-buddy centre may need a small tweak.
- Content note: no humour letters use {buddy}.

## Summary
PASS 12 · FAIL 1 (BUG-23 race-back pop on long runs) · NOTE 1
**Verdict: SHIP to the user's Windows test**, with BUG-23 flagged as a visible but non-blocking animation glitch (worth fixing before release).
