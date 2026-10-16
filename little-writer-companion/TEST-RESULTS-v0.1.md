# Test Results — Little Writer Companion v0.1 (Linux run)

- Date: 2026-10-14, 19:06–19:12 ET. Tester agent, on the box.
- Build under test: `app/src-tauri/target/release/little-writer-companion`, sha256 `61d7f014…a7bb`, built 18:54 ET (same build as the `.deb`/AppImage in `bundle/`).
- **Source drift:** Engine edited `lib.rs`/`store.rs`/`main.js` and added `settings.html` at 19:05–19:06, after this build. The new source adds hide/peek, settings, a journal, and daily stats, but **none of that is in the tested binary**. Code-review findings below are for the 18:54 build unless marked "(new src)". Retest needed after a rebuild.
- Environment: Debian box, Xvfb `:77` 1920x1080, xfwm4 (compositor off, so the overlay shows black instead of transparent; this is expected), dbus-run-session, xdotool for input, `strace -f` (connect/openat/write/sendto) on the whole process tree, `tcpdump -i any`. No tray host, no MPRIS player, single screen only. mitmproxy couldn't be installed (no apt candidate; pip blocked by PEP 668).
- Canaries: `CANARYqz7XK`, `zebra-violet-9931`, typed 20× (600 chars) via XTEST.
- Evidence: `test-evidence/v0.1/` (screenshots, strace.log, pcap-summary.txt, app.out, state-after-canary.json).

Legend: **P** pass · **F** fail · **B** blocked (can't run on this box) · **D** deferred to the Windows/macOS tester.

## Results
| ID | Result | Evidence / notes |
|---|---|---|
| T-01 | P | 600 chars typed → `keystrokes: 600`, HUD "120 / 3000" (shot_asleep.png, state-after-canary.json) |
| T-02 | P | Counted while different X windows (xmessage "Notes", "YouTubeTest") had focus |
| T-03 | P | Capitals needed Shift; the count equals the char count, so Shift isn't counted (input.rs:18 ignore list) |
| T-04 | P | Code: auto-repeat dropped by the `down` set (input.rs:31). Not exercised live |
| T-05 | P | Code: counts KeyPress only; release clears the key from the set |
| T-06 | F | Ignore list is hardcoded (input.rs:18–23), so it isn't user-configurable → BUG-07 |
| T-07 | P | keys_per_word=5 → 600 keys = 120 words. Tunable only by editing JSON in this build |
| T-08 | P | Raw keystrokes stored; words = keys / kpw, so no remainder is lost mid-project |
| T-09 | P | No active project → auto-creates "My Short Story" (lib.rs:155). See OQ-3 |
| T-10 | P | 600/600 at ~50 keys/s (xdotool 20 ms delay), no drops |
| T-11 | P | state.json keys: settings, active, queue, completed, total_keystrokes. Counts only |
| T-12 | B | No tray host in Xvfb. Code: `paused` gates key + wheel counting (input.rs:32,37) |
| ID-01 | P | Asleep at the desk after ~25 s idle (idle_neutral.png). Exact ±1 s timing not measured |
| ID-02 | B | No settings UI in the build (JSON edit possible, not run) |
| ID-03 | P | Unit test full_cycle ok. Delay drawn from rand 60 000–300 000 ms (lib.rs:148). No live 1–5 min sample |
| ID-04 | P | Code: ignored keys never increment `keys`, so they don't reset idle |
| ID-05 | P | race1.png "Back to the desk", mid-path → race2.png at the desk 3 s later |
| ID-06 | P | Race back started from the watch position (same shots) |
| ID-07 | P | Unit test (RaceBack held until race_until) |
| DS-01 | P | Focus "YouTubeTest" → walked to the window rect at 10,58 (shot_watch.png) |
| DS-02 | B | No settings UI in the build |
| DS-03 | P | Code: case-insensitive substring (lib.rs:135–136) |
| DS-04 | B | No MPRIS player/playerctl on the box |
| DS-05 | P | Code: distraction only evaluated when idle (lib.rs:127) |
| DS-06 | P | 30 wheel clicks in 4.5 s with focus on neutral "Notes" → left the desk to watch (scroll.png) |
| DS-07 | P | Code: detect_titles/media/scroll flags gate each signal |
| DS-08 | P | See ID-05 |
| DS-09 | P | Code: fg re-read every 1 s while idle. Not exercised live |
| DS-10 | P | Code: title + geometry via xdotool, playerctl status, wheel count only. No capture APIs |
| MM-01–MM-03 | B | Single Xvfb screen. Code: monitors re-enumerated every 5 s (lib.rs:121), but CSS mapping uses one window devicePixelRatio, not per-monitor → BUG-08 |
| MM-04 | F | Code: desk is always on `monitorsCss()[0]` (main.js deskPos), no pin setting → BUG-08 |
| MM-05 | F | Code: no roam-scope setting |
| MM-06 | F | Code: straight-line interpolation between random monitors, so it can cross gap regions → BUG-08 |
| MM-07, MM-08 | B | Needs multi-monitor |
| HP-01–HP-06 | F | Hide/peek not in the 18:54 build (no clip/peek logic). Present in new src main.js:19–60, untested → BUG-02 |
| HP-07 | P | Code: no SetWindowPos on foreign windows, no injection |
| PJ-01 | P | Default 3000. Tiers 3k/30k/60k in store.rs tier_target |
| PJ-02 | F | Tier targets hardcoded, not user-editable → BUG-07 |
| PJ-03 | P | Code: new_project queues if one is active |
| PJ-04 | F | On completion it auto-starts the next queued project or a default one; no "prompt next project" → BUG-06 |
| PJ-05 | P | HUD text + bar match state.json |
| PJ-06 | P | 601 persisted across restart (state-after-canary.json) |
| PJ-07 | F | Code: overshoot keystrokes discarded on completion (lib.rs:164–169) → BUG-06 |
| PJ-08 | F | Code: target 0 accepted → completes on every 250 ms tick (letter spam) → BUG-04 |
| FL-01 | P | No network at all (see PV-07). Templates are local JSON |
| FL-02 | F | `Math.random()`, not seeded (content.js pick) → BUG-09 |
| FL-03 | P | Code: category rotation guarantees all 3 in 3 completions |
| FL-04 | B | Completing 3000 words needs 15k scripted keys plus a UI check; not run this pass |
| FL-05 | F | No journal in the build (new src stores letters inside state.json, not a "journal folder") → BUG-05 |
| FL-06 | B | Depends on FL-05 |
| UX-01 | P | Round beige blob, dark outline, floating hands, dot eyes (screenshots) |
| UX-02 | F | Colours read from JSON only, no picker/presets in the build (new src settings.html may add them) |
| UX-03 | F | Most faces seen. "proud" is overwritten by the next tick ≤250 ms later (main.js showLetter sets lastMode='proud'; onState then sees mode≠lastMode) → BUG-03 |
| UX-04 | P | alwaysOnTop true (tauri.conf.json); stayed above xmessage |
| UX-05 | P | set_ignore_cursor_events(true) (lib.rs). Permanently click-through, see OQ-16 |
| UX-06 | B | No tray host. Code: Pause/Quit present; "privacy" is only a disabled label → BUG-10 |
| PL-01 | D | Windows install. Linux binary launches OK |
| PL-02 | P | Tauri 2 + rdev 0.5 (Linux: X11 RECORD) |
| PL-03 | D | Windows lock/UAC/RDP |
| PL-04 | F | Corrupt state.json silently reset and overwritten → **BUG-01** |
| PL-05 | D | macOS |
| PL-06 | P | X11 works. Wayland-native not supported (README), see OQ-8 |
| PL-07 | P | Input via rdev; platform.rs cfg(windows)/cfg(not windows) |
| PF-01, PF-02 | B | Xvfb software rendering isn't representative. Observed main process 13.9 % avg CPU over 4.5 min including startup → recheck on Windows |
| PF-03 | D | Hook latency on Windows |
| PF-04 | B | No overnight soak run |
| PF-05 | P | Baseline: main process RSS 218 MB (plus WebKit child processes) |
| NG-01 | P | No currency/shop/upgrade code or UI |
| NG-02 | P | Dependencies: tauri, serde, serde_json, rdev, rand, windows. No Steam/DRM |
| NG-03 | P | No game binaries/assets |
| PV-01 | P | strace openat: writes only to state.json(.tmp), WebKit dirs, mesa/fontconfig caches |
| PV-02 | P | `rg -a` (ASCII, case-insensitive, UTF-16LE) over $HOME, app data, WebKit storage, /tmp, stdout/stderr: **0 hits** |
| PV-03 | P | No key codes/chars/per-key timestamps in state.json |
| PV-04 | P | No debug logging. Only eprintln of a listener error (input.rs:46) |
| PV-05 | P | No crash reporter. /var/crash empty. (Full-memory dump search not done) |
| PV-06 | P | Code: no clipboard/screen-capture APIs |
| PV-07 | P | strace: **0 AF_INET/AF_INET6 connects** across the app's process tree. Only Unix sockets (X11, dbus). The pcap hits are the box's own control traffic, not the app's |
| PV-08 | B | mitmproxy not installable. PV-07 strace already shows nothing that could be proxied |
| PV-09 | P | Works with no network use (nothing to block) |
| PV-10 | F | `"csp": null` (tauri.conf.json) → BUG-11 (low). All assets local |
| PV-11 | P | rdev callback: Key only used for the ignore/repeat check, then dropped. Only u64 counters cross threads. `down` HashSet holds currently held keys (≤ a few) in memory only |
| PV-12 | P | rg for ToUnicode/reqwest/fetch(http/WebSocket/telemetry/sentry: none (fetch only loads local assets). cargo audit not run |
| PV-13 | P | capabilities: core:default only. No http/fs/shell plugins |
| PV-14 | P | No logging of key identities or titles. Window title not persisted (Snapshot only, in memory) |
| PV-15 | F | No privacy doc in the app (disabled menu label only). README mentions it → BUG-10 |
| PV-16 | P | Pause stops counting. Note: the hook still receives events while paused (just ignored) |

## Tally
95 checks: **54 pass, 21 fail, 16 blocked, 4 deferred** (Windows/macOS). Grouped rows count each ID.

## Bugs
| ID | Sev | Repro | Expected | Actual | Location |
|---|---|---|---|---|---|
| BUG-01 | **High** | Have progress (601 keys). Truncate state.json to invalid JSON. Start the app, type, wait 10 s | Recover, or back up the bad file + warn; don't destroy data | Silently loads defaults and **overwrites** the file; progress lost (16 keys left) | store.rs `load()` `.unwrap_or_default()`; save() overwrites |
| BUG-02 | High (feature) | Idle near an edge/window in the 18:54 build | Hide/peek per spec | Not implemented in the build (new src has it, unbuilt) | ui/main.js |
| BUG-03 | Low | Complete a project | Proud face held while the letter is shown | Reverts on the next 250 ms tick | ui/main.js showLetter / onState |
| BUG-04 | Med | new_project with target_words 0 (or 0 via JSON) | Reject/clamp | Completes every tick → endless letters + completed entries | lib.rs new_project / tick completion (~:58, :165) |
| BUG-05 | Med | Complete a project | Letter savable to a local journal folder | No save in the build; new src saves into state.json only | lib.rs save_letter (new src) |
| BUG-06 | Med | Type past target | Completion → prompt next project; overshoot handled | Auto-starts the next/default project silently; overshoot dropped | lib.rs:155–170 |
| BUG-07 | Med | Look for ignore-list / tier settings | User-editable | Hardcoded | input.rs:18, store.rs tier_target |
| BUG-08 | Med | Multi-monitor (code review) | Per-monitor DPI, desk pin, roam scope, seam-only crossing | Single DPR, desk on monitor[0], straight-line paths across gaps | ui/main.js toCss/deskPos/randomSpot/frame |
| BUG-09 | Low | Generate letters | Seeded RNG | Math.random | ui/content.js pick |
| BUG-10 | Low | Tray → Privacy | Privacy statement | Disabled label only | lib.rs tray menu |
| BUG-11 | Low | — | Strict CSP | csp null | tauri.conf.json |
| BUG-12 | Low | Distraction ends while wandering | Resume wander (or keep the timer) | Goes back to Asleep and re-rolls the 1–5 min wake timer each time | idle.rs:42 |
| BUG-13 | Low | Kill/logout (SIGTERM) | Final save | Saves only every 10 s or on tray Quit; ≤10 s lost | lib.rs:182 |

## Privacy audit verdict
**PASS (v0.1 Linux build).** No canary in any file, log, cache or WebKit storage. No network sockets opened by the app (strace). No key identity stored, logged, or sent across IPC. Gaps: no mitmproxy pass (strace makes it unnecessary), no full-memory dump search, cargo audit not run, CSP off. Windows/WebView2 still needs its own pass (D).
