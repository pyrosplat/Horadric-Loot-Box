import { GD, isType, statByName, statDef } from './gamedata';
import { Quality, type D2Item, type ItemStat } from './item';

export type QualityClass =
  | 'normal' | 'inferior' | 'superior' | 'magic' | 'set' | 'rare' | 'unique' | 'crafted' | 'tempered' | 'runeword' | 'rune' | 'gem' | 'quest' | 'gold';

export interface DescLine {
  text: string;
  kind: 'base' | 'req' | 'mod' | 'setbonus' | 'socket' | 'info' | 'flag';
}

export interface ItemDescription {
  name: string;
  baseName: string;
  qualityClass: QualityClass;
  lines: DescLine[];
  requiredLevel: number;
  /** Short label for grid tiles */
  short: string;
  /** Lowercased text used for searching */
  search: string;
}

// ---------------------------------------------------------------- formatting helpers

/** Minimal printf for D2 strings: %d %i %+d %s %% and %0/%1 positional (descfunc 23). */
export function sprintf(fmt: string, ...args: (number | string)[]): string {
  let i = 0;
  return fmt
    .replace(/%(\+)?([dis])|%%|%([0-9])/g, (m, plus, conv, pos) => {
      if (m === '%%') return '%';
      if (pos !== undefined) {
        const v = args[Number(pos)];
        return v === undefined ? '' : String(v);
      }
      const v = args[i++];
      if (conv === 's') return String(v ?? '');
      const n = typeof v === 'number' ? v : Number(v ?? 0);
      const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
      return plus && n >= 0 ? `+${s}` : s;
    })
    .replace(/\\n|\n/g, ' ')
    .trim();
}

const displayValue = (s: ItemStat) => s.value / 2 ** statDef(s.id).valShift;
const skillName = (id: number) => GD.skills[id]?.name ?? `Skill #${id}`;
const classOnly = (skillId: number) => {
  const cls = GD.skills[skillId]?.cls ?? -1;
  return cls >= 0 ? GD.classes[cls]?.classOnly ?? '' : '';
};

interface Line {
  text: string;
  priority: number;
}

function lineForStat(s: ItemStat): Line | null {
  const def = statDef(s.id);
  const v = displayValue(s);
  const pri = def.descPriority;
  const str = v < 0 && def.descNeg ? def.descNeg : def.descPos;
  switch (def.descFunc) {
    case 0:
      return null;
    case 11:
      return { text: `Repairs 1 Durability in ${Math.max(1, Math.round(100 / Math.max(1, v)))} Seconds`, priority: pri };
    case 12:
      return { text: v > 1 ? `${str} +${v}` : str, priority: pri };
    case 13: {
      const cls = GD.classes[s.param];
      return { text: sprintf(cls?.allSkills || str, v), priority: pri };
    }
    case 14: {
      const cls = GD.classes[s.param >> 3];
      const tab = cls?.tabs[s.param & 7];
      return { text: `${sprintf(tab || str, v)} ${cls?.classOnly ?? ''}`.trim(), priority: pri };
    }
    case 15:
      return { text: sprintf(str, v, s.param & 63, skillName(s.param >> 6)), priority: pri };
    case 16:
      return { text: sprintf(str, v, skillName(s.param)), priority: pri };
    case 22:
    case 23:
      return { text: sprintf(str, v, `#${s.param}`), priority: pri };
    case 24:
      return { text: sprintf(str, s.param & 63, skillName(s.param >> 6), v & 0xff, (v >> 8) & 0xff), priority: pri };
    case 27:
      return { text: sprintf(str, v, skillName(s.param), classOnly(s.param)), priority: pri };
    case 28:
      return { text: sprintf(str, v, skillName(s.param)), priority: pri };
    default: {
      if (!str) return null;
      if (def.desc2 && /Based on Character Level/i.test(def.desc2)) {
        const per = v / 8;
        const perText = `(${Math.round(per * 1000) / 1000} per Level)`;
        return { text: `${str.replace(/%\+?d/, perText).replace('%%', '%')} ${def.desc2}`, priority: pri };
      }
      const text = /%/.test(str) ? sprintf(str, v) : def.descVal === 1 ? `${v} ${str}` : def.descVal === 2 ? `${str} ${v}` : str;
      return { text: def.desc2 && !/%/.test(def.desc2) ? `${text} ${def.desc2}` : text, priority: pri };
    }
  }
}

/** Collapses a stat list into tooltip lines, handling damage pairs and grouped stats. */
export function describeStats(stats: ItemStat[]): string[] {
  // Merge duplicate stat/param pairs (e.g. from sockets)
  const merged = new Map<string, ItemStat>();
  for (const s of stats) {
    const key = `${s.id}:${s.param}`;
    const cur = merged.get(key);
    if (cur && ![204].includes(s.id)) cur.value += s.value;
    else if (!cur) merged.set(key, { ...s });
    else merged.set(`${key}:${merged.size}`, { ...s });
  }
  const list = [...merged.values()];
  const byId = new Map<number, ItemStat>();
  for (const s of list) if (!byId.has(s.id)) byId.set(s.id, s);
  const used = new Set<ItemStat>();
  const lines: Line[] = [];
  const get = (id: number) => {
    const s = byId.get(id);
    return s && !used.has(s) ? s : undefined;
  };
  const ui = GD.ui;

  // Enhanced damage (max% + min%)
  const edMax = get(17), edMin = get(18);
  if (edMax && edMin && displayValue(edMax) === displayValue(edMin)) {
    lines.push({ text: sprintf(ui.strModEnhancedDamage ?? '%+d%% Enhanced Damage', displayValue(edMax)), priority: statDef(17).descPriority });
    used.add(edMax).add(edMin);
  }
  // Flat damage: hide secondary/throw duplicates
  const minD = get(21), maxD = get(22);
  for (const [a, b] of [[23, 24], [159, 160]]) {
    const sa = get(a), sb = get(b);
    if (sa && minD && displayValue(sa) === displayValue(minD)) used.add(sa);
    if (sb && maxD && displayValue(sb) === displayValue(maxD)) used.add(sb);
  }
  if (minD && maxD) {
    lines.push({ text: sprintf(ui.strModMinDamageRange ?? 'Adds %d-%d damage', displayValue(minD), displayValue(maxD)), priority: statDef(21).descPriority });
    used.add(minD).add(maxD);
  }
  // Elemental damage ranges
  const elem: [number, number, string, string][] = [
    [48, 49, 'strModFireDamage', 'strModFireDamageRange'],
    [50, 51, 'strModLightningDamage', 'strModLightningDamageRange'],
    [52, 53, 'strModMagicDamage', 'strModMagicDamageRange'],
    [54, 55, 'strModColdDamage', 'strModColdDamageRange'],
  ];
  for (const [a, b, one, range] of elem) {
    const sa = get(a), sb = get(b);
    if (sa && sb) {
      const va = displayValue(sa), vb = displayValue(sb);
      lines.push({ text: va === vb ? sprintf(ui[one] ?? '%+d damage', va) : sprintf(ui[range] ?? 'Adds %d-%d damage', va, vb), priority: statDef(a).descPriority });
      used.add(sa).add(sb);
    }
  }
  const coldLen = get(56);
  if (coldLen) used.add(coldLen);
  const pMin = get(57), pMax = get(58), pLen = get(59);
  if (pMin && pMax) {
    const len = pLen ? displayValue(pLen) : 0;
    const lo = Math.round((displayValue(pMin) * len) / 256), hi = Math.round((displayValue(pMax) * len) / 256);
    const secs = Math.round(len / 25);
    lines.push({
      text: lo === hi ? sprintf(ui.strModPoisonDamage ?? '%+d poison damage over %d seconds', lo, secs) : sprintf(ui.strModPoisonDamageRange ?? 'Adds %d-%d poison damage over %d seconds', lo, hi, secs),
      priority: statDef(57).descPriority,
    });
    used.add(pMin).add(pMax);
    if (pLen) used.add(pLen);
  }
  const pois = byId.get(59);
  if (pois) used.add(pois);

  // Description groups (all attributes, all resistances)
  const groups = new Map<number, number[]>();
  for (const d of GD.stats) if (d.dgrp) groups.set(d.dgrp, [...(groups.get(d.dgrp) ?? []), d.id]);
  for (const [, ids] of groups) {
    const members = ids.map((id) => get(id));
    if (members.every(Boolean)) {
      const vals = members.map((m) => displayValue(m!));
      if (vals.every((x) => x === vals[0])) {
        const d = statDef(ids[0]);
        lines.push({ text: sprintf(vals[0] < 0 && d.dgrpNeg ? d.dgrpNeg : d.dgrpPos, vals[0]), priority: d.descPriority });
        members.forEach((m) => used.add(m!));
      }
    }
  }

  for (const s of list) {
    if (used.has(s)) continue;
    const l = lineForStat(s);
    if (l && l.text) lines.push(l);
  }
  lines.sort((a, b) => b.priority - a.priority);
  return lines.map((l) => l.text);
}

// ---------------------------------------------------------------- names

export function runewordFor(item: D2Item) {
  if (!item.runeword) return undefined;
  const runes = item.sockets.map((s) => s.code).join(',');
  const candidates = GD.runewords.filter((r) => r.runes.length && r.runes.join(',') === runes);
  const typed = candidates.filter((r) => r.itypes.some((t) => isType(item.code, t)));
  return typed.find((r) => r.complete) ?? typed[0] ?? candidates[0] ?? (item.runewordId !== undefined ? GD.runewords[item.runewordId - 20507] : undefined);
}

const LOW_QUALITY = ['Crude', 'Cracked', 'Damaged', 'Low Quality'];

export function qualityClass(item: D2Item): QualityClass {
  const f = item.def?.flags ?? '';
  if (f.includes('G')) return 'gold';
  if (item.runeword) return 'runeword';
  switch (item.quality) {
    case Quality.Unique: return 'unique';
    case Quality.Set: return 'set';
    case Quality.Rare: return 'rare';
    case Quality.Crafted: return 'crafted';
    case Quality.Tempered: return 'tempered';
    case Quality.Magic: return 'magic';
    case Quality.Superior: return 'superior';
    case Quality.Inferior: return 'inferior';
  }
  if (f.includes('R')) return 'rune';
  if (f.includes('g')) return 'gem';
  if (item.def?.quest || f.includes('Q')) return 'quest';
  if (f.includes('C') && (item.prefixes[0] || item.suffixes[0])) return 'magic';
  return 'normal';
}

export function itemName(item: D2Item): string {
  const base = item.def?.name ?? item.code;
  if (item.ear) return `${item.ear.name}'s Ear`;
  const personal = item.personalizedName ? `${item.personalizedName}'s ` : '';
  if (item.runeword) return personal + (runewordFor(item)?.name ?? 'Runeword');
  switch (item.quality) {
    case Quality.Unique:
      return personal + (GD.uniques[item.uniqueId ?? -1]?.name ?? `Unique #${item.uniqueId}`);
    case Quality.Set:
      return personal + (GD.setItems[item.setId ?? -1]?.name ?? `Set item #${item.setId}`);
    case Quality.Rare:
    case Quality.Crafted:
    case Quality.Tempered: {
      const [a, b] = item.rareName ?? [0, 0];
      const n = [GD.rareNames[a], GD.rareNames[b]].filter(Boolean).join(' ');
      return personal + (n || base);
    }
    case Quality.Magic:
      return personal + magicName(item, base);
    case Quality.Superior:
      return `${personal}${GD.ui.Hiquality ?? 'Superior'} ${base}`;
    case Quality.Inferior:
      return `${personal}${LOW_QUALITY[item.lowQualityId ?? 0] ?? 'Crude'} ${base}`;
  }
  if (item.def?.flags.includes('C') && (item.prefixes[0] || item.suffixes[0])) return magicName(item, base);
  return personal + base;
}

function magicName(item: D2Item, base: string) {
  const p = item.prefixes[0] ? GD.magicPrefix[item.prefixes[0]] : null;
  const s = item.suffixes[0] ? GD.magicSuffix[item.suffixes[0]] : null;
  return [p, base, s].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- socket contributions

function propStats(code: string, min: number, max: number, param: string): ItemStat[] {
  const out: ItemStat[] = [];
  const mk = (key: string, value = min, withParam = true) => {
    const d = statByName(key);
    if (d) out.push({ id: d.id, param: withParam ? Number(param) || 0 : 0, value: value * 2 ** d.valShift });
  };
  for (const f of GD.properties[code] ?? []) {
    if (f.stat && f.func === 15) mk(f.stat, min, false);
    else if (f.stat && f.func === 16) mk(f.stat, max, false);
    else if (f.stat && f.func === 17) mk(f.stat, Number(param) || 0, false);
    else if (f.stat && [1, 2, 3, 8].includes(f.func)) mk(f.stat);
    else if (f.func === 5) mk('mindamage');
    else if (f.func === 6) mk('maxdamage');
    else if (f.func === 7) (mk('item_maxdamage_percent'), mk('item_mindamage_percent'));
    else if (f.func === 20) mk('item_indesctructible');
  }
  return out;
}

function socketSlot(parent: D2Item): 'weapon' | 'helm' | 'shield' {
  if (parent.def?.flags.includes('W')) return 'weapon';
  if (isType(parent.code, 'shld')) return 'shield';
  return 'helm';
}

export function socketStats(parent: D2Item, child: D2Item): ItemStat[] {
  const gem = GD.gems[child.code];
  if (gem) return gem[socketSlot(parent)].flatMap((m) => propStats(m.code, m.min, m.max, m.param));
  return child.stats; // jewels
}

export function gemBonusLines(item: D2Item): string[] {
  const gem = GD.gems[item.code];
  if (!gem) return [];
  const fmt = (mods: typeof gem.weapon) => describeStats(mods.flatMap((m) => propStats(m.code, m.min, m.max, m.param))).join(', ');
  return [`Weapons: ${fmt(gem.weapon)}`, `Armor: ${fmt(gem.helm)}`, `Shields: ${fmt(gem.shield)}`];
}

// ---------------------------------------------------------------- full description

export function describeItem(item: D2Item): ItemDescription {
  const def = item.def;
  const baseName = def?.name ?? item.code;
  const name = itemName(item);
  const qc = qualityClass(item);
  const lines: DescLine[] = [];
  const statsAll: ItemStat[] = [...item.stats, ...item.runewordStats];
  for (const s of item.sockets) statsAll.push(...socketStats(item, s));
  const find = (id: number) => statsAll.filter((s) => s.id === id).reduce((n, s) => n + s.value / 2 ** statDef(s.id).valShift, 0);

  if (qc === 'unique' || qc === 'set' || qc === 'runeword' || qc === 'rare' || qc === 'crafted' || qc === 'tempered') {
    lines.push({ text: baseName, kind: 'base' });
  }
  if (item.runeword) {
    const letters = item.sockets.map((s) => GD.gems[s.code]?.name?.replace(/ Rune$/, '') ?? s.code).join('');
    lines.push({ text: `'${letters}'`, kind: 'base' });
  }

  // Base properties
  if (def?.flags.includes('A') && item.defense !== undefined) {
    const ed = find(16);
    const flat = find(31);
    const d = Math.floor((item.defense * (100 + ed)) / 100) + flat;
    lines.push({ text: sprintf(GD.ui.ItemStats1h ?? 'Defense: %d', d), kind: 'base' });
  }
  if (def?.flags.includes('W')) {
    const eth = item.ethereal ? 1.5 : 1;
    const edMax = find(17), edMin = find(18);
    const addMin = find(21), addMax = find(22);
    const dmg = (lo?: number, hi?: number) =>
      lo === undefined || hi === undefined
        ? undefined
        : [Math.floor(Math.floor(lo * eth) * (100 + edMin) / 100) + addMin, Math.floor(Math.floor(hi * eth) * (100 + edMax) / 100) + addMax];
    const one = dmg(def.minDam, def.maxDam);
    const two = dmg(def.min2h, def.max2h);
    const thr = dmg(def.minMis, def.maxMis);
    if (thr && GD.types[def.type]?.throwable) lines.push({ text: `Throw Damage: ${thr[0]} to ${Math.max(thr[0], thr[1])}`, kind: 'base' });
    if (one && (!def.twoHanded || def.oneOrTwo)) lines.push({ text: sprintf(GD.ui.ItemStats1l ?? 'One-Hand Damage: %d to %d', one[0], Math.max(one[0], one[1])), kind: 'base' });
    if (two && def.twoHanded) lines.push({ text: sprintf(GD.ui.ItemStats1m ?? 'Two-Hand Damage: %d to %d', two[0], Math.max(two[0], two[1])), kind: 'base' });
  }
  if (item.quantity !== undefined && def?.stackable) lines.push({ text: `Quantity: ${item.quantity}`, kind: 'base' });
  if (item.advancedStackSize !== undefined && item.advancedStackSize > 1) lines.push({ text: `Stack: ${item.advancedStackSize}`, kind: 'base' });
  if (item.maxDurability && !find(152)) lines.push({ text: sprintf(GD.ui.ItemStats1d ?? 'Durability: %i of %i', item.durability ?? 0, item.maxDurability), kind: 'base' });
  if (item.gold !== undefined) lines.push({ text: `${item.gold.toLocaleString()} Gold`, kind: 'base' });

  // Requirements
  const reqPct = find(91);
  const adj = (v: number) => (v ? Math.max(0, Math.floor((v * (100 + reqPct)) / 100) - (item.ethereal ? 10 : 0)) : 0);
  const reqStr = adj(def?.reqStr ?? 0), reqDex = adj(def?.reqDex ?? 0);
  if (reqDex) lines.push({ text: sprintf(GD.ui.ItemStats1f ?? 'Required Dexterity: %d', reqDex), kind: 'req' });
  if (reqStr) lines.push({ text: sprintf(GD.ui.ItemStats1e ?? 'Required Strength: %d', reqStr), kind: 'req' });
  const requiredLevel = requiredLevelOf(item);
  if (requiredLevel > 1) lines.push({ text: sprintf(GD.ui.ItemStats1p ?? 'Required Level: %d', requiredLevel), kind: 'req' });
  if (item.itemLevel > 1 && !item.compact) lines.push({ text: `Item Level: ${item.itemLevel}`, kind: 'info' });

  if (!item.identified && !item.compact) lines.push({ text: GD.ui.ItemStats1b ?? 'Unidentified', kind: 'flag' });

  // Modifiers
  if (qc === 'rune' || qc === 'gem') {
    for (const t of gemBonusLines(item)) lines.push({ text: t, kind: 'mod' });
    lines.push({ text: GD.ui.ExInsertSockets ?? 'Can be Inserted into Socketed Items', kind: 'info' });
  } else {
    for (const t of describeStats(statsAll)) lines.push({ text: t, kind: 'mod' });
  }
  if (item.ethereal && item.socketed)
    lines.push({ text: sprintf(GD.ui.strItemModEtherealSocketed ?? 'Ethereal (Cannot be Repaired), Socketed (%i)', item.socketCount), kind: 'flag' });
  else if (item.ethereal) lines.push({ text: GD.ui.strethereal ?? 'Ethereal (Cannot be Repaired)', kind: 'flag' });
  else if (item.socketed) lines.push({ text: sprintf(GD.ui.Socketable ?? 'Socketed (%i)', item.socketCount), kind: 'flag' });
  if (item.personalizedName) lines.push({ text: GD.ui.ItemModifierPersonalized ?? 'Personalized', kind: 'flag' });

  item.setBonusStats.forEach((list, i) => {
    for (const t of describeStats(list)) lines.push({ text: `${t} (${i + 2} items)`, kind: 'setbonus' });
  });
  if (qc === 'set') {
    const set = GD.setItems[item.setId ?? -1]?.set;
    if (set) lines.push({ text: set, kind: 'info' });
  }

  for (const s of item.sockets) lines.push({ text: `Socketed: ${itemName(s)}`, kind: 'socket' });
  if (def?.flags.includes('C')) lines.push({ text: GD.ui.ItemExpcharmdesc ?? 'Keep in inventory to gain bonus', kind: 'info' });

  return {
    name,
    baseName,
    qualityClass: qc,
    lines,
    requiredLevel,
    short: shortLabel(item, name),
    search: [name, baseName, def?.type, ...lines.map((l) => l.text)].join('\n').toLowerCase(),
  };
}

export function requiredLevelOf(item: D2Item): number {
  let lvl = item.def?.levelReq ?? 0;
  if (item.quality === Quality.Unique) lvl = Math.max(lvl, GD.uniques[item.uniqueId ?? -1]?.levelReq ?? 0);
  if (item.quality === Quality.Set) lvl = Math.max(lvl, GD.setItems[item.setId ?? -1]?.levelReq ?? 0);
  for (const p of item.prefixes) if (p) lvl = Math.max(lvl, GD.magicPrefixReq[p] ?? 0);
  for (const s of item.suffixes) if (s) lvl = Math.max(lvl, GD.magicSuffixReq[s] ?? 0);
  for (const s of item.sockets) lvl = Math.max(lvl, requiredLevelOf(s));
  return lvl;
}

function shortLabel(item: D2Item, name: string): string {
  const f = item.def?.flags ?? '';
  if (f.includes('R')) return name.replace(/ Rune$/, '');
  if (item.quality === Quality.Magic || (f.includes('C') && item.quality === Quality.Normal)) {
    const p = item.prefixes[0] ? GD.magicPrefix[item.prefixes[0]] : null;
    const s = item.suffixes[0] ? GD.magicSuffix[item.suffixes[0]] : null;
    const affix = [p, s].filter(Boolean).join(' ');
    if (affix) return affix;
  }
  const words = name.replace(/^The /, '').split(/\s+/);
  return words.length > 2 ? `${words[0]} ${words[1]}` : name;
}
