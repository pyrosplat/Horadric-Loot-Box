import { BitWriter, concatBytes } from './bits';
import { encodeItemCode } from './huffman';
import { GD, isType, itemDef, statByName, statDef, type PropDef } from './gamedata';
import { ItemFlag, ItemMode, PAIRED, Quality, StorePage, createCompactItem, itemBytes, parseItemBytes, withPlacement, type D2Item, type ItemStat } from './item';
import { propDefs, propLines, propStatsAt, skillId } from './describe';

/**
 * Builds complete (non-compact) unique and set items from the game tables, for the Trade feature.
 *
 * The encoding follows what D2R writes for real drops: flags Identified | 0x800000, format 101, base defense at
 * the base's maximum (×1.5 when ethereal), durability at the base's maximum (half + 1 when ethereal), stats in
 * id order with the paired damage stats written together, and the per-item set bonuses as extra stat lists
 * flagged in the 5-bit set mask. Every item is parsed back before it is returned.
 */

export type TemplateKind = 'unique' | 'set';

/** One property of a unique or set item that the player may care about, with what it can roll. */
export interface RollSlot {
  /** Stable key for this property: "p3" for the item's 4th property, "b2.0" for the first 2-piece bonus. */
  key: string;
  /** 0 for the item's own properties, or the number of set pieces a bonus needs. */
  pieces: number;
  prop: PropDef;
  /**
   * What the roll picks: a number in lo–hi, a character class, a skill, a socket count, or (RotW Renewed charms) which
   * of a property group's options the item has: then `choices` are those options and the chosen one rolls as usual.
   */
  kind: 'value' | 'class' | 'skill' | 'sockets' | 'group';
  lo: number;
  hi: number;
  /** For class and skill picks: the values the roll can take, with names. */
  options?: { value: number; label: string }[];
  /** Tooltip text with the range, e.g. "+(20–30)% Faster Cast Rate". */
  label: string;
  /** Whether this property actually varies. */
  variable: boolean;
  /** Groups: each option as its own slot (keys "p3.0", "p3.1", …), and how likely each is. */
  choices?: RollSlot[];
  weights?: number[];
}

/** A property group the tables name but don't define (a Renewed charm's "Gelid-Affix5"): the game gives nothing for it. */
const emptyGroup = (code: string) => !GD.propGroups[code] && /-Affix\d+$/.test(code);

export type Rolls = Record<string, number>;

const templateRow = (kind: TemplateKind, id: number) => (kind === 'unique' ? GD.uniques[id] : GD.setItems[id]);

/** Why a unique or set item can't be built, or undefined if it can. */
export function unbuildableReason(kind: TemplateKind, id: number): string | undefined {
  const row = templateRow(kind, id);
  if (!row) return 'Unknown item';
  if (kind === 'unique' && (row as (typeof GD.uniques)[string]).disabled) return 'Not in the game';
  // an old row kept next to the current one (the Crystal Sword Azurewrath)
  if (row.noChronicle && kind === 'unique' && Object.values(GD.uniques).some((u) => u !== row && u.name === row.name && !u.noChronicle))
    return 'Old version of this item';
  const def = itemDef(row.code);
  if (!def) return 'Unknown base item';
  // Reign of the Warlock replaced the old Sunder charms with droppable "Latent" versions (and crafted "Renewed" ones)
  if (kind === 'unique' && Object.values(GD.uniques).some((u) => u.name === `Latent ${row.name}`)) return `Replaced by Latent ${row.name}`;
  if (def.quest) return 'Quest items can’t be traded';
  const props = [...row.props, ...(kind === 'set' ? GD.setItems[id].partial.flatMap(([, p]) => p) : [])];
  for (const [code] of props) {
    if (emptyGroup(code)) continue;
    const codes = GD.propGroups[code] ? GD.propGroups[code].options.map((o) => o.prop[0]) : [code];
    if (codes.some((c) => !propDefs(c).length)) return 'Uses properties this app can’t build yet';
  }
  return undefined;
}

/** A short tag telling apart uniques that share a name (the eight Rainbow Facets, the two Azurewraths). */
function variantTag(kind: TemplateKind, id: number): string {
  const row = templateRow(kind, id)!;
  const codes = row.props.map((p) => p[0]).join(' ');
  const elem = /fire/.test(codes) ? 'Fire' : /cold/.test(codes) ? 'Cold' : /ltng/.test(codes) ? 'Lightning' : /pois/.test(codes) ? 'Poison' : '';
  const when = /death-skill/.test(codes) ? 'Death' : /levelup-skill/.test(codes) ? 'Level-up' : '';
  return [elem, when].filter(Boolean).join(', ') || (GD.items[row.code]?.name ?? row.code);
}

/** Every unique or set item that can be built, sorted by name. */
export function buildableTemplates(kind: TemplateKind): { id: number; name: string; code: string }[] {
  const table = kind === 'unique' ? GD.uniques : GD.setItems;
  const rows = Object.entries(table).filter(([k]) => !unbuildableReason(kind, Number(k)));
  const count = new Map<string, number>();
  for (const [, r] of rows) count.set(r.name, (count.get(r.name) ?? 0) + 1);
  return rows
    .map(([k, r]) => ({ id: Number(k), name: count.get(r.name)! > 1 ? `${r.name} (${variantTag(kind, Number(k))})` : r.name, code: r.code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function slotFor(key: string, pieces: number, prop: PropDef, baseCode: string): RollSlot {
  const [code, param, min, max] = prop;
  const group = GD.propGroups[code];
  if (group) {
    const choices = group.options.map((o, i) => slotFor(`${key}.${i}`, pieces, o.prop, baseCode));
    return {
      key,
      pieces,
      prop,
      kind: 'group',
      lo: 0,
      hi: choices.length - 1,
      options: choices.map((c, i) => ({ value: i, label: c.label })),
      label: `One of: ${choices.map((c) => c.label).join(' or ')}`,
      variable: choices.length > 1 || choices.some((c) => c.variable),
      choices,
      weights: group.options.map((o) => o.chance),
    };
  }
  const label = propLines([prop]).map((l) => l.text).join(', ');
  const funcs = propDefs(code).map((f) => f.func);
  const base = { key, pieces, prop, label };
  if (funcs.includes(36)) {
    const options = [];
    for (let c = Math.max(0, min); c <= Math.min(max, GD.classes.length - 1); c++) options.push({ value: c, label: GD.classes[c].name });
    return { ...base, kind: 'class', lo: options[0]?.value ?? 0, hi: options.at(-1)?.value ?? 0, options, variable: options.length > 1 };
  }
  if (funcs.includes(12)) {
    const options = [];
    for (let s = min; s <= max; s++) if (GD.skills[s]) options.push({ value: s, label: GD.skills[s].name });
    return { ...base, kind: 'skill', lo: min, hi: max, options, variable: options.length > 1 };
  }
  if (funcs.includes(14)) {
    // the tables can ask for more sockets than the base holds (Aldur's Rhythm 2–5 on a 3-socket Jagged Star);
    // the game caps them at the base's limit, so the roll only goes that high
    const cap = maxBaseSockets(baseCode) || 6;
    const fixed = Number(param) || 0;
    const lo = Math.min(cap, fixed || Math.min(min, max)), hi = Math.min(cap, fixed || Math.max(min, max));
    return { ...base, label: lo === hi ? `Sockets: ${lo}` : `Sockets: ${lo}\u2013${hi}`, kind: 'sockets', lo, hi, variable: lo !== hi };
  }
  // chance-to-cast, charges, per-level and elemental ranges use min/max as two separate fixed numbers
  const fixedPair = funcs.some((f) => f === 11 || f === 15 || f === 16 || f === 19) || (funcs.includes(17) && (funcs.length > 1 || !!Number(prop[1])));
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return { ...base, kind: 'value', lo, hi, variable: !fixedPair && lo !== hi };
}

/** The properties of a unique or set item (and a set item's own partial-set bonuses) with their possible rolls. */
export function rollSlots(kind: TemplateKind, id: number): RollSlot[] {
  const row = templateRow(kind, id);
  if (!row) return [];
  const out = row.props.map((p, i) => (emptyGroup(p[0]) ? undefined : slotFor(`p${i}`, 0, p, row.code))).filter((x): x is RollSlot => !!x);
  if (kind === 'set') for (const [n, props] of GD.setItems[id].partial) props.forEach((p, i) => out.push(slotFor(`b${n}.${i}`, n, p, row.code)));
  return out;
}

/** The slots of an item plus, for each group, the option it rolled (to read or compare that option's value). */
export function chosenSlots(slots: RollSlot[], rolls: Rolls): RollSlot[] {
  return slots.flatMap((s) => (s.kind === 'group' ? [s, s.choices![rolls[s.key] ?? 0]].filter(Boolean) : [s]));
}

/** The best roll of a slot: the highest number, except for requirements, where lower is better. */
export function perfectRoll(slot: RollSlot): number {
  if (slot.kind === 'group') return 0;
  if (slot.kind === 'value' && slot.prop[0] === 'ease') return slot.lo;
  return slot.hi;
}

/** Rolls every variable slot at random, or perfect; `keep` values win over both. */
export function pickRolls(slots: RollSlot[], mode: 'random' | 'perfect', keep: Rolls = {}): Rolls {
  const out: Rolls = {};
  for (const s of slots) {
    if (!s.variable) continue;
    if (s.kind === 'group') {
      // which option (weighted like the game), then that option's own roll
      const w = s.weights ?? s.choices!.map(() => 1);
      let idx = keep[s.key];
      if (idx === undefined && mode === 'perfect') idx = 0;
      if (idx === undefined) {
        let r = Math.random() * w.reduce((a, b) => a + b, 0);
        idx = w.findIndex((x) => (r -= x) < 0);
        if (idx < 0) idx = w.length - 1;
      }
      out[s.key] = idx;
      Object.assign(out, pickRolls([s.choices![idx]], mode, keep));
      continue;
    }
    if (keep[s.key] !== undefined) out[s.key] = keep[s.key];
    else if (mode === 'perfect') out[s.key] = perfectRoll(s);
    else if (s.options) out[s.key] = s.options[Math.floor(Math.random() * s.options.length)].value;
    else out[s.key] = s.lo + Math.floor(Math.random() * (s.hi - s.lo + 1));
  }
  return out;
}

interface Built {
  stats: ItemStat[];
  sockets: number;
  ethereal: boolean;
}

function statsForSlot(slot: RollSlot, rolls: Rolls, into: Built) {
  if (slot.kind === 'group') {
    const idx = rolls[slot.key] ?? 0;
    const choice = slot.choices![idx];
    if (!choice) throw new Error(`${slot.label}: option ${idx} doesn't exist`);
    return statsForSlot(choice, rolls, into);
  }
  const [code, param, min, max] = slot.prop;
  const v = slot.variable ? rolls[slot.key] ?? perfectRoll(slot) : slot.kind === 'value' ? Math.max(min, max) : slot.hi;
  if (v < slot.lo || v > slot.hi) throw new Error(`${slot.label}: ${v} is outside ${slot.lo}–${slot.hi}`);
  for (const f of propDefs(code)) {
    switch (f.func) {
      case 12: {
        const d = statByName(f.stat ?? 'item_singleskill');
        if (d) into.stats.push({ id: d.id, param: v, value: Number(param) || 1 });
        break;
      }
      case 36: {
        const d = statByName(f.stat ?? 'item_addclassskills');
        if (d) into.stats.push({ id: d.id, param: v, value: Number(f.val) || Number(param) || 1 });
        break;
      }
      case 14:
        into.sockets = Math.max(into.sockets, v);
        break;
      case 23:
        into.ethereal = true;
        break;
    }
  }
  const funcs = propDefs(code).map((f) => f.func);
  if (!funcs.some((f) => f === 12 || f === 36 || f === 14 || f === 23)) into.stats.push(...propStatsAt(code, param, min, max, v).stats);
  // a skill named in the tables that this game data doesn't know would silently become skill 0
  if (funcs.some((f) => f === 11 || f === 19 || f === 22) && param && !/^\d+$/.test(param) && !skillId(param))
    throw new Error(`Unknown skill '${param}'`);
}

/** Paired stats written right after their first stat (17→18, 48→49, …): which head each belongs to. */
const PAIR_HEAD = new Map(Object.entries(PAIRED).flatMap(([h, ids]) => ids.map((id) => [id, Number(h)] as const)));

function writeStat(w: BitWriter, id: number, param: number, value: number, withId: boolean) {
  const d = statDef(id);
  const raw = value / 2 ** d.valShift + d.saveAdd;
  if (!Number.isInteger(raw) || raw < 0 || raw >= 2 ** d.saveBits) throw new Error(`${d.key} value ${value} doesn't fit`);
  if (withId) w.writeBits(id, 9);
  if (d.saveParamBits) {
    if (param < 0 || param >= 2 ** d.saveParamBits) throw new Error(`${d.key} parameter ${param} doesn't fit`);
    w.writeBits(param, d.saveParamBits);
  }
  w.writeBits(raw, d.saveBits);
}

/** Merges repeated stats, sorts them the way the game saves them, and writes the list with its terminator. */
function writeStatList(w: BitWriter, stats: ItemStat[]) {
  const merged = new Map<string, ItemStat>();
  for (const s of stats) {
    const k = `${s.id}:${s.param}`;
    const cur = merged.get(k);
    if (cur && s.id !== 204) cur.value += s.value;
    else merged.set(cur ? `${k}:${merged.size}` : k, { ...s });
  }
  const list = [...merged.values()].sort((a, b) => a.id - b.id || a.param - b.param);
  const has = (id: number) => list.find((s) => s.id === id && s.param === 0);
  for (const s of list) {
    const head = PAIR_HEAD.get(s.id);
    if (head !== undefined && has(head)) continue; // written with its head
    writeStat(w, s.id, s.param, s.value, true);
    for (const pid of PAIRED[s.id] ?? []) writeStat(w, pid, 0, has(pid)?.value ?? 0, false);
  }
  w.writeBits(0x1ff, 9);
}

export interface BuildOptions {
  /** Item level; defaults to 85 (or the base's level if higher). */
  itemLevel?: number;
  saveVersion?: number;
  /** Make it ethereal (only where the game allows it, see `canBuildEthereal`). */
  ethereal?: boolean;
  /** Armor uniques and set items without Enhanced Defense: the base defense roll (see `templateDefenseRange`). */
  defense?: number;
}

/**
 * The base defense a unique or set armor piece can roll, or undefined when it can't vary: weapons and jewelry
 * have none, and items with Enhanced Defense always get the base's top defense (Andariel's Visage, Magefist).
 */
export function templateDefenseRange(kind: TemplateKind, id: number): { lo: number; hi: number } | undefined {
  const row = templateRow(kind, id);
  const def = row && itemDef(row.code);
  if (!def?.flags.includes('A') || def.minAc === undefined || def.maxAc === undefined || def.minAc === def.maxAc) return undefined;
  if (row.props.some((p) => p[0] === 'ac%')) return undefined;
  return { lo: def.minAc, hi: def.maxAc };
}

/**
 * Whether an item on this base can be ethereal: weapons and armor with durability, as unique or plain items.
 * Set items never are; jewelry, charms, jewels and indestructible bases (no durability) can't be.
 */
export function canBuildEthereal(kind: TemplateKind | 'base', code: string): boolean {
  if (kind === 'set') return false;
  const def = itemDef(code);
  if (!def || def.quest || (def.kind !== 'weapon' && def.kind !== 'armor')) return false;
  return !def.noDur && def.dur > 0;
}

interface Encode {
  code: string;
  quality: Quality;
  /** qualityitems.txt row, for superior items. */
  superiorId?: number;
  /** automagic.txt row, for an automatic mod. */
  autoRow?: number;
  /** Magic items: magicprefix.txt / magicsuffix.txt rows (0 = none). */
  magic?: { prefix: number; suffix: number };
  /** Rare and crafted items: the two name parts and up to 3 prefixes and 3 suffixes (0 = none). */
  rare?: { names: [number, number]; prefixes: number[]; suffixes: number[] };
  /** Runewords: the runeword id and its stat list, and the runes that go in the sockets (in order). */
  runeword?: { id: number; stats: ItemStat[]; runes: string[] };
  /** Unique or set row, for those qualities. */
  rowId?: number;
  ethereal: boolean;
  sockets: number;
  /** Base defense before the ethereal bonus (armor only). */
  defense?: number;
  stats: ItemStat[];
  /** Per-item set bonuses by bit (set items only). */
  bonus?: (ItemStat[] | undefined)[];
  itemLevel: number;
  saveVersion: number;
}

/** Writes a complete D2R item the way the game saves real drops, and parses it back to check it. */
function encodeFull(e: Encode): D2Item {
  if (e.saveVersion < 105) throw new Error('Items can only be created for Reign of the Warlock saves (v105).');
  const def = itemDef(e.code);
  if (!def) throw new Error(`Unknown item code '${e.code}'`);
  const w = new BitWriter(128);
  let flags = ItemFlag.Identified | 0x00800000;
  if (e.sockets) flags |= ItemFlag.Socketed;
  if (e.ethereal) flags |= ItemFlag.Ethereal;
  if (e.runeword) flags |= ItemFlag.Runeword;
  w.writeU32(flags >>> 0);
  w.writeBits(1, 1); // format version 101
  w.writeBits(2, 2);
  w.writeBits(ItemMode.Stored, 3);
  w.writeBits(0, 4); // body location
  w.writeBits(0, 4); // x
  w.writeBits(0, 4); // y
  w.writeBits(StorePage.Inventory + 1, 3);
  encodeItemCode(w, e.code);

  w.writeBits(e.runeword?.runes.length ?? 0, 3); // socketed children that follow the item
  let uid = 0;
  while (!uid) uid = (Math.random() * 0x100000000) >>> 0;
  w.writeU32(uid);
  w.writeBits(Math.min(99, Math.max(1, e.itemLevel)), 7);
  w.writeBits(e.quality, 4);
  const gfxCount = Math.max(GD.types[def.type]?.varInvGfx ?? 0, def.type2 ? GD.types[def.type2]?.varInvGfx ?? 0 : 0);
  if (gfxCount > 0) {
    w.writeBits(1, 1);
    w.writeBits(Math.floor(Math.random() * Math.min(gfxCount, 8)), 3);
  } else w.writeBits(0, 1);
  if (e.autoRow !== undefined) {
    w.writeBits(1, 1);
    w.writeBits(e.autoRow + 1, 11); // stored as the automagic.txt row + 1
  } else w.writeBits(0, 1);
  if (e.quality === Quality.Unique || e.quality === Quality.Set) w.writeBits(e.rowId ?? 0, 12);
  else if (e.quality === Quality.Superior) w.writeBits(e.superiorId ?? 0, 3);
  else if (e.quality === Quality.Magic) {
    w.writeBits(e.magic?.prefix ?? 0, 11);
    w.writeBits(e.magic?.suffix ?? 0, 11);
  } else if (e.quality === Quality.Rare || e.quality === Quality.Crafted) {
    const r = e.rare ?? { names: [0, 0], prefixes: [], suffixes: [] };
    w.writeBits(r.names[0], 8);
    w.writeBits(r.names[1], 8);
    for (let i = 0; i < 3; i++) {
      for (const id of [r.prefixes[i] ?? 0, r.suffixes[i] ?? 0]) {
        w.writeBits(id ? 1 : 0, 1);
        if (id) w.writeBits(id, 11);
      }
    }
  } else if (e.quality !== Quality.Normal || /[CBS]/.test(def.flags)) throw new Error(`Can't build a ${def.name} of this quality yet`);
  if (e.runeword) w.writeBits(e.runeword.id, 16);
  w.writeBits(0, 1); // no realm data

  const dur = () => {
    const maxd = statDef(73), cur = statDef(72);
    const m = def.noDur ? 0 : e.ethereal ? Math.floor(def.dur / 2) + 1 : def.dur;
    w.writeBits(m + maxd.saveAdd, maxd.saveBits);
    if (m > 0) w.writeBits(m + cur.saveAdd, cur.saveBits);
  };
  if (def.flags.includes('A')) {
    const ac = statDef(31);
    const base = e.defense ?? def.maxAc ?? 0;
    w.writeBits((e.ethereal ? Math.floor(base * 1.5) : base) + ac.saveAdd, ac.saveBits);
    dur();
  } else if (def.flags.includes('W')) dur();

  if (def.stackable) {
    w.writeBits(1, 1);
    w.writeBits(Math.min(511, def.maxStack ?? 1), 9);
  } else w.writeBits(0, 1);
  if (e.sockets) w.writeBits(e.sockets, statDef(194).saveBits);
  let setMask = 0;
  if (e.quality === Quality.Set) {
    (e.bonus ?? []).forEach((l, i) => l?.length && (setMask |= 1 << i));
    w.writeBits(setMask, 5);
  }

  writeStatList(w, e.stats);
  for (let i = 0; i < 5; i++) if (setMask & (1 << i)) writeStatList(w, e.bonus![i]!);
  if (e.runeword) writeStatList(w, e.runeword.stats);
  w.writeBits(0, 1); // not an advanced-stash stack
  w.alignToByte();

  // the runes follow the item, each placed in its socket (mode 6, x = socket number, no page)
  const children = (e.runeword?.runes ?? []).map((code, i) => itemBytes(withPlacement(createCompactItem(code, e.saveVersion), { mode: ItemMode.Socketed, page: StorePage.None, x: i, y: 0 })));
  const item = parseItemBytes(concatBytes([w.toBytes(), ...children]), e.saveVersion);
  const ok =
    item.code === e.code &&
    !item.compact &&
    item.quality === e.quality &&
    (e.quality === Quality.Unique ? item.uniqueId === e.rowId : e.quality === Quality.Set ? item.setId === e.rowId : true) &&
    (e.quality !== Quality.Superior || item.superiorId === e.superiorId) &&
    item.autoAffix === (e.autoRow === undefined ? undefined : e.autoRow + 1) &&
    item.id === uid &&
    item.socketCount === e.sockets &&
    item.ethereal === e.ethereal &&
    item.advBit !== undefined &&
    item.advancedStackSize === undefined &&
    item.runeword === !!e.runeword &&
    (!e.runeword || (item.runewordId === e.runeword.id && item.sockets.map((c) => c.code).join() === e.runeword.runes.join())) &&
    (e.quality !== Quality.Magic || (item.prefixes[0] === (e.magic?.prefix ?? 0) && item.suffixes[0] === (e.magic?.suffix ?? 0))) &&
    (!e.rare ||
      (item.rareName?.join() === e.rare.names.join() &&
        item.prefixes.join() === [0, 1, 2].map((i) => e.rare!.prefixes[i] ?? 0).join() &&
        item.suffixes.join() === [0, 1, 2].map((i) => e.rare!.suffixes[i] ?? 0).join()));
  if (!ok) throw new Error(`Building ${def.name} did not verify`);
  return item;
}

const defaultLevel = (code: string) => Math.max(85, itemDef(code)?.level ?? 1);

/**
 * Builds a unique or set item with the given rolls (missing ones are perfect). The item is identified, in the
 * inventory at 0,0 (use `withPlacement` to put it somewhere), and parsed back to prove it is valid.
 */
export function createTemplateItem(kind: TemplateKind, id: number, rolls: Rolls = {}, opts: BuildOptions = {}): D2Item {
  const why = unbuildableReason(kind, id);
  if (why) throw new Error(why);
  const row = templateRow(kind, id)!;
  if (opts.ethereal && !canBuildEthereal(kind, row.code)) throw new Error(`${row.name} can't be ethereal`);

  const own: Built = { stats: [], sockets: 0, ethereal: false };
  const slots = rollSlots(kind, id);
  for (const s of slots) if (s.pieces === 0) statsForSlot(s, rolls, own);
  const bonus: ItemStat[][] = [];
  if (kind === 'set') {
    for (const [n] of GD.setItems[id].partial) {
      const b: Built = { stats: [], sockets: 0, ethereal: false };
      for (const s of slots) if (s.pieces === n) statsForSlot(s, rolls, b);
      if (b.stats.length) bonus[n - 2] = b.stats;
    }
  }
  let defense: number | undefined;
  if (opts.defense !== undefined) {
    const r = templateDefenseRange(kind, id);
    if (!r) throw new Error(`${row.name}'s defense doesn't roll`);
    if (opts.defense < r.lo || opts.defense > r.hi) throw new Error(`${row.name}'s base defense is ${r.lo}\u2013${r.hi}`);
    defense = opts.defense;
  }
  return encodeFull({
    code: row.code,
    quality: kind === 'unique' ? Quality.Unique : Quality.Set,
    defense,
    rowId: id,
    ethereal: own.ethereal || !!opts.ethereal,
    sockets: Math.min(own.sockets, maxBaseSockets(row.code) || 6),
    stats: own.stats,
    bonus,
    itemLevel: opts.itemLevel ?? defaultLevel(row.code),
    saveVersion: opts.saveVersion ?? 105,
  });
}

// ---------------------------------------------------------------- plain bases (for runewords)

/** Most sockets a plain base can have: its own limit, capped by what its item type allows at item level 41+. */
export function maxBaseSockets(code: string): number {
  const def = itemDef(code);
  if (!def) return 0;
  const byType = GD.types[def.type]?.maxSockets?.[2];
  return byType ? Math.min(def.gemSockets, byType) : def.gemSockets;
}

const TIER = ['', 'Normal', 'Exceptional', 'Elite'];

/** Weapons and armor that can be built as plain (white or grey) bases, sorted by name. */
export function buildableBases(): { code: string; name: string; tier: string; sockets: number }[] {
  return GD.itemOrder
    .map((code) => ({ code, def: GD.items[code] }))
    .filter(({ def }) => def && !def.quest && (def.kind === 'weapon' || def.kind === 'armor') && /[AW]/.test(def.flags) && !/[CBS]/.test(def.flags) && def.type !== 'misl')
    .map(({ code, def }) => ({ code, name: def.name, tier: TIER[def.tier] ?? '', sockets: maxBaseSockets(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The bases the Trade panel offers: elite weapons and armor that take sockets and fit at least one runeword
 * (no boots, gloves or belts, no javelins or throwing weapons, no arrows).
 */
export function runewordBases(allTiers = false): ReturnType<typeof buildableBases> {
  const rwTypes = [...new Set(GD.runewords.filter((r) => r.complete).flatMap((r) => r.itypes))];
  return buildableBases().filter(
    (b) => (allTiers || b.tier === 'Elite') && b.sockets > 0 && !['boot', 'glov', 'belt'].some((t) => isType(b.code, t)) && rwTypes.some((t) => isType(b.code, t)),
  );
}

/** A picked mod row and the value rolled for each of its properties (in the row's order). */
export interface ModPick {
  row: number;
  values: number[];
}

export interface BaseOptions extends BuildOptions {
  /** 0 up to `maxBaseSockets`. */
  sockets?: number;
  /** Armor only: base defense in the base's range (before the ethereal bonus); defaults to the maximum. */
  defense?: number;
  /** Superior quality with this qualityitems.txt row (see `superiorRows`). */
  superior?: ModPick;
  /** An automatic mod (see `autoRows`): paladin shield resistances, orb life or mana, necro head poison… */
  auto?: ModPick;
  /** Up to 3 class skills, +1 to +3 each (see `classSkillsFor`). */
  skills?: { skill: number; level: number }[];
}

/** Which qualityitems.txt column a base belongs to. */
function superiorKind(code: string): string {
  const t = (x: string) => isType(code, x);
  if (t('boot')) return 'boots';
  if (t('glov')) return 'gloves';
  if (t('belt')) return 'belt';
  if (t('shld')) return 'shield';
  if (t('armo')) return 'armor';
  if (t('scep')) return 'scepter';
  if (t('wand')) return 'wand';
  if (t('staf')) return 'staff';
  if (t('bow')) return 'bow';
  return 'weapon';
}

/** Superior mod rows this base can roll (enhanced damage, defense, attack rating, durability). */
export function superiorRows(code: string): number[] {
  const k = superiorKind(code);
  return GD.superior.map((r, i) => (r.fits.includes(k) ? i : -1)).filter((i) => i >= 0);
}

/** Automatic mod rows this base can roll at the item level used here (85). */
export function autoRows(code: string, itemLevel = defaultLevel(code)): number[] {
  const def = itemDef(code);
  if (!def?.autoPrefix) return [];
  return GD.automagic
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.group === def.autoPrefix && r.spawnable && r.level <= itemLevel && (!r.maxLevel || itemLevel <= r.maxLevel))
    .filter(({ r }) => (!r.itypes.length || r.itypes.some((t) => isType(code, t))) && !r.etypes.some((t) => isType(code, t)))
    .map(({ i }) => i);
}

/** The class whose skills this base can roll as a white or superior item (orbs: Sorceress, staves: Sorceress…). */
export function staffModClass(code: string): number {
  const def = itemDef(code);
  if (!def) return -1;
  for (const t of [def.type, def.type2]) for (const a of (t && GD.types[t]?.all) || []) if (GD.types[a]?.staffMods) return GD.classCodes.indexOf(GD.types[a].staffMods!);
  return -1;
}

/** Skills a base can roll (its class's skill-tree skills), by name. */
export function classSkillsFor(code: string, itemLevel = defaultLevel(code)): { id: number; name: string }[] {
  const cls = staffModClass(code);
  if (cls < 0) return [];
  return Object.entries(GD.skills)
    .filter(([, s]) => s.cls === cls && s.page > 0 && s.reqLevel <= itemLevel)
    .map(([id, s]) => ({ id: Number(id), name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The stats of a picked mod row, checking each value is in its range. */
export function modStats(pick: ModPick, mods: PropDef[], what: string): ItemStat[] {
  const out: ItemStat[] = [];
  mods.forEach(([code, param, min, max], i) => {
    const lo = Math.min(min, max), hi = Math.max(min, max);
    const v = pick.values[i] ?? hi;
    if (v < lo || v > hi) throw new Error(`${what}: ${v} is outside ${lo}\u2013${hi}`);
    out.push(...propStatsAt(code, param, min, max, v).stats);
  });
  return out;
}

/** Builds a plain, normal-quality weapon or armor base with empty sockets (grey when socketed, like a drop). */
export function createBaseItem(code: string, opts: BaseOptions = {}): D2Item {
  return encodeBase(code, opts);
}

function encodeBase(code: string, opts: BaseOptions, runeword?: Encode['runeword']): D2Item {
  const def = itemDef(code);
  if (!def || !buildableBases().some((b) => b.code === code)) throw new Error(`${def?.name ?? code} can't be built as a base`);
  const max = maxBaseSockets(code);
  const sockets = opts.sockets ?? 0;
  if (sockets < 0 || sockets > max) throw new Error(`${def.name} can have 0\u2013${max} sockets`);
  if (opts.ethereal && !canBuildEthereal('base', code)) throw new Error(`${def.name} can't be ethereal`);
  let defense: number | undefined;
  if (def.flags.includes('A')) {
    const lo = def.minAc ?? 0, hi = def.maxAc ?? lo;
    // superior with Enhanced Defense: the game stores the top defense + 1 (a Superior Demonhead shows 176 at +14%)
    if (opts.superior && GD.superior[opts.superior.row]?.mods.some((m) => m[0] === 'ac%')) defense = hi + 1;
    else {
      defense = opts.defense ?? hi;
      if (defense < lo || defense > hi) throw new Error(`${def.name} defense is ${lo}\u2013${hi}`);
    }
  }
  const stats: ItemStat[] = [];
  if (opts.superior) {
    if (!superiorRows(code).includes(opts.superior.row)) throw new Error(`${def.name} can't roll that superior mod`);
    stats.push(...modStats(opts.superior, GD.superior[opts.superior.row].mods, 'Superior'));
  }
  if (opts.auto) {
    if (!autoRows(code).includes(opts.auto.row)) throw new Error(`${def.name} can't roll ${GD.automagic[opts.auto.row]?.name ?? 'that mod'}`);
    stats.push(...modStats(opts.auto, GD.automagic[opts.auto.row].mods, GD.automagic[opts.auto.row].name));
  }
  const skills = opts.skills ?? [];
  if (skills.length) {
    const allowed = new Set(classSkillsFor(code).map((s) => s.id));
    if (skills.length > 3) throw new Error('At most 3 skills');
    if (new Set(skills.map((s) => s.skill)).size !== skills.length) throw new Error('Each skill can only be picked once');
    const single = statByName('item_singleskill')!;
    for (const { skill, level } of skills) {
      if (!allowed.has(skill)) throw new Error(`${def.name} can't roll ${GD.skills[skill]?.name ?? 'that skill'}`);
      if (level < 1 || level > 3) throw new Error('Skills roll +1 to +3');
      stats.push({ id: single.id, param: skill, value: level });
    }
  }
  return encodeFull({
    code,
    quality: opts.superior ? Quality.Superior : Quality.Normal,
    superiorId: opts.superior?.row,
    autoRow: opts.auto?.row,
    ethereal: !!opts.ethereal,
    sockets,
    defense,
    stats,
    runeword,
    itemLevel: opts.itemLevel ?? defaultLevel(code),
    saveVersion: opts.saveVersion ?? 105,
  });
}

// ---------------------------------------------------------------- runewords

/** The save's runeword id is the runes.txt row plus this (real saves: Call to Arms, row 12, is 20519). */
export const RUNEWORD_ID_OFFSET = 20507;

/** Runewords that can be made in this version of the game (complete rows), by name. */
export function buildableRunewords(): { row: number; name: string; runes: string[] }[] {
  return GD.runewords.filter((r) => r.complete && r.runes.length && r.props.every(([c]) => propDefs(c).length)).map((r) => ({ row: r.row, name: r.name, runes: r.runes }));
}

/** A runeword's own properties with their possible rolls (like `rollSlots` for uniques). */
export function runewordSlots(row: number): RollSlot[] {
  const rw = GD.runewords.find((r) => r.row === row);
  return rw ? rw.props.map((p, i) => slotFor(`r${i}`, 0, p, '')) : [];
}

/** Why a runeword can't be made in this base, or undefined if it can. */
export function runewordBaseProblem(row: number, code: string): string | undefined {
  const rw = GD.runewords.find((r) => r.row === row);
  const def = itemDef(code);
  if (!rw || !def) return 'Unknown runeword or base';
  if (!rw.itypes.some((t) => isType(code, t))) return `${rw.name} can't be made in a ${def.name}.`;
  if (maxBaseSockets(code) < rw.runes.length) return `A ${def.name} can't have the ${rw.runes.length} sockets ${rw.name} needs.`;
  return undefined;
}

/**
 * Builds a runeword: the base (plain or superior, maybe ethereal) with its runes in the sockets and the runeword's
 * own stats at the given rolls (missing ones perfect). Checked against the base and parsed back, like any item.
 */
export function createRunewordItem(row: number, code: string, rolls: Rolls = {}, opts: BaseOptions = {}): D2Item {
  const rw = GD.runewords.find((r) => r.row === row);
  if (!rw || !buildableRunewords().some((r) => r.row === row)) throw new Error("That runeword can't be built");
  const problem = runewordBaseProblem(row, code);
  if (problem) throw new Error(problem);
  const built: Built = { stats: [], sockets: 0, ethereal: false };
  for (const s of runewordSlots(row)) statsForSlot(s, rolls, built);
  return encodeBase(code, { ...opts, sockets: rw.runes.length }, { id: RUNEWORD_ID_OFFSET + row, stats: built.stats, runes: rw.runes });
}

// ---------------------------------------------------------------- uber keys, organs and other uber items

/** Uber keys, organs, the Token of Absolution and its essences, the Worldstone Shards, and the Ancients' items. */
export const UBER_CODES = ['pk1', 'pk2', 'pk3', 'dhn', 'bey', 'mbr', 'toa', 'tes', 'ceh', 'bet', 'fed', 'xa1', 'xa2', 'xa3', 'xa4', 'xa5', 'ua1', 'ua2', 'ua3', 'ua4', 'ua5'];
export const isUberCode = (code: string) => UBER_CODES.includes(code);

/**
 * Builds an uber key, organ, essence, token or Worldstone Shard: a plain, normal-quality item with no stats, the
 * way the game saves them (real Worldstone Shards: flags 0x800010, format 101).
 */
export function createUberItem(code: string, opts: BuildOptions = {}): D2Item {
  const def = itemDef(code);
  if (!def || !isUberCode(code)) throw new Error(`${def?.name ?? code} isn't an uber item`);
  return encodeFull({ code, quality: Quality.Normal, ethereal: false, sockets: 0, stats: [], itemLevel: opts.itemLevel ?? defaultLevel(code), saveVersion: opts.saveVersion ?? 105 });
}

// ---------------------------------------------------------------- magic, rare and crafted items

export type AffixSide = 'prefix' | 'suffix';
export type AffixQuality = 'magic' | 'rare' | 'crafted';

/** One magic prefix or suffix on an item and the value rolled for each of its properties. */
export interface AffixPick extends ModPick {
  side: AffixSide;
}

const fitsTypes = (code: string, itypes: string[], etypes: string[]) => itypes.some((t) => isType(code, t)) && !etypes.some((t) => isType(code, t));

/** Whether an item can have magic, rare or crafted quality at all (weapons, armor, jewelry, charms, jewels). */
export function canHaveAffixes(code: string): boolean {
  const def = itemDef(code);
  if (!def || def.quest || def.stackable || /[RgB]/.test(def.flags)) return false;
  return def.kind !== 'misc' || ['amul', 'ring', 'jewl', 'char'].some((t) => isType(code, t));
}

/** Prefix or suffix rows that can roll on this base (rare and crafted items only use the rows marked for them). */
export function affixRows(side: AffixSide, code: string, quality: AffixQuality = 'magic'): number[] {
  const rows = GD.affixes[side];
  const out: number[] = [];
  rows.forEach((a, i) => {
    if (i && a.spawnable && (quality === 'magic' || a.rare) && a.mods.length && fitsTypes(code, a.itypes, a.etypes)) out.push(i);
  });
  return out;
}

/** The crafting recipe index for a crafted item's name ("Blood Gloves"), or -1. */
export const craftIndex = (name: string) => GD.crafts.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());

/** The bases a crafting recipe takes: one base (and its exceptional and elite versions) or every base of a type. */
export function craftBases(recipe: number): string[] {
  const c = GD.crafts[recipe];
  if (!c) return [];
  if (GD.items[c.input]) return c.upgraded ? GD.items[c.input].tiers ?? [c.input] : [c.input];
  return GD.itemOrder.filter((code, i, all) => all.indexOf(code) === i && isType(code, c.input) && canHaveAffixes(code));
}

export interface AffixItemOptions extends BuildOptions {
  quality: AffixQuality;
  affixes: AffixPick[];
  /** Crafted items: the recipe (see `craftIndex`) and the value of each of its mods. */
  craft?: ModPick;
  /** An automatic mod (class items). */
  auto?: ModPick;
  sockets?: number;
  /** Crafted items only: exactly these stats, as a listing shows them (no affix, recipe or range checks). */
  exactStats?: ItemStat[];
}

const pickOne = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/**
 * Builds a magic (1 prefix and/or 1 suffix), rare (up to 3 + 3) or crafted item (a recipe's mods plus up to 4
 * affixes). Every affix is checked against the base and its value against its range; rare names are picked at
 * random from the ones that fit the base. Armor with Enhanced Defense gets the base's top defense + 1, like a drop.
 */
export function createAffixItem(code: string, opts: AffixItemOptions): D2Item {
  const def = itemDef(code);
  if (!def || !canHaveAffixes(code)) throw new Error(`${def?.name ?? code} can't be magic, rare or crafted`);
  const q = opts.quality;
  const per = { prefix: 0, suffix: 0 };
  const groups = new Set<string>();
  const stats: ItemStat[] = [];
  if (opts.exactStats && q !== 'crafted') throw new Error('Only crafted items are made with exact stats');
  if (opts.exactStats) stats.push(...opts.exactStats);
  else if (q === 'crafted') {
    const c = opts.craft && GD.crafts[opts.craft.row];
    if (!c) throw new Error('A crafted item needs its recipe');
    if (!craftBases(opts.craft!.row).includes(code)) throw new Error(`${c.name} can't be crafted from a ${def.name}`);
    stats.push(...modStats(opts.craft!, c.mods, c.name));
  }
  let lo = 1, hi = 99;
  for (const a of opts.affixes) {
    const row = GD.affixes[a.side][a.row];
    if (!row || !affixRows(a.side, code, q).includes(a.row)) throw new Error(`${def.name} can't roll ${row?.name || 'that affix'}${q === 'magic' ? '' : ` as a ${q} item`}`);
    per[a.side]++;
    const g = `${a.side}:${row.group}`;
    if (q !== 'magic' && groups.has(g)) throw new Error(`${row.name} can't roll together with a similar ${a.side}`);
    groups.add(g);
    lo = Math.max(lo, row.level);
    if (row.maxLevel) hi = Math.min(hi, row.maxLevel);
    stats.push(...modStats(a, row.mods, row.name || a.side));
  }
  const total = per.prefix + per.suffix;
  const maxSide = q === 'magic' ? 1 : 3;
  if (per.prefix > maxSide || per.suffix > maxSide) throw new Error(`A ${q} item has at most ${maxSide} prefix${maxSide > 1 ? 'es' : ''} and ${maxSide} suffix${maxSide > 1 ? 'es' : ''}`);
  const maxTotal = q === 'crafted' ? 4 : q === 'rare' && isType(code, 'jewl') ? 4 : 6;
  if (total > maxTotal) throw new Error(`A ${q} ${def.name} has at most ${maxTotal} affixes`);
  if (q === 'magic' && !total) throw new Error('A magic item needs a prefix or a suffix');
  if (lo > hi) throw new Error("Those affixes can't roll on the same item");
  if (opts.auto) {
    if (!autoRows(code).includes(opts.auto.row)) throw new Error(`${def.name} can't roll ${GD.automagic[opts.auto.row]?.name ?? 'that mod'}`);
    stats.push(...modStats(opts.auto, GD.automagic[opts.auto.row].mods, GD.automagic[opts.auto.row].name));
  }
  const sockets = opts.sockets ?? 0;
  if (sockets < 0 || sockets > maxBaseSockets(code)) throw new Error(`${def.name} can have 0–${maxBaseSockets(code)} sockets`);
  if (opts.ethereal && !canBuildEthereal('base', code)) throw new Error(`${def.name} can't be ethereal`);

  let defense: number | undefined;
  if (def.flags.includes('A')) {
    const dlo = def.minAc ?? 0, dhi = def.maxAc ?? dlo;
    const ed = stats.some((s) => s.id === statByName('item_armor_percent')?.id);
    // with Enhanced Defense a magic or rare drop stores the top defense plus one (real Heavy Boots: 7, top 6)
    defense = ed ? dhi + 1 : opts.defense ?? dlo + Math.floor(Math.random() * (dhi - dlo + 1));
    if (!ed && (defense < dlo || defense > dhi)) throw new Error(`${def.name} defense is ${dlo}–${dhi}`);
  }
  let rare: Encode['rare'];
  if (q !== 'magic') {
    const fits = (i: number) => {
      const f = GD.rareNameFits[i];
      return !!GD.rareNames[i] && !!f && fitsTypes(code, f.itypes, f.etypes);
    };
    const idx = GD.rareNames.map((_, i) => i);
    const first = idx.filter((i) => i >= GD.rarePrefixStart && fits(i));
    const second = idx.filter((i) => i > 0 && i < GD.rarePrefixStart && fits(i));
    const side = (s: AffixSide) => opts.affixes.filter((a) => a.side === s).map((a) => a.row);
    rare = { names: [first.length ? pickOne(first) : 0, second.length ? pickOne(second) : 0], prefixes: side('prefix'), suffixes: side('suffix') };
  }
  const magic = q === 'magic' ? { prefix: opts.affixes.find((a) => a.side === 'prefix')?.row ?? 0, suffix: opts.affixes.find((a) => a.side === 'suffix')?.row ?? 0 } : undefined;
  return encodeFull({
    code,
    quality: q === 'magic' ? Quality.Magic : q === 'rare' ? Quality.Rare : Quality.Crafted,
    magic,
    rare,
    autoRow: opts.auto?.row,
    ethereal: !!opts.ethereal,
    sockets,
    defense,
    stats,
    itemLevel: opts.itemLevel ?? Math.min(hi, Math.max(lo, defaultLevel(code))),
    saveVersion: opts.saveVersion ?? 105,
  });
}
