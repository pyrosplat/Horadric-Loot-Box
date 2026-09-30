import raw from './data/gamedata.json';

export interface StatDef {
  id: number;
  key: string;
  csvSigned: boolean;
  csvBits: number;
  csvParam: number;
  saveBits: number;
  saveAdd: number;
  saveParamBits: number;
  valShift: number;
  descPriority: number;
  descFunc: number;
  descVal: number;
  descPos: string;
  descNeg: string;
  desc2: string;
  dgrp: number;
  dgrpFunc: number;
  dgrpVal: number;
  dgrpPos: string;
  dgrpNeg: string;
  dgrp2: string;
}

export interface ItemDef {
  index: number;
  name: string;
  kind: 'weapon' | 'armor' | 'misc';
  type: string;
  type2?: string;
  /** A=armor W=weapon G=gold C=charm B=body part P=player body part S=scroll/book R=rune g=gem J=jewel Q=quest */
  flags: string;
  w: number;
  h: number;
  compact: number;
  stackable: number;
  quest: number;
  questDiff: number;
  level: number;
  levelReq: number;
  reqStr: number;
  reqDex: number;
  dur: number;
  noDur: number;
  minDam?: number;
  maxDam?: number;
  min2h?: number;
  max2h?: number;
  minMis?: number;
  maxMis?: number;
  oneOrTwo?: boolean;
  twoHanded?: boolean;
  minAc?: number;
  maxAc?: number;
  gemSockets: number;
  gemApply: number;
  tier: number;
  /** Weapons and armor: the normal, exceptional and elite codes of this base. */
  tiers?: string[];
  maxStack?: number;
  invfile?: string;
  /** Belts only: how many potion slots it gives (4, 8, 12 or 16). */
  beltBoxes?: number;
  /** automagic.txt group of the automatic mod this base can roll (paladin shields, necro heads, orbs…). */
  autoPrefix?: number;
}

export interface TypeDef {
  name: string;
  equiv: string[];
  all: string[];
  varInvGfx: number;
  bodyLoc: string[];
  cls?: string;
  throwable: boolean;
  /** Can go in the potion belt. */
  beltable?: boolean;
  maxSockets: number[];
  /** Class code whose skills white and superior items of this type can roll (up to 3, +1 to +3). */
  staffMods?: string;
}

export interface GemMod {
  code: string;
  param: string;
  min: number;
  max: number;
}

/** An item property as the game tables list it: property code, parameter, min and max roll. */
export type PropDef = [code: string, param: string, min: number, max: number];

/** One magic prefix or suffix row. `spawnable` is false for rows that never roll (frequency 0, disabled). */
export interface AffixDef {
  name: string;
  spawnable: boolean;
  /** Can roll on rare and crafted items too. */
  rare: boolean;
  level: number;
  maxLevel?: number;
  /** Class code for class-only affixes ("+3 to Eldritch Skills" on amulets). */
  cls?: string;
  group: number;
  mods: PropDef[];
  itypes: string[];
  etypes: string[];
}

export interface GameData {
  meta: { source: string; builtAt: string };
  stats: StatDef[];
  types: Record<string, TypeDef>;
  items: Record<string, ItemDef>;
  itemOrder: string[];
  uniques: Record<string, { name: string; code: string; levelReq: number; disabled?: boolean; carry1?: number; noChronicle?: boolean; props: PropDef[] }>;
  setItems: Record<string, { name: string; set: string; setKey: string; code: string; levelReq: number; noChronicle?: boolean; props: PropDef[]; partial: [number, PropDef[]][] }>;
  sets: Record<string, { name: string; partial: [number, PropDef[]][]; full: PropDef[] }>;
  runewords: { row: number; key: string; name: string; complete: boolean; runes: string[]; itypes: string[]; props: PropDef[] }[];
  magicPrefix: (string | null)[];
  magicSuffix: (string | null)[];
  magicPrefixReq: number[];
  magicSuffixReq: number[];
  rareNames: (string | null)[];
  /** Which item types each rare name part (same index as rareNames) can go on. */
  /** rareNames is [none, ...raresuffix, ...rareprefix]: the index where the prefixes ("Beast", "Eagle") start. */
  rarePrefixStart: number;
  rareNameFits: ({ itypes: string[]; etypes: string[] } | null)[];
  /** magicprefix.txt / magicsuffix.txt rows in full (the save's affix id is the row). */
  affixes: { prefix: AffixDef[]; suffix: AffixDef[] };
  /** Crafting recipes: the item they're named for ("Blood Gloves"), the base code or type they take (any tier when `upgraded`), and the mods they add. */
  crafts: { name: string; input: string; upgraded: boolean; mods: PropDef[] }[];
  classes: { name: string; allSkills: string; tabs: string[]; classOnly: string }[];
  skills: Record<string, { key: string; name: string; cls: number; page: number; reqLevel: number }>;
  /** playerclass.txt codes by class index ('ama', 'sor', … 'war'). */
  classCodes: string[];
  /** qualityitems.txt: superior mods by row (the save's 3-bit superior id) and which bases they fit. */
  superior: { mods: PropDef[]; fits: string[] }[];
  /** automagic.txt by row (the save's auto-affix id is row + 1). */
  automagic: { name: string; group: number; spawnable: boolean; level: number; maxLevel?: number; levelReq: number; mods: PropDef[]; itypes: string[]; etypes: string[] }[];
  /** hireling.txt by Id: class, act, difficulty hired in, experience factor, skills, index into mercNames. */
  mercs: Record<string, { cls: string; act: number; diff: number; expPerLvl: number; skills: string[]; names: number }>;
  mercNames: string[][];
  gems: Record<string, { name: string; letter?: string; weapon: GemMod[]; helm: GemMod[]; shield: GemMod[] }>;
  properties: Record<string, { func: number; stat?: string; val?: string }[]>;
  ui: Record<string, string>;
}

export const GD = raw as unknown as GameData;

const statByKey = new Map(GD.stats.map((s) => [s.key, s]));

export function statDef(id: number): StatDef {
  const s = GD.stats[id];
  if (!s) throw new Error(`Unknown stat id ${id}`);
  return s;
}

export function statByName(key: string): StatDef | undefined {
  return statByKey.get(key);
}

export function itemDef(code: string): ItemDef | undefined {
  return GD.items[code.trim()];
}

export function isType(code: string, typeCode: string): boolean {
  const def = itemDef(code);
  if (!def) return false;
  if (GD.types[def.type]?.all.includes(typeCode)) return true;
  return !!def.type2 && !!GD.types[def.type2]?.all.includes(typeCode);
}

export const CLASS_NAMES = GD.classes.map((c) => c.name);
