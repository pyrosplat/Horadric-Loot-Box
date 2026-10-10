import { describe, expect, test } from 'vitest';
import { GD, affixRows, buildableTemplates, createAffixItem, createRunewordItem, createBaseItem, createTemplateItem, describeItem, pickRolls, rollSlots, type Rolls } from '../src/core';
import { askText, readAge, readAsk, readListing, readTags, tagErrors, type ListingItem } from '../src/trade/listing';
import { columnLines } from '../src/trade/ocr';

type AffixListing = Extract<ListingItem, { affixes: unknown }>;

const TAGS = ['PC', 'Ladder', 'Softcore', 'Reign Of The Warlock', 'Trading For', '1 X Ist Rune', 'in 5 minutes'];
const idOf = (kind: 'unique' | 'set', name: string) => buildableTemplates(kind).find((t) => t.name === name)!.id;
/** A listing as the item's own tooltip lines (name first) plus tags. */
function listing(kind: 'unique' | 'set', name: string, rolls: Rolls, extra: string[] = TAGS, opts = {}) {
  const it = createTemplateItem(kind, idOf(kind, name), rolls, opts);
  const d = describeItem(it);
  return [d.name, ...d.lines.map((l) => l.text), ...extra];
}
const vary = (kind: 'unique' | 'set', name: string, pick: (lo: number, hi: number) => number) =>
  Object.fromEntries(rollSlots(kind, idOf(kind, name)).filter((s) => s.variable && s.kind === 'value').map((s) => [s.key, pick(s.lo, s.hi)]));

describe('listing tags', () => {
  test('Non Ladder is refused first; PC, Ladder, RotW and Softcore/Hardcore are required', () => {
    expect(tagErrors(readTags(['PC', 'Non Ladder', 'Softcore', 'Reign of the Warlock']))).toEqual(['This is a Non Ladder listing. Only Ladder trades are allowed.']);
    expect(tagErrors(readTags(['PC', 'Non-Ladder']))).toHaveLength(1);
    expect(tagErrors(readTags(TAGS))).toEqual([]);
    expect(readTags(['PC', 'Ladder', 'Hardcore', 'Reign of the Warlock']).mode).toBe('hardcore');
    expect(tagErrors(readTags(['Xbox', 'Ladder', 'Softcore', 'Reign of the Warlock']))).toEqual(['This listing is for xbox, not PC.']);
    expect(tagErrors(readTags(['PC', 'Ladder', 'Softcore']))).toEqual(["Couldn't find the Reign of the Warlock tag on the listing."]);
    expect(tagErrors(readTags(['PC', 'Ladder', 'Reign of the Warlock']))).toEqual(["Couldn't tell if the listing is Softcore or Hardcore."]);
  });
});

describe('reading uniques and set items', () => {
  test('an Annihilus with its rolls read back exactly', () => {
    const rolls = vary('unique', 'Annihilus', (lo, hi) => Math.floor((lo + hi) / 2));
    const r = readListing(listing('unique', 'Annihilus', rolls));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'unique', name: 'Annihilus', rolls });
  });

  test('OCR typos (l for 1, O for 0, stray symbols) still read', () => {
    const rolls = vary('unique', "Griffon's Eye", (_lo, hi) => hi - 1);
    const lines = listing('unique', "Griffon's Eye", rolls).map((l) => l.replace(/1/g, 'l').replace(/0/g, 'O').replace(/Resistance/, 'Resistancc'));
    const r = readListing(['» ' + lines[0], ...lines.slice(1)]);
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ name: "Griffon's Eye", rolls });
  });

  test('every popular unique and set item reads back at random rolls', () => {
    const names: ['unique' | 'set', string][] = [
      ['unique', 'Harlequin Crest'], ['unique', 'Hellfire Torch'], ['unique', 'The Stone of Jordan'], ['unique', "Mara's Kaleidoscope"],
      ['unique', 'Crown of Ages'], ['unique', "Death's Fathom"], ['unique', 'Arachnid Mesh'], ['unique', 'Latent Black Cleft'],
      ['set', "Tal Rasha's Adjudication"], ['set', "Tal Rasha's Lidless Eye"], ['set', "Immortal King's Stone Crusher"],
    ];
    for (const [kind, name] of names) {
      const rolls = vary(kind, name, (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)));
      const r = readListing(listing(kind, name, rolls));
      expect(r.errors, name).toEqual([]);
      expect((r.item as { name: string }).name, name).toBe(name);
      for (const [k, v] of Object.entries(rolls)) expect((r.item as { rolls: Rolls }).rolls[k], `${name} ${k}`).toBe(v);
    }
  });

  test('Renewed charms: every affix reads back with the option it rolled and its value', () => {
    const renewed = buildableTemplates('unique').filter((t) => t.name.startsWith('Renewed '));
    expect(renewed.map((t) => t.name).sort()).toEqual(
      ['Renewed Black Cleft', 'Renewed Bone Break', 'Renewed Cold Rupture', 'Renewed Crack of the Heavens', 'Renewed Flame Rift', 'Renewed Rotting Fissure'],
    );
    for (const t of renewed)
      for (let n = 0; n < 8; n++) {
        const slots = rollSlots('unique', t.id);
        const rolls = pickRolls(slots, 'random');
        const r = readListing(listing('unique', t.name, rolls));
        expect(r.errors, t.name).toEqual([]);
        expect(r.warnings, t.name).toEqual([]);
        expect((r.item as { name: string }).name).toBe(t.name);
        expect((r.item as { rolls: Rolls }).rolls, `${t.name} ${JSON.stringify(rolls)}`).toEqual(rolls);
      }
  }, 120_000);

  test('real Renewed charm listings (Traderie shows only the five rolled affixes)', () => {
    const tail = (price: string) => ['Trading For', price, 'High Rune Value: 0.1', '2 minutes ago'];
    const cases: [string[], string, Record<string, number>][] = [
      [['1 X Monster Renewed', 'Flame Rift', 'Ladder · Reign Of The Warlock ·', 'PC · Softcore', '+15% Faster Hit Recovery', '-7% To Enemy Fire Resistance', '+44 To Mana', 'Damage Reduced By 5', '21% Extra Gold From Monsters', ...tail('1 X Mal Rune')],
        'Renewed Flame Rift', { balance1: 15, 'pierce-fire': 7, mana: 44, 'red-dmg': 5, 'gold%': 21 }],
      [['1 X Renewed Flame Rift', 'Ladder · Reign Of The Warlock ·', 'PC · Softcore', '+7% Faster Run/Walk', '-8% To Enemy Fire Resistance', '+34 To Life', 'Magic Damage Reduced By 9', '21% Better Chance Of Getting', 'Magic Items', ...tail('1 X Vex Rune')],
        'Renewed Flame Rift', { move1: 7, 'pierce-fire': 8, hp: 34, 'red-mag': 9, 'mag%': 21 }],
      [['1 X Renewed Cold', 'Rupture', 'Ladder · Reign Of The Warlock ·', 'PC · Softcore', '+19% Faster Hit Recovery', '-9% To Enemy Cold Resistance', '+28 To Life', 'Magic Damage Reduced By 10', '37% Extra Gold From Monsters', 'Trading For', '1 X Gul Rune OR', '1 X Ist Rune', 'High Rune Value: 0.25 or 0.16', '1 minute ago'],
        'Renewed Cold Rupture', { balance1: 19, 'pierce-cold': 9, hp: 28, 'red-mag': 10, 'gold%': 37 }],
      [['1 X Celtic Knot Renewed', 'Crack Of The Heavens', 'Ladder · Reign Of The Warlock ·', 'PC · Softcore', '+18% Faster Hit Recovery', '+13% To Lightning Skill Damage', '+58 To Mana', 'Magic Damage Reduced By 9', '40% Extra Gold From Monsters', ...tail('1 X Lo Rune')],
        'Renewed Crack of the Heavens', { balance1: 18, 'extra-ltng': 13, mana: 58, 'red-mag': 9, 'gold%': 40 }],
    ];
    for (const [lines, name, want] of cases) {
      const r = readListing(lines);
      expect(r.errors, name).toEqual([]);
      expect(r.warnings, name).toEqual([]);
      expect(r.tags?.mode).toBe('softcore');
      const item = r.item as { kind: string; id: number; name: string; rolls: Rolls };
      expect(item.name, lines[0]).toBe(name);
      // the options it picked, by property code, and their values
      const got: Record<string, number> = {};
      for (const s of rollSlots('unique', item.id))
        if (s.kind === 'group') {
          const c = s.choices![item.rolls[s.key]];
          got[c.prop[0]] = item.rolls[c.key] ?? c.hi;
        }
      expect(got, name).toEqual(want);
    }
  });

  test('real Latent charm listings (picture-first titles, wrapped stats, minus stats written as plus)', () => {
    const head = ['Ladder · Reign Of The Warlock ·', 'PC · Softcore'];
    const tail = (...price: string[]) => ['Trading For', ...price, 'High Rune Value: 0.3', '2 minutes ago'];
    const cases: [string[], string, string, number][] = [
      [['1 X Monster Latent Cold', 'Rupture', ...head, '300Monster Cold Immunity Is', 'Sundered', 'Cold Resist +84%', ...tail('2 X Ist Rune')], 'Latent Cold Rupture', 'res-cold', -84],
      [['1 X Latent Crack Of The', 'Heavens', ...head, '300Monster Lightning Immunity', 'Is Sundered', 'Lightning Resist +90%', ...tail('1 X Ohm Rune')], 'Latent Crack of the Heavens', 'res-ltng', -90],
      [['1 X Monster Latent Bone', 'Break', ...head, '300Monster Physical Immunity Is', 'Sundered', 'Physical Damage Received', 'Reduced By 10%', ...tail('1 X Jah Rune OR', '2 X Ber Rune OR', '2 X Lo Rune')], 'Latent Bone Break', 'red-dmg%', -10],
    ];
    for (const [lines, name, prop, value] of cases) {
      const r = readListing(lines);
      expect(r.errors, name).toEqual([]);
      expect(r.warnings, name).toEqual([]);
      expect(r.confidence, name).toBe(1); // the Sundered line counts too
      const item = r.item as { kind: string; id: number; name: string; rolls: Rolls };
      expect(item.name).toBe(name);
      const slot = rollSlots('unique', item.id).find((s) => s.prop[0] === prop)!;
      expect(item.rolls[slot.key], name).toBe(value);
    }
    expect(readListing(cases[2][0]).ask?.length).toBe(3);
  });

  test('a Renewed charm sold to a buyer: its shown rolls are minimums, and the option must match', async () => {
    const { titleWant } = await import('../src/trade/listing');
    const { wantMatches } = await import('../src/core');
    const id = idOf('unique', 'Renewed Cold Rupture');
    const slots = rollSlots('unique', id);
    const g2 = slots.find((s) => s.prop[0] === 'Gelid-Affix2')!; // magic find (0) or gold find (1)
    const rolls = { ...pickRolls(slots, 'random'), [g2.key]: 0, [`${g2.key}.0`]: 20 };
    const r = readListing(listing('unique', 'Renewed Cold Rupture', rolls));
    const want = titleWant(r.item!) as { item: Parameters<typeof wantMatches>[0] }[];
    const mk = (over: Rolls) => createTemplateItem('unique', id, { ...rolls, ...over });
    expect(wantMatches(want[0].item, mk({}))).toBe(true);
    expect(wantMatches(want[0].item, mk({ [`${g2.key}.0`]: 25 }))).toBe(true); // better magic find
    expect(wantMatches(want[0].item, mk({ [`${g2.key}.0`]: 14 }))).toBe(false); // worse
    expect(wantMatches(want[0].item, mk({ [g2.key]: 1, [`${g2.key}.1`]: 55 }))).toBe(false); // gold find instead
  });

  test('a rare ring sold to a buyer: the shown stats are minimums, quality and base must match', async () => {
    const { titleWant } = await import('../src/trade/listing');
    const { wantMatches } = await import('../src/core');
    const lines = ['1 X Ring', 'Reign Of The Warlock - Ladder - Softcore - Orange - PC - Rare', '+103 To Attack Rating', '6% Life Stolen Per Hit', '+4 To Strength', '+25 To Life', '+8ToAllResistances', '6% Better Chance Of Getting Magic Items', 'Trading For', '1 X Lo Rune', 'in 55 seconds'];
    const it = readListing(lines).item as AffixListing;
    const want = titleWant(it) as { item: Parameters<typeof wantMatches>[0] }[];
    expect(typeof want).toBe('object');
    const same = createAffixItem('rin', { quality: 'rare', affixes: it.affixes });
    expect(wantMatches(want[0].item, same)).toBe(true);
    // fewer stats, another quality or another base doesn't count
    const fewer = createAffixItem('rin', { quality: 'rare', affixes: it.affixes.slice(0, 3) });
    expect(wantMatches(want[0].item, fewer)).toBe(false);
    const magic = createAffixItem('rin', { quality: 'magic', affixes: it.affixes.slice(0, 1) });
    expect(wantMatches(want[0].item, magic)).toBe(false);
    const amulet = createAffixItem('amu', { quality: 'rare', affixes: affixRows('prefix', 'amu', 'rare').slice(0, 1).map((row) => ({ side: 'prefix' as const, row, values: [] })) });
    expect(wantMatches(want[0].item, amulet)).toBe(false);
  });

  test('key sets, the Ancients\u2019 items and a charm with the stats it has to have, as items and as prices', async () => {
    const { titleWant } = await import('../src/trade/listing');
    const { wantMatches, createAffixItem, createUberItem } = await import('../src/core');
    const tags = 'Reign Of The Warlock - Ladder - Softcore - PC';
    // a key set: three each of the three keys, per set
    const ks = readListing(['3 X 3x3 Key Set', tags, 'Trading For', '1 X Lo Rune', '1 X Mal Rune', 'High Rune Value: 1.35', '42 minutes ago']);
    expect(ks.errors).toEqual([]);
    expect(ks.item).toMatchObject({ kind: 'keyset', quantity: 3 });
    expect(askText(ks.ask ?? [])).toBe('1× Lo Rune + 1× Mal Rune');
    expect((titleWant(ks.item!) as { code: string; qty: number }[]).map((a) => `${a.code}:${a.qty}`)).toEqual(['pk1:9', 'pk2:9', 'pk3:9']);
    const asked = readListing(['1 X Mal Rune', tags, 'Trading For', '2 X 3x3 Key Set OR', '3 X Pul Rune', 'High Rune Value: 0', '2 hours ago']);
    expect(asked.errors).toEqual([]);
    expect(asked.ask?.map((o) => o.map((a) => `${a.code}:${a.qty}`).join('+'))).toEqual(['pk1:6+pk2:6+pk3:6', 'r21:3']);
    // three Random Minor Keys: any three of the keys, in any mix, and nothing else
    const { offerMatches, createUberItem: key } = await import('../src/core');
    const minor = readListing(['1 X Mal Rune', tags, 'Trading For', '3 X Random Minor Key', 'High Rune Value: 0', '2 hours ago']).ask![0];
    expect(offerMatches(minor, [key('pk1'), key('pk2'), key('pk3')])).toBe(true);
    expect(offerMatches(minor, [key('pk1'), key('pk1'), key('pk1')])).toBe(true);
    expect(offerMatches(minor, [key('pk1'), key('pk2')])).toBe(false);
    expect(offerMatches(minor, [key('pk1'), key('pk2'), key('dhn')])).toBe(false);
    // Worusk's End and Korlic's Pain are paid like any uber item
    const anc = readListing(['1 X Mal Rune', tags, 'Trading For', "1 X Worusk's End OR", "1 X Korlic's Pain", 'High Rune Value: 0 or 0', '1 minute ago']);
    expect(anc.errors).toEqual([]);
    expect(anc.ask?.map((o) => o.map((a) => `${a.code}:${a.qty}`).join('+'))).toEqual(['ua5:1', 'ua2:1']);
    expect(createUberItem('ua2').code).toBe('ua2');
    // a charm in a price: it needs the stats shown; extras on it don't matter
    const ch = readListing(['1 X Mal Rune', tags, 'Trading For', '1 X Grand Charm', '+1 To Chaos Skills (Warlock Only)', 'High Rune Value: 0', '3 hours ago']);
    expect(ch.errors).toEqual([]);
    const need = ch.ask![0][0].item!;
    expect(need).toMatchObject({ kind: 'magic', code: 'cm3' });
    const own = readListing(['1 X Grand Charm', `${tags} - Magic`, '+1 To Chaos Skills (Warlock Only)', 'Trading For', '1 X Ist Rune', 'in 5 minutes']).item as AffixListing;
    const only = createAffixItem('cm3', { quality: 'magic', affixes: own.affixes });
    expect(wantMatches(need, only)).toBe(true);
    const withExtra = createAffixItem('cm3', { quality: 'magic', affixes: [...own.affixes, ...affixRows('suffix', 'cm3').filter(() => !own.affixes.some((a) => a.side === 'suffix')).slice(0, 1).map((row) => ({ side: 'suffix' as const, row, values: [] }))] });
    expect(wantMatches(need, withExtra)).toBe(true);
    const other = createAffixItem('cm3', { quality: 'magic', affixes: affixRows('suffix', 'cm3').slice(0, 1).map((row) => ({ side: 'suffix' as const, row, values: [] })) });
    expect(wantMatches(need, other)).toBe(false);
  });

  test('the Hellfire Torch class and the Rainbow Facet variant come from the stats', () => {
    const cls = rollSlots('unique', idOf('unique', 'Hellfire Torch')).find((s) => s.kind === 'class')!;
    const torch = readListing(listing('unique', 'Hellfire Torch', { [cls.key]: 1 }));
    expect((torch.item as { rolls: Rolls }).rolls[cls.key]).toBe(1); // Sorceress
    const facet = readListing(listing('unique', 'Rainbow Facet (Lightning, Level-up)', {}));
    expect(facet.item).toMatchObject({ name: 'Rainbow Facet (Lightning, Level-up)' });
  });

  test('a roll outside the real range blocks it; an unreadable one is flagged and set to the lowest', () => {
    const lines = listing('unique', 'Annihilus', {}).map((l) => l.replace('+20 to all Attributes', '+25 to all Attributes'));
    expect(readListing(lines).errors.join(' ')).toMatch(/outside its range \(10–20\)/);
    const missing = listing('unique', 'Annihilus', {}).filter((l) => !/Experience/.test(l));
    const r = readListing(missing);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/Couldn't read .*Experience.*rolled \d+ at random \(5–10\)/);
    const exp = Object.values((r.item as { rolls: Rolls }).rolls).at(-1)!;
    expect(exp).toBeGreaterThanOrEqual(5);
    expect(exp).toBeLessThanOrEqual(10);
  });

  test('a price in the listing (a rune name) does not replace the item', () => {
    const r = readListing([...listing('unique', 'Harlequin Crest', {}), 'Asking: Ber Rune x1']);
    expect(r.item).toMatchObject({ name: 'Harlequin Crest' });
  });
});

describe('reading runes, gems, ubers and bases', () => {
  test('runes, gems and keys with quantities', () => {
    expect(readListing(['Ber Rune', 'x2', ...TAGS]).item).toMatchObject({ kind: 'rune', code: 'r30', quantity: 2 });
    expect(readListing(['Perfect Amethyst', ...TAGS]).item).toMatchObject({ kind: 'gem', name: 'Perfect Amethyst', quantity: 1 });
    expect(readListing(['Key of Terror x3', ...TAGS]).item).toMatchObject({ kind: 'uber', code: 'pk1', quantity: 3 });
  });

  test('an ethereal 4-socket Thresher and a superior 45-res Sacred Targe', () => {
    const t = readListing(['Ethereal Thresher', 'Socketed (4)', ...TAGS]);
    expect(t.errors).toEqual([]);
    expect(t.item).toMatchObject({ kind: 'base', name: 'Thresher', sockets: 4, ethereal: true });
    const code = 'pab'; // Sacred Targe
    const targe = createBaseItem(code, { sockets: 4, superior: { row: 2, values: [15] }, auto: { row: 26, values: [45] } });
    const d = describeItem(targe);
    const r = readListing([d.name, ...d.lines.map((l) => l.text), ...TAGS]);
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'base', sockets: 4, superior: { row: 2, values: [15] }, auto: { row: 26, values: [45] } });
    expect((r.item as { defense?: number }).defense).toBe(targe.defense);
  });

  test('an archon staff with class skills', () => {
    const staff = createBaseItem('6ws', { sockets: 0, skills: [{ skill: 59, level: 3 }, { skill: 64, level: 2 }] });
    const d = describeItem(staff);
    const r = readListing([d.name, ...d.lines.map((l) => l.text), ...TAGS]);
    expect((r.item as { skills: unknown[] }).skills).toEqual(expect.arrayContaining([{ skill: 59, level: 3 }, { skill: 64, level: 2 }]));
  });

  test('nothing recognisable', () => {
    expect(readListing(['hello there', ...TAGS]).errors).toContain("Couldn't recognise the item on this listing.");
  });
});

describe('real Traderie screenshots (OCR text from the app)', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const file = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'listings', f), 'utf8').split('\n');
  const read = (f: string) => readListing(file(`${f}.txt`), file(`${f}.price.txt`));

  test('Annihilus: rolls 10 / 10 / 5, tradeable, with a note that it was listed unidentified', () => {
    const r = read('annihilus');
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'unique', name: 'Annihilus', rolls: { p1: 10, p2: 10, p3: 5 } });
    expect(r.tags.mode).toBe('softcore');
    expect(r.warnings.join(' ')).toMatch(/Unidentified/);
  });

  test('Superior 3-socket Demonhead with 14% Enhanced Defense and top base defense (176 shown)', () => {
    const r = read('demonhead-superior');
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'base', code: 'usk', sockets: 3, defense: 155, superior: { row: 2, values: [14] }, ethereal: false });
    const b = r.item as Extract<ListingItem, { kind: 'base' }>;
    expect(describeItem(createBaseItem('usk', { sockets: 3, defense: b.defense, superior: b.superior })).lines.map((l) => l.text)).toContain('Defense: 176');
  });

  test('Renewed and Latent charms: wrapped titles with a picture after them, wrapped stats, minus stats shown as plus', () => {
    const cases: [string, string, Record<string, number>, string][] = [
      ['latent-cold-rupture', 'Latent Cold Rupture', { 'res-cold': -84 }, '2× Ist Rune'],
      ['latent-crack-of-the-heavens', 'Latent Crack of the Heavens', { 'res-ltng': -90 }, '1× Ohm Rune'], // "Heavens °°"
      ['latent-bone-break', 'Latent Bone Break', { 'red-dmg%': -10 }, '1× Jah Rune or 2× Ber Rune or 2× Lo Rune'], // "ReducedBy10%"
      ['renewed-cold-rupture', 'Renewed Cold Rupture', { balance1: 19, 'pierce-cold': 9, hp: 28, 'red-mag': 10, 'gold%': 37 }, '1× Gul Rune or 1× Ist Rune'], // "»" between the title's lines
      ['renewed-crack-of-the-heavens', 'Renewed Crack of the Heavens', { balance1: 18, 'extra-ltng': 13, mana: 58, 'red-mag': 9, 'gold%': 40 }, '1× Lo Rune'],
      ['renewed-flame-rift', 'Renewed Flame Rift', { move1: 7, 'pierce-fire': 8, hp: 34, 'red-mag': 9 }, '1× Vex Rune'], // "+347To Life"
    ];
    for (const [f, name, want, price] of cases) {
      const r = read(f);
      expect(r.errors, f).toEqual([]);
      const item = r.item as { id: number; name: string; rolls: Rolls };
      expect(item.name, f).toBe(name);
      const got: Record<string, number> = {};
      for (const s of rollSlots('unique', item.id)) {
        const c = s.kind === 'group' ? s.choices![item.rolls[s.key]] : s;
        if (c.variable) got[c.prop[0]] = item.rolls[c.key];
      }
      expect(got, f).toMatchObject(want);
      expect(askText(r.ask ?? []), f).toBe(price);
      // the magic find number on the Flame Rift is unreadable: the option is known from its words, the roll is random
      if (f === 'renewed-flame-rift') {
        expect(r.warnings.join(' ')).toMatch(/Couldn't read the number on .*Better Chance of Getting Magic Items.*at random \(14–25\)/);
        expect(got['mag%']).toBeGreaterThanOrEqual(14);
      } else expect(r.warnings, f).toEqual([]);
    }
  });

  test('magic items: split into the prefix and suffix they must have, with the values read', () => {
    const amu = read('amulet-magic');
    expect(amu.errors).toEqual([]);
    const name = (a: { side: 'prefix' | 'suffix'; row: number }) => GD.affixes[a.side][a.row].name;
    expect(amu.item).toMatchObject({ kind: 'magic', code: 'amu' });
    const it = amu.item as AffixListing;
    expect(it.affixes.map((a) => `${name(a)}=${a.values}`)).toEqual(['Forbidden=3', 'of the Whale=98']); // +3 Eldritch Skills, +98 Life
    const gc = read('celtic-knot-magic');
    expect(gc.errors).toEqual([]);
    expect(gc.item).toMatchObject({ kind: 'magic', code: 'cm3' }); // "+1 To Combat Skills (Barbarian Only)", not the Paladin's
    expect(describeItem(createAffixItem('cm3', { quality: 'magic', affixes: (gc.item as typeof it).affixes })).lines.map((l) => l.text)).toEqual(
      expect.arrayContaining(['+1 to Combat Skills (Barbarian Only)', '+16 to Life']),
    );
    // "+31Tolife": OCR glues "To" to the next word
    const eye = read('eye-grand-charm-magic');
    expect(eye.errors).toEqual([]);
    expect((eye.item as AffixListing).affixes.map((a) => `${GD.affixes[a.side][a.row].mods[0][0]}=${a.values}`)).toEqual(['skilltab=1', 'hp=31']);
    expect(askText(eye.ask ?? [])).toBe('1× Ohm Rune or 1× Vex Rune + 1× Mal Rune');
    expect(readListing(['1X Ring', 'Reign Of The Warlock - Ladder - PC - Softcore - Magic', '+2ToStrength', 'Trading For', '1 X Ist Rune', 'in 5 minutes']).errors).toEqual([]);
    // a whole stat run together: "+8ToAllResistances"
    const ring = readListing(['1 X Ring', 'Reign Of The Warlock - Ladder - Softcore - Orange - PC - Rare', '+103 To Attack Rating', '6% Life Stolen Per Hit', '+4 To Strength', '+25 To Life', '+8ToAllResistances', '6% Better Chance Of Getting Magic Items', 'Trading For', '1 X Lo Rune', 'in 55 seconds']);
    expect(ring.errors).toEqual([]);
    expect(ring.item).toMatchObject({ kind: 'rare', code: 'rin' });
    expect((ring.item as AffixListing).affixes).toHaveLength(6);
    // "Make an Offer" has no price to pay
    const jewel = read('jewel-magic-offer');
    expect(jewel.item).toMatchObject({ kind: 'magic', code: 'jew' });
    expect(jewel.errors).toEqual([expect.stringMatching(/asks for offers/)]);
  });

  test('crafted items are made exactly as listed: the recipe names the item, the Elite tag the base', () => {
    const lines = (it: AffixListing) => describeItem(createAffixItem(it.code, { quality: 'crafted', affixes: [], exactStats: it.exact })).lines.filter((l) => l.kind === 'mod').map((l) => l.text);
    const gloves = read('blood-gloves-crafted-nonladder');
    expect(gloves.errors).toEqual(['This is a Non Ladder listing. Only Ladder trades are allowed.']);
    expect(gloves.item).toMatchObject({ kind: 'crafted', code: 'uvg', name: 'Blood Gloves (Vampirebone Gloves)' });
    expect(lines(gloves.item as AffixListing)).toEqual([
      '+20% Increased Attack Speed', '2% Life stolen per hit', '+10% Chance of Crushing Blow', '+86% Enhanced Defense',
      '+13 to Dexterity', '+17 to Life', '19% Better Chance of Getting Magic Items',
    ]);
    // 7% life stolen is more than the recipe and a ring affix give together: made as listed anyway. The garbled
    // "+14 To —" is the life every Blood Ring has.
    const ring = read('blood-ring-crafted');
    expect(ring.errors).toEqual([]);
    expect(ring.item).toMatchObject({ kind: 'crafted', code: 'rin', name: 'Blood Ring (Ring)' });
    expect(lines(ring.item as AffixListing)).toEqual(['+120 to Attack Rating', '6% Mana stolen per hit', '7% Life stolen per hit', '+2 to Strength', '+14 to Life', '+6 Maximum Stamina']);
    expect(ring.warnings.join(' ')).toMatch(/\+14 to Life/);
    expect(askText(ring.ask ?? [])).toBe('1× Ohm Rune');
    // "+2 To Strength" is a stat, not the runeword Strength, and a stray mark before the title is fine
    const r = readListing(['@ 1X Blood Ring', 'Reign Of The Warlock - Softcore - Ladder - PC', '+2 To Strength', '+14 To Life', '3% Life Stolen Per Hit', 'Trading For', '1X Ohm Rune', 'in 14 seconds']);
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'crafted', name: 'Blood Ring (Ring)' });
  });

  test('a rare item listed with its own tooltip lines reads back to the same stats', () => {
    const row = (side: 'prefix' | 'suffix', name: string) => affixRows(side, 'rin', 'rare').find((i) => GD.affixes[side][i].name === name)!;
    const ring = createAffixItem('rin', {
      quality: 'rare',
      affixes: [
        { side: 'prefix', row: row('prefix', 'Garnet'), values: [25] },
        { side: 'prefix', row: row('prefix', 'Lapis'), values: [14] },
        { side: 'suffix', row: row('suffix', 'of the Leech'), values: [3] },
        { side: 'suffix', row: row('suffix', 'of Chance'), values: [12] },
        { side: 'suffix', row: row('suffix', 'of Shock'), values: [1, 17] }, // one line: "Adds 1-17 Lightning Damage"
      ],
    });
    const lines = describeItem(ring).lines.filter((l) => l.kind === 'mod').map((l) => l.text);
    const r = readListing(['1 X Ring', 'Reign Of The Warlock - PC - Ladder - Softcore - Rare', ...lines, 'Trading For', '1 X Ist Rune', 'in 5 minutes']);
    expect(r.errors).toEqual([]);
    const it = r.item as AffixListing;
    expect(it.kind).toBe('rare');
    const back = createAffixItem('rin', { quality: 'rare', affixes: it.affixes });
    expect(describeItem(back).lines.filter((l) => l.kind === 'mod').map((l) => l.text).sort()).toEqual([...lines].sort());
    // stats no ring can have are refused
    expect(readListing(['1 X Ring', 'Reign Of The Warlock - PC - Ladder - Softcore - Rare', '+300% Enhanced Damage', 'Trading For', '1 X Ist Rune', 'in 5 minutes']).errors[0]).toMatch(/No rare Ring can have/);
  });

  test('runewords: the runes\u2019 own bonuses and a superior base are part of the listing\u2019s numbers', () => {
    // Cure in an ethereal superior Spired Helm: 108% = 100% Cure + 8% superior; 52% Poison Resist = 22% Cure + Tal's 30%
    const r = read('cure-runeword-superior');
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'runeword', name: 'Cure', code: 'uhm', ethereal: true, rolls: { r1: 100, r2: 22 }, superior: { row: 2, values: [8] } });
    const it = r.item as Extract<ListingItem, { kind: 'runeword' }>;
    const built = createRunewordItem(it.row, it.code, it.rolls, { ethereal: true, superior: it.superior });
    const text = describeItem(built).lines.map((l) => l.text);
    expect(text).toEqual(expect.arrayContaining(['Defense: 499', '+108% Enhanced Defense', 'Poison Resist +52%']));
  });

  test('Immortal King full set, seller above the picture, posted an hour ago', () => {
    const r = read('immortal-king-fullset');
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'fullset', name: 'Immortal King (full set, 6 pieces)' });
    expect(r.age).toBe(3600);
    // the OCR keeps the listing's column even when the seller's name shares the title's row
    const w = (text: string, x0: number, y0: number) => ({ text, x0, x1: x0 + text.length * 8, y0, y1: y0 + 14 });
    expect(columnLines([w('Cycako', 80, 30), w('1', 300, 32), w('X', 312, 32), w('Immortal', 326, 32), w('King', 400, 32), w('(187)', 150, 60), w('Softcore', 300, 60)], 800)).toEqual([
      '1 X Immortal King',
      'Softcore',
    ]);
  });

  test('buyers\u2019 listings ("I Give", "Offering"): you sell them the item for their offer', () => {
    const beast = read('beast-they-give');
    expect([beast.direction, beast.errors]).toEqual(['sell', []]);
    expect(beast.want).toEqual([{ code: '', qty: 1, name: 'Beast', item: expect.objectContaining({ kind: 'runeword', code: '7wa' }) }]);
    expect(askText(beast.ask ?? [])).toBe('1× Ber Rune or 1× Zod Rune or 1× Sur Rune + 1× Lo Rune');
    // no stats shown: any Beast in a Berserker Axe
    const offering = read('beast-offering');
    expect([offering.direction, offering.errors, askText(offering.ask ?? [])]).toEqual(['sell', [], '2× Lo Rune']);
    expect((offering.want![0].item as { atLeast?: unknown[] }).atLeast).toEqual([]);
    expect(read('ber-they-give').want).toEqual([{ code: 'r30', qty: 1, name: 'Ber Rune' }]);
    expect(askText(read('ber-offering').ask ?? [])).toBe('1× Lo Rune + 1× Ohm Rune + 1× Vex Rune');
    // the rolls it shows are minimums, and it has to be ethereal; no "rolled at random" notes when selling
    const andy = read('andariel-they-give');
    expect(andy.want![0].item).toMatchObject({ kind: 'unique', ethereal: true });
    expect((andy.want![0].item as { atLeast: unknown[] }).atLeast).toHaveLength(3);
    expect(andy.warnings).toEqual([]);
    expect(read('annihilus').direction).toBe('buy');
  });

  test('runewords are read', () => {
    const death = read('death-runeword-nonladder');
    expect(death.errors).toEqual(['This is a Non Ladder listing. Only Ladder trades are allowed.']);
    expect(death.item).toMatchObject({ kind: 'runeword', name: 'Death', base: 'Berserker Axe', ethereal: true });
  });

  test('Non Ladder listings are refused, and still read correctly', () => {
    for (const f of ['trang-oul-nonladder', 'horazon-nonladder']) expect(read(f).errors[0]).toBe('This is a Non Ladder listing. Only Ladder trades are allowed.');
    expect(read('horazon-nonladder').item).toMatchObject({ kind: 'set', name: "Horazon's Countenance", rolls: { p2: 19, p3: 10 } });
    // Traderie shows the belt's total defense: +93 on top of a Troll Belt's 66
    expect(read('trang-oul-nonladder').item).toMatchObject({ rolls: { p0: 93 } });
  });
});

describe('listing age', () => {
  test('within 3 days counts; older, or no time on the card, does not', () => {
    const base = ['1 X Ber Rune', 'Reign Of The Warlock · PC · Ladder · Softcore', 'Trading For', '1 X Jah Rune'];
    expect(readListing([...base, 'in 50 seconds']).errors).toEqual([]);
    expect(readListing([...base, 'in1second']).age).toBe(1);
    expect(readListing([...base, '5s hours ago']).age).toBe(5 * 3600);
    expect(readListing([...base, '2 days ago']).errors).toEqual([]);
    expect(readListing([...base, 'in 3 days']).errors).toEqual([]);
    expect(readListing([...base, '4 days ago']).errors).toEqual(['This listing is 4 days old. Only listings from the last 3 days count.']);
    expect(readListing([...base, 'a month ago']).errors[0]).toMatch(/30 days old/);
    expect(readListing(base).errors).toEqual(["Couldn't find when the listing was posted."]);
    expect(readListing(base.concat('in 5 minutes')).item).toMatchObject({ kind: 'rune', code: 'r30', quantity: 1 });
  });

  test('older listings show the date they were posted: counted in days up to today', () => {
    const base = ['1 X Ber Rune', 'Reign Of The Warlock · PC · Ladder · Softcore', 'Trading For', '1 X Jah Rune'];
    const now = new Date(2026, 8, 30, 9, 22); // September 30, 2026
    expect(readListing([...base, 'September 26, 2026'], undefined, now).errors).toEqual(['This listing is 4 days old. Only listings from the last 3 days count.']);
    expect(readListing([...base, 'September 27, 2026'], undefined, now).errors).toEqual([]);
    expect(readListing([...base, 'Sep 28'], undefined, now).age).toBe(2 * 86400);
    expect(readListing([...base, '9/20/2026'], undefined, now).age).toBe(10 * 86400);
    expect(readListing([...base, 'Oct 2'], undefined, now).age).toBe(363 * 86400); // no year and in the future: last year's
  });
});

describe('base defense on uniques and set items', () => {
  test('items without Enhanced Defense roll their base defense; the listing total is read back', async () => {
    const { templateDefenseRange, createTemplateItem } = await import('../src/core');
    const horazon = idOf('set', "Horazon's Countenance");
    expect(templateDefenseRange('set', horazon)).toEqual({ lo: 101, hi: 154 });
    expect(templateDefenseRange('unique', idOf('unique', "Andariel's Visage"))).toBeUndefined(); // has ED: always the top
    expect(createTemplateItem('set', horazon, {}, { defense: 112 }).defense).toBe(112);
    expect(() => createTemplateItem('set', horazon, {}, { defense: 200 })).toThrow(/101–154/);
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const r = readListing(fs.readFileSync(path.join(__dirname, 'fixtures', 'listings', 'horazon-nonladder.txt'), 'utf8').split('\n'));
    expect(r.item).toMatchObject({ defense: 112 }); // "112Defense" on the card
  });
});

describe('full sets listed as one item', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  test('"1 X Angelic Raiment" (real screenshot) is all four pieces', () => {
    const r = readListing(fs.readFileSync(path.join(__dirname, 'fixtures', 'listings', 'angelic-raiment-fullset.txt'), 'utf8').split('\n'));
    expect(r.errors).toEqual([]);
    expect(r.item).toMatchObject({ kind: 'fullset', name: 'Angelic Raiment (full set, 4 pieces)' });
    expect((r.item as { pieces: { name: string }[] }).pieces.map((p) => p.name)).toEqual(['Angelic Sickle', 'Angelic Mantle', 'Angelic Halo', 'Angelic Wings']);
  });

  test('a full set with no stats shown gets random rolls, with one warning', () => {
    const r = readListing(['1 X Tal Rasha\'s Wrappings', 'Reign Of The Warlock · PC · Ladder · Softcore', 'Trading For', '1 X Ber Rune', 'in 2 hours']);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['The listing shows no stats: every roll is random.']);
    const pieces = (r.item as { pieces: { name: string; rolls: Rolls }[] }).pieces;
    expect(pieces).toHaveLength(5);
    const eye = pieces.find((p) => p.name === "Tal Rasha's Lidless Eye")!;
    for (const v of Object.values(eye.rolls)) expect([1, 2]).toContain(v); // the three masteries: +1 or +2
  });
});

describe('the price: what the listing is trading for', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const file = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'listings', f), 'utf8').split('\n');
  test('every real screenshot reads its asking price', () => {
    const want: Record<string, string> = {
      'demonhead-superior': '1× Ist Rune', // read as "ox 15 Rune" in the first pass, "1XIstRune" in the price pass
      'celtic-knot-magic': '1× Lem Rune',
      'amulet-magic': '1× Ist Rune',
      'cure-runeword-superior': '1× Ber Rune',
      'immortal-king-fullset': '1× Ist Rune',
      'call-to-arms-runeword': '1× Ber Rune + 1× Ohm Rune',
      'blood-gloves-crafted-nonladder': '9× Jah Rune',
      annihilus: '1× Ist Rune',
      'trang-oul-nonladder': '1× Ist Rune',
      'horazon-nonladder': '1× Ist Rune',
      'death-runeword-nonladder': '1× Lo Rune or 1× Ohm Rune',
      'angelic-raiment-fullset': '1× Lem Rune',
    };
    for (const [f, text] of Object.entries(want)) expect(askText(readListing(file(`${f}.txt`), file(`${f}.price.txt`)).ask ?? []), f).toBe(text);
    // the first pass alone still gets most of them, with digits read as letters ("15 Rune" = "Ist Rune")
    expect(askText(readAsk(['ox 15 Rune']).options)).toBe('');
    expect(askText(readAsk(['1X 15 Rune']).options)).toBe('1× Ist Rune');
    expect(askText(readAsk(['{& 9X)ah Rune']).options)).toBe('9× Jah Rune');
  });

  test('"… 2 more": the option it belongs to is left out, since part of it is hidden', () => {
    const r = readAsk(['1 X Ist Rune OR', '1 X Mal Rune', '1 X Lem Rune OR', '1 X Lem Rune', '1 X Um Rune', '... 2 more']);
    expect(askText(r.options)).toBe('1× Ist Rune or 1× Mal Rune + 1× Lem Rune');
    expect(r.skipped[0]).toMatch(/Left out the "1 X Lem Rune \+ 1 X Um Rune \+ … 2 more not shown" option: the rest of it isn't shown/);
  });

  test('several things together, OR, offers and payments that aren\u2019t runes', () => {
    expect(askText(readAsk(['2 X Ber Rune', '1 X Jah Rune']).options)).toBe('2× Ber Rune + 1× Jah Rune');
    expect(askText(readAsk(['1 X Lo Rune OR', '1 X Ohm Rune', '3 X Perfect Amethyst']).options)).toBe('1× Lo Rune or 1× Ohm Rune + 3× Perfect Amethyst');
    expect(askText(readAsk(['1 X Key of Terror']).options)).toBe('1× Key of Terror');
    expect(readAsk(['Make an Offer']).problems[0]).toMatch(/asks for offers/);
    // items by name can be paid with too: any Annihilus, one of each Immortal King piece
    expect(readAsk(['1 X Annihilus']).options).toEqual([[{ code: '', qty: 1, name: 'Annihilus', item: { kind: 'unique', id: expect.any(Number) } }]]);
    expect(readAsk(['1 X Immortal King']).options[0]).toHaveLength(6);
    expect(readAsk(['1 X Grand Bargain']).problems[0]).toMatch(/doesn't know that item/);
    // an option that can't be paid is left out when another one can: pay the Pul
    const pul = readAsk(['1 X Pul Rune OR', '1 X Random Minor Key']);
    const bad = readAsk(['1 X Pul Rune OR', '1 X Mystery Thing']);
    expect([askText(bad.options), bad.problems]).toEqual(['1× Pul Rune', []]);
    expect(bad.skipped).toEqual(['Left out the "1 X Mystery Thing" option: the app doesn\'t know that item.']);
    // a Random Minor Key is any one of the Terror, Hate and Destruction keys
    expect(pul.options).toEqual([[{ code: 'r21', qty: 1, name: 'Pul Rune' }], [{ code: '', qty: 1, name: 'Random Minor Key', anyOf: ['pk1', 'pk2', 'pk3'] }]]);
    const r2 = readListing(['1 X Eye Grand Charm', 'Reign Of The Warlock - Ladder - PC - Softcore', '+1 To Elemental Skills (Druid Only)', 'Trading For', '1 X Pul Rune OR', '1 X Random Minor Key', '1 minute ago']);
    expect(r2.errors).toEqual([]);
    expect(askText(r2.ask ?? [])).toBe('1× Pul Rune or 1× Random Minor Key');
    expect(r2.warnings).toEqual([]);
    const r = readListing(['1 X Ber Rune', 'Reign Of The Warlock · PC · Ladder · Softcore', 'Trading For', 'Make an Offer', 'in 2 minutes']);
    expect(r.errors[0]).toMatch(/asks for offers/);
  });
});

describe('free listings', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const file = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'listings', f), 'utf8').split('\n');
  const read = (f: string) => readListing(file(`${f}.txt`), file(`${f}.price.txt`));

  test.each(['free-wizendraw', 'free-renewed-flame-rift', 'free-paper-large-charm'])('%s: "Free" is a price of nothing, with no error about the price', (f) => {
    const r = read(f);
    expect(r.ask).toEqual([[]]);
    expect(r.direction).toBe('buy');
    expect(r.errors.filter((e) => /trading for|offering/i.test(e))).toEqual([]);
    expect(askText(r.ask!)).toBe('Free');
  });

  test('"4 hours ag" (a clipped "ago") still gives the posted time, and the Renewed charm reads without a posted-time error', () => {
    const r = read('free-renewed-flame-rift');
    expect(r.age).toBe(4 * 3600);
    expect(r.errors.filter((e) => /posted/i.test(e))).toEqual([]);
  });

  test('the Free line is not read as part of the item', () => {
    const r = read('free-wizendraw');
    expect(r.item && 'id' in r.item ? GD.uniques[r.item.id]?.name ?? '' : '').toMatch(/wizendraw/i);
  });
});


describe('posted time clipped by OCR', () => {
  test.each(['14 hours ago', '14 hours ag', '14 hours a', '14 hours', '1 hour ag'])('"%s" reads', (t) => {
    expect(readAge([t])).toBe(Number(t.split(' ')[0]) * 3600);
  });
});
