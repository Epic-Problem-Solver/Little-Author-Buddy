Target: Cross-platform (Windows first, then macOS and Linux) desktop overlay companion (personal productivity tool, not a Steam clone or reverse-engineer of the commercial game).

Inspired by publicly described behavior of _Little Writer Desktop Companion_ (keystrokes advance a lazy writer companion). User explicitly excludes monetary progression / upgrade economy.

## Goals

1. Count the user's own keystrokes toward writing projects.
2. Animate a desktop companion that mirrors typing vs idle.
3. On project completion, surface encouraging "fan letters" (local generation only).

## Non-goals

- No in-app currency, shops, skill upgrades, or paid progression.
- No recording or exfiltration of typed content (counts and timing only).
- No Steam API, DRM, or binary reverse-engineering of the commercial game.
- Windows is the first build target; macOS and Linux follow from the same codebase (platform-specific input hooks behind one interface).

## Core behaviors

### Typing → writing

- Global low-level keyboard hook (Windows) increments a counter on key-down of **letter keys A–Z only** (v0.3 decision; replaces the earlier configurable ignore list and settles OQ-1):
    - Windows: virtual-key codes `0x41`–`0x5A`. IME: composition presses arriving as `VK_PROCESSKEY` (`0xE5`) are mapped by their hardware **scan code** against a fixed table of the A–Z key positions (PC Set 1: `0x10`–`0x19`, `0x1E`–`0x26`, `0x2C`–`0x32`), with no translation.
    - Linux (X11): at startup and on every keyboard-mapping change (core `MappingNotify`, XKB NewKeyboard/Map notify) a keycode→letter table is built once from the XKB layout: a keycode counts if its group-0, level-0 keysym is `a`–`z`. Nothing is looked up per event. If the layout yields fewer than 20 letters (e.g. a non-Latin group 0), the fixed US position table (evdev + 8: 24–33, 38–46, 52–58) is used as fallback.
    - macOS: a listen-only event tap. A key counts when the current layout's unshifted character is ASCII A–Z; that character is not stored. Fewer than 20 Latin letters falls back to the ANSI letter-key positions. Scroll-wheel events count as ticks. Accessibility (and Input Monitoring, when macOS lists the app there) must be granted. The focused window's title comes from the accessibility API, and its rectangle from window geometry. Now Playing supplies only a playing/not-playing flag.
    - Never counted: digits, punctuation, Space, Enter, Backspace, Tab, Delete, modifiers, function keys, arrows, numpad. Auto-repeat (held key) counts once.
    - Windows matches by virtual-key (layout-aware via the OS) or, for IME `VK_PROCESSKEY`, by physical position; Linux matches by the active XKB layout's base keysym (so AZERTY counts A/Q/Z/W/M correctly).
- Only keystroke _counts_ and timestamps are kept; never the character payload.
- Active project `words` increases by a mapping (e.g. N keystrokes ≈ 1 word, tunable).

### Idle states

- After `idle_threshold_ms` without relevant keystrokes (default ~20s): companion falls **asleep** at its desk.
- After a further random interval (default 1–5 min), it wakes and starts **wandering** the desktop.
- **Distraction detection** (overrides sleep/wander; each signal can be toggled off in settings):
    - *Foreground app / window title* matched against a user-editable list (e.g. YouTube, Netflix, Reddit, VLC). Title only; never screen or page contents.
    - *Media playback* via OS media session APIs (Windows SMTC, macOS Now Playing, Linux MPRIS): playing + not typing = distracted.
    - *Scroll without typing*: mouse-wheel event counts only (no positions/targets); sustained scrolling with no keystrokes = browsing.
    - When distracted, companion walks over to the focused window's rect and "watches" with a curious expression.
- On first relevant keystroke after idle: interrupt idle, play "race back to desk", resume typing animation.

### Multi-monitor

- Enumerate all displays (Tauri monitor API) with per-monitor DPI scaling; handle hot-plug and resolution changes live.
- Desk can be pinned to any monitor (setting); wandering can roam across all monitors or stay on the desk's monitor.
- Walks across monitor seams along the shared edge; never parks in gaps between differently sized screens.
- Distraction "watching" targets whichever monitor holds the focused window; race-back path crosses monitors as needed.

### Home window (desk) — v0.4

- The desk lives in its own small, always-on-top, frameless **home window** (200×180 CSS px; size fixed). The full-screen click-through overlay is used only for wandering, watching and peeking.
- Drag anywhere on the home window (except its buttons) to move it. The position is saved and validated against the current monitors on load (the whole window must fit on one monitor, otherwise it resets to the bottom-right of the primary monitor).
- Top-right buttons: **gear** opens Settings; **X quits the whole app** (saves state first, same path as tray Quit). Closing the window by other means (Alt-F4) also quits. There is no hide-to-tray.
- The character is drawn in the home window while typing/asleep/paused and in the overlay while wandering, watching, peeking or racing back.
- **First launch:** before the first Short Story is created, the home window shows a modal asking for its title. Letters typed meanwhile are kept and credited to it.

### Capture — v0.4

- No window is ever excluded from screen recordings (`contentProtected: false` everywhere; no display-affinity exclusion; macOS sharing type not none). Windows are titled and are not tool windows, so OBS Window capture can list them. Recommended OBS mode: Display capture (or Window capture of "Little Author — Home", using the Windows 10 capture method). Game capture is not supported for desktop windows.

### Writing tools and progression — v0.4

| Unlocked at start | After completing a Short Story | After completing a Novella |
| --- | --- | --- |
| Short Story tier, feather pen | + Novella tier, typewriter | + Novel tier, laptop |

- The tool (pen / typewriter / laptop) is chosen in Settings among unlocked tools; locked tiers and tools are shown disabled with the unlock condition and are rejected by the backend. If a chosen tool becomes locked, the best unlocked tool is shown.
- Unlocks are **derived from completed projects** (no separate stored state), so older saves migrate automatically.
- **Unlock all (testing)** setting unlocks every tier and tool without changing real progress; switching it off restores the real unlock state.

### Hiding and peeking

- **Screen edges:** companion slides partly off a monitor's outer edge (only edges with no adjacent monitor) and peeks back with half its face visible.
- **Behind windows (faked occlusion):** companion stays an always-on-top transparent overlay; using the target window's rect (`GetWindowRect`, macOS/Linux equivalents), it clips its own sprite along that window's edge so it looks tucked behind it, then leans out with a peek animation. No real z-order tricks or other-app injection.
- Hide spots chosen from window edges and screen edges near its wander position; peek timing randomised; expressions: shy, curious, giggly.
- Typing instantly cancels hiding and triggers race-back.
- While hiding behind a window, its rect is tracked live (~40 ms polling: Windows `GetWindowRect`/`IsIconic`/`IsWindow`; Linux `xwininfo`) and the sprite is re-positioned and re-clipped every update. If the window closes, minimises, or becomes too small (narrower than 2× sprite width or shorter than 1.2× sprite height), the companion pops out (excited) and resumes wandering.

### Projects

Tiers (defaults, user-editable):

| Tier        | Default word target |
| ----------- | ------------------- |
| Short story | 3,000               |
| Novella     | 30,000              |
| Novel       | 60,000              |

- One active project at a time; queue allowed.
- Progress UI: companion desk + simple progress bar / word count.
- On complete: mark done, archive stats, trigger fan-letter flow, prompt next project.

### Fan letters

- Local templates + seeded RNG (no network required).
- Categories: encouragement, inspirational quote, humorous saying.
- Shown as a small letter/card UI; savable to a local journal folder.

## UX / presentation (open decision)

Decided: a round, flat-vector blob character (see `character-reference.jpg`): circular body, thick dark outline, two small round floating hands, dot eyes, simple smile, two-tone shading on a warm beige palette.

- **Customizable body colour:** the body is user-selectable (colour picker plus presets). Shading and hands follow the body. The outline, desk, and writing tools stay their default colours. Art is layered SVG so the body recolours cleanly.
- **Animated facial expressions:** blinking, happy, focused (typing), sleepy/asleep, curious (peeking at a window), surprised/excited (racing back), proud (project complete). Eyes and mouth animate separately from the body.

Always-on-top, click-through optional when not interacting; tray icon for pause / quit / privacy.

## Technical proposal (Windows)

- **Shell:** Tauri 2 (Rust + webview); prefer Tauri for smaller footprint and easier native hooks.
- **Input:** `SetWindowsHookEx` WH_KEYBOARD_LL in a small native helper, or existing audited crate/crate wrapper; run with clear tray "Listening / Paused".
- **Window awareness:** Win32 `GetForegroundWindow` + `GetWindowRect` / title for wander-look only.
- **Persistence:** local SQLite or JSON for projects, settings, letter journal.
- **Privacy:** on-device only; document that key _contents_ are never stored.

## Milestones

1. Spec sign-off (style + idle behaviour).
2. Vertical slice: keystroke count → word progress → tray pause.
3. Companion idle + return-to-desk animations (placeholder art OK).
4. Project tiers + completion.
5. Fan-letter generator + journal.
6. Polish: settings, installable `.msi`/portable build.

## Open questions (user)

3. Preferred stack if they care: Tauri vs Electron (default Tauri).

## Acceptance (v1)

- Runs on Windows, survives overnight, pauseable from tray.
- Typing clearly advances the active project; idle triggers sleep or wander; typing resumes desk animation.
- Completing a project shows at least one fan letter from each category over a few completions.
- No monetary systems; no typed text retained.
## v0.5.0 additions
- Onboarding (4 steps). `Data.onboarded: Option<bool>`: None on an old save → migrated to `!needs_title()`. Missing or corrupt file → `Some(false)`.
- Settings: `buddy_name` (default "Inky", max 40 chars), `buddy_scale` 0.6–1.6, `walk_speed` 40–300 logical px/s, `bubble_px` 9–20. Colours: `paper`, `paper_shade`.
- Content placeholder `{buddy}`.
- Watching: `data-body="watching"` (alias away) with a peeking fallback. Home desk: `data-side`.
- Concurrency rules:
  - Window-creating commands are async or run on the main thread.
  - No state lock is held across window or IPC calls.
  - Window event handlers do atomics only.
  - Input hook callbacks take no locks.

## v0.6.0 additions
- Snapshot field `home_side` (`left`/`right`). The race-back adds a 1 s hold (the Rust race window grows by the same amount).
- Desk-alone layer: `desk.svg` while the buddy is away.
- Colours: shade and hands are always derived from the body (OKLCH rule; see `lw-color.js`).
