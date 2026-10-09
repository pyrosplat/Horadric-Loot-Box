import { runewordFor } from './describe';
import { GD } from './gamedata';
import { Quality, type D2Item } from './item';

/** Categories for the collection tabs, like Path of Exile's unique stash tab. */
export const CATEGORIES = ['Helms', 'Body Armor', 'Gloves', 'Boots', 'Belts', 'Shields', 'Weapons', 'Amulets', 'Rings', 'Charms', 'Jewels', 'Runes', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export function categoryOf(code: string): Category {
  const def = GD.items[code];
  if (!def) return 'Other';
  const all = new Set([...(GD.types[def.type]?.all ?? []), ...(def.type2 ? GD.types[def.type2]?.all ?? [] : [])]);
  if (all.has('helm') || all.has('circ')) return 'Helms';
  if (all.has('tors')) return 'Body Armor';
  if (all.has('glov')) return 'Gloves';
  if (all.has('boot')) return 'Boots';
  if (all.has('belt')) return 'Belts';
  if (all.has('shld') || all.has('shie') || all.has('grim')) return 'Shields';
  if (all.has('weap')) return 'Weapons';
  if (all.has('amul')) return 'Amulets';
  if (all.has('ring')) return 'Rings';
  if (all.has('char')) return 'Charms';
  if (all.has('jewl')) return 'Jewels';
  return 'Other';
}

const WEAPON_GROUPS: [string, string][] = [
  ['axe', 'Axes'], ['bow', 'Bows'], ['xbow', 'Crossbows'], ['knif', 'Daggers'], ['jave', 'Javelins'], ['tkni', 'Throwing'], ['taxe', 'Throwing'],
  ['club', 'Maces'], ['mace', 'Maces'], ['hamm', 'Maces'], ['pole', 'Polearms'], ['scep', 'Scepters'], ['spea', 'Spears'], ['staf', 'Staves'],
  ['swor', 'Swords'], ['wand', 'Wands'], ['amaz', 'Amazon'], ['h2h', 'Claws'], ['orb', 'Orbs'],
];

/** Weapon sub-group ("Swords", "Bows"…), for the collection's weapon section. */
export function weaponGroupOf(code: string): string {
  const def = GD.items[code];
  const all = new Set([...(GD.types[def?.type ?? '']?.all ?? []), ...(def?.type2 ? GD.types[def.type2]?.all ?? [] : [])]);
  // most specific first: class weapons, then throwing, then the rest
  for (const [t, name] of WEAPON_GROUPS) if (['amaz', 'h2h', 'orb', 'tkni', 'taxe', 'jave'].includes(t) && all.has(t)) return name;
  for (const [t, name] of WEAPON_GROUPS) if (all.has(t)) return name;
  return 'Other weapons';
}

export interface CatalogEntry {
  /** unique id, set item id, or runeword row */
  id: number;
  name: string;
  /** Base item code (for uniques and sets). */
  code?: string;
  category: Category;
  /** Weapons: the weapon kind. */
  sub?: string;
  levelReq: number;
  /** Sets: the set's name. Runewords: the rune codes in order. */
  group?: string;
  runes?: string[];
  itypes?: string[];
  /**
   * Not tracked by the game's Chronicle (legacy, duplicate or unobtainable rows). Shown only when a copy is
   * stored, and never counted in the totals.
   */
  legacy?: boolean;
}

let uniques: CatalogEntry[] | undefined;
let sets: CatalogEntry[] | undefined;
let runewords: CatalogEntry[] | undefined;

export function uniqueCatalog(): CatalogEntry[] {
  return (uniques ??= Object.entries(GD.uniques)
    .filter(([, u]) => {
      const def = GD.items[u.code];
      return !u.disabled && u.name && def && !def.quest;
    })
    .map(([id, u]) => {
      const category = categoryOf(u.code);
      return { id: Number(id), name: u.name, code: u.code, category, sub: category === 'Weapons' ? weaponGroupOf(u.code) : undefined, levelReq: u.levelReq, legacy: u.noChronicle };
    }));
}

export function setCatalog(): CatalogEntry[] {
  return (sets ??= Object.entries(GD.setItems)
    .filter(([, s]) => s.name && GD.items[s.code])
    .map(([id, s]) => ({ id: Number(id), name: s.name, code: s.code, category: categoryOf(s.code), levelReq: s.levelReq, group: s.set, legacy: s.noChronicle })));
}

const RW_TYPE: [string, Category][] = [
  ['shld', 'Shields'], ['shie', 'Shields'], ['pala', 'Shields'], ['helm', 'Helms'], ['tors', 'Body Armor'], ['weap', 'Weapons'], ['mele', 'Weapons'], ['miss', 'Weapons'],
];

export function runewordCatalog(): CatalogEntry[] {
  return (runewords ??= GD.runewords
    .filter((r) => r.complete && r.runes.length)
    .map((r) => {
      const cat = RW_TYPE.find(([t]) => r.itypes.some((i) => i === t || GD.types[i]?.all.includes(t)))?.[1] ?? 'Other';
      const lvl = Math.max(0, ...r.runes.map((c) => GD.items[c]?.levelReq ?? 0));
      return { id: r.row, name: r.name, category: cat, levelReq: lvl, runes: r.runes, itypes: r.itypes };
    }));
}

export const RUNE_CODES = Array.from({ length: 33 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);

let runes: CatalogEntry[] | undefined;
export function runeCatalog(): CatalogEntry[] {
  return (runes ??= RUNE_CODES.filter((c) => GD.items[c]).map((code, i) => ({
    id: i + 1,
    name: GD.items[code].name,
    code,
    category: 'Runes' as Category,
    levelReq: GD.items[code].levelReq,
    group: i < 14 ? 'Low runes · El – Dol' : i < 25 ? 'Mid runes · Hel – Gul' : 'High runes · Vex – Zod',
  })));
}

const GEM_TYPES: [string, string][] = [['gema', 'Amethyst'], ['gemd', 'Diamond'], ['geme', 'Emerald'], ['gemr', 'Ruby'], ['gems', 'Sapphire'], ['gemt', 'Topaz'], ['gemz', 'Skull']];
/** Every gem code, by gem type then grade (Chipped → Perfect). */
export const GEM_CODES: string[] = GEM_TYPES.flatMap(([t]) =>
  Object.entries(GD.items)
    .filter(([, d]) => d.type === t)
    .sort(([, a], [, b]) => a.levelReq - b.levelReq || a.index - b.index)
    .map(([code]) => code),
);

let gems: CatalogEntry[] | undefined;
export function gemCatalog(): CatalogEntry[] {
  return (gems ??= GEM_CODES.map((code, i) => ({
    id: i + 1,
    name: GD.items[code].name,
    code,
    category: 'Other' as Category,
    levelReq: GD.items[code].levelReq,
    group: GEM_TYPES.find(([t]) => t === GD.items[code].type)?.[1] ?? 'Gems',
  })));
}

export type CollectionKind = 'unique' | 'set' | 'runeword' | 'rune' | 'gem';

export function catalog(kind: CollectionKind): CatalogEntry[] {
  return kind === 'unique' ? uniqueCatalog() : kind === 'set' ? setCatalog() : kind === 'rune' ? runeCatalog() : kind === 'gem' ? gemCatalog() : runewordCatalog();
}

/** Which catalog entry a stored item fills, if any. */
export function collectionKey(kind: CollectionKind, item: D2Item): number | undefined {
  if (kind === 'unique') return item.quality === Quality.Unique ? item.uniqueId : undefined;
  if (kind === 'set') return item.quality === Quality.Set ? item.setId : undefined;
  if (kind === 'gem') {
    const i = GEM_CODES.indexOf(item.code);
    return i >= 0 ? i + 1 : undefined;
  }
  if (kind === 'rune') {
    const i = RUNE_CODES.indexOf(item.code);
    return i >= 0 ? i + 1 : undefined;
  }
  return item.runeword ? runewordFor(item)?.row : undefined;
}

/**
 * Whether a unique can exist as an ethereal item.
 *
 * Explicitly ethereal uniques are included even if their unique definition
 * also has the indestruct property.
 */
export function canBeEthereal(kind: CollectionKind, e: CatalogEntry): boolean {
  if (kind !== 'unique') return false;

  const def = e.code ? GD.items[e.code] : undefined;
  if (!def || (def.kind !== 'weapon' && def.kind !== 'armor')) return false;

  if (def.noDur || def.dur <= 0) return false;

  const unique = GD.uniques[String(e.id)];

  const isIndestructible = unique?.props.some(
    ([code]) => code === 'indestruct',
  );

  const isExplicitlyEthereal = unique?.props.some(
    ([code]) => code === 'ethereal',
  );

  return !isIndestructible || isExplicitlyEthereal;
}

/**
 * Whether a catalog entry has a non-ethereal form.
 *
 * Explicitly ethereal uniques, such as Ethereal Edge, do not have a
 * non-ethereal form and therefore should not get a normal slot when
 * ethereal items are tracked separately.
 */
export function canBeNonEthereal(kind: CollectionKind, e: CatalogEntry): boolean {
  if (kind !== 'unique') return true;

  const unique = GD.uniques[String(e.id)];

  return !unique?.props.some(([code]) => code === 'ethereal');
}


/** Slot key: the catalog id, plus `:eth` for the ethereal slot when ethereal copies are tracked separately. */
export const slotKey = (id: number, eth: boolean) =>
  eth ? `${id}:eth` : String(id);

/**
 * Every slot of a catalog: one per entry, plus an ethereal one for entries
 * that can be ethereal (when split).
 *
 * Explicitly ethereal uniques only get an ethereal slot when splitting is
 * enabled; they do not get a non-ethereal slot.
 *
 * Legacy entries (not in the game's Chronicle) are only included when
 * `have` holds a copy.
 */
export function slots(
  kind: CollectionKind,
  splitEthereal: boolean,
  have?: Map<string, unknown[]>,
): { entry: CatalogEntry; eth: boolean; key: string }[] {
  const out: { entry: CatalogEntry; eth: boolean; key: string }[] = [];

  for (const e of catalog(kind)) {
    if (e.legacy) {
      for (const eth of [false, true]) {
        const key = slotKey(e.id, eth);
        if (have?.has(key)) out.push({ entry: e, eth, key });
      }
      continue;
    }

    const ethereal = canBeEthereal(kind, e);
    const nonEthereal = canBeNonEthereal(kind, e);

    if (!splitEthereal) {
      out.push({
        entry: e,
        eth: false,
        key: slotKey(e.id, false),
      });
      continue;
    }

    if (nonEthereal) {
      out.push({
        entry: e,
        eth: false,
        key: slotKey(e.id, false),
      });
    }

    if (ethereal) {
      out.push({
        entry: e,
        eth: true,
        key: slotKey(e.id, true),
      });
    }
  }

  return out;
}


/** Found / total for a collection, counting only slots the game's Chronicle tracks. */
export function progress(kind: CollectionKind, splitEthereal: boolean, have: Map<string, unknown[]>): { found: number; total: number } {
  const counted = slots(kind, splitEthereal).filter((s) => !s.entry.legacy);
  return { found: counted.filter((s) => have.has(s.key)).length, total: counted.length };
}

/** An item somewhere on the account, for the collection tabs. */
export interface Held {
  item: D2Item;
  docId: string;
  /** Where it is, e.g. "ChaosSC · Personal stash". */
  where: string;
  /** In the vault the collection belongs to (the rest is shown as "on the account"). */
  inVault: boolean;
  /** Set when this is a rune, jewel or gem socketed into another item (named here): it counts as found but is in use. */
  socketedIn?: string;
}

const heldCount = (h: Held) => h.item.advancedStackSize ?? 1;

/** Copies per slot, from everything held (vault first). */
export function collectHeld(kind: CollectionKind, held: Held[], splitEthereal = false): Map<string, Held[]> {
  const out = new Map<string, Held[]>();
  for (const h of held) {
    if (heldCount(h) <= 0) continue; // empty Stackables entries
    const k = collectionKey(kind, h.item);
    if (k === undefined) continue;
    const key = slotKey(k, splitEthereal && h.item.ethereal && kind === 'unique');
    const list = out.get(key) ?? [];
    list.push(h);
    out.set(key, list);
  }
  // vault copies first, then loose copies elsewhere, socketed ones last
  const rank = (h: Held) => (h.inVault ? 0 : h.socketedIn ? 2 : 1);
  for (const list of out.values()) list.sort((a, b) => rank(a) - rank(b));
  return out;
}

export const countHeld = (list: Held[] | undefined) => (list ?? []).reduce((n, h) => n + heldCount(h), 0);

/** How many of each rune the account has loose (not socketed), stacks included. */
export function runeCounts(held: Held[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of held) if (!h.socketedIn && RUNE_CODES.includes(h.item.code)) out.set(h.item.code, (out.get(h.item.code) ?? 0) + Math.max(0, heldCount(h)));
  return out;
}

/** True when the runes for this runeword are all available (repeated runes need several copies). */
export function canMake(entry: CatalogEntry, counts: Map<string, number>): boolean {
  if (!entry.runes?.length) return false;
  const need = new Map<string, number>();
  for (const r of entry.runes) need.set(r, (need.get(r) ?? 0) + 1);
  return [...need].every(([r, n]) => (counts.get(r) ?? 0) >= n);
}
