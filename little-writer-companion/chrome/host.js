// Stand-in for the desktop bridge. Pages keep calling window.__TAURI__.
const listeners = {};
const port = chrome.runtime.connect({ name: 'ui' });
port.onMessage.addListener(msg => {
  if (!msg || !msg.event) return;
  for (const fn of listeners[msg.event] || []) fn({ payload: msg.payload });
});

async function writeJournal(files) {
  if (!files || !files.length || !navigator.storage) return;
  const Files = window.LWCFiles;
  if (!Files) throw new Error('Journal storage is not available');
  let dir = await Files.getHandle('journal');
  if (dir && !(await Files.ensurePermission(dir, 'readwrite'))) dir = null;
  if (dir) { await Files.writeFiles(dir, files); return dir.name; }
  if (files.length === 1) { Files.download(files[0].name, files[0].markdown); return 'download'; }
  throw new Error('Choose a journal folder first');
}

const DLC_NAME = 'Little Author Buddy DLC.zip';
const DLC_MAX = 2 * 1024 * 1024;
let dlcHandle = null;

function dlcFail(kind) {
  const err = new Error(kind);
  err.dlc = kind;
  return err;
}

function bytesToB64(bytes) {
  let text = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(text);
}

async function bytesOfFile(file) {
  if (!file || file.size < 1 || file.size > DLC_MAX) throw dlcFail('read');
  return new Uint8Array(await file.arrayBuffer());
}

async function bytesOfHandle(handle) {
  try {
    return await bytesOfFile(await handle.getFile());
  } catch (e) {
    if (e && e.dlc) throw e;
    if (e && e.name === 'NotFoundError') {
      dlcHandle = null;
      throw dlcFail('missing');
    }
    throw dlcFail('read');
  }
}

function pickZipInput() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    let settled = false;
    const finish = file => {
      if (settled) return;
      settled = true;
      resolve(file || null);
    };
    input.addEventListener('change', () => finish(input.files && input.files[0]));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

// The picker has to start on the click. Chrome cannot read Downloads on its own.
function chooseZip() {
  if (typeof window.showOpenFilePicker === 'function') {
    return window.showOpenFilePicker({
      id: 'lwc-dlc',
      startIn: 'downloads',
      types: [{ description: 'Zip', accept: { 'application/zip': ['.zip'] } }],
    }).then(handles => (handles && handles[0]) || null).catch(e => {
      if (e && e.name === 'AbortError') throw dlcFail('missing');
      throw dlcFail('read');
    });
  }
  return pickZipInput();
}

function activateSupporter() {
  const job = dlcHandle ? bytesOfHandle(dlcHandle) : chooseZip().then(async picked => {
    if (!picked) throw dlcFail('missing');
    if (picked.getFile && window.LWCFiles && picked.name === DLC_NAME) {
      try { await window.LWCFiles.putHandle('dlc-zip', picked); } catch (_) {}
      dlcHandle = picked;
      return bytesOfHandle(picked);
    }
    return bytesOfFile(picked);
  });
  return job.then(bytes => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'activate', b64: bytesToB64(bytes) }, res => {
      const err = chrome.runtime.lastError;
      if (err) { reject(err.message); return; }
      if (!res || res.ok === false) { reject((res && res.error) || 'request failed'); return; }
      resolve(res.value);
    });
  })).catch(e => {
    if (e && e.dlc === 'missing') return { message: "Couldn't find " + DLC_NAME + ' in Downloads.', installed: false };
    if (e && e.dlc === 'read') return { message: 'That zip could not be read.', installed: false };
    return Promise.reject(e && e.message ? e.message : e);
  });
}

async function primeDlcHandle() {
  const Files = window.LWCFiles;
  if (!Files || dlcHandle) return;
  try {
    const handle = await Files.getHandle('dlc-zip');
    if (!handle || handle.name !== DLC_NAME || !handle.queryPermission || !handle.getFile) return;
    if (await handle.queryPermission({ mode: 'read' }) !== 'granted') return;
    await handle.getFile();
    dlcHandle = handle;
  } catch (_) {}
}

function invoke(cmd, args) {
  args = args || {};
  if (cmd === 'activate_supporter') return activateSupporter();
  if (cmd === 'update_settings' && args.settings) {
    args.settings.roam_all_monitors = false;
    const input = document.getElementById('pageColor');
    if (input && (input.dataset.ready === '1' || input.dataset.touched === '1')) args.settings.page_color = input.value;
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'invoke', cmd, args }, res => {
      const err = chrome.runtime.lastError;
      if (err) { reject(err.message); return; }
      if (!res || res.ok === false) { reject((res && res.error) || 'request failed'); return; }
      const files = res.files;
      if (!files) { resolve(res.value); return; }
      writeJournal(files).then(() => resolve(res.value)).catch(e => reject(e && e.message ? e.message : String(e)));
    });
  });
}

window.__TAURI__ = {
  core: { invoke },
  event: {
    listen(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return Promise.resolve(() => {
        listeners[name] = (listeners[name] || []).filter(f => f !== fn);
      });
    },
  },
  window: { getCurrentWindow: () => ({ startDragging }) },
};

let down = null;
document.addEventListener('mousedown', e => {
  if (e.button === 0) down = { sx: e.screenX, sy: e.screenY };
}, true);

function startDragging() {
  // The desk window stays at the bottom-right. Dragging it would only snap back.
  if (location.pathname.endsWith('/home.html')) return Promise.resolve();
  return chrome.windows.getCurrent().then(win => {
    const origin = down || { sx: win.left, sy: win.top };
    const ox = origin.sx - win.left, oy = origin.sy - win.top;
    let queued = null;
    const move = ev => {
      queued = { left: Math.round(ev.screenX - ox), top: Math.round(ev.screenY - oy) };
    };
    let raf = 0;
    const pump = () => {
      raf = 0;
      if (!queued) return;
      const next = queued; queued = null;
      chrome.windows.update(win.id, next);
      raf = requestAnimationFrame(pump);
    };
    const onMove = ev => { move(ev); if (!raf) raf = requestAnimationFrame(pump); };
    const up = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', up);
      chrome.runtime.sendMessage({ type: 'home-pos' });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', up);
  });
}

// Letter keys typed in the desk, settings, or a game count too. The character is not sent.
let pageLetters = 0;
if (location.pathname.endsWith('/onboarding.html')) {
  let characterApi = window.LWCharacter;
  const sleepOnBreak = api => {
    if (!api || api.__chromeSleep || typeof api.mount !== 'function') return api;
    const mount = api.mount.bind(api);
    api.mount = function () {
      return Promise.resolve(mount.apply(api, arguments)).then(ch => {
        if (ch && typeof ch.setState === 'function') {
          const setState = ch.setState.bind(ch);
          ch.setState = state => setState(state === 'wander' || state === 'watch' || state === 'race_back' ? 'asleep' : state);
        }
        return ch;
      });
    };
    api.__chromeSleep = true;
    return api;
  };
  Object.defineProperty(window, 'LWCharacter', {
    configurable: true,
    get() { return characterApi; },
    set(api) { characterApi = sleepOnBreak(api); },
  });
}
document.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key || '';
  const asking = document.body && document.body.dataset.asking === '1';
  if (asking && k.length === 1 && (k === 'y' || k === 'Y' || k === 'n' || k === 'N')) {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'answer', yes: k.toLowerCase() === 'y' });
    return;
  }
  const letter = (k.length === 1 && k.toLowerCase() >= 'a' && k.toLowerCase() <= 'z')
    || ((k === 'Process' || k === 'Unidentified' || k === 'Dead') && /^Key[A-Z]$/.test(e.code || ''));
  if (letter) pageLetters++;
}, true);
setInterval(() => {
  if (!pageLetters) return;
  const n = pageLetters; pageLetters = 0;
  chrome.runtime.sendMessage({ type: 'input', letters: n, wheels: 0 });
}, 200);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'session' && ch.asking && document.body) document.body.dataset.asking = ch.asking.newValue ? '1' : '0';
});

function showDeskSpeech(text) {
  const el = document.getElementById('speech');
  if (!el || !text) return;
  el.textContent = text;
  el.classList.add('on');
}

function hideDeskSpeech() {
  const el = document.getElementById('speech');
  if (el) el.classList.remove('on');
}

function dressHome() {
  if (!document.getElementById('deskAnchor')) {
    const anchor = document.createElement('div');
    anchor.id = 'deskAnchor';
    const kids = Array.from(document.body.childNodes);
    for (const n of kids) anchor.appendChild(n);
    document.body.appendChild(anchor);
  }
  let frame = document.getElementById('gameFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'gameFrame';
    frame.title = 'Game';
    frame.hidden = true;
    document.body.appendChild(frame);
    frame.addEventListener('load', () => {
      if (!frame.hidden && frame.contentWindow) frame.contentWindow.focus();
    });
  }
  const gameOn = s => {
    const phase = s && s.focus_phase;
    return phase === 'explain' || phase === 'play' || phase === 'back';
  };
  const syncFrame = s => {
    if (!s) return;
    const color = s.page_color || '#f6efe2';
    document.documentElement.style.setProperty('--lwc-bg', color);
    const on = gameOn(s);
    document.body.dataset.game = on ? '1' : '0';
    if (s.focus_phase === 'ask') {
      const n = Math.max(1, s.sprint_minutes | 0);
      const yn = ' Press Y for yes, or N for no.';
      const wrote = 'You wrote for ' + n + ' ' + (n === 1 ? 'minute' : 'minutes') + '! ';
      const text = s.focus_prompt === 'again'
        ? 'Want to do another sprint?' + yn
        : s.focus_prompt === 'sprint'
          ? wrote + 'Want to do another sprint?' + yn
          : wrote + 'Want to play a game?' + yn;
      showDeskSpeech(text);
    }
    if (on) {
      if (!frame.getAttribute('src')) frame.src = chrome.runtime.getURL('ui/stage.html');
      frame.hidden = false;
      if (frame.contentWindow) frame.contentWindow.focus();
      hideDeskSpeech();
    } else {
      frame.hidden = true;
      if (document.activeElement === frame) frame.blur();
    }
  };
  window.__TAURI__.event.listen('companion-state', e => syncFrame(e.payload));
  window.__TAURI__.event.listen('focus-say', e => {
    const p = e.payload || {};
    if (p.kind === 'ask' || p.kind === 'suggest') showDeskSpeech(p.text);
  });
  window.__TAURI__.core.invoke('get_snapshot').then(s => syncFrame(s)).catch(() => {});
}

function relabelSprints() {
  for (const el of document.querySelectorAll('legend')) {
    if (el.textContent.trim() === 'Focus timer') el.textContent = 'Sprint';
  }
  for (const el of document.querySelectorAll('label')) {
    if (el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.textContent.includes('Writing minutes before a game')) {
      el.firstChild.textContent = 'Writing minutes in a sprint ';
    }
  }
  for (const p of document.querySelectorAll('p.info')) {
    if (p.textContent.includes('When it finishes, Buddy walks') || p.textContent.includes('Thinking, wandering, and watching') || p.textContent.includes('When it finishes, Buddy asks if you want a game') || p.textContent.includes('With no supporter games installed')) {
      p.textContent = 'After fifteen minutes of writing at the desk, Buddy suggests a game. Falling asleep starts that wait over. The games button lists every game. Play fills this window, then shrinks it back.';
    } else if (p.textContent.indexOf('Buddy picks one of these when the writing timer finishes.') === 0 || p.textContent.indexOf('Buddy picks one of these when a sprint finishes.') === 0) {
      p.textContent = 'Installed names. The games button on the desk lists every game, and uses these names when the pack is here.';
    } else if (p.textContent.includes('Little Author Buddy DLC.zip')) {
      p.textContent = 'Choose Little Author Buddy DLC.zip. The picker starts in Downloads. If that zip was chosen before, Activate uses it again. This extension does not download the zip, and it cannot look through Downloads by itself. Nothing in a pack is run.';
    } else if (p.textContent.includes('next to state.json')) {
      p.textContent = 'Supporter hats installed with Activate, or from a packs folder you choose. They do not change writing progress.';
    }
  }
  for (const li of document.querySelectorAll('#privacy li')) {
    if (li.id === 'chromeNote') continue;
    if (li.textContent.includes('Falling asleep') || li.textContent.includes('Window titles are read')) {
      li.textContent = 'After fifteen minutes of writing at the desk, Buddy suggests a game. That suggestion is not saved. Falling asleep starts the wait over. This extension does not read window titles.';
    } else if (li.textContent.includes('reads the cursor') || li.textContent.includes('active window')) {
      li.textContent = 'A game reads the cursor only inside this window while it is playing. A click lands on Buddy. Nothing about the game is saved.';
    } else if (li.textContent.includes('state.json') || li.querySelector('#dpath')) {
      li.textContent = 'The save stays in this extension, separate from the desktop app. Fan letters are .md files in the journal folder you choose. Activate copies Little Author Buddy DLC.zip from this computer. The extension does not download it.';
    }
  }
}

function dressWindowColor() {
  if (document.getElementById('pageColor')) return;
  const fs = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Window';
  const label = document.createElement('label');
  label.appendChild(document.createTextNode('Background colour '));
  const input = document.createElement('input');
  input.type = 'color';
  input.id = 'pageColor';
  input.value = '#f6efe2';
  label.appendChild(input);
  const info = document.createElement('p');
  info.className = 'info';
  info.textContent = 'Colour of the desk window. It is saved with your settings.';
  fs.append(legend, label, info);
  const sprint = Array.from(document.querySelectorAll('legend')).find(el => el.textContent.trim() === 'Sprint');
  if (sprint && sprint.parentElement && sprint.parentElement.parentElement) sprint.parentElement.parentElement.insertBefore(fs, sprint.parentElement);
  else {
    const section = document.getElementById('settings');
    if (section) section.prepend(fs);
  }
  input.addEventListener('input', () => { input.dataset.touched = '1'; });
  invoke('get_data').then(data => {
    const c = data && data.settings && data.settings.page_color;
    if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) input.value = c.toLowerCase();
    input.dataset.ready = '1';
  }).catch(() => { input.dataset.ready = '1'; });
}

function dressNoWander() {
  const roam = document.getElementById('roam');
  if (!roam) return;
  roam.checked = false;
  const label = roam.closest('label');
  if (label) label.hidden = true;
}

function dressOnboarding() {
  for (const p of document.querySelectorAll('p')) {
    if (!p.textContent.includes('wanders')) continue;
    p.textContent = 'This little companion lives in this window and keeps you company while you write. Every word you type helps your buddy finish its own story. When you take a break, Buddy sleeps at the desk.';
  }
}

function bootPage() {
  const path = location.pathname;
  if (path.endsWith('/home.html')) dressHome();
  if (path.endsWith('/onboarding.html')) dressOnboarding();
  if (path.endsWith('/settings.html')) { relabelSprints(); dressWindowColor(); dressNoWander(); dressSettings(); }
  const dpath = document.getElementById('dpath');
  if (dpath) dpath.textContent = 'the extension’s local storage (separate from the desktop save)';
  const privacy = document.querySelector('#privacy ul');
  if (privacy && !document.getElementById('chromeNote')) {
    const li = document.createElement('li');
    li.id = 'chromeNote';
    li.textContent = 'In Chrome, letter keys are counted on web pages only. The address bar and apps outside Chrome are not counted. This extension is the free companion. The games button lists every game, and Play works before a pack is installed. A pack changes the names. Activate installs Little Author Buddy DLC.zip, or you can choose a packs folder. Play fills this window, then shrinks it back. The cursor is read only inside this window while a game is playing, and it is not saved.';
    privacy.appendChild(li);
  }
}

function dressSettings() {
  primeDlcHandle();
  const journal = document.getElementById('jdir');
  if (journal && journal.parentElement && !document.getElementById('pickJournal')) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'pickJournal'; b.textContent = 'Choose folder';
    b.style.marginLeft = '8px';
    journal.after(b);
    b.onclick = async () => {
      try {
        const dir = await showDirectoryPicker({ mode: 'readwrite', id: 'lwc-journal' });
        await LWCFiles.putHandle('journal', dir);
        journal.value = dir.name;
      } catch (e) { if (e && e.name !== 'AbortError') alert(e.message || e); }
    };
  }
  const hatInfo = document.getElementById('packNote') || document.getElementById('gameEmpty') || document.querySelector('#supporter .info, #games .info');
  if (hatInfo && !document.getElementById('pickPacks')) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'pickPacks'; b.textContent = 'Choose packs folder';
    b.style.marginLeft = '8px';
    hatInfo.after(b);
    b.onclick = async () => {
      try {
        const dir = await showDirectoryPicker({ mode: 'read', id: 'lwc-packs' });
        await LWCFiles.putHandle('packs', dir);
        const packs = await LWCFiles.readPackTree(dir);
        await chrome.runtime.sendMessage({ type: 'packs', packs });
        const msg = document.getElementById('msg');
        if (msg) msg.textContent = 'Packs loaded';
      } catch (e) { if (e && e.name !== 'AbortError') alert(e.message || e); }
    };
  }
  const save = document.getElementById('save');
  if (save && !document.getElementById('exportState')) {
    const exp = document.createElement('button');
    exp.type = 'button'; exp.id = 'exportState'; exp.textContent = 'Export save';
    exp.style.marginLeft = '8px';
    const imp = document.createElement('button');
    imp.type = 'button'; imp.id = 'importState'; imp.textContent = 'Import save';
    imp.style.marginLeft = '8px';
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    save.after(file); save.after(imp); save.after(exp);
    exp.onclick = async () => {
      const json = await invoke('export_state');
      LWCFiles.download('state.json', json);
    };
    imp.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      try {
        await invoke('import_state', { json: await f.text() });
        const msg = document.getElementById('msg');
        if (msg) msg.textContent = 'Save imported';
      } catch (e) { alert(e.message || e); }
    };
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootPage);
else bootPage();
