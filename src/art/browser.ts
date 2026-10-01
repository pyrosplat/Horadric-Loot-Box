import type { ArtBackend, ArtInfo } from './index';
import { decodeSprite, spriteKey } from './sprite';

/**
 * Item art for the web page, read from game files the player unpacked (CascView) and picked themselves. Nothing is
 * uploaded or hosted: sprites are decoded in the page into images that only live in this tab.
 *
 * Chrome and Edge pick the folder with a handle that is remembered (IndexedDB) and reopened next visit, after the
 * browser asks again. Other browsers pick it with a folder input, so they ask every visit.
 */

const ITEMS = 'hd/global/ui/items/';
const JSONS = { items_json: 'hd/items/items.json', uniques_json: 'hd/items/uniques.json', sets_json: 'hd/items/sets.json' } as const;

type Dir = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
};

/** A picked folder: files by path relative to the game's `data` folder (lower case). */
interface Source {
  name: string;
  file(rel: string): Promise<File | undefined>;
  /** Every item sprite: its path under `hd/global/ui/items/` (lower case) and how to read it. */
  sprites(): Promise<{ rel: string; file: () => Promise<File> }[]>;
}

// ---------------------------------------------------------------------------------- remembering the folder (Chrome)

const DB = 'hlb-art';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const req = run(d.transaction('handles', mode).objectStore('handles'));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}
const saveHandle = (h: Dir) => idb('readwrite', (s) => s.put(h, 'art'));
const loadHandle = () => idb<Dir>('readonly', (s) => s.get('art'));
const forgetHandle = () => idb('readwrite', (s) => s.delete('art'));

// ---------------------------------------------------------------------------------- sources

/** A child folder, matching names without regard to case. */
async function child(d: Dir, name: string): Promise<FileSystemHandle | undefined> {
  for await (const h of d.values()) if (h.name.toLowerCase() === name.toLowerCase()) return h;
  return undefined;
}

/** Follows a path of folders (any case). */
async function sub(d: Dir, path: string): Promise<Dir | undefined> {
  let cur: Dir | undefined = d;
  for (const part of path.split('/').filter(Boolean)) {
    const h: FileSystemHandle | undefined = cur && (await child(cur, part));
    if (!h || h.kind !== 'directory') return undefined;
    cur = h as Dir;
  }
  return cur;
}

/** Where the game's `data` folder is inside what the player picked (they may pick it, its parent, or `hd`). */
async function dataRoot(dir: Dir): Promise<{ root: Dir; prefix: string } | undefined> {
  for (const c of ['', 'data', 'data/data']) {
    const d = await sub(dir, c);
    if (d && ((await sub(d, ITEMS)) || (await sub(d, 'hd/items')))) return { root: d, prefix: '' };
  }
  // they picked the hd folder itself
  if (await sub(dir, 'global/ui/items')) return { root: dir, prefix: 'hd/' };
  return undefined;
}

async function handleSource(dir: Dir): Promise<Source> {
  const found = await dataRoot(dir);
  if (!found) throw new Error(`No game files found in ${dir.name}. Choose the folder you unpacked the game's data into (it has an hd folder inside).`);
  const { root, prefix } = found;
  const strip = (rel: string) => (prefix && rel.startsWith(prefix) ? rel.slice(prefix.length) : rel);
  const walk = async (d: Dir, path: string, out: { rel: string; file: () => Promise<File> }[]) => {
    for await (const h of d.values()) {
      if (h.kind === 'directory') await walk(h as Dir, `${path}${h.name.toLowerCase()}/`, out);
      else if (h.name.toLowerCase().endsWith('.sprite')) out.push({ rel: `${path}${h.name.toLowerCase()}`, file: () => (h as FileSystemFileHandle).getFile() });
    }
  };
  return {
    name: dir.name,
    async file(rel) {
      const parts = strip(rel).split('/');
      const folder = await sub(root, parts.slice(0, -1).join('/'));
      const h = folder && (await child(folder, parts[parts.length - 1]));
      return h && h.kind === 'file' ? (h as FileSystemFileHandle).getFile() : undefined;
    },
    async sprites() {
      const out: { rel: string; file: () => Promise<File> }[] = [];
      const items = await sub(root, strip(ITEMS));
      if (items) await walk(items, '', out);
      return out;
    },
  };
}

/** Files from `<input webkitdirectory>`: paths are relative to the picked folder. */
function listSource(files: File[]): Source {
  const byRel = new Map<string, File>();
  for (const f of files) {
    const p = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/');
    const lower = p.toLowerCase();
    // everything from the `hd/` folder on, wherever it sits in what was picked
    const at = lower.indexOf('hd/');
    const rel = at === 0 || lower[at - 1] === '/' ? p.slice(at) : undefined;
    if (rel) byRel.set(rel.toLowerCase(), f);
  }
  const first = (files[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split('/')[0] ?? 'folder';
  if (![...byRel.keys()].some((k) => k.startsWith(ITEMS))) throw new Error(`No game files found in ${first}. Choose the folder you unpacked the game's data into (it has an hd folder inside).`);
  return {
    name: first,
    file: async (rel) => byRel.get(rel.toLowerCase()),
    sprites: async () =>
      [...byRel]
        .filter(([k]) => k.startsWith(ITEMS) && k.endsWith('.sprite'))
        .map(([k, f]) => ({ rel: k.slice(ITEMS.length), file: async () => f })),
  };
}

/** Lets the player pick a folder with a plain input (browsers without the folder picker). */
function pickWithInput(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => resolve(input.files ? [...input.files] : null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** RGBA to an image URL that lives as long as the page. */
async function toUrl(width: number, height: number, rgba: Uint8ClampedArray<ArrayBuffer>): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('could not make an image');
  return URL.createObjectURL(blob);
}

const hasPicker = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export function createBrowserArt(): ArtBackend {
  let source: Source | undefined;
  const urls = new Map<string, string>();

  const clear = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
  };

  return {
    async detectInstalls() {
      return [];
    },

    async pickFolder() {
      if (hasPicker()) {
        try {
          const dir = (await (window as unknown as { showDirectoryPicker(o: object): Promise<Dir> }).showDirectoryPicker({ id: 'd2r-art', mode: 'read' })) as Dir;
          source = await handleSource(dir);
          await saveHandle(dir);
          return source.name;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return null;
          throw e;
        }
      }
      const files = await pickWithInput();
      if (!files?.length) return null;
      source = listSource(files);
      return source.name;
    },

    /** Reads every item sprite of the picked folder (or the remembered one, asking the browser again if needed). */
    async open(name) {
      if (!source || source.name !== name) {
        const dir = hasPicker() ? await loadHandle() : undefined;
        if (!dir || dir.name !== name) throw new Error(`Choose the ${name} folder again to show item art.`);
        let perm = (await dir.queryPermission?.({ mode: 'read' })) ?? 'granted';
        if (perm !== 'granted') perm = (await dir.requestPermission?.({ mode: 'read' }).catch(() => 'prompt' as PermissionState)) ?? 'denied';
        if (perm !== 'granted') throw new Error(`Click "Choose game files folder…" and pick ${name} again to show item art.`);
        source = await handleSource(dir);
      }
      clear();
      // the HD sprite wins over the low-end one, as in the game
      const files = new Map<string, { hd?: () => Promise<File>; low?: () => Promise<File> }>();
      for (const sp of await source.sprites()) {
        const k = spriteKey(sp.rel);
        if (!k) continue;
        const e = files.get(k.key) ?? {};
        e[k.low ? 'low' : 'hd'] = sp.file;
        files.set(k.key, e);
      }
      for (const [key, f] of files) {
        for (const get of [f.hd, f.low]) {
          if (!get) continue;
          try {
            const px = decodeSprite(new Uint8Array(await (await get()).arrayBuffer()));
            urls.set(key, await toUrl(px.width, px.height, px.rgba));
            break;
          } catch {
            // unreadable sprite: try the low-end one, else this item stays a tile
          }
        }
      }
      if (!urls.size) throw new Error(`No item pictures could be read from ${source.name}.`);
      const text = async (rel: string) => {
        const f = await source!.file(rel);
        return f ? (await f.text()).replace(/^﻿/, '') : null;
      };
      const info: ArtInfo = { kind: 'folder', path: source.name, sprites: [...urls.keys()], items_json: null, uniques_json: null, sets_json: null };
      for (const [k, rel] of Object.entries(JSONS)) info[k as keyof typeof JSONS] = await text(rel);
      return info;
    },

    async close() {
      clear();
      source = undefined;
      await forgetHandle();
    },

    async probe() {
      return [];
    },

    url(key) {
      return urls.get(key) ?? '';
    },
  };
}
