// Builds src/core/data/gamedata.json from the vendored D2R excel tables + English strings.
// Usage: node scripts/build-gamedata.mjs [vendorDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.resolve(process.argv[2] ?? path.join(root, 'vendor/d2r-3.3'));
const outFile = path.join(root, 'src/core/data/gamedata.json');

function readTsv(name) {
  const text = fs.readFileSync(path.join(vendor, `${name}.txt`), 'utf8').replace(/\r/g, '');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const header = lines[0].split('\t').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split('\t');
    const row = {};
    header.forEach((h, i) => {
      if (h && !(h in row)) row[h] = (cols[i] ?? '').trim();
    });
    return row;
  });
  return rows;
}

const strings = JSON.parse(fs.readFileSync(path.join(vendor, 'allstrings-eng.json'), 'utf8'));
const lowerStrings = new Map(Object.entries(strings).map(([k, v]) => [k.toLowerCase(), v]));
const str = (key, fallback = key) => {
  if (!key) return fallback ?? '';
  const v = strings[key] ?? lowerStrings.get(key.toLowerCase());
  return typeof v === 'string' ? v : fallback;
};
const int = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// ---------- belts (potion slots per belt type; armor.txt 'belt' is a row index) ----------
const beltBoxes = readTsv('belts').map((r) => int(r.numboxes, 4));

// ---------- item stat cost ----------
const statRows = readTsv('itemstatcost');
const stats = statRows.map((r, id) => ({
  id,
  key: r.Stat,
  csvSigned: r.CSvSigned === '1',
  csvBits: int(r.CSvBits),
  csvParam: int(r.CSvParam),
  saveBits: int(r['Save Bits']),
  saveAdd: int(r['Save Add']),
  saveParamBits: int(r['Save Param Bits']),
  valShift: int(r.ValShift),
  descPriority: int(r.descpriority),
  descFunc: int(r.descfunc),
  descVal: int(r.descval),
  descPos: str(r.descstrpos, ''),
  descNeg: str(r.descstrneg, ''),
  desc2: str(r.descstr2, ''),
  dgrp: int(r.dgrp),
  dgrpFunc: int(r.dgrpfunc),
  dgrpVal: int(r.dgrpval),
  dgrpPos: str(r.dgrpstrpos, ''),
  dgrpNeg: str(r.dgrpstrneg, ''),
  dgrp2: str(r.dgrpstr2, ''),
}));
// Note: the stat ID is the row index. The '*ID' column is only a comment (and contains typos, e.g. two 213s).

// ---------- item types ----------
const typeRows = readTsv('itemtypes').filter((r) => r.Code);
const types = {};
for (const r of typeRows) {
  types[r.Code] = {
    name: str(r.ItemType, r.ItemType),
    equiv: [r.Equiv1, r.Equiv2].filter(Boolean),
    varInvGfx: int(r.VarInvGfx),
    bodyLoc: [r.BodyLoc1, r.BodyLoc2].filter(Boolean),
    cls: r.Class || undefined,
    throwable: r.Throwable === '1',
    beltable: r.Beltable === '1' || undefined,
    maxSockets: [int(r.MaxSockets1), int(r.MaxSockets2), int(r.MaxSockets3)],
  };
}
const ancestorsCache = {};
function ancestors(code) {
  if (ancestorsCache[code]) return ancestorsCache[code];
  const out = new Set([code]);
  for (const p of types[code]?.equiv ?? []) for (const a of ancestors(p)) out.add(a);
  return (ancestorsCache[code] = out);
}
for (const code of Object.keys(types)) types[code].all = [...ancestors(code)];

// ---------- base items (weapons, armor, misc — concatenated in that order like items.txt) ----------
const items = {};
const itemOrder = [];
for (const [file, kind] of [['weapons', 'weapon'], ['armor', 'armor'], ['misc', 'misc']]) {
  for (const r of readTsv(file)) {
    if (!r.code) continue;
    const index = itemOrder.length;
    itemOrder.push(r.code);
    if (items[r.code]) continue;
    const anc = new Set([...(ancestors(r.type) ?? []), ...(r.type2 ? ancestors(r.type2) : [])]);
    let flags = '';
    if (anc.has('armo')) flags += 'A';
    if (anc.has('weap')) flags += 'W';
    if (anc.has('gold')) flags += 'G';
    if (anc.has('char')) flags += 'C';
    if (anc.has('body')) flags += 'B';
    if (anc.has('play')) flags += 'P';
    if (anc.has('scro') || anc.has('book')) flags += 'S';
    if (anc.has('rune')) flags += 'R';
    if (anc.has('gem')) flags += 'g';
    if (anc.has('jewl')) flags += 'J';
    if (anc.has('ques')) flags += 'Q';
    items[r.code] = {
      index,
      name: str(r.namestr, r.name),
      kind,
      type: r.type,
      type2: r.type2 || undefined,
      flags,
      w: int(r.invwidth, 1),
      h: int(r.invheight, 1),
      compact: int(r.compactsave),
      stackable: int(r.stackable),
      quest: int(r.quest),
      questDiff: int(r.questdiffcheck),
      level: int(r.level),
      levelReq: int(r.levelreq),
      reqStr: int(r.reqstr),
      reqDex: int(r.reqdex),
      dur: int(r.durability),
      noDur: int(r.nodurability),
      minDam: int(r.mindam) || undefined,
      maxDam: int(r.maxdam) || undefined,
      min2h: int(r['2handmindam']) || undefined,
      max2h: int(r['2handmaxdam']) || undefined,
      minMis: int(r.minmisdam) || undefined,
      maxMis: int(r.maxmisdam) || undefined,
      oneOrTwo: r['1or2handed'] === '1' || undefined,
      twoHanded: r['2handed'] === '1' || undefined,
      minAc: int(r.minac) || undefined,
      maxAc: int(r.maxac) || undefined,
      gemSockets: int(r.gemsockets),
      gemApply: int(r.gemapplytype),
      tier: r.code === r.ultracode ? 3 : r.code === r.ubercode ? 2 : r.normcode ? 1 : 0,
      maxStack: int(r.maxstack) || undefined,
      invfile: r.invfile || undefined,
      beltBoxes: r.type === 'belt' && r.belt !== '' ? beltBoxes[int(r.belt)] : undefined,
    };
  }
}

// ---------- item property lists: [code, param, min, max] (for tooltips of items not found yet, and roll ranges) ----------
const propList = (r, code, param, min, max, n) =>
  Array.from({ length: n }, (_, i) => i + 1)
    .map((i) => [r[code(i)], r[param(i)] ?? '', int(r[min(i)]), int(r[max(i)])])
    .filter(([c]) => c && !c.startsWith('*'));

// ---------- uniques / sets ----------
// Unique/set IDs: row index with the 'Expansion' separator rows skipped (matches the '*ID' comment column).
const uniques = {};
let uniqueId = 0;
for (const r of readTsv('uniqueitems')) {
  if (r.index === 'Expansion') continue;
  const id = uniqueId++;
  if (r['*ID'] !== '' && int(r['*ID']) !== id) console.warn(`uniqueitems: row ${r.index} *ID ${r['*ID']} != ${id}`);
  uniques[id] = {
    name: str(r.index, r.index),
    code: r.code,
    levelReq: int(r['lvl req']),
    disabled: r.disabled === '1' || undefined,
    carry1: int(r.carry1) || undefined,
    // the in-game Chronicle (RotW's grail) leaves these out: legacy, duplicate or unobtainable rows
    noChronicle: r.disableChronicle === '1' || undefined,
    props: propList(r, (i) => `prop${i}`, (i) => `par${i}`, (i) => `min${i}`, (i) => `max${i}`, 12),
  };
}
const setItems = {};
let setId = 0;
for (const r of readTsv('setitems')) {
  if (r.index === 'Expansion') continue;
  const id = setId++;
  if (r['*ID'] !== '' && int(r['*ID']) !== id) console.warn(`setitems: row ${r.index} *ID ${r['*ID']} != ${id}`);
  setItems[id] = {
    name: str(r.index, r.index),
    set: str(r.set, r.set),
    setKey: r.set,
    code: r.item,
    levelReq: int(r['lvl req']),
    noChronicle: r.disableChronicle === '1' || undefined,
    props: propList(r, (i) => `prop${i}`, (i) => `par${i}`, (i) => `min${i}`, (i) => `max${i}`, 9),
    // bonuses this item gets while more pieces of its set are worn: [items worn, props]
    partial: [1, 2, 3, 4, 5]
      .map((n) => [n + 1, ['a', 'b'].flatMap((x) => propList(r, () => `aprop${n}${x}`, () => `apar${n}${x}`, () => `amin${n}${x}`, () => `amax${n}${x}`, 1))])
      .filter(([, p]) => p.length),
  };
}
const sets = {};
for (const r of readTsv('sets')) {
  if (!r.index || r.index === 'Expansion') continue;
  sets[r.index] = {
    name: str(r.name, r.index),
    partial: [2, 3, 4, 5]
      .map((n) => [n, ['a', 'b'].flatMap((x) => propList(r, () => `PCode${n}${x}`, () => `PParam${n}${x}`, () => `PMin${n}${x}`, () => `PMax${n}${x}`, 1))])
      .filter(([, p]) => p.length),
    full: propList(r, (i) => `FCode${i}`, (i) => `FParam${i}`, (i) => `FMin${i}`, (i) => `FMax${i}`, 8),
  };
}

// ---------- runewords ----------
const runewords = readTsv('runes').map((r, row) => ({
  row,
  key: r.Name,
  name: str(r.Name, r['*Rune Name']),
  complete: r.complete === '1',
  runes: ['Rune1', 'Rune2', 'Rune3', 'Rune4', 'Rune5', 'Rune6'].map((c) => r[c]).filter(Boolean),
  itypes: ['itype1', 'itype2', 'itype3', 'itype4', 'itype5', 'itype6'].map((c) => r[c]).filter(Boolean),
  props: propList(r, (i) => `T1Code${i}`, (i) => `T1Param${i}`, (i) => `T1Min${i}`, (i) => `T1Max${i}`, 7),
}));

// ---------- affixes ----------
// Magic prefix/suffix IDs are the row index in the table (blank placeholder rows included).
// ID 0 means "no affix" (row 0 of magicsuffix, "of Health", is never referenced).
const prefixRows = readTsv('magicprefix');
const suffixRows = readTsv('magicsuffix');
const magicPrefix = prefixRows.map((r) => (r.Name ? str(r.Name, r.Name) : null));
const magicSuffix = suffixRows.map((r) => (r.Name ? str(r.Name, r.Name) : null));
const magicPrefixReq = prefixRows.map((r) => int(r.levelreq));
const magicSuffixReq = suffixRows.map((r) => int(r.levelreq));
const rareSuffix = readTsv('raresuffix').map((r) => str(r.name, r.name));
const rarePrefix = readTsv('rareprefix').map((r) => str(r.name, r.name));
// Rare name ids index a combined table: [none, ...raresuffix, ...rareprefix]
const rareNames = [null, ...rareSuffix, ...rarePrefix];

// ---------- classes & skills ----------
const classes = readTsv('charstats')
  .filter((r) => r.class && r.class !== 'Expansion')
  .map((r) => ({
    name: r.class,
    allSkills: str(r.StrAllSkills, ''),
    tabs: [str(r.StrSkillTab1, ''), str(r.StrSkillTab2, ''), str(r.StrSkillTab3, '')],
    classOnly: str(r.StrClassOnly, ''),
  }));
const classCodes = readTsv('playerclass').map((r) => r.Code).filter(Boolean);
const skillDescRows = Object.fromEntries(readTsv('skilldesc').map((r) => [r.skilldesc, r]));
const skills = {};
for (const r of readTsv('skills')) {
  const id = int(r['*Id'], -1);
  if (id < 0) continue;
  const desc = skillDescRows[r.skilldesc];
  skills[id] = {
    key: r.skill,
    name: desc ? str(desc['str name'], r.skill) : r.skill,
    cls: r.charclass ? classCodes.indexOf(r.charclass) : -1,
  };
}

// ---------- gems (socket bonuses) ----------
const gems = {};
for (const r of readTsv('gems')) {
  if (!r.code) continue;
  const mods = (prefix) =>
    [1, 2, 3]
      .map((n) => ({ code: r[`${prefix}Mod${n}Code`], param: r[`${prefix}Mod${n}Param`], min: int(r[`${prefix}Mod${n}Min`]), max: int(r[`${prefix}Mod${n}Max`]) }))
      .filter((m) => m.code);
  gems[r.code] = { name: str(r.name, r.name), letter: r.letter || undefined, weapon: mods('weapon'), helm: mods('helm'), shield: mods('shield') };
}

// properties -> stat mapping (for translating gem mods into stat lines)
const properties = {};
for (const r of readTsv('properties')) {
  if (!r.code || r.code === 'Expansion') continue;
  properties[r.code] = [1, 2, 3, 4, 5, 6, 7]
    .map((n) => ({ func: int(r[`func${n}`]), stat: r[`stat${n}`] || undefined, val: r[`val${n}`] || undefined }))
    .filter((f) => f.func);
}

// ---------- mercenaries (hireling.txt; the save stores the Id, name index and experience) ----------
const nameRange = (first, last) => {
  const m1 = /^(.*?)(\d+)$/.exec(first), m2 = /^(.*?)(\d+)$/.exec(last);
  if (!m1 || !m2) return [];
  const out = [];
  for (let n = int(m1[2]); n <= int(m2[2]); n++) out.push(str(m1[1] + String(n).padStart(m1[2].length, '0'), ''));
  return out;
};
const nameLists = [];
const nameListIndex = new Map();
const mercs = {};
for (const r of readTsv('hireling')) {
  if (!r.Hireling || r.Hireling === 'Expansion' || r.Id === '' || String(r.Id) in mercs) continue;
  const key = `${r.NameFirst}-${r.NameLast}`;
  if (!nameListIndex.has(key)) {
    nameListIndex.set(key, nameLists.length);
    nameLists.push(nameRange(r.NameFirst, r.NameLast));
  }
  const skills = [1, 2, 3, 4, 5, 6].map((n) => r[`Skill${n}`]).filter((x) => x && isNaN(Number(x)));
  mercs[r.Id] = { cls: r.Hireling, act: int(r.Act), diff: int(r.Difficulty), expPerLvl: int(r['Exp/Lvl']), skills, names: nameListIndex.get(key) };
}

// ---------- misc UI strings ----------
const uiKeys = [
  'strethereal', 'Hiquality', 'Crude', 'Cracked', 'Damaged', 'Low Quality', 'ItemModifierPersonalized', 'increaseswithplaylevelX',
  'ItemStats1b', 'ItemStats1d', 'ItemStats1e', 'ItemStats1f', 'ItemStats1h', 'ItemStats1i', 'ItemStats1l', 'ItemStats1m',
  'ItemStats1n', 'ItemStats1p', 'Socketable', 'strModAllResistances', 'Moditem2allattrib', 'ModStre10d', 'ModStre10b',
  'ModStre9x', 'ModStre9w', 'ItemExpcharmdesc', 'ExInsertSockets', 'strItemModEtherealSocketed', 'strChatHardcore',
  'strModMinDamage', 'strModMaxDamage', 'strModMinDamageRange', 'strModEnhancedDamage', 'strModFireDamage', 'strModFireDamageRange',
  'strModColdDamage', 'strModColdDamageRange', 'strModLightningDamage', 'strModLightningDamageRange', 'strModMagicDamage',
  'strModMagicDamageRange', 'strModPoisonDamage', 'strModPoisonDamageRange', 'strModAllSkillLevels', 'ModStr5a', 'ModStr5b',
  'strItemModEthereal', 'Ethereal', 'ItemStats1c', 'ItemStast1k', 'strGemPlaceholder', 'ModStr1u', 'Rune',
];
const ui = {};
for (const k of uiKeys) if (typeof strings[k] === 'string') ui[k] = strings[k];

const data = {
  meta: { source: 'D2R patch 3.3 (vendor/d2r-3.3)', builtAt: new Date().toISOString().slice(0, 10) },
  stats,
  types,
  items,
  itemOrder,
  uniques,
  setItems,
  sets,
  runewords,
  magicPrefix,
  magicSuffix,
  magicPrefixReq,
  magicSuffixReq,
  rareNames,
  classes,
  skills,
  mercs,
  mercNames: nameLists,
  gems,
  properties,
  ui,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(data));
console.log(
  `gamedata.json: ${stats.length} stats, ${Object.keys(items).length} items, ${Object.keys(uniques).length} uniques, ` +
    `${Object.keys(setItems).length} set items, ${runewords.length} runewords, ${Object.keys(skills).length} skills, ` +
    `${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`,
);
