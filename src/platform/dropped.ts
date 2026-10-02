import { createBrowserArt } from '../art/browser';
import type { Platform, SaveFileEntry } from './types';

/**
 * Saves dropped onto the web page (or picked with the file dialog). Nothing leaves the browser.
 *
 * Saving: in Chrome and Edge a dropped or picked file comes with a handle the page can write back to, after the
 * browser asks once (for a whole save folder, once for the folder). Other browsers can't, so the edited file is downloaded under its own name, for the player to
 * put back in their save folder. Before the first save of each file, a copy of the original is downloaded too.
 */

interface Asks {
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
type Handle = FileSystemFileHandle & Asks & { createWritable?(): Promise<{ write(d: ArrayBuffer): Promise<void>; close(): Promise<void> }> };
type Folder = FileSystemDirectoryHandle & Asks;

interface Dropped {
  name: string;
  data: Uint8Array;
  original: Uint8Array;
  modified?: number;
  handle?: Handle;
  /** The folder it was loaded from (a whole save folder): write access is asked for the folder, once. */
  parent?: Folder;
  /** Writing back in place was refused; downloads are used for this file. */
  denied?: boolean;
}

export const DROP_FOLDER = 'dropped/';

/** Offers bytes as a file download. */
export function download(name: string, data: Uint8Array) {
  const url = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupName = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}.backup-${stamp()}${name.slice(dot)}` : `${name}.backup-${stamp()}`;
};

export interface DroppedPlatform extends Platform {
  /** Adds files; one with the same name replaces the earlier copy. Returns their paths. */
  add(files: { name: string; data: Uint8Array; modified?: number; handle?: FileSystemFileHandle; parent?: FileSystemDirectoryHandle }[]): string[];
  /** True when every one of these files can be written back in place (no download needed). */
  writesInPlace(paths: string[]): boolean;
  /** Asks the browser for write access to these files. Call it straight from a click or key press. */
  askToWrite(paths: string[]): Promise<void>;
}

export function createDroppedPlatform(): DroppedPlatform {
  const files = new Map<string, Dropped>();
  const pathOf = (name: string) => `${DROP_FOLDER}${name}`;
  const get = (path: string) => {
    const f = files.get(path);
    if (!f) throw new Error(`${path.slice(DROP_FOLDER.length)} is no longer loaded; drop it again.`);
    return f;
  };

  return {
    id: 'browser',
    label: 'Web',
    canWrite: true,
    // optional item art from game files the player unpacked and picks themselves
    art: typeof document !== 'undefined' ? createBrowserArt() : undefined,

    add(list) {
      return list.map((f) => {
        const path = pathOf(f.name);
        files.set(path, { name: f.name, data: f.data.slice(), original: f.data.slice(), modified: f.modified, handle: f.handle as Handle | undefined, parent: f.parent as Folder | undefined });
        return path;
      });
    },

    writesInPlace(paths) {
      return paths.every((p) => {
        const f = files.get(p);
        return !!f?.handle?.createWritable && !f.denied;
      });
    },

    async askToWrite(paths) {
      // a folder is asked for once; its answer covers the files in it
      const asked = new Set<Folder>();
      for (const p of paths) {
        const f = files.get(p);
        if (!f?.handle?.createWritable || f.denied) continue;
        try {
          let state = (await f.handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
          if (state !== 'granted' && f.parent && !asked.has(f.parent)) {
            asked.add(f.parent);
            await f.parent.requestPermission?.({ mode: 'readwrite' }).catch(() => undefined);
            state = (await f.handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
          }
          if (state !== 'granted') state = (await f.handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
          if (state !== 'granted') f.denied = true;
        } catch {
          f.denied = true;
        }
      }
    },

    async detectSaveFolders() {
      return [];
    },
    async pickFolder() {
      return DROP_FOLDER;
    },
    async listSaves() {
      return [...files.entries()]
        .map(([path, f]): SaveFileEntry => ({ name: f.name, path, size: f.data.length, modified: f.modified }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async readFile(path) {
      return get(path).data.slice();
    },
    async writeFileAtomic(path, data) {
      const f = get(path);
      if (f.handle?.createWritable && !f.denied) {
        const w = await f.handle.createWritable();
        await w.write(data.slice().buffer as ArrayBuffer);
        await w.close();
      } else download(f.name, data);
      f.data = data.slice();
    },
    async backupFiles(paths) {
      for (const p of paths) {
        const f = get(p);
        download(backupName(f.name), f.original);
      }
      return 'Downloads';
    },
    // vaults belong to the desktop app
    async listVaults() {
      return [];
    },
    async readText() {
      throw new Error('Vaults need the desktop app.');
    },
    async writeVault() {
      throw new Error('Vaults need the desktop app.');
    },
    // a web page can't see running programs; the page warns instead
    async isGameRunning() {
      return false;
    },
  };
}
