import type { D2Item } from '../core';
import { desc } from '../state/store';
import { endDrag, startDrag, useStore } from './context';
import { ItemFace, QUALITY_BORDER } from './ItemArt';
import { useTooltip } from './Tooltip';

const QUALITY_BG: Record<string, string> = {
  unique: 'bg-[#2b2415] border-[#6b5a2e]',
  runeword: 'bg-[#2b2415] border-[#6b5a2e]',
  set: 'bg-[#13260f] border-[#2f6b28]',
  magic: 'bg-[#15162e] border-[#3b3d8a]',
  rare: 'bg-[#2a2912] border-[#6d6a24]',
  crafted: 'bg-[#2e1d0c] border-[#8a5520]',
  tempered: 'bg-[#29132e] border-[#6c3378]',
  rune: 'bg-[#2e1d0c] border-[#7a4b1c]',
  gem: 'bg-ink-800 border-ink-600',
  quest: 'bg-[#2b2415] border-[#6b5a2e]',
  gold: 'bg-[#2b2415] border-[#6b5a2e]',
  normal: 'bg-ink-800 border-ink-600',
  superior: 'bg-ink-800 border-ink-500',
  inferior: 'bg-ink-850 border-ink-700',
};

export interface TileProps {
  item: D2Item;
  docId: string;
  cell: number;
  draggable: boolean;
  onDoubleClick?: (e?: React.MouseEvent) => void;
  onContext?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
  highlight?: boolean;
  dim?: boolean;
  /** Box size override (equipment slots are bigger than the item). */
  box?: { w: number; h: number };
  tipExtra?: string;
  /** Pane the tile is shown in (for sending a selection to the other pane). */
  pane?: 0 | 1;
  /** Stack count to show instead of the item's own (a trade box groups loose runes into one tile). */
  count?: number;
}

export function ItemTile({ item, docId, cell, draggable, onDoubleClick, onContext, style, highlight, dim, box, tipExtra, pane, count }: TileProps) {
  const store = useStore();
  const d = desc(item);
  const tip = useTooltip();
  const w = item.def?.w ?? 1, h = item.def?.h ?? 1;
  const width = box ? box.w : w * cell - 2;
  const height = box ? box.h : h * cell - 2;
  const view = store.showArt ? store.settings.itemView : 'tiles';
  const stack = count ?? item.advancedStackSize ?? (item.quantity && item.def?.stackable ? item.quantity : undefined);
  const artBox = view !== 'tiles';
  const selected = store.isSelected(item);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={d.name}
      draggable={draggable}
      onDragStart={(e) => {
        startDrag(store, e, item, docId, d.name);
        tip.hide();
      }}
      onDragEnd={endDrag}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation();
          store.select(docId, [item], 'toggle');
        } else if (store.selection.items.size && !selected) store.clearSelection();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => tip.show({ item, x: e.clientX, y: e.clientY, extra: tipExtra ?? (draggable ? 'Drag to move · double-click to send to the other pane · Ctrl+click to select · right-click to delete' : 'Read-only mode is on') })}
      onMouseLeave={tip.hide}
      onDoubleClick={
        onDoubleClick && selected && store.selection.items.size > 1 ? () => store.quickMoveMany(store.groupFor(item, docId), docId, pane ?? 0) : onDoubleClick
      }
      onContextMenu={
        onContext ??
        ((e) => {
          e.preventDefault();
          tip.hide();
          store.requestDelete(docId, store.groupFor(item, docId));
        })
      }
      className={`group absolute select-none overflow-hidden text-center transition
        ${artBox ? 'd2-cell rounded-[1px] border bg-[#1d1c1b]' : `flex flex-col items-center justify-center rounded-[3px] border ${QUALITY_BG[d.qualityClass] ?? QUALITY_BG.normal}`}
        ${draggable ? 'cursor-grab active:cursor-grabbing hover:brightness-125' : 'cursor-default hover:brightness-110'}
        ${item.ethereal ? (artBox ? '[&_img]:opacity-60' : 'opacity-80 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,.035)_6px_8px)]') : ''}
        ${selected ? 'z-20 ring-2 ring-sky-400 ring-offset-1 ring-offset-black brightness-125' : highlight ? 'z-10 ring-2 ring-gold-400' : ''} ${dim && !selected ? 'opacity-25' : ''}`}
      style={{ width, height, ...(artBox ? { borderColor: QUALITY_BORDER[d.qualityClass] } : {}), ...style }}
    >
      <ItemFace item={item} width={width} height={height} cell={cell} view={view} art={store.art} count={stack} />
    </div>
  );
}
