import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { ArtIndex, norm, parseAssetMap, type ArtInfo } from '../src/art';
import { GD, Quality, arrangeStackables, parseStash, STACKABLE_SLOTS, STACKABLES_COLS, STACKABLES_ROWS, type D2Item } from '../src/core';
import { socketLayout } from '../src/ui/ItemArt';

const item = (code: string, extra: Partial<D2Item> = {}): D2Item => ({ code, def: GD.items[code], quality: Quality.Normal, sockets: [], socketCount: 0, ...extra }) as D2Item;

function index(sprites: string[], extra: Partial<ArtInfo> = {}) {
  return new ArtIndex(
    {
      kind: 'folder',
      path: '/x',
      sprites,
      items_json: '[\n  { "hax": { "asset": "axe/hand_axe" } },\n  { "rin": { "asset": "ring/ring" } },\n  { "r01": { "asset": "rune/el_rune" } },\n  { "cap": { "asset": "helmet/cap" } },\n]',
      ...extra,
    },
    (k) => `hlbart://localhost/${encodeURIComponent(k)}`,
  );
}

describe('asset maps', () => {
  test('reads the array-of-objects format, with trailing commas and a BOM', () => {
    const m = parseAssetMap('﻿[ { "hax": { "asset": "axe/hand_axe" } }, { "axe": { "asset": "axe/axe" } }, ]');
    expect(m.get('hax')).toBe('axe/hand_axe');
    expect(m.get('axe')).toBe('axe/axe');
  });
  test('reads plain objects and other value keys', () => {
    const m = parseAssetMap('{ "harlequin_crest": { "normal": "helmet/harlequin_crest" }, "x": "misc/x" }');
    expect(m.get('harlequin_crest')).toBe('helmet/harlequin_crest');
    expect(m.get('x')).toBe('misc/x');
    expect(parseAssetMap('not json').size).toBe(0);
  });
  test('normalises names like the asset files', () => {
    expect(norm("Harlequin Crest")).toBe('harlequin_crest');
    expect(norm("Bul-Kathos' Children")).toBe('bul_kathos_children');
  });
});

describe('resolving an item to a sprite', () => {
  test('base items use items.json plus the weapon/armor/misc folder', () => {
    const idx = index(['weapon/axe/hand_axe', 'misc/rune/el_rune', 'armor/helmet/cap']);
    expect(idx.keyFor(item('hax'))).toBe('weapon/axe/hand_axe');
    expect(idx.keyFor(item('r01'))).toBe('misc/rune/el_rune');
    expect(idx.srcFor(item('cap'))).toBe('hlbart://localhost/armor%2Fhelmet%2Fcap');
    expect(idx.keyFor(item('axe'))).toBeUndefined();
  });

  test('uniques prefer their own picture, found via uniques.json or by name', () => {
    const shakoId = Object.entries(GD.uniques).find(([, u]) => u.name === 'Harlequin Crest')![0];
    const shako = item('uap', { quality: Quality.Unique, uniqueId: Number(shakoId) });
    const viaJson = index(['armor/helmet/cap', 'armor/helmet/harlequin_crest'], { uniques_json: '[{"harlequin_crest": {"asset": "helmet/harlequin_crest"}}]' });
    expect(viaJson.keyFor(shako)).toBe('armor/helmet/harlequin_crest');
    const byName = index(['armor/helmet/shako', 'armor/unique/harlequin_crest'], { items_json: '[{"uap": {"asset": "helmet/shako"}}]' });
    expect(byName.keyFor(shako)).toBe('armor/unique/harlequin_crest');
    const fallback = index(['armor/helmet/shako'], { items_json: '[{"uap": {"asset": "helmet/shako"}}]' });
    expect(fallback.keyFor(shako)).toBe('armor/helmet/shako');
  });

  test('jewelry picks the variant from its gfx index', () => {
    const idx = index(['misc/ring/ring', 'misc/ring/ring3']);
    expect(idx.keyFor(item('rin', { gfx: 2 }))).toBe('misc/ring/ring3');
    expect(idx.keyFor(item('rin', { gfx: 4 }))).toBe('misc/ring/ring');
  });

  test('unlisted storages wait for probing, then resolve', () => {
    const idx = index([]);
    const axe = item('hax');
    expect(idx.keyFor(axe)).toBeUndefined();
    const keys = idx.unprobed(axe);
    expect(keys).toContain('weapon/axe/hand_axe');
    keys.forEach((k) => idx.probed.set(k, k === 'weapon/axe/hand_axe'));
    idx.resetCache();
    expect(idx.keyFor(axe)).toBe('weapon/axe/hand_axe');
  });
});

describe('stackables board', () => {
  test('every slot is a real stackable item and no two slots overlap', () => {
    const cells = new Set<string>();
    for (const s of STACKABLE_SLOTS) {
      expect(GD.items[s.code], s.code).toBeDefined();
      expect(s.x).toBeLessThan(STACKABLES_COLS);
      for (let dy = 0; dy < s.h; dy++) {
        const k = `${s.x},${s.y + dy}`;
        expect(cells.has(k), k).toBe(false);
        cells.add(k);
      }
    }
    expect(STACKABLES_ROWS).toBe(10);
    expect(new Set(STACKABLE_SLOTS.map((s) => s.code)).size).toBe(STACKABLE_SLOTS.length);
  });

  test('runes fill the first rows in order and gems follow', () => {
    const at = (code: string) => STACKABLE_SLOTS.find((s) => s.code === code)!;
    expect(at('r01')).toMatchObject({ x: 0, y: 0 });
    expect(at('r30')).toMatchObject({ x: 9, y: 2 });
    expect(at('r33')).toMatchObject({ x: 2, y: 3 });
    expect(at('gcv')).toMatchObject({ x: 3, y: 3 });
    expect(at('rvl')).toMatchObject({ x: 9, y: 6 });
    expect(at('pk1')).toMatchObject({ x: 0, y: 7, h: 2 });
  });

  test('covers every item the game marks as advanced-stash stackable', () => {
    const board = new Set(STACKABLE_SLOTS.map((s) => s.code));
    const misc = fs.readFileSync('vendor/d2r-3.3/misc.txt', 'utf8').split(/\r?\n/);
    const head = misc[0].split('\t');
    const ci = head.indexOf('code'), ai = head.indexOf('AdvancedStashStackable');
    const flagged = misc.slice(1).map((l) => l.split('\t')).filter((r) => r[ai] === '1').map((r) => r[ci]);
    expect(flagged.length).toBeGreaterThan(80);
    expect(flagged.filter((c) => !board.has(c))).toEqual([]);
  });

  test('arranges a real RotW stackables tab', () => {
    const stash = parseStash(new Uint8Array(fs.readFileSync('tests/fixtures/ModernSharedStashSoftCoreV2.d2i')), 'ModernSharedStashSoftCoreV2.d2i');
    const tab = stash.tabs.find((t) => t.type === 1)!;
    const { bySlot, extra } = arrangeStackables(tab.items);
    expect(extra).toEqual([]);
    expect(bySlot.get('r22')?.count).toBe(4);
    expect(bySlot.get('toa')?.count).toBe(5);
    expect(bySlot.get('xa1')?.count).toBe(1);
  });
});

describe('socket placement', () => {
  test('returns one point per socket, inside the box', () => {
    for (const [w, h] of [[1, 3], [2, 2], [2, 3], [2, 4], [1, 1]])
      for (let n = 1; n <= 6; n++) {
        const pts = socketLayout(n, w, h);
        expect(pts).toHaveLength(n);
        for (const p of pts) expect(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1).toBe(true);
        expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(n);
      }
  });
});

describe('belt capacity', () => {
  test('matches belts.txt: sash 8, belt 12, plated and exceptional belts 16, none 4', async () => {
    const { beltSlots } = await import('../src/ui/Equipment');
    expect(beltSlots(undefined)).toBe(4);
    expect(beltSlots(item('lbl'))).toBe(8);
    expect(beltSlots(item('vbl'))).toBe(8);
    expect(beltSlots(item('mbl'))).toBe(12);
    expect(beltSlots(item('tbl'))).toBe(12);
    expect(beltSlots(item('hbl'))).toBe(16);
    expect(beltSlots(item('uhc'))).toBe(16);
  });
});
