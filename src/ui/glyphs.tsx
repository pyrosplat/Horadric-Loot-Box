import { GD, type D2Item } from '../core';

export type Glyph =
  | 'sword' | 'axe' | 'mace' | 'polearm' | 'bow' | 'staff' | 'wand' | 'dagger' | 'throw' | 'claw' | 'orb'
  | 'helm' | 'armor' | 'shield' | 'gloves' | 'boots' | 'belt' | 'ring' | 'amulet' | 'charm' | 'jewel'
  | 'rune' | 'gem' | 'potion' | 'scroll' | 'book' | 'key' | 'quest' | 'gold' | 'grimoire' | 'misc';

export function glyphFor(item: D2Item): Glyph {
  const def = item.def;
  if (!def) return 'misc';
  const t = new Set([...(GD.types[def.type]?.all ?? []), ...(def.type2 ? GD.types[def.type2]?.all ?? [] : [])]);
  const has = (c: string) => t.has(c);
  if (has('grim')) return 'grimoire';
  if (has('rune')) return 'rune';
  if (has('gem')) return 'gem';
  if (has('jewl')) return 'jewel';
  if (has('char')) return 'charm';
  if (has('ring')) return 'ring';
  if (has('amul')) return 'amulet';
  if (has('gold')) return 'gold';
  if (has('poti')) return 'potion';
  if (has('scro')) return 'scroll';
  if (has('book')) return 'book';
  if (has('key')) return 'key';
  if (has('orb')) return 'orb';
  if (has('h2h')) return 'claw';
  if (has('bow') || has('xbow')) return 'bow';
  if (has('staf')) return 'staff';
  if (has('wand')) return 'wand';
  if (has('knif')) return 'dagger';
  if (has('thro')) return 'throw';
  if (has('axe')) return 'axe';
  if (has('blun') || has('mace') || has('club') || has('hamm') || has('scep')) return 'mace';
  if (has('pole') || has('spea')) return 'polearm';
  if (has('weap')) return 'sword';
  if (has('helm') || has('circ') || has('phlm') || has('pelt')) return 'helm';
  if (has('shld')) return 'shield';
  if (has('glov')) return 'gloves';
  if (has('boot')) return 'boots';
  if (has('belt')) return 'belt';
  if (has('tors')) return 'armor';
  if (def.quest || has('ques')) return 'quest';
  return 'misc';
}

// 24x24 stroke icons
const PATHS: Record<Glyph, string> = {
  sword: 'M5 19l3-3m0 0l9-9 2-4-4 2-9 9m2 2l-3-3m-1 5l-2-2',
  axe: 'M7 21L17 6m-3-3c3 0 6 2 6 6-2 0-4-1-5-2m-4-1c-2-1-3-3-3-5',
  mace: 'M6 20l7-7m1-7a3.5 3.5 0 110 7 3.5 3.5 0 010-7zm0-3v2m5 3h-2m-1.5 5.5l1.5 1.5',
  polearm: 'M4 20L18 6m0 0l2-4-4 2m2 2l-4 1 3-5',
  bow: 'M6 3c8 3 12 9 12 18M6 3c-1 6 2 13 12 18M6 3l12 18',
  staff: 'M8 21L16 5m0 0a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  wand: 'M5 19L15 9m1-6l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  dagger: 'M7 17l8-8 3-3-1 4-8 8m-2-1l-3 3m1-5l4 4',
  throw: 'M4 20l16-16m0 0v5m0-5h-5',
  claw: 'M6 20V9m4 11V6m4 14V6m4 14V9M5 9h14',
  orb: 'M12 4a6 6 0 110 12 6 6 0 010-12zm-3 16h6m-3-4v4',
  helm: 'M5 15a7 7 0 0114 0v3H5v-3zm7-8V4m-4 14v2m8-2v2',
  armor: 'M8 3l4 2 4-2 4 3-2 4v10H6V10L4 6l4-3z',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z',
  gloves: 'M8 21v-6l-3-4 1-1 3 2V5a1 1 0 012 0v5-6a1 1 0 012 0v6-5a1 1 0 012 0v6-3a1 1 0 012 0v8l-2 5H8z',
  boots: 'M8 3h5v10l6 3v5H6V3h2z',
  belt: 'M3 10h18v4H3zm8-1h3v6h-3z',
  ring: 'M12 8a6 6 0 110 12 6 6 0 010-12zm0-5l2 3h-4l2-3z',
  amulet: 'M6 3c0 6 3 9 6 11 3-2 6-5 6-11m-6 11v2m0 0a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
  charm: 'M12 4c4 0 6 3 6 7s-3 9-6 9-6-5-6-9 2-7 6-7zm0 4v6m-2-3h4',
  jewel: 'M12 3l6 6-6 12-6-12 6-6zM6 9h12',
  rune: 'M7 3h10v18H7zM12 7v10m-3-7l3 3 3-3',
  gem: 'M7 4h10l4 5-9 11L3 9l4-5zm-4 5h18',
  potion: 'M10 3h4v4l3 4v8a2 2 0 01-2 2H9a2 2 0 01-2-2v-8l3-4V3z',
  scroll: 'M7 4h11v14a2 2 0 01-2 2H6a2 2 0 010-4h10M7 4a2 2 0 00-2 2v10',
  book: 'M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3V4zm0 13a3 3 0 013-3h10',
  grimoire: 'M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2V4zm6 4l1.5 3 3 .5-2.2 2 .6 3-2.9-1.5-2.9 1.5.6-3-2.2-2 3-.5L11 8z',
  key: 'M8 15a4 4 0 110-8 4 4 0 010 8zm3-4h10m-3 0v3m-3-3v2',
  quest: 'M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5L12 3z',
  gold: 'M4 15c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3zm0 0v3c0 2 4 3 8 3s8-1 8-3v-3M8 8c0-2 2-3 4-3s4 1 4 3-2 3-4 3-4-1-4-3z',
  misc: 'M12 4l8 8-8 8-8-8 8-8z',
};

export function GlyphIcon({ glyph, className = '' }: { glyph: Glyph; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[glyph]} />
    </svg>
  );
}
