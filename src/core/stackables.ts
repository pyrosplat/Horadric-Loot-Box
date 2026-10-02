import { StashTabType, type D2SharedStash } from './d2i';
import { ItemMode, StorePage, withNewId, withPlacement, withStackSize, type D2Item } from './item';

/**
 * The Reign of the Warlock stackables stash tab on one board, ten columns wide, with one slot per stackable item
 * type: runes El to Zod, then gems by type (Amethyst, Diamond, Emerald, Ruby, Sapphire, Topaz, Skull) from Chipped
 * to Perfect, the two rejuvenation potions, the Pandemonium keys and the Uber Ancients' summoning materials (both
 * two cells tall), the uber organs, the Token of Absolution, the essences and the Worldstone Shards.
 *
 * (The game splits these over Gems, Materials and Runes tabs; one board is quicker to look over.)
 */
export const STACKABLES_COLS = 10;
/** The tab's name in the app. */
export const STACKABLES_LABEL = 'Stackables';

export interface StackSlot {
  code: string;
  x: number;
  y: number;
  h: 1 | 2;
  group: 'rune' | 'gem' | 'potion' | 'key' | 'uber' | 'organ' | 'token' | 'essence' | 'shard';
}

const RUNES = Array.from({ length: 33 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);
// [chipped, flawed, normal, flawless, perfect]
const GEMS = [
  ['gcv', 'gfv', 'gsv', 'gzv', 'gpv'], // amethyst
  ['gcw', 'gfw', 'gsw', 'glw', 'gpw'], // diamond
  ['gcg', 'gfg', 'gsg', 'glg', 'gpg'], // emerald
  ['gcr', 'gfr', 'gsr', 'glr', 'gpr'], // ruby
  ['gcb', 'gfb', 'gsb', 'glb', 'gpb'], // sapphire
  ['gcy', 'gfy', 'gsy', 'gly', 'gpy'], // topaz
  ['skc', 'skf', 'sku', 'skl', 'skz'], // skull
].flat();

function build(): StackSlot[] {
  const slots: StackSlot[] = [];
  let i = 0;
  const flow = (codes: string[], group: StackSlot['group']) => {
    for (const code of codes) {
      slots.push({ code, x: i % STACKABLES_COLS, y: Math.floor(i / STACKABLES_COLS), h: 1, group });
      i++;
    }
  };
  flow(RUNES, 'rune');
  flow(GEMS, 'gem');
  flow(['rvs', 'rvl'], 'potion');
  // then a tall row: keys and uber ancient materials, with the organs and the token beside them
  const tallRow = Math.ceil(i / STACKABLES_COLS);
  ['pk1', 'pk2', 'pk3'].forEach((code, n) => slots.push({ code, x: n, y: tallRow, h: 2, group: 'key' }));
  ['ua1', 'ua2', 'ua3', 'ua4', 'ua5'].forEach((code, n) => slots.push({ code, x: 3 + n, y: tallRow, h: 2, group: 'uber' }));
  slots.push({ code: 'dhn', x: 8, y: tallRow, h: 1, group: 'organ' });
  slots.push({ code: 'bey', x: 9, y: tallRow, h: 1, group: 'organ' });
  slots.push({ code: 'mbr', x: 8, y: tallRow + 1, h: 1, group: 'organ' });
  slots.push({ code: 'toa', x: 9, y: tallRow + 1, h: 1, group: 'token' });
  i = (tallRow + 2) * STACKABLES_COLS;
  flow(['tes', 'ceh', 'bet', 'fed'], 'essence');
  flow(['xa1', 'xa2', 'xa3', 'xa4', 'xa5'], 'shard');
  return slots;
}

export const STACKABLE_SLOTS: StackSlot[] = build();
export const STACKABLE_CODES: string[] = STACKABLE_SLOTS.map((s) => s.code);
export const STACKABLES_ROWS = Math.max(...STACKABLE_SLOTS.map((s) => s.y + s.h));

export function stackCount(item: D2Item): number {
  return item.advancedStackSize ?? item.quantity ?? 1;
}

/**
 * Matches the tab's items to board slots. Items of the same code are summed; anything the board doesn't know
 * (a future patch's new stackable) is returned in `extra` so it is still shown.
 */
export function arrangeStackables(items: D2Item[]): { bySlot: Map<string, { items: D2Item[]; count: number }>; extra: D2Item[] } {
  const known = new Set(STACKABLE_CODES);
  const bySlot = new Map<string, { items: D2Item[]; count: number }>();
  const extra: D2Item[] = [];
  for (const it of items) {
    if (!known.has(it.code)) {
      extra.push(it);
      continue;
    }
    const e = bySlot.get(it.code) ?? { items: [], count: 0 };
    e.items.push(it);
    e.count += stackCount(it);
    bySlot.set(it.code, e);
  }
  return { bySlot, extra };
}

/** The game caps each stackables slot at 99. */
export const STACK_MAX = 99;

export function isBoardStackable(item: D2Item): boolean {
  return STACKABLE_CODES.includes(item.code);
}

export interface StackCheck {
  ok: boolean;
  reason?: string;
}

/** Can `item` (a single item, or a stack from another Stackables tab) be added to the stackables tab? */
export function canStack(stash: D2SharedStash, tab: number, item: D2Item): StackCheck {
  const t = stash.tabs[tab];
  if (!t || t.type !== StashTabType.Advanced) return { ok: false, reason: 'Not a Stackables tab.' };
  if (item.saveVersion !== t.version) return { ok: false, reason: `Item is from a v${item.saveVersion} save; this stash is v${t.version}.` };
  if (!isBoardStackable(item)) return { ok: false, reason: 'Only runes, gems, rejuvenation potions, keys, uber parts, essences, tokens and shards stack here.' };
  if (item.advBit === undefined || item.sockets.length) return { ok: false, reason: "This item can't be stacked." };
  const have = t.items.filter((i) => i.code === item.code).reduce((n, i) => n + stackCount(i), 0);
  if (have + stackCount(item) > STACK_MAX) return { ok: false, reason: `That stack is full (${STACK_MAX} max).` };
  return { ok: true };
}

/** Adds the item to its stack (creating the stack if needed). Mutates the stash; returns the stack item. */
export function addToStack(stash: D2SharedStash, tab: number, item: D2Item): D2Item {
  const chk = canStack(stash, tab, item);
  if (!chk.ok) throw new Error(chk.reason);
  const items = stash.tabs[tab].items;
  const i = items.findIndex((x) => x.code === item.code);
  if (i >= 0) {
    const merged = withStackSize(items[i], stackCount(items[i]) + stackCount(item));
    items[i] = merged;
    return merged;
  }
  const placed = withStackSize(withPlacement(item, { mode: ItemMode.Stored, page: StorePage.Stash, x: 0, y: 0, bodyLoc: 0 }), stackCount(item));
  items.push(placed);
  return placed;
}

/**
 * Takes one item off a stack: the stack shrinks by one (or disappears), and a plain single item is returned
 * for placing elsewhere. Mutates the stash.
 */
export function takeFromStack(stash: D2SharedStash, stackItem: D2Item): D2Item {
  for (const t of stash.tabs) {
    const i = t.items.indexOf(stackItem);
    if (i < 0) continue;
    const n = stackCount(stackItem);
    const plain = withStackSize(stackItem, undefined);
    // the stack keeps its id; a split-off copy of a non-compact item gets its own
    const single = n > 1 ? withNewId(plain) : plain;
    if (n > 1) t.items[i] = withStackSize(stackItem, n - 1);
    else t.items.splice(i, 1);
    return single;
  }
  throw new Error('Stack not found');
}

/** True when the item lives in a Stackables tab of this stash. */
export function inStackablesTab(stash: D2SharedStash, item: D2Item): boolean {
  return stash.tabs.some((t) => t.type === StashTabType.Advanced && t.items.includes(item));
}
