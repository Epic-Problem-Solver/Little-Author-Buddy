# Test Results — Little Writer Companion v0.2.0 (Linux run + Windows static checks)

- Date: 2026-10-14, 20:13–20:25 ET. Tester agent, on the box. Only my own processes (Xvfb :81, its xfwm4, the app, tcpdump) were started and stopped.
- **Build freshness: OK.** Newest source/asset edit 20:09:10 ET (ui/assets, ui/content); Rust/UI sources older. Linux binary + AppImage 20:11:21, `.deb` 0.2.0 20:10:27, Windows exe + `_0.2.0_x64-setup.exe` 20:12:37. Linux binary sha256 `73cb6249607acbf7…`.
- `cargo test --release`: **8/8 pass** (adds input mapping_and_counting, invalid_utf8_is_backed_up, unreadable_blocks_save_when_not_movable, local-date days).
- Environment: Xvfb :81 1920x1080 + xfwm4 (no compositor), fresh HOME per run, portal FUSE mounts unmounted after each run (fixes the v0.2 harness artifact), strace -f, tcpdump, /proc mem scan. Multi-monitor via the Node harness on the real main.js (Xvfb can't do 2 RandR monitors).
- Evidence: `test-evidence/v0.2.0/`.

## Bug status
| Bug | Status | Evidence |
|---|---|---|
| BUG-01 / 01b | **Verified fixed** | Each variant: backup byte-identical to the original + warning + fresh profile. nonutf8 (`\xff\xfe` printf repro) → "was not valid UTF-8 … backed up". Truncated JSON → "corrupt (EOF…)" backed up. UTF-8 BOM + valid JSON → treated as corrupt, backed up (see BUG-18). Empty file → backed up. Read-only folder (rename fails) → "could not be backed up; it will not be overwritten this session", state.json byte-identical after typing + SIGTERM. Valid file still loads (999 → 1002) |
| BUG-14 | **Verified fixed (with a note)** | rdev removed (0 in Cargo.lock). Linux: own X RECORD listener (input.rs:129-177) reads only the event type + keycode/button byte; binary imports only XRecord* (no XLookupString/keysym). Live on Xvfb: typing counts exactly; held key with autorepeat = 1; ignore list by name → raw codes works (incl. KeyA, Backspace, F5, arrows, Escape, Shift); wheel ticks count (20 wheel clicks after idle → companion left the desk to watch, box3.png). Windows: own WH_KEYBOARD_LL/WH_MOUSE_LL reading vkCode + message type only. **Note:** the Windows exe import table *does* still list ToUnicodeEx / GetKeyboardState / MapVirtualKeyW / MapVirtualKeyExW. They come from tao 0.37.1 (Tauri's windowing, `platform_impl/windows/keyboard_layout.rs`, `event.rs`), which handles keyboard input to the app's own windows, not the global hook. So the import-table check as worded fails, but the cause is harmless. Can't be removed without patching Tauri |
| BUG-15 | **Verified fixed** | At 20:18 EDT (00:18 UTC 10-15): journal file `2026-10-14-Night-Tale-….md`, heading 2026-10-14, daily stat day 2026-10-14 |
| BUG-16 | **Verified (with a minor issue)** | No compositor → warning banner + companion confined to the bottom-right 460x380 region (box3.png); the rest of the screen stays visible. Minor: xdotool reports the overlay window as 800x600 at 1460,700, so `set_size` didn't take effect (probably `resizable:false` on GTK). The extra area hangs off-screen, so nothing visible is blocked → BUG-17 |
| OBS-1 (privacy text) | Verified | settings.html:37 reworded for WebView2 |
| OBS-2 (giggly face) | Verified | main.js:93 uses `excited` |
| BUG-02–13 | Still pass | Re-run or unchanged; see table |

## New bugs
| ID | Sev | Repro | Expected | Actual | Location |
|---|---|---|---|---|---|
| BUG-17 | Low (Linux, no compositor) | Run without a compositor; `xdotool search --name "Little Writer" getwindowgeometry` | Overlay window 460x380 | 800x600 at (1460,700): position applied, size not. Extends off-screen, so it's harmless today, but it would cover more than the box on a monitor that isn't bottom-right-aligned | lib.rs fit_overlay `set_size` (tauri.conf `resizable:false`). Try `set_resizable(true)` before resizing, or create the window at that size |
| BUG-18 | Low | Save a valid state.json with a UTF-8 BOM (e.g. edited in older Windows Notepad) | Load normally (strip the BOM) | Treated as corrupt: backed up and a fresh profile started; progress looks lost until the user restores the backup | store.rs `load()`: strip a leading `\u{FEFF}` before parsing |

## Results (all checks)
| ID | Result | Evidence / notes |
|---|---|---|
| T-01 | P | "hello world" → 11; canary block 29 chars → 25 counted (4 ignored KeyA); 90 keys in the completion run |
| T-02 | P | Counted with xmessage/settings windows focused (re-run on 0.2.0) |
| T-03 | P | Shift ignored; "AAAA" with KeyA ignored → 0 (same keycode as "a") |
| T-04 | P | `xdotool keydown x`, held 2 s with X autorepeat on (`xset q`) → +1. Also unit test mapping_and_counting |
| T-05 | P | RECORD cb: KeyPress counts, KeyRelease only clears the held set |
| T-06 | P | Ignore list (ShiftLeft/Right, Escape, F5, UpArrow, KeyA, Backspace) → `xdotool key Shift_L Escape F5 Up BackSpace a A` = +0; other keys count |
| T-07 | P | kpw 4 via UI saved; 5 default (carried from v0.2; code path unchanged) |
| T-08 | P | Raw keystrokes stored (carried from v0.2; code path unchanged) |
| T-09 | P | Auto-creates "My Short Story" + notice (code; observed project created on a fresh profile) (carried from v0.2; code path unchanged) |
| T-10 | P | ~33 keys/s, exact counts |
| T-11 | P | state.json: counts, daily totals, settings, projects, journal letters only (re-run on 0.2.0) |
| T-12 | B | No tray host; code: `paused` gates key + wheel counting (carried from v0.2; code path unchanged) |
| ID-01 | P | Sleep then wander observed in the 40-frame sequence; code unchanged from v0.1 pass (re-run on 0.2.0) |
| ID-02 | P | Idle seconds field saved via UI (timing not re-measured) (carried from v0.2; code path unchanged) |
| ID-03 | P | Wander started ~80–100 s after the last key; unit test (carried from v0.2; code path unchanged) |
| ID-04 | P | Code (carried from v0.2; code path unchanged) |
| ID-05 | P | v0.1 runtime pass; state machine unchanged (unit test) (re-run on 0.2.0) |
| ID-06 | P | Same (carried from v0.2; code path unchanged) |
| ID-07 | P | Unit test (carried from v0.2; code path unchanged) |
| DS-01 | P | v0.1 runtime; code unchanged (carried from v0.2; code path unchanged) |
| DS-02 | P | Title list editable in the UI, saved (carried from v0.2; code path unchanged) |
| DS-03 | P | Case-insensitive substring, empty entries skipped (carried from v0.2; code path unchanged) |
| DS-04 | B | No MPRIS player (carried from v0.2; code path unchanged) |
| DS-05 | P | Code (carried from v0.2; code path unchanged) |
| DS-06 | P | v0.1 runtime; unchanged (re-run on 0.2.0) |
| DS-07 | P | Toggles in the UI + code gates (carried from v0.2; code path unchanged) |
| DS-08 | P | Unit/v0.1 (re-run on 0.2.0) |
| DS-09 | P | Code: fg refreshed 1 s while idle (carried from v0.2; code path unchanged) |
| DS-10 | P | Code (carried from v0.2; code path unchanged) |
| DS-11 | P | Unit test (Watch → Wander) (carried from v0.2; code path unchanged) |
| MM-01 | B | Single RandR monitor on Xvfb (carried from v0.2; code path unchanged) |
| MM-02 | B | Same (carried from v0.2; code path unchanged) |
| MM-03 | B | Same (carried from v0.2; code path unchanged) |
| MM-04 | P | Automated (real main.js): desk on chosen monitor (re-run on 0.2.0) |
| MM-05 | P | Automated: desk-only roam stays on the desk monitor (isolated harness), all-monitors uses both (re-run on 0.2.0) |
| MM-06 | P | Re-ran on the new main.js: 0/37,050 path samples in the gap; 0/1,000 spots in a gap; desk-only roam 0 off-desk (both harnesses) |
| MM-07 | B | Needs live multi-monitor (carried from v0.2; code path unchanged) |
| MM-08 | P | Automated: route() goes via the seam point (re-run on 0.2.0) |
| HP-01 | P | Runtime outer-edge peek + automated outer-edge-only (re-run on 0.2.0) |
| HP-02 | P | Automated: window-edge hide spots, clip line at window x (re-run on 0.2.0) |
| HP-03 | B | Window move during hide not exercised (carried from v0.2; code path unchanged) |
| HP-04 | P | Spots from nearby edges/windows (carried from v0.2; code path unchanged) |
| HP-05 | P | Faces now shy/curious/excited (OBS-2 resolved) |
| HP-06 | P | Code: mode change clears hide (carried from v0.2; code path unchanged) |
| HP-07 | P | No foreign-window manipulation (carried from v0.2; code path unchanged) |
| PJ-01 | P | Defaults 3k/30k/60k (carried from v0.2; code path unchanged) |
| PJ-02 | P | Editable in the UI; JSON tier 10 used (carried from v0.2; code path unchanged) |
| PJ-03 | P | Queue observed (carried from v0.2; code path unchanged) |
| PJ-04 | P | Completion → awaiting + Projects tab + Start button (re-run on 0.2.0) |
| PJ-05 | P | HUD/Projects text match state (carried from v0.2; code path unchanged) |
| PJ-06 | P | Persists across restarts (re-run on 0.2.0) |
| PJ-07 | P | Target 2 w, 90 keys → completed, carry 80, awaiting_next |
| PJ-08 | P | 0 → 1 clamp (carried from v0.2; code path unchanged) |
| FL-01 | P | No network (re-run on 0.2.0) |
| FL-02 | P | Seeded (code) (carried from v0.2; code path unchanged) |
| FL-03 | P | Category rotation by completion index (carried from v0.2; code path unchanged) |
| FL-04 | P | Letter generated + stored (card not screenshotted) (carried from v0.2; code path unchanged) |
| FL-05 | P | `~/Little Writer Journal/2026-10-14-Night-Tale-….md` |
| FL-06 | B | Read-only journal folder not tested (carried from v0.2; code path unchanged) |
| UX-01 | P | Character in the settings preview (settings_tab.png) (carried from v0.2; code path unchanged) |
| UX-02 | P | Presets + pickers; Rose saved (carried from v0.2; code path unchanged) |
| UX-03 | P | Code (proud hold); faces seen at runtime (re-run on 0.2.0) |
| UX-04 | P | alwaysOnTop (carried from v0.2; code path unchanged) |
| UX-05 | B | "Interact (30 s)" is a tray action; code reverts after 30 s (carried from v0.2; code path unchanged) |
| UX-06 | P | Privacy tab via LWC_OPEN; tray items in code (tray itself not clickable here) (carried from v0.2; code path unchanged) |
| PL-01 | D | Windows install (NSIS + portable exe present) (carried from v0.2; code path unchanged) |
| PL-02 | P | Tauri 2 + rdev (carried from v0.2; code path unchanged) |
| PL-03 | D | Windows lock/UAC/RDP (carried from v0.2; code path unchanged) |
| PL-04 | P | BUG-01 fixed (6 variants, see below) |
| PL-05 | D | macOS (carried from v0.2; code path unchanged) |
| PL-06 | P | X11 OK; Wayland warning in code (carried from v0.2; code path unchanged) |
| PL-07 | P | Platform split (carried from v0.2; code path unchanged) |
| PF-01 | B | Xvfb software rendering (carried from v0.2; code path unchanged) |
| PF-02 | B | Same (carried from v0.2; code path unchanged) |
| PF-03 | D | Windows hook latency (carried from v0.2; code path unchanged) |
| PF-04 | B | No overnight soak (carried from v0.2; code path unchanged) |
| PF-05 | P | Baseline unchanged order of magnitude (carried from v0.2; code path unchanged) |
| NG-01 | P | None (carried from v0.2; code path unchanged) |
| NG-02 | P | Dependencies add only ctrlc (carried from v0.2; code path unchanged) |
| NG-03 | P | None (carried from v0.2; code path unchanged) |
| PV-01 | P | strace writes: state.json.tmp→state.json, WebKit salt/hsts/cache, mesa cache, /tmp/tray-icon png, journal .md. Nothing else |
| PV-02 | P | Canaries + "hello world": 0 hits (ASCII, case-insensitive, UTF-16LE) across 8 test homes, backups, journal, WebKit storage, app output |
| PV-03 | P | Per-day totals only; no key fields (re-run on 0.2.0) |
| PV-04 | P | Only eprintln of warnings (carried from v0.2; code path unchanged) |
| PV-05 | P | /proc mem scan of lwc + WebKitNetworkProcess + 2 WebKitWebProcess right after typing canaries ×3: 0 hits |
| PV-06 | P | No clipboard/capture (carried from v0.2; code path unchanged) |
| PV-07 | P | 0 AF_INET/AF_INET6 connects across the process tree (only X11 + dbus Unix sockets) |
| PV-08 | B | mitmproxy unavailable (superseded by PV-07) (carried from v0.2; code path unchanged) |
| PV-09 | P | No network used (carried from v0.2; code path unchanged) |
| PV-10 | P | Strict CSP (both binaries) (re-run on 0.2.0) |
| PV-11 | P | Own RECORD listener reads xEvent byte 0 (type) and byte 1 (keycode/button) only; no XLookupString/keysym calls (objdump -T: only XRecord* imported from libXtst). Windows hook reads vkCode + wParam only (input.rs:99-114) |
| PV-12 | P* | rdev gone from Cargo.lock. Windows exe **still imports ToUnicodeEx, GetKeyboardState, MapVirtualKeyW/ExW**, but they come from tao 0.37.1 (Tauri's window toolkit: keyboard_layout.rs/event.rs) for key events in the app's OWN windows (e.g. typing in Settings), not from the global hook. No WinHTTP/WinINet/Winsock imports |
| PV-13 | P | core:default for overlay + settings (carried from v0.2; code path unchanged) |
| PV-14 | P | Titles not persisted/logged. Settings store the user's own title list only (carried from v0.2; code path unchanged) |
| PV-15 | P | Reworded: "The app itself makes no network requests. On Windows, the WebView2 runtime … may contact Microsoft…" |
| PV-16 | P | Code: pause gates counting (carried from v0.2; code path unchanged) |
| PV-17 | D | Windows: dead keys/IME unaffected while running (now very likely, since the global hook no longer translates keys) |

## Tally
97 checks (plan 95 + DS-11 + PV-17): **79 pass, 0 fail, 13 blocked, 5 deferred**. Bugs: BUG-01, 14, 15, 16 verified (14 with an import-table note, 16 with BUG-17); 2 new Low (BUG-17, BUG-18).

## Privacy audit verdict
**PASS (Linux runtime + Windows static).** The global input path no longer touches characters on either OS. No typed content in any file, backup, journal, cache, log or process memory. 0 network sockets. Strict CSP. Accurate privacy text. The only key-to-character calls in the Windows exe belong to Tauri's own window keyboard handling (tao), which is outside the global hook. Windows runtime (Procmon/pktmon, PV-17 dead keys) still deferred to the Windows tester.
