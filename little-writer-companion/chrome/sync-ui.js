// Copy the desktop UI into the extension and add the Chrome bridge.
// Chrome-only pages (stage, letter) are left in place. The desktop UI is not edited.
const fs = require('fs');
const path = require('path');

const chromeDir = __dirname;
const uiSrc = path.join(chromeDir, '..', 'app', 'ui');
const uiDest = path.join(chromeDir, 'ui');
const skip = new Set(['stage.html', 'stage.js', 'letter.html', 'letter.js', 'tests']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (skip.has(name)) continue;
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function inject(file) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('host.js')) return;
  const home = path.basename(file) === 'home.html';
  const tags = '<script src="../files.js"></script><script src="../host.js"></script>'
    + (home ? '<link rel="stylesheet" href="../chrome.css">' : '');
  if (html.includes('<head>')) html = html.replace('<head>', '<head>' + tags);
  else html = tags + html;
  fs.writeFileSync(file, html);
}

copyDir(uiSrc, uiDest);
for (const name of fs.readdirSync(uiDest)) {
  if (name.endsWith('.html')) inject(path.join(uiDest, name));
}

const icons = path.join(chromeDir, 'icons');
fs.mkdirSync(icons, { recursive: true });
const iconSrc = path.join(chromeDir, '..', 'app', 'src-tauri', 'icons');
fs.copyFileSync(path.join(iconSrc, '32x32.png'), path.join(icons, '32.png'));
fs.copyFileSync(path.join(iconSrc, '128x128.png'), path.join(icons, '128.png'));
console.log('synced chrome/ui and chrome/icons');
