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
  maxStack?: number;
  invfile?: string;
  /** Belts only: how many potion slots it gives (4, 8, 12 or 16). */
  beltBoxes?: number;
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
}

export interface GemMod {
  code: string;
  param: string;
  min: number;
  max: number;
}

export interface GameData {
  meta: { source: string; builtAt: string };
  stats: StatDef[];
  types: Record<string, TypeDef>;
  items: Record<string, ItemDef>;
  itemOrder: string[];
  uniques: Record<string, { name: string; code: string; levelReq: number; disabled?: boolean; carry1?: number; noChronicle?: boolean }>;
  setItems: Record<string, { name: string; set: string; code: string; levelReq: number; noChronicle?: boolean }>;
  runewords: { row: number; key: string; name: string; complete: boolean; runes: string[]; itypes: string[] }[];
  magicPrefix: (string | null)[];
  magicSuffix: (string | null)[];
  magicPrefixReq: number[];
  magicSuffixReq: number[];
  rareNames: (string | null)[];
  classes: { name: string; allSkills: string; tabs: string[]; classOnly: string }[];
  skills: Record<string, { name: string; cls: number }>;
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
