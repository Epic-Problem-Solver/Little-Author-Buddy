# Little Author Buddy for Chrome and Chrome OS

This is the free companion, the same desk as the desktop app, running as an unpacked extension. It counts letter keys on web pages and keeps the projects and the fan letters. The Games button lists Chase the Mouse, Tag the Buddy, Red Light Green Light, High Five, and Hide and Seek, and Play starts one without a supporter pack. A pack changes that game's name and lines. Hats come from the same pack. Neither is bundled in this extension. The extension keeps its own save. The desktop app's `state.json` is left alone.

Chrome cannot do several things the desktop app does. Those limits are real. The extension does not pretend otherwise.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `chrome` folder (`little-writer-companion/chrome`).

The desk opens in a small always-on-top window, pinned to the bottom-right of the screen. The desk itself stays in the bottom-right corner of that window. The toolbar button pauses counting, opens Projects, Settings, Journal, and Privacy, and quits. Closing the desk quits too. **Show desk** on the toolbar opens it again.

To refresh the copied desk pages after a desktop UI change, run `node sync-ui.js` from this folder, then reload the extension.

## What works

- Letter keys A–Z on web pages, including inside frames, count toward the open project. A key held down counts once. Keys typed in the desk, settings, and a game count too.
- The wheel counts as scrolling. Digits, punctuation, Space, Enter, and shortcuts do not count.
- After a pause, Buddy sleeps at the desk and wakes there on the next letter key.
- After fifteen minutes of writing at the desk, Buddy suggests one game and keeps typing. Falling asleep starts that wait over. The suggestion stays on the desk and is not saved. Tray pause holds the wait. The Games button beside the gear opens the list. Play fills this window, then shrinks it back. A pack is not required. Letter keys end the round. Settings can set the window’s background colour.
- Projects, tools, and colours. Hats and the pack’s game names load when Activate or a packs folder is used.
- Fan letters are written on this machine. Choose a journal folder in Settings and the letter is saved there as Markdown. Without a folder, the letter downloads.
- Supporter pack: in Settings, on the Supporter tab, Activate installs `Little Author Buddy DLC.zip`. The picker starts in Downloads. If that zip was chosen before, Activate uses it again. The extension does not download the zip, and it cannot look through Downloads by itself. You can also choose a packs folder (or the repo's `supporter` folder). Only `manifest.json`, `hat.svg`, and `game.json` are read. Nothing in a pack is executed. There is no second extension and no license check.
- The first time this version opens a desk that was already set up, a short welcome lists what changed. Those notes describe this Chrome desk.
- A quiet check against the public GitHub release. It opens the download page. It does not download an installer.

## What Chrome cannot do

- Keys are counted only in web pages and in this extension. The address bar, `chrome://` pages, Android apps, and Linux (Crostini) apps are not counted.
- When idle, Buddy sleeps at the desk. A game fills that window, then the window shrinks back to the bottom-right. The cursor is read only inside that window, and it is not saved. The hiding game uses rectangles in that window. The Games list is its own window. Closing that list does not quit. Closing the desk quits, including during a game. Window titles are left alone.
- Downloads cannot be searched for the supporter zip. Activate asks you to choose `Little Author Buddy DLC.zip`.

## Permissions

The extension asks to read web pages so it can count letter keys and wheel ticks. The message is a count. The key and the page address are not stored.

Storage stays in the extension. Export and import on the Settings tab move that save as JSON. It is not the desktop save.

## Version

The extension version matches the desktop app, currently 0.8.0. It needs Chrome or Chrome OS 114 or newer for an always-on-top window.
