import type { BitReader } from './bits';

// D2R item code Huffman table: [symbol, code (MSB-first), length]
const TABLE: [string, number, number][] = [
  ['0', 0b11111011, 8], [' ', 0b10, 2], ['1', 0b1111100, 7], ['2', 0b001100, 6], ['3', 0b1101101, 7],
  ['4', 0b11111010, 8], ['5', 0b00010110, 8], ['6', 0b1101111, 7], ['7', 0b01111, 5], ['8', 0b000100, 6],
  ['9', 0b01110, 5], ['a', 0b11110, 5], ['b', 0b0101, 4], ['c', 0b01000, 5], ['d', 0b110001, 6],
  ['e', 0b110000, 6], ['f', 0b010011, 6], ['g', 0b11010, 5], ['h', 0b00011, 5], ['i', 0b1111110, 7],
  ['j', 0b000101110, 9], ['k', 0b010010, 6], ['l', 0b11101, 5], ['m', 0b01101, 5], ['n', 0b001101, 6],
  ['o', 0b1111111, 7], ['p', 0b11001, 5], ['q', 0b11011001, 8], ['r', 0b11100, 5], ['s', 0b0010, 4],
  ['t', 0b01100, 5], ['u', 0b00001, 5], ['v', 0b1101110, 7], ['w', 0b00000, 5], ['x', 0b00111, 5],
  ['y', 0b0001010, 7], ['z', 0b11011000, 8],
];

const decode = new Map<string, string>(); // key: `${length}:${code}`
for (const [sym, code, length] of TABLE) decode.set(`${length}:${code}`, sym);

/** Decodes a 4-character item code (trailing spaces are kept, e.g. "cap "). */
export function decodeItemCode(r: BitReader): string {
  let out = '';
  for (let c = 0; c < 4; c++) {
    let code = 0;
    let len = 0;
    let sym: string | undefined;
    while (len < 9) {
      code = (code << 1) | r.readBits(1);
      len++;
      sym = decode.get(`${len}:${code}`);
      if (sym !== undefined) break;
    }
    if (sym === undefined) throw new Error(`Invalid Huffman item code at bit ${r.bitPos}`);
    out += sym;
  }
  return out;
}
