import { useState } from 'react';
import type { D2Item, QualityClass } from '../core';
import { desc, type ItemView } from '../state/store';
import type { ArtIndex } from '../art';
import { useStore } from './context';
import { GlyphIcon, glyphFor } from './glyphs';
import { QUALITY_TEXT } from './Tooltip';

/** Border colours for item boxes, by quality (the way d2emu and the in-game filters colour them). */
export const QUALITY_BORDER: Record<QualityClass, string> = {
  unique: '#b9a063',
  runeword: '#b9a063',
  set: '#2fb82f',
  magic: '#6464f0',
  rare: '#e3e33c',
  crafted: '#e38a1f',
  tempered: '#b85ed0',
  normal: '#cfcfcf',
  superior: '#cfcfcf',
  inferior: '#7a7a7a',
  rune: '#e38a1f',
  gem: '#cfcfcf',
  quest: '#b9a063',
  gold: '#b9a063',
};

/** Where sockets sit inside a w×h item box, as fractions of the box (following the in-game patterns). */
export function socketLayout(n: number, w: number, h: number): { x: number; y: number }[] {
  if (n <= 0) return [];
  const col = (count: number, x = 0.5) => Array.from({ length: count }, (_, i) => ({ x, y: (i + 0.5) / count }));
  if (w === 1) return col(n);
  const rows = (count: number) => Array.from({ length: count }, (_, i) => (i + 0.5) / count);
  switch (n) {
    case 1:
      return [{ x: 0.5, y: 0.5 }];
    case 2:
      return h >= 2 ? col(2).map((p) => ({ x: 0.5, y: h >= 3 ? 0.3 + (p.y - 0.25) * 0.8 : p.y })) : [{ x: 0.27, y: 0.5 }, { x: 0.73, y: 0.5 }];
    case 3:
      return h >= 3 ? col(3) : [{ x: 0.5, y: 0.27 }, { x: 0.27, y: 0.73 }, { x: 0.73, y: 0.73 }];
    case 4: {
      const ys = h >= 3 ? [0.3, 0.7] : [0.27, 0.73];
      return ys.flatMap((y) => [{ x: 0.27, y }, { x: 0.73, y }]);
    }
    case 5: {
      const ys = h >= 3 ? [0.18, 0.82] : [0.22, 0.78];
      return [{ x: 0.27, y: ys[0] }, { x: 0.73, y: ys[0] }, { x: 0.5, y: 0.5 }, { x: 0.27, y: ys[1] }, { x: 0.73, y: ys[1] }];
    }
    default:
      return rows(3).flatMap((y) => [{ x: 0.27, y }, { x: 0.73, y }]).slice(0, n);
  }
}

/** URLs that failed to load (unsupported sprite, missing file): those items fall back to the classic tile. */
const failedArt = new Set<string>();

function ArtImg({ src, className, style, onFail }: { src: string; className?: string; style?: React.CSSProperties; onFail?: () => void }) {
  const [broken, setBroken] = useState(failedArt.has(src));
  if (broken) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => {
        failedArt.add(src);
        setBroken(true);
        onFail?.();
      }}
      className={`pointer-events-none select-none object-contain ${className ?? ''}`}
      style={style}
    />
  );
}

export interface ItemFaceProps {
  item: D2Item;
  /** Box size in px. */
  width: number;
  height: number;
  cell: number;
  view: ItemView;
  art?: ArtIndex;
  /** Show the item's stack size (bottom right). */
  count?: number;
  /** Socket diameter in px. Pass one value for a whole view so every socket there is the same size. */
  socketPx?: number;
}

/** The socket size used everywhere in a grid whose cells are `cell` px. */
export const socketPxFor = (cell: number) => Math.round(cell * 0.74);

/**
 * The inside of an item box: game art (optionally with the name on top) or the classic glyph tile, plus
 * sockets and stack size. The caller draws the box itself.
 */
export function ItemFace({ item, width, height, cell, view, art, count, socketPx }: ItemFaceProps) {
  const d = desc(item);
  const [, bump] = useState(0);
  const wanted = view !== 'tiles' ? art?.srcFor(item) : undefined;
  const src = wanted && !failedArt.has(wanted) ? wanted : undefined;
  const w = item.def?.w ?? 1, h = item.def?.h ?? 1;
  const small = w * h === 1;
  // one size for empty and filled sockets alike
  const socketSize = socketPx ?? socketPxFor(cell);
  const sockets = socketLayout(item.socketCount, w, h);

  return (
    <>
      {src ? (
        <ArtImg src={src} onFail={() => bump((n) => n + 1)} className={`absolute inset-[3%] h-[94%] w-[94%] ${view === 'artNames' ? 'opacity-45' : ''}`} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center">
          <GlyphIcon glyph={glyphFor(item)} className={`${QUALITY_TEXT[d.qualityClass]} ${small ? 'h-4 w-4' : 'h-6 w-6'} opacity-80`} />
          {(!small || ['rune', 'gem'].includes(d.qualityClass)) && view !== 'artNames' && (
            <span className={`mt-0.5 line-clamp-2 px-0.5 font-medium leading-[1.05] ${QUALITY_TEXT[d.qualityClass]} ${small ? 'text-[8px]' : 'text-[10px]'}`}>{d.short}</span>
          )}
        </div>
      )}
      {view === 'tiles' && item.socketCount > 0 && (
        <span className="absolute bottom-0.5 left-0 right-0 flex justify-center gap-[2px]">
          {Array.from({ length: item.socketCount }, (_, i) => (
            <span key={i} className={`h-[5px] w-[5px] rounded-full ${i < item.sockets.length ? 'bg-gold-400' : 'border border-ink-400'}`} />
          ))}
        </span>
      )}
      {view !== 'tiles' && sockets.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {sockets.map((p, i) => {
            const child = item.sockets[i];
            const childSrc = child ? art?.srcFor(child) : undefined;
            return (
              <div
                key={i}
                className={`absolute flex items-center justify-center rounded-full ${child ? (childSrc ? '' : 'bg-gold-500/80 ring-1 ring-black/60') : 'bg-black/80 ring-1 ring-[#6b6b6b]/70'}`}
                style={{
                  left: p.x * width - socketSize / 2,
                  top: p.y * height - socketSize / 2,
                  width: socketSize,
                  height: socketSize,
                  opacity: view === 'artNames' ? 0.5 : 1,
                }}
              >
                {childSrc && <ArtImg src={childSrc} className="h-full w-full drop-shadow-[0_1px_2px_rgba(0,0,0,.9)]" />}
                {!childSrc && child && !src && <span className="text-[6px] font-bold text-ink-950">{desc(child).short.slice(0, 3)}</span>}
              </div>
            );
          })}
        </div>
      )}
      {view === 'artNames' && (
        <span
          className={`absolute inset-0 flex items-center justify-center px-0.5 text-center font-semibold leading-[1.1] [overflow-wrap:break-word] [hyphens:auto] [text-shadow:0_1px_2px_#000,0_0_4px_#000] ${QUALITY_TEXT[d.qualityClass]} ${small ? 'text-[8.5px]' : w >= 2 && h >= 2 ? 'text-[11.5px]' : 'text-[10px]'}`}
        >
          {d.name}
        </span>
      )}
      {count !== undefined && count > 1 && (
        <span className="absolute bottom-[1px] right-[3px] text-[10px] font-bold leading-none text-white [text-shadow:0_1px_2px_#000,0_0_3px_#000]">{count}</span>
      )}
    </>
  );
}

/**
 * Small picture of an item for lists and cards, drawn like the stash grids: the item scaled to fit, with its
 * sockets (filled with runes, gems and jewels, or empty) on top.
 */
export function ItemThumb({ item, size, socketPx }: { item: D2Item; size: number; socketPx?: number }) {
  const store = useStore();
  const w = item.def?.w ?? 1, h = item.def?.h ?? 1;
  const cell = Math.max(6, Math.floor(size / Math.max(w, h)));
  const view = store.showArt ? 'art' : 'tiles';
  const d = desc(item);
  if (view === 'tiles') {
    return (
      <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        <GlyphIcon glyph={glyphFor(item)} className={`${QUALITY_TEXT[d.qualityClass]} ${size > 40 ? 'h-9 w-9' : 'h-5 w-5'}`} />
        {item.socketCount > 0 && (
          <span className="absolute bottom-0 left-0 right-0 flex justify-center gap-[2px]">
            {Array.from({ length: item.socketCount }, (_, i) => (
              <span key={i} className={`h-[5px] w-[5px] rounded-full ${i < item.sockets.length ? 'bg-gold-400' : 'border border-ink-400'}`} />
            ))}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span className={`relative ${item.ethereal ? '[&_img]:opacity-60' : ''}`} style={{ width: w * cell, height: h * cell }}>
        <ItemFace item={item} width={w * cell} height={h * cell} cell={cell} view="art" art={store.art} socketPx={socketPx ?? Math.round(size * 0.22)} />
      </span>
    </span>
  );
}
