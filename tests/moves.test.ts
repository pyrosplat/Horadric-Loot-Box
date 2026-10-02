import { beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { GD, ItemMode, Quality, canEquip, collectHeld, parseCharacter, parseStash, serializeVerified, type CollectionKind, type D2Character, type D2Item, type D2SharedStash } from '../src/core';
import type { Platform } from '../src/platform';
import { Store } from '../src/state/store';

/** Copies per collection slot for a plain list of items. */
const collect = (kind: CollectionKind, items: D2Item[], splitEthereal = false) =>
  new Map([...collectHeld(kind, items.map((item) => ({ item, docId: 'x', where: 'x', inVault: true })), splitEthereal)].map(([k, v]) => [k, v.map((h) => h.item)]));

const FILES = ['ChaosSC.d2s', 'Warlock_v105.d2s', 'barbexp_v105.d2s', 'Soska.d2s', 'ModernSharedStashSoftCoreV2.d2i', 'SharedStashSoftCoreV2.d2i'];

function fakePlatform(): Platform {
  const files = new Map(FILES.map((f) => [`t/${f}`, new Uint8Array(fs.readFileSync(`tests/fixtures/${f}`))]));
  const vaults = new Map<string, string>();
  return {
    id: 'demo',
    label: 'test',
    canWrite: true,
    detectSaveFolders: async () => ['t/'],
    pickFolder: async () => 't/',
    listSaves: async () => [...files.entries()].map(([path, d]) => ({ name: path.slice(2), path, size: d.length })),
    readFile: async (p) => files.get(p)!.slice(),
    writeFileAtomic: async (p, d) => void files.set(p, d.slice()),
    backupFiles: async () => 'none',
    listVaults: async () => [],
    readText: async (p) => vaults.get(p)!,
    writeVault: async (_f, n, t, e) => {
      const p = e ?? `v/${n}`;
      vaults.set(p, t);
      return p;
    },
    isGameRunning: async () => false,
    deleteCharacter: async (p) => {
      files.delete(p);
      return 'backups/test';
    },
  };
}

let store: Store;
const doc = <T,>(name: string) => store.docs.get(`t/${name}`)!.doc as T;
const chaos = () => doc<D2Character>('ChaosSC.d2s');
const modern = () => doc<D2SharedStash>('ModernSharedStashSoftCoreV2.d2i');
const vaultId = () => [...store.docs.values()].find((d) => d.doc?.kind === 'vault')!.id;
const worn = (ch: D2Character, loc: number) => ch.items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === loc);
/** Writes the document and reads it back, the way Save does. */
const roundTrip = (d: D2Character | D2SharedStash) => {
  const bytes = serializeVerified(d);
  return d.kind === 'character' ? parseCharacter(bytes, d.fileName) : parseStash(bytes, d.fileName);
};

beforeEach(async () => {
  try {
    localStorage.clear();
  } catch {
    /* node */
  }
  store = new Store(fakePlatform());
  store.toast = () => {};
  await store.openFolder('t/');
});

describe('equipment', () => {
  test('unequip to a vault and equip back, surviving a save', () => {
    const helm = worn(chaos(), 1)!;
    expect(store.move(helm, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' })).toBe(true);
    expect(worn(chaos(), 1)).toBeUndefined();
    const inVault = (store.docs.get(vaultId())!.doc as { entries: { item: D2Item }[] }).entries.at(-1)!.item;
    expect(store.move(inVault, vaultId(), { docId: 't/ChaosSC.d2s', area: 'equip', bodyLoc: 1 })).toBe(true);
    const again = roundTrip(chaos()) as D2Character;
    const back = worn(again, 1)!;
    expect(back.code).toBe(helm.code);
    expect([back.x, back.y, back.page]).toEqual([1, 0, -1]);
  });

  test('slot rules: wrong slot, taken slot, rings in either ring slot', () => {
    const ch = chaos();
    const ring = worn(ch, 6)!;
    expect(store.check(ring, 't/ChaosSC.d2s', { docId: 't/ChaosSC.d2s', area: 'equip', bodyLoc: 1 }).ok).toBe(false);
    expect(store.check(ring, 't/ChaosSC.d2s', { docId: 't/ChaosSC.d2s', area: 'equip', bodyLoc: 7 }).reason).toMatch(/taken/);
    expect(store.move(worn(ch, 7)!, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' })).toBe(true);
    expect(store.move(ring, 't/ChaosSC.d2s', { docId: 't/ChaosSC.d2s', area: 'equip', bodyLoc: 7 })).toBe(true);
    expect(worn(chaos(), 7)?.code).toBe('rin');
    expect(worn(chaos(), 6)).toBeUndefined();
    roundTrip(chaos());
  });

  const fake = (code: string, extra: Partial<D2Item> = {}) =>
    ({ code, def: GD.items[code], quality: Quality.Normal, stats: [], sockets: [], socketCount: 0, saveVersion: 105, mode: 0, ethereal: false, prefixes: [], suffixes: [], ...extra }) as unknown as D2Item;

  test('class items, two-handers and dual wielding', () => {
    const barb = doc<D2Character>('barbexp_v105.d2s'); // Barbarian: Hand Axe + Buckler
    const lock = doc<D2Character>('Warlock_v105.d2s'); // Warlock: Dagger in the right hand
    const empty = { ...barb, items: barb.items.filter((i) => i.mode !== ItemMode.Equipped) };
    expect(canEquip(barb, fake('ba1'), 1).ok).toBe(true); // Barbarian helm on a Barbarian
    expect(canEquip(lock, fake('ba1'), 1).reason).toMatch(/Barbarian only/);
    expect(canEquip(lock, fake('ob1'), 5).reason).toMatch(/Sorceress only/);
    // two-handed axe next to the dagger
    expect(canEquip(lock, fake('lax'), 5).reason).toMatch(/two-handed/);
    // a second weapon: only Barbarians dual-wield
    expect(canEquip(lock, fake('hax'), 5).reason).toMatch(/Barbarians/);
    expect(canEquip({ ...empty, items: [...empty.items, { ...fake('hax'), mode: ItemMode.Equipped, bodyLoc: 4 }] } as D2Character, fake('axe'), 5).ok).toBe(true);
    // Barbarians wield two-handed swords in one hand; a bow takes its quiver
    expect(canEquip({ ...empty, items: [...empty.items, { ...fake('buc'), mode: ItemMode.Equipped, bodyLoc: 5 }] } as D2Character, fake('2hs'), 4).ok).toBe(true);
    const sorc = doc<D2Character>('Soska.d2s');
    const bare = { ...sorc, items: sorc.items.filter((i) => i.mode !== ItemMode.Equipped) } as D2Character;
    const withBow = { ...bare, items: [...bare.items, { ...fake('sbw'), mode: ItemMode.Equipped, bodyLoc: 4 }] } as D2Character;
    expect(canEquip(withBow, fake('aqv'), 5).ok).toBe(true);
    expect(canEquip(withBow, fake('buc'), 5).ok).toBe(false);
    // requirements only warn
    const heavy = canEquip(bare, fake('uhm'), 1);
    expect(heavy.ok).toBe(true);
  });

  test('mercenary gear can be changed and is written back', () => {
    const ch = chaos();
    expect(ch.mercSplit).toBeDefined();
    const helm = ch.mercItems.find((i) => i.bodyLoc === 1)!;
    expect(store.move(helm, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' })).toBe(true);
    let again = roundTrip(chaos()) as D2Character;
    expect(again.mercItems.some((i) => i.bodyLoc === 1)).toBe(false);
    const inVault = (store.docs.get(vaultId())!.doc as { entries: { item: D2Item }[] }).entries.at(-1)!.item;
    expect(store.check(inVault, vaultId(), { docId: 't/ChaosSC.d2s', area: 'merc', bodyLoc: 2 }).ok).toBe(false); // no amulets for mercs
    expect(store.move(inVault, vaultId(), { docId: 't/ChaosSC.d2s', area: 'merc', bodyLoc: 1 })).toBe(true);
    again = roundTrip(chaos()) as D2Character;
    expect(again.mercItems.find((i) => i.bodyLoc === 1)?.code).toBe(helm.code);
    expect(again.items.length).toBe(chaos().items.length);
  });

  test('belt: capacity follows the belt, and a belt with potions up top cannot come off', () => {
    const ch = chaos(); // Arachnid Mesh (16 slots), potions in 0-3
    const pot = ch.items.find((i) => i.mode === ItemMode.Belt && i.x === 0)!;
    expect(store.move(pot, 't/ChaosSC.d2s', { docId: 't/ChaosSC.d2s', area: 'belt', x: 9 })).toBe(true);
    const belt = worn(chaos(), 8)!;
    expect(store.check(belt, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' }).reason).toMatch(/Empty the upper belt rows/);
    const moved = chaos().items.find((i) => i.mode === ItemMode.Belt && i.x === 9)!;
    expect(store.move(moved, 't/ChaosSC.d2s', { docId: 't/ChaosSC.d2s', area: 'belt' })).toBe(true); // first free slot
    expect(store.check(belt, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' }).ok).toBe(true);
    expect(store.check(ch.items.find((i) => i.mode === 0)!, 't/ChaosSC.d2s', { docId: 't/ChaosSC.d2s', area: 'belt', x: 5 }).ok).toBe(false);
    const again = roundTrip(chaos()) as D2Character;
    expect(again.items.filter((i) => i.mode === ItemMode.Belt).map((i) => i.x).sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('stackables tab', () => {
  const stackTab = () => modern().tabs.findIndex((t) => t.type === 1);
  const count = (code: string) => modern().tabs[stackTab()].items.filter((i) => i.code === code).reduce((n, i) => n + (i.advancedStackSize ?? 1), 0);

  test('take one off a stack, then add it back', () => {
    const um = modern().tabs[stackTab()].items.find((i) => i.code === 'r22')!;
    expect(count('r22')).toBe(4);
    expect(store.move(um, 't/ModernSharedStashSoftCoreV2.d2i', { docId: 't/ModernSharedStashSoftCoreV2.d2i', area: 'shared', tab: 1 })).toBe(true);
    expect(count('r22')).toBe(3);
    const single = modern().tabs[1].items.find((i) => i.code === 'r22')!;
    expect(single.advancedStackSize).toBeUndefined();
    let again = roundTrip(modern()) as D2SharedStash;
    expect(again.tabs[stackTab()].items.find((i) => i.code === 'r22')!.advancedStackSize).toBe(3);
    expect(again.tabs[1].items.find((i) => i.code === 'r22')!.advancedStackSize).toBeUndefined();

    expect(store.move(single, 't/ModernSharedStashSoftCoreV2.d2i', { docId: 't/ModernSharedStashSoftCoreV2.d2i', area: 'stackables', tab: stackTab() })).toBe(true);
    expect(count('r22')).toBe(4);
    expect(modern().tabs[1].items.some((i) => i.code === 'r22')).toBe(false);
    again = roundTrip(modern()) as D2SharedStash;
    expect(again.tabs[stackTab()].items.find((i) => i.code === 'r22')!.advancedStackSize).toBe(4);
  });

  test('the last one leaves the board, a new code starts a stack, non-stackables are refused', () => {
    const korlic = modern().tabs[stackTab()].items.find((i) => i.code === 'ua2')!;
    expect(store.move(korlic, 't/ModernSharedStashSoftCoreV2.d2i', { docId: vaultId(), area: 'vault' })).toBe(true);
    expect(count('ua2')).toBe(0);
    const inVault = (store.docs.get(vaultId())!.doc as { entries: { item: D2Item }[] }).entries.at(-1)!.item;
    expect(inVault.advancedStackSize).toBeUndefined();
    expect(store.move(inVault, vaultId(), { docId: 't/ModernSharedStashSoftCoreV2.d2i', area: 'stackables', tab: stackTab() })).toBe(true);
    expect(count('ua2')).toBe(1);
    const sword = modern().tabs[0].items[0];
    expect(store.check(sword, 't/ModernSharedStashSoftCoreV2.d2i', { docId: 't/ModernSharedStashSoftCoreV2.d2i', area: 'stackables', tab: stackTab() }).ok).toBe(false);
    roundTrip(modern());
  });
});

describe('realms and read-only mode', () => {
  test('Lord of Destruction items stay out of Reign of the Warlock files', () => {
    const legacy = doc<D2SharedStash>('SharedStashSoftCoreV2.d2i');
    const it = legacy.tabs[0].items[0];
    const r = store.check(it, 't/SharedStashSoftCoreV2.d2i', { docId: 't/ModernSharedStashSoftCoreV2.d2i', area: 'shared', tab: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Lord of Destruction item/);
    // …but a vault takes anything, and remembers where it came from
    expect(store.move(it, 't/SharedStashSoftCoreV2.d2i', { docId: vaultId(), area: 'vault' })).toBe(true);
    const inVault = (store.docs.get(vaultId())!.doc as { entries: { item: D2Item }[] }).entries.at(-1)!.item;
    expect(store.check(inVault, vaultId(), { docId: 't/ChaosSC.d2s', area: 'inventory' }).ok).toBe(false);
  });

  test('read-only mode blocks moves and saves', async () => {
    store.setSettings({ readOnly: true });
    const helm = worn(chaos(), 1)!;
    expect(store.check(helm, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' }).reason).toMatch(/Read-only/);
    expect(store.move(helm, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' })).toBe(false);
    store.setSettings({ readOnly: false });
    expect(store.move(helm, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' })).toBe(true);
  });
});

describe('splitting non-compact stacks', () => {
  test('a split-off uber part gets a new id and keeps everything else', async () => {
    const { withNewId, withStackSize, itemBytes } = await import('../src/core');
    const stash = parseStash(new Uint8Array(fs.readFileSync('tests/fixtures/ModernSharedStashSoftCoreV2.d2i')), 'x.d2i');
    const ua = stash.tabs.find((t) => t.type === 1)!.items.find((i) => i.code === 'ua3')!;
    expect(ua.compact).toBe(false);
    const three = withStackSize(ua, 3);
    const single = withNewId(withStackSize(three, undefined));
    expect(single.id).not.toBe(ua.id);
    expect(single.code).toBe('ua3');
    expect(single.advancedStackSize).toBeUndefined();
    expect(itemBytes(single).length).toBe(itemBytes(withStackSize(ua, undefined)).length);
  });
});

describe('gold', () => {
  test('character gold is re-encoded in the stats section and survives a save', async () => {
    const { setCharacterGold } = await import('../src/core');
    const ch = chaos();
    const before = ch.statList.filter((s) => s.id !== 14 && s.id !== 15);
    setCharacterGold(ch, 'gold', 900_000);
    let again = roundTrip(ch) as D2Character;
    expect(again.stats.gold).toBe(900_000);
    expect(again.statList.filter((s) => s.id !== 14 && s.id !== 15)).toEqual(before);
    setCharacterGold(ch, 'gold', 0);
    again = roundTrip(ch) as D2Character;
    expect(again.stats.gold).toBeUndefined();
    expect(again.items.length).toBe(ch.items.length);
    expect(() => setCharacterGold(ch, 'gold', 900_001)).toThrow(/at most 900,000/);
    expect(() => setCharacterGold(ch, 'goldbank', 2_500_001)).toThrow(/2,500,000/);
  });

  test('stash -> shared tab -> vault and back, with undo', async () => {
    const { parseVault, serializeVault } = await import('../src/core');
    const bank = chaos().stats.goldbank!;
    const tab0 = { docId: 't/ModernSharedStashSoftCoreV2.d2i', kind: 'shared' as const, tab: 0 };
    const stash = { docId: 't/ChaosSC.d2s', kind: 'stash' as const };
    const vault = { docId: vaultId(), kind: 'vault' as const, pot: 'rotw-sc' };
    expect(store.goldPotOf('t/ChaosSC.d2s')).toBe('rotw-sc');
    expect(store.transferGold(stash, tab0, 100_000)).toBe(100_000);
    expect(store.goldOf(stash)).toBe(bank - 100_000);
    expect((roundTrip(modern()) as D2SharedStash).tabs[0].gold).toBe(100_000);
    expect((roundTrip(chaos()) as D2Character).stats.goldbank).toBe(bank - 100_000);

    expect(store.transferGold(tab0, vault, 60_000)).toBe(60_000);
    const v = store.docs.get(vaultId())!.doc as Parameters<typeof serializeVault>[0];
    expect(parseVault(serializeVault(v)).gold['rotw-sc']).toBe(60_000);
    expect(store.transferGold(vault, stash, 60_000)).toBe(60_000);
    expect(store.goldOf(vault)).toBe(0);

    store.undo();
    expect(store.goldOf(vault)).toBe(60_000);
    expect(store.goldOf(stash)).toBe(bank - 100_000);
  });

  test('limits: only what is there, only what fits, never across editions', () => {
    const stash = { docId: 't/ChaosSC.d2s', kind: 'stash' as const };
    const inv = { docId: 't/ChaosSC.d2s', kind: 'inventory' as const };
    const bank = store.goldOf(stash);
    expect(store.transferGold(inv, stash, 1_000_000)).toBe(0); // only 222 carried
    // inventory holds 900,000 at level 90: a big transfer is clipped to the room left
    expect(store.transferGold(stash, inv, 2_000_000)).toBe(900_000 - 222);
    expect(store.goldOf(inv)).toBe(900_000);
    expect(store.goldOf(stash)).toBe(bank - (900_000 - 222));
    const legacy = { docId: 't/SharedStashSoftCoreV2.d2i', kind: 'shared' as const, tab: 0 };
    expect(store.transferGold(stash, legacy, 10)).toBe(0);
    expect(store.goldTargets(stash).some((r) => r.docId === 't/SharedStashSoftCoreV2.d2i')).toBe(false);
    store.setSettings({ readOnly: true });
    expect(store.transferGold(inv, stash, 10)).toBe(0);
  });
});

describe('selections and bulk moves', () => {
  test('a box/ctrl selection moves in one step and undoes in one step', () => {
    const ch = chaos();
    const inv = ch.items.filter((i) => i.mode === 0 && i.page === 0).slice(0, 5);
    store.select('t/ChaosSC.d2s', inv.slice(0, 3), 'replace');
    store.select('t/ChaosSC.d2s', inv.slice(3), 'add');
    store.select('t/ChaosSC.d2s', [inv[0]], 'toggle');
    expect(store.selection.items.size).toBe(4);
    const group = store.groupFor(inv[1], 't/ChaosSC.d2s');
    expect(group[0]).toBe(inv[1]);
    expect(group).toHaveLength(4);
    const before = chaos().items.length;
    expect(store.moveMany(group, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' })).toBe(4);
    expect(chaos().items.length).toBe(before - 4);
    expect(store.selection.items.size).toBe(0);
    store.undo();
    expect(chaos().items.length).toBe(before);
    roundTrip(chaos());
  });

  test('items keep their arrangement when dropped as a group', () => {
    const ch = chaos();
    const stashItems = ch.items.filter((i) => i.mode === 0 && i.page === 4);
    const [a, b] = stashItems;
    const dx = b.x - a.x, dy = b.y - a.y;
    const n = store.moveMany([a, b], 't/ChaosSC.d2s', { docId: 't/ModernSharedStashSoftCoreV2.d2i', area: 'shared', tab: 2, x: Math.max(0, -dx), y: Math.max(0, -dy) });
    expect(n).toBe(2);
    const [pa, pb] = modern().tabs[2].items.slice(-2);
    expect([pb.x - pa.x, pb.y - pa.y]).toEqual([dx, dy]);
    roundTrip(modern());
    roundTrip(chaos());
  });
});

describe('deleting a character', () => {
  test('needs the exact name, no unsaved changes, and removes it everywhere', async () => {
    store.showInPane(1, 't/Warlock_v105.d2s');
    expect(await store.deleteCharacter('t/Warlock_v105.d2s', 'Warlok')).toBe(false);
    const dagger = worn(doc<D2Character>('Warlock_v105.d2s'), 4)!;
    store.move(dagger, 't/Warlock_v105.d2s', { docId: vaultId(), area: 'vault' });
    expect(store.deleteBlocker('t/Warlock_v105.d2s')).toMatch(/unsaved/);
    expect(await store.deleteCharacter('t/Warlock_v105.d2s', 'Warlock')).toBe(false);
    await store.reload();
    store.showInPane(1, 't/Warlock_v105.d2s');
    expect(await store.deleteCharacter('t/Warlock_v105.d2s', 'warlock')).toBe(true);
    expect(store.docs.has('t/Warlock_v105.d2s')).toBe(false);
    expect(store.panes[1].docId).toBeUndefined();
    await store.reload();
    expect(store.docs.has('t/Warlock_v105.d2s')).toBe(false);
  });
});

describe('vault names', () => {
  test('no spaces, safe characters, unique', async () => {
    const { vaultNameProblem } = await import('../src/core');
    expect(vaultNameProblem('Runes_HC-2')).toBeUndefined();
    expect(vaultNameProblem('')).toMatch(/name/);
    expect(vaultNameProblem('My Vault')).toMatch(/spaces/);
    expect(vaultNameProblem('Vault!')).toMatch(/letters, numbers/);
    expect(vaultNameProblem('x'.repeat(33))).toMatch(/32/);
    expect(vaultNameProblem('mainvault', ['MainVault'])).toMatch(/already exists/);
  });

  test('creating and renaming follow the rules', () => {
    expect(store.vaultNames()).toEqual(['MainVault']);
    expect(() => store.addVault('Big Runes')).toThrow(/spaces/);
    const id = store.addVault('BigRunes');
    expect(store.renameVault(id, 'Big Runes')).toMatch(/spaces/);
    expect(store.renameVault(id, 'MainVault')).toMatch(/already exists/);
    expect(store.renameVault(id, 'Uber_Keys')).toBeUndefined();
    expect(store.vaultNames()).toContain('Uber_Keys');
  });
});

describe('vault collections', () => {
  test('uniques, sets and runewords are matched and duplicates stack', async () => {
    const { catalog, runewordFor, Quality } = await import('../src/core');
    const items = [...chaos().items, ...chaos().items.flatMap((i) => i.sockets)];
    const u = items.find((i) => i.quality === Quality.Unique)!;
    const rw = items.find((i) => i.runeword)!;
    const uniques = collect('unique', [u, u]);
    expect(uniques.get(String(u.uniqueId!))).toHaveLength(2);
    expect(catalog('unique').some((e) => e.id === u.uniqueId)).toBe(true);
    const rws = collect('runeword', [rw]);
    expect(rws.size).toBe(1);
    expect(catalog('runeword').find((e) => String(e.id) === [...rws.keys()][0])?.name).toBe(runewordFor(rw)!.name);
    expect(catalog('unique').length).toBeGreaterThan(400);
    expect(catalog('set').length).toBe(140);
    expect(catalog('runeword').every((e) => e.category !== 'Other')).toBe(true);
  });
});

describe('deleting vaults', () => {
  test('typed name, no unsaved changes, and an unsaved empty vault can just go', async () => {
    const id = store.addVault('Scratch');
    expect(store.vaultDeleteBlocker(id)).toBeUndefined();
    expect(await store.deleteVault(id, 'nope')).toBe(false);
    expect(await store.deleteVault(id, 'scratch')).toBe(true);
    expect(store.docs.has(id)).toBe(false);
    const helm = worn(chaos(), 1)!;
    store.move(helm, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' });
    expect(store.vaultDeleteBlocker(vaultId())).toMatch(/unsaved/);
  });
});

describe('runes and ethereal in collections', () => {
  test('runes: 33 slots in three groups, duplicates stack', async () => {
    const { catalog } = await import('../src/core');
    const runes = catalog('rune');
    expect(runes).toHaveLength(33);
    expect(runes[0].name).toBe('El Rune');
    expect(runes[32].name).toBe('Zod Rune');
    expect(new Set(runes.map((r) => r.group)).size).toBe(3);
    const stash = parseStash(new Uint8Array(fs.readFileSync('tests/fixtures/SharedStashSoftCoreV2.d2i')), 'x.d2i');
    const all = stash.tabs.flatMap((t) => t.items);
    const found = collect('rune', all);
    const anyRune = all.find((i) => /^r\d\d$/.test(i.code));
    if (anyRune) expect(found.get(String(Number(anyRune.code.slice(1))))!.length).toBeGreaterThan(0);
  });

  test('ethereal copies get their own slot only for items that can be ethereal', async () => {
    const { canBeEthereal, catalog, slots, Quality } = await import('../src/core');
    const byName = (n: string) => catalog('unique').find((e) => e.name === n)!;
    expect(canBeEthereal('unique', byName('Harlequin Crest'))).toBe(true);
    expect(canBeEthereal('unique', byName('The Stone of Jordan'))).toBe(false);
    expect(canBeEthereal('unique', byName('Annihilus'))).toBe(false);
    expect(canBeEthereal('rune', catalog('rune')[0])).toBe(false);
    const plain = slots('unique', false).length;
    const split = slots('unique', true).length;
    expect(split).toBeGreaterThan(plain);
    expect(split - plain).toBe(catalog('unique').filter((e) => !e.legacy && canBeEthereal('unique', e)).length);
    const found = chaos().items.find((i) => i.quality === Quality.Unique && i.def && (i.def.kind === 'armor' || i.def.kind === 'weapon'))!;
    const u = { ...found, ethereal: false };
    const eth = { ...found, ethereal: true };
    const merged = collect('unique', [u, eth], false);
    expect(merged.get(String(u.uniqueId))).toHaveLength(2);
    const apart = collect('unique', [u, eth], true);
    expect(apart.get(String(u.uniqueId))).toHaveLength(1);
    expect(apart.get(`${u.uniqueId}:eth`)).toHaveLength(1);
  });
});

describe('deleting items', () => {
  test('from a stash, a vault, a stackables stack and a character, with undo', () => {
    const tab0 = modern().tabs[0].items;
    const before = tab0.length;
    store.requestDelete('t/ModernSharedStashSoftCoreV2.d2i', [tab0[0]]);
    expect(store.pendingDelete?.items).toHaveLength(1);
    expect(store.deleteItems('t/ModernSharedStashSoftCoreV2.d2i', store.pendingDelete!.items)).toBe(1);
    expect(store.pendingDelete).toBeUndefined();
    expect(modern().tabs[0].items.length).toBe(before - 1);
    roundTrip(modern());
    store.undo();
    expect(modern().tabs[0].items.length).toBe(before);

    const stackTab = modern().tabs.findIndex((t) => t.type === 1);
    const um = modern().tabs[stackTab].items.find((i) => i.code === 'r22')!;
    const umN = um.advancedStackSize ?? 1;
    expect(store.deleteItems('t/ModernSharedStashSoftCoreV2.d2i', [um])).toBe(1);
    // only one comes off the stack
    expect(modern().tabs[stackTab].items.find((i) => i.code === 'r22')?.advancedStackSize ?? 0).toBe(umN - 1);
    roundTrip(modern());

    const helm = worn(chaos(), 1)!;
    store.move(helm, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' });
    const v = store.docs.get(vaultId())!.doc as { entries: { item: D2Item }[] };
    expect(store.deleteItems(vaultId(), [v.entries.at(-1)!.item])).toBe(1);
    expect(v.entries.length).toBe(0);

    const ring = worn(chaos(), 6)!;
    expect(store.deleteItems('t/ChaosSC.d2s', [ring])).toBe(1);
    expect(worn(chaos(), 6)).toBeUndefined();
    roundTrip(chaos());
  });

  test("a belt with potions up top can't be deleted, and read-only blocks deleting", () => {
    const ch = chaos();
    const pot = ch.items.find((i) => i.mode === ItemMode.Belt && i.x === 0)!;
    store.move(pot, 't/ChaosSC.d2s', { docId: 't/ChaosSC.d2s', area: 'belt', x: 10 });
    expect(store.deleteItems('t/ChaosSC.d2s', [worn(chaos(), 8)!])).toBe(0);
    store.setSettings({ readOnly: true });
    store.requestDelete('t/ChaosSC.d2s', [worn(chaos(), 1)!]);
    expect(store.pendingDelete).toBeUndefined();
  });
});

describe('grail totals follow the game Chronicle', () => {
  test('counts leave out legacy, duplicate and unobtainable rows', async () => {
    const { progress, slots, catalog } = await import('../src/core');
    const none = new Map();
    expect(progress('unique', false, none).total).toBe(409);
    expect(progress('set', false, none).total).toBe(135);
    expect(progress('runeword', false, none).total).toBe(99);
    expect(progress('rune', false, none).total).toBe(33);
    const legacy = catalog('unique').filter((e) => e.legacy).map((e) => e.name);
    expect(legacy).toContain('Constricting Ring');
    expect(catalog('unique').filter((e) => e.name === 'Azurewrath' && !e.legacy)).toHaveLength(1);
    expect(catalog('set').filter((e) => e.legacy).every((e) => e.name.startsWith("Warlord's"))).toBe(true);
    // a stored legacy item still gets a slot, but doesn't raise the total
    const ring = catalog('unique').find((e) => e.name === 'Constricting Ring')!;
    const have = new Map([[String(ring.id), [{} as never]]]);
    expect(slots('unique', false, have).some((s) => s.entry.id === ring.id)).toBe(true);
    expect(slots('unique', false).some((s) => s.entry.id === ring.id)).toBe(false);
    expect(progress('unique', false, have)).toEqual({ found: 0, total: 409 });
  });
});

describe('account-wide collections', () => {
  test('characters and stashes count, marked as not in the vault', async () => {
    const { collectHeld, progress, countHeld, Quality } = await import('../src/core');
    const held = store.held(vaultId());
    const u = chaos().items.find((i) => i.quality === Quality.Unique)!;
    const map = collectHeld('unique', held);
    const copies = map.get(String(u.uniqueId))!;
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((c) => !c.inVault)).toBe(true);
    expect(copies[0].where).toMatch(/^ChaosSC · /);
    expect(progress('unique', false, map).found).toBeGreaterThan(0);
    // once it's in the vault, the vault copy comes first
    store.move(u, 't/ChaosSC.d2s', { docId: vaultId(), area: 'vault' });
    const again = collectHeld('unique', store.held(vaultId())).get(String(u.uniqueId))!;
    expect(again[0].inVault).toBe(true);
    expect(countHeld(again)).toBe(copies.length);
  });

  test('runewords are makeable when the runes are on the account', async () => {
    const { canMake, runeCounts, catalog } = await import('../src/core');
    const enigma = catalog('runeword').find((e) => e.name === 'Enigma')!;
    const zod = catalog('runeword').find((e) => e.runes?.join(',') === 'r33')!;
    expect(canMake(enigma, new Map([['r31', 1], ['r06', 1], ['r30', 1]]))).toBe(true);
    expect(canMake(enigma, new Map([['r31', 1], ['r30', 1]]))).toBe(false);
    const ancientsPledge = catalog('runeword').find((e) => e.name === "Ancients' Pledge")!;
    expect(canMake(ancientsPledge, new Map([['r08', 1], ['r09', 1], ['r07', 1]]))).toBe(true);
    const kk = catalog('runeword').find((e) => e.runes?.[0] === e.runes?.[1] && (e.runes?.length ?? 0) >= 2)!;
    expect(canMake(kk, new Map([[kk.runes![0], 1], ...kk.runes!.slice(2).map((r) => [r, 5] as [string, number])]))).toBe(false);
    expect(zod).toBeUndefined();
    // stackables stacks count as several runes
    const counts = runeCounts(store.held(vaultId()));
    expect(counts.get('r22')).toBeGreaterThanOrEqual(4);
  });
});

describe('ethereal slots are for uniques only', () => {
  test('sets and runewords never get an eth slot', async () => {
    const { slots, canBeEthereal, catalog, Quality } = await import('../src/core');
    expect(slots('set', true).length).toBe(slots('set', false).length);
    expect(slots('runeword', true).length).toBe(slots('runeword', false).length);
    expect(catalog('set').some((e) => canBeEthereal('set', e))).toBe(false);
    const setItem = { quality: Quality.Set, setId: catalog('set')[0].id, ethereal: true } as never;
    expect([...collect('set', [setItem], true).keys()]).toEqual([String(catalog('set')[0].id)]);
  });
});

describe('runes in items and empty stacks', () => {
  test('socketed runes count as found, with where they are; empty stacks do not', async () => {
    const { collectHeld, runeCounts } = await import('../src/core');
    const held = store.held(vaultId());
    const socketed = held.filter((h) => h.socketedIn && /^r\d\d$/.test(h.item.code));
    expect(socketed.length).toBeGreaterThan(0);
    const s = socketed[0];
    expect(s.where).toContain(s.socketedIn!);
    const runes = collectHeld('rune', held);
    expect(runes.get(String(Number(s.item.code.slice(1))))!.some((h) => h.socketedIn)).toBe(true);
    // socketed runes are in use: they don't help make runewords
    const loose = runeCounts(held.filter((h) => !h.socketedIn));
    expect(runeCounts(held)).toEqual(loose);
    // a stack with count 0 is not "found"
    const um = modern().tabs.find((t) => t.type === 1)!.items.find((i) => i.code === 'r22')!;
    expect(collectHeld('rune', [{ item: { ...um, advancedStackSize: 0 }, docId: 'x', where: 'x', inVault: false }]).size).toBe(0);
  });
});

describe('stackables: Shift ×3 and one-at-a-time deletes', () => {
  const stackTab = () => modern().tabs.findIndex((t) => t.type === 1);
  const um = () => modern().tabs[stackTab()].items.find((i) => i.code === 'r22');
  const umCount = () => um()?.advancedStackSize ?? 0;

  test('Shift takes 3 off a stack and puts 3 back', () => {
    const before = umCount();
    expect(before).toBeGreaterThanOrEqual(3);
    const sid = 't/ModernSharedStashSoftCoreV2.d2i';
    expect(store.moveStackable(um()!, sid, { docId: vaultId(), area: 'vault' }, 3)).toBe(true);
    expect(umCount()).toBe(before - 3);
    const inVault = () => (store.docs.get(vaultId())!.doc as { entries: { item: D2Item }[] }).entries.filter((e) => e.item.code === 'r22');
    expect(inVault().length).toBe(3);
    expect((roundTrip(modern()) as D2SharedStash).tabs[stackTab()].items.find((i) => i.code === 'r22')?.advancedStackSize ?? 0).toBe(before - 3);
    // one undo step brings all three back
    store.undo();
    expect(umCount()).toBe(before);
    expect(inVault().length).toBe(0);
    // and from the vault back onto the stack, 3 at a time
    store.moveStackable(um()!, sid, { docId: vaultId(), area: 'vault' }, 3);
    expect(store.moveStackable(inVault()[0].item, vaultId(), { docId: sid, area: 'stackables', tab: stackTab() }, 3)).toBe(true);
    expect(umCount()).toBe(before);
    expect(inVault().length).toBe(0);
  });

  test('deleting from a stack removes only one', () => {
    const before = umCount();
    expect(store.deleteItems('t/ModernSharedStashSoftCoreV2.d2i', [um()!])).toBe(1);
    expect(umCount()).toBe(before - 1);
    expect((roundTrip(modern()) as D2SharedStash).tabs[stackTab()].items.find((i) => i.code === 'r22')?.advancedStackSize ?? 0).toBe(before - 1);
  });
});

describe('gems collection', () => {
  test('35 gems in seven groups, Chipped to Perfect', async () => {
    const { catalog, slots } = await import('../src/core');
    const gems = catalog('gem');
    expect(gems.length).toBe(35);
    expect([...new Set(gems.map((g) => g.group))]).toEqual(['Amethyst', 'Diamond', 'Emerald', 'Ruby', 'Sapphire', 'Topaz', 'Skull']);
    expect(gems.slice(0, 5).map((g) => g.name)).toEqual(['Chipped Amethyst', 'Flawed Amethyst', 'Amethyst', 'Flawless Amethyst', 'Perfect Amethyst']);
    expect(slots('gem', true).length).toBe(35);
  });
});

describe('startup panes', () => {
  test('fullest vault on the left, newest character on the right; switching sides', async () => {
    const p = fakePlatform();
    const list = p.listSaves;
    p.listSaves = async (f) => (await list(f)).map((e) => ({ ...e, modified: e.name === 'barbexp_v105.d2s' ? 2_000 : 1_000 }));
    const s = new Store(p);
    s.toast = () => {};
    await s.openFolder('t/');
    expect(s.docs.get(s.panes[0].docId!)?.doc?.kind).toBe('vault');
    expect(s.panes[1].docId).toBe('t/barbexp_v105.d2s');
    s.swapPanes();
    expect(s.panes[0].docId).toBe('t/barbexp_v105.d2s');
  });
});

describe('remembering the save folder', () => {
  test('the desktop app records the folder it opened', async () => {
    const p = { ...fakePlatform(), id: 'tauri' as const };
    const s = new Store(p);
    s.toast = () => {};
    await s.openFolder('t/');
    expect(s.settings.lastFolder).toBe('t/');
    // the demo never records one
    expect(store.settings.lastFolder).toBeUndefined();
  });
});

describe('trade (optional feature)', () => {
  const sid = 't/ModernSharedStashSoftCoreV2.d2i';
  const stackTab = () => modern().tabs.findIndex((t) => t.type === 1);
  const count = (code: string) => modern().tabs[stackTab()].items.filter((i) => i.code === code).reduce((n, i) => n + (i.advancedStackSize ?? 1), 0);

  test('created runes and gems parse back and survive a save', async () => {
    const { createCompactItem } = await import('../src/core');
    for (const c of ['r01', 'r24', 'r33', 'gpw', 'skz']) {
      const it = createCompactItem(c);
      expect([it.code, it.compact, it.advancedStackSize]).toEqual([c, true, undefined]);
    }
    expect(() => createCompactItem('cm3')).toThrow();
    expect(() => createCompactItem('r24', 99)).toThrow();
  });

  test('paying with Um from the Stackables tab for an Ist', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    expect(store.tradeProblem()).toBeUndefined();
    const um = count('r22'), ist = count('r24');
    expect(um).toBeGreaterThanOrEqual(3);
    // a listing selling an Ist for 3 Um
    expect(store.tradeSetListing({ name: 'Ist Rune', mode: 'softcore', ask: [[{ code: 'r22', qty: 3, name: 'Um Rune' }]], want: [['r24', 1]] })).toBeUndefined();
    store.tradeOffer('r22', 2);
    // offered runes leave the stash right away (the stack counts down) and wait in the offer box
    expect([count('r22'), store.trade.offer.get('r22')]).toEqual([um - 2, 2]);
    expect(store.tradeAccept()).toBe(false); // 2 isn't the 3 asked for
    store.tradeOffer('r22', -1); // right-click: one goes back onto its stack
    expect(count('r22')).toBe(um - 1);
    store.tradeOffer('r22', 2);
    // saving waits while runes sit in the offer
    let blocked = '';
    const t0 = store.toast;
    store.toast = (_k, t) => void (blocked = t);
    await store.saveAll();
    store.toast = t0;
    expect(blocked).toMatch(/take your offer back/);
    expect(store.tradeAccept()).toBe(true);
    // paid, and the Ist waits in the Received box; saving is blocked until it's moved out
    expect([count('r22'), count('r24'), store.trade.offer.size]).toEqual([um - 3, ist, 0]);
    expect(store.tradeReceived.map((i) => i.code)).toEqual(['r24']);
    let saved = false;
    const toast = store.toast;
    store.toast = (_k, t) => void (saved = /Received/.test(t));
    await store.saveAll();
    expect(saved).toBe(true);
    store.toast = toast;
    store.tradeDeliverAll();
    expect(store.tradeReceived.length).toBe(0);
    expect([count('r22'), count('r24')]).toEqual([um - 3, ist + 1]);
    const out = roundTrip(modern()) as D2SharedStash;
    expect(out.tabs[stackTab()].items.find((i) => i.code === 'r24')?.advancedStackSize ?? 0).toBe(ist + 1);
    store.undo(); // the delivery
    expect(store.tradeReceived.length).toBe(1);
    store.undo(); // the trade: the Um are back in the offer box
    expect([count('r22'), count('r24'), store.tradeReceived.length, store.trade.offer.get('r22')]).toEqual([um - 3, ist, 0, 3]);
    store.tradeClear(); // and Clear puts them back on the stash
    expect([count('r22'), store.trade.offer.size]).toEqual([um, 0]);
  });

  test('only Reign of the Warlock files can trade, and you can only offer what you have', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: 't/SharedStashSoftCoreV2.d2i', tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    expect(store.tradeProblem()).toMatch(/Reign of the Warlock/);
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    const have = store.tradeOwned().get('r33') ?? 0;
    store.tradeOffer('r33', 5);
    expect(store.trade.offer.get('r33') ?? 0).toBe(Math.min(5, have));
    store.tradeClear();
  });
});

describe('building unique and set items', () => {
  test('every buildable unique and set item builds and parses back, perfect and random', async () => {
    const { buildableTemplates, createTemplateItem, rollSlots, pickRolls, describeItem } = await import('../src/core');
    let n = 0;
    for (const kind of ['unique', 'set'] as const)
      for (const t of buildableTemplates(kind))
        for (const mode of ['perfect', 'random'] as const) {
          const it = createTemplateItem(kind, t.id, pickRolls(rollSlots(kind, t.id), mode));
          expect(describeItem(it).lines.length).toBeGreaterThan(0);
          n++;
        }
    expect(n).toBeGreaterThan(1000); // ~550 items, twice each
  });

  test('built items match real drops apart from the id and graphic', async () => {
    const { createTemplateItem, parseCharacter, statDef } = await import('../src/core');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const ch = parseCharacter(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'ChaosSC.d2s'))));
    const key = (i: D2Item) => [i.code, i.itemLevel > 0, i.defense, i.maxDurability, i.durability, i.stats.map((s) => `${statDef(s.id).key}${s.param}=${s.value}`).join(' ')].join('|');
    // real SoJs, Mara's and an Arachnid Mesh with perfect (or fixed) rolls: built perfect, they're the same item
    const real = ch.items.filter((i) => i.quality === Quality.Unique && ['The Stone of Jordan', "Mara's Kaleidoscope", 'Arachnid Mesh'].includes(GD.uniques[i.uniqueId!]?.name));
    expect(real.length).toBeGreaterThanOrEqual(3);
    for (const r of real) expect(key(createTemplateItem('unique', r.uniqueId!))).toBe(key(r));
  });

  test('rolls are respected and checked against their range', async () => {
    const { buildableTemplates, createTemplateItem, rollSlots, describeItem } = await import('../src/core');
    const anni = buildableTemplates('unique').find((t) => t.name === 'Annihilus')!;
    const slots = rollSlots('unique', anni.id);
    const low = Object.fromEntries(slots.filter((s) => s.variable).map((s) => [s.key, s.lo]));
    const it = createTemplateItem('unique', anni.id, low);
    expect(describeItem(it).lines.some((l) => l.text === '+10 to all Attributes' && l.range === '10–20' && !l.perfect)).toBe(true);
    expect(() => createTemplateItem('unique', anni.id, { [slots.find((s) => s.variable)!.key]: 99 })).toThrow(/outside/);
    // Hellfire Torch: the class is chosen
    const torch = buildableTemplates('unique').find((t) => t.name === 'Hellfire Torch')!;
    const cls = rollSlots('unique', torch.id).find((s) => s.kind === 'class')!;
    const sorc = createTemplateItem('unique', torch.id, { [cls.key]: 1 });
    expect(describeItem(sorc).lines.some((l) => l.text === '+3 to Sorceress Skill Levels')).toBe(true);
    // sockets and set bonuses
    const coa = buildableTemplates('unique').find((t) => t.name === 'Crown of Ages')!;
    const sock = rollSlots('unique', coa.id).find((s) => s.kind === 'sockets')!;
    expect(createTemplateItem('unique', coa.id, { [sock.key]: 1 }).socketCount).toBe(1);
    const tal = buildableTemplates('set').find((t) => t.name === "Tal Rasha's Lidless Eye")!;
    const eye = createTemplateItem('set', tal.id);
    expect([eye.setMask, eye.setBonusStats.length]).toEqual([15, 4]);
  });

  test('trading for a unique puts it in Received, and it moves and saves like any item', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    const { buildableTemplates, createTemplateItem } = await import('../src/core');
    const sid = 't/ModernSharedStashSoftCoreV2.d2i';
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    const soj = buildableTemplates('unique').find((t) => t.name === 'The Stone of Jordan')!;
    store.tradeSetListing({ name: 'The Stone of Jordan', mode: 'softcore', ask: [[{ code: 'r22', qty: 2, name: 'Um Rune' }]], items: [{ kind: 'unique', id: soj.id, name: 'The Stone of Jordan', item: createTemplateItem('unique', soj.id) }] });
    store.tradeOffer('r22', 1); // it asks for 2 Um
    expect(store.tradeAccept()).toBe(false);
    store.tradeOffer('r22', 1);
    expect(store.tradeAccept()).toBe(true);
    expect(store.trade.items.length).toBe(0);
    expect(store.tradeReceived.map((i) => i.uniqueId)).toEqual([soj.id]);
    store.tradeDeliverAll();
    expect(store.tradeReceived.length).toBe(0);
    const out = roundTrip(modern()) as D2SharedStash;
    expect(out.tabs.flatMap((t) => t.items).filter((i) => i.uniqueId === soj.id && i.quality === 7).length).toBeGreaterThanOrEqual(1);
    store.undo();
    store.undo();
    expect(store.tradeReceived.length).toBe(0);
  });
});

describe('ethereal items and plain bases', () => {
  test('bases match real ones: a 2-socket Bardiche, a Dusk Shroud and an ethereal Sacred Armor', async () => {
    const { createBaseItem, parseStash, parseCharacter } = await import('../src/core');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', f)));
    const stash = parseStash(read('SharedStashSoftCoreV2.d2i')).tabs.flatMap((t) => t.items);
    const bar = stash.find((i) => i.code === 'bar' && i.quality === Quality.Normal && !i.runeword)!;
    const ours = createBaseItem('bar', { sockets: 2 });
    expect([ours.flags >>> 0, ours.maxDurability, ours.socketCount, ours.stats.length]).toEqual([bar.flags >>> 0, bar.maxDurability, 2, bar.stats.length]);
    // a Dusk Shroud used for a runeword: the same base apart from the runeword flag
    const dusk = stash.find((i) => i.code === 'uui' && i.quality === Quality.Normal)!;
    const d2 = createBaseItem('uui', { sockets: 3, defense: dusk.defense });
    expect([d2.flags >>> 0, d2.defense, d2.maxDurability]).toEqual([(dusk.flags & ~0x04000000) >>> 0, dusk.defense, dusk.maxDurability]);
    const sa = parseCharacter(read('Soska.d2s')).items.find((i) => i.code === 'uar' && i.ethereal)!;
    const eth = createBaseItem('uar', { sockets: 4, ethereal: true });
    expect([eth.defense, eth.maxDurability, eth.socketCount]).toEqual([sa.defense, sa.maxDurability, 4]);
  });

  test('limits: sockets, defense range, and what can be ethereal', async () => {
    const { createBaseItem, createTemplateItem, buildableTemplates, maxBaseSockets, canBuildEthereal, buildableBases } = await import('../src/core');
    expect(maxBaseSockets('uit')).toBe(4); // Monarch
    expect(maxBaseSockets('7s8')).toBe(5); // Thresher, capped by its own limit (polearms allow 6)
    expect(() => createBaseItem('uit', { sockets: 5 })).toThrow(/0–4 sockets/);
    expect(() => createBaseItem('uit', { defense: 1 })).toThrow(/defense/);
    expect(createBaseItem('uit', { sockets: 0 }).socketed).toBe(false);
    expect(canBuildEthereal('set', 'uth')).toBe(false);
    expect(canBuildEthereal('unique', 'rin')).toBe(false);
    expect(canBuildEthereal('base', '7cr')).toBe(false); // Phase Blade has no durability
    expect(buildableBases().length).toBeGreaterThan(300);
    const titan = buildableTemplates('unique').find((t) => t.name === "Titan's Revenge")!;
    const t = createTemplateItem('unique', titan.id, {}, { ethereal: true });
    expect(t.ethereal).toBe(true);
    const soj = buildableTemplates('unique').find((t) => t.name === 'The Stone of Jordan')!;
    expect(() => createTemplateItem('unique', soj.id, {}, { ethereal: true })).toThrow(/ethereal/);
  });
});

describe('socket rolls never exceed the base', () => {
  test('every unique and set item with sockets rolls only up to what its base holds', async () => {
    const { buildableTemplates, rollSlots, maxBaseSockets, createTemplateItem, GD: gd } = await import('../src/core');
    for (const kind of ['unique', 'set'] as const)
      for (const t of buildableTemplates(kind))
        for (const s of rollSlots(kind, t.id).filter((x) => x.kind === 'sockets')) {
          expect(s.hi, t.name).toBeLessThanOrEqual(maxBaseSockets(t.code));
          expect(createTemplateItem(kind, t.id, { [s.key]: s.hi }).socketCount).toBe(s.hi);
        }
    const range = (kind: 'unique' | 'set', name: string) => {
      const t = buildableTemplates(kind).find((x) => x.name === name)!;
      const s = rollSlots(kind, t.id).find((x) => x.kind === 'sockets')!;
      return [s.lo, s.hi];
    };
    expect(range('set', "Aldur's Rhythm")).toEqual([2, 3]); // tables say 2–5, a Jagged Star holds 3
    expect(range('unique', "Heaven's Light")).toEqual([1, 2]); // 1–3 on a 2-socket Mighty Scepter
    expect(range('unique', 'Blade of Ali Baba')).toEqual([2, 2]); // 3 on a 2-socket Tulwar
    expect(range('unique', 'Crown of Ages')).toEqual([1, 2]);
    expect(range('unique', 'Rune Master')).toEqual([3, 5]);
    void gd;
  });
});

describe('superior bases, automatic mods and class skills', () => {
  test('every base builds with every superior and automatic mod it can roll, and with 3 class skills', async () => {
    const { buildableBases, createBaseItem, superiorRows, autoRows, classSkillsFor } = await import('../src/core');
    let n = 0;
    for (const b of buildableBases()) {
      for (const row of [undefined, ...superiorRows(b.code)])
        for (const a of [undefined, ...autoRows(b.code)]) {
          const it = createBaseItem(b.code, { sockets: b.sockets, superior: row === undefined ? undefined : { row, values: [] }, auto: a === undefined ? undefined : { row: a, values: [] } });
          expect(it.quality).toBe(row === undefined ? Quality.Normal : Quality.Superior);
          n++;
        }
      const sk = classSkillsFor(b.code);
      if (sk.length) createBaseItem(b.code, { skills: sk.slice(0, 3).map((s) => ({ skill: s.id, level: 3 })) });
    }
    expect(n).toBeGreaterThan(5000);
  });

  test('automatic mods are stored like the game does (a real Sacred Globe: "Snake’s" = id 17)', async () => {
    const { createBaseItem, autoRows, parseCharacter } = await import('../src/core');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const real = parseCharacter(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'Soska.d2s')))).items.find((i) => i.code === 'ob2')!;
    expect(GD.automagic[real.autoAffix! - 1].name).toBe("Snake's");
    const ours = createBaseItem('ob2', { auto: { row: real.autoAffix! - 1, values: [6] } });
    expect(ours.autoAffix).toBe(17);
    expect(ours.stats.find((s) => s.id === 9)?.value).toBe(real.stats.find((s) => s.id === 9)?.value); // +6 mana
    expect(autoRows('ob2')).toContain(16);
  });

  test('who rolls what: paladin shields get resistances, orbs get Sorceress skills, armor never gets damage', async () => {
    const { createBaseItem, autoRows, classSkillsFor, superiorRows, describeItem } = await import('../src/core');
    const code = Object.keys(GD.items).find((c) => GD.items[c].name === 'Sacred Targe')!;
    const chromatic = autoRows(code).find((r) => GD.automagic[r].name === 'Chromatic')!;
    expect(chromatic).toBeDefined();
    expect(classSkillsFor(code)).toEqual([]); // paladin shields: no skills when white
    const targe = createBaseItem(code, { sockets: 4, superior: { row: 2, values: [15] }, auto: { row: chromatic, values: [45] } });
    const lines = describeItem(targe).lines.map((l) => l.text);
    expect(lines).toContain('+15% Enhanced Defense');
    expect(lines).toContain('All Resistances +45');
    expect(classSkillsFor('6ws').every((s) => GD.skills[s.id].cls === 1)).toBe(true); // Archon Staff: Sorceress
    expect(superiorRows('uap').every((r) => !GD.superior[r].mods.some((m) => m[0] === 'dmg%'))).toBe(true);
    expect(() => createBaseItem(code, { auto: { row: chromatic, values: [50] } })).toThrow(/outside/);
    expect(() => createBaseItem('6ws', { skills: [{ skill: 36, level: 4 }] })).toThrow(/\+1 to \+3/);
    expect(() => createBaseItem('6ws', { skills: [{ skill: 6, level: 1 }] })).toThrow(/can't roll/); // an Amazon skill
    expect(() => createBaseItem(code, { skills: [{ skill: 97, level: 1 }] })).toThrow(/can't roll/);
  });
});

describe('the Trade panel only offers runeword bases', () => {
  test('elite, socketable, fits a runeword; no boots, gloves, belts, javelins or throwing weapons', async () => {
    const { runewordBases, isType, itemTypeOf } = await import('../src/core');
    const list = runewordBases();
    const names = list.map((b) => b.name);
    for (const n of ['Monarch', 'Archon Plate', 'Dusk Shroud', 'Thresher', 'Giant Thresher', 'Phase Blade', 'Sacred Targe', 'Diadem', 'Eldritch Orb']) expect(names, n).toContain(n);
    for (const n of ['Mage Plate', 'Crystal Sword', 'Matriarchal Javelin', 'Flying Axe', 'Mirrored Boots', 'Vambraces', 'Mithril Coil']) expect(names, n).not.toContain(n);
    for (const b of list) {
      expect(b.tier).toBe('Elite');
      expect(b.sockets).toBeGreaterThan(0);
      expect(['boot', 'glov', 'belt', 'misl', 'tkni', 'taxe', 'jave'].some((t) => isType(b.code, t)), `${b.name} ${itemTypeOf(b.code)}`).toBe(false);
    }
  });
});

describe('uber items and RotW Sunder charms', () => {
  test('uber keys, organs, essences and shards build like the game saves them', async () => {
    const { createUberItem, UBER_CODES, parseStash } = await import('../src/core');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const real = parseStash(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'ModernSharedStashSoftCoreV2.d2i')))).tabs.flatMap((t) => t.items).find((i) => i.code === 'xa1')!;
    const ours = createUberItem('xa1');
    expect([ours.flags >>> 0, ours.formatVersion, ours.quality, ours.stats.length, ours.compact]).toEqual([real.flags >>> 0, real.formatVersion, real.quality, 0, false]);
    for (const c of UBER_CODES) expect(createUberItem(c).code).toBe(c);
    expect(() => createUberItem('r24')).toThrow();
  });

  test('trading Ist for a key set, with the keys landing on Stackables stacks', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    const sid = 't/ModernSharedStashSoftCoreV2.d2i';
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    const stash = () => modern();
    const count = (code: string) => stash().tabs.flatMap((t) => t.items).filter((i) => i.code === code).reduce((n, i) => n + (i.advancedStackSize ?? 1), 0);
    const before = ['pk1', 'pk2', 'pk3'].map(count);
    store.tradeSetListing({ name: 'Key set', mode: 'softcore', ask: [[{ code: 'r22', qty: 3, name: 'Um Rune' }]], want: [['pk1', 1], ['pk2', 1], ['pk3', 1]] });
    store.tradeOffer('r22', 3);
    expect(store.tradeAccept()).toBe(true);
    expect(store.tradeReceived.map((i) => i.code).sort()).toEqual(['pk1', 'pk2', 'pk3']);
    store.tradeDeliverAll();
    expect(store.tradeReceived.length).toBe(0);
    expect(['pk1', 'pk2', 'pk3'].map(count)).toEqual(before.map((n) => n + 1));
    roundTrip(stash());
    store.undo();
    store.undo();
  });

  test('old Sunder charms are out; the Latent and Renewed ones are in', async () => {
    const { buildableTemplates, unbuildableReason } = await import('../src/core');
    const names = buildableTemplates('unique').map((t) => t.name);
    for (const s of ['Cold Rupture', 'Flame Rift', 'Crack of the Heavens', 'Rotting Fissure', 'Bone Break', 'Black Cleft']) {
      expect(names).not.toContain(s);
      expect(names).toContain(`Latent ${s}`);
      expect(names).toContain(`Renewed ${s}`);
    }
    const old = Object.keys(GD.uniques).find((k) => GD.uniques[k].name === 'Cold Rupture')!;
    expect(unbuildableReason('unique', Number(old))).toBe('Replaced by Latent Cold Rupture');
  });
});

describe('imported listings: Softcore and Hardcore never mix', () => {
  test('a Hardcore listing can’t be paid from a Softcore file, and listings in one trade must agree', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: 't/ModernSharedStashSoftCoreV2.d2i', tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    store.tradeClear();
    // a Hardcore listing is refused straight away while a Softcore stash pays
    expect(store.tradeModeProblem('hardcore')).toBe('This is a Hardcore listing, but RotW Shared Stash is softcore. Softcore and hardcore never mix.');
    expect(store.tradeListingMode('hardcore')).toMatch(/never mix/);
    expect(store.trade.mode).toBeUndefined();
    expect(store.tradeListingMode('softcore')).toBeUndefined();
    expect(store.tradeModeProblem('hardcore')).toMatch(/listings already in this trade are softcore/);
    // and with a Hardcore listing in the trade, softcore runes can't even go into the offer
    store.trade.mode = 'hardcore';
    let msg = '';
    const toast = store.toast;
    store.toast = (_k, t) => void (msg = t);
    store.tradeOffer('r22', 3);
    expect(store.trade.offer.size).toBe(0);
    expect(msg).toMatch(/This listing is hardcore; that one is softcore/);
    expect(store.tradeAccept()).toBe(false);
    store.toast = toast;
    store.tradeClear();
    expect(store.trade.mode).toBeUndefined();
  });
});

describe('trading for an imported listing, at the listing’s price', () => {
  test('the offer has to be exactly one of the options the listing asks for', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    const { buildableTemplates, createTemplateItem } = await import('../src/core');
    const sid = 't/ModernSharedStashSoftCoreV2.d2i';
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    store.tradeClear();
    const anni = buildableTemplates('unique').find((t) => t.name === 'Annihilus')!;
    const ask = [[{ code: 'r22', qty: 2, name: 'Um Rune' }], [{ code: 'r24', qty: 1, name: 'Ist Rune' }]];
    expect(store.tradeSetListing({ name: 'Annihilus', mode: 'softcore', ask, items: [{ kind: 'unique', id: anni.id, name: 'Annihilus', item: createTemplateItem('unique', anni.id) }] })).toBeUndefined();
    expect(store.tradeSetListing({ name: 'Annihilus', mode: 'hardcore', ask, items: [] })).toMatch(/never mix/); // and the softcore listing stays
    expect(store.trade.listing).toBe('Annihilus');
    let msg = '';
    const toast = store.toast;
    store.toast = (_k, t) => void (msg = t);
    store.tradeOffer('r22', 1);
    expect(store.tradeAskMatch()).toBe(-1);
    expect(store.tradeAccept()).toBe(false);
    expect(msg).toBe('Offer exactly what the listing asks for: 2× Um Rune or 1× Ist Rune.');
    store.tradeOffer('r22', 2);
    expect(store.tradeAskMatch()).toBe(-1); // 3 Um is more than asked
    store.tradeOffer('r22', -1);
    expect(store.tradeAskMatch()).toBe(0);
    expect(store.tradeAccept()).toBe(true);
    store.toast = toast;
    expect(store.tradeReceived.map((i) => i.uniqueId)).toEqual([anni.id]);
    expect([store.trade.ask, store.trade.listing]).toEqual([undefined, undefined]);
    store.undo();
  });
});

describe('the Trade button', () => {
  test('opens Trade on the right and the RotW shared stash on its Stackables tab on the left', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: 't/Soska.d2s', tab: 0 }, { docId: 't/barbexp_v105.d2s', tab: 0 }];
    store.openTrade();
    const stash = store.docs.get(store.panes[0].docId!)!.doc as D2SharedStash;
    expect(stash.kind).toBe('stash');
    expect(stash.modern).toBe(true);
    expect(stash.tabs[store.panes[0].tab].type).toBe(1); // Stackables
    expect(store.panes[1].docId).toBe(TRADE_ID);
  });
});

describe('runewords, magic, rare and crafted items', () => {
  const fixture = (f: string) => new Uint8Array(fs.readFileSync(`${__dirname}/fixtures/${f}`));
  const realItems = () => [
    ...['ChaosSC.d2s', 'Roka.d2s', 'Soska.d2s'].flatMap((f) => (parseCharacter(fixture(f)) as D2Character).items),
    ...parseStash(fixture('SharedStashSoftCoreV2.d2i')).tabs.flatMap((t) => t.items),
  ];

  test('runewords match real ones: flag, id, runes in the sockets and the same stats', async () => {
    const { createRunewordItem, RUNEWORD_ID_OFFSET, statDef } = await import('../src/core');
    const real = realItems().filter((i) => i.runeword && i.runewordId !== undefined);
    expect(real.length).toBeGreaterThan(2);
    const names = new Set<string>();
    for (const r of real) {
      const row = r.runewordId! - RUNEWORD_ID_OFFSET;
      const rw = GD.runewords.find((x) => x.row === row);
      if (!rw) continue;
      const ours = createRunewordItem(row, r.code, {}, { ethereal: r.ethereal });
      const shape = (i: D2Item) => [i.flags >>> 0, i.runewordId, i.sockets.map((c) => c.code).join(), i.runewordStats.map((s) => `${statDef(s.id).key}:${s.param}`).sort().join(' ')];
      expect(shape(ours), rw.name).toEqual(shape(r));
      names.add(rw.name);
    }
    expect([...names]).toEqual(expect.arrayContaining(['Spirit']));
  });

  test('magic and rare items match real drops: same affixes, stats and defense', async () => {
    const { createAffixItem, propStatsAt, statDef, affixRows } = await import('../src/core');
    // each affix's rolled value, from the real item's stats
    const valuesOf = (mods: [string, string, number, number][], real: D2Item) =>
      mods.map(([code, param, min, max]) => {
        for (let v = Math.min(min, max); v <= Math.max(min, max); v++) {
          const st = propStatsAt(code, param, min, max, v).stats;
          if (st.length && st.every((s) => real.stats.some((x) => x.id === s.id && x.param === s.param && x.value >= s.value))) {
            if (st.every((s) => real.stats.some((x) => x.id === s.id && x.param === s.param && x.value === s.value))) return v;
          }
        }
        return Math.max(min, max);
      });
    // (defense aside: real drops with Enhanced Defense store the top + 1 mostly, but not always; see below)
    const key = (i: D2Item) => [i.code, i.quality, i.prefixes.join(), i.suffixes.join(), i.ethereal, i.maxDurability, i.stats.map((s) => `${statDef(s.id).key}${s.param}=${s.value}`).sort().join(' ')].join('|');
    const picked = realItems().filter((i) => (i.quality === Quality.Magic || i.quality === Quality.Rare) && !i.autoAffix);
    let n = 0;
    for (const r of picked) {
      if (r.prefixes.some((id) => !GD.affixes.prefix[id]) || r.suffixes.some((id) => !GD.affixes.suffix[id])) continue; // editor-made (id 2047)
      const side = (s: 'prefix' | 'suffix') => (s === 'prefix' ? r.prefixes : r.suffixes).filter(Boolean).map((row) => ({ side: s, row, values: valuesOf(GD.affixes[s][row].mods, r) }));
      const affixes = [...side('prefix'), ...side('suffix')];
      // editor-made items carry affixes their base can't roll (a "Scintillating" small charm)
      if (affixes.some((a) => !affixRows(a.side, r.code, r.quality === Quality.Magic ? 'magic' : 'rare').includes(a.row))) continue;
      // affixes on the same stat add up: only single-affix-per-stat items compare exactly
      const ids = affixes.flatMap((a) => GD.affixes[a.side][a.row].mods.map((m) => m[0]));
      if (new Set(ids).size !== ids.length) continue;
      // and items with stats no affix explains (a 40% ED "Jewel of Fervor" with no prefix) aren't plain drops
      const explained = new Set(affixes.flatMap((a) => GD.affixes[a.side][a.row].mods.flatMap(([c, p, lo, hi]) => propStatsAt(c, p, lo, hi, hi).stats.map((x) => x.id))));
      if (r.stats.some((x) => !explained.has(x.id))) continue;
      const ours = createAffixItem(r.code, { quality: r.quality === Quality.Magic ? 'magic' : 'rare', affixes, defense: r.defense, itemLevel: r.itemLevel, ethereal: r.ethereal });
      // with Enhanced Defense: the top + 1, like Roka's Strong Heavy Boots (7, top 6) and an ethereal rare Helm (28 = 19 × 1.5)
      if (ours.stats.some((x) => x.id === 16)) expect(ours.defense).toBe(r.ethereal ? Math.floor((GD.items[r.code].maxAc! + 1) * 1.5) : GD.items[r.code].maxAc! + 1);
      expect(key(ours), `${r.code} ${r.prefixes} ${r.suffixes}`).toBe(key(r));
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(4);
  });

  test('crafted items: the recipe’s base and mods, up to 4 affixes, rare-only affixes', async () => {
    const { createAffixItem, craftIndex, craftBases, affixRows, describeItem } = await import('../src/core');
    const blood = craftIndex('Blood Gloves');
    expect(craftBases(blood)).toEqual(['vgl', 'xvg', 'uvg']);
    const row = (side: 'prefix' | 'suffix', name: string) => affixRows(side, 'uvg', 'rare').find((r) => GD.affixes[side][r].name === name)!;
    const affixes = [
      { side: 'suffix' as const, row: row('suffix', 'of Alacrity'), values: [20] },
      { side: 'prefix' as const, row: row('prefix', 'Holy'), values: [86] },
      { side: 'suffix' as const, row: row('suffix', 'of Precision'), values: [13] },
      { side: 'suffix' as const, row: row('suffix', 'of Fortune'), values: [19] },
    ];
    const it = createAffixItem('uvg', { quality: 'crafted', affixes, craft: { row: blood, values: [2, 17, 10] } });
    expect(it.quality).toBe(Quality.Crafted);
    expect(describeItem(it).lines.map((l) => l.text)).toEqual(expect.arrayContaining(['Defense: 122', '2% Life stolen per hit', '+17 to Life', '+10% Chance of Crushing Blow', '+86% Enhanced Defense']));
    expect(() => createAffixItem('uar', { quality: 'crafted', affixes, craft: { row: blood, values: [2, 17, 10] } })).toThrow(/can't be crafted from/);
    expect(() => createAffixItem('uvg', { quality: 'crafted', affixes: [...affixes, { side: 'prefix', row: row('prefix', 'Bronze'), values: [15] }], craft: { row: blood, values: [2, 17, 10] } })).toThrow(/at most 4/);
    expect(() => createAffixItem('uvg', { quality: 'crafted', affixes, craft: { row: blood, values: [4, 17, 10] } })).toThrow(/outside/);
    // magic-only affixes (Forbidden: +3 Eldritch Skills) never roll on rares
    const forbidden = GD.affixes.prefix.findIndex((a) => a.name === 'Forbidden');
    expect(affixRows('prefix', 'amu', 'magic')).toContain(forbidden);
    expect(affixRows('prefix', 'amu', 'rare')).not.toContain(forbidden);
    expect(() => createAffixItem('amu', { quality: 'rare', affixes: [{ side: 'prefix', row: forbidden, values: [3] }] })).toThrow(/can't roll/);
    expect(() => createAffixItem('amu', { quality: 'magic', affixes: [{ side: 'prefix', row: forbidden, values: [3] }, { side: 'prefix', row: forbidden - 1, values: [2] }] })).toThrow(/at most 1 prefix/);
  });

  test('trading for a runeword and a crafted item: both land in Received and save like any item', async () => {
    const { TRADE_ID } = await import('../src/state/store');
    const { createRunewordItem, createAffixItem, craftIndex, affixRows } = await import('../src/core');
    const sid = 't/ModernSharedStashSoftCoreV2.d2i';
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    const cta = GD.runewords.find((r) => r.name === 'Call to Arms')!.row;
    const blood = craftIndex('Blood Gloves');
    const holy = affixRows('prefix', 'uvg', 'rare').find((r) => GD.affixes.prefix[r].name === 'Holy')!;
    const gloves = createAffixItem('uvg', { quality: 'crafted', affixes: [{ side: 'prefix', row: holy, values: [90] }], craft: { row: blood, values: [3, 20, 10] } });
    store.tradeSetListing({
      name: 'Call to Arms',
      mode: 'softcore',
      ask: [[{ code: 'r22', qty: 1, name: 'Um Rune' }]],
      items: [
        { kind: 'runeword', id: cta, name: 'Call to Arms (Crystal Sword)', item: createRunewordItem(cta, 'crs') },
        { kind: 'crafted', id: GD.items.uvg.index, name: 'Blood Gloves', item: gloves },
      ],
    });
    store.tradeOffer('r22', 1);
    expect(store.tradeAccept()).toBe(true);
    expect(store.tradeReceived.map((i) => [i.code, i.quality, i.runeword, i.sockets.length])).toEqual([
      ['crs', Quality.Normal, true, 5],
      ['uvg', Quality.Crafted, false, 0],
    ]);
    store.tradeDeliverAll();
    expect(store.tradeReceived.length).toBe(0);
    const all = (roundTrip(modern()) as D2SharedStash).tabs.flatMap((t) => t.items);
    expect(all.some((i) => i.code === 'crs' && i.runeword && i.sockets.map((c) => c.code).join() === 'r11,r08,r23,r24,r27')).toBe(true);
    expect(all.some((i) => i.code === 'uvg' && i.quality === Quality.Crafted)).toBe(true);
  });

  test('skill tab bonuses are stored the way the game does (class × 8 + tab)', async () => {
    const { createAffixItem, describeItem } = await import('../src/core');
    const forbidden = GD.affixes.prefix.findIndex((a) => a.name === 'Forbidden');
    const it = createAffixItem('amu', { quality: 'magic', affixes: [{ side: 'prefix', row: forbidden, values: [3] }] });
    expect(it.stats.find((s) => s.id === 188)?.param).toBe(7 * 8 + 1);
    expect(describeItem(it).lines.map((l) => l.text)).toContain('+3 to Eldritch Skills (Warlock Only)');
  });
});

describe('selling to buyers, and paying with items', () => {
  const sid = 't/ModernSharedStashSoftCoreV2.d2i';
  const listing = (f: string) => fs.readFileSync(`${__dirname}/fixtures/listings/${f}.txt`, 'utf8').split('\n');
  /** Puts an item in the shared stash (through Received, the way a trade would) and returns it as it sits there. */
  const stashItem = async (item: D2Item) => {
    const { TRADE_ID } = await import('../src/state/store');
    const { newUid } = await import('../src/core');
    (store.tradeInbox.doc as { entries: unknown[] }).entries.push({ uid: newUid(), item, addedAt: '', source: 'test', realm: 'rotw', hardcore: false });
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    store.tradeDeliverAll();
    return modern().tabs.flatMap((t) => t.items).find((i) => i.id === item.id)!;
  };
  const setup = async (side: 'buy' | 'sell', f: string) => {
    const { TRADE_ID } = await import('../src/state/store');
    const { readListing } = await import('../src/trade/listing');
    store.settings.tradeEnabled = true;
    store.panes = [{ docId: sid, tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    store.tradeSetSide(side);
    const r = readListing(listing(f), undefined, new Date());
    expect(r.errors, f).toEqual([]);
    return r;
  };

  test('selling an ethereal Andariel’s Visage for the buyer’s Ohm: rolls at least what the listing shows', async () => {
    const { TRADE_OFFER_ID } = await import('../src/state/store');
    const { buildableTemplates, createTemplateItem, rollSlots } = await import('../src/core');
    const r = await setup('sell', 'andariel-they-give');
    expect(r.direction).toBe('sell');
    const id = buildableTemplates('unique').find((t) => t.name === "Andariel's Visage")!.id;
    const key = (code: string) => rollSlots('unique', id).find((s) => s.prop[0] === code)!.key;
    const make = (ed: number, eth: boolean) => createTemplateItem('unique', id, { [key('ac%')]: ed, [key('lifesteal')]: 9, [key('str')]: 29 }, { ethereal: eth });
    const good = await stashItem(make(130, true));
    const weak = await stashItem(make(110, true)); // less Enhanced Defense than the listing's 118
    const plain = await stashItem(make(150, false)); // not ethereal
    expect(store.tradeSetListing({ name: r.item!.name, mode: 'softcore', ask: [r.want!], receive: r.ask })).toBeUndefined();
    const ohm = modern().tabs.flatMap((t) => t.items).filter((i) => i.code === 'r27').reduce((n, i) => n + (i.advancedStackSize ?? 1), 0);
    for (const bad of [weak, plain]) {
      expect(store.move(bad, sid, { docId: TRADE_OFFER_ID, area: 'vault' })).toBe(true);
      expect(store.tradeAskMatch()).toBe(-1);
      expect(store.tradeReturnItem(store.tradeOffered[0])).toBe(true);
    }
    expect(store.move(good, sid, { docId: TRADE_OFFER_ID, area: 'vault' })).toBe(true);
    expect(store.tradeAskMatch()).toBe(0);
    expect(store.tradeAccept()).toBe(true);
    expect(store.tradeReceived.map((i) => i.code)).toEqual(['r27']);
    store.tradeDeliverAll();
    const after = modern().tabs.flatMap((t) => t.items);
    expect(after.some((i) => i.id === good.id)).toBe(false); // sold
    expect(after.filter((i) => i.code === 'r27').reduce((n, i) => n + (i.advancedStackSize ?? 1), 0)).toBe(ohm + 1);
    expect(store.trade.side).toBe('sell'); // stays on Sell for the next one
  });

  test('selling a Ber for 2 Lo + Ohm + Ist, and picking one of a buyer’s options', async () => {
    const r = await setup('sell', 'ber-they-give');
    const { createCompactItem } = await import('../src/core');
    await stashItem(createCompactItem('r30', 105));
    store.tradeSetListing({ name: 'Ber Rune', mode: 'softcore', ask: [r.want!], receive: r.ask });
    store.tradeOffer('r30', 1);
    expect(store.tradeAskMatch()).toBe(0);
    expect(store.tradeAccept()).toBe(true);
    expect(store.tradeReceived.map((i) => i.code).sort()).toEqual(['r24', 'r27', 'r28', 'r28']);
    store.tradeDeliverAll();
    // Beast: Ber, Zod, or Sur + Lo; you choose
    const b = await setup('sell', 'beast-they-give');
    expect(b.ask!.map((o) => o.map((a) => a.code).join('+'))).toEqual(['r30', 'r33', 'r29+r28']);
    store.tradeSetListing({ name: 'Beast', mode: 'softcore', ask: [b.want!], receive: b.ask });
    store.tradePick(2);
    expect(store.trade.pick).toBe(2);
  });

  test('paying for an item with an item: any Harlequin Crest counts for "1 X Harlequin Crest"', async () => {
    const { TRADE_OFFER_ID } = await import('../src/state/store');
    const { buildableTemplates, createTemplateItem, createCompactItem, pickRolls, rollSlots } = await import('../src/core');
    const { readListing } = await import('../src/trade/listing');
    await setup('buy', 'annihilus');
    const r = readListing(['1 X Arachnid Mesh', 'Reign Of The Warlock - Ladder - PC - Softcore', 'Trading For', '1 X Harlequin Crest', 'in 5 minutes'], undefined, new Date());
    expect(r.errors).toEqual([]);
    const shako = buildableTemplates('unique').find((t) => t.name === 'Harlequin Crest')!.id;
    const mesh = buildableTemplates('unique').find((t) => t.name === 'Arachnid Mesh')!.id;
    const offered = await stashItem(createTemplateItem('unique', shako, pickRolls(rollSlots('unique', shako), 'random')));
    await stashItem(createCompactItem('r22', 105));
    store.tradeSetListing({ name: 'Arachnid Mesh', mode: 'softcore', ask: r.ask!, items: [{ kind: 'unique', id: mesh, name: 'Arachnid Mesh', item: createTemplateItem('unique', mesh) }] });
    // the offer box takes items now that the price names one; a rune on top isn't what's asked
    store.tradeOffer('r22', 1);
    expect(store.move(offered, sid, { docId: TRADE_OFFER_ID, area: 'vault' })).toBe(true);
    expect(store.tradeAskMatch()).toBe(-1);
    store.tradeOffer('r22', -1);
    expect(store.tradeAskMatch()).toBe(0);
    expect(store.tradeAccept()).toBe(true);
    expect(store.tradeReceived.map((i) => i.uniqueId)).toEqual([mesh]);
  });

  test('a listing’s direction has to match Buy / Sell, and items can’t be offered for rune-only prices', async () => {
    const { TRADE_OFFER_ID } = await import('../src/state/store');
    const { buildableTemplates, createTemplateItem } = await import('../src/core');
    await setup('buy', 'annihilus');
    const shako = buildableTemplates('unique').find((t) => t.name === 'Harlequin Crest')!.id;
    const it = await stashItem(createTemplateItem('unique', shako));
    store.tradeSetListing({ name: 'Ist', mode: 'softcore', ask: [[{ code: 'r22', qty: 1, name: 'Um Rune' }]], want: [['r24', 1]] });
    expect(store.check(it, sid, { docId: TRADE_OFFER_ID, area: 'vault' }).reason).toMatch(/doesn’t ask for items/);
  });
});
