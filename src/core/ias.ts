/**
 * Attack speed (IAS) breakpoints: every attack skill, human form and the werewolf and werebear forms, with one or two weapons.
 *
 * The method and the animation data (frames per direction, action frames, weapon speed modifiers, the skill formulas) come from
 * Warren1001's IAS Calculator, https://warren1001.github.io/IAS_Calculator/ (https://github.com/Warren1001/IAS_Calculator), which in turn
 * credits RuffnecKk (D2RLoader) for the animation data dump, ChthonVII, ubeogesh, the Amazon Basin forum and Phrozen Keep.
 */
import type { BreakpointStep } from './charstats';

export type WeaponKind = 'HTH' | '1HS' | '1HT' | '2HS' | '2HT' | 'STF' | 'BOW' | 'XBW' | 'THR' | 'CLW';

/** Weapon speed modifier and animation type by base weapon name. */
export const WEAPONS: Record<string, [number, WeaponKind]> = {
  // HTH 0
  None: [0, 'HTH'],
  // STF -15
  'Feral Axe': [-15, 'STF'],
  // STF -10
  'Battle Scythe': [-10, 'STF'],
  'Champion Axe': [-10, 'STF'],
  'Giant Thresher': [-10, 'STF'],
  'Gothic Axe': [-10, 'STF'],
  'Great Axe': [-10, 'STF'],
  'Grim Scythe': [-10, 'STF'],
  'Jo Staff': [-10, 'STF'],
  'Large Axe': [-10, 'STF'],
  'Military Axe': [-10, 'STF'],
  Scythe: [-10, 'STF'],
  'Short Staff': [-10, 'STF'],
  Thresher: [-10, 'STF'],
  'Walking Stick': [-10, 'STF'],
  'War Scythe': [-10, 'STF'],
  // STF 0
  'Battle Staff': [0, 'STF'],
  'Bearded Axe': [0, 'STF'],
  'Bec-de-Corbin': [0, 'STF'],
  Bill: [0, 'STF'],
  'Broad Axe': [0, 'STF'],
  'Elder Staff': [0, 'STF'],
  'Gothic Staff': [0, 'STF'],
  'Great Poleaxe': [0, 'STF'],
  Halberd: [0, 'STF'],
  'Long Staff': [0, 'STF'],
  'Ogre Axe': [0, 'STF'],
  Quarterstaff: [0, 'STF'],
  Shillelagh: [0, 'STF'],
  'Silver-edged Axe': [0, 'STF'],
  Voulge: [0, 'STF'],
  // STF 10
  'Ancient Axe': [10, 'STF'],
  'Archon Staff': [10, 'STF'],
  Bardiche: [10, 'STF'],
  'Battle Axe': [10, 'STF'],
  'Cedar Staff': [10, 'STF'],
  'Colossus Voulge': [10, 'STF'],
  'Cryptic Axe': [10, 'STF'],
  Decapitator: [10, 'STF'],
  'Giant Axe': [10, 'STF'],
  'Glorious Axe': [10, 'STF'],
  'Gnarled Staff': [10, 'STF'],
  'Lochaber Axe': [10, 'STF'],
  Maul: [10, 'STF'],
  'Ogre Maul': [10, 'STF'],
  Partizan: [10, 'STF'],
  Poleaxe: [10, 'STF'],
  Stalagmite: [10, 'STF'],
  Tabar: [10, 'STF'],
  'War Club': [10, 'STF'],
  // STF 20
  'Great Maul': [20, 'STF'],
  'Martel de Fer': [20, 'STF'],
  'Rune Staff': [20, 'STF'],
  'Thunder Maul': [20, 'STF'],
  'War Staff': [20, 'STF'],
  // 1HS -30
  Cutlass: [-30, '1HS'],
  'Phase Blade': [-30, '1HS'],
  // 1HS -20
  Ataghan: [-20, '1HS'],
  'Bone Wand': [-20, '1HS'],
  'Lich Wand': [-20, '1HS'],
  Scimitar: [-20, '1HS'],
  'Tomb Wand': [-20, '1HS'],
  // 1HS -10
  'Balanced Axe': [-10, '1HS'],
  Caduceus: [-10, '1HS'],
  Club: [-10, '1HS'],
  Crowbill: [-10, '1HS'],
  'Cryptic Sword': [-10, '1HS'],
  'Crystalline Globe': [-10, '1HS'],
  Cudgel: [-10, '1HS'],
  'Divine Scepter': [-10, '1HS'],
  'Eagle Orb': [-10, '1HS'],
  'Eldritch Orb': [-10, '1HS'],
  'Elegant Blade': [-10, '1HS'],
  Flail: [-10, '1HS'],
  'Glowing Orb': [-10, '1HS'],
  'Heavenly Stone': [-10, '1HS'],
  Hurlbat: [-10, '1HS'],
  Knout: [-10, '1HS'],
  'Long Sword': [-10, '1HS'],
  'Military Pick': [-10, '1HS'],
  'Rune Sword': [-10, '1HS'],
  Sabre: [-10, '1HS'],
  'Sacred Globe': [-10, '1HS'],
  Scourge: [-10, '1HS'],
  Shamshir: [-10, '1HS'],
  Truncheon: [-10, '1HS'],
  'War Scepter': [-10, '1HS'],
  'War Spike': [-10, '1HS'],
  'Winged Axe': [-10, '1HS'],
  // 1HS 0
  'Ancient Sword': [0, '1HS'],
  'Barbed Club': [0, '1HS'],
  'Battle Sword': [0, '1HS'],
  'Berserker Axe': [0, '1HS'],
  'Broad Sword': [0, '1HS'],
  'Burnt Wand': [0, '1HS'],
  'Clasped Orb': [0, '1HS'],
  'Cloudy Sphere': [0, '1HS'],
  'Conquest Sword': [0, '1HS'],
  'Crystal Sword': [0, '1HS'],
  'Demon Heart': [0, '1HS'],
  'Dimensional Blade': [0, '1HS'],
  Falcata: [0, '1HS'],
  'Flanged Mace': [0, '1HS'],
  Gladius: [0, '1HS'],
  'Grave Wand': [0, '1HS'],
  'Grim Wand': [0, '1HS'],
  'Hand Axe': [0, '1HS'],
  Hatchet: [0, '1HS'],
  Mace: [0, '1HS'],
  'Mighty Scepter': [0, '1HS'],
  'Mythical Sword': [0, '1HS'],
  Naga: [0, '1HS'],
  'Polished Wand': [0, '1HS'],
  'Reinforced Mace': [0, '1HS'],
  'Rune Scepter': [0, '1HS'],
  Scepter: [0, '1HS'],
  'Short Sword': [0, '1HS'],
  'Smoked Sphere': [0, '1HS'],
  'Sparkling Ball': [0, '1HS'],
  'Spiked Club': [0, '1HS'],
  Tomahawk: [0, '1HS'],
  'Tyrant Club': [0, '1HS'],
  'Unearthed Wand': [0, '1HS'],
  'Vortex Orb': [0, '1HS'],
  Wand: [0, '1HS'],
  'War Axe': [0, '1HS'],
  'War Sword': [0, '1HS'],
  // 1HS 10
  Axe: [10, '1HS'],
  Cleaver: [10, '1HS'],
  'Devil Star': [10, '1HS'],
  'Dimensional Shard': [10, '1HS'],
  'Double Axe': [10, '1HS'],
  'Ettin Axe': [10, '1HS'],
  'Flying Axe': [10, '1HS'],
  Francisca: [10, '1HS'],
  'Ghost Wand': [10, '1HS'],
  'Grand Scepter': [10, '1HS'],
  'Holy Water Sprinkler': [10, '1HS'],
  'Hydra Edge': [10, '1HS'],
  'Jagged Star': [10, '1HS'],
  "Jared's Stone": [10, '1HS'],
  'Morning Star': [10, '1HS'],
  'Petrified Wand': [10, '1HS'],
  'Seraph Rod': [10, '1HS'],
  'Small Crescent': [10, '1HS'],
  'Swirling Crystal': [10, '1HS'],
  'Throwing Axe': [10, '1HS'],
  'Twin Axe': [10, '1HS'],
  'Yew Wand': [10, '1HS'],
  // 1HS 20
  'Battle Hammer': [20, '1HS'],
  Falchion: [20, '1HS'],
  'Legendary Mallet': [20, '1HS'],
  Tulwar: [20, '1HS'],
  'War Hammer': [20, '1HS'],
  // XBW -60
  'Chu-Ko-Nu': [-60, 'XBW'],
  'Demon Crossbow': [-60, 'XBW'],
  // XBW -40
  'Repeating Crossbow': [-40, 'XBW'],
  // XBW -10
  Arbalest: [-10, 'XBW'],
  'Light Crossbow': [-10, 'XBW'],
  'Pellet Bow': [-10, 'XBW'],
  // XBW 0
  Crossbow: [0, 'XBW'],
  'Gorgon Crossbow': [0, 'XBW'],
  'Siege Crossbow': [0, 'XBW'],
  // XBW 10
  Ballista: [10, 'XBW'],
  'Colossus Crossbow': [10, 'XBW'],
  'Heavy Crossbow': [10, 'XBW'],
  // BOW -10
  'Blade Bow': [-10, 'BOW'],
  'Composite Bow': [-10, 'BOW'],
  'Double Bow': [-10, 'BOW'],
  'Great Bow': [-10, 'BOW'],
  "Hunter's Bow": [-10, 'BOW'],
  'Matriarchal Bow': [-10, 'BOW'],
  'Razor Bow': [-10, 'BOW'],
  // BOW 0
  'Ashwood Bow': [0, 'BOW'],
  'Cedar Bow': [0, 'BOW'],
  'Diamond Bow': [0, 'BOW'],
  'Long Bow': [0, 'BOW'],
  'Rune Bow': [0, 'BOW'],
  'Shadow Bow': [0, 'BOW'],
  'Short Battle Bow': [0, 'BOW'],
  'Short Siege Bow': [0, 'BOW'],
  'Short War Bow': [0, 'BOW'],
  'Stag Bow': [0, 'BOW'],
  'Ward Bow': [0, 'BOW'],
  // BOW 5
  'Edge Bow': [5, 'BOW'],
  'Short Bow': [5, 'BOW'],
  'Spider Bow': [5, 'BOW'],
  // BOW 10
  'Ceremonial Bow': [10, 'BOW'],
  'Crusader Bow': [10, 'BOW'],
  'Gothic Bow': [10, 'BOW'],
  'Grand Matron Bow': [10, 'BOW'],
  'Hydra Bow': [10, 'BOW'],
  'Large Siege Bow': [10, 'BOW'],
  'Long Battle Bow': [10, 'BOW'],
  'Long War Bow': [10, 'BOW'],
  'Reflex Bow': [10, 'BOW'],
  // 1HT -20
  'Balanced Knife': [-20, '1HT'],
  'Bone Knife': [-20, '1HT'],
  Cinquedeas: [-20, '1HT'],
  Dagger: [-20, '1HT'],
  'Fanged Knife': [-20, '1HT'],
  Kris: [-20, '1HT'],
  Poignard: [-20, '1HT'],
  'War Dart': [-20, '1HT'],
  'Winged Knife': [-20, '1HT'],
  // 1HT -10
  Blade: [-10, '1HT'],
  'Ceremonial Javelin': [-10, '1HT'],
  Harpoon: [-10, '1HT'],
  'Hyperion Javelin': [-10, '1HT'],
  Javelin: [-10, '1HT'],
  'Legend Spike': [-10, '1HT'],
  'Maiden Javelin': [-10, '1HT'],
  'Matriarchal Javelin': [-10, '1HT'],
  Stiletto: [-10, '1HT'],
  'Throwing Spear': [-10, '1HT'],
  'War Javelin': [-10, '1HT'],
  'Winged Harpoon': [-10, '1HT'],
  // 1HT 0
  'Battle Dart': [0, '1HT'],
  Dirk: [0, '1HT'],
  'Flying Knife': [0, '1HT'],
  'Great Pilum': [0, '1HT'],
  'Mithril Point': [0, '1HT'],
  Pilum: [0, '1HT'],
  Rondel: [0, '1HT'],
  'Stygian Pilum': [0, '1HT'],
  'Throwing Knife': [0, '1HT'],
  // 1HT 10
  'Balrog Spear': [10, '1HT'],
  'Short Spear': [10, '1HT'],
  Simbilan: [10, '1HT'],
  // 1HT 20
  'Ghost Glaive': [20, '1HT'],
  Glaive: [20, '1HT'],
  Spiculum: [20, '1HT'],
  // 2HS -15
  'Legend Sword': [-15, '2HS'],
  // 2HS -10
  'Champion Sword': [-10, '2HS'],
  Flamberge: [-10, '2HS'],
  Zweihander: [-10, '2HS'],
  // 2HS -5
  'Highland Blade': [-5, '2HS'],
  // 2HS 0
  'Balrog Blade': [0, '2HS'],
  Espandon: [0, '2HS'],
  'Giant Sword': [0, '2HS'],
  'Tusk Sword': [0, '2HS'],
  'Two-Handed Sword': [0, '2HS'],
  // 2HS 5
  'Colossus Blade': [5, '2HS'],
  // 2HS 10
  'Bastard Sword': [10, '2HS'],
  Claymore: [10, '2HS'],
  'Colossus Sword': [10, '2HS'],
  'Dacian Falx': [10, '2HS'],
  'Executioner Sword': [10, '2HS'],
  'Gothic Sword': [10, '2HS'],
  'Great Sword': [10, '2HS'],
  // CLW -30
  'Greater Talons': [-30, 'CLW'],
  'Runic Talons': [-30, 'CLW'],
  // CLW -20
  'Blade Talons': [-20, 'CLW'],
  'Feral Claws': [-20, 'CLW'],
  'Greater Claws': [-20, 'CLW'],
  // CLW -10
  'Battle Cestus': [-10, 'CLW'],
  Claws: [-10, 'CLW'],
  'Hand Scythe': [-10, 'CLW'],
  Katar: [-10, 'CLW'],
  'Scissors Katar': [-10, 'CLW'],
  'Wrist Spike': [-10, 'CLW'],
  'Wrist Sword': [-10, 'CLW'],
  // CLW 0
  Cestus: [0, 'CLW'],
  Quhab: [0, 'CLW'],
  'Scissors Quhab': [0, 'CLW'],
  'Scissors Suwayyah': [0, 'CLW'],
  Suwayyah: [0, 'CLW'],
  'Wrist Blade': [0, 'CLW'],
  // CLW 10
  Fascia: [10, 'CLW'],
  'Hatchet Hands': [10, 'CLW'],
  'War Fist': [10, 'CLW'],
  // 2HT -20
  Brandistock: [-20, '2HT'],
  Mancatcher: [-20, '2HT'],
  'War Fork': [-20, '2HT'],
  // 2HT -10
  'Hyperion Spear': [-10, '2HT'],
  Spear: [-10, '2HT'],
  'War Spear': [-10, '2HT'],
  // 2HT 0
  'Ceremonial Spear': [0, '2HT'],
  Fuscina: [0, '2HT'],
  'Ghost Spear': [0, '2HT'],
  'Maiden Spear': [0, '2HT'],
  'Matriarchal Spear': [0, '2HT'],
  Spetum: [0, '2HT'],
  'Stygian Pike': [0, '2HT'],
  Trident: [0, '2HT'],
  Yari: [0, '2HT'],
  // 2HT 10
  'Maiden Pike': [10, '2HT'],
  // 2HT 20
  'Ceremonial Pike': [20, '2HT'],
  Lance: [20, '2HT'],
  'Matriarchal Pike': [20, '2HT'],
  Pike: [20, '2HT'],
  'War Pike': [20, '2HT'],
};

/** [frames per direction, action frame] or [frames per direction, alternate frames per direction, action frame]; throwing has no action frame for most classes. */
type Anim = number[];
const FRAMES: Record<string, Partial<Record<WeaponKind, Anim>>> = {
  Amazon: {
    HTH: [13, 8],
    '1HS': [16, 10],
    '1HT': [15, 9],
    '2HS': [20, 12],
    '2HT': [18, 11],
    STF: [20, 12],
    BOW: [14, 6],
    XBW: [20, 9],
    THR: [16],
  },
  Assassin: {
    HTH: [11, 12, 6],
    CLW: [11, 12, 6],
    '1HS': [15, 7],
    '1HT': [15, 7],
    '2HS': [23, 11],
    '2HT': [23, 10],
    STF: [19, 9],
    BOW: [16, 7],
    XBW: [21, 10],
    THR: [16],
  },
  Barbarian: {
    HTH: [12, 6],
    '1HS': [16, 7],
    '1HT': [16, 7],
    '2HS': [18, 8],
    '2HT': [19, 9],
    STF: [19, 9],
    BOW: [15, 7],
    XBW: [20, 10],
    THR: [16],
  },
  Druid: {
    HTH: [16, 8],
    '1HS': [19, 9],
    '1HT': [19, 8],
    '2HS': [21, 10],
    '2HT': [23, 9],
    STF: [17, 9],
    BOW: [16, 8],
    XBW: [20, 10],
    THR: [18],
  },
  Necromancer: {
    HTH: [15, 8],
    '1HS': [19, 9],
    '1HT': [19, 9],
    '2HS': [23, 11],
    '2HT': [24, 10],
    STF: [20, 11],
    BOW: [18, 9],
    XBW: [20, 11],
    THR: [20],
  },
  Paladin: {
    HTH: [14, 7],
    '1HS': [15, 7],
    '1HT': [17, 8],
    '2HS': [18, 19, 8],
    '2HT': [20, 8],
    STF: [18, 9],
    BOW: [16, 8],
    XBW: [20, 10],
    THR: [16],
  },
  Sorceress: {
    HTH: [16, 9],
    '1HS': [20, 12],
    '1HT': [19, 11],
    '2HS': [24, 14],
    '2HT': [23, 13],
    STF: [18, 11],
    BOW: [17, 9],
    XBW: [20, 11],
    THR: [20],
  },
  Warlock: {
    HTH: [16, 9],
    '1HS': [16, 9],
    '1HT': [16, 8],
    '2HS': [19, 11],
    '2HT': [21, 23, 11],
    STF: [17, 10],
    BOW: [17, 11],
    XBW: [18, 10],
    THR: [20, 10],
  },
};

const trunc = (x: number) => (x < 0 ? Math.ceil(x) : Math.floor(x));
/** Item IAS to effective IAS (diminishing returns), and back. */
export const effectiveIas = (ias: number) => trunc((120 * ias) / (120 + ias));
const iasOf = (eias: number) => Math.ceil((120 * eias) / (120 - eias));
const diminishing = (p1: number, p2: number, lvl: number, max = -1) => {
  if (lvl <= 0) return 0;
  const v = p1 + trunc(((p2 - p1) * trunc((110 * lvl) / (lvl + 6))) / 100);
  return max !== -1 && v > max ? max : v;
};

export type Form = 'human' | 'werewolf' | 'werebear';

interface SkillDef {
  /** can swing two weapons at once (Barbarian and Assassin) */
  dual?: boolean;
  /** only works with two weapons */
  dualOnly?: boolean;
  /** one animation for a sequence of hits: no -1 frame and a -30 speed penalty */
  sequence?: boolean;
  /** hits roll back to an earlier frame of the animation */
  rollback?: boolean;
}
const SKILLS: Record<string, SkillDef> = {
  Standard: { dual: true },
  Throw: {},
  Kick: {},
  Strafe: { rollback: true },
  Jab: { sequence: true },
  Impale: { sequence: true },
  Fend: { rollback: true },
  'Laying Traps': {},
  'Dragon Talon': { rollback: true },
  'Tiger Strike': {},
  'Cobra Strike': {},
  'Phoenix Strike': {},
  'Fists of Fire': { dual: true, sequence: true },
  'Claws of Thunder': { dual: true, sequence: true },
  'Blades of Ice': { dual: true, sequence: true },
  'Dragon Tail': {},
  'Dragon Claw': { dual: true, dualOnly: true, sequence: true },
  Frenzy: { dual: true, dualOnly: true, sequence: true },
  'Double Swing': { dual: true, dualOnly: true, sequence: true },
  Whirlwind: { dual: true },
  Concentrate: {},
  Berserk: {},
  Bash: {},
  Stun: {},
  'Double Throw': { dual: true, dualOnly: true, sequence: true },
  'Feral Rage': {},
  Hunger: {},
  Rabies: {},
  Fury: {},
  Smite: {},
  Zeal: { rollback: true },
  Sacrifice: {},
  Vengeance: {},
  Conversion: {},
  Cleave: { sequence: true },
  'Mirrored Blades': { sequence: true },
};

/** The attack skills the tables cover, in the order the original lists them. */
export const GEAR_SKILL = { zeal: 123, whirlwind: 151, werewolf: 223, werebear: 228 } as const;

/** The forms this character can take: a Druid always, anyone else only when gear grants Werewolf or Werebear. */
export function availableForms(className: string, gearSkills: number[] = []): Form[] {
  const out: Form[] = ['human'];
  if (className === 'Druid' || gearSkills.includes(GEAR_SKILL.werewolf)) out.push('werewolf');
  if (className === 'Druid' || gearSkills.includes(GEAR_SKILL.werebear)) out.push('werebear');
  return out;
}

/** The attack skills the tables cover. Class skills only, plus Zeal or Whirlwind when gear grants them to another class. */
export function attackSkills(className: string, form: Form = 'human', gearSkills: number[] = []): string[] {
  const out = ['Standard'];
  if (form === 'human') out.push('Throw');
  out.push('Kick');
  const wolf = ['Fury', 'Rabies', 'Feral Rage', 'Hunger'];
  if (form === 'werewolf') out.push(...wolf);
  else if (form === 'werebear') {
    if (className === 'Druid') out.push('Hunger');
  } else {
    out.push(
      ...({
        Amazon: ['Strafe', 'Jab', 'Impale', 'Fend'],
        Assassin: [
          'Laying Traps',
          'Dragon Talon',
          'Tiger Strike',
          'Cobra Strike',
          'Phoenix Strike',
          'Fists of Fire',
          'Claws of Thunder',
          'Blades of Ice',
          'Dragon Tail',
          'Dragon Claw',
          'Whirlwind',
        ],
        Barbarian: ['Frenzy', 'Double Swing', 'Whirlwind', 'Concentrate', 'Berserk', 'Bash', 'Stun', 'Double Throw'],
        Paladin: ['Smite', 'Zeal', 'Sacrifice', 'Vengeance', 'Conversion'],
        Warlock: ['Cleave', 'Mirrored Blades'],
      }[className] ?? []),
    );
    if (className !== 'Paladin' && gearSkills.includes(GEAR_SKILL.zeal)) out.push('Zeal');
    if (className === 'Assassin' && !gearSkills.includes(GEAR_SKILL.whirlwind)) out.splice(out.indexOf('Whirlwind'), 1);
  }
  return out.filter((s, i) => out.indexOf(s) === i);
}
/** Skills whose own level adds speed. */
export const LEVELLED_SKILLS = ['Cleave', 'Mirrored Blades'];

/** The skill ids of the auras and effects an item can give (the aura stat's parameter). */
export const AURA_SKILL = { fanaticism: 122, burstOfSpeed: 258, holyFreeze: 114 } as const;

/** Everything that speeds the attack up or slows it down besides gear; levels are the levels you have, 0 for off. */
export interface IasOptions {
  /** skill ids the gear grants (to allow Zeal or Whirlwind outside their class) */
  gearSkills?: number[];
  skill?: string;
  form?: Form;
  /** Fanaticism and Burst of Speed can come from any class's gear or mercenary, the others from the class's own skills. */
  fanaticism?: number;
  burstOfSpeed?: number;
  frenzy?: number;
  werewolf?: number;
  maul?: number;
  purge?: number;
  /** The level of the attack skill itself when it adds speed (Cleave, Mirrored Blades). */
  skillLevel?: number;
  holyFreeze?: number;
  markOfTheBear?: boolean;
  decrepify?: boolean;
  chilled?: boolean;
  lethargy?: boolean;
  /** Barbarian only: a two-handed sword held in one hand. */
  oneHanded?: boolean;
  /** Base item type code of the main-hand weapon (jave, spea, ...), for the skills that need a javelin or spear. */
  weaponType?: string;
  /** The weapon in the off hand (Barbarian and Assassin): its name, base type code and its own IAS. */
  off?: { name?: string; type?: string; ias: number };
  /** The main-hand weapon's own IAS; only needed with an off-hand weapon. */
  mainIas?: number;
}

export interface IasTable {
  variant?: string;
  /** What the attack costs at the IAS you have: frames, or for the skills with several hits the frames of each hit. */
  frames: number;
  label: string;
  /** The IAS this table is judged against. */
  current: number;
  steps: BreakpointStep[];
  note?: string;
}

export interface IasResult {
  weapon: string;
  tables: IasTable[];
  /** Gear IAS that counts. */
  ias: number;
  eias: number;
  /** Set when the skill can't be used with the weapon. */
  problem?: string;
  /** What the tables count: all IAS, or what's left once the weapons' own are taken off. */
  notes: string[];
}

type Raw = { eias: number[]; rows: [number, number | string][] };
interface Hand {
  name: string;
  wsm: number;
  kind: WeaponKind;
  type?: string;
  ias: number;
}

const MELEE: WeaponKind[] = ['HTH', '1HS', '1HT', '2HS', '2HT', 'STF', 'CLW', 'THR'];
const THROWN = ['tkni', 'taxe', 'jave', 'ajav'];
const POLE_AND_SPEAR = ['jave', 'spea', 'ajav', 'aspe'];

const hand = (name: string | undefined, type: string | undefined, ias: number): Hand => {
  const n = name && WEAPONS[name] ? name : 'None';
  return { name: n, wsm: WEAPONS[n][0], kind: WEAPONS[n][1], type, ias };
};

/**
 * Frames per animation (FPA) for each step of IAS a skill, weapon and class give. `gearIas` is the IAS from everything but the weapon in
 * your main hand (the table counts the weapon's own IAS with it) unless an off-hand weapon is given, then the weapons' IAS are kept apart.
 */
export function iasTables(className: string, weaponName: string | undefined, gearIas: number, opts: IasOptions = {}): IasResult | undefined {
  const classFrames = FRAMES[className];
  if (!classFrames) return undefined;
  const form: Form = opts.form ?? 'human';
  const skillName = opts.skill && attackSkills(className, form, opts.gearSkills).includes(opts.skill) ? opts.skill : 'Standard';
  const sk = SKILLS[skillName];
  const main = hand(weaponName, opts.weaponType, opts.mainIas ?? 0);
  const off = opts.off ? hand(opts.off.name, opts.off.type, opts.off.ias) : undefined;
  const notes: string[] = [];
  const fail = (problem: string): IasResult => ({ weapon: main.name, tables: [], ias: gearIas, eias: 0, problem, notes });
  const level = opts.skillLevel ?? 0;
  const dualClass = className === 'Barbarian' || className === 'Assassin';
  const dualMain = className === 'Assassin' ? main.kind === 'CLW' : ['1HS', '1HT', '2HS'].includes(main.kind);
  const secondSet = !!off && off.kind !== 'HTH' && dualClass && dualMain && form === 'human' && !!sk.dual;
  const cls = (h: Hand) => {
    const t = h.type ?? '';
    return { thrown: THROWN.includes(t), spear: POLE_AND_SPEAR.includes(t) };
  };

  // --- weapon and skill checks, as the original's "can this be equipped"
  const melee = (h: Hand) => MELEE.includes(h.kind);
  if (form === 'human') {
    if ((skillName === 'Throw' || skillName === 'Double Throw') && !cls(main).thrown) return fail(`${skillName} needs a throwing weapon or javelin.`);
    if (skillName === 'Strafe' && main.kind !== 'BOW' && main.kind !== 'XBW') return fail('Strafe needs a bow or crossbow.');
    if (className === 'Amazon' && ['Jab', 'Impale', 'Fend'].includes(skillName) && !cls(main).spear) return fail(`${skillName} needs a javelin or spear.`);
    if (skillName === 'Dragon Claw' && main.kind !== 'CLW') return fail('Dragon Claw needs claws.');
    if (['Tiger Strike', 'Cobra Strike', 'Phoenix Strike'].includes(skillName) && !melee(main)) return fail(`${skillName} needs a melee weapon.`);
    if (className === 'Assassin' && ['Fists of Fire', 'Claws of Thunder', 'Blades of Ice', 'Whirlwind'].includes(skillName) && main.kind !== 'CLW')
      return fail(`${skillName} needs claws.`);
    if (
      className === 'Barbarian' &&
      ['Double Swing', 'Frenzy'].includes(skillName) &&
      (main.kind === 'HTH' || !['1HS', '1HT', '2HS', 'THR'].includes(main.kind))
    )
      return fail(`${skillName} needs a one-handed weapon or a two-handed sword.`);
    if (skillName === 'Cleave' && (!melee(main) || main.kind === 'HTH')) return fail('Cleave needs a melee weapon.');
    if (skillName === 'Mirrored Blades' && main.kind === 'HTH') return fail('Mirrored Blades needs a weapon.');
    if (skillName === 'Zeal' && className !== 'Paladin' && !melee(main)) return fail('Zeal needs a melee weapon.');
  }

  const kindFor = (k: WeaponKind) => (className === 'Barbarian' && k === '2HS' && (opts.oneHanded || secondSet) ? '1HS' : k);
  const frames = (k: WeaponKind) => classFrames[kindFor(k)];

  // the length of the animation for this weapon in human form (the original's calculateFramesPerDirection)
  const sequenceFpd = (k: WeaponKind): number | undefined => {
    switch (skillName) {
      case 'Jab':
        return k === '1HT' ? 18 : k === '2HT' ? 21 : k === 'HTH' ? 13 : undefined;
      case 'Impale':
        return k === '1HT' ? 21 : k === '2HT' ? 24 : k === 'HTH' ? 13 : undefined;
      case 'Double Swing':
      case 'Frenzy':
        return 17;
      case 'Double Throw':
        return 12;
      case 'Fists of Fire':
      case 'Claws of Thunder':
      case 'Blades of Ice':
      case 'Dragon Claw':
        return secondSet ? 16 : 12;
      case 'Cleave':
        return ({ '1HS': 16, '1HT': 16, '2HS': 18, '2HT': 20, STF: 22 } as Partial<Record<WeaponKind, number>>)[k];
      case 'Mirrored Blades':
        return ({ HTH: 17, '1HS': 16, '1HT': 16, '2HS': 19, '2HT': 21, BOW: 18, XBW: 18, STF: 17 } as Partial<Record<WeaponKind, number>>)[k];
    }
    return undefined;
  };
  const humanFpd = (h: Hand): number | undefined => {
    if (skillName === 'Kick') return className === 'Assassin' ? 13 : 12;
    let f: number | undefined = frames(h.kind)?.[0];
    if (skillName === 'Throw') f = classFrames.THR?.[0];
    else if (skillName === 'Dragon Tail' || skillName === 'Dragon Talon') f = 13;
    else if (skillName === 'Smite') f = 12;
    else if (skillName === 'Laying Traps') f = 8;
    else if (sk.sequence) f = sequenceFpd(kindFor(h.kind));
    return f;
  };
  const actionFrame = (h: Hand): number | undefined => {
    if (skillName === 'Dragon Talon') return 4;
    const k = className === 'Barbarian' && h.kind === '2HS' && (opts.oneHanded || skillName === 'Whirlwind' || secondSet) ? '1HS' : h.kind;
    const a = classFrames[k];
    return a?.[a.length - 1];
  };
  const fpd1For = (h: Hand, primary: boolean): number | undefined => {
    if (primary || skillName === 'Whirlwind') {
      if (skillName === 'Fury') return 7;
      if (skillName === 'Hunger' || skillName === 'Rabies') return 10;
      if (form === 'werewolf') return 13;
      if (form === 'werebear') return 12;
      if (['Dragon Talon', 'Strafe', 'Zeal', 'Fend', 'Whirlwind'].includes(skillName)) return actionFrame(h);
      return humanFpd(h);
    }
    return 12;
  };
  const fpd2For = (h: Hand): number | undefined => {
    if (skillName === 'Fury') return 13;
    if (form === 'werewolf') return 9;
    if (form === 'werebear') return 10;
    return humanFpd(h);
  };
  const fpd3 = form === 'werewolf' ? 13 : form === 'werebear' ? 12 : -1;
  const animationSpeed = (h: Hand, fpd1: number) => {
    if (className === 'Druid' && skillName === 'Kick' && (main.kind === '1HS' || main.kind === '2HS')) return 224;
    if (skillName === 'Laying Traps') return 128;
    if (h.kind === 'CLW' && !['Fists of Fire', 'Claws of Thunder', 'Blades of Ice', 'Dragon Claw', 'Dragon Tail', 'Dragon Talon'].includes(skillName))
      return form === 'human' && fpd1 === 12 ? 227 : 208;
    return 256;
  };
  const startingFrame = (h: Hand) => {
    if ((className === 'Amazon' || className === 'Sorceress') && ['Standard', 'Fend', 'Zeal'].includes(skillName)) {
      if (h.kind === 'HTH') return 1;
      if (['1HS', '2HS', '1HT', '2HT', 'STF'].includes(h.kind)) return 2;
    }
    return 0;
  };

  // speed from skills, auras and curses
  const sias =
    diminishing(10, 40, opts.fanaticism ?? 0) +
    diminishing(15, 60, opts.burstOfSpeed ?? 0) +
    (form === 'werewolf' ? diminishing(10, 80, opts.werewolf ?? 0) : 0) +
    (form === 'werebear' && className === 'Druid' && (opts.maul ?? 0) > 0 ? 3 * (trunc((opts.maul ?? 0) / 2) + 3) : 0) +
    (className === 'Barbarian' ? diminishing(0, 50, opts.frenzy ?? 0) : 0) +
    (className === 'Warlock' && (opts.purge ?? 0) > 0 ? Math.min(30, Math.max(0, 10 + ((opts.purge ?? 0) - 1))) : 0) +
    (skillName === 'Cleave' || skillName === 'Mirrored Blades' ? diminishing(10, 30, level) : 0) -
    diminishing(25, 60, opts.holyFreeze ?? 0, 50) +
    (opts.markOfTheBear ? 25 : 0) -
    (opts.decrepify ? 50 : 0) -
    (opts.chilled ? 50 : 0) -
    (opts.lethargy ? 50 : 0) -
    (sk.sequence ? 30 : 0) +
    (skillName === 'Double Swing' ? 50 : skillName === 'Dragon Tail' ? -40 : skillName === 'Impale' ? 30 : 0);
  const limit = (e: number) => Math.max(-85, Math.min(form !== 'human' ? 150 : 75, e));
  const dualSequence = sk.dualOnly && dualClass;
  if (form === 'human' && dualSequence && !secondSet) return fail(`${skillName} needs a weapon in each hand.`);
  const max = className === 'Barbarian' || ['HTH', 'CLW', '1HS', '1HT', 'THR'].includes(main.kind) ? 88 : 83;

  // [EIAS, SIAS, WSM1, WSM2, IEIAS, GIAS, IAS1, IAS2], as the original returns them
  const eiasValues = (primary: boolean, g: number, i1: number, i2: number): number[] => {
    const a = primary ? main : (off ?? hand(undefined, undefined, 0));
    const b = primary ? (off ?? hand(undefined, undefined, 0)) : main;
    if (dualSequence) {
      const wsm = (a.wsm + b.wsm) / 2;
      const ieias = (effectiveIas(g + i1) + effectiveIas(g + i2)) / 2;
      return [trunc(sias - wsm + ieias), sias, a.wsm, b.wsm, ieias, g, i1, i2];
    }
    const ieias = effectiveIas(g + i1);
    return [sias - a.wsm + ieias, sias, a.wsm, -1, ieias, g, i1, -1];
  };

  const labelOf = (h: number[]) => {
    const n = h.length;
    if (n === 2) return `(${h[0]})+${h[1]}`;
    if (n === 3) return h[0] === h[1] ? `(${h[0]})+${h[2]}` : `${h[0]}+(${h[1]})+${h[2]}`;
    if (n === 5) {
      if (h[1] === h[2]) return `${h[0]}+(${h[1]})+${h[4]}`;
      if (h[1] === h[3]) return `${h[0]}+${h[1]}+(${h[2]}+${h[3]})+${h[4]}`;
      return `${h[0]}+${h[1]}+(${h[2]})+${h[4]}`;
    }
    if (h[1] === h[3]) return h[2] === h[3] ? `${h[0]}+(${h[1]})+${h[n - 1]}` : `${h[0]}+(${h[1]}+${h[2]})+${h[n - 1]}`;
    return `${h[0]}+${h[1]}+(${h[2]})+${h[n - 1]}`;
  };
  const rollbackSkill = ['Fury', 'Strafe', 'Fend', 'Dragon Talon', 'Zeal'].includes(skillName);

  // the lengths of the animation(s) at one animation speed: [table 0, table 1 (Strafe and Fend)]
  const hitsAt = (h: Hand, fpd1: number, speed: number): { x: number | string; key: string }[] => {
    const f2 = fpd2For(h) ?? 0;
    const start = startingFrame(h);
    const offset = sk.sequence || sk.rollback || skillName === 'Whirlwind' ? 0 : 1;
    let first = (256 * (fpd1 - start)) / speed;
    first = skillName === 'Whirlwind' ? trunc(first) : Math.ceil(first) - offset;
    if (!rollbackSkill) return [{ x: first, key: String(first) }];
    const hits = skillName === 'Zeal' || skillName === 'Dragon Talon' ? 1 : skillName === 'Fury' ? 3 : 4;
    const factor = skillName === 'Fury' ? 70 : skillName === 'Strafe' ? 50 : skillName === 'Fend' ? 30 : 100;
    const lengths = [first];
    const rolls = [start];
    let odd: number[] | undefined;
    for (let i = 0; i < hits; i++) {
      const rb = trunc((trunc((256 * rolls[i] + speed * lengths[i]) / 256) * (100 - factor)) / 100);
      rolls.push(rb);
      lengths.push(Math.ceil((256 * (fpd1 - rb)) / speed));
      if ((skillName === 'Strafe' || skillName === 'Fend') && i === hits - 2) odd = [...lengths, Math.ceil((256 * (f2 - rolls[rolls.length - 1])) / speed) - 1];
    }
    lengths.push(Math.ceil((256 * (f2 - rolls[rolls.length - 1])) / speed) - 1);
    const out = [{ x: labelOf(lengths), key: lengths.join() }];
    if (odd) out.push({ x: labelOf(odd), key: odd.join() });
    return out;
  };

  const speedFor = (h: Hand, fpd1: number, eias: number, accel: number) => {
    const as = animationSpeed(h, fpd1);
    if (form === 'human') return trunc((as * (100 + limit(eias + accel))) / 100);
    const human = humanFpd(h) ?? 1;
    return trunc((as + trunc((as * limit(eias + accel)) / 100)) * (fpd3 / human));
  };

  // the table of one hand: [needed EIAS, length] rows, keyed on speed changes (the original's doCoreTableLogic)
  const coreTable = (h: Hand, fpd1: number, primary: boolean, i1: number, i2: number): Raw[] => {
    const ev = eiasValues(primary, 0, i1, i2);
    const tables: Raw[] = [{ eias: ev, rows: [] }];
    if (skillName === 'Strafe' || skillName === 'Fend') tables.push({ eias: ev, rows: [] });
    const prev: string[] = ['', ''];
    let lastSpeed = 0;
    for (let accel = 0; accel <= max; accel++) {
      const speed = speedFor(h, fpd1, ev[0], accel);
      if (speed === lastSpeed) continue;
      lastSpeed = speed;
      const hits = hitsAt(h, fpd1, speed);
      hits.forEach(({ x, key }, t) => {
        if (prev[t] !== key) {
          prev[t] = key;
          tables[t].rows.push([accel + ev[0], x]);
        }
      });
    }
    return tables;
  };
  const toSteps = (t: Raw): BreakpointStep[] => {
    const steps: BreakpointStep[] = [];
    t.rows.forEach(([needed, x], i) => {
      let v = Math.max(0, iasOf(needed - t.eias[1] + t.eias[2]) - t.eias[5] - t.eias[6]);
      if (i === 0 && v < 0) v = 0;
      steps.push({ frames: typeof x === 'number' ? x : parseInt(x, 10) || 0, label: typeof x === 'number' ? undefined : x, need: v });
    });
    return steps;
  };
  const nowFor = (h: Hand, fpd1: number, primary: boolean, g: number, i1: number, i2: number): (number | string)[] => {
    const ev = eiasValues(primary, g, i1, i2);
    return hitsAt(h, fpd1, speedFor(h, fpd1, ev[0], 0)).map((r) => r.x);
  };
  const mk = (steps: BreakpointStep[], now: number | string, current: number, variant?: string, note?: string): IasTable => ({
    variant,
    frames: typeof now === 'number' ? now : parseInt(now, 10) || 0,
    label: String(now),
    current,
    steps,
    note,
  });

  const f1 = fpd1For(main, true);
  if (f1 === undefined || f1 < 0 || (humanFpd(main) ?? -1) < 0) return fail(`${skillName} can't be used with this weapon.`);
  const tables: IasTable[] = [];
  const g = gearIas; // IAS from everything but the weapons
  const onePerHand = !dualSequence;
  const mainTotal = g + main.ias;
  const eiasNow = eiasValues(true, onePerHand ? mainTotal : g, onePerHand ? 0 : main.ias, onePerHand ? 0 : (off?.ias ?? 0))[0];

  if (dualSequence) {
    // both weapons swing in one animation at the average of the two: step through the IAS from everything but the weapons
    const o = off ?? hand(undefined, undefined, 0);
    const steps: BreakpointStep[] = [];
    let last = '';
    for (let gi = 0; gi <= 400; gi++) {
      const ev = eiasValues(true, gi, main.ias, o.ias);
      const [hit] = hitsAt(main, f1, speedFor(main, f1, ev[0], 0));
      if (hit.key !== last) {
        steps.push({ frames: typeof hit.x === 'number' ? hit.x : parseInt(hit.x, 10) || 0, label: typeof hit.x === 'number' ? undefined : hit.x, need: gi });
        last = hit.key;
      }
    }
    tables.push(mk(steps, nowFor(main, f1, true, g, main.ias, o.ias)[0], g, undefined, 'IAS from gear, not counting the weapons'));
    notes.push('Two weapons: the table counts IAS from everything but the weapons.');
  } else {
    const raws = coreTable(main, f1, true, 0, 0);
    const nowMain = nowFor(main, f1, true, mainTotal, 0, 0);
    const useIdx = skillName === 'Strafe' && main.kind !== 'XBW' ? [1] : raws.map((_, i) => i);
    for (const i of useIdx) {
      const variant =
        raws.length > 1 && main.kind === 'XBW'
          ? i === 0
            ? 'Even number of arrows'
            : 'Odd number of arrows'
          : secondSet && skillName !== 'Whirlwind'
            ? 'Main hand'
            : undefined;
      tables.push(mk(toSteps(raws[i]), nowMain[i], mainTotal, variant));
    }
    if (secondSet && off && (skillName === 'Standard' || skillName === 'Whirlwind')) {
      const f2 = fpd1For(off, false);
      if (f2 !== undefined && f2 >= 0) {
        const raw2 = coreTable(off, f2, false, 0, 0);
        const total2 = g + off.ias;
        const now2 = nowFor(off, f2, false, total2, 0, 0);
        tables.push(mk(toSteps(raw2[0]), now2[0], total2, skillName === 'Whirlwind' ? 'Off hand' : 'Off hand'));
        if (skillName === 'Whirlwind') {
          const merged = merge(raws[0], raw2[0]);
          // the merged table is judged against the slower hand's IAS
          const cur = Math.min(mainTotal, total2);
          const stepsM = toSteps(merged);
          const nowM = Math.ceil((Number(nowMain[0]) + Number(now2[0])) / 2);
          tables.push(mk(stepsM, nowM, cur, 'Both hands', 'What both weapons swing at'));
        }
      }
    }
  }
  return { weapon: main.name, tables, ias: gearIas, eias: limit(eiasNow), notes };
}

/** Whirlwind with two weapons: both hands swing together, at the average of the two (the original's mergeAccelerationTables). */
function merge(a: Raw, b: Raw): Raw {
  const rows: [number, number][] = [];
  const left = a.rows as [number, number][];
  const right = b.rows as [number, number][];
  const pending: [number, [number, number]][] = [];
  left.slice(1).forEach((r) => pending.push([0, r]));
  right.slice(1).forEach((r) => pending.push([1, r]));
  pending.sort((x, y) => x[1][0] - y[1][0]);
  let lastL = left[0];
  let lastR = right[0];
  const avg = (x: number, y: number) => Math.ceil((x + y) / 2);
  let lastAvg = avg(lastL[1], lastR[1]);
  rows.push([Math.min(lastL[0], lastR[0]), lastAvg]);
  for (const [h, r] of pending) {
    if (h === 0) {
      if (lastL[1] > r[1]) {
        lastL = r;
        const v = avg(r[1], lastR[1]);
        if (v < lastAvg) {
          lastAvg = v;
          rows.push([r[0], v]);
        }
      }
    } else if (lastR[1] > r[1]) {
      lastR = r;
      const v = avg(lastL[1], r[1]);
      if (v < lastAvg) {
        lastAvg = v;
        rows.push([r[0], v]);
      }
    }
  }
  return { eias: a.eias[0] > b.eias[0] ? b.eias : a.eias, rows };
}
