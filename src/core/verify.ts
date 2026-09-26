import { parseCharacter, serializeCharacter, type D2Character } from './d2s';
import { parseStash, serializeStash, type D2SharedStash } from './d2i';
import { itemBytes, type D2Item } from './item';

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function compareLists(label: string, expected: D2Item[], actual: D2Item[]) {
  if (expected.length !== actual.length) throw new Error(`${label}: expected ${expected.length} items, re-read ${actual.length}`);
  expected.forEach((e, i) => {
    if (!sameBytes(itemBytes(e), itemBytes(actual[i]))) throw new Error(`${label}: item ${i} (${e.code}) changed during write`);
  });
}

/**
 * Serializes a document and proves the result is readable: the output is parsed again and every item must come
 * back bit-for-bit identical, with the untouched sections unchanged. Throws instead of returning a bad file.
 */
export function serializeVerified(doc: D2Character | D2SharedStash): Uint8Array {
  if (doc.kind === 'character') {
    const bytes = serializeCharacter(doc);
    const again = parseCharacter(bytes, doc.fileName);
    compareLists('Character items', doc.items, again.items);
    if (doc.mercSplit) {
      compareLists('Mercenary items', doc.mercItems, again.mercItems);
      if (!again.mercSplit || !sameBytes(again.mercSplit.pre, doc.mercSplit.pre) || !sameBytes(again.mercSplit.post, doc.mercSplit.post))
        throw new Error('Mercenary/corpse section changed during write');
    } else if (!sameBytes(again.tail, doc.tail)) throw new Error('Mercenary/corpse section changed during write');
    if (!sameBytes(again.head.subarray(16), doc.head.subarray(16))) throw new Error('Character header changed during write');
    if ((again.stats.gold ?? 0) !== (doc.stats.gold ?? 0) || (again.stats.goldbank ?? 0) !== (doc.stats.goldbank ?? 0)) throw new Error('Gold changed during write');
    if (again.warnings.some((w) => w.startsWith('Checksum') || w.startsWith('Header file size')))
      throw new Error('Checksum or size mismatch after write');
    return bytes;
  }
  const bytes = serializeStash(doc);
  const again = parseStash(bytes, doc.fileName);
  if (again.tabs.length !== doc.tabs.length) throw new Error('Stash tab count changed during write');
  doc.tabs.forEach((t, i) => {
    compareLists(`Stash tab ${i + 1}`, t.items, again.tabs[i].items);
    if (again.tabs[i].gold !== t.gold) throw new Error(`Stash tab ${i + 1} gold changed during write`);
    if (!sameBytes(t.rawBody, again.tabs[i].rawBody)) throw new Error(`Stash tab ${i + 1} body changed during write`);
  });
  return bytes;
}
