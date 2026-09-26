import { beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { GD, ItemMode, Quality, canEquip, parseCharacter, parseStash, serializeVerified, type D2Character, type D2Item, type D2SharedStash } from '../src/core';
import type { Platform } from '../src/platform';
import { Store } from '../src/state/store';

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
    writeVault: async (n, t, e) => {
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
    const { collect, catalog, runewordFor, Quality } = await import('../src/core');
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
    const { catalog, collect } = await import('../src/core');
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
    const { canBeEthereal, catalog, collect, slots, Quality } = await import('../src/core');
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
    const { slots, canBeEthereal, catalog, collect, Quality } = await import('../src/core');
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
