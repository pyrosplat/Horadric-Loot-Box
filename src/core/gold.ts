import { BitWriter, concatBytes, setU32 } from './bits';
import type { D2Character } from './d2s';
import { StashTabType, type D2SharedStash } from './d2i';
import { statDef } from './gamedata';

/** The personal stash and every shared stash tab hold up to 2,500,000 gold. */
export const STASH_GOLD_CAP = 2_500_000;
/** A character carries up to 10,000 gold per level. */
export const inventoryGoldCap = (ch: D2Character) => ch.level * 10_000;

const GOLD = 14;
const GOLD_BANK = 15;

/**
 * Sets the character's inventory gold ('gold') or personal-stash gold ('goldbank') by re-encoding the stats
 * section. Every other stat keeps its value and order; a zero amount is left out, the way the game saves it.
 */
export function setCharacterGold(ch: D2Character, which: 'gold' | 'goldbank', value: number) {
  const cap = which === 'gold' ? inventoryGoldCap(ch) : STASH_GOLD_CAP;
  if (!Number.isInteger(value) || value < 0) throw new Error('Gold must be a whole number of 0 or more.');
  if (value > cap) throw new Error(`${which === 'gold' ? 'Inventory' : 'The stash'} can hold at most ${cap.toLocaleString()} gold.`);
  const id = which === 'gold' ? GOLD : GOLD_BANK;
  const list = ch.statList.filter((s) => s.id !== id);
  if (value > 0) {
    const at = list.findIndex((s) => s.id > id);
    list.splice(at < 0 ? list.length : at, 0, { id, param: 0, value });
  }
  const w = new BitWriter(256);
  for (const s of list) {
    const def = statDef(s.id);
    w.writeBits(s.id, 9);
    if (def.csvParam) w.writeBits(s.param, def.csvParam);
    const v = s.value < 0 ? s.value + 2 ** def.csvBits : s.value;
    w.writeBits(v, def.csvBits);
  }
  w.writeBits(0x1ff, 9);
  w.alignToByte();
  const { start, end } = ch.statsAt;
  const head = concatBytes([ch.head.subarray(0, start + 2), w.toBytes(), ch.head.subarray(end)]);
  ch.head = head;
  ch.statsAt = { start, end: start + 2 + w.byteLength };
  ch.statList = list;
  ch.stats = { ...ch.stats, [which]: value };
  if (!value) delete ch.stats[which];
}

/** Sets the gold held by one shared stash tab (a field of the tab header). */
export function setTabGold(stash: D2SharedStash, tab: number, value: number) {
  const t = stash.tabs[tab];
  if (!t) throw new Error('No such stash tab');
  if (!Number.isInteger(value) || value < 0) throw new Error('Gold must be a whole number of 0 or more.');
  if (value > STASH_GOLD_CAP) throw new Error(`A shared stash tab holds at most ${STASH_GOLD_CAP.toLocaleString()} gold.`);
  const header = t.header.slice();
  setU32(header, 12, value);
  t.header = header;
  t.gold = value;
}

/**
 * Reign of the Warlock keeps a shared stash's gold as one pool across its shared pages: each page holds up to
 * 2,500,000 and the game fills them in order (page 1 first). These read and write that pool.
 */
const sharedPages = (stash: D2SharedStash) => stash.tabs.filter((t) => t.type === StashTabType.Normal);

/** Total gold over the shared pages. */
export const stashGold = (stash: D2SharedStash) => sharedPages(stash).reduce((n, t) => n + t.gold, 0);

/** Most gold the shared pages can hold together. */
export const stashGoldCap = (stash: D2SharedStash) => sharedPages(stash).length * STASH_GOLD_CAP;

/** Sets the pool's total, filling pages in order the way the game does. */
export function setStashGold(stash: D2SharedStash, value: number) {
  if (!Number.isInteger(value) || value < 0) throw new Error('Gold must be a whole number of 0 or more.');
  const cap = stashGoldCap(stash);
  if (value > cap) throw new Error(`This shared stash holds at most ${cap.toLocaleString()} gold.`);
  let left = value;
  stash.tabs.forEach((t, i) => {
    if (t.type !== StashTabType.Normal) return;
    const n = Math.min(left, STASH_GOLD_CAP);
    if (t.gold !== n) setTabGold(stash, i, n);
    left -= n;
  });
}
