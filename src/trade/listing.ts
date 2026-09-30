import {
  GD,
  GEM_CODES,
  RUNE_CODES,
  UBER_CODES,
  autoRows,
  buildableTemplates,
  canBuildEthereal,
  classSkillsFor,
  describeStats,
  maxBaseSockets,
  propDefs,
  propLines,
  rollSlots,
  runewordBases,
  superiorRows,
  templateDefenseRange,
  buildableRunewords,
  runewordBaseProblem,
  runewordSlots,
  affixRows,
  canHaveAffixes,
  craftBases,
  isType,
  propStatsAt,
  statByName,
  type AffixPick,
  type ItemStat,
  type AffixQuality,
  type AffixSide,
  type ModPick,
  type PropDef,
  type RollSlot,
  type Rolls,
  type TemplateKind,
} from '../core';

/**
 * Reads a trade listing (the text of a Traderie screenshot, one line per entry) into an item the Trade panel can
 * build: which item it is, its rolls, and the listing's tags. Pure text in, plain data out, so it can be tested
 * without OCR. The rules (agreed for Trade):
 * - "Non Ladder" anywhere refuses the listing (checked first), then it must say PC, Ladder and Reign of the Warlock.
 * - It must say Softcore or Hardcore; that's matched against the file you trade into when you accept.
 * - It must have been posted in the last 3 days (Traderie shows "in 50 seconds", "3 hours ago"…).
 * - Every roll must be inside the item's real range. Rolls that can't be read are flagged and rolled at random
 *   within the range (not the best, not the worst).
 *
 * Traderie cards (real examples in tests/listing.test.ts): a title "1 X Demonhead", one tag line
 * "Reign Of The Warlock · PC · Ladder · Softcore · Superior", the stats in Traderie's own wording ("+10 To All
 * Resistances", "176Defense"), then "Trading For" and the price, seller and time, which aren't part of the item.
 */

/** Listings older than this don't count. */
export const MAX_LISTING_AGE_DAYS = 3;

export type Mode = 'softcore' | 'hardcore';

export interface ListingTags {
  pc: boolean;
  ladder: boolean;
  nonLadder: boolean;
  rotw: boolean;
  mode?: Mode;
  /** Other platforms named on the listing (Xbox, PlayStation, Switch). */
  otherPlatform?: string;
}

export type ListingItem =
  | { kind: 'rune' | 'gem' | 'uber'; code: string; name: string; quantity: number }
  | { kind: TemplateKind; id: number; name: string; rolls: Rolls; ethereal: boolean; defense?: number }
  /** A runeword ("1 X Call To Arms", "Crystal Sword" in the tags): the runeword, its base and its rolls. */
  | { kind: 'runeword'; row: number; name: string; code: string; base: string; rolls: Rolls; ethereal: boolean; superior?: ModPick }
  /** A whole set listed as one item ("1 X Angelic Raiment"): every piece. */
  | { kind: 'fullset'; set: string; name: string; pieces: { id: number; name: string; rolls: Rolls; defense?: number }[] }
  | { kind: 'base'; code: string; name: string; sockets: number; ethereal: boolean; defense?: number; superior?: ModPick; auto?: ModPick; skills: { skill: number; level: number }[] }
  /** A magic, rare or crafted item: its base and the prefixes and suffixes (and crafting recipe) that make up its stats. */
  | { kind: AffixQuality; code: string; name: string; affixes: AffixPick[]; craft?: ModPick; auto?: ModPick; sockets: number; ethereal: boolean; defense?: number; exact?: ItemStat[] };

export interface ListingResult {
  tags: ListingTags;
  item?: ListingItem;
  /** Why this listing can't be traded (tags, unknown item, rolls out of range). Empty when it can. */
  errors: string[];
  /** Things to check before adding (rolls that couldn't be read and were rolled at random). */
  warnings: string[];
  /** How sure the item match is, 0–1. */
  confidence: number;
  /** How old the listing was when the screenshot was taken, in seconds (undefined: not found). */
  age?: number;
  /** What the listing is trading for: one or more options (Traderie's "OR"), each a list of runes, gems or uber items. */
  ask?: AskItem[][];
}

/** One thing a listing asks for: "1 X Ist Rune". */
export interface AskItem {
  code: string;
  qty: number;
  name: string;
}

// ---------------------------------------------------------------- text helpers

/** Lower case, OCR look-alikes fixed next to digits (O→0, l/I/|→1), punctuation dropped, spaces collapsed. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/(?<=\d)[o](?=\d|\b|%)|(?<=\b|[+-])[o](?=\d)/g, '0')
    .replace(/(?<=\d)[il|](?=\d|\b|%)|(?<=\b|[+-])[il|](?=\d)/g, '1')
    .replace(/[^a-z0-9%+\-'() ]/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2') // "176Defense"
    .replace(/\bt0\b/g, 'to') // "+13T0 Dexterity"
    .replace(/(\d%? )t[o0](?=[a-z]{3,})/g, '$1to ') // "+31Tolife", "+2ToStrength"
    .replace(/\bin(\d)/g, 'in $1') // "in1second"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lines that describe the base item, not a roll. */
const BASE_LINE = /^(\d+ defense|defense:? \d+|durability|required|item level|(one|two)-hand damage|throw damage|quantity)\b/;

/** A random roll between lo and hi (both included), for rolls a listing doesn't show. */
export const randomRoll = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

const STOP = new Set(['to', 'of', 'the', 'by', 'a', 'an', 'on', 'x']);
/** Words of a stat line with the numbers blanked, ignoring small words and order ("All Resistances +10" = "+10 To All Resistances"). */
const tokens = (s: string) =>
  norm(s)
    .replace(/\(any class\)/g, ' ') // Traderie: "+6 To Battle Orders (Any Class)"
    .replace(/\(|\)/g, ' ')
    .replace(/\d+/g, '#')
    .replace(/(^|\s)\+#/g, '$1#') // "+6" and "6" (a red "+" OCR drops) read the same
    .split(' ')
    .flatMap(unglue)
    .filter((t) => t && !STOP.has(t));

let vocab: Set<string> | undefined;
/**
 * OCR sometimes runs a whole stat together ("+8ToAllResistances"): a long word that isn't one the game uses is
 * split into ones it does ("to", "all", "resistances"), fewest pieces first.
 */
function unglue(t: string): string[] {
  if (t.length < 7 || !/^[a-z]+$/.test(t)) return [t];
  vocab ??= new Set([...STOP, ...templates().flatMap((x) => norm(x.lo).split(/[^a-z]+/)).filter((w) => w.length > 1)]);
  if (vocab.has(t)) return [t];
  const best: (string[] | undefined)[] = [[]];
  for (let i = 1; i <= t.length; i++)
    for (let j = Math.max(0, i - 16); j < i; j++) {
      const w = t.slice(j, i);
      if (best[j] && vocab.has(w) && (!best[i] || best[j]!.length + 1 < best[i]!.length)) best[i] = [...best[j]!, w];
    }
  return best[t.length] && best[t.length]!.length > 1 ? best[t.length]! : [t];
}
/** How alike two stat lines' wordings are, 0–1, whatever the word order (typos in a word still count). */
function wordingSimilarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const free = tb.slice();
  let hit = 0;
  for (const t of ta) {
    let bi = -1, bs = 0.75;
    free.forEach((u, i) => {
      const sc = t === u ? 1 : t.length > 3 && u.length > 3 ? similarity(t, u) : 0;
      if (sc >= bs) (bs = sc), (bi = i);
    });
    if (bi >= 0) (hit += bs), free.splice(bi, 1);
  }
  return (2 * hit) / (ta.length + tb.length);
}
const numbers = (s: string) => (norm(s).match(/\d+/g) ?? []).map(Number);

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** 1 for the same text, falling towards 0 as OCR mistakes pile up. */
export const similarity = (a: string, b: string) => (a || b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1);

// ---------------------------------------------------------------- tags

export function readTags(lines: string[]): ListingTags {
  const all = ` ${lines.map(norm).join(' \n ')} `;
  const nonLadder = /non ?-?ladder/.test(all);
  const withoutNon = all.replace(/non ?-?ladder/g, ' ');
  const platform = /\b(xbox|playstation|ps ?4|ps ?5|switch|nintendo)\b/.exec(all)?.[1];
  const hc = /\bhard ?core\b/.test(all), sc = /\bsoft ?core\b/.test(all);
  return {
    nonLadder,
    ladder: /\bladder\b/.test(withoutNon),
    pc: /\bpc\b/.test(all),
    rotw: /reign of the warlock|\brotw\b/.test(all),
    mode: hc && !sc ? 'hardcore' : sc && !hc ? 'softcore' : undefined,
    otherPlatform: platform,
  };
}

/** The tag rules: Non Ladder first, then PC, Ladder, Reign of the Warlock, and one of Softcore/Hardcore. */
export function tagErrors(t: ListingTags): string[] {
  if (t.nonLadder) return ['This is a Non Ladder listing. Only Ladder trades are allowed.'];
  const out: string[] = [];
  if (t.otherPlatform && !t.pc) out.push(`This listing is for ${t.otherPlatform}, not PC.`);
  else if (!t.pc) out.push("Couldn't find the PC tag on the listing.");
  if (!t.ladder) out.push("Couldn't find the Ladder tag on the listing.");
  if (!t.rotw) out.push("Couldn't find the Reign of the Warlock tag on the listing.");
  if (!t.mode) out.push("Couldn't tell if the listing is Softcore or Hardcore.");
  return out;
}

// ---------------------------------------------------------------- item names

interface Candidate {
  item: () => ListingItem | undefined;
  names: string[];
  kind: ListingItem['kind'];
  /** For uniques and sets: which catalog entry. */
  ref?: number | string;
}

let candidates: Candidate[] | undefined;
function allCandidates(): Candidate[] {
  if (candidates) return candidates;
  const out: Candidate[] = [];
  for (const c of RUNE_CODES) {
    const name = GD.items[c].name;
    out.push({ kind: 'rune', ref: c, names: [norm(name), norm(name.replace(/ Rune$/, ''))], item: () => ({ kind: 'rune', code: c, name, quantity: 1 }) });
  }
  for (const c of GEM_CODES) out.push({ kind: 'gem', ref: c, names: [norm(GD.items[c].name)], item: () => ({ kind: 'gem', code: c, name: GD.items[c].name, quantity: 1 }) });
  for (const c of UBER_CODES) out.push({ kind: 'uber', ref: c, names: [norm(GD.items[c].name)], item: () => ({ kind: 'uber', code: c, name: GD.items[c].name, quantity: 1 }) });
  for (const kind of ['unique', 'set'] as const)
    for (const t of buildableTemplates(kind)) {
      // "Rainbow Facet (Cold, Death)": the listing says "Rainbow Facet"; the stats pick the variant
      const bare = (kind === 'unique' ? GD.uniques[t.id] : GD.setItems[t.id]).name;
      out.push({ kind, ref: t.id, names: [norm(bare)], item: undefined as never });
    }
  for (const b of runewordBases()) out.push({ kind: 'base', ref: b.code, names: [norm(b.name)], item: undefined as never });
  for (const rw of buildableRunewords()) out.push({ kind: 'runeword', ref: rw.row, names: [norm(rw.name)], item: undefined as never });
  // whole sets: Traderie lists a complete set under the set's name
  const setKeys = [...new Set(Object.values(GD.setItems).map((si) => si.setKey))];
  for (const key of setKeys) out.push({ kind: 'fullset', ref: key, names: [norm(GD.sets[key]?.name ?? key)], item: undefined as never });
  return (candidates = out);
}

/** The item a listing names, best first: [candidate, score]. A name found inside a line scores highest. */
function matchName(lines: string[]): [Candidate, number, number][] {
  const normed = lines.map(norm).filter(Boolean);
  const scored: [Candidate, number, number][] = [];
  for (const c of allCandidates()) {
    let best = 0, at = -1;
    normed.forEach((l, i) => {
      for (const n of c.names) {
        // a whole-word hit inside a longer line ("ethereal thresher", "ber rune x2"), or a fuzzy match of the line
        const inside = new RegExp(`(^|\\s)${n.replace(/[()+?.*[\]\\^$|]/g, '\\$&')}($|\\s)`).test(l) ? 0.97 + n.length / 1000 : 0;
        const fuzzy = similarity(l, n) - (Math.abs(l.length - n.length) > 3 ? 0.1 : 0);
        // the title comes first on a listing: names further down (an asking price, "Ber Rune x2") count a little less
        const s = Math.max(inside, fuzzy) - Math.min(0.05, i * 0.004);
        if (s > best + 1e-9) (best = s), (at = i);
      }
    });
    if (best >= 0.8) scored.push([c, best, at]);
  }
  // longer names beat the short ones they contain ("Perfect Amethyst" over "Amethyst"; "Tal Rasha's Lidless Eye" over "Eye")
  return scored.sort((a, b) => b[1] - a[1] || b[0].names[0].length - a[0].names[0].length || a[2] - b[2]);
}

// ---------------------------------------------------------------- stat lines

/**
 * Finds the line showing a roll and reads the rolled number from it: the property's text at its lowest and
 * highest roll gives the wording and which number varies ("+10 to all Attributes" / "+20 to all Attributes").
 */
function readRoll(lines: string[], used: Set<number>, lo: string, hi: string): { value: number; line: number } | undefined {
  const loN = numbers(lo), hiN = numbers(hi);
  const idx = loN.findIndex((n, i) => n !== hiN[i]);
  if (idx < 0) return undefined;
  let best: { value: number; line: number; score: number } | undefined;
  lines.forEach((l, i) => {
    // the item's own base lines ("Defense: 396", Traderie's "176Defense", durability, requirements) aren't rolls
    if (used.has(i) || BASE_LINE.test(norm(l))) return;
    const s = wordingSimilarity(l, lo);
    const got = numbers(l);
    if (s < 0.8 || got.length !== loN.length) return;
    if (!best || s > best.score) best = { value: got[idx], line: i, score: s };
  });
  return best && { value: best.value, line: best.line };
}

/** Whether a fixed (non-rolling) property's text is on the listing: used to tell look-alike items apart. */
function hasLine(lines: string[], text: string): boolean {
  const n = norm(text), want = numbers(text).sort((a, b) => a - b).join();
  return lines.some((l) => norm(l) === n || (wordingSimilarity(l, text) > 0.85 && numbers(l).sort((a, b) => a - b).join() === want));
}

function readTemplate(kind: TemplateKind, id: number, lines: string[], warnings: string[], errors: string[]): { rolls: Rolls; fit: number } {
  const code = (kind === 'unique' ? GD.uniques[id] : GD.setItems[id]).code;
  return readRolls(rollSlots(kind, id), lines, warnings, errors, GD.items[code]?.maxAc ?? 0);
}

/** Reads each roll of an item's properties from the listing's lines (uniques, set items and runewords alike). */
function readRolls(
  slots: RollSlot[],
  lines: string[],
  warnings: string[],
  errors: string[],
  baseMaxAc = 0,
  /** Runewords: what the socketed runes add to a slot's line (Tal's +30% Poison Resist in a helm), by slot key. */
  offsets: Record<string, number> = {},
  /** Explains a number above a slot's range (a superior base's Enhanced Defense on top): the slot's own roll. */
  overflow?: (s: RollSlot, v: number) => number | undefined,
): { rolls: Rolls; fit: number } {
  const used = new Set<number>();
  const rolls: Rolls = {};
  let seen = 0, total = 0;
  for (const s of slots) {
    if (s.pieces) continue; // set bonuses aren't on the item's own list
    const [lo, hi] = [s.lo, s.hi];
    if (s.kind === 'class' || s.kind === 'skill') {
      total++;
      const hit = s.options!.find((o) => optionText(s, o.value).some((t) => hasLine(lines, t)));
      if (hit) (rolls[s.key] = hit.value), seen++;
      else {
        const pick = s.options![randomRoll(0, s.options!.length - 1)];
        rolls[s.key] = pick.value;
        warnings.push(`Couldn't read which ${s.kind === 'class' ? 'class' : 'skill'} "${s.label}" gives; picked ${pick.label} at random.`);
      }
      continue;
    }
    if (s.kind === 'sockets') {
      total++;
      const n = socketsOn(lines);
      if (n !== undefined) {
        seen++;
        if (s.variable) {
          if (n < lo || n > hi) errors.push(`Sockets: ${n} is outside what this item can have (${lo}–${hi}).`);
          else rolls[s.key] = n;
        }
      } else if (s.variable) {
        rolls[s.key] = randomRoll(lo, hi);
        warnings.push(`Couldn't read the sockets; rolled ${rolls[s.key]} at random (${lo}–${hi}).`);
      }
      continue;
    }
    const texts = propLines([s.prop]);
    if (!s.variable) {
      if (texts.length) total++, (seen += texts.every((t) => hasLine(lines, t.lo)) ? 1 : 0);
      continue;
    }
    total++;
    const t = texts[0];
    const r = t && readRoll(lines, used, t.lo, t.hi);
    if (!r) {
      rolls[s.key] = randomRoll(s.lo, s.hi);
      warnings.push(`Couldn't read "${s.label}"; rolled ${rolls[s.key]} at random (${s.lo}–${s.hi}).`);
      continue;
    }
    used.add(r.line);
    seen++;
    // "ease" (requirements) and other negative rolls read as a positive number on the listing
    let v = (s.lo < 0 && r.value > 0 ? -r.value : r.value) - (offsets[s.key] ?? 0);
    // Traderie lists flat defense ("+159 Defense") as the item's total, base included: take the base out
    if (s.prop[0] === 'ac' && v > s.hi) {
      const flat = v - baseMaxAc;
      if (flat >= s.lo && flat <= s.hi) {
        warnings.push(`Read "+${v} Defense" as the total defense: +${flat} Defense on top of the base.`);
        v = flat;
      }
    }
    if (v > s.hi && overflow) v = overflow(s, v) ?? v;
    if (v < s.lo || v > s.hi) errors.push(`"${s.label}" reads ${v}, outside its range (${s.lo}–${s.hi}). The listing may be edited or misread.`);
    else rolls[s.key] = v;
  }
  return { rolls, fit: total ? seen / total : 1 };
}

/**
 * The base defense of a unique or set armor piece without Enhanced Defense, from the listing's total ("112Defense")
 * minus any flat defense it rolled. Items with Enhanced Defense always have the top base defense.
 */
function templateDefense(kind: TemplateKind, id: number, lines: string[], rolls: Rolls, ethereal: boolean, warnings: string[], errors: string[]): number | undefined {
  const range = templateDefenseRange(kind, id);
  if (!range) return undefined;
  const line = lines.map(norm).find((l) => /^\d+ defense$|^defense:? \d+$/.test(l));
  if (!line) {
    const d = randomRoll(range.lo, range.hi);
    warnings.push(`Couldn't read the defense; rolled ${d} at random (${range.lo}–${range.hi}).`);
    return d;
  }
  const total = numbers(line)[0];
  let flat = 0;
  for (const s of rollSlots(kind, id)) if (!s.pieces && s.prop[0] === 'ac') flat += rolls[s.key] ?? s.hi;
  for (let b = range.hi; b >= range.lo; b--) if ((ethereal ? Math.floor(b * 1.5) : b) + flat === total) return b;
  errors.push(`Defense ${total} isn't possible for this item (base ${range.lo}\u2013${range.hi}${flat ? `, +${flat}` : ''}).`);
  return undefined;
}

/**
 * A runeword: which base it's in (Traderie puts it in the tags: "Softcore · Crystal Sword"), ethereal or not, and
 * the runeword's own rolls ("+6 To Battle Orders").
 */
function readRuneword(row: number, lines: string[], warnings: string[], errors: string[]): ListingItem {
  const rw = GD.runewords.find((r) => r.row === row)!;
  const text = ` ${lines.map(norm).join(' | ')} `;
  // the longest base name on the listing that the runeword can be made in
  const base = Object.entries(GD.items)
    .filter(([code, d]) => (d.kind === 'weapon' || d.kind === 'armor') && !d.quest && text.includes(` ${norm(d.name)} `) && !runewordBaseProblem(row, code))
    .sort((a, b) => b[1].name.length - a[1].name.length)[0];
  const ethereal = /\bethereal\b/.test(text);
  if (!base) {
    errors.push(`Couldn't read which base ${rw.name} is in.`);
    return { kind: 'runeword', row, name: rw.name, code: '', base: '', rolls: {}, ethereal };
  }
  const [code, def] = base;
  if (ethereal && !canBuildEthereal('base', code)) errors.push(`A ${def.name} can't be ethereal.`);
  // the listing shows totals: the runes' own socket bonuses are included (Tal in a helm: +30% Poison Resist)
  const slotKind = def.flags.includes('W') ? 'weapon' : isType(code, 'shld') ? 'shield' : 'helm';
  const offsets: Record<string, number> = {};
  const slots = runewordSlots(row);
  for (const rune of rw.runes)
    for (const m of GD.gems[rune]?.[slotKind] ?? []) {
      const s = slots.find((x) => x.prop[0] === m.code && (x.prop[1] || '') === (m.param || ''));
      if (s) offsets[s.key] = (offsets[s.key] ?? 0) + m.max;
    }
  // Enhanced Defense or Damage above the runeword's range: a superior base's own 5–15% on top
  let superior: ModPick | undefined;
  const overflow = (s: RollSlot, v: number) => {
    const row = superiorRows(code).find((i) => GD.superior[i].mods.length === 1 && GD.superior[i].mods[0][0] === s.prop[0]);
    if (row === undefined) return undefined;
    const [, , lo, hi] = GD.superior[row].mods[0];
    const extra = Math.min(hi, Math.max(lo, v - s.hi));
    if (v - extra < s.lo || v - extra > s.hi) return undefined;
    superior = { row, values: [extra] };
    warnings.push(`Read ${v}% as a superior ${def.name} (+${extra}%) with ${v - extra}% from ${rw.name}.`);
    return v - extra;
  };
  const r = readRolls(slots, lines, warnings, errors, def.maxAc ?? 0, offsets, overflow);
  return { kind: 'runeword', row, name: rw.name, code, base: def.name, rolls: r.rolls, ethereal, superior };
}

/** A whole set: every piece, with whatever rolls the listing shows (usually none; then random rolls). */
function readFullSet(key: string, lines: string[], warnings: string[], errors: string[]): ListingItem {
  const buildable = new Map(buildableTemplates('set').map((t) => [t.id, t.name]));
  const ids = Object.entries(GD.setItems).filter(([, si]) => si.setKey === key).map(([id]) => Number(id));
  const pieces: { id: number; name: string; rolls: Rolls; defense?: number }[] = [];
  let unread = 0, rolling = 0;
  for (const id of ids) {
    if (!buildable.has(id)) {
      errors.push(`${GD.setItems[id].name} can't be built, so the full set can't be traded.`);
      continue;
    }
    const w: string[] = [];
    const r = readTemplate('set', id, lines, w, errors);
    rolling += rollSlots('set', id).some((sl) => sl.variable) ? 1 : 0;
    unread += w.length ? 1 : 0;
    pieces.push({ id, name: buildable.get(id)!, rolls: r.rolls, defense: templateDefense('set', id, lines, r.rolls, false, [], []) });
  }
  if (unread) warnings.push(unread === rolling ? 'The listing shows no stats: every roll is random.' : `Some rolls on ${unread} piece${unread === 1 ? '' : 's'} couldn't be read and are random.`);
  const name = GD.sets[key]?.name ?? key;
  return { kind: 'fullset', set: key, name: `${name} (full set, ${pieces.length} pieces)`, pieces };
}

/** Tooltip text of one choice of a class or skill roll: "+3 to Sorceress Skill Levels", "+3 to Blizzard (Sorceress Only)". */
function optionText(s: RollSlot, value: number): string[] {
  const f = propDefs(s.prop[0])[0];
  const stat = GD.stats.find((x) => x.key === (f?.stat ?? (s.kind === 'class' ? 'item_addclassskills' : 'item_singleskill')));
  if (!stat) return [];
  const level = s.kind === 'class' ? Number(f?.val) || Number(s.prop[1]) || 1 : Number(s.prop[1]) || 1;
  return describeStats([{ id: stat.id, param: value, value: level }]);
}

function socketsOn(lines: string[]): number | undefined {
  for (const l of lines.map(norm)) {
    const m = /socketed \((\d)\)|(\d) ?(?:os|sockets?|soc)\b|sockets?:? (\d)/.exec(l);
    if (m) return Number(m[1] ?? m[2] ?? m[3]);
  }
  return undefined;
}

const quantityOn = (lines: string[], at: number) => {
  for (const l of lines.slice(Math.max(0, at), at + 3).map(norm)) {
    const m = /(?:^|\s)x ?(\d{1,2})\b|\b(\d{1,2}) ?x(?:\s|$)|quantity:? (\d{1,2})/.exec(l);
    if (m) return Math.max(1, Math.min(99, Number(m[1] ?? m[2] ?? m[3])));
  }
  return 1;
};

function readBase(code: string, lines: string[], warnings: string[], errors: string[]): ListingItem {
  const def = GD.items[code];
  const ethereal = lines.some((l) => /\bethereal\b|\beth\b/.test(norm(l)));
  if (ethereal && !canBuildEthereal('base', code)) errors.push(`${def.name} can't be ethereal.`);
  const max = maxBaseSockets(code);
  let sockets = socketsOn(lines);
  if (sockets === undefined) (sockets = 0), warnings.push('No sockets found on the listing; set to 0.');
  if (sockets > max) errors.push(`${def.name} can have at most ${max} sockets, the listing says ${sockets}.`), (sockets = max);

  // superior: "+15% Enhanced Defense" / "Enhanced Damage"
  let superior: ModPick | undefined;
  for (const row of superiorRows(code)) {
    const mods = GD.superior[row].mods;
    const vals: number[] = [];
    const ok = mods.every((m) => {
      const t = propLines([m])[0];
      if (!t) return false;
      const r = t.lo === t.hi ? (hasLine(lines, t.lo) ? { value: m[3] } : undefined) : readRoll(lines, new Set(), t.lo, t.hi);
      if (!r || r.value < Math.min(m[2], m[3]) || r.value > Math.max(m[2], m[3])) return false;
      vals.push(r.value);
      return true;
    });
    if (ok && (!superior || mods.length > GD.superior[superior.row].mods.length)) superior = { row, values: vals };
  }
  // an automatic mod (paladin shield resistances, orb life/mana…): the row whose range fits the rolled value
  let auto: ModPick | undefined;
  for (const row of autoRows(code)) {
    const mods = GD.automagic[row].mods;
    const vals: number[] = [];
    const ok = mods.every((m) => {
      const t = propLines([m])[0];
      if (!t) return false;
      const r = t.lo === t.hi ? (hasLine(lines, t.lo) ? { value: m[3] } : undefined) : readRoll(lines, new Set(), t.lo, t.hi);
      if (!r || r.value < Math.min(m[2], m[3]) || r.value > Math.max(m[2], m[3])) return false;
      vals.push(r.value);
      return true;
    });
    if (ok) {
      auto = { row, values: vals };
      break;
    }
  }
  // class skills: "+3 to Blizzard (Sorceress Only)"
  const skills: { skill: number; level: number }[] = [];
  for (const s of classSkillsFor(code)) {
    for (const level of [3, 2, 1]) {
      const t = describeStats([{ id: GD.stats.find((x) => x.key === 'item_singleskill')!.id, param: s.id, value: level }])[0];
      if (t && hasLine(lines, t)) {
        skills.push({ skill: s.id, level });
        break;
      }
    }
    if (skills.length === 3) break;
  }
  const defLine = lines.map(norm).find((l) => /^defense:? \d+|^\d+ defense$/.test(l));
  let defense: number | undefined;
  if (defLine && def.minAc !== undefined && def.maxAc !== undefined) {
    // the listing shows the final defense: undo ethereal and superior Enhanced Defense to get the base roll
    const shown = numbers(defLine)[0];
    const ed = superior && GD.superior[superior.row].mods[0][0] === 'ac%' ? superior.values[0] : 0;
    // the game shows floor((floor(base × 1.5 if ethereal) + 1) × (100 + ED) / 100), without the +1 when there's no
    // Enhanced Defense; find the base roll that gives it
    const show = (b: number) => {
      const st = ethereal ? Math.floor(b * 1.5) : b;
      return ed ? Math.floor(((st + 1) * (100 + ed)) / 100) : st;
    };
    for (let b = def.maxAc; b >= def.minAc; b--) if (show(b) === shown) {
      defense = b;
      break;
    }
    if (defense === undefined && shown > show(def.maxAc)) errors.push(`Defense ${shown} is higher than a ${def.name} can roll.`);
    // superior with Enhanced Defense always has the top defense (the game stores it as the top + 1)
    if (ed && defense !== undefined) defense = def.maxAc + 1;
  }
  return { kind: 'base', code, name: def.name, sockets, ethereal, defense, superior, auto, skills };
}

// ---------------------------------------------------------------- magic, rare and crafted items

/** The listing's tag lines ("Reign Of The Warlock - Ladder - PC - Magic"), which aren't stats. */
const TAG_LINE = /reign of the warlock|\brotw\b|soft ?core|hard ?core|\bladder\b|\bpc\b|\bpenta\b|\bwhite\b|\bswitch\b|\bxbox\b|playstation|nintendo/;
const QUALITY_TAG = /^(magic|rare|crafted|superior|elite|exceptional|normal|ethereal|unidentified)$/;
const isTagLine = (l: string) => TAG_LINE.test(l) || QUALITY_TAG.test(l);

/** Lines of the item that are stats: not the title, tags, time, "Make an Offer", base lines or sockets. */
function statLines(lines: string[], title?: string): { text: string; digits: boolean }[] {
  return lines
    .filter((l) => l !== title)
    .map((l) => ({ l, n: norm(l) }))
    .filter(({ n }) => n && !isTagLine(n) && readAge([n]) === undefined && !/make an? offer|\boffers?\b|rune value|trading for/.test(n))
    .filter(({ n }) => !BASE_LINE.test(n) && socketsOn([n]) === undefined && !/^eth(ereal)?\b/.test(n))
    .map(({ l, n }) => ({ text: l, digits: /\d/.test(n) }));
}

/** A prefix, suffix, automatic mod or crafting recipe, with where its lines are on the listing. */
interface Source {
  side: AffixSide | 'auto' | 'craft';
  row: number;
  group: number;
  level: number;
  maxLevel?: number;
  mods: PropDef[];
  /** Each of its tooltip lines: the listing line it's on and the line's numbers at the lowest and highest roll. */
  lines: { at: number; lo: number[]; hi: number[]; score: number }[];
  /** For each mod that rolls: which of its lines and which number on that line show the roll. */
  vary: ({ line: number; pos: number; loN: number; hiN: number } | undefined)[];
}

/** Where a set of mods shows up on the listing, or undefined if any of its lines is missing. */
function placeMods(mods: PropDef[], stats: { text: string }[]): Pick<Source, 'lines' | 'vary'> | undefined {
  const rl = propLines(mods);
  if (!rl.length) return undefined;
  const taken = new Set<number>();
  const lines: Source['lines'] = [];
  for (const r of rl) {
    const want = numbers(r.lo).length;
    // stricter than for uniques: "Eldritch Skills" and "Chaos Skills" differ by one word
    let best = -1, bs = 0.85;
    stats.forEach((st, i) => {
      if (taken.has(i) || numbers(st.text).length !== want) return;
      const sc = wordingSimilarity(st.text, r.lo);
      if (sc >= bs) (bs = sc), (best = i);
    });
    if (best < 0) return undefined;
    taken.add(best);
    lines.push({ at: best, lo: numbers(r.lo), hi: numbers(r.hi), score: bs });
  }
  // which number each rolling mod moves: set just that mod to its top roll and see what changes
  const vary = mods.map((m, i) => {
    if (m[2] === m[3]) return undefined;
    const alt = propLines(mods.map((x, j): PropDef => [x[0], x[1], j === i ? Math.max(x[2], x[3]) : Math.min(x[2], x[3]), j === i ? Math.max(x[2], x[3]) : Math.min(x[2], x[3])]));
    for (let k = 0; k < Math.min(alt.length, rl.length); k++) {
      const a = numbers(alt[k].lo), b = lines[k].lo;
      const pos = a.findIndex((n, q) => n !== b[q]);
      if (pos >= 0) return { line: k, pos, loN: b[pos], hiN: a[pos] };
    }
    return undefined;
  });
  return { lines, vary };
}

/**
 * Splits the listing's stats into the prefixes and suffixes (plus a crafting recipe's own mods, or a class item's
 * automatic mod) that the item must have: every stat line covered, every number inside the summed ranges, and
 * no more affixes than the quality allows. Fewest affixes wins. Values of each affix come from the lines.
 */
function solveAffixes(code: string, quality: AffixQuality, stats: { text: string; digits: boolean }[], craftRow?: number) {
  const sources: Source[] = [];
  const add = (src: Omit<Source, 'lines' | 'vary'>) => {
    const placed = placeMods(src.mods, stats);
    if (placed) sources.push({ ...src, ...placed });
  };
  for (const side of ['prefix', 'suffix'] as const)
    for (const row of affixRows(side, code, quality)) {
      const a = GD.affixes[side][row];
      add({ side, row, group: a.group, level: a.level, maxLevel: a.maxLevel, mods: a.mods });
    }
  for (const row of autoRows(code)) add({ side: 'auto', row, group: -1, level: GD.automagic[row].level, maxLevel: GD.automagic[row].maxLevel, mods: GD.automagic[row].mods });
  let start: Source[] = [];
  if (craftRow !== undefined) {
    const c = GD.crafts[craftRow];
    const placed = placeMods(c.mods, stats);
    if (!placed) return { error: `A ${c.name} always has ${propLines(c.mods).map((l) => `"${l.text}"`).join(', ')}; the listing doesn't show all of them.` };
    start = [{ side: 'craft', row: craftRow, group: -1, level: 0, mods: c.mods, ...placed }];
  }
  // sources for each line, the ones whose own range fits the line's number first
  const byLine = new Map<number, Source[]>();
  for (const src of sources)
    src.lines.forEach((l) => {
      if (!byLine.has(l.at)) byLine.set(l.at, []);
      byLine.get(l.at)!.push(src);
    });
  const fitsAlone = (src: Source, at: number) => {
    const l = src.lines.find((x) => x.at === at)!;
    const n = numbers(stats[at].text);
    return l.lo.every((lo, p) => n[p] >= Math.min(lo, l.hi[p]) && n[p] <= Math.max(lo, l.hi[p]));
  };
  const scoreAt = (src: Source, at: number) => src.lines.find((x) => x.at === at)!.score;
  for (const [at, list] of byLine) list.sort((a, b) => scoreAt(b, at) - scoreAt(a, at) || Number(fitsAlone(b, at)) - Number(fitsAlone(a, at)) || b.level - a.level);

  const need = stats.map((s, i) => (s.digits ? i : -1)).filter((i) => i >= 0);
  const maxSide = quality === 'magic' ? 1 : 3;
  const maxTotal = quality === 'crafted' ? 4 : quality === 'magic' ? 2 : isType(code, 'jewl') ? 4 : 6;

  const evaluate = (chosen: Source[]) => {
    const per = new Map<number, { src: Source; k: number }[]>();
    chosen.forEach((src) => src.lines.forEach((l, k) => per.set(l.at, [...(per.get(l.at) ?? []), { src, k }])));
    const values = new Map<Source, number[]>(chosen.map((src) => [src, src.mods.map((m) => Math.max(m[2], m[3]))]));
    for (const [at, cs] of per) {
      const n = numbers(stats[at].text);
      for (let p = 0; p < n.length; p++) {
        const lo = cs.reduce((t, c) => t + c.src.lines[c.k].lo[p], 0), hi = cs.reduce((t, c) => t + c.src.lines[c.k].hi[p], 0);
        if (n[p] < Math.min(lo, hi) || n[p] > Math.max(lo, hi)) return undefined;
        // share the number out among the mods that roll it
        let left = n[p] - lo;
        for (const c of cs)
          c.src.vary.forEach((v, i) => {
            if (!v || v.line !== c.k || v.pos !== p) return;
            const span = v.hiN - v.loN;
            const take = span >= 0 ? Math.min(Math.max(left, 0), span) : Math.max(Math.min(left, 0), span);
            left -= take;
            const [, , mn, mx] = c.src.mods[i];
            values.get(c.src)![i] = span ? mn + Math.round((take * (mx - mn)) / span) : mx;
          });
        if (left !== 0 && cs.some((c) => c.src.vary.some((v) => v && v.line === c.k && v.pos === p))) return undefined;
      }
    }
    // mods whose roll isn't shown anywhere: random
    for (const src of chosen) src.vary.forEach((v, i) => !v && src.mods[i][2] !== src.mods[i][3] && (values.get(src)![i] = randomRoll(Math.min(src.mods[i][2], src.mods[i][3]), Math.max(src.mods[i][2], src.mods[i][3]))));
    return values;
  };

  let nodes = 0;
  let found: { chosen: Source[]; values: Map<Source, number[]> } | undefined;
  const dfs = (chosen: Source[], limit: number): boolean => {
    if (++nodes > 200000) return false;
    const covered = new Set(chosen.flatMap((s) => s.lines.map((l) => l.at)));
    const u = need.find((i) => !covered.has(i));
    if (u === undefined) {
      const values = evaluate(chosen);
      if (values) found = { chosen, values };
      return !!values;
    }
    const affixes = chosen.filter((s) => s.side === 'prefix' || s.side === 'suffix');
    if (affixes.length >= limit) return false;
    for (const src of byLine.get(u) ?? []) {
      if (chosen.includes(src)) continue;
      if (src.side === 'auto' ? chosen.some((s) => s.side === 'auto') : chosen.filter((s) => s.side === src.side).length >= maxSide) continue;
      if (src.side !== 'auto' && chosen.some((s) => s.side === src.side && s.group === src.group)) continue;
      const lvl = Math.max(src.level, ...chosen.map((s) => s.level)), cap = Math.min(src.maxLevel ?? 99, ...chosen.map((s) => s.maxLevel ?? 99));
      if (lvl > cap) continue;
      if (dfs([...chosen, src], limit)) return true;
    }
    return false;
  };
  for (let limit = 0; limit <= maxTotal && !found && nodes <= 200000; limit++) dfs(start, limit);
  if (!found) {
    const reachable = new Set(sources.flatMap((s) => s.lines.map((l) => l.at)).concat(start.flatMap((s) => s.lines.map((l) => l.at))));
    const missing = need.filter((i) => !reachable.has(i)).map((i) => `"${stats[i].text}"`);
    return { error: missing.length ? `No ${quality} ${GD.items[code].name} can have ${missing.join(', ')}.` : `These stats don't add up to a possible ${quality} ${GD.items[code].name}. The listing may be edited or misread.` };
  }
  const pick = (s: Source): ModPick => ({ row: s.row, values: found!.values.get(s)! });
  return {
    affixes: found.chosen.filter((s) => s.side === 'prefix' || s.side === 'suffix').map((s) => ({ side: s.side as AffixSide, ...pick(s) })),
    craft: found.chosen.find((s) => s.side === 'craft'),
    auto: found.chosen.find((s) => s.side === 'auto'),
    pick,
  };
}

// ---------------------------------------------------------------- crafted items: stats exactly as listed

let lineTemplates: { mods: PropDef[]; lo: string }[] | undefined;
/**
 * Every property the game tables use (alone, or as a group that shows as one line, like "Adds 1-17 Lightning
 * Damage"), with its tooltip wording: used to turn a listing's stat lines back into stats.
 */
function templates(): { mods: PropDef[]; lo: string }[] {
  if (lineTemplates) return lineTemplates;
  const out = new Map<string, { mods: PropDef[]; lo: string }>();
  const add = (mods: PropDef[]) => {
    const key = mods.map((m) => `${m[0]}/${m[1]}`).join('|');
    if (out.has(key) || mods.some((m) => !propDefs(m[0]).length)) return;
    const rl = propLines(mods);
    if (rl.length === 1 && /\d/.test(rl[0].lo)) out.set(key, { mods, lo: rl[0].lo });
  };
  const groups: PropDef[][] = [
    ...GD.affixes.prefix.map((a) => a.mods),
    ...GD.affixes.suffix.map((a) => a.mods),
    ...GD.automagic.map((a) => a.mods),
    ...GD.superior.map((a) => a.mods),
    ...GD.crafts.map((c) => c.mods),
    ...Object.values(GD.uniques).map((u) => u.props),
    ...Object.values(GD.setItems).flatMap((si) => [si.props, ...si.partial.map(([, p]) => p)]),
    ...GD.runewords.map((r) => r.props),
  ];
  for (const g of groups) {
    if (g.length > 1) add(g);
    for (const m of g) add([m]);
  }
  return (lineTemplates = [...out.values()]);
}

/** The values that make a template read exactly like a listing line, or undefined. */
function valuesFor(mods: PropDef[], line: string): number[] | undefined {
  const want = numbers(line);
  const options = mods.map((m) => [...new Set([...want.flatMap((n) => [n, -n]), Math.max(m[2], m[3])])]);
  const pick: number[] = [];
  const tryAt = (i: number): boolean => {
    if (i === mods.length) {
      const rl = propLines(mods.map((m, k): PropDef => [m[0], m[1], pick[k], pick[k]]));
      return rl.length === 1 && numbers(rl[0].lo).join() === want.join();
    }
    for (const v of options[i]) {
      pick[i] = v;
      if (tryAt(i + 1)) return true;
    }
    return false;
  };
  return options.reduce((n, o) => n * o.length, 1) <= 400 && tryAt(0) ? [...pick] : undefined;
}

/**
 * A crafted item's stats, exactly as its listing shows them: each line matched to the property whose wording it
 * has, with the listing's numbers. A line OCR garbled ("+14 To —") is taken as one of the recipe's own mods
 * (a Blood Ring always has life) when exactly one of them is missing and its range fits the number.
 */
function readExactStats(stats: { text: string; digits: boolean }[], craftRow: number) {
  const out: ItemStat[] = [];
  const errors: string[] = [], warnings: string[] = [];
  const unread: number[] = [];
  const used = new Set<string>();
  stats.forEach((st, i) => {
    const n = numbers(st.text).length;
    const ranked = templates()
      .map((t) => ({ t, sc: numbers(t.lo).length === n ? wordingSimilarity(st.text, t.lo) : 0 }))
      .filter((x) => x.sc >= (st.digits ? 0.85 : 0.9))
      .sort((a, b) => b.sc - a.sc);
    for (const { t } of ranked.slice(0, 12)) {
      const v = valuesFor(t.mods, st.text);
      if (!v) continue;
      t.mods.forEach((m, k) => (out.push(...propStatsAt(m[0], m[1], v[k], v[k], v[k]).stats), used.add(m[0])));
      return;
    }
    if (st.digits) unread.push(i);
  });
  // the recipe's own mods are always there: a garbled line can only be one that's missing
  const missing = GD.crafts[craftRow].mods.filter((m) => !used.has(m[0]) && propLines([m]).length === 1 && numbers(propLines([m])[0].lo).length === 1);
  for (const i of unread) {
    const [n] = numbers(stats[i].text);
    const fits = numbers(stats[i].text).length === 1 ? missing.filter((m) => n >= Math.min(m[2], m[3]) && n <= Math.max(m[2], m[3])) : [];
    if (fits.length === 1) {
      const m = fits[0];
      out.push(...propStatsAt(m[0], m[1], n, n, n).stats);
      missing.splice(missing.indexOf(m), 1);
      warnings.push(`Read "${stats[i].text}" as "${propLines([[m[0], m[1], n, n]])[0].lo}", which every ${GD.crafts[craftRow].name} has.`);
    } else errors.push(`Couldn't read the stat "${stats[i].text}".`);
  }
  if (!out.length && !errors.length) errors.push("Couldn't read any stats on this listing.");
  return { stats: out, errors, warnings };
}

/** The longest base name (that can be magic, rare or crafted) inside a text, as whole words. */
function baseIn(text: string, allowed?: string[]): string | undefined {
  const t = ` ${norm(text)} `;
  let best: string | undefined;
  for (const code of allowed ?? GD.itemOrder) {
    const d = GD.items[code];
    if (!d || !canHaveAffixes(code) || !t.includes(` ${norm(d.name)} `)) continue;
    if (!best || d.name.length > GD.items[best].name.length) best = code;
  }
  return best;
}

/**
 * Magic, rare and crafted listings. Traderie titles them with the base ("Amulet", "Jewel"), a charm's catalog name
 * ("Celtic Knot Grand Charm") or a crafting recipe ("Blood Gloves"), and tags the quality. Undefined when the
 * listing isn't one of these.
 */
function readAffixListing(title: string | undefined, lines: string[], titled: boolean): { item?: ListingItem; errors: string[]; warnings: string[] } | undefined {
  const tagWords = lines.map(norm).filter(isTagLine).join(' ');
  const tagged: AffixQuality | undefined = /\bcrafted\b/.test(tagWords) ? 'crafted' : /\brare\b/.test(tagWords) ? 'rare' : /\bmagic\b/.test(tagWords) ? 'magic' : undefined;
  const t = title ? norm(title) : '';
  const craftOf = (l: string) => GD.crafts.findIndex((c) => similarity(norm(c.name), l) >= 0.85);
  let craftRow = t ? craftOf(t) : -1;
  if (craftRow < 0 && !titled) for (const l of lines.slice(0, 3)) if (craftRow < 0) craftRow = craftOf(norm(l).replace(/^\S{0,3}\s*\d{1,3} ?x /, ''));
  if (craftRow < 0 && !tagged && (titled || !title || !baseIn(title))) return undefined;
  const quality: AffixQuality = craftRow >= 0 ? 'crafted' : tagged ?? 'magic';
  const errors: string[] = [], warnings: string[] = [];

  // the base: named in the title or the lines; a crafted item's comes from its recipe (and the Elite/Exceptional tag)
  let code: string | undefined;
  if (quality === 'crafted') {
    if (craftRow < 0) return { errors: [`Couldn't tell which crafted item "${title ?? ''}" is.`], warnings };
    const bases = craftBases(craftRow);
    code = baseIn(lines.join(' | '), bases);
    if (!code && bases.length === 1) code = bases[0];
    if (!code) {
      const tier = /\belite\b/.test(tagWords) ? 3 : /\bexceptional\b/.test(tagWords) ? 2 : /\bnormal\b/.test(tagWords) ? 1 : 0;
      const byTier = bases.filter((b) => GD.items[b].tier === tier);
      if (tier && byTier.length === 1) code = byTier[0];
    }
    if (!code) return { errors: [`Couldn't tell which base this ${GD.crafts[craftRow].name} is on.`], warnings };
  } else {
    code = (title && baseIn(title)) || baseIn(lines.join(' | '));
    if (!code) return { errors: [`Couldn't tell which base this ${quality} item is.`], warnings };
  }
  const def = GD.items[code];
  const ethereal = lines.some((l) => /\bethereal\b/.test(norm(l)));
  if (ethereal && !canBuildEthereal('base', code)) errors.push(`A ${def.name} can't be ethereal.`);
  const sockets = Math.min(socketsOn(lines) ?? 0, maxBaseSockets(code));

  const stats = statLines(lines, title);
  if (!stats.some((s) => s.digits)) return { errors: [...errors, "Couldn't read any stats on this listing."], warnings };
  if (quality === 'crafted') {
    // crafted items are made exactly as listed: every stat line as it reads, no affix or range check
    const exact = readExactStats(stats, craftRow);
    if (exact.errors.length) return { errors: [...errors, ...exact.errors], warnings };
    let defense: number | undefined;
    const line = lines.map(norm).find((l) => /^\d+ defense$|^defense:? \d+$/.test(l));
    if (line && def.minAc !== undefined && def.maxAc !== undefined && !exact.stats.some((x) => x.id === statByName('item_armor_percent')?.id)) {
      const shown = numbers(line)[0];
      const flat = exact.stats.filter((x) => x.id === statByName('armorclass')?.id).reduce((t, x) => t + x.value, 0);
      for (let b = def.maxAc; b >= def.minAc && defense === undefined; b--) if ((ethereal ? Math.floor(b * 1.5) : b) + flat === shown) defense = b;
    }
    return { item: { kind: 'crafted', code, name: `${GD.crafts[craftRow].name} (${def.name})`, affixes: [], exact: exact.stats, sockets, ethereal, defense }, errors, warnings: [...warnings, ...exact.warnings] };
  }
  // magic first; an untagged listing whose stats need more than a prefix and a suffix is rare
  let solved = solveAffixes(code, quality, stats);
  let q = quality;
  if ('error' in solved && !tagged && quality === 'magic') {
    const rare = solveAffixes(code, 'rare', stats);
    if (!('error' in rare)) (solved = rare), (q = 'rare');
  }
  if ('error' in solved) return { errors: [...errors, solved.error!], warnings };
  const label = `${q === 'magic' ? 'Magic' : 'Rare'} ${def.name}`;
  // base defense: the top one with Enhanced Defense (like a drop); otherwise read from the listing or random
  let defense: number | undefined;
  if (def.flags.includes('A') && def.minAc !== undefined && def.maxAc !== undefined && !solved.affixes.some((a) => GD.affixes[a.side][a.row].mods.some((m) => m[0] === 'ac%'))) {
    const line = lines.map(norm).find((l) => /^\d+ defense$|^defense:? \d+$/.test(l));
    if (line) {
      // the listing shows the total: base (×1.5 when ethereal) plus any flat defense the affixes rolled
      const shown = numbers(line)[0];
      let flat = 0;
      for (const a of solved.affixes) GD.affixes[a.side][a.row].mods.forEach((m, i) => m[0] === 'ac' && (flat += a.values[i]));
      for (let b = def.maxAc; b >= def.minAc && defense === undefined; b--) if ((ethereal ? Math.floor(b * 1.5) : b) + flat === shown) defense = b;
      if (defense === undefined) warnings.push(`Defense ${shown} doesn't fit a ${def.name}; its base defense is random.`);
    }
  }
  return {
    item: { kind: q, code, name: label, affixes: solved.affixes, craft: solved.craft && solved.pick(solved.craft), auto: solved.auto && solved.pick(solved.auto), sockets, ethereal, defense },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------- the whole listing

/** How old a listing is, from Traderie's "in 50 seconds", "3 hours ago", "a day ago"…, in seconds. */
export function readAge(lines: string[]): number | undefined {
  const unit: Record<string, number> = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
  let found: number | undefined;
  for (const l of lines.map(norm)) {
    const m = /\b(a|an|\d{1,3}) (second|sec|minute|min|hour|hr|day|week|month|year)s?\b/.exec(l);
    // "in 50 seconds", "3 hours ago", or just "42 seconds" (a clipped "in")
    if (m && (/\bago\b|^in\b|\bin \d|\bin an?\b/.test(l) || l === m[0] || new RegExp(`^[a-z]{1,2} ${m[0]}$`).test(l))) found = (m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1])) * unit[m[2]];
    else if (/\bjust now\b/.test(l)) found = 0;
  }
  return found;
}

/** Runewords the app can't build; say so instead of guessing. */
function unsupported(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const t = norm(title);
  const rw = GD.runewords.find((r) => r.complete && similarity(norm(r.name), t) >= 0.9);
  if (rw && !buildableRunewords().some((b) => b.row === rw.row)) return `${rw.name} is a runeword this app can't build yet.`;
  return undefined;
}

// ---------------------------------------------------------------- the price ("Trading For")

let payables: { code: string; name: string; keys: string[] }[] | undefined;
/** Letters OCR mixes up with digits in item names ("15 Rune" is "Ist Rune"). */
const lettersOnly = (s: string) => s.replace(/1|\|/g, 'i').replace(/5/g, 's').replace(/0/g, 'o').replace(/8/g, 'b').replace(/[^a-z']/g, '');
function payable(): { code: string; name: string; keys: string[] }[] {
  payables ??= [...RUNE_CODES, ...GEM_CODES, ...UBER_CODES].map((code) => {
    const name = GD.items[code].name;
    const keys = [lettersOnly(norm(name))];
    if (/ Rune$/.test(name)) keys.push(lettersOnly(norm(name.replace(/ Rune$/, ''))));
    return { code, name, keys };
  });
  return payables;
}

/**
 * Reads the "Trading For" lines: "1 X Ist Rune", "1XIstRune" (squashed), "1 X Lo Rune OR" / "1 X Ohm Rune"
 * (either one). Lines not separated by OR are all wanted together. Only runes, gems, keys and parts can be paid.
 */
export function readAsk(lines: string[]): { options: AskItem[][]; problems: string[]; skipped: string[] } {
  // each option: what it asks for, and anything in it that can't be paid here
  const opts: { items: AskItem[]; bad: string[] }[] = [];
  const problems: string[] = [];
  let cur = { items: [] as AskItem[], bad: [] as string[] };
  let or = false;
  const close = () => {
    if (cur.items.length || cur.bad.length) opts.push(cur);
    cur = { items: [], bad: [] };
  };
  for (const raw of lines) {
    const l = norm(raw).replace(/[)\]](?=[a-z])/g, 'j'); // OCR reads a J as ")": "9X)ah Rune"
    if (/make an? offer|open to offers|\boffers?\b/.test(l)) {
      problems.push("The listing asks for offers, not a set price, so there's nothing to pay.");
      continue;
    }
    // "1 x ist rune", "1xistrune", "£5 1x lo rune or": a count, an x, then the name
    const m = /(?:^|\s|[^a-z0-9])(\d{1,2}|[il|])\s*x\s*([a-z0-9' ]{2,})$/.exec(l.replace(/\s+or$/, ''));
    const endsOr = /\bor$/.test(l);
    if (!m) {
      if (endsOr) or = true;
      continue;
    }
    const want = lettersOnly(m[2]);
    let best: { code: string; name: string; score: number } | undefined;
    for (const p of payable()) for (const k of p.keys) {
      const sc = similarity(want, k);
      if (sc >= 0.8 && (!best || sc > best.score)) best = { code: p.code, name: p.name, score: sc };
    }
    if (or) close();
    or = endsOr;
    if (!best) {
      cur.bad.push(raw.replace(/^[^0-9]*/, '').replace(/\s+or$/i, '').trim());
      continue;
    }
    const qty = /^\d+$/.test(m[1]) ? Math.max(1, Number(m[1])) : 1; // "l x" is OCR's "1 X"
    const same = cur.items.find((a) => a.code === best!.code);
    if (same) same.qty += qty;
    else cur.items.push({ code: best.code, qty, name: best.name });
  }
  close();
  // an option with something that can't be paid here ("1 X Random Minor Key") is dropped when another option can be
  const good = opts.filter((o) => !o.bad.length);
  const skipped = opts.filter((o) => o.bad.length).map((o) => [...o.bad, ...o.items.map((a) => `${a.qty} X ${a.name}`)].join(' + '));
  if (!good.length) for (const t of skipped) problems.push(`The listing asks for "${t}". Only runes, gems, keys and parts can be paid with here.`);
  return { options: good.map((o) => o.items), problems, skipped: good.length ? skipped : [] };
}

/** "1× Ist Rune", "1× Lo Rune or 1× Ohm Rune" */
export const askText = (options: AskItem[][]) => options.map((o) => o.map((a) => `${a.qty}× ${a.name}`).join(' + ')).join(' or ');

/**
 * Reads a listing's text lines (from OCR) into tags, an item, its price and any problems. `price` is a second
 * reading of just the "Trading For" strip (see ./ocr.ts); whichever reading of the price is complete wins.
 */
export function readListing(rawLines: string[], price?: string[]): ListingResult {
  const r = readListingItem(rawLines);
  const all = rawLines.map((l) => l.trim()).filter(Boolean);
  const cut = all.findIndex((l) => /^trading for\b/.test(norm(l)));
  // no "Trading For": a "Make an Offer" listing, or a price that wasn't in the screenshot
  const tail = cut >= 0 ? all.slice(cut + 1).filter((l) => !/rune value|^in \d|\bago\b|^in\d/.test(norm(l))) : all.filter((l) => /make an? offer/.test(norm(l)));
  const reads = [price ?? [], tail].map(readAsk);
  const best = reads.find((a) => a.options.length && !a.problems.length) ?? reads.find((a) => a.options.length) ?? reads.find((a) => a.problems.length) ?? reads[0];
  if (best.problems.length) r.errors.push(...best.problems);
  else if (!best.options.length) r.errors.push("Couldn't read what the listing is trading for.");
  else for (const t of best.skipped) r.warnings.push(`Left out the "${t}" option: only runes, gems, keys and parts can be paid with here.`);
  return { ...r, ask: best.options.length ? best.options : undefined };
}

function readListingItem(rawLines: string[]): ListingResult {
  const all = rawLines.map((l) => l.trim()).filter(Boolean);
  // "Trading For" starts the price; the seller, "High Rune Value" and the time follow. None of it is the item.
  const cut = all.findIndex((l) => /^trading for\b/.test(norm(l)));
  const age = readAge(all);
  const itemLines = cut >= 0 ? all.slice(0, cut) : all;
  // the title: "1 X Demonhead" (the number is how many)
  // (OCR sometimes puts a stray mark in front: "© 1X Blood Ring")
  const TITLE = /^(?:\S{1,2}\s+)?(\d{1,3}) ?x /;
  const ti = itemLines.findIndex((l) => TITLE.test(norm(l)));
  const titleQty = ti >= 0 ? Number(TITLE.exec(norm(itemLines[ti]))![1]) : undefined;
  const lines = itemLines.map((l, i) => (i === ti ? l.replace(/^\s*(?:\S{1,2}\s+)?\d{1,3}\s*[xX×]\s+/, '') : l));
  const title = ti >= 0 ? lines[ti] : undefined;

  const tags = readTags(itemLines);
  const errors = tagErrors(tags);
  if (!tags.nonLadder) {
    if (age === undefined) errors.push("Couldn't find when the listing was posted.");
    else if (age > MAX_LISTING_AGE_DAYS * 86400) errors.push(`This listing is ${Math.floor(age / 86400)} days old. Only listings from the last ${MAX_LISTING_AGE_DAYS} days count.`);
  }
  const warnings: string[] = [];
  if (/\bunidentified\b/.test(lines.map(norm).join(' '))) warnings.push('The listing says Unidentified; you get the item identified, with the stats shown.');

  // match the title first; fall back to every line when there's no title or it's unreadable
  let matches = title ? matchName([title]) : [];
  if (!matches.length || matches[0][1] < 0.85) matches = matchName(lines);
  // runewords and whole sets are only ever the title: "+2 To Strength" isn't the runeword Strength
  if (ti >= 0) matches = matches.filter(([c, , at]) => (c.kind !== 'runeword' && c.kind !== 'fullset') || at === ti);
  const bad = unsupported(title);
  if (bad) return { tags, errors: [...errors, bad], warnings, confidence: 0, age };
  // magic, rare and crafted items: tagged so, named for a crafting recipe, or titled with a plain base name
  // ("Amulet", "Celtic Knot Grand Charm") that isn't a unique, set item, runeword or runeword base
  const titled = !!matches.length && matches[0][1] >= 0.85 && (!title || similarity(norm(title), matches[0][0].names[0]) >= 0.85);
  const affixed = readAffixListing(title, lines, titled);
  if (affixed) return { tags, item: affixed.item, errors: [...errors, ...affixed.errors], warnings: [...warnings, ...affixed.warnings], confidence: affixed.item ? 1 : 0, age };
  if (!matches.length) return { tags, errors: [...errors, "Couldn't recognise the item on this listing."], warnings, confidence: 0, age };
  if (titleQty !== undefined) matches = matches.map(([c, sc]) => [c, sc, ti] as [Candidate, number, number]);

  // uniques and sets that share a name (Rainbow Facets) or look alike: the one whose stats fit the listing best
  // a unique or set item's listing also names its base ("Harlequin Crest" / "Shako"): the unique wins
  const named = matches.some(([c, sc]) => (c.kind === 'unique' || c.kind === 'set') && sc >= 0.9);
  const pool = named ? matches.filter(([c]) => c.kind !== 'base') : matches;
  const top = pool[0][1];
  const close = pool.filter((m) => m[1] >= top - 0.02);
  let best: { item: ListingItem; warn: string[]; err: string[]; score: number } | undefined;
  for (const [c, score, at] of close) {
    const warn: string[] = [], err: string[] = [];
    let item: ListingItem | undefined;
    let fit = 1;
    if (c.kind === 'unique' || c.kind === 'set') {
      const r = readTemplate(c.kind, c.ref as number, lines, warn, err);
      fit = r.fit;
      const ethereal = lines.some((l) => /\bethereal\b/.test(norm(l)));
      if (ethereal && !canBuildEthereal(c.kind, (c.kind === 'unique' ? GD.uniques : GD.setItems)[c.ref as number].code)) err.push("This item can't be ethereal.");
      const name = buildableTemplates(c.kind).find((t) => t.id === c.ref)!.name;
      item = { kind: c.kind, id: c.ref as number, name, rolls: r.rolls, ethereal, defense: templateDefense(c.kind, c.ref as number, lines, r.rolls, ethereal, warn, err) };
    } else if (c.kind === 'base') item = readBase(c.ref as string, lines, warn, err);
    else if (c.kind === 'fullset') item = readFullSet(c.ref as string, lines, warn, err);
    else if (c.kind === 'runeword') item = readRuneword(c.ref as number, lines, warn, err);
    else item = { ...c.item()!, quantity: titleQty ?? quantityOn(lines, at) } as ListingItem;
    const s = score + fit;
    if (!best || s > best.score + 1e-9) best = { item: item!, warn, err, score: s };
  }
  return { tags, item: best!.item, errors: [...errors, ...best!.err], warnings: [...warnings, ...best!.warn], confidence: Math.min(1, best!.score / 2), age };
}
