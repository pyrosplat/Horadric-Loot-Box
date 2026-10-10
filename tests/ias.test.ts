import { describe, expect, it } from 'vitest';
import reference from './fixtures/ias-reference.json';
import skillReference from './fixtures/ias-skills-reference.json';
import matrix from './fixtures/ias-skill-matrix.json';
import { iasTables } from '../src/core/ias';
import { GD } from '../src/core';

// ias-reference.json holds the tables of Warren1001's IAS Calculator (Standard attack, human form, no skills) for one weapon of every
// speed and animation type, for each class: [IAS needed, frames per attack]
describe('IAS tables', () => {
  for (const ref of reference as { cls: string; weapon: string; tables: [number, number][][] }[]) {
    it(`${ref.cls} with ${ref.weapon}`, () => {
      const res = iasTables(ref.cls, ref.weapon, 0)!;
      expect(res.tables.map((t) => t.steps.map((s) => [s.need, s.frames]))).toEqual(ref.tables.map((t) => t.map(([a, b]) => [a, b])));
    });
  }
  const KEYS: Record<string, string> = {
    fanaticismLevel: 'fanaticism',
    burstOfSpeedLevel: 'burstOfSpeed',
    frenzyLevel: 'frenzy',
    chilled: 'chilled',
    decrepify: 'decrepify',
  };
  for (const ref of skillReference as unknown as { cls: string; weapon: string; opts: Record<string, number | boolean>; table: [number, number][] }[]) {
    it(`${ref.cls} with ${ref.weapon} and ${Object.keys(ref.opts).join(', ')}`, () => {
      const opts = Object.fromEntries(Object.entries(ref.opts).map(([k, v]) => [KEYS[k], v]));
      expect(iasTables(ref.cls, ref.weapon, 0, opts)!.tables[0].steps.map((s) => [s.need, s.frames])).toEqual(ref.table.map(([a, b]) => [a, b]));
    });
  }
  // every attack skill of every class with a spread of weapons, in the original's notation (Zeal and Dragon Talon show the frames of each hit)
  it('attack skills match the original calculator', () => {
    const typeOf = (n: string) => Object.values(GD.items).find((i) => i.name === n)?.type;
    for (const r of matrix as { cls: string; skill: string; weapon: string; lvl: number; table: [number, string][] }[]) {
      const res = iasTables(r.cls, r.weapon, 0, { skill: r.skill, skillLevel: r.lvl, weaponType: typeOf(r.weapon) })!;
      expect([r.cls, r.skill, r.weapon, r.lvl, res.tables[0]?.steps.map((s) => [s.need, s.label ?? String(s.frames)])]).toEqual([
        r.cls,
        r.skill,
        r.weapon,
        r.lvl,
        r.table,
      ]);
    }
  });
  it('Fanaticism and slows move the steps', () => {
    const base = iasTables('Paladin', 'Broad Sword', 0)!;
    const fana = iasTables('Paladin', 'Broad Sword', 0, { fanaticism: 20 })!;
    expect(fana.tables[0].frames).toBeLessThan(base.tables[0].frames);
    const chilled = iasTables('Paladin', 'Broad Sword', 0, { chilled: true })!;
    expect(chilled.tables[0].frames).toBeGreaterThan(base.tables[0].frames);
  });
});

describe('attack skill lists per class', () => {
  it('only offers a class its own skills', async () => {
    const { attackSkills, availableForms } = await import('../src/core');
    const classes = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin', 'Warlock'];
    for (const c of classes) {
      const l = attackSkills(c);
      expect(l.includes('Zeal')).toBe(c === 'Paladin');
      expect(l.includes('Whirlwind')).toBe(c === 'Barbarian');
      expect(l.includes('Strafe')).toBe(c === 'Amazon');
      expect(l.includes('Cleave')).toBe(c === 'Warlock');
      expect(availableForms(c)).toEqual(c === 'Druid' ? ['human', 'werewolf', 'werebear'] : ['human']);
    }
    expect(attackSkills('Sorceress', 'human', [123])).toContain('Zeal');
    expect(attackSkills('Assassin', 'human', [151])).toContain('Whirlwind');
    expect(availableForms('Necromancer', [223])).toContain('werewolf');
  });
});
