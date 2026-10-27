// Folder access for the journal and supporter packs. Handles stay in IndexedDB.
// Pack files are read as text. Nothing in a pack is executed.
(function (root) {
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('lwc-chrome', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function putHandle(key, handle) {
    const store = await db();
    await new Promise((resolve, reject) => {
      const tx = store.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getHandle(key) {
    const store = await db();
    return new Promise((resolve, reject) => {
      const tx = store.transaction('handles', 'readonly');
      const q = tx.objectStore('handles').get(key);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    });
  }
  async function ensurePermission(handle, mode) {
    if (!handle || !handle.queryPermission) return false;
    const want = { mode: mode || 'readwrite' };
    if (await handle.queryPermission(want) === 'granted') return true;
    if (!handle.requestPermission) return false;
    return await handle.requestPermission(want) === 'granted';
  }
  async function readPackDir(id, handle) {
    const files = {};
    for (const fn of ['manifest.json', 'hat.svg', 'game.json']) {
      try {
        const fh = await handle.getFileHandle(fn);
        const file = await fh.getFile();
        if (file.size > 32768) continue;
        files[fn] = await file.text();
      } catch (_) { /* that pack file is absent */ }
    }
    return { id, files };
  }
  // One folder per pack, or a folder that contains those folders (hats/ and games/).
  async function readPackTree(dir) {
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'directory') continue;
      const one = await readPackDir(name, handle);
      if (one.files['manifest.json']) { out.push(one); continue; }
      for await (const [child, sub] of handle.entries()) {
        if (sub.kind !== 'directory') continue;
        const nested = await readPackDir(child, sub);
        if (nested.files['manifest.json']) out.push(nested);
      }
    }
    return out;
  }
  async function writeFiles(dir, files) {
    for (const f of files) {
      if (!f || !f.name || /[\\/\0]/.test(f.name) || f.name.includes('..') || !f.name.endsWith('.md')) {
        throw new Error('journal file name is not allowed');
      }
      const fh = await dir.getFileHandle(f.name, { create: true });
      const w = await fh.createWritable();
      await w.write(f.markdown || '');
      await w.close();
    }
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const Files = { putHandle, getHandle, ensurePermission, readPackTree, writeFiles, download };
  if (typeof module !== 'undefined' && module.exports) module.exports = Files;
  else root.LWCFiles = Files;
})(typeof globalThis !== 'undefined' ? globalThis : this);
