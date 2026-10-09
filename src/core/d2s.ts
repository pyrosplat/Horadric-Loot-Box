import { BitReader, concatBytes, setU16, setU32, u16, u32 } from './bits';
import { CLASS_NAMES, statDef } from './gamedata';
import { itemBytes, readItem, readItemList, type D2Item } from './item';

export const SAVE_MAGIC = 0xaa55aa55;

export interface D2Character {
  kind: 'character';
  version: number;
  fileName?: string;
  name: string;
  classId: number;
  className: string;
  level: number;
  hardcore: boolean;
  dead: boolean;
  ladder: boolean;
  expansion: boolean;
  /** 1 classic, 2 LoD, 3 Reign of the Warlock (v104+) */
  gameVersion: number;
  stats: Record<string, number>;
  /** The stats section as stored (in order), so it can be rewritten when gold changes. */
  statList: { id: number; param: number; value: number }[];
  /** Byte offsets of the 'gf' stats marker and of the 'if' skills marker that follows the stats. */
  statsAt: { start: number; end: number };
  /** Player items (inventory, stash, cube, belt, equipped). Editable. */
  items: D2Item[];
  /** Read-only sections parsed from the tail for display. */
  corpseItems: D2Item[];
  mercItems: D2Item[];
  golemItem?: D2Item;
  hasMerc: boolean;
  /** The mercenary as stored in the header (type is the hireling.txt Id; see core/merc.ts). */
  merc?: { type: number; nameId: number; exp: number; dead: boolean };
  /** Per difficulty (Normal, Nightmare, Hell): whether Prison of Ice is done and its reward given (+10 to all resistances each). */
  anyaScrolls?: [boolean, boolean, boolean];
  /** Bytes before the player item list (header, quests, waypoints, stats, skills). */
  head: Uint8Array;
  /** Bytes after the player item list (corpse, merc, golem, demon, trailing data). */
  tail: Uint8Array;
  /**
   * When the mercenary's items could be read: the tail split around them, so the merc can be re-equipped.
   * `pre` ends with the merc 'JM' marker; the item count and items go between `pre` and `post`.
   */
  mercSplit?: { pre: Uint8Array; post: Uint8Array };
  /** Non-fatal issues found while parsing optional sections. */
  warnings: string[];
}

function readFixedString(data: Uint8Array, off: number, len: number): string {
  let end = off;
  while (end < off + len && data[end] !== 0) end++;
  return new TextDecoder().decode(data.subarray(off, end));
}

export function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const b = i >= 12 && i < 16 ? 0 : data[i];
    sum = (((sum << 1) | (sum >>> 31)) + b) >>> 0;
  }
  return sum;
}

export function isCharacterFile(data: Uint8Array): boolean {
  return data.length > 16 && u32(data, 0) === SAVE_MAGIC;
}

export function parseCharacter(data: Uint8Array, fileName?: string): D2Character {
  if (!isCharacterFile(data)) throw new Error('Not a Diablo II character file (bad magic)');
  const version = u32(data, 4);
  if (version < 97) throw new Error(`Save version ${version} is from classic Diablo II; only D2R saves (v97+) are supported`);
  if (version > 105) throw new Error(`Save version ${version} is newer than this tool understands (max 105)`);
  const newHeader = version >= 104;

  // Character section starts at 16.
  const c = 16;
  const nameOffsetOld = c + 4;
  const flagsOff = newHeader ? c + 4 : c + 20;
  const flags = u32(data, flagsOff);
  const classId = data[flagsOff + 4];
  const numSkills = data[flagsOff + 6];
  const level = data[flagsOff + 7];
  const charSize = newHeader ? 387 : 319;
  // Preview data is the last 228 (v104+) / 144 bytes of the character section.
  const previewOff = c + charSize - (newHeader ? 228 : 144);
  const mercOff = previewOff - 16;
  const mercSeed = u32(data, mercOff + 4);
  const mercName = u16(data, mercOff + 8);
  const mercExp = u32(data, mercOff + 12);
  const hasMerc = mercSeed !== 0 || mercName !== 0 || mercExp !== 0;
  const merc = hasMerc ? { type: u16(data, mercOff + 10), nameId: mercName, exp: mercExp, dead: u16(data, mercOff + 2) !== 0 } : undefined;
  let name: string;
  let gameVersion: number;
  if (newHeader) {
    gameVersion = data[previewOff + 73];
    name = readFixedString(data, previewOff + 124, 96);
  } else {
    name = readFixedString(data, nameOffsetOld, 16) || readFixedString(data, previewOff + 76, 60);
    gameVersion = flags & 0x20 ? 2 : 1;
  }
  const expansion = newHeader ? gameVersion > 1 : (flags & 0x20) !== 0;

  // Quests (298) + waypoints (80) + player intro (52)
  let off = c + charSize + 298 + 80 + 52;
  if (u16(data, off) !== 0x6667) throw new Error(`Stats section ('gf') not found at ${off}`);
  const r = new BitReader(data, off + 2);
  const stats: Record<string, number> = {};
  const statList: D2Character['statList'] = [];
  const statsStart = off;
  for (;;) {
    const id = r.readBits(9);
    if (id === 0x1ff) break;
    const def = statDef(id);
    const param = def.csvParam ? r.readBits(def.csvParam) : 0;
    const v = def.csvBits < 32 && def.csvSigned ? r.readSignedBits(def.csvBits) : r.readBits(def.csvBits);
    stats[def.key] = v;
    statList.push({ id, param, value: v });
  }
  r.alignToByte();
  off = r.bytePos;
  const statsEnd = off;
  if (u16(data, off) !== 0x6669) throw new Error(`Skills section ('if') not found at ${off}`);
  off += 2 + numSkills;
  if (u16(data, off) !== 0x4d4a) throw new Error(`Items section ('JM') not found at ${off}`);
  const itemsStart = off;
  const count = u16(data, off + 2);
  const ir = new BitReader(data, off + 4);
  const items = readItemList(ir, count, version);
  const itemsEnd = ir.bytePos;

  // quest section: 'Woo!' + 6 bytes, then 96 bytes per difficulty; Prison of Ice is word 37, bit 0 = completed with the reward (Anya's scroll) given
  const questWord = (d: number) => u16(data, c + charSize + 10 + d * 96 + 37 * 2);
  const anyaScrolls: [boolean, boolean, boolean] = [0, 1, 2].map((d) => (questWord(d) & 1) !== 0) as [boolean, boolean, boolean];

  const ch: D2Character = {
    kind: 'character',
    anyaScrolls,
    version,
    fileName,
    name,
    classId,
    className: CLASS_NAMES[classId] ?? `Class ${classId}`,
    level,
    hardcore: (flags & 0x04) !== 0,
    dead: (flags & 0x08) !== 0,
    ladder: (flags & 0x40) !== 0,
    expansion,
    gameVersion,
    stats,
    statList,
    statsAt: { start: statsStart, end: statsEnd },
    items,
    corpseItems: [],
    mercItems: [],
    hasMerc,
    merc,
    head: data.slice(0, itemsStart),
    tail: data.slice(itemsEnd),
    warnings: [],
  };
  if (u32(data, 8) !== data.length) ch.warnings.push(`Header file size ${u32(data, 8)} != actual ${data.length}`);
  if (u32(data, 12) !== checksum(data)) ch.warnings.push('Checksum mismatch in original file');

  // Tail sections are parsed for display only; they are always written back byte-for-byte.
  try {
    const t = new BitReader(data, itemsEnd);
    if (t.readU16() !== 0x4d4a) throw new Error('corpse header missing');
    const corpses = t.readU16();
    for (let i = 0; i < corpses; i++) {
      t.readU32();
      t.readU32();
      t.readU32();
      if (t.readU16() !== 0x4d4a) throw new Error('corpse items header missing');
      ch.corpseItems.push(...readItemList(t, t.readU16(), version));
    }
    if (expansion) {
      if (t.readU16() !== 0x666a) throw new Error("merc section ('jf') missing");
      if (hasMerc) {
        if (t.readU16() !== 0x4d4a) throw new Error('merc items header missing');
        const countAt = t.bytePos;
        ch.mercItems = readItemList(t, t.readU16(), version);
        ch.mercSplit = { pre: data.slice(itemsEnd, countAt), post: data.slice(t.bytePos) };
      }
      if (t.readU16() !== 0x666b) throw new Error("golem section ('kf') missing");
      if (t.readU8()) ch.golemItem = readItem(t, version);
    }
  } catch (e) {
    ch.warnings.push(`Could not read corpse/mercenary sections: ${(e as Error).message}`);
  }
  return ch;
}

/** The bytes after the player items, with the mercenary's current items written in when they are editable. */
export function characterTail(ch: D2Character): Uint8Array {
  if (!ch.mercSplit) return ch.tail;
  const n = new Uint8Array(2);
  setU16(n, 0, ch.mercItems.length);
  return concatBytes([ch.mercSplit.pre, n, ...ch.mercItems.map(itemBytes), ch.mercSplit.post]);
}

/** Rebuilds the character file with the current item list, fixing size and checksum. */
export function serializeCharacter(ch: D2Character): Uint8Array {
  const count = new Uint8Array(4);
  setU16(count, 0, 0x4d4a);
  setU16(count, 2, ch.items.length);
  const out = concatBytes([ch.head, count, ...ch.items.map(itemBytes), characterTail(ch)]);
  setU32(out, 8, out.length);
  setU32(out, 12, 0);
  setU32(out, 12, checksum(out));
  return out;
}
