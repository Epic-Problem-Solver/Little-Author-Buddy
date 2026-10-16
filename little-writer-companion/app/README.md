# Little Writer Companion — prototype (Tauri 2)

Layout: `ui/` (static frontend, no bundler; `character.js` = character component, `content.js` = Writer content loader, `main.js` = movement/HUD), `src-tauri/` (Rust: `input.rs` keystroke/wheel counter, `idle.rs` state machine + tests, `platform.rs` foreground title/rect + media, `store.rs` JSON persistence, `lib.rs` overlay/tray/tick loop).

## Prereqs (Debian/Ubuntu host)
    sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libxtst-dev libxi-dev build-essential clang lld llvm nsis
    curl https://sh.rustup.rs | sh && rustup target add x86_64-pc-windows-msvc
    cargo install --locked tauri-cli cargo-xwin

## Build
    ./scripts/sync-assets.sh            # copies ../assets and ../content into ui/ (re-run when they change)
    cd src-tauri
    cargo test                          # idle state machine tests
    cargo tauri build --bundles deb,appimage                     # Linux
    CARGO_TARGET_DIR=target-win cargo tauri build --runner cargo-xwin \
        --target x86_64-pc-windows-msvc --bundles nsis           # Windows (cross from Linux)

Outputs: `src-tauri/target/release/bundle/{deb,appimage}/`, `src-tauri/target-win/x86_64-pc-windows-msvc/release/little-writer-companion.exe` (portable, needs WebView2 — built into Win10/11) and `.../bundle/nsis/*-setup.exe`. An `.msi` needs WiX, i.e. building on Windows.

## Runtime notes
- Data: `%APPDATA%\dev.lwc.companion\state.json` / `~/.local/share/dev.lwc.companion/state.json` (settings, projects, counts — never key contents). Saved every 10 s when changed and on tray Quit.
- Tray: Pause/Resume listening, Quit.
- Linux: input via our own X11 RECORD listener (raw keycodes only; no Wayland-native capture). Windows: own WH_KEYBOARD_LL/WH_MOUSE_LL hooks (vkCode only, no ToUnicodeEx). No compositor on Linux → overlay shrinks to a corner box with a warning; window title via `xdotool`, media via `playerctl` (both optional). Transparency needs a compositor.

## v0.2 additions
- Tray: Pause, Interact with companion (turns off click-through for 30 s), Projects…, Settings…, Letter journal…, Privacy…, Quit.
- Settings window: colour presets (Animator's Beige/Sky/Rose/Mint) + pickers, keys-per-word slider (1–5), idle seconds, tier targets, desk monitor (default primary), roam scope, distraction toggles + title list, journal folder.
- Journal: each fan letter is saved in state.json and as a `.md` file in the journal folder (default `<Documents>/Little Writer Journal`, else `~/Little Writer Journal`); "Export all" rewrites them.
- Completion: overflow words carry over, the app waits for you to pick/start the next project (Projects tab opens).
- Corrupt `state.json` is moved to `state.corrupt-<ms>.json` and a warning shown; never silently overwritten.
- Saves every 2 s when changed, on tray Quit, and on SIGINT/SIGTERM/SIGHUP (Windows: console close/logoff/shutdown).
- Dev hook: `LWC_OPEN=settings|projects|journal|privacy` opens that tab 2 s after start.

## v0.3
- Only letter keys A–Z count (Windows vk 0x41–0x5A + VK_PROCESSKEY by scan-code position; Linux X keycodes of the A–Z positions). Ignore list removed.
- Keystrokes per word: slider 1–5 (default 5), larger saved values clamp to 5.

## v0.4
- Home window (`ui/home.html`): draggable desk, gear → Settings, **X quits the app** (saves first). Position persisted in `settings.home_pos`, validated against monitors.
- Writing tools pen/typewriter/laptop with progression (Short Story → Novella + typewriter → Novel + laptop), derived from completed projects; "Unlock all (testing)" toggle.
- First launch asks for the story title in the home window.
- Live hide tracking (`track_window` command + `target-rect` events, 40 ms) with pop-out when the target closes/minimises/shrinks.
- Linux letter detection from the XKB layout (rebuilt on mapping changes), US table fallback. Needs `xwininfo` (x11-utils) for hide tracking on Linux.
- JS unit tests: `node --test ui/tests/`. Test hooks: `LWC_OPEN=<tab>`, `LWC_FORCE_HIDE=1`.

## Screenshots, recording and capture (v0.4)
- No window is excluded from capture: `contentProtected: false` in config and `set_content_protected(false)` at runtime on every window (so no `SetWindowDisplayAffinity` WDA_MONITOR/WDA_EXCLUDEFROMCAPTURE on Windows, and `NSWindowSharingType` is not `none` on macOS). The app never calls `SetWindowDisplayAffinity` itself.
- Window styles (Windows): windows are **not** `WS_EX_TOOLWINDOW`. Taskbar hiding uses `skipTaskbar`, which tao implements with `ITaskbarList::DeleteTab`. Both windows have titles: overlay "Little Writer Companion", desk "Little Writer — Home". The overlay is `WS_EX_LAYERED | WS_EX_TRANSPARENT` while click-through (needed for click-through). Layered windows are composed by DWM and included in full-desktop capture (DXGI Desktop Duplication, Windows.Graphics.Capture, GDI BitBlt with CAPTUREBLT). The home window is not click-through, so it is a normal titled top-level window.
- **Flameshot**: full-desktop grab, so it should include both windows.
- **OBS (recommended): Display capture.** It shows everything, including the wandering companion.
- **OBS Window capture**: pick `[little-writer-companion.exe]: Little Writer — Home` and set *Capture Method* to **Windows 10 (1903 and up)** (WGC). BitBlt window capture cannot read WebView2/DirectComposition content and shows black or nothing. Window capture only shows the desk window; the wandering companion lives in the full-screen overlay, so use Display capture to record it.
- **OBS Game capture** hooks DirectX/OpenGL/Vulkan games, not ordinary desktop windows, so it will not capture the companion. Use Display or Window capture.
- Built-in alternative: **Snapshot** (tray → "Snapshot (save PNG)", or the gear menu on the desk) renders the companion and desk from the SVG with resvg into a transparent PNG at 2× (480×440) in `Pictures/Little Writer/little-writer-<date>_<time>.png`. It does not use screen capture.

## v0.5.0 notes
- **First run:** a 4-step onboarding window (welcome → buddy name → colours with live preview → first story title) replaces the old title prompt. Existing saves are migrated as already onboarded, with the buddy named "Inky". If onboarding is closed early, the desk HUD says "Click here to set up …" and reopens it.
- **{buddy} placeholder:** bubble lines and letters in `ui/content/*.json` may use `{buddy}`, alongside `{projectTitle}`, `{tier}` and `{wordCount}`.
- **Motion:** buddy size, walk speed and bubble text size are in Settings, with a live preview. They are also scaled by each monitor's scale factor and re-scale smoothly when moving between monitors. Movement is time-based (logical px/s) with easing, a speed cap and a 50 ms dt clamp.
- **Watching state:** when you are on a distraction, the buddy shows `data-body="watching"` (back turned), falling back to `peeking` with older art. The home desk sets `data-side="left|right"` from the half of the monitor it sits on.
- **Stability:**
  - Settings and Onboarding are opened by async commands on the main thread, and Settings loads `settings.html` with no URL fragment (the tab comes from `initial_tab` / `show-tab`).
  - Home-window geometry is kept in atomics. The drag `Moved` handler only stores atomics, and the position is saved 600 ms after the drag settles.
  - No Mutex is held across window calls.
- **Linux/X11:** some WMs (seen on Openbox) give the click-through overlay a frame that still takes clicks. The desk is activated at start so it stacks above the overlay.

## v0.6.0 notes (Animator v0.7.1 art)
- **Desk side:** the desk faces the middle of whichever monitor the home window is on. The side is worked out in Rust (`desk_side`, from the real monitor list) and updates after drags and monitor changes. Right half of the monitor → `data-side="right"`.
- **Race back:**
  - The buddy holds still for 1 s (`RACE_HOLD_MS`) so its bubble can be read; keys typed during the hold still count.
  - It then plays `data-body="rushing"` (falling back to `racing`), with `data-dir` set toward the desk.
  - It aims for the desk-scene body centre (x 164 for right, x 76 for left, versus 120 away from the desk), so the hand-off to the desk is seamless.
- **While wandering:** the home window shows `desk.svg` with the same tool and side; the inkwell is in the art.
- **Colours:** there is a single Body picker. Shade and hands are derived with Animator's OKLCH rule: L×0.75 and chroma×1.8, flipping to L+0.18 when L < 0.42. The UI uses `lw-color.js lwApplyColor`; `store.rs derive_body` is a port of the same rule, used for migration and saving. Old saves keep their body colour and get recomputed shade and hands.
- **Fixes:**
  - The snapshot viewBox now grows to the drawn bounding box plus 8 px (BUG-21).
  - The home window size is re-read after show and the desk is clamped on screen (BUG-22).
  - The gear tooltip is removed while its menu is open.
  - The slider preview is taller.
  - The home window has no selection highlight and a transparent background.
