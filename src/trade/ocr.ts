import type { Worker } from 'tesseract.js';

/**
 * Reads the text of a screenshot, entirely on this computer: tesseract.js (WebAssembly) with the English model,
 * served from the app's own files (public/ocr, copied by scripts/copy-ocr.mjs). Nothing is uploaded anywhere.
 * The engine only loads the first time a screenshot is imported.
 */

let worker: Promise<Worker> | undefined;
let onProgress: ((p: number) => void) | undefined;

const asset = (f: string) => new URL(`${import.meta.env.BASE_URL}ocr/${f}`, location.href).href;

function getWorker(): Promise<Worker> {
  worker ??= import('tesseract.js').then(({ createWorker }) =>
    createWorker('eng', 1, {
      workerPath: asset('worker.min.js'),
      corePath: asset('tesseract-core-lstm.wasm.js'),
      langPath: asset('').replace(/\/$/, ''),
      gzip: true,
      // load the worker straight from the app's files (a blob: worker would need a looser security policy)
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') onProgress?.(m.progress);
      },
    }),
  );
  worker.catch(() => (worker = undefined));
  return worker;
}

async function toBitmap(image: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) return createImageBitmap(image);
  const url = URL.createObjectURL(image);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Gets a screenshot ready for OCR: small ones scaled up (tesseract wants letters ~20+ px tall), grey, and dark
 * themes (like Traderie's) flipped to dark text on a light background, with the contrast stretched.
 */
export async function prepareImage(image: Blob, channel: 'brightest' | 'luminance' = 'brightest'): Promise<HTMLCanvasElement> {
  const bmp = await toBitmap(image);
  const w = bmp.width, h = bmp.height;
  const scale = w < 1800 ? Math.min(3, 1800 / w) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0, lo = 255, hi = 0;
  const grey = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    // the brightest channel, not luminance: Traderie's red numbers and "Ladder" tag are nearly as dark as the
    // background in luminance, but bright in red
    const v = channel === 'brightest' ? Math.max(d[i], d[i + 1], d[i + 2]) : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    grey[j] = v;
    sum += v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const dark = sum / grey.length < 128;
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((grey[j] - lo) / span) * 255;
    if (dark) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

interface OcrWord {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Puts recognised words back into lines, keeping only the listing's text column: on a Traderie card the item's
 * picture and the seller's name, stars and language sit to the left of the title ("1 X Demonhead"), and OCR
 * would otherwise mix them into the item's lines ("KoreanEasy Trading For").
 */
export function columnLines(words: OcrWord[], width: number): string[] {
  const rows = toRows(words);
  const title = rows.find((r) => /^\s*\d{1,3}\s*[xX×]\b/.test(r.map((w) => w.text).join(' ')) || /^\d{1,3}[xX×]$/.test(r[0]?.text ?? ''));
  const left = title ? title[0].x0 - width * 0.02 : 0;
  return toRows(words.filter((w) => w.x0 >= left))
    .map((r) => r.map((w) => w.text).join(' ').trim())
    .filter(Boolean);
}

/** Groups words into rows by their vertical centre, each row left to right. */
function toRows(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const heights = sorted.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)] || 10;
  const rows: OcrWord[][] = [];
  for (const w of sorted) {
    const c = (w.y0 + w.y1) / 2;
    const row = rows.find((r) => Math.abs((r[0].y0 + r[0].y1) / 2 - c) < h * 0.55);
    if (row) row.push(w);
    else rows.push([w]);
  }
  return rows.map((r) => r.sort((a, b) => a.x0 - b.x0));
}

async function words(w: Worker, canvas: HTMLCanvasElement, rectangle?: { left: number; top: number; width: number; height: number }): Promise<OcrWord[]> {
  const { data } = await w.recognize(canvas, rectangle ? { rectangle } : {}, { text: true, blocks: true });
  const out: OcrWord[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) if (wd.text.trim()) out.push({ text: wd.text, ...wd.bbox });
  return out;
}

/**
 * The text of a screenshot's listing column, in two parts: the item (title, tags, stats) and the price (the
 * lines under "Trading For"). The price is white text beside little rune pictures, which reads best in plain
 * grey, so that strip gets a second, quick pass; the item's red and blue text reads best by brightest channel.
 */
export async function readScreenshot(image: Blob, progress?: (p: number) => void): Promise<{ lines: string[]; price?: string[] }> {
  const w = await getWorker();
  onProgress = progress;
  try {
    const canvas = await prepareImage(image);
    const all = await words(w, canvas);
    const lines = columnLines(all, canvas.width);
    // the price strip: from "Trading For" down to "High Rune Value" (or the bottom)
    const rows = toRows(all);
    const tf = rows.find((r) => /trading/i.test(r.map((x) => x.text).join(' ')) && /for/i.test(r.map((x) => x.text).join(' ')));
    if (!tf) return { lines };
    const hr = rows.find((r) => r[0].y0 > tf[0].y1 && /value|rune value|high/i.test(r.map((x) => x.text).join(' ')));
    const top = Math.max(...tf.map((x) => x.y1)) + 2;
    const bottom = hr ? Math.min(...hr.map((x) => x.y0)) - 2 : canvas.height;
    // the listing's text column starts at the title ("1 X …"); the seller's name and stars sit left of it
    const title = rows.find((r) => /^\s*\d{1,3}\s*[xX×]\b/.test(r.map((x) => x.text).join(' ')) || /^\d{1,3}[xX×]$/.test(r[0]?.text ?? ''));
    const left = Math.max(0, (title ? title[0].x0 : Math.min(...tf.map((x) => x.x0))) - canvas.width * 0.05);
    if (bottom - top < 8) return { lines };
    const grey = await prepareImage(image, 'luminance');
    const priceWords = await words(w, grey, { left: Math.round(left), top: Math.round(top), width: Math.round(canvas.width - left), height: Math.round(bottom - top) });
    return { lines, price: toRows(priceWords).map((r) => r.map((x) => x.text).join(' ').trim()).filter(Boolean) };
  } finally {
    onProgress = undefined;
  }
}
