# Test Results — Little Writer Companion v0.2 rebuild (version string still 0.1.0), Linux run + Windows static checks

- Date: 2026-10-14, 19:38–20:05 ET. Tester agent, on the box.
- **Build freshness: OK.** Latest source/asset edit 19:24:03 ET (`ui/assets/*`, `ui/content/*`; lib.rs 19:22:21). Linux binary 19:26:39, deb 19:25:52, AppImage 19:26:39, Windows exe and NSIS 19:28:03. All builds are newer than all sources. Linux binary sha256 `c8e740e2…8257`.
- `cargo test --release`: 5/5 pass (idle full_cycle, distraction_overrides_sleep_then_returns → Wander, corrupt_is_backed_up, days, no_per_key_fields_persisted).
- Environment: Xvfb `:78` (3840x1200) and `:79` (1920x1080), xfwm4, dbus-run-session, xdotool, `strace -f` (connect/openat/rename/unlink) over the whole process tree for ~10 min, `tcpdump -i any`, and a /proc/<pid>/mem canary scan of every app process. Multi-monitor: `xrandr --setmonitor` has no effect on Xvfb (one RandR monitor only), so multi-monitor behaviour was tested by running the real `ui/main.js` geometry code in Node against a 2-monitor mixed-DPI layout (L 1920x1080@1.0 at y=360, R 2560x1440@1.5 at x=1920).
- **Harness caveat:** relaunching in a HOME that held a stale xdg-desktop-portal FUSE mount (`~/.cache/doc`, left behind when dbus-run-session ended) made the app count nothing. With a clean HOME it was fine every time; I reproduced this and fixed it by unmounting. Treated as an environment artifact. Side note: totals are written only by the tick loop, which makes synchronous window calls, so a blocked main thread stops saving (robustness, not filed).
- Evidence: `test-evidence/v0.2/`.

Legend: **P** pass · **F** fail · **B** blocked on this box · **D** deferred to Windows/macOS.

## Bug retest
| Bug | Verdict | Evidence |
|---|---|---|
| BUG-01 corrupt state | **REOPENED (partial)** | Invalid JSON → moved to `state.corrupt-1792021819346.json` + warning ✓. Read-only dir → "could not be backed up; it will not be overwritten", file intact ✓. **Invalid UTF-8 → "Could not read … stream did not contain valid UTF-8", no backup, file OVERWRITTEN with defaults** ✗ (store.rs `load()` `Err(e)` non-NotFound branch returns defaults; lib.rs:349 sets `no_save` only for "could not be backed up") |
| BUG-02 hide/peek | Verified | Runtime: peeks clipped at the outer left edge (hides.png). Automated: 500 picks → only outer edges (x=0 left, x=4480 right), never the shared seam at 1920. Visible fraction 0.45 (= 55 % clipped). Window-edge spots generated when a fg rect exists. 40 % chance in code |
| BUG-03 proud 6 s | Verified (code) | main.js showLetter `holdUntil = now+6000`; onState holds unless race_back. Not captured on screen |
| BUG-04 target ≥1 | Verified | JSON target_words 0 + keys_per_word 0 → clamped to 1/1; exactly 1 completion + 1 letter, no spam |
| BUG-05 journal .md | Verified | `~/Little Writer Journal/2026-10-14-Tiny-Tale-….md` (no XDG docs dir) and `$XDG_DOCUMENTS_DIR/Little Writer Journal/…` when set. Name `J/../x` sanitised to `J----x` (no path traversal) |
| BUG-06 overflow | Verified | Target 10 w, kpw 5, typed 60 keys → completed at 50, carry 10, awaiting_next, Projects tab opened ("2 extra words will carry", projects_win.png). Start → "Second Story" began at 10 keystrokes |
| BUG-07 keys/tiers editable | Verified | Settings UI: kpw→4, Rose preset, `KeyA` added to ignore list, Save → state.json updated. Then "aaaa bbbb" counted 5 (KeyA ignored, live). Tier targets in the UI and used for new projects |
| BUG-08 multi-monitor | Verified (automated) / B runtime | 38,200 path samples over 500 random cross-monitor walks: 0 in the gap region. 1,000 random spots: 0 in a gap. Desk pinned to monitor 2 lands on monitor 2. Desk-only roam: 0/25,000 off-desk spots in the isolated harness (an earlier combined harness showed intermittent off-desk spots I couldn't reproduce in isolation; probably a harness artifact, worth a visual check on Windows). Sprite scale k = monitor.scale/DPR in code. Live DPI/hot-plug not testable |
| BUG-09 seeded | Verified (code) | mulberry32 seeded with hash(name:completed_at); category by persistent completion index |
| BUG-10 Privacy tab | Verified | LWC_OPEN=privacy → tab shown (privacy_tab.png); text matches observed behaviour on Linux |
| BUG-11 CSP | Verified | `default-src 'self'; script-src 'self'; …; object-src 'none'; frame-ancestors 'none'`. Present in both the Linux and Windows binaries |
| BUG-12 distraction → wander | Verified | Unit test: Asleep → Watch → (distraction ends) → Wander |
| BUG-13 save | Verified | Typed 7 keys, SIGTERM 0.6 s later → saved (60 → 67). ~6 debounced saves over 10 min |

## New bugs
| ID | Sev | Repro | Expected | Actual | Location |
|---|---|---|---|---|---|
| BUG-01b (reopen) | **High** | Put non-UTF-8 bytes in state.json (e.g. `{"total_keystrokes": 999, "x":"\xff\xfe"}`), launch, type | Back up + warn, never overwrite (same as invalid JSON) | Warning "Could not read…", then defaults are saved **over** the original (cmp differs; evidence nonutf8-original.bin) | store.rs `load()` read-error branch; lib.rs:349 `no_save` check. Fix: treat any non-NotFound read error like a parse error (rename aside, or set no_save) |
| BUG-14 | Med (privacy hardening + Windows input risk) | Static: `objdump -p` on the Windows exe imports **ToUnicodeEx** and **GetKeyboardState**. rdev 0.5.3 `windows/listen.rs:24-26` calls `keyboard.get_name()` for every key event, which turns the key into the typed character (`keyboard.rs:80`). Linux does the same via the X keymap (`linux/common.rs:69`) | Hook reads the vkCode/keycode only (spec: "counts and timestamps only; never the character payload") | The typed character is built as a String in memory for every keystroke and then dropped by our callback (not stored; memory scan found 0 canaries). ToUnicodeEx inside a low-level hook is known to interfere with dead keys/IME in other apps | `input.rs` (rdev::listen). Recommend a small WH_KEYBOARD_LL helper reading `KBDLLHOOKSTRUCT.vkCode` only. **Windows tester:** check dead keys (´+e, ^+o, ¨+u) and an IME in other apps while the companion runs |
| BUG-15 | Low | Complete a project after 20:00 ET | Local date | Journal filename/heading and `daily` stats use the UTC date (`2026-10-15-…md` written at 19:58 ET on 10-14) | store.rs `day_string`; lib.rs `letter_md`, `add_daily` |
| BUG-16 | Low (Linux) | Open Settings/Projects with no compositor | Settings window usable | Always-on-top overlay covers the whole desktop and is opaque without a compositor, hiding the settings window (I had to unmap the overlay to see it). With a compositor or on Windows it's transparent and click-through, so it's fine | lib.rs overlay; consider lowering the overlay while the settings window is focused, or a warning when no compositor is present |
| OBS-1 | Info | Privacy tab says "The app makes no network connections" | — | True for the app on Linux (0 AF_INET). On Windows the NSIS `downloadBootstrapper` downloads WebView2 at install, and WebView2 may contact Microsoft services itself. Verify on Windows; consider wording "Little Writer never sends your data" | tauri.conf.json, settings.html |
| OBS-2 | Info | Hide faces | shy/curious/giggly | "giggly" uses the `proud` face (main.js pickHide comment) | Fine if Animator agrees |

## Results (all checks)
| ID | Result | Evidence / notes |
|---|---|---|
| T-01 | P | 60/60 and 10/10 counted across runs |
| T-02 | P | Counted with xmessage/settings windows focused |
| T-03 | P | Shift (capitals) not counted |
| T-04 | P | Code: `down` set drops auto-repeat |
| T-05 | P | Code: KeyPress only |
| T-06 | P | KeyA added in UI → ignored live |
| T-07 | P | kpw 4 via UI saved; 5 default |
| T-08 | P | Raw keystrokes stored |
| T-09 | P | Auto-creates "My Short Story" + notice (code; observed project created on a fresh profile) |
| T-10 | P | No drops at ~33 keys/s |
| T-11 | P | state.json: counts, daily totals, settings, projects, journal letters only |
| T-12 | B | No tray host; code: `paused` gates key + wheel counting |
| ID-01 | P | Sleep then wander observed in the 40-frame sequence; code unchanged from v0.1 pass |
| ID-02 | P | Idle seconds field saved via UI (timing not re-measured) |
| ID-03 | P | Wander started ~80–100 s after the last key; unit test |
| ID-04 | P | Code |
| ID-05 | P | v0.1 runtime pass; state machine unchanged (unit test) |
| ID-06 | P | Same |
| ID-07 | P | Unit test |
| DS-01 | P | v0.1 runtime; code unchanged |
| DS-02 | P | Title list editable in the UI, saved |
| DS-03 | P | Case-insensitive substring, empty entries skipped |
| DS-04 | B | No MPRIS player |
| DS-05 | P | Code |
| DS-06 | P | v0.1 runtime; unchanged |
| DS-07 | P | Toggles in the UI + code gates |
| DS-08 | P | Unit/v0.1 |
| DS-09 | P | Code: fg refreshed 1 s while idle |
| DS-10 | P | Code |
| DS-11 | P | Unit test (Watch → Wander) |
| MM-01 | B | Single RandR monitor on Xvfb |
| MM-02 | B | Same |
| MM-03 | B | Same |
| MM-04 | P | Automated (real main.js): desk on chosen monitor |
| MM-05 | P | Automated: desk-only roam stays on the desk monitor (isolated harness), all-monitors uses both |
| MM-06 | P | Automated: 0/38,200 path samples in the gap |
| MM-07 | B | Needs live multi-monitor |
| MM-08 | P | Automated: route() goes via the seam point |
| HP-01 | P | Runtime outer-edge peek + automated outer-edge-only |
| HP-02 | P | Automated: window-edge hide spots, clip line at window x |
| HP-03 | B | Window move during hide not exercised |
| HP-04 | P | Spots from nearby edges/windows |
| HP-05 | P | Random 6–15 s duration; faces shy/curious/proud (OBS-2) |
| HP-06 | P | Code: mode change clears hide |
| HP-07 | P | No foreign-window manipulation |
| PJ-01 | P | Defaults 3k/30k/60k |
| PJ-02 | P | Editable in the UI; JSON tier 10 used |
| PJ-03 | P | Queue observed |
| PJ-04 | P | Completion → awaiting + Projects tab + Start button |
| PJ-05 | P | HUD/Projects text match state |
| PJ-06 | P | Persists across restarts |
| PJ-07 | P | Overflow carried |
| PJ-08 | P | 0 → 1 clamp |
| FL-01 | P | No network |
| FL-02 | P | Seeded (code) |
| FL-03 | P | Category rotation by completion index |
| FL-04 | P | Letter generated + stored (card not screenshotted) |
| FL-05 | P | .md written to the journal folder |
| FL-06 | B | Read-only journal folder not tested |
| UX-01 | P | Character in the settings preview (settings_tab.png) |
| UX-02 | P | Presets + pickers; Rose saved |
| UX-03 | P | Code (proud hold); faces seen at runtime |
| UX-04 | P | alwaysOnTop |
| UX-05 | B | "Interact (30 s)" is a tray action; code reverts after 30 s |
| UX-06 | P | Privacy tab via LWC_OPEN; tray items in code (tray itself not clickable here) |
| PL-01 | D | Windows install (NSIS + portable exe present) |
| PL-02 | P | Tauri 2 + rdev |
| PL-03 | D | Windows lock/UAC/RDP |
| PL-04 | F | BUG-01b |
| PL-05 | D | macOS |
| PL-06 | P | X11 OK; Wayland warning in code |
| PL-07 | P | Platform split |
| PF-01 | B | Xvfb software rendering |
| PF-02 | B | Same |
| PF-03 | D | Windows hook latency |
| PF-04 | B | No overnight soak |
| PF-05 | P | Baseline unchanged order of magnitude |
| NG-01 | P | None |
| NG-02 | P | Dependencies add only ctrlc |
| NG-03 | P | None |
| PV-01 | P | strace writes: state.json(.tmp), WebKit salt/hsts/cache, mesa cache, `/tmp/tray-icon/*.png`, journal .md |
| PV-02 | P | Canaries + the typed test words: 0 hits (ASCII, case-insensitive, UTF-16LE) across all test HOMEs, journal .md, state.corrupt-*, WebKit storage, app output |
| PV-03 | P | Per-day totals only; no key fields |
| PV-04 | P | Only eprintln of warnings |
| PV-05 | P | /proc/<pid>/mem scan of lwc + WebKitNetworkProcess + 2 WebKitWebProcess right after typing canaries: 0 hits |
| PV-06 | P | No clipboard/capture |
| PV-07 | P | 0 AF_INET/AF_INET6 connects across the process tree (~10 min, incl. completion + journal + settings) |
| PV-08 | B | mitmproxy unavailable (superseded by PV-07) |
| PV-09 | P | No network used |
| PV-10 | P | Strict CSP (both binaries) |
| PV-11 | P | Our callback: key → ignore check → dropped. Caveat BUG-14 (rdev builds the char) |
| PV-12 | P | No telemetry/HTTP crates. "analytics" string hits in the binaries are WebKit/brotli dictionary text. Windows imports: no WinHTTP/WinINet/Winsock. ToUnicodeEx → BUG-14 |
| PV-13 | P | core:default for overlay + settings |
| PV-14 | P | Titles not persisted/logged. Settings store the user's own title list only |
| PV-15 | P | Privacy tab present and accurate (see OBS-1 for Windows) |
| PV-16 | P | Code: pause gates counting |

## Tally
96 checks (95 from the plan + DS-11): **78 pass, 1 fail, 13 blocked, 4 deferred**. Bugs: 12 verified, 1 reopened (BUG-01b, High), 3 new (BUG-14 Med, BUG-15 Low, BUG-16 Low) + 2 observations.

## Privacy audit verdict
**PASS on Linux; PASS (static) on Windows, with one hardening item (BUG-14).** No typed content in any file, journal, settings, backup, cache, log, or process memory; no network connections; strict CSP; minimal permissions. BUG-14 (rdev builds each typed character transiently, via ToUnicodeEx on Windows) stores and sends nothing, but it goes against the spirit of "never the character payload". Windows runtime privacy (Procmon/pktmon, WebView2 traffic) is still deferred to the Windows tester.
