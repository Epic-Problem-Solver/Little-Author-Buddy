<p align="center">
  <img src="little-writer-companion/app/src-tauri/icons/128x128.png" width="96" alt="Little Author Buddy">
</p>

<h1 align="center">Little Author Buddy</h1>

<p align="center">
  A small desktop companion that sits with you while you write.<br>
  Letter keys advance the story on its desk. When you stop, it sleeps, wanders, and comes back.
</p>

<p align="center">
  <a href="https://epic-problem-solver.github.io/Little-Author-Buddy/little-writer-companion/download/"><strong>Download</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Epic-Problem-Solver/Little-Author-Buddy/releases/latest">GitHub Releases</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">MIT License</a>
</p>

Little Author Buddy is a writing companion for Windows, macOS, and Linux. It counts your own letter keys toward a project, keeps a quiet desk on screen, and marks a finished story with a fan letter written on your machine. Version 0.7.0 is the public beta.

## Download

The [download page](https://epic-problem-solver.github.io/Little-Author-Buddy/little-writer-companion/download/) introduces the app. Installers for the current release are below, and every build is listed on [GitHub Releases](https://github.com/Epic-Problem-Solver/Little-Author-Buddy/releases/latest).

| System | v0.7.0 |
| --- | --- |
| Windows 10 and 11 (x64) | [Setup](https://github.com/Epic-Problem-Solver/Little-Author-Buddy/releases/download/v0.7.0/Little-Author-Buddy_0.7.0_x64-setup.exe) · [Portable](https://github.com/Epic-Problem-Solver/Little-Author-Buddy/releases/download/v0.7.0/Little-Author-Buddy-0.7.0-portable.exe) |
| macOS (Intel and Apple silicon) | [Disk image](https://github.com/Epic-Problem-Solver/Little-Author-Buddy/releases/download/v0.7.0/Little-Author-Buddy_0.7.0_universal.dmg) |
| Linux (x64) | [AppImage](https://github.com/Epic-Problem-Solver/Little-Author-Buddy/releases/download/v0.7.0/Little-Author-Buddy_0.7.0_amd64.AppImage) · [Debian package](https://github.com/Epic-Problem-Solver/Little-Author-Buddy/releases/download/v0.7.0/Little-Author-Buddy_0.7.0_amd64.deb) |

- Windows uses WebView2, which is part of Windows 10 and 11. The setup installer can fetch it if it is missing. The portable build expects it to be present.
- The macOS disk image is an unsigned universal build for Intel and Apple silicon. [Opening the Mac app](#opening-the-mac-app) has the steps and Apple’s links.
- Make the AppImage executable with `chmod +x`. It uses WebKitGTK 4.1 and GTK 3 from the host. The Debian package uses the distro's WebKitGTK 4.1.
- On Linux, key counting listens through X11.

## Opening the Mac app

The v0.7.0 disk image runs on Intel and Apple silicon Macs. It is not signed or notarized. Gatekeeper stops the first launch and shows a warning that the developer cannot be verified, or that Apple cannot check the app for malicious software. Approve that one copy, then grant the privacy permissions the companion uses to count keys and see the front window.

Apple’s pages for this:

- [Safely open apps on your Mac](https://support.apple.com/102445)
- [Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac)
- [Open an app by overriding security settings](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40617/mac)

### Install

1. Open the disk image and drag **Little Author Buddy** into Applications. Apple’s guide: [Install and uninstall other apps](https://support.apple.com/guide/mac-help/install-and-uninstall-other-apps-mh35835/mac).
2. Eject the disk image. Open the copy in Applications from the Finder. Launchpad has no shortcut menu for this step.

### macOS Sequoia and later

On [macOS Sequoia](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/15.0/mac/15.0) and [macOS Tahoe](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40617/26/mac/26), approve the app in Settings:

1. Try to open Little Author Buddy, then dismiss the warning.
2. Choose Apple menu → System Settings → Privacy & Security.
3. Scroll to Security and click **Open**, then **Open Anyway**. The button stays for about an hour after that attempt. If it is gone, try to open the app again.
4. Enter your login password and confirm.

The app is then an exception. Later launches are a normal double-click.

### macOS Sonoma and earlier

In the Finder, Control-click **Little Author Buddy** and choose **Open**, then click **Open** in the dialog. That is the [Sonoma](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/14.0/mac/14.0) procedure. Privacy & Security also shows **Open Anyway** for about an hour after a blocked attempt.

### Privacy permissions

After the app is allowed to launch, turn on the permissions it asks for. Both live under Apple menu → System Settings → Privacy & Security.

- [Accessibility](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac). The companion reads the front window’s title and rectangle from here.
- [Input Monitoring](https://support.apple.com/guide/mac-help/control-access-to-input-monitoring-on-mac-mchl4cedafb6/mac). Turn this on when macOS lists Little Author Buddy there. Letter keys are counted through a listen-only event tap, and the character of each key is not stored.

If the app is missing from a list, click the add button and choose it in Applications. Quit and open Little Author Buddy again after changing either switch.

## What it does

- **Writing.** Letter keys A–Z add words to the active project. Five keystrokes make one word by default, and Settings can set that from one to five. A key held down counts once.
- **Idle.** After a pause the companion falls asleep at the desk, then wakes and wanders the monitors you allow. The next letter key sends it racing back.
- **Distractions.** With the switches you turn on, it walks over to watch a window whose title is on your list, media that is playing while you are idle, or scrolling on the wheel.
- **Fan letters.** Finishing a project opens a letter — encouragement, a quote, or a joke — filled in from local templates, then asks for the next project. Each letter can be kept in a journal of Markdown files.
- **The desk.** A small window stays above your other windows. Drag it to move it. The gear opens Settings, and the close button quits. The tray pauses listening and opens projects, settings, the journal, and privacy.

The buddy's name starts as Inky. Settings also cover body colour, size, walk speed, idle time, tier targets, and which monitor holds the desk.

## Projects and tools

| After you finish | You can start | Tool on the desk |
| --- | --- | --- |
| — | Short story, 3,000 words | Feather pen |
| A short story | Novella, 30,000 words | Typewriter |
| A novella | Novel, 60,000 words | Laptop |

Word targets are editable. One project is active at a time, and others can wait in a queue. The tool on the desk is chosen from the tools that finished projects have unlocked.

## Privacy

The save holds counts, timestamps, projects, settings, and the journal. The character of each key stays out of that file. A distraction check uses the foreground window's title, a playing flag from the system media session, and wheel-event counts.

Fan letters are generated on the computer. The app runs with no account and no license check.

On Windows, WebView2 is Microsoft's component and may contact Microsoft on its own. The companion's project data stays in the folder below.

## Your files

| System | Data folder |
| --- | --- |
| Windows | `%APPDATA%\dev.lwc.companion\` |
| Linux | `~/.local/share/dev.lwc.companion/` |
| macOS | `~/Library/Application Support/dev.lwc.companion/` |

`state.json` in that folder is the save. If the file is damaged, the app moves it to `state.corrupt-<time>.json`, starts fresh, and shows a warning.

Journal files default to `Documents/Little Author Journal`, or `~/Little Author Journal` when that Documents folder is unavailable.

## Recording

The windows are included in screen capture. In OBS, Display capture records the desk and the companion while it wanders. Window capture of **Little Author — Home**, with the Windows 10 capture method, records the desk. Capture notes are in the [app README](little-writer-companion/app/README.md).

## Supporter packs

Hats, and the games chase-the-cursor and click-the-buddy, are a zip from this same public repository. The free installer remains the only app. It can load those packs from a `packs` folder beside the save. Finished projects still decide the pen, the typewriter, and the laptop. The pack format is under Distribution in [SPEC.md](little-writer-companion/SPEC.md).

## Building

The app is [Tauri](https://v2.tauri.app/) 2. The interface is static HTML, CSS, and JavaScript in `little-writer-companion/app/ui`. Rust lives in `little-writer-companion/app/src-tauri`.

Prerequisites, platform hooks, and version notes are in the [app README](little-writer-companion/app/README.md). Product behavior is in [SPEC.md](little-writer-companion/SPEC.md).

```bash
cd little-writer-companion/app
./scripts/sync-assets.sh
cd src-tauri
cargo test
cargo tauri build --bundles deb,appimage
```

`sync-assets.sh` copies `../assets` and `../content` into `ui/`. Run it again after art or copy changes.

Windows setup packages are described in the app README. GitHub Actions builds Linux packages in [linux.yml](.github/workflows/linux.yml) and the unsigned universal disk image in [macos.yml](.github/workflows/macos.yml). Opening that disk image is covered in [Opening the Mac app](#opening-the-mac-app).

JavaScript tests, from `little-writer-companion/app`:

```bash
node --test ui/tests/
```

## Repository

| Path | What it holds |
| --- | --- |
| `little-writer-companion/app/` | The Tauri application |
| `little-writer-companion/assets/` | Character and desk art |
| `little-writer-companion/content/` | Fan-letter and flavour-line JSON |
| `little-writer-companion/download/` | Download page, published with GitHub Pages |
| `little-writer-companion/SPEC.md` | Product specification |
| `LICENSE` | MIT License |

## License

[MIT](LICENSE). Copyright (c) 2026 Epic-Problem-Solver.

The app and the planned supporter content are public. Paying, when packs are offered, is a way to support the author. You may use, copy, modify, and share the program and the packs, including by building from this repository. Keep the copyright notice and this permission text with the code.
