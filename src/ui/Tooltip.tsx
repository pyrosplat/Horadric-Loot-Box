import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { D2Item, ItemDescription, QualityClass } from '../core';
import { desc } from '../state/store';
import { uiZoom } from './scale';

export const QUALITY_TEXT: Record<QualityClass, string> = {
  unique: 'text-q-unique',
  set: 'text-q-set',
  magic: 'text-q-magic',
  rare: 'text-q-rare',
  crafted: 'text-q-crafted',
  tempered: 'text-q-tempered',
  runeword: 'text-q-runeword',
  normal: 'text-q-normal',
  superior: 'text-q-normal',
  inferior: 'text-q-low',
  rune: 'text-q-rune',
  gem: 'text-q-normal',
  quest: 'text-q-quest',
  gold: 'text-q-quest',
};

interface TipState {
  /** The item to describe, or `desc` for an item that exists only in the game tables (not found yet). */
  item?: D2Item;
  desc?: ItemDescription;
  x: number;
  y: number;
  extra?: string;
}

const TipCtx = createContext<{ show: (s: TipState) => void; hide: () => void } | null>(null);

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((s: TipState) => setTip(s), []);
  const hide = useCallback(() => setTip(null), []);
  return (
    <TipCtx.Provider value={{ show, hide }}>
      {children}
      {tip && createPortal(<FloatingTip {...tip} />, document.body)}
    </TipCtx.Provider>
  );
}

export function useTooltip() {
  const c = useContext(TipCtx);
  if (!c) throw new Error('TooltipProvider missing');
  return c;
}

function FloatingTip({ item, desc: d, x, y, extra }: TipState) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: (x + 16) / uiZoom(), top: (y + 12) / uiZoom() });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // everything in visual (viewport) px, then back to CSS px for the style (only differs under CSS zoom)
    const z = uiZoom();
    const r = el.getBoundingClientRect();
    const left = x + 16 + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width - 16) : x + 16;
    const top = Math.min(Math.max(8, y + 12), Math.max(8, window.innerHeight - r.height - 8));
    setPos({ left: left / z, top: top / z });
  }, [x, y, item, d]);
  return (
    <div ref={ref} className="pointer-events-none fixed z-50" style={pos}>
      {(item || d) && <ItemCard item={item} desc={d} extra={extra} />}
    </div>
  );
}

export function ItemCard({ item, desc: given, extra, className = '' }: { item?: D2Item; desc?: ItemDescription; extra?: string; className?: string }) {
  const d = given ?? desc(item!);
  const color = QUALITY_TEXT[d.qualityClass];
  return (
    <div className={`w-[300px] max-w-[85vw] rounded-md border border-ink-600 bg-ink-950/95 px-4 py-3 text-center text-[13px] leading-snug shadow-tip backdrop-blur ${className}`}>
      <div className={`font-display text-[15px] font-semibold tracking-wide ${color}`}>{d.name}</div>
      {d.lines.map((l, i) => {
        const prev = d.lines[i - 1];
        if (l.heading)
          return (
            <div key={i} className="mt-2.5 border-t border-ink-700 pt-2 font-display text-[12px] uppercase tracking-[.14em] text-q-set">
              {l.text}
            </div>
          );
        if (l.kind === 'setbonus' && l.bonus) {
          const first = !prev?.bonus || prev.bonus.scope !== l.bonus.scope || prev.bonus.when !== l.bonus.when;
          const label = l.bonus.scope === 'item' ? `This item · ${l.bonus.when}` : l.bonus.when;
          return (
            <div key={i}>
              {first && (
                <div className={`text-[10px] uppercase tracking-[.12em] text-ink-500 ${l.bonus.scope === 'item' && !prev?.bonus ? 'mt-2.5 border-t border-ink-700 pt-2' : 'mt-1.5'}`}>
                  {label}
                </div>
              )}
              <div className={`text-[12px] leading-snug ${l.bonus.scope === 'item' ? 'text-q-set' : 'text-[#7fae7f]'}`}>{l.text}</div>
            </div>
          );
        }
        return (
          <div
            key={i}
            className={
              l.kind === 'base'
                ? i === 0 && d.baseName === l.text
                  ? color
                  : 'text-ink-200'
                : l.kind === 'req'
                  ? 'text-ink-200'
                  : l.kind === 'mod'
                    ? 'text-q-magic'
                    : l.kind === 'setbonus'
                      ? 'text-q-set'
                      : l.kind === 'socket'
                        ? 'text-ink-400'
                        : l.kind === 'flag'
                          ? 'text-ink-300'
                          : 'text-ink-400 text-[12px]'
            }
          >
            {l.text}
            {l.range && (
              <span className={`ml-1.5 text-[11px] ${l.perfect ? 'text-gold-300' : 'text-ink-500'}`} title={l.perfect ? 'Perfect roll' : `Possible roll: ${l.range}`}>
                [{l.range}]{l.perfect ? ' ★' : ''}
              </span>
            )}
          </div>
        );
      })}
      {extra && <div className="mt-2 border-t border-ink-700 pt-2 text-[11px] text-ink-400">{extra}</div>}
    </div>
  );
}
