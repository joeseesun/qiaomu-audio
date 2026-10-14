/* global require -- Obsidian's desktop CommonJS loader supplies this function. */
import { Platform } from 'obsidian';

// Saving outside the vault is desktop only, through Node. Mobile never reaches these functions.
function node() {
  if (!Platform.isDesktopApp) throw Object.assign(new Error('desktop'), { code: 'folderDesktop' });
  /* eslint-disable @typescript-eslint/no-require-imports -- Desktop-only host bridge, guarded above. */
  return { fs: require('node:fs/promises'), path: require('node:path'), os: require('node:os') };
  /* eslint-enable @typescript-eslint/no-require-imports -- End guarded native imports. */
}
// "~" and "~/x" mean the home folder; anything else must already be a full path.
export function resolveFolder(input) {
  const { path, os } = node(), value = String(input || '').trim();
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  if (!path.isAbsolute(value)) throw Object.assign(new Error('absolute'), { code: 'folderInvalid' });
  return path.resolve(value);
}

// Writes each file into `folder`, never overwriting: a taken name gets " 2", " 3"… before the extension.
export async function saveToFolder(files, folder) {
  const { fs, path } = node(), dir = resolveFolder(folder), saved = [];
  try { await fs.mkdir(dir, { recursive: true }); } catch { throw Object.assign(new Error('mkdir'), { code: 'folderWrite' }); }
  for (const file of files) {
    const ext = path.extname(file.name), stem = path.basename(file.name, ext);
    let name = file.name, n = 1;
    for (;;) {
      try { await fs.access(path.join(dir, name)); n++; name = `${stem} ${n}${ext}`; } catch { break; }
    }
    const fullPath = path.join(dir, name);
    try { await fs.writeFile(fullPath, file.bytes, { flag: 'wx' }); } catch { throw Object.assign(new Error('write'), { code: 'folderWrite' }); }
    saved.push({ ...file, name, fullPath });
  }
  return saved;
}
export function revealPath(fullPath) {
  if (!Platform.isDesktopApp) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Desktop-only host bridge, guarded above.
  try { require('electron').shell.showItemInFolder(fullPath); return true; } catch { return false; }
}

// A native folder dialog without Electron's removed `remote` module: a hidden directory input reports the
// chosen folder through any file inside it. Empty folders cannot be detected; the caller falls back to typing.
export function pickFolder(doc) {
  return new Promise(resolve => {
    const input = doc.createElement('input'); input.type = 'file'; input.setAttribute('webkitdirectory', ''); input.addClass('qaudio-hidden');
    input.addEventListener('change', () => {
      const file = input.files?.[0]; input.remove();
      if (!file) { resolve(null); return; }
      let full = '';
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Desktop-only host bridge; this picker is only offered on desktop.
      try { full = require('electron').webUtils.getPathForFile(file); } catch { full = file.path || ''; }
      const relative = file.webkitRelativePath || '', root = relative.split('/')[0];
      resolve(full && relative ? full.slice(0, full.length - (relative.length - root.length)) : null);
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    doc.body.appendChild(input); input.click();
  });
}
