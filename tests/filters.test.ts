import { describe, expect, it } from 'vitest';
import { GD, HEROES, heroOf, itemTypeOf, tierOf } from '../src/core';

const codeOf = (name: string) => Object.entries(GD.items).find(([, i]) => i.name === name)![0];

describe('vault filters', () => {
  it('knows the tier of a base', () => {
    expect(tierOf(codeOf('Hand Axe'))).toBe('Normal');
    expect(tierOf(codeOf('Hatchet'))).toBe('Exceptional');
    expect(tierOf(codeOf('Tomahawk'))).toBe('Elite');
    expect(tierOf(codeOf('Amulet'))).toBe('None');
    expect(tierOf(codeOf('Small Charm'))).toBe('None');
  });
  it('knows which class an item is for', () => {
    expect(heroOf(codeOf('Stag Bow'))).toBe('Amazon');
    expect(heroOf(codeOf('Hand Axe'))).toBeUndefined();
    expect(heroOf(codeOf('Wolf Head'))).toBe('Druid');
    const classes = new Set(Object.keys(GD.items).map(heroOf));
    for (const h of HEROES) expect(classes.has(h), h).toBe(true);
  });
  it('has the weapon types the game filters by', () => {
    const types = new Set(Object.keys(GD.items).map(itemTypeOf));
    for (const t of ['Axes', 'Bows', 'Crossbows', 'Daggers', 'Maces', 'Polearms', 'Scepters', 'Spears', 'Javelins', 'Staves', 'Swords', 'Wands', 'Assassin Claws', 'Throwing Axes', 'Throwing Knives']) {
      expect(types.has(t), t).toBe(true);
    }
  });
});
