import type { D2Character } from './d2s';
import { StashTabType, type D2SharedStash } from './d2i';
import { GD } from './gamedata';
import { ItemMode, Quality, StorePage, itemSize, withPlacement, type D2Item } from './item';

export type GridKind = 'inventory' | 'stash' | 'cube' | 'shared';

export const GRID_SIZE: Record<GridKind, { w: number; h: number }> = {
  inventory: { w: 10, h: 4 },
  stash: { w: 10, h: 10 },
  cube: { w: 3, h: 4 },
  shared: { w: 10, h: 10 },
};

const PAGE_FOR: Record<Exclude<GridKind, 'shared'>, StorePage> = {
  inventory: StorePage.Inventory,
  stash: StorePage.Stash,
  cube: StorePage.Cube,
};

/** Items of a character that live in a given grid. */
export function characterGridItems(ch: D2Character, grid: Exclude<GridKind, 'shared'>): D2Item[] {
  const page = PAGE_FOR[grid];
  return ch.items.filter((i) => i.mode === ItemMode.Stored && i.page === page);
}

export function characterEquipped(ch: D2Character): D2Item[] {
  return ch.items.filter((i) => i.mode === ItemMode.Equipped);
}

export function characterBelt(ch: D2Character): D2Item[] {
  return ch.items.filter((i) => i.mode === ItemMode.Belt);
}

export function tabIsEditable(stash: D2SharedStash, tabIndex: number): boolean {
  const tab = stash.tabs[tabIndex];
  return !!tab && tab.type === StashTabType.Normal;
}

export class Occupancy {
  cells: (D2Item | null)[];
  constructor(readonly w: number, readonly h: number, items: D2Item[] = []) {
    this.cells = new Array(w * h).fill(null);
    for (const it of items) this.mark(it, it.x, it.y);
  }
  private mark(item: D2Item, x: number, y: number) {
    const { w, h } = itemSize(item);
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx, cy = y + dy;
        if (cx < this.w && cy < this.h) this.cells[cy * this.w + cx] = item;
      }
  }
  fits(w: number, h: number, x: number, y: number, ignore?: D2Item): boolean {
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) {
        const c = this.cells[(y + dy) * this.w + x + dx];
        if (c && c !== ignore) return false;
      }
    return true;
  }
  /** First free spot scanning column-major (the way the game auto-places). */
  findSpot(w: number, h: number): { x: number; y: number } | null {
    for (let x = 0; x + w <= this.w; x++) for (let y = 0; y + h <= this.h; y++) if (this.fits(w, h, x, y)) return { x, y };
    return null;
  }
  add(item: D2Item) {
    this.mark(item, item.x, item.y);
  }
}

export function gridItems(doc: D2Character | D2SharedStash, grid: GridKind, tab = 0): D2Item[] {
  if (doc.kind === 'character') {
    if (grid === 'shared') throw new Error('Characters have no shared tabs');
    return characterGridItems(doc, grid);
  }
  return doc.tabs[tab]?.items ?? [];
}

/**
 * Grid dimensions: the vanilla size, grown to fit any items that sit outside it (e.g. saves from stash-expanding mods),
 * so nothing is ever hidden or overlapped.
 */
export function gridDims(doc: D2Character | D2SharedStash, grid: GridKind, tab = 0): { w: number; h: number } {
  let { w, h } = GRID_SIZE[grid];
  for (const it of gridItems(doc, grid, tab)) {
    const s = itemSize(it);
    w = Math.max(w, it.x + s.w);
    h = Math.max(h, it.y + s.h);
  }
  return { w: Math.min(w, 16), h: Math.min(h, 16) };
}

export function occupancy(doc: D2Character | D2SharedStash, grid: GridKind, tab = 0): Occupancy {
  const { w, h } = gridDims(doc, grid, tab);
  return new Occupancy(w, h, gridItems(doc, grid, tab));
}

/** "Carry one" uniques (Annihilus, Torch, Gheed's, Sunder charms): group id, or undefined. */
export function carryOneGroup(item: D2Item): number | undefined {
  if (item.quality !== Quality.Unique || item.uniqueId === undefined) return undefined;
  return GD.uniques[item.uniqueId]?.carry1;
}

export interface DropCheck {
  ok: boolean;
  reason?: string;
}

/** Validates that `item` can be dropped into a container at (x, y). */
/** Rules that apply wherever an item goes on a character or stash: save version, realm, carry-one, expansion. */
export function commonChecks(doc: D2Character | D2SharedStash, item: D2Item, ignore?: D2Item, tab = 0): DropCheck {
  const version = doc.kind === 'character' ? doc.version : doc.tabs[tab]?.version;
  if (version !== item.saveVersion)
    return { ok: false, reason: `Item is from a v${item.saveVersion} save; this file is v${version}. Items only move between saves of the same version.` };
  if (item.mode === ItemMode.Socketed) return { ok: false, reason: 'Socketed items move with their parent.' };
  if (doc.kind === 'stash' && !doc.modern && isRotwOnly(item))
    return { ok: false, reason: 'Reign of the Warlock items belong in the RotW (Modern) shared stash.' };
  if (doc.kind === 'character') {
    const group = carryOneGroup(item);
    if (group !== undefined) {
      const clash = [...doc.items, ...doc.mercItems].find((i) => i !== ignore && i !== item && carryOneGroup(i) === group);
      if (clash) return { ok: false, reason: `${doc.name} already has one of these (the game only allows carrying one).` };
    }
    if (doc.expansion === false && item.def && GD.types[item.def.type]?.all.some((t) => ['jewl', 'char'].includes(t)))
      return { ok: false, reason: 'Classic characters cannot hold expansion items.' };
    if (doc.gameVersion < 3 && isRotwOnly(item)) return { ok: false, reason: 'Reign of the Warlock items need a RotW character.' };
  }
  return { ok: true };
}

/** Validates that `item` can be dropped into a container at (x, y). */
export function canDrop(
  doc: D2Character | D2SharedStash,
  grid: GridKind,
  tab: number,
  item: D2Item,
  x: number,
  y: number,
  ignore?: D2Item,
): DropCheck {
  if (doc.kind === 'stash' && !tabIsEditable(doc, tab)) return { ok: false, reason: 'Drop runes, gems and other stackables onto the Stackables board; the Chronicle tab holds no items.' };
  const common = commonChecks(doc, item, ignore, tab);
  if (!common.ok) return common;
  const { w, h } = itemSize(item);
  if (!occupancy(doc, grid, tab).fits(w, h, x, y, ignore)) return { ok: false, reason: 'Not enough room there.' };
  return { ok: true };
}

/** Items introduced with RotW (Warlock gear) — cannot be placed on non-RotW characters. */
export function isRotwOnly(item: D2Item): boolean {
  if (ROTW_CODES.has(item.code)) return true;
  const t = item.def ? GD.types[item.def.type] : undefined;
  return !!t && (t.cls === 'war' || t.all.includes('grim'));
}

/** Base item codes that do not exist in the pre-RotW (v99) item tables. */
export const ROTW_CODES = new Set(
  'cjw cs2 ua1 ua2 ua3 ua4 ua5 um1 um2 um3 um4 um5 um6 wa1 wa2 wa3 wa4 wa5 wa6 wa7 wa8 wa9 waa wab wac wad wae waf xa1 xa2 xa3 xa4 xa5'.split(' '),
);

/** Places a (detached) item into a container, returning the stored copy. Mutates the document. */
export function placeItem(doc: D2Character | D2SharedStash, grid: GridKind, tab: number, item: D2Item, x: number, y: number): D2Item {
  const check = canDrop(doc, grid, tab, item, x, y);
  if (!check.ok) throw new Error(check.reason);
  const page = grid === 'shared' ? StorePage.Stash : PAGE_FOR[grid];
  const placed = withPlacement(item, { mode: ItemMode.Stored, page, x, y, bodyLoc: 0 });
  if (doc.kind === 'character') doc.items.push(placed);
  else doc.tabs[tab].items.push(placed);
  return placed;
}

/** Removes an item (by identity) from a document. Returns true if found. */
export function removeItem(doc: D2Character | D2SharedStash, item: D2Item): boolean {
  const lists = doc.kind === 'character' ? [doc.items, doc.mercItems] : doc.tabs.map((t) => t.items);
  for (const list of lists) {
    const i = list.indexOf(item);
    if (i >= 0) {
      list.splice(i, 1);
      return true;
    }
  }
  return false;
}
