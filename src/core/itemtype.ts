import { GD } from './gamedata';

/** Groups and item types for the vault's type filter, in display order. */
export const TYPE_GROUPS: { group: string; types: string[] }[] = [
  { group: 'Helms', types: ['Helms', 'Circlets', 'Barbarian Helms', 'Druid Pelts'] },
  { group: 'Armor', types: ['Body Armor', 'Gloves', 'Boots', 'Belts'] },
  { group: 'Shields', types: ['Shields', 'Paladin Shields', 'Necromancer Heads', 'Grimoires'] },
  {
    group: 'Weapons',
    types: [
      'Axes', 'Throwing Axes', 'Bows', 'Amazon Bows', 'Crossbows', 'Daggers', 'Throwing Knives', 'Javelins', 'Amazon Javelins',
      'Spears', 'Amazon Spears', 'Polearms', 'Maces', 'Hammers', 'Scepters', 'Staves', 'Wands', 'Swords', 'Assassin Claws',
      'Sorceress Orbs', 'Throwing Potions', 'Arrows & Bolts',
    ],
  },
  { group: 'Jewelry & Charms', types: ['Amulets', 'Rings', 'Small Charms', 'Large Charms', 'Grand Charms', 'Jewels'] },
  { group: 'Other', types: ['Potions', 'Scrolls & Tomes', 'Keys', 'Quest & Uber Items', 'Other'] },
];

// most specific type codes first: a Barbarian helm is also a helm, an Amazon bow is also a bow…
const BY_TYPE: [string, string][] = [
  ['circ', 'Circlets'], ['phlm', 'Barbarian Helms'], ['pelt', 'Druid Pelts'], ['helm', 'Helms'],
  ['tors', 'Body Armor'], ['glov', 'Gloves'], ['boot', 'Boots'], ['belt', 'Belts'],
  ['ashd', 'Paladin Shields'], ['head', 'Necromancer Heads'], ['grim', 'Grimoires'], ['shld', 'Shields'],
  ['abow', 'Amazon Bows'], ['ajav', 'Amazon Javelins'], ['aspe', 'Amazon Spears'], ['h2h', 'Assassin Claws'], ['orb', 'Sorceress Orbs'],
  ['taxe', 'Throwing Axes'], ['tkni', 'Throwing Knives'], ['tpot', 'Throwing Potions'], ['jave', 'Javelins'],
  ['axe', 'Axes'], ['xbow', 'Crossbows'], ['bow', 'Bows'], ['knif', 'Daggers'], ['pole', 'Polearms'], ['spea', 'Spears'],
  ['hamm', 'Hammers'], ['scep', 'Scepters'], ['staf', 'Staves'], ['wand', 'Wands'], ['club', 'Maces'], ['mace', 'Maces'], ['swor', 'Swords'],
  ['misl', 'Arrows & Bolts'],
  ['amul', 'Amulets'], ['ring', 'Rings'], ['scha', 'Small Charms'], ['mcha', 'Large Charms'], ['lcha', 'Grand Charms'], ['csch', 'Grand Charms'], ['jewl', 'Jewels'],
  ['gem', 'Gems'], ['poti', 'Potions'], ['elix', 'Potions'], ['scro', 'Scrolls & Tomes'], ['book', 'Scrolls & Tomes'], ['key', 'Keys'],
  ['ques', 'Quest & Uber Items'], ['body', 'Quest & Uber Items'], ['play', 'Quest & Uber Items'], ['herb', 'Quest & Uber Items'],
];

/** The filter type of a base item code, e.g. "Barbarian Helms", "Amazon Bows", "Grand Charms". */
export function itemTypeOf(code: string): string {
  const def = GD.items[code];
  if (!def) return 'Other';
  const all = new Set([...(GD.types[def.type]?.all ?? [def.type]), ...(def.type2 ? GD.types[def.type2]?.all ?? [def.type2] : [])]);
  for (const [t, name] of BY_TYPE) if (all.has(t)) return name;
  return 'Other';
}

/** The group a filter type belongs to ("Weapons" for "Swords"…). */
export const groupOfType = (type: string) => TYPE_GROUPS.find((g) => g.types.includes(type))?.group ?? 'Other';

/** Base tier of an item as the game's filter names it: None (charms, jewelry, runes…), Normal, Exceptional or Elite. */
export const TIERS = ['None', 'Normal', 'Exceptional', 'Elite'] as const;
export function tierOf(code: string): (typeof TIERS)[number] {
  return TIERS[GD.items[code]?.tier ?? 0] ?? 'None';
}

/** The classes that have items of their own, in the game's filter order. */
export const HEROES = ['Amazon', 'Assassin', 'Necromancer', 'Sorceress', 'Barbarian', 'Druid', 'Paladin', 'Warlock'] as const;
const HERO_BY_CODE: Record<string, (typeof HEROES)[number]> = { ama: 'Amazon', ass: 'Assassin', nec: 'Necromancer', sor: 'Sorceress', bar: 'Barbarian', dru: 'Druid', pal: 'Paladin', war: 'Warlock' };
/** The class an item is made for (Amazon bows, Paladin shields, Druid pelts…), if any. */
export function heroOf(code: string): (typeof HEROES)[number] | undefined {
  const def = GD.items[code];
  return def ? HERO_BY_CODE[GD.types[def.type]?.cls ?? ''] : undefined;
}

/** Throwing weapons as one filter, like the game's "Throw". */
export const THROWING_TYPES = ['Throwing Axes', 'Throwing Knives', 'Throwing Potions'];
