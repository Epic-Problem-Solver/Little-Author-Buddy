# Test Results — v0.4.0 (Linux live on Xvfb + Windows static), in progress
- Started 00:02 ET (Oct 15). Tester agent. Own display :85 (Xvfb + xfwm4 with compositor on). Only my own processes are started and stopped.
- **Build fresh: YES.** Newest source lib.rs 23:37:40. deb 23:49:35, Linux binary + AppImage 23:50:24, Windows exe + 0.4.0 NSIS 23:52:13.
- **Unit tests:** cargo 16/16 pass; `node --test ui/tests/` 4/4 pass.

## Results
| Check | Result | Evidence |
|---|---|---|
| Home window size | **Discrepancy** | xwininfo: **200x200** (requested 200x180) on every launch. Placement math and the on-screen check use 180 (lib.rs:515 `hh = 180.0`, `home_position`), so a saved position up to 20 px from the bottom edge passes validation while 20 px of the window is off-screen. Default spot 1700,840 → bottom edge at 1040, fine |
| Home: frameless, titled, not a tool window | P | xprop: WM_NAME "Little Writer — Home", `_NET_WM_WINDOW_TYPE_NORMAL`, state SKIP_TASKBAR/SKIP_PAGER/ABOVE, no WM frame. Overlay: "Little Writer Companion", TYPE_NORMAL (not UTILITY/TOOLBAR) |
| Title prompt on first launch | P | "Name your first story" + input + "Start writing" shown in the desk (home1.png) |
| Letters before naming credited | P | 5 letters typed before naming → carry 5. Named "Night Tale" → active keystrokes 15 (5 + the letters typed while naming) |
| Drag + persist | P | Dragged 1700,840 → 1170,470. home_pos saved, restored 1170,470 after restart |
| Off-screen saved position | P | home_pos [5000,-3000] → placed at default 1700,840, no warning |
| Alt-F4 quits whole app + saves | P | 0 lwc processes afterwards; state.json had the latest total/name/pos |
| BUG-19 fr AZERTY | **P (fixed)** | m → +1, `,` → +0, a q z w → +4, é ; : → +0 |
| BUG-19 de | P | y z → +2; ö ä ü ß → +0 (not A–Z, as specified) |
| BUG-19 runtime layout switch | P | us → fr → de → us via `setxkbmap` in one session; each layout applied within ~1.5 s (us m , ; → +1 at the end) |
| Tier locks (UI) | P | New user: Projects tier dropdown offers only "Short story (3000)" (projc.png) |
| Tier/tool locks (backend) | P (code + unit) | `new_project` returns Err "The {tier} tier is locked" (lib.rs:100); `start_next` refuses a locked queued tier (lib.rs:113); a locked tool falls back to the highest unlocked one (store.rs:272); unknown tool → pen. Unit tests progression, unlock_all_is_reversible, migration_from_completed pass. Not invoked live over IPC (no devtools here) |
| Unlock all (testing) | P (code + unit) | Checkbox in Settings; level() = 2 when on, real progress unchanged, reversible (unit test) |
| Hide tracking (LWC_FORCE_HIDE=1) | P (with note) | Target moved 500→900 px: within 1.2 s the companion is clipped at the new left edge (~45 % visible, pixels end at x≈904). Shrunk to 60x40 → popped out (full sprite). Minimised → popped out. Closed → popped out. Restored → companion free, then re-hid. Note: in the first frame (16 s after start) no sprite pixels were visible at all (fully clipped or mid-transition); not reproduced again |
| Snapshot (LWC_SNAPSHOT=1) | PASS | `~/Little Writer/little-writer-2026-10-15_00-04-32.png`, 480x440 RGBA, alpha 0..255 (real transparency) |
| Flameshot full capture | PASS | `flameshot full` on :85 saved 1920x1080 image (494 colours, app visible, not blanked) |
| OBS Display/Window capture | BLOCKED | obs-studio 30.2.3 installed and launches on :85 (llvmpipe GL OK), but setting up a capture source headless needs GUI interaction; time-boxed out |
| Gear menu Settings/Snapshot (UI click) | BLOCKED | Not clicked within time-box; Snapshot backend verified via LWC_SNAPSHOT |
| Privacy regression (quick) | PASS | No canary strings in h1/h2/h3 state/WebKit storage; prior strace/no-network evidence unchanged in code |

## Summary
Pass 17 · Fail 0 · Blocked 2 · Notes 1 (home 200x200 vs hh=180 validation, lib.rs:515)
**Verdict: SHIP to Windows test.**
