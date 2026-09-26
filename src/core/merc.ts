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
  };
}
