Target: Cross-platform (Windows first, then macOS and Linux) desktop overlay companion (personal productivity tool, not a Steam clone or reverse-engineer of the commercial game).

Inspired by publicly described behavior of _Little Writer Desktop Companion_ (keystrokes advance a lazy writer companion). User explicitly excludes monetary progression / upgrade economy. Optional supporter content is sold off-app; see Distribution.

## Goals

1. Count the user's own words toward writing projects.
2. Animate a desktop companion that mirrors typing vs idle.
3. On project completion, surface encouraging "fan letters" (local generation only).

## Non-goals

- No in-app currency, shop, skill upgrades, or paid progression. Writing tools and story tiers unlock only from completed projects. Hats and mini-games are supporter content packs sold on the website; they do not change writing progress (see Distribution).
- No recording or exfiltration of typed content (counts and timing only).
- No Steam API, DRM, license keys, or binary reverse-engineering of the commercial game.
- Windows is the first build target; macOS and Linux follow from the same codebase (platform-specific input hooks behind one interface).

## Core behaviors

### Typing → writing

- A finished word counts as one word. The hook keeps a number, how many letters or digits have been pressed since the last gap, and adds one word when Space, Enter, or Tab arrives and that number is at least 1. Backspace lowers the number, including when the key repeats. A hyphen or an apostrophe does not break the word and does not add to the number. The number is not saved. Quitting drops an unfinished word.
- The keys that build a word are still classified without storing the character (v0.3 decision for letters; word gaps replace the keys-per-word estimate):
    - Windows: letter virtual-keys `0x41`–`0x5A`, digit virtual-keys `0x30`–`0x39` and numpad `0x60`–`0x69`, Space `0x20`, Enter `0x0D`, Tab `0x09`, Backspace `0x08`. IME composition arrives as `VK_PROCESSKEY` (`0xE5`) and is mapped by hardware scan code: letter rows `0x10`–`0x19`, `0x1E`–`0x26`, `0x2C`–`0x32`; digit row `0x02`–`0x0B`; space `0x39`, enter `0x1C`, tab `0x0F`, backspace `0x0E`. Numpad scans are not used, because num-lock-off arrows share them. No translation.
    - Linux (X11): at startup and on every keyboard-mapping change (core `MappingNotify`, XKB NewKeyboard/Map notify) one keycode table is built from group-0 level-0 keysyms: letters `a`–`z`, digits `0`–`9` and keypad digits, space, Tab, Return, keypad Enter, and BackSpace. Nothing is looked up per event. Fewer than 20 letters falls back to the US evdev positions.
    - macOS: a listen-only event tap. The layout table tests each key's unshifted character and discards it: A–Z, 0–9, space, tab, return, and backspace. Fewer than 20 Latin letters falls back to the ANSI positions. Scroll-wheel events count as ticks. Accessibility (and Input Monitoring, when macOS lists the app there) must be granted. The focused window's title comes from the accessibility API, and its rectangle from window geometry. Now Playing supplies only a playing/not-playing flag.
    - A letter or a digit adds to the unfinished word. A held letter or digit adds once. Digits are the top row and the numpad. Space, Enter, and Tab close the word. Delete, modifier keys, function keys, arrows, and other punctuation do not. The hook does not read whether Ctrl is held, so a letter pressed with Ctrl still lengthens the unfinished word.
    - Windows matches letters and digits by virtual-key (layout-aware via the OS) or, for IME `VK_PROCESSKEY`, by physical position. Linux matches by the active XKB layout's base keysym (so AZERTY counts A/Q/Z/W/M correctly).
- Only the word count is kept, plus a per-day total. The character is never stored.
- An older save stored letter keystrokes. On load those counts are divided by that save's keys-per-word value, once, and the remainder is dropped. After that, each stored unit is one word.

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

## Distribution

One public repository and one `main` branch hold the app and the supporter content. GitHub Releases of the free installer are the beta and the lasting free download. The website's free button links to that Release. The website (WordPress + Stripe) sells supporter content as a zip. There is no paid fork and no second installer.

**License.** MIT. The MIT License fits because the free app and the supporter content are both public, and paying is a way to support the author rather than a lock on the files. Anyone may use, copy, modify, and share the program and the packs, including people who build from the GitHub repository instead of buying the zip. The license asks only that the copyright notice and permission text stay with the code. Testers and contributors can try the source during the beta, and the website can still sell the ready-made supporter pack to people who want the hats and mini-games without building them.

### Free app

- The writing companion: word counts, idle and wander, fan letters, and the pen, typewriter, and laptop ladder earned from completed projects.
- `app/scripts/sync-assets.sh` copies `assets/` and `content/` into `app/ui/`. It does not copy `supporter/`.
- One installer. The rest of this spec is the free app's behavior.

### Supporter packs

- Source lives in `supporter/` in this same repository and is public. Hats are SVG art. Mini-games are Chase the Mouse, Tag the Buddy, Red Light Green Light, High Five, and Hide and Seek. A game pack is a manifest plus `game.json` (the lines Buddy speaks). The app runs those games itself, because pack scripts are not executed. Each pack has a manifest with `id`, `kind` (`hat` or `game`), `minAppVersion`, and `files`.
- The Stripe product is a zip built from `supporter/`. A new hat, or new lines for a game the app already runs, is a new zip, not a new build of the app. A new engine is an app build.
- The app loads installed packs from a `packs/` directory beside `state.json` in the `dev.lwc.companion` data directory (`%APPDATA%\dev.lwc.companion\packs\` on Windows, `~/.local/share/dev.lwc.companion/packs/` on Linux, `~/Library/Application Support/dev.lwc.companion/packs/` on macOS). Loading is local, the same kind of read as `content/*.json`. The app refuses a pack whose `minAppVersion` is newer than itself.
- No license key, account, or network check is required. Building `supporter/` from source is allowed.
- A hat is an extra SVG layer on a documented anchor in `assets/character.svg`. Hat packs ship only after that anchor is stable.

### What payment does not change

- Story tiers and writing tools stay derived from completed projects.
- The app has no currency, shop, or upgrade screen.

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
- No in-app monetary systems; no typed text retained.

## v0.5.0 additions
- Onboarding (4 steps). `Data.onboarded: Option<bool>`: None on an old save → migrated to `!needs_title()`. Missing or corrupt file → `Some(false)`.
- Settings: `buddy_name` (default "Buddy", max 40 chars), `buddy_scale` 0.6–1.6, `walk_speed` 40–300 logical px/s, `bubble_px` 9–20. Colours: `paper`, `paper_shade`.
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
