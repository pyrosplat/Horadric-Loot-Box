import type { D2Character } from './d2s';
import { describeItem, propStatsAt, socketStats } from './describe';
import { GD, statByName } from './gamedata';
import { ItemMode, StorePage, type D2Item, type ItemStat } from './item';

/** charstats.txt (in fourths): stamina, mana and life a point of Vitality or Energy adds, per class. */
const PER_POINT: Record<string, { life: number; stamina: number; mana: number }> = {
  Amazon: { life: 12, stamina: 4, mana: 6 },
  Sorceress: { life: 8, stamina: 4, mana: 8 },
  Necromancer: { life: 8, stamina: 4, mana: 8 },
  Paladin: { life: 12, stamina: 4, mana: 6 },
  Barbarian: { life: 16, stamina: 4, mana: 4 },
  Druid: { life: 8, stamina: 4, mana: 8 },
  Assassin: { life: 12, stamina: 5, mana: 7 },
  Warlock: { life: 12, stamina: 4, mana: 8 },
};

/** charstats.txt ToHitFactor: the class's base attack rating, added to 5 per Dexterity point above 7. */
const TO_HIT: Record<string, number> = { Amazon: 5, Sorceress: -15, Necromancer: -10, Paladin: 20, Barbarian: 20, Druid: 5, Assassin: 15, Warlock: 5 };

/** One breakpoint table: the frames an action takes at each Faster Cast / Hit Recovery / Block Rate percentage. */
/** One step of an attack speed table: the frame count you get from `need` IAS on. */
export interface BreakpointStep {
  frames: number;
  /** What to show for the step when it is more than the frame count (the hits of Zeal). */
  label?: string;
  need: number;
}

export interface BreakpointTable {
  stat: 'fcr' | 'fhr' | 'fbr';
  /** What decides which table applies when a class has more than one (weapon type, Holy Shield). */
  variant?: string;
  /** Frames, slowest first (one fewer each step), and the percentage needed for each. */
  start: number;
  pct: number[];
}

const T = (stat: BreakpointTable['stat'], start: number, pct: number[], variant?: string): BreakpointTable => ({ stat, start, pct, variant });
const NECRO_FHR = [0, 5, 10, 16, 26, 39, 56, 86, 152, 377];
const BLOCK_FAST = [0, 13, 32, 86, 600];
const BLOCK_SLOW = [0, 6, 13, 20, 32, 52, 86, 174, 600];

/**
 * Breakpoints per class, from the D2R tables on d2runes.io and d2emu.com, which agree (cast, hit recovery and block rate; Druid
 * shapeshift forms and the Necromancer's Vampire Form are not here). The Warlock's tables are community-tested, the Necromancer's.
 */
export const BREAKPOINTS: Record<string, BreakpointTable[]> = {
  Amazon: [
    T('fcr', 19, [0, 7, 14, 22, 32, 48, 68, 99, 152]),
    T('fhr', 11, [0, 6, 13, 20, 32, 52, 86, 174, 600]),
    T('fbr', 17, [0, 4, 6, 11, 15, 23, 29, 40, 56, 80, 120, 200, 480], 'One-handed weapon'),
    T('fbr', 5, BLOCK_FAST, 'Other weapons'),
  ],
  Assassin: [T('fcr', 16, [0, 8, 16, 27, 42, 65, 102, 174]), T('fhr', 9, [0, 7, 15, 27, 48, 86, 200]), T('fbr', 5, BLOCK_FAST)],
  Barbarian: [T('fcr', 13, [0, 9, 20, 37, 63, 105, 200]), T('fhr', 9, [0, 7, 15, 27, 48, 86, 200]), T('fbr', 7, [0, 9, 20, 42, 86, 280])],
  Druid: [
    T('fcr', 18, [0, 4, 10, 19, 30, 46, 68, 99, 163]),
    T('fhr', 14, [0, 3, 7, 13, 19, 29, 42, 63, 99, 174, 456], 'One-handed weapon'),
    T('fhr', 13, NECRO_FHR, 'Two-handed weapon'),
    T('fbr', 11, BLOCK_SLOW),
  ],
  Necromancer: [T('fcr', 15, [0, 9, 18, 30, 48, 75, 125]), T('fhr', 13, NECRO_FHR), T('fbr', 11, BLOCK_SLOW)],
  Paladin: [
    T('fcr', 15, [0, 9, 18, 30, 48, 75, 125]),
    T('fhr', 13, [0, 3, 7, 13, 20, 32, 48, 75, 129, 280], 'Spears and staves'),
    T('fhr', 9, [0, 7, 15, 27, 48, 86, 200], 'Other weapons'),
    T('fbr', 5, BLOCK_FAST),
    T('fbr', 2, [0, 86], 'With Holy Shield'),
  ],
  Sorceress: [
    T('fcr', 19, [0, 7, 15, 23, 35, 52, 78, 117, 194], 'Lightning and Chain Lightning'),
    T('fcr', 13, [0, 9, 20, 37, 63, 105, 200], 'Other spells'),
    T('fhr', 15, [0, 5, 9, 14, 20, 30, 42, 60, 86, 142, 280]),
    T('fbr', 9, [0, 7, 15, 27, 48, 86, 200]),
  ],
  Warlock: [T('fcr', 15, [0, 9, 18, 30, 48, 75, 125]), T('fhr', 13, NECRO_FHR), T('fbr', 11, BLOCK_SLOW)],
};

/** Where a value lands in a table: the step you are on (and its frames), and the next one up with how much more it needs. */
export function breakpointStatus(table: BreakpointTable, value: number) {
  let at = 0;
  table.pct.forEach((p, i) => value >= p && (at = i));
  const nextIndex = at + 1 < table.pct.length ? at + 1 : undefined;
  return {
    index: at,
    frames: table.start - at,
    next: nextIndex === undefined ? undefined : { frames: table.start - nextIndex, pct: table.pct[nextIndex], need: table.pct[nextIndex] - value },
  };
}

export interface ResistRow {
  /** Total from gear (and charms), before the cap and difficulty. */
  total: number;
  /** The cap: 75 plus any maximum-resist bonuses. */
  max: number;
  /** What counts in Normal, Nightmare and Hell (total plus Anya's scrolls, minus the difficulty penalty, held to the cap). */
  normal: number;
  nightmare: number;
  hell: number;
}

export interface CharStatsResult {
  name: string;
  className: string;
  level: number;
  experience: number;
  strength: number;
  dexterity: number;
  vitality: number;
  energy: number;
  life: number;
  mana: number;
  stamina: number;
  defense: number;
  /** Resistances: fire, cold, lightning, poison, then physical and magic damage taken reduced by %. */
  fire: ResistRow;
  cold: ResistRow;
  lightning: ResistRow;
  poison: ResistRow;
  /** Physical and magic damage reduction: the percent, and the flat amount that comes off first. */
  physPct: number;
  physFlat: number;
  magicPct: number;
  magicFlat: number;
  /** Anya's resistance bonus in Normal, Nightmare and Hell. */
  anya: { normal: number; nightmare: number; hell: number };
  /** Attack rating, and the damage range (physical with Strength or Dexterity, elemental and poison) of the weapon in the main hand. */
  attackRating: number;
  damage: { min: number; max: number };
  /** Faster Cast Rate, Faster Hit Recovery and Faster Block Rate from gear (see BREAKPOINTS for what they do). */
  fcr: number;
  fhr: number;
  fbr: number;
  frw: number;
  ias: number;
  /** Base name of the weapon in the main hand (Broad Sword, Phase Blade). */
  weaponBase?: string;
  weaponType?: string;
  /** IAS on the main-hand weapon itself, and the weapon in the off hand (two-weapon fighters) with its base name, type code and IAS. */
  /** IAS from everything but the two weapons. */
  iasGear: number;
  mainIas: number;
  offBase?: string;
  offType?: string;
  offIas: number;
  /** Aura levels the gear gives, by skill id. */
  auras: Record<number, number>;
  /** skills the gear grants outside the class's own tree (item_nonclassskill / item_singleskill), by skill id */
  gearSkills: number[];
  magicFind: number;
  goldFind: number;
  allSkills: number;
  crushingBlow: number;
  deadlyStrike: number;
  openWounds: number;
  lifeLeech: number;
  manaLeech: number;
  /** The "Advanced Stats" list, worded the way the game words it, only what the gear gives. */
  advanced: { text: string }[];
  /** Items counted: equipped gear (not the weapon swap) and charms in the inventory. */
  itemCount: number;
}

const idOf = (key: string) => statByName(key)!.id;

/** Items that count towards the character's totals: what's worn on the active weapon set, and charms in the inventory. */
export function activeItems(ch: D2Character): D2Item[] {
  return ch.items.filter((i) => {
    if (i.mode === ItemMode.Equipped) return i.bodyLoc !== 11 && i.bodyLoc !== 12; // weapon swap
    return i.mode === ItemMode.Stored && i.page === StorePage.Inventory && !!i.def?.flags.includes('C');
  });
}

/** Every stat on one item: its own, its runeword's, what's socketed in it. */
function itemStats(item: D2Item): ItemStat[] {
  const out = [...item.stats, ...item.runewordStats];
  for (const s of item.sockets) out.push(...socketStats(item, s));
  return out;
}

/** Set bonuses that are active with these items equipped (what each piece says, and the set's own partial and full bonuses). */
function setBonuses(items: D2Item[]): ItemStat[] {
  const out: ItemStat[] = [];
  const bySet = new Map<string, D2Item[]>();
  for (const it of items) {
    if (it.mode !== ItemMode.Equipped || it.setId === undefined) continue;
    const key = GD.setItems[it.setId]?.setKey;
    if (key) bySet.set(key, [...(bySet.get(key) ?? []), it]);
  }
  for (const [key, pieces] of bySet) {
    const n = pieces.length;
    // the bonuses each piece carries apply when enough of the set is worn: list i needs i + 2 pieces
    for (const p of pieces) p.setBonusStats.forEach((list, i) => n >= i + 2 && out.push(...list));
    const set = GD.sets[key];
    if (!set) continue;
    const size = Object.values(GD.setItems).filter((s) => s.setKey === key).length;
    const stats = (props: [string, string, number, number][]) => props.flatMap(([code, param, min, max]) => propStatsAt(code, param, min, max, min).stats);
    for (const [need, props] of set.partial) if (n >= need) out.push(...stats(props));
    if (n >= size) out.push(...stats(set.full));
  }
  return out;
}

export function characterStats(ch: D2Character): CharStatsResult {
  const items = activeItems(ch);
  const sum = new Map<number, number>();
  const add = (stats: ItemStat[]) => {
    for (const s of stats) {
      const d = GD.stats[s.id];
      if (!d) continue;
      sum.set(s.id, (sum.get(s.id) ?? 0) + s.value / 2 ** d.valShift);
    }
  };
  for (const it of items) add(itemStats(it));
  add(setBonuses(items));
  const get = (key: string) => sum.get(idOf(key)) ?? 0;
  // auras the gear gives, by skill id (Faith gives Fanaticism, Hustle Burst of Speed...): the best level of each
  const auras: Record<number, number> = {};
  for (const st of [...items.flatMap((i) => itemStats(i)), ...setBonuses(items)]) {
    if (st.id === idOf('item_aura') && st.value > (auras[st.param] ?? 0)) auras[st.param] = st.value;
  }

  const gearSkills = [
    ...new Set(
      [...items.flatMap((i) => itemStats(i)), ...setBonuses(items)]
        .filter((st) => st.id === idOf('item_nonclassskill') || st.id === idOf('item_singleskill'))
        .map((st) => st.param),
    ),
  ];

  const base = (k: string) => ch.stats[k] ?? 0;
  const strength = base('strength') + get('strength');
  const dexterity = base('dexterity') + get('dexterity');
  const vitality = base('vitality') + get('vitality');
  const energy = base('energy') + get('energy');

  const per = PER_POINT[ch.className] ?? PER_POINT.Amazon;
  // the save keeps maximum life, mana and stamina with 8 fractional bits and without gear
  const saved = (k: string) => (ch.stats[k] ?? 0) / 256;
  const life = Math.floor(((saved('maxhp') + get('maxhp') + get('vitality') * (per.life / 4)) * (100 + get('item_maxhp_percent'))) / 100);
  const mana = Math.floor(((saved('maxmana') + get('maxmana') + get('energy') * (per.mana / 4)) * (100 + get('item_maxmana_percent'))) / 100);
  const stamina = Math.floor(saved('maxstamina') + get('maxstamina') + get('vitality') * (per.stamina / 4));

  // defense: each armor piece as its tooltip shows it; rings, amulets and charms add their flat bonus; Dexterity adds a quarter
  let defense = 0;
  for (const it of items) {
    if (it.def?.flags.includes('A')) {
      const line = describeItem(it).lines.find((l) => /^Defense: \d+/.test(l.text));
      defense += line ? Number(/\d+/.exec(line.text)![0]) : 0;
    } else
      defense += itemStats(it)
        .filter((s) => s.id === idOf('armorclass'))
        .reduce((n, s) => n + s.value, 0);
  }
  defense += Math.floor(dexterity / 4);

  // Anya's Prison of Ice scroll: +10 to all resistances for each difficulty's scroll already read, in that difficulty and the ones after it
  const anya = ch.anyaScrolls ?? [false, false, false];
  const bonus = (upTo: number) => anya.slice(0, upTo + 1).filter(Boolean).length * 10;
  const resist = (res: string, max: string): ResistRow => {
    const total = get(res);
    const cap = 75 + get(max);
    const held = (penalty: number, quests: number) => Math.min(total + quests - penalty, cap);
    return { total, max: cap, normal: held(0, bonus(0)), nightmare: held(40, bonus(1)), hell: held(100, bonus(2)) };
  };

  // attack rating: 5 per Dexterity above 7, the class's base, flat bonuses, then the percent bonus
  const attackRating = Math.max(0, Math.floor((((dexterity - 7) * 5 + (TO_HIT[ch.className] ?? 0) + get('tohit')) * (100 + get('item_tohit_percent'))) / 100));

  // damage of the main-hand weapon: its tooltip damage (enhanced damage, ethereal and its own flat bonuses already in), plus flat
  // bonuses from other gear, grown by the weapon's Strength / Dexterity bonus, plus elemental damage and poison from all gear
  // a weapon in the off hand (two-weapon fighters) only speeds up its own swings, not the main hand's
  const offHand = items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 5 && i.def?.flags.includes('W'));
  const iasOf = (it?: D2Item) => (it ? itemStats(it).reduce((a, st) => a + (st.id === idOf('item_fasterattackrate') ? st.value : 0), 0) : 0);
  const offHandIas = iasOf(offHand);
  const weapon = items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 4 && i.def?.flags.includes('W'));
  const tip =
    weapon &&
    describeItem(weapon)
      .lines.map((l) => /^(?:One-Hand|Two-Hand|Throw) Damage: (\d+) to (\d+)/.exec(l.text))
      .find(Boolean);
  let [pMin, pMax] = tip ? [Number(tip[1]), Number(tip[2])] : [1, 2]; // bare hands
  let others = 0;
  for (const it of items) {
    if (it === weapon) continue;
    for (const st of itemStats(it)) {
      const d = GD.stats[st.id];
      if (d?.key === 'mindamage') pMin += st.value;
      else if (d?.key === 'maxdamage') pMax += st.value;
      else if (d?.key === 'item_maxdamage_percent') others += st.value;
    }
  }
  const grow = 1 + (((weapon?.def?.strBonus ?? 0) * strength) / 100 + ((weapon?.def?.dexBonus ?? 0) * dexterity) / 100 + others) / 100;
  let dMin = pMin * grow + get('firemindam') + get('coldmindam') + get('lightmindam') + get('magicmindam');
  let dMax = pMax * grow + get('firemaxdam') + get('coldmaxdam') + get('lightmaxdam') + get('magicmaxdam');
  // poison is shown as the total it does: damage per frame (in 256ths) over its length in frames
  const poisonId = idOf('poisonlength');
  for (const it of items) {
    const list = itemStats(it);
    const len = list.find((x) => x.id === poisonId)?.value ?? 0;
    for (const st of list) {
      const key = GD.stats[st.id]?.key;
      if (key === 'poisonmindam') dMin += (st.value * len) / 256;
      else if (key === 'poisonmaxdam') dMax += (st.value * len) / 256;
    }
  }

  const lines: { text: string }[] = [];
  const line = (key: string, text: (v: number) => string) => {
    const v = Math.round(get(key));
    if (v !== 0) lines.push({ text: text(v) });
  };
  const sg = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  line('manarecoverybonus', (v) => `Regenerate Mana ${v}%`);
  line('normal_damage_reduction', (v) => `Damage Reduced by ${v}`);
  line('damageresist', (v) => `Physical Damage Reduced by ${v}%`);
  line('magic_damage_reduction', (v) => `Magic Damage Reduced by ${v}`);
  line('magicresist', (v) => `Magic Damage Reduced by ${v}%`);
  line('lifedrainmindam', (v) => `${v}% Life stolen per hit`);
  line('manadrainmindam', (v) => `${v}% Mana stolen per hit`);
  line('hpregen', (v) => `Replenish Life ${sg(v)}`);
  line('item_goldbonus', (v) => `${v}% Extra Gold from Monsters`);
  line('item_magicbonus', (v) => `${v}% Better Chance of Getting Magic Items`);
  line('item_lightradius', (v) => `${sg(v)} to Light Radius`);
  line('item_fastermovevelocity', (v) => `${sg(v)}% Faster Run/Walk`);
  line('item_fastergethitrate', (v) => `${sg(v)}% Faster Hit Recovery`);
  line('item_fasterblockrate', (v) => `${sg(v)}% Faster Block Rate`);
  line('item_fastercastrate', (v) => `${sg(v)}% Faster Cast Rate`);
  line('item_fasterattackrate', (v) => `${sg(v)}% Increased Attack Speed`);
  line('item_poisonlengthresist', (v) => `Poison Length Reduced by ${v}%`);
  line('item_halffreezeduration', () => 'Half Freeze Duration');
  line('item_cannotbefrozen', () => 'Cannot Be Frozen');
  line('curse_resistance', (v) => `Curse Duration Reduced by ${v}%`);
  line('item_manaafterkill', (v) => `${sg(v)} to Mana after each Kill`);
  line('item_healafterkill', (v) => `${sg(v)} Life after each Kill`);
  line('item_crushingblow', (v) => `${v}% Chance of Crushing Blow`);
  line('item_deadlystrike', (v) => `${v}% Deadly Strike`);
  line('item_openwounds', (v) => `${v}% Chance of Open Wounds`);
  line('item_allskills', (v) => `${sg(v)} to All Skills`);
  line('item_attackertakesdamage', (v) => `Attacker Takes Damage of ${v}`);
  line('item_damagetomana', (v) => `${v}% Damage Taken Goes to Mana`);
  line('item_slow', (v) => `Slows Target by ${v}%`);
  line('item_reducedprices', (v) => `Reduced Vendor Prices ${v}%`);
  line('item_addexperience', (v) => `${sg(v)}% to Experience Gained`);
  line('item_absorbfire_percent', (v) => `Fire Absorb ${v}%`);
  line('item_absorbcold_percent', (v) => `Cold Absorb ${v}%`);
  line('item_absorblight_percent', (v) => `Lightning Absorb ${v}%`);
  line('item_absorbfire', (v) => `Fire Absorb ${v}`);
  line('item_absorbcold', (v) => `Cold Absorb ${v}`);
  line('item_absorblight', (v) => `Lightning Absorb ${v}`);

  return {
    advanced: lines,
    attackRating,
    damage: { min: Math.floor(dMin), max: Math.floor(dMax) },
    anya: { normal: bonus(0), nightmare: bonus(1), hell: bonus(2) },
    name: ch.name,
    className: ch.className,
    level: ch.level,
    experience: base('experience'),
    strength,
    dexterity,
    vitality,
    energy,
    life,
    mana,
    stamina,
    defense,
    fire: resist('fireresist', 'maxfireresist'),
    cold: resist('coldresist', 'maxcoldresist'),
    lightning: resist('lightresist', 'maxlightresist'),
    poison: resist('poisonresist', 'maxpoisonresist'),
    physPct: get('damageresist'),
    physFlat: get('normal_damage_reduction'),
    magicPct: get('magicresist'),
    magicFlat: get('magic_damage_reduction'),
    fcr: get('item_fastercastrate'),
    fhr: get('item_fastergethitrate'),
    fbr: get('item_fasterblockrate'),
    frw: get('item_fastermovevelocity'),
    ias: get('item_fasterattackrate') - offHandIas,
    weaponBase: weapon?.def?.name,
    weaponType: weapon?.def?.type,
    iasGear: get('item_fasterattackrate') - iasOf(weapon) - offHandIas,
    mainIas: iasOf(weapon),
    offBase: offHand?.def?.name,
    offType: offHand?.def?.type,
    offIas: offHandIas,
    auras,
    gearSkills,
    magicFind: get('item_magicbonus'),
    goldFind: get('item_goldbonus'),
    allSkills: get('item_allskills'),
    crushingBlow: get('item_crushingblow'),
    deadlyStrike: get('item_deadlystrike'),
    openWounds: get('item_openwounds'),
    lifeLeech: get('lifedrainmindam'),
    manaLeech: get('manadrainmindam'),
    itemCount: items.length,
  };
}
