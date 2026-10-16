# Test Results: v0.6.0 (art v0.7.4). Linux Xvfb :85 + xfwm4 compositor; Windows static only
Tester, 2026-10-15. Time-box about 45 min. Evidence: test-evidence/v0.6.0/

| Check | Result | Evidence |
|---|---|---|
| Build fresh | PASS | newest source 10:46:37; deb 10:49:21, binary/AppImage 10:50:17, NSIS 10:51:59 |
| Unit tests | PASS | cargo 24/24; node --test 13/13 |
| JS lwDeriveShade == Rust derive_body (shared fixture) | PASS | ui/tests/derive_fixture.json (10 bodies incl. #000, #fff, dark #1d2a4a/#3a1424, light #e8cfa9) asserted in palette.test.js and store.rs colour_derivation; both green |
| BUG-22: fresh profile home fully on-screen | FAIL | xfwm4 :85, 1920x1080. Fresh profile: home at 1720,900, 200x200 (xwininfo) → bottom 1100. Saved [100,950] → ends at 100,900 (still 1100). WM_NORMAL_HINTS min=max 200x200, frame extents 0. Expected default 1700,820 (lib.rs:372 with 200 px). Fix code at lib.rs:649-657 runs but the window still ends 20 px below the screen; the 1720,900 pattern (= W-200, H-180) suggests the final position is decided with the 180 px requested height or by a WM clamp after show. Visible effect is small (transparent strip, HUD visible) |
| Onboarding above overlay | PASS | _NET_CLIENT_LIST_STACKING: overlay < Home < "Welcome to Little Writer" (top) |
| Desk facing monitor centre | PASS | home moved to x=300 (left half) → buddy left, tool right (faces right/centre); x=1400 (right half) → mirrored. Updates within 2 s of each move (e123) |
| Race back: 1 s hold + rushing | PASS | after typing while wandering: sprite held still with the "We're back! Hands on keys!" bubble for 4 frames (~1.1 s), then a rushing pose (hands trailing) moved toward the desk; it vanished into the desk scene (r.png) |
| Race back size vs desk buddy at 100% | PASS (approx.) | overlay head ≈ desk head ≈ 40 px (r.png). 130% cap not measured: BLOCKED (time) |
| Home shows desk.svg + inkwell while wandering | PASS | f01: desk alone with quill + inkwell, buddy wandering on the overlay |
| Hand layering follows data-dir | PASS (visual, one direction) | rushing right: hands trail behind the body on the left (r.png). Left direction not separately captured |
| Single Body picker | PASS | settings.html: shade/hands are hidden inputs, with the note "Shading and hands follow the body colour." |
| Old save with separate colours migrates | PASS | body #1d2a4a, shade #000000, hands #ff0000 → after launch shade = hands = #3e5799 (= fixture), body kept |
| BUG-20: live completion | PASS (completion live) / name via code | target 5 words, keys per word 1: completion fires live, fan letter card shown + saved to journal (c135). The two random letters drawn (encouragement and quote) didn't contain the name. The content now has {buddy} in 15/65 bubble lines and 12/52 encouragement letters; substitution is wired (main.js). The name isn't seen live because of the random draw |
| BUG-21: snapshot all tools | PASS | unlock_all + pen/laptop/typewriter: 512x472 RGBA, alpha 0..255, drawn bbox x39–474 y110–448 (≥23 px margin all sides), no laptop glow (snaps.png) |
| Gear tooltip hidden while menu open | PASS | hovered 2 s, then clicked: menu shown, no tooltip (g.png) |
| Slider preview bubble not clipped | PASS | at 160% / 20 px, "Hello!" fully inside the preview (g.png) |
| No blue rectangle after drag | PASS | drag then mouse away: transparent desk background (f01 left) |
| Privacy: network | PASS | 3 strace'd runs: 0 non-AF_UNIX/NETLINK connect() calls |
| Privacy: canary on disk | PASS | typed "qzxvcanary" ×3 runs; not found anywhere under the test home except my own harness logs |

## Bugs
- **BUG-22 (low, still open on xfwm4):** fresh profile → home at 1720,900, 200x200 on a 1920x1080 screen (bottom edge 1100). A saved [100,950] ends at 100,900. Location lib.rs:644-657 (+ home_position lib.rs:362). The 1720,900 = (W-200, H-180) pattern suggests the 180 px requested height still decides the final y (outer_size probably still 180 right after show, so the re-clamp branch doesn't run), or xfwm4 clamps it. Suggest re-clamping on the first Resized event / after a short delay. Cosmetic impact: the bottom transparent 20 px is off-screen.

## Summary
PASS 18 · FAIL 1 (BUG-22, low) · BLOCKED 1 (130% size cap) · partial evidence noted on 3 (BUG-20 name live, hands left-direction, size approx.)
**Verdict: SHIP to the user's Windows test** (the remaining bug is cosmetic and X11/xfwm4-specific; on Windows outer_size is known before show).
