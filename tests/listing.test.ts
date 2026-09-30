import { describe, expect, test } from 'vitest';
import { buildableTemplates, createBaseItem, createTemplateItem, describeItem, rollSlots, type Rolls } from '../src/core';
import { askText, readAsk, readListing, readTags, tagErrors } from '../src/trade/listing';

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
    expect(r.item).toMatchObject({ kind: 'base', code: 'usk', sockets: 3, defense: 154, superior: { row: 2, values: [14] }, ethereal: false });
  });

  test('magic items and runewords are named as not supported yet', () => {
    expect(read('celtic-knot-magic').errors.join(' ')).toMatch(/magic or rare item/);
    expect(read('death-runeword-nonladder').errors).toEqual(['This is a Non Ladder listing. Only Ladder trades are allowed.', "Death is a runeword. Runewords can't be traded yet."]);
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
    expect(readListing([...base, '2 days ago']).errors).toEqual([]);
    expect(readListing([...base, 'in 3 days']).errors).toEqual([]);
    expect(readListing([...base, '4 days ago']).errors).toEqual(['This listing is 4 days old. Only listings from the last 3 days count.']);
    expect(readListing([...base, 'a month ago']).errors[0]).toMatch(/30 days old/);
    expect(readListing(base).errors).toEqual(["Couldn't find when the listing was posted."]);
    expect(readListing(base.concat('in 5 minutes')).item).toMatchObject({ kind: 'rune', code: 'r30', quantity: 1 });
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
  });

  test('several things together, OR, offers and payments that aren\u2019t runes', () => {
    expect(askText(readAsk(['2 X Ber Rune', '1 X Jah Rune']).options)).toBe('2× Ber Rune + 1× Jah Rune');
    expect(askText(readAsk(['1 X Lo Rune OR', '1 X Ohm Rune', '3 X Perfect Amethyst']).options)).toBe('1× Lo Rune or 1× Ohm Rune + 3× Perfect Amethyst');
    expect(askText(readAsk(['1 X Key of Terror']).options)).toBe('1× Key of Terror');
    expect(readAsk(['Make an Offer']).problems[0]).toMatch(/asks for offers/);
    expect(readAsk(['1 X Annihilus']).problems[0]).toMatch(/Only runes, gems, keys and parts/);
    const r = readListing(['1 X Ber Rune', 'Reign Of The Warlock · PC · Ladder · Softcore', 'Trading For', 'Make an Offer', 'in 2 minutes']);
    expect(r.errors[0]).toMatch(/asks for offers/);
  });
});
