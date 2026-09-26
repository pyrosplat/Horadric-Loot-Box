import { BitReader, concatBytes, setU16, u16, u32 } from './bits';
import { itemBytes, readItemList, type D2Item } from './item';

export enum StashTabType {
  Normal = 0,
  Advanced = 1,
  Chronicle = 2,
}

export interface D2StashTab {
  /** 64-byte tab header (size field is recomputed on write). */
  header: Uint8Array;
  stashFormat: number;
  version: number;
  gold: number;
  season: number;
  type: StashTabType;
  items: D2Item[];
  /** For chronicle tabs: the raw body. For item tabs: any bytes after the item list inside the tab. */
  rawBody: Uint8Array;
}

export interface D2SharedStash {
  kind: 'stash';
  fileName?: string;
  hardcore: boolean;
  /** RotW "Modern" stash (ModernSharedStash*.d2i) */
  modern: boolean;
  tabs: D2StashTab[];
  trailing: Uint8Array;
}

export function isStashFile(data: Uint8Array): boolean {
  return data.length >= 64 && u32(data, 0) === 0xaa55aa55 && u32(data, 4) < 16 && u32(data, 8) >= 97;
}

export function parseStash(data: Uint8Array, fileName?: string): D2SharedStash {
  const tabs: D2StashTab[] = [];
  let off = 0;
  while (data.length - off >= 64 && u32(data, off) === 0xaa55aa55) {
    const header = data.slice(off, off + 64);
    const stashFormat = u32(header, 4);
    const version = u32(header, 8);
    const size = u16(header, 16);
    if (size < 64 || off + size > data.length) throw new Error(`Stash tab ${tabs.length + 1} has invalid size ${size}`);
    if (version < 97) throw new Error(`Stash tab version ${version} is not a D2R stash`);
    const type = (stashFormat < 2 ? 0 : header[20]) as StashTabType;
    const bodyStart = off + 64;
    const bodyEnd = off + size;
    let items: D2Item[] = [];
    let rawBody: Uint8Array;
    if (type === StashTabType.Chronicle) {
      rawBody = data.slice(bodyStart, bodyEnd);
    } else {
      if (u16(data, bodyStart) !== 0x4d4a) throw new Error(`Stash tab ${tabs.length + 1}: items header missing`);
      const r = new BitReader(data, bodyStart + 4);
      items = readItemList(r, u16(data, bodyStart + 2), version);
      if (r.bytePos > bodyEnd) throw new Error(`Stash tab ${tabs.length + 1}: items overflow tab`);
      rawBody = data.slice(r.bytePos, bodyEnd);
    }
    tabs.push({ header, stashFormat, version, gold: u32(header, 12), season: u16(header, 18), type, items, rawBody });
    off = bodyEnd;
  }
  if (tabs.length === 0) throw new Error('Not a shared stash file');
  const lower = (fileName ?? '').toLowerCase();
  return {
    kind: 'stash',
    fileName,
    hardcore: lower.includes('hardcore'),
    modern: lower.startsWith('modern') || tabs.some((t) => t.type !== StashTabType.Normal),
    tabs,
    trailing: data.slice(off),
  };
}

export function serializeStash(stash: D2SharedStash): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const tab of stash.tabs) {
    let body: Uint8Array;
    if (tab.type === StashTabType.Chronicle) {
      body = tab.rawBody;
    } else {
      const head = new Uint8Array(4);
      setU16(head, 0, 0x4d4a);
      setU16(head, 2, tab.items.length);
      body = concatBytes([head, ...tab.items.map(itemBytes), tab.rawBody]);
    }
    const header = tab.header.slice();
    const size = 64 + body.length;
    if (size > 0xffff) throw new Error('Stash tab too large');
    setU16(header, 16, size);
    parts.push(header, body);
  }
  parts.push(stash.trailing);
  return concatBytes(parts);
}
