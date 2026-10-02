import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { parseStash, serializeVerified, setStashGold, stashGold, stashGoldCap, STASH_GOLD_CAP, StashTabType } from '../src/core';
import { Store } from '../src/state/store';
import type { Platform } from '../src/platform';

const load = () => parseStash(new Uint8Array(fs.readFileSync('tests/fixtures/ModernSharedStashSoftCoreV2.d2i')), 'ModernSharedStashSoftCoreV2.d2i');
const pageGold = (s: ReturnType<typeof load>) => s.tabs.filter((t) => t.type === StashTabType.Normal).map((t) => t.gold);

describe('RotW shared stash gold is one pool over the pages', () => {
  test('fills pages in order, 2,500,000 each, and saves', () => {
    const s = load();
    const pages = pageGold(s).length;
    expect(stashGoldCap(s)).toBe(pages * STASH_GOLD_CAP);
    setStashGold(s, 6_000_000);
    expect(pageGold(s).slice(0, 4)).toEqual([2_500_000, 2_500_000, 1_000_000, 0]);
    const back = parseStash(serializeVerified(s), 'ModernSharedStashSoftCoreV2.d2i');
    expect(stashGold(back)).toBe(6_000_000);
    setStashGold(s, 2_499_999);
    expect(pageGold(s).slice(0, 3)).toEqual([2_499_999, 0, 0]);
    expect(() => setStashGold(s, stashGoldCap(s) + 1)).toThrow();
  });

  test('the store shows and moves it as one amount on every page', async () => {
    const st = load();
    setStashGold(st, 3_000_000);
    const files = new Map([['t/ModernSharedStashSoftCoreV2.d2i', serializeVerified(st)], ['t/Warlock_v105.d2s', new Uint8Array(fs.readFileSync('tests/fixtures/Warlock_v105.d2s'))]]);
    const platform = {
      id: 'demo', label: 't', canWrite: true, detectSaveFolders: async () => [], pickFolder: async () => 't/',
      listSaves: async () => [...files].map(([path, d]) => ({ name: path.slice(2), path, size: d.length })),
      readFile: async (p: string) => files.get(p)!.slice(), writeFileAtomic: async () => {}, backupFiles: async () => '',
      listVaults: async () => [], readText: async () => '', writeVault: async () => '', isGameRunning: async () => false,
    } as unknown as Platform;
    const store = new Store(platform);
    store.toast = () => {};
    await store.openFolder('t/');
    const id = 't/ModernSharedStashSoftCoreV2.d2i';
    const page1 = store.sharedGoldRef(id, 0)!, page3 = store.sharedGoldRef(id, 2)!;
    expect(page1).toEqual(page3); // every page is the same pool
    expect([store.goldOf(page1), store.goldCap(page1)]).toEqual([3_000_000, stashGoldCap(st)]);
    // into the vault and back
    const vault = [...store.docs.values()].find((d) => d.doc?.kind === 'vault')!.id;
    const pot = store.goldPotOf(id)!;
    expect(store.goldTargets(page1).filter((t) => t.docId === id)).toEqual([]); // not itself, page by page
    expect(store.transferGold(page1, { docId: vault, kind: 'vault', pot }, 2_800_000)).toBe(2_800_000);
    expect(store.goldOf(page1)).toBe(200_000);
    expect(store.transferGold({ docId: vault, kind: 'vault', pot }, page1, 2_800_000)).toBe(2_800_000);
    const s = store.docs.get(id)!.doc as ReturnType<typeof load>;
    expect(pageGold(s).slice(0, 3)).toEqual([2_500_000, 500_000, 0]);
  });
});
