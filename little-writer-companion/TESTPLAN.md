# Little Author Buddy — Test Plan (v1)

Source: `SPEC.md` (as of 2026-10-14 18:18). Scope = v1 acceptance, Windows first; macOS/Linux checks marked **[P2]** run once those builds exist.
Verification methods: **M** = manual/observed, **A** = automated (unit/integration test), **I** = log/file/DB inspection, **N** = network capture, **S** = static code review.
Canary string used throughout: `CANARYqz7XK` plus a second, `zebra-violet-9931` (unique strings that can't show up by accident).

## 0. Test environment & preconditions
- E1 Windows 10 22H2 and Windows 11 23H2+ VMs/hosts; 1 single-monitor, 1 dual-monitor (mixed sizes, 100%/150% DPI) setup.
- E2 Tools: Wireshark/tcpdump (or `pktmon` on Windows), mitmproxy with a trusted CA, Sysinternals Procmon + Process Explorer, `rg`, sqlite3, a PowerShell script that types canary strings (SendInput), a long-run resource logger (typeperf / psutil script).
- E3 Clean profile: delete the app data dir before each install-level run; write down its path (e.g. `%APPDATA%\<app-id>`, `%LOCALAPPDATA%\<app-id>`, including the WebView2 `EBWebView` folder).
- E4 Build under test: Engine build artifact + commit hash recorded in the results log.

## 1. Typing → writing (keystroke counting)
| ID | Steps | Expected | Verify |
|---|---|---|---|
| T-01 | Start app (Listening). Focus Notepad, type 100 printable chars by script. | Counter goes up by 100. | M + I (counter in UI/DB) |
| T-02 | Type in several apps (browser, Word, terminal, a different-elevation app). | Counted globally, whatever app has focus. | M |
| T-03 | Press only modifiers (Shift, Ctrl, Alt, Win) 50x. | Counter unchanged (default ignore list). | M + A (filter unit test) |
| T-04 | Hold a key down for auto-repeat for 3s. | Behaviour matches the documented rule (see OQ-2); consistent across runs. | M |
| T-05 | Key-down vs key-up: send 10 down events with no ups, then 10 ups. | Counted on key-down only. | A (hook handler test) |
| T-06 | Edit the ignore list (add e.g. F-keys/Backspace), then type them. | Ignored keys aren't counted; change takes effect without restart (or as documented). | M + I (settings file) |
| T-07 | Word mapping: set N=5, type 500 counted keys. | Active project words +100; change N to 6 → new rate applies to new keys. | A + M |
| T-08 | Mapping with a remainder (N=5, type 7). | Remainder carries over (no lost or double-counted keys). | A |
| T-09 | No active project, then type. | No crash; behaviour as documented (see OQ-3). | M |
| T-10 | Burst typing at about 15 keys/s for 60s. | No dropped counts (expected = sent ±0); no input lag in the foreground app. | A (SendInput script) + M |
| T-11 | Stored data shape: inspect DB/JSON after typing. | Only counts + timestamps; no key codes/characters (see PRIV). | I |
| T-12 | Pause from tray, type 100 keys, Resume. | 0 counted while paused; tray shows "Paused"/"Listening" correctly. | M |

## 2. Idle states
| ID | Steps | Expected | Verify |
|---|---|---|---|
| ID-01 | Type, then stop. Measure time to sleep. | Asleep at desk at idle_threshold_ms (default ~20s) ±1s. | M (stopwatch) + I (state log) |
| ID-02 | Change idle_threshold_ms to 5000. | Sleep at ~5s. | M |
| ID-03 | Stay idle after sleep. Record wake time over 10 trials. | Wakes and wanders after a random 1–5 min; all samples in range; not all the same. | I (state log timestamps) + A (RNG bounds test) |
| ID-04 | Ignored keys only (modifiers) during idle. | Does not reset idle / wake (they aren't "relevant"). | M |
| ID-05 | While asleep, press a relevant key. | Interrupt → "race back to desk" → typing animation. | M |
| ID-06 | While wandering, press a relevant key. | Same as ID-05, starting from the wander position. | M |
| ID-07 | Typing during race-back. | No stuck state; arrives and types; counts are still recorded. | M |
| DS-01 | Focus a window whose title matches a list item (e.g. "YouTube" tab in browser), don't type. | Distracted: walks to the focused window rect, watches with curious expression; overrides sleep/wander. | M |
| DS-02 | Edit the title list (add custom "FooBar"), open a window with that title. | Triggers distracted; removed entries no longer trigger. | M + I (settings) |
| DS-03 | Title match rules: case, substring. | Matches as documented (OQ-4). | A |
| DS-04 | Play media (Spotify/browser video → SMTC session) without typing. | Distracted. Pause media → not distracted. | M |
| DS-05 | Media playing + user typing. | Not distracted (typing wins). | M |
| DS-06 | Scroll the mouse wheel continuously ≥ threshold, no keys. | Distracted/"browsing". Short scroll doesn't trigger. | M (threshold per OQ-5) |
| DS-07 | Toggle each signal (title, media, scroll) off one at a time. | That disabled signal no longer triggers; the others still do. | M (3×) |
| DS-08 | Distracted → press a key. | Race back + typing. | M |
| DS-09 | Focused window moved/resized/minimized while being watched. | Companion follows the new rect, or falls back to idle; never targets a stale/invisible rect. | M |
| DS-11 | Wander, trigger a distraction for 10 s, then end it. | Returns to wander (or sleep with the original wake time kept); timer not re-rolled. | A (idle.rs unit test) + M |
| DS-10 | Code review: window-awareness code only reads the title + rect; media code only reads playback state; scroll only counts. | No screenshot/GDI capture, UIA text, URL, or position/target reads. | S |

## 3. Multi-monitor
| ID | Steps | Expected | Verify |
|---|---|---|---|
| MM-01 | Launch with 2–3 monitors at different DPI. | All enumerated; sprite has the same physical size on each (per-monitor DPI). | M + I (log of monitors) |
| MM-02 | Hot-plug: disconnect/reconnect a monitor while running. | No crash; companion moves to a valid display; desk re-homes if its monitor went away. | M |
| MM-03 | Change resolution/scale live. | Layout updates; no off-screen companion. | M |
| MM-04 | Pin desk to monitor 2 (setting); restart. | Desk on monitor 2; setting persists. | M + I |
| MM-05 | Wander mode "all monitors" vs "desk monitor only" (20 min observation each). | Roams across, or stays on the desk monitor, as set. | M |
| MM-06 | Mixed-size monitors with an offset (gap region). Observe seam crossings. | Crosses only along the shared edge; never stops in the gap. | M + A (path/geometry unit test) |
| MM-07 | Distracting window on the non-desk monitor. | Walks across to that monitor to watch. | M |
| MM-08 | Race back from the far monitor. | Path crosses monitors to the desk via valid seams. | M |

## 4. Hiding and peeking
| ID | Steps | Expected | Verify |
|---|---|---|---|
| HP-01 | Watch wander for hide behaviour at screen edges (dual-monitor). | Slides partly off **outer** edges only; never hides at an inner (shared) edge; peeks with half face visible. | M + A (edge selection test) |
| HP-02 | Hide behind a window. | Sprite clipped along the target window's edge, looks tucked; leans out to peek. | M |
| HP-03 | Move/close the window it's hiding behind. | Clip updates or it leaves the hide spot; no floating clipped sprite. | M |
| HP-04 | Hide spot choice. | Picked from window/screen edges near its wander position. | M + A |
| HP-05 | Peek timing over 10 peeks. | Randomised; expressions seen: shy, curious, giggly. | M + I |
| HP-06 | Type while hiding. | Hiding cancels instantly → race-back. | M |
| HP-07 | Code review / Procmon: no SetWindowPos on other apps' HWNDs, no DLL injection, no CreateRemoteThread, overlay stays always-on-top. | Confirmed. | S + I |

## 5. Projects
| ID | Steps | Expected | Verify |
|---|---|---|---|
| PJ-01 | Fresh install: check tiers. | Short story 3,000 / Novella 30,000 / Novel 60,000. | M + I |
| PJ-02 | Edit tier targets (e.g. Short story → 50 for testing). | New target saved and used. | M + I |
| PJ-03 | Try to have two active projects at once. | Only one active; others queued. | M |
| PJ-04 | Queue 3 projects; complete the first. | Done, stats archived, fan letter, prompt for next (queued next is offered). | M + I |
| PJ-05 | Progress UI. | Desk + progress bar + word count match stored values. | M + I |
| PJ-06 | Restart mid-project. | Progress persists exactly. | I |
| PJ-07 | Overshoot: type past target. | Completion fires once; extra words handled per OQ-6; no double completion. | A + M |
| PJ-08 | Invalid target values (0, negative, non-numeric, huge). | Rejected or clamped; no crash. | M + A |

## 6. Fan letters
| ID | Steps | Expected | Verify |
|---|---|---|---|
| FL-01 | Complete a project with networking disabled (adapter off). | Letter is generated and shown. | M |
| FL-02 | Seeded RNG: same seed → same letter sequence. | Deterministic. | A |
| FL-03 | Complete ≥5 projects (small targets). | Each of encouragement, quote, humorous seen at least once. | M + A (distribution test over 100 seeds: all 3 categories within ≤5 draws, or the documented guarantee) |
| FL-04 | Letter UI. | Small card UI; readable; dismissible. | M |
| FL-05 | Save to journal. | File written to the local journal folder; content matches the card; contains no typed text. | I |
| FL-06 | Journal folder missing/read-only. | Error shown gracefully; no crash. | M |

## 7. UX / presentation
| ID | Steps | Expected | Verify |
|---|---|---|---|
| UX-01 | Compare default art with `character-reference.jpg`. | Round blob, thick dark outline, two floating round hands, dot eyes, smile, two-tone warm beige. | M |
| UX-02 | Recolour body, shading, hands, outline via picker + each preset. | Each layer recolours independently and cleanly (no fringes); persists across restart. | M + I |
| UX-03 | Expression set: blinking, happy, focused (typing), sleepy/asleep, curious (peek/watch), surprised/excited (race back), proud (complete). | Each appears in its trigger state; eyes/mouth animate separately from body. | M |
| UX-04 | Always-on-top over fullscreen-windowed and normal apps. | Stays on top. | M |
| UX-05 | Click-through enabled: click on the sprite area. | Click goes to the app underneath; disable → sprite gets the clicks. | M |
| UX-06 | Tray menu: pause, quit, privacy. | All present and work; privacy shows the "key contents never stored" doc; quit exits the process and unhooks (no lingering process in Task Manager). | M + I |

## 8. Platform / packaging / technical
| ID | Steps | Expected | Verify |
|---|---|---|---|
| PL-01 | Install the `.msi` on clean Win10 and Win11; also run the portable build. | Installs/launches; uninstall removes binaries (user data handling per OQ-7). | M |
| PL-02 | Stack check. | Tauri 2 (Rust + webview); hook via WH_KEYBOARD_LL helper or an audited crate (name/version recorded). | S |
| PL-03 | Hook health: lock/unlock, sleep/resume, UAC prompt, RDP session. | Counting resumes after each; no orphaned hook; tray state correct. | M |
| PL-04 | Persistence format. | SQLite or JSON holds projects, settings, journal index; corrupt-file test: app recovers or shows an error, no crash loop. | I + M |
| PL-05 [P2] | macOS build: Accessibility/Input Monitoring permission flow; Now Playing; window rect/title. | Same behaviours as §1–6; permissions denied → clear message, no crash. | M |
| PL-06 [P2] | Linux build (X11 and Wayland noted separately): input, MPRIS, window rect/title. | Same as §1–6, or documented limits (OQ-8). | M |
| PL-07 | Platform hooks behind one interface. | One trait/interface; per-OS implementations; shared core logic unit-tested on all OSes. | S + A |

## 9. Performance & resource
| ID | Steps | Expected | Verify |
|---|---|---|---|
| PF-01 | Idle (asleep) for 30 min. | CPU avg < 1–2% of a core (target TBD, OQ-9); no busy-loop. | I (typeperf) |
| PF-02 | Animating/wandering. | CPU/GPU modest; animation smooth (~no visible stutter). | I + M |
| PF-03 | Typing latency: measure the foreground app's key-to-char delay with and without the app. | No noticeable added latency (hook callback returns fast; target < 1 ms in the hook). | A (instrumented hook timing) + M |
| PF-04 | Overnight soak (≥10 h) with periodic scripted typing, idle and media bursts. | Still running in the morning; memory growth < 10% after warm-up; handle/GDI count stable; counts correct. | I (psutil log) |
| PF-05 | Startup time and memory footprint. | Recorded as a baseline; footprint is reasonable for Tauri. | I |

## 10. Non-goals / negative checks
| ID | Steps | Expected | Verify |
|---|---|---|---|
| NG-01 | Explore all UI + `rg -i "coin|currency|shop|upgrade|purchase|price|gold|skill"` in source. | No currency, shop, upgrades, or paid progression. | M + S |
| NG-02 | Check dependencies + source for Steam API/steamworks/DRM. | None. | S |
| NG-03 | Check repo for game binaries/assets/decompiled code. | None; art is original. | S |

## 11. Privacy audit (PRIV)
Goal: prove no typed content (characters, key codes that let you rebuild text, sequences) is stored, logged, or sent. Only counts + timestamps may persist.

### 11a. Disk / logs / config / dumps
| ID | Steps | Expected | Verify |
|---|---|---|---|
| PV-01 | Clean profile. Run Procmon filtered to the app's process(es) (main + helper + WebView2) and record every file write path. Type canaries (both strings, 20× each) across 3 apps; idle; complete a project; save a letter; quit. | A full list of written paths (input for PV-02). | I |
| PV-02 | `rg -a -i "CANARYqz7XK|zebra-violet-9931"` over: app data dirs, WebView2 profile (IndexedDB, Local Storage, Cache), logs, config, SQLite DB **and its -wal/-journal**, journal folder, `%TEMP%`, and every path from PV-01. Also search UTF-16LE forms (`rg -a -e` with the UTF-16 pattern, or `strings -el`). | 0 matches. | I |
| PV-03 | Key-code reconstruction check: dump the DB/JSON tables. | No per-key code/scancode/char fields; event rows (if any) hold only timestamp/count. Check that you can't rebuild the canary order from stored data. | I |
| PV-04 | Turn on verbose/debug logging (if present); repeat PV-01/02. | 0 matches; logs show counts only. | I |
| PV-05 | Crash dumps: force a crash (debug trigger or `procdump -ma` on the main + helper process while the canary is being typed). Search the WER folder (`%LOCALAPPDATA%\CrashDumps`, `%PROGRAMDATA%\Microsoft\Windows\WER`) and any crash-reporter dir. | No app-created dumps that persist typed text; in-memory buffers don't keep the canary after the hook callback (a full-memory procdump search for the canary is an extra check: only transient hits are allowed; ideally 0). | I |
| PV-06 | Clipboard/screenshots: check that the app never reads the clipboard or captures the screen. | No such API usage. | S + I (Procmon) |

### 11b. Network
| ID | Steps | Expected | Verify |
|---|---|---|---|
| PV-07 | Capture all traffic from the host (Wireshark/pktmon) from launch to quit while typing canaries, during distraction, completion, and letter generation. Filter by app PIDs (Procmon network events / `netstat -bno`). | Ideally zero outbound connections from app processes (spec: on-device only). Any connection is listed and explained. | N |
| PV-08 | Route the app/WebView2 via mitmproxy (system proxy + trusted CA); repeat PV-07. Search flows for the canaries (plain, URL-encoded, base64, UTF-16). | 0 matches; ideally no flows at all. | N |
| PV-09 | Firewall-block all outbound for the app. | Every feature works (letters, projects); no errors/retry storms. | M + I |
| PV-10 | Check that the webview has no remote URLs loaded (CSP, no CDN fonts/analytics). | Local assets only; strict CSP. | S |

### 11c. Static code review
| ID | Steps | Expected | Verify |
|---|---|---|---|
| PV-11 | Review the hook callback: what it reads from KBDLLHOOKSTRUCT (vkCode used only for the ignore-list check, then discarded); what crosses the IPC boundary to the webview/core. | Only "relevant keystroke" event + timestamp leave the callback; no char/vkCode buffers, ring buffers, or queues of key identities. | S |
| PV-12 | `rg` for: ToUnicode, ToAscii, MapVirtualKey, GetKeyboardState, keylog, telemetry, analytics, sentry, reqwest, ureq, hyper, fetch(, XMLHttpRequest, WebSocket, http://, https://. Review cargo + npm dependency trees (`cargo tree`, `npm ls`) for networking/telemetry crates; run `cargo deny`/`cargo audit`. | No character translation; no telemetry/network code, or each use justified and harmless. | S |
| PV-13 | Tauri capabilities/allowlist: check that http/shell/fs scopes are minimal. | No http plugin; fs limited to app data + journal. | S |
| PV-14 | Logging statements near input/window code. | Never log key identities, window titles beyond what's needed (titles not persisted, see OQ-10), or payloads. | S |
| PV-15 | Privacy doc exists (tray "Privacy" + README) and says key contents are never stored; behaviour matches. | Present and accurate. | M |
| PV-16 | Pause truly stops the hook (or stops processing): check while Paused that the callback does no counting/IPC. | Confirmed. | S + A |

## 12. Acceptance (v1) checks
| ID | Acceptance item | Checks |
|---|---|---|
| AC-01 | Runs on Windows | PL-01, PL-03 |
| AC-02 | Survives overnight | PF-04 |
| AC-03 | Pauseable from tray | T-12, UX-06, PV-16 |
| AC-04 | Typing clearly advances the active project | T-01, T-07, PJ-05 |
| AC-05 | Idle triggers sleep or wander | ID-01, ID-03 |
| AC-06 | Typing resumes desk animation | ID-05, ID-06, DS-08, HP-06 |
| AC-07 | ≥1 fan letter per category over a few completions | FL-03 |
| AC-08 | No monetary systems | NG-01 |
| AC-09 | No typed text retained | PV-01 – PV-16, T-11 |

## 13. Traceability matrix
| Spec section / item | Check IDs |
|---|---|
| Goal 1 count keystrokes | T-01–T-12 |
| Goal 2 companion mirrors typing/idle | ID-01–ID-07, UX-03 |
| Goal 3 local fan letters | FL-01–FL-06, PV-07–PV-09 |
| Non-goal: no currency/shop/upgrades | NG-01 |
| Non-goal: no recording/exfiltration | PV-01–PV-16 |
| Non-goal: no Steam/DRM/RE | NG-02, NG-03 |
| Non-goal: Windows first, one input interface | PL-01, PL-05–PL-07 |
| Typing: global LL hook, key-down, ignore list | T-02–T-06, PL-02 |
| Typing: counts/timestamps only | T-11, PV-02, PV-03, PV-11 |
| Typing: word mapping tunable | T-07, T-08 |
| Idle: sleep at threshold | ID-01, ID-02, ID-04 |
| Idle: random 1–5 min wake + wander | ID-03 |
| Distraction: window title list | DS-01–DS-03, DS-10 |
| Distraction: media session | DS-04, DS-05 |
| Distraction: scroll counts | DS-06, DS-10 |
| Distraction: per-signal toggles | DS-07 |
| Decision #2 sleep→wander, distraction override | ID-01, ID-03, DS-01, DS-11 |
| Distraction: walk to window + watch | DS-01, DS-09, MM-07 |
| Interrupt idle → race back | ID-05–ID-07, DS-08 |
| Multi-monitor: enumerate, DPI, hot-plug | MM-01–MM-03 |
| Multi-monitor: desk pin, roam setting | MM-04, MM-05 |
| Multi-monitor: seams, no gaps | MM-06 |
| Multi-monitor: watch/race across monitors | MM-07, MM-08 |
| Hiding: outer screen edges | HP-01 |
| Hiding: faked occlusion, no injection | HP-02, HP-03, HP-07 |
| Hiding: spot choice, random peek, expressions | HP-04, HP-05 |
| Hiding: typing cancels | HP-06 |
| Projects: tiers editable | PJ-01, PJ-02, PJ-08 |
| Projects: one active + queue | PJ-03, PJ-04 |
| Projects: progress UI | PJ-05, PJ-06 |
| Projects: completion flow | PJ-04, PJ-07 |
| Fan letters: local templates + seeded RNG | FL-01, FL-02 |
| Fan letters: 3 categories | FL-03 |
| Fan letters: card UI + journal | FL-04–FL-06 |
| UX: character design | UX-01 |
| UX: colour customisation | UX-02 |
| UX: expressions | UX-03, HP-05 |
| UX: always-on-top, click-through, tray | UX-04–UX-06 |
| Tech: Tauri 2, hook helper | PL-02 |
| Tech: window awareness only for look | DS-10, PV-14 |
| Tech: SQLite/JSON persistence | PL-04, PJ-06 |
| Tech: privacy doc, on-device | PV-07–PV-10, PV-15 |
| Milestone 2 vertical slice | T-01, T-07, T-12 |
| Milestone 3 idle/return anims | ID-01–ID-07 |
| Milestone 4 tiers/completion | PJ-01–PJ-08 |
| Milestone 5 letters/journal | FL-01–FL-06 |
| Milestone 6 settings, msi/portable | PL-01, DS-07, UX-02 |
| Acceptance v1 | AC-01–AC-09 |

## 14a. Decided (2026-10-14)
- **Decision #1 — character:** round flat-vector blob per `character-reference.jpg`. Verified by UX-01–UX-03.
- **Decision #2 — idle:** sleep at idle_threshold, then wander after a random 1–5 min. Distraction (title/media/scroll) overrides both sleep and wander. Typing always triggers race-back. Verified by ID-01–ID-07 and DS-01–DS-08. Added check **DS-11**: when a distraction ends, the companion returns to its prior idle state (sleep/wander) without restarting the 1–5 min wake timer (see TEST-RESULTS BUG-12).

- **Decided (v0.2):** 5 keys/word default (editable); Windows packaging = NSIS + portable exe (no .msi); "Interact" click-through toggle lasts 30 s; edge/window peeking 40 % chance per wander leg with ~55 % of the sprite clipped; OQ answers as implemented in v0.2 (see TEST-RESULTS-v0.2). PL-01 now means NSIS + portable instead of .msi.
- Added check **PV-17** (Windows): while running, type dead-key sequences (´+e, ^+o, ¨+u) and use an IME in Notepad/Word. Characters must come out unchanged (rdev ToUnicodeEx side effects, BUG-14).

## 14. Open questions / spec ambiguities
- OQ-1 "Printable / writing-relevant keys": do Backspace, Enter, Tab, Space, Delete, arrows, numpad count? What's the default ignore list?
  - **Resolved (v0.3, user decision):** only letter keys A–Z count, matched by key position (Windows vk 0x41–0x5A, plus VK_PROCESSKEY mapped by scan code to the A–Z positions; Linux fixed X keycodes 24–33/38–46/52–58). Everything else (digits, punctuation, Space, Enter, Backspace, Tab, Delete, modifiers, F-keys, arrows, numpad) never counts. The ignore-list setting was removed; old `ignore_keys` values are dropped on load. Keystrokes-per-word is a 1–5 slider (default 5; larger stored values clamp to 5).
- OQ-2 Do auto-repeat key-downs count?
- OQ-3 Behaviour when no project is active (discard, buffer, or auto-create)?
- OQ-4 Title matching: substring/case-insensitive/regex? Should a match apply only to the foreground window?
- OQ-5 Thresholds for "sustained scrolling" and for distraction from media/titles (how long without typing)? Priority when several signals fire at once?
- OQ-6 Overshoot words after completion: carry over to the next project or drop? Does a project complete automatically or need confirmation?
- OQ-7 Does uninstall keep or remove user data/journal?
- OQ-8 Linux Wayland: global key hooks and window rects are restricted. Is X11-only acceptable, or is a portal/limited mode expected?
- OQ-9 No numeric performance budgets (CPU/RAM/latency) in the spec; the targets above are proposed.
- OQ-10 Are window titles ever persisted or logged (e.g. for debugging)? Proposal: never.
- OQ-11 "Survives overnight": does that include sleep/hibernate and lock? Proposal: yes (PL-03).
- OQ-12 "Over a few completions": the number isn't given. A guarantee mechanism (e.g. category rotation) vs pure RNG?
- OQ-13 Timestamp granularity stored: per-keystroke timestamps could leak typing rhythm. Is aggregation (per minute) preferred?
- OQ-14 "Game focus optional later": out of scope for v1, not tested.
- OQ-15 Open question #3 (Tauri vs Electron) is listed but Tauri is assumed; numbering starts at 3 (items 1–2 missing?).
- OQ-16 Click-through "when not interacting": how does the user start interacting (hotkey, hover, tray)?
