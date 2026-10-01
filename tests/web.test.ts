import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { parseStash, StashTabType, type D2SharedStash } from '../src/core';
import { createDroppedPlatform } from '../src/platform/dropped';
import { TRADE_ID } from '../src/state/store';
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
    expect(messages.at(-1)).toMatch(/offer back/);
    s.tradeClear();
    s.use('dropped/Warlock_v105.d2s');
    expect([s.currentId, s.panes[1].docId, s.trade.listing]).toEqual(['dropped/Warlock_v105.d2s', TRADE_ID, undefined]);
    // unsaved changes block new files too
    s.tradeOffer('r22', 0);
    s.docs.get(STASH)!.dirty = true;
    await s.addFiles([{ name: 'Roka.d2s', data: read('Roka.d2s') }]);
    expect(messages.at(-1)).toMatch(/Save your changes first/);
    expect(await s.addFiles([{ name: 'notes.txt', data: new Uint8Array([1]) }])).toBeUndefined();
    expect(messages.at(-1)).toMatch(/Drop a \.d2i/);
  });
});
