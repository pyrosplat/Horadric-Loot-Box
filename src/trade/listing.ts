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
  type ModPick,
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
  /** A whole set listed as one item ("1 X Angelic Raiment"): every piece. */
  | { kind: 'fullset'; set: string; name: string; pieces: { id: number; name: string; rolls: Rolls; defense?: number }[] }
  | { kind: 'base'; code: string; name: string; sockets: number; ethereal: boolean; defense?: number; superior?: ModPick; auto?: ModPick; skills: { skill: number; level: number }[] };

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
    .replace(/\bin(\d)/g, 'in $1') // "in1second"
    .replace(/\s+/g, ' ')
    .trim();
}

/** A random roll between lo and hi (both included), for rolls a listing doesn't show. */
export const randomRoll = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

const STOP = new Set(['to', 'of', 'the', 'by', 'a', 'an', 'on', 'x']);
/** Words of a stat line with the numbers blanked, ignoring small words and order ("All Resistances +10" = "+10 To All Resistances"). */
const tokens = (s: string) => norm(s).replace(/\(|\)/g, ' ').replace(/\d+/g, '#').split(' ').filter((t) => t && !STOP.has(t));
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
    if (used.has(i)) return;
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
  const slots = rollSlots(kind, id);
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
    let v = s.lo < 0 && r.value > 0 ? -r.value : r.value;
    // Traderie lists flat defense ("+159 Defense") as the item's total, base included: take the base out
    if (s.prop[0] === 'ac' && v > s.hi) {
      const code = (kind === 'unique' ? GD.uniques[id] : GD.setItems[id]).code;
      const flat = v - (GD.items[code]?.maxAc ?? 0);
      if (flat >= s.lo && flat <= s.hi) {
        warnings.push(`Read "+${v} Defense" as the total defense: +${flat} Defense on top of the base.`);
        v = flat;
      }
    }
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
  }
  return { kind: 'base', code, name: def.name, sockets, ethereal, defense, superior, auto, skills };
}

// ---------------------------------------------------------------- the whole listing

/** How old a listing is, from Traderie's "in 50 seconds", "3 hours ago", "a day ago"…, in seconds. */
export function readAge(lines: string[]): number | undefined {
  const unit: Record<string, number> = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
  let found: number | undefined;
  for (const l of lines.map(norm)) {
    const m = /\b(a|an|\d{1,3}) (second|sec|minute|min|hour|hr|day|week|month|year)s?\b/.exec(l);
    if (m && (/\bago\b|^in\b|\bin \d|\bin an?\b/.test(l) || l === m[0])) found = (m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1])) * unit[m[2]];
    else if (/\bjust now\b/.test(l)) found = 0;
  }
  return found;
}

/** Magic, rare and crafted items and runewords can't be built yet; say so instead of guessing. */
function unsupported(title: string | undefined, lines: string[], matched: boolean): string | undefined {
  if (!title) return undefined;
  const t = norm(title);
  const rw = GD.runewords.find((r) => r.complete && similarity(norm(r.name), t) >= 0.9);
  if (rw) return `${rw.name} is a runeword. Runewords can't be traded yet.`;
  if (matched) return undefined;
  const all = lines.map(norm).join(' ');
  if (/\b(magic|rare|crafted)\b/.test(all)) return 'Magic, rare and crafted items can\u2019t be traded yet.';
  const base = Object.values(GD.items).map((i) => norm(i.name)).filter((n) => n.length > 3 && t.endsWith(n)).sort((a, b) => b.length - a.length)[0];
  if (base && base !== t) return `"${title}" looks like a magic or rare item. Magic, rare and crafted items can't be traded yet.`;
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
export function readAsk(lines: string[]): { options: AskItem[][]; problems: string[] } {
  const options: AskItem[][] = [];
  const problems: string[] = [];
  let cur: AskItem[] = [];
  let or = false;
  for (const raw of lines) {
    const l = norm(raw);
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
    if (or && cur.length) (options.push(cur), (cur = []));
    or = endsOr;
    if (!best) {
      problems.push(`The listing asks for "${raw.replace(/^[^0-9]*/, '').trim()}". Only runes, gems, keys and parts can be paid with here.`);
      continue;
    }
    const qty = /^\d+$/.test(m[1]) ? Math.max(1, Number(m[1])) : 1; // "l x" is OCR's "1 X"
    const same = cur.find((a) => a.code === best!.code);
    if (same) same.qty += qty;
    else cur.push({ code: best.code, qty, name: best.name });
  }
  if (cur.length) options.push(cur);
  return { options, problems };
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
  const tail = cut >= 0 ? all.slice(cut + 1).filter((l) => !/rune value|^in \d|\bago\b|^in\d/.test(norm(l))) : [];
  const reads = [price ?? [], tail].map(readAsk);
  const best = reads.find((a) => a.options.length && !a.problems.length) ?? reads.find((a) => a.options.length) ?? reads.find((a) => a.problems.length) ?? reads[0];
  if (best.problems.length) r.errors.push(...best.problems);
  else if (!best.options.length) r.errors.push("Couldn't read what the listing is trading for.");
  return { ...r, ask: best.options.length ? best.options : undefined };
}

function readListingItem(rawLines: string[]): ListingResult {
  const all = rawLines.map((l) => l.trim()).filter(Boolean);
  // "Trading For" starts the price; the seller, "High Rune Value" and the time follow. None of it is the item.
  const cut = all.findIndex((l) => /^trading for\b/.test(norm(l)));
  const age = readAge(all);
  const itemLines = cut >= 0 ? all.slice(0, cut) : all;
  // the title: "1 X Demonhead" (the number is how many)
  const ti = itemLines.findIndex((l) => /^\d{1,3} ?x /.test(norm(l)));
  const titleQty = ti >= 0 ? Number(/^(\d{1,3})/.exec(norm(itemLines[ti]))![1]) : undefined;
  const lines = itemLines.map((l, i) => (i === ti ? l.replace(/^\s*\d{1,3}\s*[xX×]\s+/, '') : l));
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
  const bad = unsupported(title, lines, !!matches.length && matches[0][1] >= 0.85 && (!title || similarity(norm(title), matches[0][0].names[0]) >= 0.85 || matches[0][0].kind === 'base'));
  if (bad) return { tags, errors: [...errors, bad], warnings, confidence: 0, age };
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
    else item = { ...c.item()!, quantity: titleQty ?? quantityOn(lines, at) } as ListingItem;
    const s = score + fit;
    if (!best || s > best.score + 1e-9) best = { item: item!, warn, err, score: s };
  }
  return { tags, item: best!.item, errors: [...errors, ...best!.err], warnings: [...warnings, ...best!.warn], confidence: Math.min(1, best!.score / 2), age };
}
