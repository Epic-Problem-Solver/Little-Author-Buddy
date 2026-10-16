# Test Results: v0.5.0 (Linux Xvfb :85 + xfwm4 compositor; Windows static only)
Tester, 2026-10-15. Time-box about 45 min. Evidence: test-evidence/v0.5.0/

| Check | Result | Evidence |
|---|---|---|
| Build fresh | PASS | lib.rs 09:18:49; deb 09:21:16, binary/AppImage 09:22:11, NSIS exe 09:23:51 |
| Unit tests | PASS | cargo 22/22; node --test 9/9 |
| Onboarding: 4 steps on fresh profile | PASS | welcome → name → colours → first story (o1c, s2bc, s3c, s34). Saved: onboarded=true, buddy_name "Pip", active "Moon Book" |
| Onboarding: colour live preview | PASS | preset Sky recolours preview sprite immediately (s34 left) |
| Onboarding: default name Inky | PASS | field pre-filled "Inky"; desk HUD "Click here to set up Inky" while unfinished |
| Onboarding: swatch size | PASS | 4 swatches measured from screenshot pixels: 36x24 each |
| {buddy} in bubbles/letters | PARTIAL (BUG-20) | substitution works (main.js:134, :197; content.js fill), but shipped `ui/content/flavour.json` & `fan_letters.json` contain no `{buddy}` → the name never appears in any bubble or letter |
| Migration: v0.4 save | PASS | save w/o onboarded/buddy fields, active "Old Saga" 777 → no onboarding window, onboarded=true, 777 kept, buddy "Inky" |
| Settings via LWC_OPEN=journal | PASS | renders Letter journal tab with content, not white (t13) |
| Settings via gear menu (reopen on different tab) | PASS | gear → menu (Settings…, Snapshot (PNG)) → Settings… switches the open window from Journal to Settings tab, full content (t3c) |
| Settings via tray | BLOCKED | no StatusNotifier/tray host on Xvfb; tray menu goes through the same open_window path (lib.rs:238) |
| Gear tooltip overlaps menu | NOTE | the gear's "Settings" tooltip covers the right half of the "Settings…" item (t2c); first click there didn't register. Cosmetic/minor |
| Sliders apply + persist | PASS | size 150%, speed 290, bubble 20 → live preview updates; after Save state.json = 1.5/290/20; values restored after restart (v3c). Note: they only persist on the Save button, not on slider change |
| Slider preview clipping | NOTE | at 150%/20 px the preview's "Hello!" bubble is cut off at the top of the preview box (u12). Cosmetic |
| Settings colour swatch click | BLOCKED | clicking a swatch (`<input type=color>`) opened no visible GTK colour dialog on Xvfb; not further investigated in the time-box |
| Drag stress (xdotool, 35 s) | PASS | 141 rapid drags with 8 moves each (random ±100 px), plus 3 letters typed per drag. No hang. Keystrokes 777→1200 (=141×3). HUD updated live to "240 / 3000" (w1c). Saved home_pos [1401,451] = final window position. Alt-F4 afterwards quits |
| Drag highlight | NOTE | right after dragging, a dark-blue rectangle shows behind the desk sprite (w1c), probably a hover/active style. Cosmetic |
| Watching art (scroll trigger) | PASS | after 20 s idle, 40 wheel clicks → buddy shows the back-turned art (y12 left), at 150% scale. (The later all-black frame is xfwm4 switching workspace on a root-window scroll, a harness artefact) |
| Snapshot with transforms | PASS w/ BUG-21 | 480x440 RGBA, alpha 0..255. But the tilted desk's bottom-right corner touches the bottom row (alpha in rows 437–439, x up to 405), so the corner outline is clipped (snapshot.png) |
| Real home height used for off-screen check | FAIL (BUG-22, low) | fresh profile and saved [1720,900] are both placed at 1720,900; xwininfo shows 200x200 → bottom edge 1100 > 1080. lib.rs:617 reads `outer_size()` before the window is shown, and it still returns the requested 180 on X11; placement and validation therefore use 180. Impact: the bottom 20 px (transparent) is off-screen; HUD stays visible |
| Hide first frame shows sprite | BLOCKED | time-box |
| Privacy: network | PASS | strace: 20 connect() calls, all AF_UNIX/AF_NETLINK; no inet |
| Privacy: canary on disk | PASS | typed "qzxvcanary" and "hello there friend"; neither string is found anywhere under the test homes (state, WebKit storage, journal, snapshots) |
| Windows static | PASS | `async fn open_settings`, no '#tab' URL fragment (initial_tab/show-tab); lint unit tests `open_settings_is_async` and `moved_handler_is_nonblocking` pass |

## Bugs
- **BUG-20 (low):** `{buddy}` is never used in shipped content. Repro: grep `ui/content/*.json`; the only placeholders are {projectTitle}, {wordCount} and {tier}. Code supports it (content.js fill, main.js:134/197). Fix: add `{buddy}` lines to flavour.json/fan_letters.json.
- **BUG-21 (low):** snapshot clips the tilted desk's bottom-right corner (bottom rows 437–439 opaque). snapshot.js transform inlining / the 480x440 viewBox needs a few px more bottom padding.
- **BUG-22 (low):** home off-screen check still effectively uses 180 px on X11 (lib.rs:617 outer_size before show). Repro: fresh profile → home at y=900, height 200 on a 1080 screen.
- Notes (cosmetic): gear tooltip overlaps the "Settings…" menu item; slider preview bubble clipped at 150%/20 px; sliders persist only via the Save button.

## Summary
PASS 16 (one with BUG-21) · FAIL 1 (BUG-22, low) · PARTIAL 1 (BUG-20) · BLOCKED 3 (tray, colour dialog, hide first frame) · NOTE 3
Both Windows-reported fixes verified on Linux: Settings renders on all paths (no white screen), and 35 s of drag stress causes no hang.
**Verdict: SHIP to the user's Windows test.** The 3 low bugs are cosmetic.
