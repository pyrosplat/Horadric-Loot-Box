/**
 * Bit-level I/O. Diablo II stores bit fields LSB-first within each byte.
 */
export class BitReader {
  bitPos = 0;
  constructor(readonly data: Uint8Array, byteOffset = 0) {
    this.bitPos = byteOffset * 8;
  }

  get bytePos(): number {
    return this.bitPos >>> 3;
  }

  get bitsRemaining(): number {
    return this.data.length * 8 - this.bitPos;
  }

  readBits(count: number): number {
    if (count === 0) return 0;
    if (count > 32) throw new RangeError('readBits: count > 32');
    let result = 0;
    let read = 0;
    while (read < count) {
      const byteIndex = this.bitPos >>> 3;
      if (byteIndex >= this.data.length) throw new RangeError(`Read past end of data (bit ${this.bitPos})`);
      const bitOffset = this.bitPos & 7;
      const take = Math.min(8 - bitOffset, count - read);
      const bits = (this.data[byteIndex] >>> bitOffset) & ((1 << take) - 1);
      result += bits * 2 ** read; // avoid sign issues for 32-bit values
      this.bitPos += take;
      read += take;
    }
    return result;
  }

  readSignedBits(count: number): number {
    const raw = this.readBits(count);
    if (count < 32 && raw >= 2 ** (count - 1)) return raw - 2 ** count;
    if (count === 32) return raw | 0;
    return raw;
  }

  readBool(): boolean {
    return this.readBits(1) !== 0;
  }

  readU8(): number {
    return this.readBits(8);
  }

  readU16(): number {
    return this.readBits(16);
  }

  readU32(): number {
    return this.readBits(32);
  }

  alignToByte(): void {
    const rem = this.bitPos & 7;
    if (rem) this.bitPos += 8 - rem;
  }

  readBytes(count: number): Uint8Array {
    if (this.bitPos & 7) throw new Error('readBytes requires byte alignment');
    const start = this.bitPos >>> 3;
    if (start + count > this.data.length) throw new RangeError('Read past end of data');
    this.bitPos += count * 8;
    return this.data.slice(start, start + count);
  }

  /** Reads a null-terminated string of 8-bit (UTF-8) or 7-bit characters. */
  readString(charBits: 7 | 8, maxLen = 64): string {
    const bytes: number[] = [];
    while (bytes.length < maxLen) {
      const ch = this.readBits(charBits);
      if (ch === 0) break;
      bytes.push(ch);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}

export class BitWriter {
  private buf: Uint8Array;
  bitPos = 0;

  constructor(initialSize = 1024) {
    this.buf = new Uint8Array(initialSize);
  }

  private ensure(bits: number) {
    const needed = ((this.bitPos + bits + 7) >>> 3) + 1;
    if (needed > this.buf.length) {
      const next = new Uint8Array(Math.max(needed, this.buf.length * 2));
      next.set(this.buf);
      this.buf = next;
    }
  }

  writeBits(value: number, count: number): void {
    if (count === 0) return;
    this.ensure(count);
    let written = 0;
    while (written < count) {
      const byteIndex = this.bitPos >>> 3;
      const bitOffset = this.bitPos & 7;
      const take = Math.min(8 - bitOffset, count - written);
      const bits = Math.floor(value / 2 ** written) & ((1 << take) - 1);
      this.buf[byteIndex] = (this.buf[byteIndex] & ~(((1 << take) - 1) << bitOffset)) | (bits << bitOffset);
      this.bitPos += take;
      written += take;
    }
  }

  writeU8(v: number) {
    this.writeBits(v, 8);
  }
  writeU16(v: number) {
    this.writeBits(v, 16);
  }
  writeU32(v: number) {
    this.writeBits(v >>> 0, 32);
  }

  writeBytes(bytes: Uint8Array): void {
    if (this.bitPos & 7) throw new Error('writeBytes requires byte alignment');
    this.ensure(bytes.length * 8);
    this.buf.set(bytes, this.bitPos >>> 3);
    this.bitPos += bytes.length * 8;
  }

  alignToByte(): void {
    const rem = this.bitPos & 7;
    if (rem) this.writeBits(0, 8 - rem);
  }

  get byteLength(): number {
    return (this.bitPos + 7) >>> 3;
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.byteLength);
  }
}

/** Reads `count` bits at an absolute bit offset of a byte array. */
export function readBitsAt(data: Uint8Array, bitOffset: number, count: number): number {
  const r = new BitReader(data);
  r.bitPos = bitOffset;
  return r.readBits(count);
}

/** Overwrites `count` bits at an absolute bit offset of a byte array (in place). */
export function writeBitsAt(data: Uint8Array, bitOffset: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) {
    const bit = Math.floor(value / 2 ** i) & 1;
    const pos = bitOffset + i;
    const byteIndex = pos >>> 3;
    const mask = 1 << (pos & 7);
    data[byteIndex] = bit ? data[byteIndex] | mask : data[byteIndex] & ~mask;
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function u16(data: Uint8Array, off: number): number {
  return data[off] | (data[off + 1] << 8);
}
export function u32(data: Uint8Array, off: number): number {
  return (data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24)) >>> 0;
}
export function setU16(data: Uint8Array, off: number, v: number) {
  data[off] = v & 0xff;
  data[off + 1] = (v >>> 8) & 0xff;
}
export function setU32(data: Uint8Array, off: number, v: number) {
  data[off] = v & 0xff;
  data[off + 1] = (v >>> 8) & 0xff;
  data[off + 2] = (v >>> 16) & 0xff;
  data[off + 3] = (v >>> 24) & 0xff;
}
