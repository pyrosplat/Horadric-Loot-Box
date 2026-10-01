import { StashTabType, type D2SharedStash } from './d2i';
import { ItemMode, StorePage, withNewId, withPlacement, withStackSize, type D2Item } from './item';

/**
 * The Reign of the Warlock stackables stash tab, laid out the way the game draws it: one stack slot per item type,
 * split over three boards like the in-game Gems, Materials and Runes tabs.
 *
 * - Gems: a column per gem (Diamond, Emerald, Ruby, Topaz, Amethyst, Sapphire, Skull), Chipped at the top to
 *   Perfect at the bottom.
 * - Materials: on the left the Pandemonium keys (two cells tall), the uber organs and the rejuvenation potions; on
 *   the right the Uber Ancients' summoning materials (two cells tall), the Worldstone Shards, then the Token of
 *   Absolution and the essences.
 * - Runes: El to Zod, nine to a row.
 */
export type StackBoard = 'gems' | 'materials' | 'runes';

export interface StackSlot {
  code: string;
  board: StackBoard;
  x: number;
  y: number;
  h: 1 | 2;
  group: 'rune' | 'gem' | 'potion' | 'key' | 'uber' | 'organ' | 'token' | 'essence' | 'shard';
}

/** Tab order and labels, as in the game. */
export const STACK_BOARDS: { id: StackBoard; label: string }[] = [
  { id: 'gems', label: 'Gems' },
  { id: 'materials', label: 'Materials' },
  { id: 'runes', label: 'Runes' },
];

const RUNES = Array.from({ length: 33 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);
const RUNE_COLS = 9;
// one column per gem, [chipped, flawed, normal, flawless, perfect] top to bottom
const GEM_COLUMNS = [
  ['gcw', 'gfw', 'gsw', 'glw', 'gpw'], // diamond
  ['gcg', 'gfg', 'gsg', 'glg', 'gpg'], // emerald
  ['gcr', 'gfr', 'gsr', 'glr', 'gpr'], // ruby
  ['gcy', 'gfy', 'gsy', 'gly', 'gpy'], // topaz
  ['gcv', 'gfv', 'gsv', 'gzv', 'gpv'], // amethyst
  ['gcb', 'gfb', 'gsb', 'glb', 'gpb'], // sapphire
  ['skc', 'skf', 'sku', 'skl', 'skz'], // skull
];

function build(): StackSlot[] {
  const slots: StackSlot[] = [];
  RUNES.forEach((code, i) => slots.push({ code, board: 'runes', x: i % RUNE_COLS, y: Math.floor(i / RUNE_COLS), h: 1, group: 'rune' }));
  GEM_COLUMNS.forEach((col, x) => col.forEach((code, y) => slots.push({ code, board: 'gems', x, y, h: 1, group: 'gem' })));
  const m = (code: string, x: number, y: number, group: StackSlot['group'], h: 1 | 2 = 1) => slots.push({ code, board: 'materials', x, y, h, group });
  // left: keys, organs, rejuvenation potions
  ['pk1', 'pk2', 'pk3'].forEach((code, x) => m(code, x, 0, 'key', 2));
  ['dhn', 'bey', 'mbr'].forEach((code, x) => m(code, x, 2, 'organ'));
  ['rvs', 'rvl'].forEach((code, x) => m(code, x, 3, 'potion'));
  // right (after a gap column): uber ancient materials, worldstone shards, token and essences
  ['ua1', 'ua2', 'ua3', 'ua4', 'ua5'].forEach((code, n) => m(code, 4 + n, 0, 'uber', 2));
  ['xa1', 'xa2', 'xa3', 'xa4', 'xa5'].forEach((code, n) => m(code, 4 + n, 2, 'shard'));
  m('toa', 4, 3, 'token');
  ['tes', 'ceh', 'bet', 'fed'].forEach((code, n) => m(code, 5 + n, 3, 'essence'));
  return slots;
}

export const STACKABLE_SLOTS: StackSlot[] = build();
export const STACKABLE_CODES: string[] = STACKABLE_SLOTS.map((s) => s.code);
/** Columns and rows of each board. */
export const BOARD_SIZE: Record<StackBoard, { cols: number; rows: number }> = Object.fromEntries(
  STACK_BOARDS.map(({ id }) => {
    const on = STACKABLE_SLOTS.filter((s) => s.board === id);
    return [id, { cols: Math.max(...on.map((s) => s.x)) + 1, rows: Math.max(...on.map((s) => s.y + s.h)) }];
  }),
) as Record<StackBoard, { cols: number; rows: number }>;

/** Which board an item's stack is on (unknown stackables are shown with the materials). */
export const boardOf = (code: string): StackBoard => STACKABLE_SLOTS.find((s) => s.code === code)?.board ?? 'materials';

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
  if (!t || t.type !== StashTabType.Advanced) return { ok: false, reason: 'Not a Gems, Materials or Runes tab.' };
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
