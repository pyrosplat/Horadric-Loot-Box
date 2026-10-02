import type { D2Character } from './d2s';
import { GD } from './gamedata';

export interface MercInfo {
  /** e.g. "Desert Mercenary" */
  className: string;
  /** Short role, e.g. "Holy Freeze", "Cold Arrow", "Frenzy". */
  role: string;
  /** Difficulty the merc was hired in. */
  difficulty: 'Normal' | 'Nightmare' | 'Hell';
  act: number;
  name?: string;
  level: number;
  exp: number;
  /** The header's merc-dead flag. Not shown: it reads as set on saves whose merc is alive. */
  dead: boolean;
  /** What it can hold, when the kind of mercenary is known. */
  gear?: MercGear;
}

/** What a kind of mercenary holds in its hands. Every mercenary also wears a helm and body armor. */
export interface MercGear {
  /** Item types its weapon can be (itemtypes.txt codes; any one of them). */
  weapons: string[];
  /** The same in words: "bows", "one-handed swords". */
  weaponText: string;
  /** Only weapons held in one hand (not even a two-handed sword a Barbarian could swing with one). */
  oneHanded: boolean;
  /** The second hand: nothing, a shield (Iron Wolves), or a second weapon (the Frenzy Barbarian). */
  offHand: 'none' | 'shield' | 'weapon';
  /** The class whose items it may use (Rogues: Amazon bows; Barbarians: Barbarian helms). */
  cls?: string;
}

/**
 * Hands by the monster the hireling is (hireling.txt Class). The game has these rules built in, not in a table:
 * Rogue 271, Desert Mercenary 338, Iron Wolf 359, Barbarian 561 (Bash, one sword) and 560 (Frenzy, two swords).
 */
const HANDS: Record<number, Omit<MercGear, 'cls'>> = {
  271: { weapons: ['bow'], weaponText: 'bows', oneHanded: false, offHand: 'none' },
  338: { weapons: ['spea', 'pole'], weaponText: 'spears, polearms and javelins', oneHanded: false, offHand: 'none' },
  359: { weapons: ['swor'], weaponText: 'one-handed swords', oneHanded: true, offHand: 'shield' },
  561: { weapons: ['swor'], weaponText: 'swords', oneHanded: false, offHand: 'none' },
  560: { weapons: ['swor'], weaponText: 'one-handed swords', oneHanded: true, offHand: 'weapon' },
};

/** What the character's mercenary can hold, or undefined when there is none or its kind isn't known. */
export function mercGear(ch: Pick<D2Character, 'merc'>): MercGear | undefined {
  const row = ch.merc ? GD.mercs[ch.merc.type] : undefined;
  const hands = row?.unit !== undefined ? HANDS[row.unit] : undefined;
  return hands && { ...hands, cls: row!.eq };
}

const DIFF = ['Normal', 'Normal', 'Nightmare', 'Hell'] as const;
/** Common names for the Act 3 mercs' elements and the Act 5 fighting styles. */
const ROLE: Record<string, string> = {
  'Fire Ball': 'Fire',
  'Ice Blast': 'Cold',
  Lightning: 'Lightning',
  Stun: 'Bash & Stun',
  Taunt: 'Frenzy',
};
const CLASS: Record<string, string> = { 'Eastern Sorceror': 'Iron Wolf' };

/** Experience a mercenary needs for `level` (hireling.txt Exp/Lvl × level² × (level + 1)). */
export const mercExpFor = (expPerLvl: number, level: number) => expPerLvl * level * level * (level + 1);

/** Merc level from its experience (1–98). */
export function mercLevel(expPerLvl: number, exp: number): number {
  let lvl = 1;
  while (lvl < 98 && mercExpFor(expPerLvl, lvl + 1) <= exp) lvl++;
  return lvl;
}

/** What the header says about the character's mercenary, if it has one. */
export function mercInfo(ch: D2Character): MercInfo | undefined {
  const m = ch.merc;
  if (!m) return undefined;
  const row = GD.mercs[m.type];
  if (!row) return { className: `Mercenary (type ${m.type})`, role: '', difficulty: 'Normal', act: 0, level: 0, exp: m.exp, dead: m.dead };
  const last = row.skills[row.skills.length - 1] ?? '';
  return {
    className: CLASS[row.cls] ?? row.cls,
    role: ROLE[last] ?? last,
    difficulty: DIFF[row.diff] ?? 'Normal',
    act: row.act,
    name: GD.mercNames[row.names]?.[m.nameId] || undefined,
    level: mercLevel(row.expPerLvl, m.exp),
    exp: m.exp,
    dead: m.dead,
    gear: mercGear(ch),
  };
}
