/**
 * Decodes Diablo II: Resurrected inventory sprites ("SpA1", the `.sprite` files under `data/hd/global/ui/items`) to
 * RGBA pixels, for the web page. Same format handling as the desktop app's Rust decoder (src-tauri/src/art.rs):
 * version 31 is plain RGBA, version 61 is DXT5 (BC3) compressed; multi-frame sprites keep only the first frame.
 */
export interface Pixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export function decodeSprite(data: Uint8Array): Pixels {
  const tag = String.fromCharCode(...data.subarray(0, 4)).toLowerCase();
  if (data.length < 0x28 || tag !== 'spa1') throw new Error('not a SpA1 sprite');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint16(4, true);
  const frameW = view.getUint16(6, true);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  if (!width || !height || width > 4096 || height > 4096) throw new Error('bad sprite size');
  let px: Uint8Array;
  if (version === 31) {
    const end = 0x28 + width * height * 4;
    if (data.length < end) throw new Error('sprite is truncated');
    px = data.subarray(0x28, end);
  } else if (version === 61) {
    // only accepted when the payload is exactly the expected size
    const blocks = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
    const body = data.subarray(0x28);
    if (body.length < blocks || body.length > blocks + 64) throw new Error('unrecognised compressed sprite layout');
    px = decodeBc3(body.subarray(0, blocks), width, height);
  } else throw new Error(`sprite version ${version} is not supported`);
  const fw = frameW > 0 && frameW < width ? frameW : width;
  const out = new Uint8ClampedArray(new ArrayBuffer(fw * height * 4));
  if (fw === width) out.set(px);
  else for (let y = 0; y < height; y++) out.set(px.subarray(y * width * 4, y * width * 4 + fw * 4), y * fw * 4);
  return { width: fw, height, rgba: out };
}

/** DXT5 (BC3) blocks to RGBA. */
function decodeBc3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const bw = Math.ceil(w / 4);
  const rgb = (v: number) => {
    const r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31;
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
  };
  for (let bi = 0; bi * 16 < src.length; bi++) {
    const b = src.subarray(bi * 16, bi * 16 + 16);
    const bx = (bi % bw) * 4, by = Math.floor(bi / bw) * 4;
    const a0 = b[0], a1 = b[1];
    const alpha = [a0, a1];
    for (let i = 2; i < 8; i++)
      alpha.push(a0 > a1 ? Math.floor(((8 - i) * a0 + (i - 1) * a1) / 7) : i < 6 ? Math.floor(((6 - i) * a0 + (i - 1) * a1) / 5) : i === 6 ? 0 : 255);
    // 48 bits of 3-bit alpha indices (beyond 32 bits, so use BigInt)
    let abits = 0n;
    for (let i = 0; i < 6; i++) abits |= BigInt(b[2 + i]) << BigInt(8 * i);
    const c0 = rgb(b[8] | (b[9] << 8)), c1 = rgb(b[10] | (b[11] << 8));
    const mix = (x: number[], y: number[], wx: number, wy: number) => x.map((v, k) => Math.floor((v * wx + y[k] * wy) / 3));
    const colors = [c0, c1, mix(c0, c1, 2, 1), mix(c0, c1, 1, 2)];
    const cbits = (b[12] | (b[13] << 8) | (b[14] << 16) | (b[15] << 24)) >>> 0;
    for (let py = 0; py < 4; py++)
      for (let pxi = 0; pxi < 4; pxi++) {
        const x = bx + pxi, y = by + py;
        if (x >= w || y >= h) continue;
        const i = py * 4 + pxi;
        const col = colors[(cbits >>> (2 * i)) & 3];
        const a = alpha[Number((abits >> BigInt(3 * i)) & 7n)];
        const o = (y * w + x) * 4;
        out[o] = col[0];
        out[o + 1] = col[1];
        out[o + 2] = col[2];
        out[o + 3] = a;
      }
  }
  return out;
}

/** `hd/global/ui/items/<key>.sprite` / `.lowend.sprite` → its art key (`weapon/axe/hand_axe`), or undefined. */
export function spriteKey(pathUnderItems: string): { key: string; low: boolean } | undefined {
  const p = pathUnderItems.replace(/\\/g, '/').toLowerCase();
  if (p.endsWith('.lowend.sprite')) return { key: p.slice(0, -'.lowend.sprite'.length), low: true };
  if (p.endsWith('.sprite')) return { key: p.slice(0, -'.sprite'.length), low: false };
  return undefined;
}
