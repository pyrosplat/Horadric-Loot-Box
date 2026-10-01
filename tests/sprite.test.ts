import { describe, expect, test } from 'vitest';
import { decodeSprite, spriteKey } from '../src/art/sprite';

/** A plain RGBA sprite (version 31), `frames` frames side by side. */
function sprite(w: number, h: number, frames: number): Uint8Array {
  const head = new Uint8Array(0x28);
  const v = new DataView(head.buffer);
  head.set([83, 112, 65, 49]); // "SpA1"
  v.setUint16(4, 31, true);
  v.setUint16(6, w / frames, true);
  v.setUint32(8, w, true);
  v.setUint32(12, h, true);
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([i % 256, 1, 2, 255], i * 4);
  return new Uint8Array([...head, ...px]);
}

describe('item sprites (web page)', () => {
  test('decodes single and multi-frame sprites like the desktop app', () => {
    const a = decodeSprite(sprite(4, 3, 1));
    expect([a.width, a.height, a.rgba.length]).toEqual([4, 3, 48]);
    const b = decodeSprite(sprite(8, 2, 2));
    expect([b.width, b.height, b.rgba.length]).toEqual([4, 2, 32]);
    expect(b.rgba[16]).toBe(8); // second row starts at source pixel 8
    expect(() => decodeSprite(new TextEncoder().encode('nope'))).toThrow();
  });

  test('decodes BC3 sprites', () => {
    // one 4x4 block: alpha 255, colour 0 = pure red (0xF800), all indices 0
    const head = new Uint8Array(0x28);
    const v = new DataView(head.buffer);
    head.set([83, 112, 65, 49]);
    v.setUint16(4, 61, true);
    v.setUint16(6, 4, true);
    v.setUint32(8, 4, true);
    v.setUint32(12, 4, true);
    const d = new Uint8Array([...head, 255, 255, 0, 0, 0, 0, 0, 0, 0x00, 0xf8, 0, 0, 0, 0, 0, 0]);
    const p = decodeSprite(d);
    expect([p.width, p.height]).toEqual([4, 4]);
    expect([...p.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(() => decodeSprite(new Uint8Array([...d, ...new Uint8Array(200)]))).toThrow();
  });

  test('sprite file names become art keys', () => {
    expect(spriteKey('weapon/axe/Hand_Axe.sprite')).toEqual({ key: 'weapon/axe/hand_axe', low: false });
    expect(spriteKey('misc/rune/el_rune.lowend.sprite')).toEqual({ key: 'misc/rune/el_rune', low: true });
    expect(spriteKey('misc/readme.txt')).toBeUndefined();
  });
});
