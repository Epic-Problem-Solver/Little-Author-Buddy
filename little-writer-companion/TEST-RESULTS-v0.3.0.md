# Test Results — v0.3.0 (Linux live + Windows static) 
- Started 23:05 ET. Tester agent. Only my own processes are started and stopped.
- **Build fresh: YES.** Newest source/asset 21:21:17 ET. deb 21:23:39, Linux binary + AppImage 21:24:21, Windows exe + 0.3.0 NSIS 21:25:26. Linux sha256 0d89ec20317db659…
- **Unit tests: 10/10 pass** (incl. input::letters_only, counting_and_repeat, store::kpw_clamp_and_migration).

## Results
| Check | Result | Evidence |
|---|---|---|
| A-Z count (US keymap) | P | a–z +26; canary string → its 21 letters only |
| Digits / punctuation | P | `0-9` +0; `.,;:!?-=[]/\'\`` +0 |
| Space, Enter, Backspace, Tab, Esc, Delete | P | +0 |
| Modifiers, CapsLock, F1/F5/F12, arrows, Home/End | P | +0 |
| Shift+letter | P | shift+a, shift+B → +2 (once each) |
| Held key | P | keydown k for 2 s, X autorepeat on → +1 |
| Migration kpw 9 + ignore_keys | P | → kpw 5, ignore_keys removed, no warning, no corrupt file, prior total kept (100 → 150) |
| Migration kpw 0 | P | → 1, ignore_keys dropped, no warning |
| Migration kpw 5 (+ empty ignore_keys) | P | unchanged 5, dropped, no warning |
| BUG-18 BOM | **P (fixed)** | BOM + valid JSON (1,234 keystrokes, kpw 3) → loads, progress kept (→1,237), no backup, no warning |
| BUG-17 no-compositor box | **P (fixed)** | xwininfo: 460x380 at 1460,700 |
| de keymap | P (quirk) | y/z (QWERTZ, physical positions) count; ö ä ü ß count 0 (non-A-Z keys) |
| fr AZERTY | **Quirk → BUG-19** | a q w z count; **m = 0** (AZERTY M is on keycode 47, not in the table); **`,` = +1** (keycode 58, the US "m" position); `;` and é 0 |
| Keys-per-word slider | P | Settings shows a 1–5 range at 5. Keyboard Left×3 → 2 → Save → state.json kpw 2. Help text explains letters-only |
| Privacy: canary greps | P | 0 hits (ASCII, case-insensitive, UTF-16LE) across all v0.3.0 test homes |
| Privacy: network | P | strace: 0 AF_INET/AF_INET6. Only X11 + dbus Unix sockets |
| Privacy: memory scan | P | lwc + WebKitNetworkProcess + WebKitWebProcess right after typing canaries: 0 hits |
| Windows static | P | CSP strict. No WinHTTP/WinINet/Winsock. ToUnicodeEx/GetKeyboardState/MapVirtualKey* still imported by tao (Tauri's own window keyboard handling), not by our hook (same as v0.2.0) |
| Windows scan-code table review | P (with note) | Set-1 0x10–0x19 = Q..P, 0x1E–0x26 = A..L, 0x2C–0x32 = Z..M: correct, and excludes 0x27/0x28 (;/' = Ö/Ä/M-on-AZERTY). Used only for VK_PROCESSKEY (0xE5); the synthetic 0x10000+scan code keeps auto-repeat working. **Note:** non-IME keys use vk 0x41–0x5A, which are *layout-mapped*, so on Windows AZERTY M (VK_M) counts and the US-m-position "," doesn't. Linux is the reverse (by physical keycode). See BUG-19 |
| Tray / live multi-monitor / media / perf / overnight | B | Not runnable here (unchanged from v0.2.0) |
| Windows runtime (install, IME, dead keys PV-17, Procmon/pktmon) | D | Windows tester |

## Counts
16 checks: **15 pass, 0 fail, 0 blocked of the in-scope ones** (plus BUG-19 as a quirk; the blocked/deferred groups above are unchanged from v0.2.0).

## Bug status
- BUG-17: **fixed** (xwininfo 460x380). BUG-18: **fixed** (BOM loads, progress kept). BUG-01/14/15/16: no regression seen (migration loads produce no corrupt warning; input path is letters-only).

## New bug
| ID | Sev | Repro | Expected | Actual | Location |
|---|---|---|---|---|---|
| BUG-19 | Low–Med (non-US layouts) | Linux: `setxkbmap fr`, type "m" then ",". Windows (by review): AZERTY | Every A–Z letter counts once on every layout, and punctuation never counts | Linux counts by *physical US position*: AZERTY m (keycode 47) = 0, "," (keycode 58) = +1. Windows counts by *layout VK* (AZERTY m counts) but uses scan-code positions only under an IME. So the two platforms disagree, and on Linux AZERTY users lose every "m" and gain every ",". QWERTZ y/z are fine on both | input.rs `is_letter` (Linux keycode table) vs Windows vk check. Option: on Linux, take the keysym from the server's keymap *once per keycode* (XkbKeycodeToKeysym on a cached table, not per event) and count keycodes whose base keysym is a–z. Or accept and document "letter positions of a US keyboard" |

## Verdict
**SHIP for the Windows handoff.** Every in-scope check passes, BUG-17/18 are fixed, privacy is clean, and the Windows letter logic is correct for US/QWERTZ/AZERTY via VK. BUG-19 mainly affects the Linux build on AZERTY (Windows only edge cases under an IME on AZERTY), so it shouldn't block the Windows installer. Fix it before a Linux release.

## Privacy verdict
PASS: no typed content on disk or in memory, no network, strict CSP.
