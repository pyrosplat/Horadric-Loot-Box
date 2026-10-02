/**
 * Getting saves into the web page: dropped files or a dropped save folder, the file dialog, or the folder dialog.
 * Chrome and Edge hand out handles the page can write back to; other browsers give plain files (saving downloads).
 */

export type Picked = {
  name: string;
  data: Uint8Array;
  modified?: number;
  handle?: FileSystemFileHandle;
  /** The folder it came from, when a whole folder was dropped or picked: write access is asked for it once. */
  parent?: FileSystemDirectoryHandle;
};

const SAVE = /\.(d2s|d2i)$/i;
type Dir = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

const read = async (f: File, extra: Partial<Picked> = {}): Promise<Picked> => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()), modified: f.lastModified, ...extra });

/** One copy of each file name (the first found). */
const unique = (list: Picked[]) => list.filter((f, i) => list.findIndex((g) => g.name.toLowerCase() === f.name.toLowerCase()) === i);

/**
 * The saves in a folder. When it has none itself, the folders inside it are looked through (so dropping
 * "Saved Games" finds "Diablo II Resurrected"); that is as deep as it goes.
 */
export async function fromFolder(dir: FileSystemDirectoryHandle, deeper = true): Promise<Picked[]> {
  const out: Picked[] = [];
  const inside: Dir[] = [];
  for await (const h of (dir as Dir).values()) {
    if (h.kind === 'directory') inside.push(h as Dir);
    else if (SAVE.test(h.name)) out.push(await read(await (h as FileSystemFileHandle).getFile(), { handle: h as FileSystemFileHandle, parent: dir }));
  }
  if (!out.length && deeper) for (const d of inside) out.push(...(await fromFolder(d, false)));
  return unique(out);
}

// --- folders in browsers without handles (Firefox, Safari): read-only entries

interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, fail: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (list: Entry[]) => void, fail: (e: unknown) => void): void };
}

async function children(dir: Entry): Promise<Entry[]> {
  const reader = dir.createReader!();
  const all: Entry[] = [];
  // readEntries gives a batch at a time, and an empty one when done
  for (;;) {
    const batch = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

async function fromEntry(dir: Entry, deeper = true): Promise<Picked[]> {
  const list = await children(dir);
  const out: Picked[] = [];
  for (const e of list) if (e.isFile && SAVE.test(e.name)) out.push(await read(await new Promise<File>((ok, fail) => e.file!(ok, fail))));
  if (!out.length && deeper) for (const e of list) if (e.isDirectory) out.push(...(await fromEntry(e, false)));
  return unique(out);
}

/** Files and folders from a drop. */
export async function fromDrop(dt: DataTransfer): Promise<Picked[]> {
  // everything is asked for before the first await: the drop's items can't be read afterwards
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const files = items.map((i) => i.getAsFile());
  const entries = items.map((i) => (i as DataTransferItem & { webkitGetAsEntry?(): Entry | null }).webkitGetAsEntry?.() ?? null);
  const handles = await Promise.all(
    items.map((i) => (i as DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null)),
  );
  const out: Picked[] = [];
  for (let k = 0; k < items.length; k++) {
    const h = handles[k];
    try {
      if (h?.kind === 'directory') out.push(...(await fromFolder(h as FileSystemDirectoryHandle)));
      else if (h?.kind === 'file') out.push(await read(await (h as FileSystemFileHandle).getFile(), { handle: h as FileSystemFileHandle }));
      else if (entries[k]?.isDirectory) out.push(...(await fromEntry(entries[k]!)));
      else if (files[k]) out.push(await read(files[k]!));
    } catch {
      // a file or folder the browser won't read: the rest still load
    }
  }
  return unique(out);
}

/** The file dialog: Chrome and Edge's picker (writable), else a plain file input (answers through its onChange). */
export async function pickFiles(input: HTMLInputElement | null): Promise<Picked[] | null> {
  const picker = (window as unknown as { showOpenFilePicker?: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
  if (picker) {
    try {
      const hs = await picker({ id: 'd2r-saves', multiple: true, types: [{ description: 'Diablo II: Resurrected saves', accept: { 'application/octet-stream': ['.d2i', '.d2s'] } }] });
      return Promise.all(hs.map(async (h) => read(await h.getFile(), { handle: h })));
    } catch {
      return null; // cancelled
    }
  }
  input?.click();
  return null;
}

/** Whether the browser has a folder dialog that gives writable files (Chrome, Edge). */
export const hasFolderPicker = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** The folder dialog: Chrome and Edge's picker (writable), else a folder input (answers through its onChange). */
export async function pickFolder(input: HTMLInputElement | null): Promise<Picked[] | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (picker) {
    try {
      return await fromFolder(await picker({ id: 'd2r-saves', mode: 'readwrite' }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null; // cancelled
      throw e;
    }
  }
  input?.click();
  return null;
}

/** Files from a file or folder input (a folder input lists everything inside, so only the folder's own saves are kept when it has any). */
export async function fromInput(list: FileList | null): Promise<Picked[]> {
  const files = [...(list ?? [])].filter((f) => SAVE.test(f.name));
  const depth = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '').split('/').length;
  const top = Math.min(...files.map(depth));
  return unique(await Promise.all(files.filter((f) => depth(f) === top).map((f) => read(f))));
}
