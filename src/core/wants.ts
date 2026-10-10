import { GD } from './gamedata';
import { Quality, type D2Item, type ItemStat } from './item';
import { RUNEWORD_ID_OFFSET } from './build';

/**
 * An item a trade asks for by name ("1 X Harlequin Crest", "1 X Beast" in a Berserker Axe), for paying or selling
 * with items. Only what the listing states is checked: any roll counts unless the listing shows one, and then
 * your item needs at least that much.
 */
export type ItemWant =
  | { kind: 'unique' | 'set'; id: number; ethereal?: boolean; atLeast?: ItemStat[] }
  | { kind: 'runeword'; id: number; code?: string; ethereal?: boolean; atLeast?: ItemStat[] }
  | { kind: 'base'; code: string; sockets?: number; ethereal?: boolean }
  /** A magic, rare or crafted item of this base: it needs at least the stats the listing shows (and any it can't show are free). */
  | { kind: 'magic' | 'rare' | 'crafted'; code: string; name: string; sockets?: number; ethereal?: boolean; atLeast: ItemStat[] };

/** One thing a trade asks for or gives: runes, gems and uber items by code, or an item by name. */
export interface WantEntry {
  /** Rune, gem or uber item code; empty for an item. */
  code: string;
  qty: number;
  name: string;
  item?: ItemWant;
  /** Any of these codes, `qty` in all ("3 X Random Minor Key": Terror, Hate or Destruction keys in any mix); `code` is empty. */
  anyOf?: string[];
}

/** The stats that count toward a minimum: the item's own and its runeword's, added up by stat and parameter. */
function totals(item: D2Item): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of [...item.stats, ...(item.runewordStats ?? [])]) out.set(`${s.id}:${s.param}`, (out.get(`${s.id}:${s.param}`) ?? 0) + s.value);
  return out;
}

/** Whether an item is what the want names (and has at least the rolls it shows). */
export function wantMatches(w: ItemWant, item: D2Item): boolean {
  if (w.ethereal && !item.ethereal) return false;
  const enough = (atLeast?: ItemStat[]) => {
    if (!atLeast?.length) return true;
    const t = totals(item);
    return atLeast.every((s) => (t.get(`${s.id}:${s.param}`) ?? 0) >= s.value);
  };
  switch (w.kind) {
    case 'unique':
      return item.quality === Quality.Unique && item.uniqueId === w.id && enough(w.atLeast);
    case 'set':
      return item.quality === Quality.Set && item.setId === w.id && enough(w.atLeast);
    case 'runeword':
      return !!item.runeword && item.runewordId === RUNEWORD_ID_OFFSET + w.id && (!w.code || item.code === w.code) && enough(w.atLeast);
    case 'magic':
    case 'rare':
    case 'crafted': {
      const q = { magic: Quality.Magic, rare: Quality.Rare, crafted: Quality.Crafted }[w.kind];
      return item.quality === q && !item.runeword && item.code === w.code && (w.sockets === undefined || item.socketCount >= w.sockets) && enough(w.atLeast);
    }
    case 'base':
      return item.code === w.code && !item.runeword && (item.quality === Quality.Normal || item.quality === Quality.Superior) && (w.sockets === undefined || item.socketCount === w.sockets);
  }
}

/** A short description of a want: "Harlequin Crest", "Beast (Berserker Axe)", "Ethereal Thresher (4 sockets)". */
export function wantName(w: ItemWant): string {
  const eth = w.ethereal ? 'Ethereal ' : '';
  switch (w.kind) {
    case 'unique':
      return eth + (GD.uniques[w.id]?.name ?? 'Unique');
    case 'set':
      return eth + (GD.setItems[w.id]?.name ?? 'Set item');
    case 'runeword': {
      const rw = GD.runewords.find((r) => r.row === w.id)?.name ?? 'Runeword';
      return w.code ? `${rw} (${eth}${GD.items[w.code]?.name ?? w.code})` : eth + rw;
    }
    case 'magic':
    case 'rare':
    case 'crafted':
      return eth + w.name;
    case 'base':
      return `${eth}${GD.items[w.code]?.name ?? w.code}${w.sockets ? ` (${w.sockets} sockets)` : ''}`;
  }
}

/**
 * Whether the offered items are exactly one price option: the same runes, gems and uber items in the same counts,
 * and one matching item for each item it names, with nothing left over.
 */
export function offerMatches(option: WantEntry[], offered: D2Item[]): boolean {
  const itemWants = option.flatMap((o) => (o.item ? Array.from({ length: o.qty }, () => o.item!) : []));
  const stack = option.filter((o) => !o.item && !o.anyOf);
  const anys = option.filter((o) => o.anyOf);
  const anyQty = anys.reduce((n, o) => n + o.qty, 0);
  const pool = new Set(anys.flatMap((o) => o.anyOf!));
  const byCode = new Map<string, number>();
  const rest: D2Item[] = [];
  let anyCount = 0;
  for (const it of offered) {
    if (stack.some((s) => s.code === it.code)) byCode.set(it.code, (byCode.get(it.code) ?? 0) + 1);
    else if (pool.has(it.code)) anyCount++;
    else rest.push(it);
  }
  if (anyCount !== anyQty) return false;
  if (stack.some((s) => byCode.get(s.code) !== s.qty) || byCode.size !== stack.length) return false;
  if (rest.length !== itemWants.length) return false;
  // one offered item for each wanted one
  const used = new Set<number>();
  const assign = (i: number): boolean => {
    if (i === itemWants.length) return true;
    for (let j = 0; j < rest.length; j++) {
      if (used.has(j) || !wantMatches(itemWants[i], rest[j])) continue;
      used.add(j);
      if (assign(i + 1)) return true;
      used.delete(j);
    }
    return false;
  };
  return assign(0);
}
