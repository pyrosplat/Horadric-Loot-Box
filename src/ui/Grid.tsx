import { useState } from 'react';
import type { D2Item, GridKind } from '../core';
import { itemKey, type Loc } from '../state/store';
import { drag, dropDragged, useStore, countFor } from './context';
import { uiZoom } from './scale';
import { ItemTile } from './ItemTile';

export interface GridProps {
  docId: string;
  area: GridKind;
  tab?: number;
  cols: number;
  rows: number;
  items: D2Item[];
  editable: boolean;
  pane: 0 | 1;
  title?: string;
  cell?: number;
  matches?: (item: D2Item) => boolean;
  actions?: React.ReactNode;
}

/** Dark inset cells, like the in-game inventory grid. */
export function cellBackground(cell: number): React.CSSProperties {
  return {
    backgroundImage:
      'linear-gradient(to right, #2b2b2b 1px, transparent 1px), linear-gradient(to bottom, #2b2b2b 1px, transparent 1px), linear-gradient(135deg, #191919, #121212)',
    backgroundSize: `${cell}px ${cell}px, ${cell}px ${cell}px, ${cell}px ${cell}px`,
    backgroundPosition: '1px 1px',
  };
}

export function Grid({ docId, area, tab = 0, cols, rows, items, editable: editableProp, pane, title, cell: cellProp, matches, actions }: GridProps) {
  const store = useStore();
  const editable = editableProp && !store.settings.readOnly;
  const cell = cellProp ?? (store.showArt ? 38 : 34);
  const [hover, setHover] = useState<{ x: number; y: number; ok: boolean } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Box selection: press on an empty part of the grid and drag
  const startBox = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const z = uiZoom();
    const p = (ev: MouseEvent) => ({ x: Math.max(0, Math.min(r.width, ev.clientX - r.left)) / z, y: Math.max(0, Math.min(r.height, ev.clientY - r.top)) / z });
    const s0 = p(e.nativeEvent);
    let cur = { x0: s0.x, y0: s0.y, x1: s0.x, y1: s0.y };
    setBox(cur);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const move = (ev: MouseEvent) => {
      const q = p(ev);
      cur = { ...cur, x1: q.x, y1: q.y };
      setBox(cur);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setBox(null);
      const [l, rgt] = [Math.min(cur.x0, cur.x1), Math.max(cur.x0, cur.x1)];
      const [t, b] = [Math.min(cur.y0, cur.y1), Math.max(cur.y0, cur.y1)];
      if (rgt - l < 4 && b - t < 4) {
        if (!additive) store.clearSelection();
        return;
      }
      const hit = items.filter((it) => {
        const w = (it.def?.w ?? 1) * cell, h = (it.def?.h ?? 1) * cell;
        const ix = it.x * cell + 2, iy = it.y * cell + 2;
        return ix < rgt && ix + w > l && iy < b && iy + h > t;
      });
      store.select(docId, hit, additive ? 'add' : 'replace');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const group = drag.items?.length ?? 1;

  const locAt = (x: number, y: number): Loc => (area === 'shared' ? { docId, area, tab, x, y } : { docId, area, x, y });

  const cellFromEvent = (e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const it = drag.item;
    const w = it?.def?.w ?? 1, h = it?.def?.h ?? 1;
    // anchor the item's top-left so the cursor sits near its centre
    const z = uiZoom();
    const x = Math.floor((e.clientX - rect.left) / z / cell - (w - 1) / 2);
    const y = Math.floor((e.clientY - rect.top) / z / cell - (h - 1) / 2);
    return { x: Math.max(0, Math.min(cols - w, x)), y: Math.max(0, Math.min(rows - h, y)) };
  };

  return (
    <section className="select-none">
      {(title || actions) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {title && <h3 className="font-display text-[11px] uppercase tracking-[.18em] text-ink-400">{title}</h3>}
          {actions}
        </div>
      )}
      <div
        className={`d2-slot relative rounded-[3px] border ${editable ? 'border-[#3a3a3a]' : 'border-[#2c2c2c] opacity-90'} bg-[#111]`}
        style={{
          width: cols * cell + 2,
          height: rows * cell + 2,
          ...cellBackground(cell),
        }}
        onDragOver={(e) => {
          if (!editable || !drag.item) return;
          e.preventDefault();
          const { x, y } = cellFromEvent(e);
          if (hover?.x === x && hover?.y === y) return;
          const ok = store.check(drag.item, drag.fromDocId!, locAt(x, y)).ok;
          e.dataTransfer.dropEffect = ok ? 'move' : 'none';
          setHover({ x, y, ok });
        }}
        onDragLeave={() => setHover(null)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(null);
          if (!editable || !drag.item) return;
          const { x, y } = cellFromEvent(e);
          dropDragged(store, locAt(x, y));
        }}
        onMouseDown={startBox}
      >
        {box && (
          <div
            className="pointer-events-none absolute z-30 rounded-[2px] border border-sky-400 bg-sky-400/15"
            style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
          />
        )}
        {hover && drag.item && (
          <div
            className={`pointer-events-none absolute rounded-sm ${hover.ok ? 'bg-emerald-500/25 ring-1 ring-emerald-400/70' : 'bg-red-500/25 ring-1 ring-red-400/70'}`}
            style={{ left: hover.x * cell + 1, top: hover.y * cell + 1, width: (drag.item.def?.w ?? 1) * cell, height: (drag.item.def?.h ?? 1) * cell }}
          >
            {group > 1 && <span className="absolute -right-2 -top-2 rounded-full bg-sky-500 px-1.5 text-[10px] font-bold text-white">{group}</span>}
          </div>
        )}
        {items.map((it) => (
          <ItemTile
            key={itemKey(it)}
            item={it}
            docId={docId}
            cell={cell}
            draggable={editable}
            pane={pane}
            onDoubleClick={editable ? (e) => store.quickMove(it, docId, pane, countFor(e)) : undefined}
            style={{ left: it.x * cell + 2, top: it.y * cell + 2 }}
            highlight={matches ? matches(it) : false}
            dim={matches ? !matches(it) : false}
          />
        ))}
      </div>
    </section>
  );
}
