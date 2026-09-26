import type { Platform, SaveFileEntry } from './types';

// File System Access API (Chrome / Edge). Paths are "<folderId>/<fileName>".
type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
};

const folders = new Map<string, DirHandle>();
let vaultDir: DirHandle | null = null;
let seq = 0;

function split(path: string): [DirHandle, string] {
  const i = path.indexOf('/');
  const dir = folders.get(path.slice(0, i));
  if (!dir) throw new Error('Folder access was lost; please re-open the save folder');
  return [dir, path.slice(i + 1)];
}

async function writeIn(dir: DirHandle, name: string, input: Uint8Array | string) {
  const data: string | ArrayBuffer = typeof input === 'string' ? input : (input.slice().buffer as ArrayBuffer);
  const tmp = await dir.getFileHandle(`${name}.hlb-tmp`, { create: true });
  const w = await tmp.createWritable();
  await w.write(data);
  await w.close();
  // No atomic rename in the web API: write the real file only after the temp copy succeeded.
  const fh = await dir.getFileHandle(name, { create: true });
  const w2 = await fh.createWritable();
  await w2.write(data);
  await w2.close();
  await dir.removeEntry(`${name}.hlb-tmp`);
}

export const browserPlatform: Platform = {
  id: 'browser',
  label: 'Browser',
  canWrite: true,
  async detectSaveFolders() {
    return [];
  },
  async pickFolder() {
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('This browser cannot open folders. Use Chrome or Edge, or the desktop app.');
    const dir = await picker({ id: 'd2r-saves', mode: 'readwrite', startIn: 'documents' });
    const id = `f${++seq}`;
    folders.set(id, dir);
    return `${id}/`;
  },
  async listSaves(folder) {
    const dir = folders.get(folder.replace(/\/$/, ''));
    if (!dir) return [];
    const out: SaveFileEntry[] = [];
    for await (const h of dir.values()) {
      if (h.kind !== 'file' || !/\.(d2s|d2i)$/i.test(h.name)) continue;
      const f = await (h as FileSystemFileHandle).getFile();
      out.push({ name: h.name, path: `${folder.replace(/\/$/, '')}/${h.name}`, size: f.size, modified: f.lastModified });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
  async readFile(path) {
    const [dir, name] = split(path);
    const f = await (await dir.getFileHandle(name)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  },
  async writeFileAtomic(path, data) {
    const [dir, name] = split(path);
    await writeIn(dir, name, data);
  },
  async backupFiles(paths) {
    if (!paths.length) return '';
    const [dir] = split(paths[0]);
    const root = await dir.getDirectoryHandle('HoradricLootBox-Backups', { create: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sub = await root.getDirectoryHandle(stamp, { create: true });
    for (const p of paths) {
      const [, name] = split(p);
      const bytes = await this.readFile(p);
      const fh = await sub.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes.slice().buffer as ArrayBuffer);
      await w.close();
    }
    return `HoradricLootBox-Backups/${stamp}`;
  },
  async listVaults() {
    if (!vaultDir) {
      const first = [...folders.values()][0];
      if (!first) return [];
      vaultDir = (await first.getDirectoryHandle('HoradricLootBox-Vaults', { create: true })) as DirHandle;
      folders.set('vaults', vaultDir);
    }
    const out: SaveFileEntry[] = [];
    for await (const h of vaultDir.values()) {
      if (h.kind === 'file' && (h.name.endsWith('.hlb.json') || h.name.endsWith('.hvault.json'))) {
        const f = await (h as FileSystemFileHandle).getFile();
        out.push({ name: h.name, path: `vaults/${h.name}`, size: f.size, modified: f.lastModified });
      }
    }
    return out;
  },
  async readText(path) {
    return new TextDecoder().decode(await this.readFile(path));
  },
  async writeVault(_folder, name, text, existingPath) {
    await this.listVaults('');
    if (!vaultDir) throw new Error('Open a save folder first; vaults are stored next to it.');
    const file = existingPath ? existingPath.split('/').pop()! : `${name.replace(/[^\w\- ]+/g, '_')}.hlb.json`;
    await writeIn(vaultDir, file, text);
    return `vaults/${file}`;
  },
  async isGameRunning() {
    return false;
  },
  async deleteVault(path) {
    await this.listVaults('');
    if (!vaultDir) throw new Error('Vault folder not available');
    const name = path.split('/').pop()!;
    const kept = await this.backupFiles([path]);
    await vaultDir.removeEntry(name);
    return kept;
  },
  async deleteCharacter(path) {
    const [dir, name] = split(path);
    const stem = name.replace(/\.d2s$/i, '');
    const exts = ['d2s', 'key', 'ctl', 'map', 'ma0', 'ma1', 'ma2', 'ma3', 'ma4', 'd2x'];
    const doomed: string[] = [];
    for await (const h of dir.values()) {
      const m = h.kind === 'file' && h.name.match(/^(.*)\.([^.]+)$/);
      if (m && m[1] === stem && exts.includes(m[2].toLowerCase())) doomed.push(h.name);
    }
    const kept = await this.backupFiles(doomed.map((n) => `${path.slice(0, path.indexOf('/'))}/${n}`));
    for (const n of doomed) await dir.removeEntry(n);
    return kept;
  },
};

export const browserSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;
