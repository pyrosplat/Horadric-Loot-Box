import { afterEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import { parseStash, StashTabType, type D2SharedStash } from '../src/core';
import { createDroppedPlatform } from '../src/platform/dropped';
import { TRADE_ID } from '../src/state/store';
import { loadTradeLog, tradeLineText } from '../src/state/tradeLog';
import { fromFolder } from '../src/web/files';
import { WebStore } from '../src/web/WebStore';

const read = (n: string) => new Uint8Array(fs.readFileSync(`tests/fixtures/${n}`));
const STASH = 'dropped/ModernSharedStashSoftCoreV2.d2i';

/** A file handle like Chrome's, writing into `out`. */
function handle(out: { data?: Uint8Array }, permission: PermissionState = 'granted') {
  return {
    kind: 'file',
    queryPermission: async () => 'prompt',
    requestPermission: async () => permission,
    createWritable: async () => ({ write: async (d: ArrayBuffer) => void (out.data = new Uint8Array(d)), close: async () => {} }),
  } as unknown as FileSystemFileHandle;
}

async function store(files: { name: string; handle?: FileSystemFileHandle }[]) {
  const s = new WebStore(createDroppedPlatform());
  const messages: string[] = [];
  s.toast = (_k, t) => void messages.push(t);
  await s.addFiles(files.map((f) => ({ name: f.name, data: read(f.name), handle: f.handle })));
  return { s, messages };
}

const count = (s: WebStore, code: string) => {
  const st = s.docs.get(STASH)!.doc as D2SharedStash;
  const tab = st.tabs.find((t) => t.type === StashTabType.Advanced)!;
  return tab.items.filter((i) => i.code === code).reduce((n, i) => n + (i.advancedStackSize ?? 1), 0);
};

describe('web trade page', () => {
  test('keeps Reign of the Warlock saves only, and opens the stash on Stackables with Trade beside it', async () => {
    const { s, messages } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i' }, { name: 'Warlock_v105.d2s' }, { name: 'SharedStashSoftCoreV2.d2i' }, { name: 'Soska.d2s' }]);
    expect(s.saves.map((e) => e.name)).toEqual(['ModernSharedStashSoftCoreV2.d2i', 'Warlock_v105.d2s']);
    expect(messages.join(' ')).toMatch(/SharedStashSoftCoreV2\.d2i isn't a Reign of the Warlock save; Soska\.d2s isn't/);
    const st = s.docs.get(STASH)!.doc as D2SharedStash;
    expect(s.panes).toEqual([{ docId: STASH, tab: st.tabs.findIndex((t) => t.type === StashTabType.Advanced) }, { docId: TRADE_ID, tab: 0 }]);
    expect(s.settings.tradeEnabled).toBe(true);
    expect(s.tradeProblem()).toBeUndefined();
  });

  test('a trade written back in place through the file handle, with the original downloaded first', async () => {
    const out: { data?: Uint8Array } = {};
    const { s } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i', handle: handle(out) }]);
    const backups: string[] = [];
    s.platform.backupFiles = async (paths) => (backups.push(...paths), 'Downloads');
    const um = count(s, 'r22'), ist = count(s, 'r24');
    s.tradeSetListing({ name: 'Ist Rune', mode: 'softcore', ask: [[{ code: 'r22', qty: 3, name: 'Um Rune' }]], want: [['r24', 1]] });
    s.tradeOffer('r22', 3);
    expect(s.tradeAccept()).toBe(true);
    s.tradeDeliverAll();
    expect(s.savesInPlace).toBe(true);
    expect(s.saveLabel()).toBe('Save file');
    await s.saveAll();
    expect(backups).toEqual([STASH]);
    const saved = parseStash(out.data!, 'x.d2i').tabs.find((t) => t.type === StashTabType.Advanced)!;
    expect(saved.items.find((i) => i.code === 'r24')?.advancedStackSize).toBe(ist + 1);
    expect(saved.items.find((i) => i.code === 'r22')?.advancedStackSize).toBe(um - 3);
    expect(s.dirtyDocs.length).toBe(0);
  });

  test('without write permission (or another browser) the file is downloaded instead', async () => {
    const out: { data?: Uint8Array } = {};
    const { s } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i', handle: handle(out, 'denied') }]);
    await s.platform.askToWrite([STASH]);
    expect(s.platform.writesInPlace([STASH])).toBe(false);
    const plain = (await store([{ name: 'ModernSharedStashSoftCoreV2.d2i' }])).s;
    s.tradeOffer('r22', 1);
    s.tradeClear();
    expect(s.saveLabel()).toBe('Download file');
    expect(plain.platform.writesInPlace([STASH])).toBe(false);
  });

  test("new files and switching wait until a trade is finished; the listing doesn't carry over", async () => {
    const { s, messages } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i' }, { name: 'Warlock_v105.d2s' }]);
    s.tradeSetListing({ name: 'Ist Rune', mode: 'softcore', ask: [[{ code: 'r22', qty: 3, name: 'Um Rune' }]], want: [['r24', 1]] });
    s.tradeOffer('r22', 1);
    s.use('dropped/Warlock_v105.d2s');
    expect(s.currentId).toBe(STASH);
    await s.addFiles([{ name: 'Roka.d2s', data: read('Roka.d2s') }]);
    expect(messages.at(-1)).toMatch(/Save or discard your changes first/);
    s.tradeClear();
    s.use('dropped/Warlock_v105.d2s');
    expect([s.currentId, s.panes[1].docId, s.trade.listing]).toEqual(['dropped/Warlock_v105.d2s', TRADE_ID, undefined]);
    // unsaved changes block new files too
    s.tradeOffer('r22', 0);
    s.docs.get(STASH)!.dirty = true;
    await s.addFiles([{ name: 'Roka.d2s', data: read('Roka.d2s') }]);
    expect(messages.at(-1)).toMatch(/Save or discard your changes first/);
    expect(await s.addFiles([{ name: 'notes.txt', data: new Uint8Array([1]) }])).toBeUndefined();
    expect(messages.at(-1)).toMatch(/Drop a \.d2i/);
  });

  test('undoing every change puts the file back to Saved; after a save, undo makes it unsaved again', async () => {
    const out: { data?: Uint8Array } = {};
    const { s } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i', handle: handle(out) }]);
    s.platform.backupFiles = async () => 'Downloads';
    s.tradeOffer('r22', 1);
    s.tradeOffer('r22', 1);
    expect(s.dirtyDocs.length).toBe(1);
    s.undo();
    s.undo();
    expect([s.dirtyDocs.length, s.tradeOffered.length]).toEqual([0, 0]);
    // change, save, then undo: the file on disk has the change, so the undone state is unsaved
    s.tradeOffer('r22', 1);
    s.tradeClear();
    await s.saveAll();
    expect(s.dirtyDocs.length).toBe(0);
    s.undo();
    expect(s.dirtyDocs.length).toBe(1);
  });

  test('Discard changes puts every file back to how it was last saved and clears the trade', async () => {
    const { s } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i' }, { name: 'Warlock_v105.d2s' }]);
    const um = count(s, 'r22');
    s.use('dropped/Warlock_v105.d2s');
    s.use(STASH);
    s.tradeSetListing({ name: 'Ist Rune', mode: 'softcore', ask: [[{ code: 'r22', qty: 3, name: 'Um Rune' }]], want: [['r24', 1]] });
    s.tradeOffer('r22', 3);
    expect(s.tradeAccept()).toBe(true);
    expect([s.hasChanges, count(s, 'r22')]).toEqual([true, um - 3]);
    await s.discard();
    expect([s.hasChanges, s.tradeReceived.length, s.trade.listing, count(s, 'r22'), s.currentId]).toEqual([false, 0, undefined, um, STASH]);
    expect(s.history.length).toBe(0);
    // and new files load again
    await s.addFiles([{ name: 'Roka.d2s', data: read('Roka.d2s') }]);
    expect(s.saves.length).toBe(2);
  });
  describe('a whole save folder', () => {
    /** A folder handle like Chrome's: files by name, folders inside, and one write prompt for the lot. */
    interface Fake {
      dir: FileSystemDirectoryHandle;
      state: { granted: boolean; asked: number };
      out: Record<string, Uint8Array>;
    }
    function folder(name: string, files: string[], inside: Fake[] = [], out: Record<string, Uint8Array> = {}): Fake {
      const state = { granted: false, asked: 0 };
      const file = (n: string) => ({
        kind: 'file',
        name: n,
        getFile: async () => ({ name: n, lastModified: 1, arrayBuffer: async () => (fs.existsSync(`tests/fixtures/${n}`) ? read(n) : new Uint8Array([1, 2, 3])).buffer }),
        queryPermission: async () => (state.granted ? 'granted' : 'prompt'),
        requestPermission: async () => 'denied',
        createWritable: async () => ({ write: async (d: ArrayBuffer) => void (out[n] = new Uint8Array(d)), close: async () => {} }),
      });
      const dir = {
        kind: 'directory',
        name,
        async *values() {
          yield* inside.map((d) => d.dir);
          yield* files.map(file);
        },
        requestPermission: async () => (state.asked++, (state.granted = true), 'granted'),
      };
      return { dir: dir as unknown as FileSystemDirectoryHandle, state, out };
    }
    const SAVES = ['ModernSharedStashSoftCoreV2.d2i', 'Warlock_v105.d2s', 'SharedStashSoftCoreV2.d2i', 'Soska.d2s', 'Roka.d2s', 'Settings.json', 'Warlock_v105.ctl'];

    test('every save in it is read; a folder with none is looked through one level down', async () => {
      const saves = folder('Diablo II Resurrected', SAVES, [folder('mods', ['Roka.d2s'])]);
      expect((await fromFolder(saves.dir)).map((f) => f.name).sort()).toEqual(SAVES.filter((n) => /\.d2[si]$/.test(n)).sort());
      expect((await fromFolder(folder('Saved Games', ['desktop.ini'], [saves]).dir)).length).toBe(5);
      expect(await fromFolder(folder('Deep', [], [folder('Saved Games', [], [saves])]).dir)).toEqual([]);
    });

    test('the Reign of the Warlock saves load together, and saving asks for the folder once', async () => {
      const f = folder('Diablo II Resurrected', SAVES);
      const s = new WebStore(createDroppedPlatform());
      const messages: string[] = [];
      s.toast = (_k, t) => void messages.push(t);
      s.platform.backupFiles = async () => 'Downloads';
      await s.addFiles(await fromFolder(f.dir));
      expect(s.saves.map((e) => e.name)).toEqual(['ModernSharedStashSoftCoreV2.d2i', 'Warlock_v105.d2s']);
      expect(s.currentId).toBe(STASH);
      expect(messages.join(' ')).toMatch(/SharedStashSoftCoreV2\.d2i isn't a Reign of the Warlock save/);
      s.tradeSetListing({ name: 'Ist Rune', mode: 'softcore', ask: [[{ code: 'r22', qty: 3, name: 'Um Rune' }]], want: [['r24', 1]] });
      s.tradeOffer('r22', 3);
      expect(s.tradeAccept()).toBe(true);
      s.tradeDeliverAll();
      await s.saveAll();
      expect([f.state.asked, Object.keys(f.out), s.dirtyDocs.length]).toEqual([1, ['ModernSharedStashSoftCoreV2.d2i'], 0]);
    });
  });

  describe('trade history', () => {
    afterEach(() => vi.unstubAllGlobals());
    const storage = () => {
      const kept = new Map<string, string>();
      vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) });
    };
    const trade = (s: WebStore) => {
      s.tradeSetListing({ name: 'Ist Rune', mode: 'softcore', ask: [[{ code: 'r22', qty: 3, name: 'Um Rune' }]], want: [['r24', 1]] });
      s.tradeOffer('r22', 3);
      expect(s.tradeAccept()).toBe(true);
    };

    test('a trade is listed at once and kept when the files are saved', async () => {
      storage();
      const { s } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i', handle: handle({}) }]);
      s.platform.backupFiles = async () => 'Downloads';
      trade(s);
      expect(s.tradeLog.map((e) => [e.side, tradeLineText(e.got), tradeLineText(e.paid), e.mode, e.file, e.saved])).toEqual([['buy', 'Ist Rune', '3× Um Rune', 'softcore', 'RotW Shared Stash', false]]);
      expect(loadTradeLog()).toEqual([]); // nothing is stored until the save
      s.tradeDeliverAll();
      await s.saveAll();
      expect(s.tradeLog[0].saved).toBe(true);
      expect(loadTradeLog().length).toBe(1);
      // a new session starts with the stored history
      expect((await store([{ name: 'ModernSharedStashSoftCoreV2.d2i' }])).s.tradeLog.length).toBe(1);
      s.tradeLogRemove(s.tradeLog[0].id);
      expect([s.tradeLog.length, loadTradeLog().length]).toEqual([0, 0]);
    });

    test("undoing or discarding a trade takes it out; it never reaches the stored history", async () => {
      storage();
      const { s } = await store([{ name: 'ModernSharedStashSoftCoreV2.d2i' }]);
      trade(s);
      s.undo();
      expect(s.tradeLog).toEqual([]);
      s.tradeClear();
      trade(s);
      expect(s.tradeLog.length).toBe(1);
      await s.discard();
      expect([s.tradeLog.length, loadTradeLog().length]).toEqual([0, 0]);
    });
  });
});

describe('sample saves', () => {
  test('every sample is there, is a Reign of the Warlock save, and saves back byte for byte', async () => {
    const { DEMO_FILES } = await import('../src/platform/demo');
    const { parseCharacter, serializeVerified } = await import('../src/core');
    const s = new WebStore(createDroppedPlatform());
    s.toast = () => {};
    await s.addFiles(DEMO_FILES.map((name) => ({ name, data: new Uint8Array(fs.readFileSync(`public/demo/${name}`)) })));
    expect(s.saves.length).toBe(DEMO_FILES.length);
    expect(s.currentId).toBe(STASH);
    // each character is named for its class, and its file for the character (the game needs those to match)
    expect(s.saves.filter((e) => e.doc?.kind === 'character').map((e) => `${e.name}:${(e.doc as { name: string }).name}`).sort()).toEqual(['Amazon.d2s:Amazon', 'Druid.d2s:Druid', 'Sorceress.d2s:Sorceress', 'Warlock.d2s:Warlock']);
    for (const name of DEMO_FILES) {
      const bytes = new Uint8Array(fs.readFileSync(`public/demo/${name}`));
      const doc = name.endsWith('.d2i') ? parseStash(bytes, name) : parseCharacter(bytes, name);
      expect(Buffer.compare(Buffer.from(serializeVerified(doc)), Buffer.from(bytes)), name).toBe(0);
    }
  });
});
