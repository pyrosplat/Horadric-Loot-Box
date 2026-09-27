import { GD, isType, statByName, statDef, type PropDef } from './gamedata';
import { Quality, type D2Item, type ItemStat } from './item';

export type QualityClass =
  | 'normal' | 'inferior' | 'superior' | 'magic' | 'set' | 'rare' | 'unique' | 'crafted' | 'tempered' | 'runeword' | 'rune' | 'gem' | 'quest' | 'gold';

export interface DescLine {
  text: string;
  kind: 'base' | 'req' | 'mod' | 'setbonus' | 'socket' | 'info' | 'flag';
  /** On found uniques, set items and runewords: the possible roll, e.g. "20–30". */
  range?: string;
  /** The roll is the best possible. */
  perfect?: boolean;
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

let skillIds: Map<string, number> | undefined;
/** A skill parameter from the tables: an id, an internal name ("Teleport") or a display name. */
function skillId(param: string): number {
  if (/^\d+$/.test(param)) return Number(param);
  if (!skillIds) {
    skillIds = new Map();
    for (const [id, sk] of Object.entries(GD.skills)) {
      skillIds.set(sk.key.toLowerCase(), Number(id));
      if (!skillIds.has(sk.name.toLowerCase())) skillIds.set(sk.name.toLowerCase(), Number(id));
    }
  }
  return skillIds.get(param.toLowerCase()) ?? 0;
}

const propDefs = (code: string) => GD.properties[code] ?? GD.properties[code.toLowerCase()] ?? Object.entries(GD.properties).find(([k]) => k.toLowerCase() === code.toLowerCase())?.[1] ?? [];

/**
 * The stats one table property gives when it rolls `v` (between its min and max). Properties with no stat
 * line of their own (sockets, random skills, ethereal) come back as `text`.
 */
function propStatsAt(code: string, param: string, min: number, max: number, v: number): { stats: ItemStat[]; text?: string } {
  const stats: ItemStat[] = [];
  let text: string | undefined;
  const mk = (key: string | undefined, value: number, p = 0) => {
    const d = key ? statByName(key) : undefined;
    if (d) stats.push({ id: d.id, param: p, value: value * 2 ** d.valShift });
  };
  const num = Number(param) || 0;
  for (const f of propDefs(code)) {
    switch (f.func) {
      case 1: case 2: case 3: case 8: mk(f.stat, v, num); break;
      case 5: mk('mindamage', v); break;
      case 6: mk('maxdamage', v); break;
      case 7: mk('item_maxdamage_percent', v); mk('item_mindamage_percent', v); break;
      case 10: mk(f.stat, v, num); break;
      case 11: mk(f.stat, min, (skillId(param) << 6) | (max & 63)); break; // chance to cast: min = chance, max = level
      case 12: text = `+${num} to a Random Skill`; break;
      case 14: text = sprintf(GD.ui.Socketable ?? 'Socketed (%i)', num || v); break;
      case 15: mk(f.stat, min); break;
      case 16: mk(f.stat, max); break;
      case 17: mk(f.stat, num); break;
      case 19: mk(f.stat, min | (min << 8), (skillId(param) << 6) | (max & 63)); break; // charges, level
      case 20: mk('item_indesctructible', 1); break;
      case 21: mk(f.stat, v, Number(f.val) || 0); break;
      case 22: mk(f.stat, v, skillId(param)); break;
      case 23: text = GD.ui.strethereal ?? 'Ethereal (Cannot be Repaired)'; break;
      case 36: text = `+${Number(f.val) || num || 1} to a Random Class's Skill Levels`; break; // min/max pick the class
    }
  }
  return { stats, text };
}

function propStats(code: string, min: number, max: number, param: string): ItemStat[] {
  return propStatsAt(code, param, min, max, min).stats;
}

/** A property line from the tables at its lowest and highest roll, plus the merged text ("+(20–30)% …"). */
export interface RangeLine {
  text: string;
  lo: string;
  hi: string;
}

const NUM = /(\d+(?:\.\d+)?)/;
const skeleton = (t: string) => t.replace(/\d+(?:\.\d+)?/g, '#');

/** "+20% Faster Cast Rate" and "+30% Faster Cast Rate" → "+(20–30)% Faster Cast Rate". */
function mergeRange(lo: string, hi: string): string {
  if (lo === hi) return lo;
  const a = lo.split(NUM), b = hi.split(NUM);
  if (a.length !== b.length || skeleton(lo) !== skeleton(hi)) return `${lo} to ${hi}`;
  return a.map((x, i) => (i % 2 && x !== b[i] ? `(${x}–${b[i]})` : x)).join('');
}

/** Tooltip lines for a list of table properties, with ranges; `fixed` stats (e.g. socketed runes) are added to both ends. */
export function propLines(props: PropDef[], fixed: ItemStat[] = []): RangeLine[] {
  const at = (pick: 'min' | 'max') => {
    const stats: ItemStat[] = [...fixed];
    const texts: string[] = [];
    for (const [code, param, min, max] of props) {
      const r = propStatsAt(code, param, min, max, pick === 'min' ? Math.min(min, max) : Math.max(min, max));
      stats.push(...r.stats);
      if (r.text) texts.push(r.text);
    }
    return [...describeStats(stats), ...texts];
  };
  const lo = at('min'), hi = at('max');
  const out: RangeLine[] = [];
  const used = new Set<number>();
  lo.forEach((l, i) => {
    let j = i < hi.length && !used.has(i) && skeleton(hi[i]) === skeleton(l) ? i : hi.findIndex((h, k) => !used.has(k) && skeleton(h) === skeleton(l));
    if (j < 0) j = i < hi.length && !used.has(i) ? i : -1;
    const h = j >= 0 ? hi[j] : l;
    if (j >= 0) used.add(j);
    out.push({ text: mergeRange(l, h), lo: l, hi: h });
  });
  return out;
}

/** Adds the possible roll to each line of a found item that has one ("+25% Faster Cast Rate" gets "20–30"). */
function annotateRanges(lines: DescLine[], ranges: RangeLine[]) {
  const open = ranges.filter((r) => r.lo !== r.hi);
  for (const l of lines) {
    if (l.kind !== 'mod') continue;
    const i = open.findIndex((r) => skeleton(r.lo) === skeleton(l.text));
    if (i < 0) continue;
    const [r] = open.splice(i, 1);
    const lo = r.lo.split(NUM), hi = r.hi.split(NUM), got = l.text.split(NUM);
    const parts: string[] = [];
    let perfect = true;
    for (let k = 1; k < lo.length; k += 2) {
      if (lo[k] === hi[k]) continue;
      parts.push(`${lo[k]}–${hi[k]}`);
      if (Number(got[k]) !== Number(hi[k])) perfect = false;
    }
    if (parts.length) Object.assign(l, { range: parts.join(', '), perfect });
  }
}

/** Which socket bonus a runeword's runes give, from the item types it can be made in. */
function slotForTypes(itypes: string[]): 'weapon' | 'helm' | 'shield' {
  const all = new Set(itypes.flatMap((t) => GD.types[t]?.all ?? [t]));
  if (all.has('weap')) return 'weapon';
  if (all.has('shld') && !all.has('tors') && !all.has('helm')) return 'shield';
  return 'helm';
}

function runeSocketStats(runes: string[], slot: 'weapon' | 'helm' | 'shield'): ItemStat[] {
  return runes.flatMap((r) => (GD.gems[r]?.[slot] ?? []).flatMap((m) => propStats(m.code, m.min, m.max, m.param)));
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
    const mods: DescLine[] = describeStats(statsAll).map((t) => ({ text: t, kind: 'mod' }));
    const template =
      qc === 'unique' ? { props: GD.uniques[item.uniqueId ?? -1]?.props, fixed: [] as ItemStat[] }
      : qc === 'set' ? { props: GD.setItems[item.setId ?? -1]?.props, fixed: [] as ItemStat[] }
      : qc === 'runeword' ? { props: runewordFor(item)?.props, fixed: item.sockets.flatMap((s) => socketStats(item, s)) }
      : undefined;
    if (template?.props) annotateRanges(mods, propLines(template.props, template.fixed));
    lines.push(...mods);
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
    const si = GD.setItems[item.setId ?? -1];
    if (si) lines.push(...setLines(si.setKey, si.set));
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

// ---------------------------------------------------------------- items not found yet

/** The set's name and the bonuses the whole set gives (partial and full), as set-bonus lines. */
function setLines(key: string, fallbackName: string): DescLine[] {
  const set = GD.sets[key];
  const out: DescLine[] = [{ text: set?.name ?? fallbackName, kind: 'info' }];
  if (set) {
    for (const [n, props] of set.partial) for (const l of propLines(props)) out.push({ text: `${l.text} (${n} items)`, kind: 'setbonus' });
    for (const l of propLines(set.full)) out.push({ text: `${l.text} (full set)`, kind: 'setbonus' });
  }
  return out;
}

/**
 * Tooltip for a unique, set item or runeword from the game tables alone (for collection slots with no copy):
 * base, requirements and every property with its possible range.
 */
export function describeTemplate(kind: 'unique' | 'set' | 'runeword', id: number): ItemDescription | undefined {
  const lines: DescLine[] = [];
  const mod = (t: string) => lines.push({ text: t, kind: 'mod' });
  let name: string, baseName: string, requiredLevel: number, qc: QualityClass;
  if (kind === 'runeword') {
    const rw = GD.runewords.find((r) => r.row === id);
    if (!rw) return undefined;
    name = rw.name;
    qc = 'runeword';
    const runeNames = rw.runes.map((r) => GD.items[r]?.name.replace(/ Rune$/, '') ?? r);
    baseName = rw.itypes.map((t) => GD.types[t]?.name ?? t).join(', ');
    requiredLevel = Math.max(0, ...rw.runes.map((r) => GD.items[r]?.levelReq ?? 0));
    lines.push({ text: `'${runeNames.join('')}'`, kind: 'base' });
    lines.push({ text: `${baseName} · ${rw.runes.length} sockets`, kind: 'base' });
    if (requiredLevel > 1) lines.push({ text: sprintf(GD.ui.ItemStats1p ?? 'Required Level: %d', requiredLevel), kind: 'req' });
    const slot = slotForTypes(rw.itypes);
    for (const l of propLines(rw.props, runeSocketStats(rw.runes, slot))) mod(l.text);
    if (new Set(rw.itypes.map((t) => slotForTypes([t]))).size > 1)
      lines.push({ text: `Rune bonuses shown for ${slot === 'weapon' ? 'weapons' : slot === 'shield' ? 'shields' : 'armor'}; they differ in other bases`, kind: 'info' });
  } else {
    const row = kind === 'unique' ? GD.uniques[id] : GD.setItems[id];
    if (!row) return undefined;
    name = row.name;
    qc = kind;
    baseName = GD.items[row.code]?.name ?? row.code;
    requiredLevel = Math.max(row.levelReq, GD.items[row.code]?.levelReq ?? 0);
    lines.push({ text: baseName, kind: 'base' });
    if (requiredLevel > 1) lines.push({ text: sprintf(GD.ui.ItemStats1p ?? 'Required Level: %d', requiredLevel), kind: 'req' });
    for (const l of propLines(row.props)) mod(l.text);
    if (kind === 'set') {
      const si = GD.setItems[id];
      for (const [n, props] of si.partial) for (const l of propLines(props)) lines.push({ text: `${l.text} (${n} items)`, kind: 'setbonus' });
      lines.push(...setLines(si.setKey, si.set));
    }
  }
  return { name, baseName, qualityClass: qc, lines, requiredLevel, short: name, search: [name, baseName, ...lines.map((l) => l.text)].join('\n').toLowerCase() };
}
