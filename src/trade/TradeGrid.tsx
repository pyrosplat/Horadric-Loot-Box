import { createCompactItem, createUberItem, isUberCode, type D2Item } from '../core';
import { TRADE_ID } from '../state/store';
import { countFor, useStore } from '../ui/context';
import { cellBackground } from '../ui/Grid';
import { ItemTile } from '../ui/ItemTile';

export interface GridEntry {
  key: string;
  item: D2Item;
  /** Shown as a stack count (runes, gems and uber items of one kind share a tile). */
  count?: number;
  tip?: string;
  /** Right-click: take one away (Shift for 3). */
  onRemove?: (n: number) => void;
  /** Can be dragged out, from this box (the offer box: drag your runes back home). */
  dragFrom?: string;
}

const shown = new Map<string, D2Item>();
/** A rune, gem or uber item to draw in a grid (built once per code; never saved). */
export function displayItem(code: string): D2Item {
  let it = shown.get(code);
  if (!it) shown.set(code, (it = isUberCode(code) ? createUberItem(code) : createCompactItem(code)));
  return it;
}

/** Places items like the inventory does: each at the first free spot, left to right, top to bottom. */
function pack(entries: GridEntry[], cols: number): { e: GridEntry; x: number; y: number }[] {
  const used: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (used[j]?.[i]) return false;
    return true;
  };
  const out: { e: GridEntry; x: number; y: number }[] = [];
  for (const e of entries) {
    const w = Math.min(cols, e.item.def?.w ?? 1), h = e.item.def?.h ?? 1;
    for (let y = 0; ; y++) {
      const x = Array.from({ length: cols - w + 1 }, (_, i) => i).find((i) => free(i, y, w, h));
      if (x === undefined) continue;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) (used[j] ??= [])[i] = true;
      out.push({ e, x, y });
      break;
    }
  }
  return out;
}

/**
 * The trade window's grid: what you want or what you offer, drawn with the item pictures and laid out the way
 * they'd sit in an inventory (a Monarch takes 2×4, a rune 1×1).
 */
/** The same size as the character inventory and the in-game trade window: 10 × 4. */
export function TradeGrid({ entries, cols = 10, minRows = 4, empty }: { entries: GridEntry[]; cols?: number; minRows?: number; empty?: string }) {
  const store = useStore();
  const cell = store.showArt ? 38 : 34;
  const placed = pack(entries, cols);
  const rows = Math.max(minRows, ...placed.map((p) => p.y + (p.e.item.def?.h ?? 1)));
  return (
    <div className="relative rounded border border-[#2b2b2b]" style={{ width: cols * cell + 3, height: rows * cell + 3, maxWidth: '100%', ...cellBackground(cell) }}>
      {!entries.length && empty && <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-[12px] text-ink-500">{empty}</span>}
      {placed.map(({ e, x, y }) => (
        <ItemTile
          key={e.key}
          item={e.item}
          count={e.count}
          docId={e.dragFrom ?? TRADE_ID}
          cell={cell}
          draggable={!!e.dragFrom}
          tipExtra={e.tip}
          style={{ left: x * cell + 2, top: y * cell + 2 }}
          onContext={(ev) => {
            ev.preventDefault();
            e.onRemove?.(countFor(ev));
          }}
        />
      ))}
    </div>
  );
}
