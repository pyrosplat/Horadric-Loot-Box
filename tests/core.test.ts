import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  canDrop,
  characterGridItems,
  createVault,
  describeItem,
  itemBytes,
  occupancy,
  parseCharacter,
  parseItemBytes,
  parseStash,
  parseVault,
  placeItem,
  removeItem,
  serializeCharacter,
  serializeStash,
  serializeVault,
  serializeVerified,
  checksum,
  u32,
  ItemMode,
  StorePage,
  withPlacement,
  newUid,
} from '../src/core';

const dir = path.join(__dirname, 'fixtures');
const load = (f: string) => new Uint8Array(fs.readFileSync(path.join(dir, f)));
const chars = fs.readdirSync(dir).filter((f) => f.endsWith('.d2s'));
const stashes = fs.readdirSync(dir).filter((f) => f.endsWith('.d2i'));

describe('round trip', () => {
  test.each(chars)('%s re-serializes byte-for-byte', (f) => {
    const data = load(f);
    const ch = parseCharacter(data, f);
    expect(ch.warnings).toEqual([]);
    expect(Buffer.from(serializeCharacter(ch)).equals(Buffer.from(data))).toBe(true);
    expect(Buffer.from(serializeVerified(ch)).equals(Buffer.from(data))).toBe(true);
  });
  test.each(stashes)('%s re-serializes byte-for-byte', (f) => {
    const data = load(f);
    const st = parseStash(data, f);
    expect(Buffer.from(serializeStash(st)).equals(Buffer.from(data))).toBe(true);
  });
});

describe('Reign of the Warlock', () => {
  test('reads a level 90 Warlock with RotW flag and mercenary', () => {
    const ch = parseCharacter(load('ChaosSC.d2s'));
    expect(ch.version).toBe(105);
    expect(ch.className).toBe('Warlock');
    expect(ch.classId).toBe(7);
    expect(ch.gameVersion).toBe(3);
    expect(ch.level).toBe(90);
    expect(ch.mercItems.length).toBe(3);
  });
  test('reads a fresh Warlock (starter kit)', () => {
    const ch = parseCharacter(load('Warlock_v105.d2s'));
    expect(ch.className).toBe('Warlock');
    expect(ch.items.map((i) => i.code)).toContain('dgr');
  });
  test('modern shared stash exposes advanced + chronicle tabs', () => {
    const st = parseStash(load('ModernSharedStashSoftCoreV2.d2i'), 'ModernSharedStashSoftCoreV2.d2i');
    expect(st.modern).toBe(true);
    expect(st.tabs.map((t) => t.type)).toContain(1);
    expect(st.tabs.map((t) => t.type)).toContain(2);
    const adv = st.tabs.find((t) => t.type === 1)!;
    const names = adv.items.map((i) => describeItem(i).name);
    expect(names).toContain('Western Worldstone Shard');
  });
  test('names RotW uniques, runewords and Warlock skills', () => {
    const ch = parseCharacter(load('ChaosSC.d2s'));
    const names = [...ch.items, ...ch.mercItems].map((i) => describeItem(i).name);
    expect(names).toContain("Mang Song's Lesson");
    expect(names).toContain('Cure'); // RotW runeword on merc helm
    expect(names).toContain('Enigma');
    const staff = ch.items.find((i) => i.code === '6ws')!;
    expect(describeItem(staff).lines.map((l) => l.text)).toContain('-20% to Enemy Fire Resistance');
  });
});

describe('moving items', () => {
  test('position rewrite changes only location bits', () => {
    const ch = parseCharacter(load('Soska.d2s'));
    const inv = characterGridItems(ch, 'inventory');
    const item = inv.find((i) => !i.def?.flags.includes('C')) ?? inv[0];
    const moved = withPlacement(item, { mode: ItemMode.Stored, page: StorePage.Cube, x: 1, y: 2 });
    const reparsed = parseItemBytes(itemBytes(moved), 105);
    expect([reparsed.page, reparsed.x, reparsed.y]).toEqual([StorePage.Cube, 1, 2]);
    expect(reparsed.stats).toEqual(item.stats);
    expect(reparsed.code).toBe(item.code);
    // everything after the position field is identical
    expect(Buffer.from(moved.raw.subarray(7)).equals(Buffer.from(item.raw.subarray(7)))).toBe(true);
  });

  test('moves an item from a character to the shared stash and back', () => {
    const ch = parseCharacter(load('Soska.d2s'), 'Soska.d2s');
    const st = parseStash(load('SharedStashSoftCoreV2.d2i'), 'SharedStashSoftCoreV2.d2i');
    const item = characterGridItems(ch, 'stash')[0];
    const before = ch.items.length;
    const tab = 2;
    const spot = occupancy(st, 'shared', tab).findSpot(item.def!.w, item.def!.h)!;
    expect(spot).not.toBeNull();
    expect(removeItem(ch, item)).toBe(true);
    const placed = placeItem(st, 'shared', tab, item, spot.x, spot.y);
    const chBytes = serializeVerified(ch);
    const stBytes = serializeVerified(st);
    const ch2 = parseCharacter(chBytes);
    const st2 = parseStash(stBytes);
    expect(ch2.items.length).toBe(before - 1);
    expect(u32(chBytes, 12)).toBe(checksum(chBytes));
    expect(u32(chBytes, 8)).toBe(chBytes.length);
    const back = st2.tabs[tab].items.find((i) => i.x === spot.x && i.y === spot.y && i.code === item.code)!;
    expect(back.stats).toEqual(placed.stats);
    // and back into the character's inventory
    removeItem(st2, back);
    const invSpot = occupancy(ch2, 'inventory').findSpot(back.def!.w, back.def!.h)!;
    placeItem(ch2, 'inventory', 0, back, invSpot.x, invSpot.y);
    const ch3 = parseCharacter(serializeVerified(ch2));
    expect(ch3.items.length).toBe(before);
  });

  test('refuses overlaps, read-only tabs and a second Annihilus', () => {
    const ch = parseCharacter(load('ChaosSC.d2s'));
    const st = parseStash(load('SharedStashSoftCoreV2.d2i'));
    const modern = parseStash(load('ModernSharedStashSoftCoreV2.d2i'), 'ModernSharedStashSoftCoreV2.d2i');
    const anni = ch.items.find((i) => describeItem(i).name === 'Annihilus')!;
    const occupied = st.tabs[0].items[0];
    expect(canDrop(st, 'shared', 0, anni, occupied.x, occupied.y).ok).toBe(false);
    const advTab = modern.tabs.findIndex((t) => t.type === 1);
    expect(canDrop(modern, 'shared', advTab, anni, 0, 0).ok).toBe(false);
    const inv = occupancy(ch, 'inventory');
    const free = inv.findSpot(1, 1);
    if (free) expect(canDrop(ch, 'inventory', 0, { ...anni }, free.x, free.y).reason).toMatch(/already has one/);
  });

  test('refuses cross-version moves', () => {
    const v99 = parseCharacter(load('Soska_v99.d2s'));
    const st = parseStash(load('SharedStashSoftCoreV2.d2i'));
    const item = characterGridItems(v99, 'stash')[0];
    expect(canDrop(st, 'shared', 2, item, 0, 5).reason).toMatch(/v99/);
  });

  test('refuses Warlock-only items on a non-RotW character', () => {
    const lod = parseCharacter(load('barbexp_v105.d2s'));
    const st = parseStash(load('ModernSharedStashSoftCoreV2.d2i'), 'ModernSharedStashSoftCoreV2.d2i');
    const shard = st.tabs.find((t) => t.type === 1)!.items.find((i) => i.code === 'xa1')!;
    const spot = occupancy(lod, 'inventory').findSpot(1, 1)!;
    expect(canDrop(lod, 'inventory', 0, shard, spot.x, spot.y).reason).toMatch(/Reign of the Warlock/);
  });
});

describe('vault', () => {
  test('stores exact item bytes and restores them', () => {
    const ch = parseCharacter(load('ChaosSC.d2s'));
    const v = createVault('Test');
    for (const it of ch.items.filter((i) => i.mode === ItemMode.Stored))
      v.entries.push({ uid: newUid(), item: it, addedAt: '2026-09-25', realm: 'rotw' });
    const again = parseVault(serializeVault(v));
    expect(again.entries.length).toBe(v.entries.length);
    again.entries.forEach((e, i) => expect(Buffer.from(itemBytes(e.item)).equals(Buffer.from(itemBytes(v.entries[i].item)))).toBe(true));
  });
});

describe('descriptions', () => {
  test('every fixture item can be described', () => {
    for (const f of chars) {
      const ch = parseCharacter(load(f));
      for (const it of [...ch.items, ...ch.mercItems, ...ch.corpseItems]) expect(describeItem(it).name).toBeTruthy();
    }
    for (const f of stashes) for (const t of parseStash(load(f)).tabs) for (const it of t.items) expect(describeItem(it).name).toBeTruthy();
  });
});

describe('mercenary', () => {
  test('level follows hireling.txt experience (Exp/Lvl × L² × (L+1))', async () => {
    const { mercLevel, mercExpFor } = await import('../src/core');
    expect(mercLevel(110, 0)).toBe(1);
    expect(mercLevel(110, mercExpFor(110, 85))).toBe(85);
    expect(mercLevel(110, mercExpFor(110, 85) - 1)).toBe(84);
    expect(mercLevel(140, 2_000_000_000)).toBe(98);
  });
  test('type, role, difficulty and name come from the header', async () => {
    const { mercInfo, mercExpFor } = await import('../src/core');
    const ch = { merc: { type: 10, nameId: 0, exp: mercExpFor(120, 80), dead: false } } as never;
    expect(mercInfo(ch)).toMatchObject({ className: 'Desert Mercenary', role: 'Holy Freeze', difficulty: 'Nightmare', act: 2, name: 'Hazade', level: 80 });
    const a3 = mercInfo({ merc: { type: 16, nameId: 1, exp: 0, dead: true } } as never)!;
    expect([a3.className, a3.role, a3.dead]).toEqual(['Iron Wolf', 'Cold', true]);
    expect(mercInfo({} as never)).toBeUndefined();
  });
});

describe('item types', () => {
  test('specific types win over general ones', async () => {
    const { itemTypeOf, GD } = await import('../src/core');
    const code = (name: string) => Object.entries(GD.items).find(([, d]) => d.name === name)![0];
    const cases: [string, string][] = [
      ['Jawbone Cap', 'Barbarian Helms'], ['Wolf Head', 'Druid Pelts'], ['Circlet', 'Circlets'], ['Cap', 'Helms'],
      ['Targe', 'Paladin Shields'], ['Preserved Head', 'Necromancer Heads'], ['Buckler', 'Shields'], ['Old Book', 'Grimoires'],
      ['Stag Bow', 'Amazon Bows'], ['Short Bow', 'Bows'], ['Katar', 'Assassin Claws'], ['Eagle Orb', 'Sorceress Orbs'],
      ['Throwing Axe', 'Throwing Axes'], ['Hand Axe', 'Axes'], ['Small Charm', 'Small Charms'], ['Jewel', 'Jewels'],
      ['Full Rejuvenation Potion', 'Potions'], ['Tome of Identify', 'Scrolls & Tomes'], ['Arrows', 'Arrows & Bolts'],
    ];
    for (const [name, type] of cases) expect([name, itemTypeOf(code(name))]).toEqual([name, type]);
    expect(itemTypeOf(Object.entries(GD.items).find(([, d]) => d.type === 'lcha')![0])).toBe('Grand Charms');
  });
});
