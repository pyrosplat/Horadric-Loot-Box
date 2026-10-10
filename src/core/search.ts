/** What people type for a stat, and how the item text says it. */
const ALIASES: [string[], string[]][] = [
  [['magic find', 'mf'], ['better chance of getting magic']],
  [['gold find', 'gf', 'gold'], ['extra gold from monsters']],
  [['fcr', 'cast rate', 'faster cast'], ['faster cast rate']],
  [['fhr', 'hit recovery'], ['faster hit recovery']],
  [['fbr', 'block rate'], ['faster block rate']],
  [['frw', 'run walk', 'run/walk'], ['faster run/walk']],
  [['ias', 'attack speed'], ['increased attack speed']],
  [['life leech', 'll'], ['life stolen per hit']],
  [['mana leech', 'ml'], ['mana stolen per hit']],
  [['crushing blow', 'cb'], ['crushing blow']],
  [['deadly strike', 'ds'], ['deadly strike']],
  [['open wounds', 'ow'], ['open wounds']],
  [['all skills'], ['to all skills']],
  [['all res', 'all resist', 'all resistances'], ['all resistances']],
  [['res', 'resist', 'resists', 'resistance'], ['resist']],
  [['ed', 'enhanced damage'], ['enhanced damage']],
  [['ar', 'attack rating'], ['attack rating']],
  [['pdr', 'physical damage reduced'], ['damage reduced by']],
  [['mdr', 'magic damage reduced'], ['magic damage reduced']],
  [['ctc', 'chance to cast'], ['chance to cast']],
  [['replenish', 'repl life', 'replenish life'], ['replenish life']],
  [['light radius', 'lr'], ['light radius']],
  [['pierce', 'piercing'], ['piercing attack']],
];

/**
 * A matcher for the vault's search box: every word (or alias like "magic find", "fcr", "ll") has to be in the item's text. Aliases
 * stand for how the game words the stat, so "magic find" finds "% Better Chance of Getting Magic Items".
 */
export function searchMatcher(query: string): ((text: string) => boolean) | undefined {
  let rest = ` ${query.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  if (!rest.trim()) return undefined;
  const terms: string[][] = [];
  // longest aliases first, so "all res" is taken before "res"
  const keys = ALIASES.flatMap(([ks, ts]) => ks.map((k) => [k, ts] as const)).sort((a, b) => b[0].length - a[0].length);
  for (const [k, ts] of keys) {
    const at = rest.indexOf(` ${k} `);
    if (at < 0) continue;
    terms.push(ts);
    rest = rest.slice(0, at) + ' ' + rest.slice(at + k.length + 1);
  }
  for (const w of rest.split(' ').filter(Boolean)) terms.push([w]);
  return (text) => terms.every((alts) => alts.some((a) => text.includes(a)));
}
