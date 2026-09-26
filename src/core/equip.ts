import type { D2Character } from './d2s';
import { requiredLevelOf } from './describe';
import { GD } from './gamedata';
import { ItemMode, StorePage, type D2Item } from './item';

/** Character class ids (charstats order) -> the class codes used in itemtypes.txt. */
export const CLASS_CODES = ['ama', 'sor', 'nec', 'pal', 'bar', 'dru', 'ass', 'war'];

/** Body location id -> itemtypes BodyLoc code. 11/12 are the weapon-swap hands. */
export const SLOT_CODE: Record<number, string> = {
  1: 'head',
  2: 'neck',
  3: 'tors',
  4: 'rarm',
  5: 'larm',
  6: 'rrin',
  7: 'lrin',
  8: 'belt',
  9: 'feet',
  10: 'glov',
  11: 'rarm',
  12: 'larm',
};

export const BODY_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** Mercenaries only use helm, armor and their hands. */
export const MERC_SLOTS = [1, 3, 4, 5];

export interface EquipCheck {
  ok: boolean;
  reason?: string;
  /** Allowed, but the game won't apply the item yet (requirements). */
  warning?: string;
}

function typeChain(item: D2Item): string[] {
  const def = item.def;
  if (!def) return [];
  return [...(GD.types[def.type]?.all ?? [def.type]), ...(def.type2 ? GD.types[def.type2]?.all ?? [def.type2] : [])];
}

export function itemIs(item: D2Item, code: string): boolean {
  return typeChain(item).includes(code);
}

/** BodyLoc codes an item may be worn in. */
export function slotCodes(item: D2Item): Set<string> {
  for (const t of typeChain(item)) {
    const locs = GD.types[t]?.bodyLoc ?? [];
    if (locs.length) return new Set(locs);
  }
  return new Set();
}

/** Class code the item is restricted to, if any. */
export function itemClass(item: D2Item): string | undefined {
  for (const t of typeChain(item)) {
    const c = GD.types[t]?.cls;
    if (c) return c;
  }
  return undefined;
}

const CLASS_LABEL: Record<string, string> = { ama: 'Amazon', sor: 'Sorceress', nec: 'Necromancer', pal: 'Paladin', bar: 'Barbarian', dru: 'Druid', ass: 'Assassin', war: 'Warlock' };

type Hand = 'shield' | 'quiver' | 'weapon';
function handKind(item: D2Item): Hand {
  if (itemIs(item, 'bowq') || itemIs(item, 'xboq')) return 'quiver';
  if (itemIs(item, 'weap')) return 'weapon';
  return 'shield'; // shields, auric shields, voodoo heads, grimoires
}

/** Two-handed for this class (Barbarians can swing two-handed swords with one hand). */
export function isTwoHanded(item: D2Item, classId: number | undefined): boolean {
  const def = item.def;
  if (!def?.twoHanded) return false;
  return !(classId === 4 && def.oneOrTwo);
}

const partner = (loc: number) => ({ 4: 5, 5: 4, 11: 12, 12: 11 })[loc as 4 | 5 | 11 | 12];

function handsCheck(item: D2Item, other: D2Item | undefined, classId: number | undefined, merc: boolean): string | undefined {
  if (!other) return undefined;
  const a = handKind(item), b = handKind(other);
  const bowPair = (w: D2Item, q: D2Item) => (itemIs(w, 'bow') && itemIs(q, 'bowq')) || (itemIs(w, 'xbow') && itemIs(q, 'xboq'));
  if (a === 'quiver' || b === 'quiver') {
    const [w, q] = a === 'quiver' ? [other, item] : [item, other];
    if (a === 'quiver' && b === 'quiver') return 'Only one quiver can be equipped.';
    if (handKind(w) === 'weapon' && !bowPair(w, q) && isTwoHanded(w, classId)) return `${w.def?.name} needs both hands.`;
    return undefined;
  }
  if (isTwoHanded(item, classId)) return `${item.def?.name} is two-handed: empty the other hand first.`;
  if (isTwoHanded(other, classId)) return `${other.def?.name} in the other hand is two-handed.`;
  if (a === 'shield' && b === 'shield') return 'Only one shield can be held.';
  if (a === 'weapon' && b === 'weapon') {
    if (merc) return 'Mercenaries hold one weapon.';
    const claws = itemIs(item, 'h2h') && itemIs(other, 'h2h');
    if (classId === 4 || (classId === 6 && claws)) return undefined;
    if (classId === 6) return 'Assassins can only dual-wield claws.';
    return 'Only Barbarians (and Assassins with claws) can hold two weapons.';
  }
  return undefined;
}

export function beltCapacity(belt: D2Item | undefined): number {
  return belt?.def?.beltBoxes ?? 4;
}

export function characterBeltItems(ch: D2Character): D2Item[] {
  return ch.items.filter((i) => i.mode === ItemMode.Belt);
}

/** Can `item` be worn in `bodyLoc`? `ignore` is the item's own current spot when it is moved on the same character. */
export function canEquip(ch: D2Character, item: D2Item, bodyLoc: number, opts: { merc?: boolean; ignore?: D2Item } = {}): EquipCheck {
  const merc = !!opts.merc;
  const list = merc ? ch.mercItems : ch.items.filter((i) => i.mode === ItemMode.Equipped);
  if (merc && !ch.mercSplit) return { ok: false, reason: ch.hasMerc ? "This character's mercenary section couldn't be read, so its gear can't be changed." : 'This character has no mercenary.' };
  if (merc && !MERC_SLOTS.includes(bodyLoc)) return { ok: false, reason: 'Mercenaries only wear a helm, armor, weapon and shield.' };
  if (!SLOT_CODE[bodyLoc]) return { ok: false, reason: 'Not an equipment slot.' };
  if (!item.def) return { ok: false, reason: 'Unknown item.' };
  if (!slotCodes(item).has(SLOT_CODE[bodyLoc])) return { ok: false, reason: `${item.def.name} can't be worn there.` };
  const occupant = list.find((i) => i.bodyLoc === bodyLoc && i !== opts.ignore);
  if (occupant) return { ok: false, reason: 'That slot is taken. Move the equipped item off first.' };

  const cls = itemClass(item);
  if (cls && (merc || CLASS_CODES[ch.classId] !== cls)) return { ok: false, reason: `${item.def.name} is ${CLASS_LABEL[cls] ?? cls} only.` };

  const p = partner(bodyLoc);
  if (p !== undefined) {
    const other = list.find((i) => i.bodyLoc === p && i !== opts.ignore);
    const why = handsCheck(item, other, merc ? undefined : ch.classId, merc);
    if (why) return { ok: false, reason: why };
  }

  if (bodyLoc === 8 && !merc) {
    const used = characterBeltItems(ch).reduce((m, i) => Math.max(m, i.x + 1), 0);
    if (used > beltCapacity(item)) return { ok: false, reason: `${item.def.name} holds ${beltCapacity(item)} potions; empty the upper belt rows first.` };
  }

  // Only the level is checked: the save keeps base strength/dexterity, not what gear adds, so those would mislead.
  const lvl = merc ? 0 : requiredLevelOf(item);
  return {
    ok: true,
    warning: lvl > ch.level ? `${ch.name} is level ${ch.level}; ${item.def.name} needs level ${lvl} and won't work until then.` : undefined,
  };
}

/** Can the item leave its equipment slot? (A belt can't be taken off while its upper rows hold potions.) */
export function canUnequip(ch: D2Character, item: D2Item): EquipCheck {
  if (item.mode === ItemMode.Equipped && item.bodyLoc === 8 && ch.items.includes(item)) {
    const used = characterBeltItems(ch).reduce((m, i) => Math.max(m, i.x + 1), 0);
    if (used > 4) return { ok: false, reason: 'Empty the upper belt rows before taking the belt off.' };
  }
  return { ok: true };
}

/** Can the item go into belt slot `slot` (0–15, bottom row first)? */
export function canBelt(ch: D2Character, item: D2Item, slot: number, ignore?: D2Item): EquipCheck {
  if (!item.def || !typeChain(item).some((t) => GD.types[t]?.beltable)) return { ok: false, reason: 'Only potions and scrolls go in the belt.' };
  const belt = ch.items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 8 && i !== ignore);
  const cap = beltCapacity(belt);
  if (slot < 0 || slot >= cap) return { ok: false, reason: belt ? `${belt.def?.name ?? 'This belt'} only holds ${cap} potions.` : 'Without a belt only the bottom row can be used.' };
  if (characterBeltItems(ch).some((i) => i.x === slot && i !== ignore)) return { ok: false, reason: 'That belt slot is taken.' };
  return { ok: true };
}

export function firstFreeBeltSlot(ch: D2Character, ignore?: D2Item): number | undefined {
  const cap = beltCapacity(ch.items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 8));
  const used = new Set(characterBeltItems(ch).filter((i) => i !== ignore).map((i) => i.x));
  for (let s = 0; s < cap; s++) if (!used.has(s)) return s;
  return undefined;
}

/** Placement fields the game writes for worn and belted items (x mirrors the body location / belt slot). */
export const equipPlacement = (bodyLoc: number) => ({ mode: ItemMode.Equipped, page: StorePage.None, x: bodyLoc, y: 0, bodyLoc });
export const beltPlacement = (slot: number) => ({ mode: ItemMode.Belt, page: StorePage.None, x: slot, y: 0, bodyLoc: 0 });
