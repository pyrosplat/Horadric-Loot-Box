// Copies the offline OCR files (tesseract.js worker, WebAssembly core, English model) into public/ocr so the
// Trade panel's screenshot import works with no internet. Run automatically by `npm run dev` and `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'ocr');
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = path.join(root, from), dst = path.join(out, to);
  if (!fs.existsSync(src)) throw new Error(`Missing ${from}; run npm install`);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
}
console.log('ocr: files ready in public/ocr');
