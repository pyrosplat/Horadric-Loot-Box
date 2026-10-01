import { useState } from 'react';
import { arrangeStackables, BOARD_SIZE, boardOf, GD, gridDims, STACK_BOARDS, STACKABLE_SLOTS, StashTabType, tabIsEditable, type D2Item, type D2SharedStash, type StackBoard } from '../core';
import { ItemTile } from './ItemTile';
import { desc, itemKey } from '../state/store';
import { Badge } from './CharacterView';
import { drag, endDrag, startDrag, useStore, countFor } from './context';
import { useDrop } from './useDrop';
import { GoldBar } from './Gold';
import { Grid } from './Grid';
import { QUALITY_TEXT, useTooltip } from './Tooltip';

/**
 * A shared stash laid out like the game: one Shared tab with a page switcher, and, for a Reign of the Warlock stash,
 * the Gems, Materials and Runes tabs (the one stackables tab in the file, split the way the game shows it). The
 * Chronicle tab in the file is kept as it is but not shown.
 */
export function StashView({ docId, stash, pane, tab, matches }: { docId: string; stash: D2SharedStash; pane: 0 | 1; tab: number; matches?: (i: D2Item) => boolean }) {
  const store = useStore();
  const [board, setBoard] = useState<StackBoard>('runes');
  const pages = stash.tabs.map((t, i) => (t.type === StashTabType.Normal ? i : -1)).filter((i) => i >= 0);
  const stackTab = stash.tabs.findIndex((t) => t.type === StashTabType.Advanced);
  // the pane's tab is the file's tab index: a shared page, or the stackables tab (any other tab shows page 1)
  const onBoard = tab === stackTab && stackTab >= 0;
  const idx = onBoard ? stackTab : pages.includes(tab) ? tab : pages[0] ?? 0;
  const t = stash.tabs[idx];
  const page = pages.indexOf(idx);
  const vaultId = [...store.docs.values()].find((d) => d.doc?.kind === 'vault')?.id;
  const sharedCount = pages.reduce((n, i) => n + stash.tabs[i].items.length, 0);
  const stacks = stackTab >= 0 ? arrangeStackables(stash.tabs[stackTab].items) : undefined;
  const boardCount = (b: StackBoard) => (stacks ? [...stacks.bySlot].filter(([code, e]) => e.count > 0 && boardOf(code) === b).length + (b === 'materials' ? stacks.extra.length : 0) : 0);
  const paged = store.settings.sharedStash !== 'tabs';
  const tabs: { key: string; label: string; count: number; active: boolean; open: () => void }[] = [
    ...(!pages.length
      ? []
      : paged
        ? [{ key: 'shared', label: 'Shared', count: sharedCount, active: !onBoard, open: () => store.setTab(pane, onBoard ? pages[0] : idx) }]
        : pages.map((p, n) => ({ key: `shared${n}`, label: `Shared ${n + 1}`, count: stash.tabs[p].items.length, active: !onBoard && idx === p, open: () => store.setTab(pane, p) }))),
    ...(stackTab >= 0
      ? STACK_BOARDS.map((b) => ({ key: b.id, label: b.label, count: boardCount(b.id), active: onBoard && board === b.id, open: () => (setBoard(b.id), store.setTab(pane, stackTab)) }))
      : []),
  ];
  const goPage = (n: number) => store.setTab(pane, pages[(n + pages.length) % pages.length]);
  const width = gridDims(stash, 'shared', idx).w * (store.showArt ? 38 : 34) + 2;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-300">
        <span className="font-display text-lg font-semibold text-gold-300">{stash.modern ? 'Reign of the Warlock shared stash' : 'Legacy shared stash'}</span>
        {stash.hardcore ? <Badge tone="red">Hardcore</Badge> : <Badge>Softcore</Badge>}
        <span className="ml-auto text-ink-400">{stash.fileName}</span>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={tb.active}
            onClick={tb.open}
            className={`rounded border px-2.5 py-1 text-[12px] transition ${tb.active ? 'border-gold-500 bg-gold-600/15 text-gold-300' : 'border-ink-600 bg-ink-900 text-ink-300 hover:border-ink-500 hover:bg-ink-800 hover:text-ink-100'}`}
            title={`${tb.label} · ${tb.count} ${tb.key.startsWith('shared') ? 'item' : 'stack'}${tb.count === 1 ? '' : 's'}`}
          >
            {tb.label}
            {tb.count > 0 && <span className="ml-1 text-[11px] text-ink-500">{tb.count}</span>}
          </button>
        ))}
      </div>
      {!onBoard && t ? (
        <>
          <Grid
            docId={docId}
            area="shared"
            tab={idx}
            cols={gridDims(stash, 'shared', idx).w}
            rows={gridDims(stash, 'shared', idx).h}
            items={t.items}
            editable={tabIsEditable(stash, idx)}
            pane={pane}
            matches={matches}
            title={pages.length > 1 ? (paged ? `Shared · Page ${page + 1}` : `Shared ${page + 1}`) : 'Shared'}
            actions={
              vaultId && t.items.length ? (
                <button className="rounded px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-800 hover:text-gold-300" onClick={() => store.moveAllToVault(docId, 'shared', idx, vaultId)}>
                  All → vault
                </button>
              ) : null
            }
          />
          <div className="flex flex-wrap items-center gap-3" style={{ maxWidth: width }}>
            {paged && pages.length > 1 && (
              <div className="flex items-center overflow-hidden rounded border border-ink-600 bg-ink-950/60 text-[12px]" role="group" aria-label="Shared stash page">
                <button className="px-2 py-[3px] text-ink-300 hover:bg-ink-800 hover:text-gold-300" onClick={() => goPage(page - 1)} aria-label="Previous page">
                  ‹
                </button>
                <span className="border-x border-ink-600 px-2.5 py-[3px] tabular-nums text-ink-200">
                  Page {page + 1} / {pages.length}
                </span>
                <button className="px-2 py-[3px] text-ink-300 hover:bg-ink-800 hover:text-gold-300" onClick={() => goPage(page + 1)} aria-label="Next page">
                  ›
                </button>
              </div>
            )}
            <GoldBar gref={{ docId, kind: 'shared', tab: idx }} label="Gold" />
          </div>
        </>
      ) : onBoard ? (
        <StackBoardView docId={docId} pane={pane} tab={idx} items={t.items} board={board} />
      ) : null}
    </div>
  );
}

const FILLED_BORDER: Record<string, string> = { rune: '#e38a1f' };

function StackBoardView({ docId, pane, tab, items, board }: { docId: string; pane: 0 | 1; tab: number; items: D2Item[]; board: StackBoard }) {
  const store = useStore();
  const tip = useTooltip();
  const cell = 38;
  const view = store.showArt ? store.settings.itemView : 'tiles';
  const { bySlot, extra: unknown } = arrangeStackables(items);
  // stackables a newer patch added (no slot yet) are listed under the Materials board
  const extra = board === 'materials' ? unknown : [];
  const size = BOARD_SIZE[board];
  const label = STACK_BOARDS.find((b) => b.id === board)!.label;
  const { handlers, hover } = useDrop(() => ({ docId, area: 'stackables', tab }));
  const canDrag = !store.settings.readOnly;
  const hoverCode = hover && drag.item ? drag.item.code : undefined;
  return (
    <div className="space-y-2">
      <div
        {...handlers}
        className={`relative rounded-[3px] border bg-[#111] p-[3px] ${hover ? (hover.ok ? 'border-emerald-500/60' : 'border-red-500/60') : 'border-[#2c2c2c]'}`}
        style={{ width: size.cols * cell + 8, height: size.rows * cell + 8 }}
        title={hover && !hover.ok ? hover.reason : undefined}
      >
        {STACKABLE_SLOTS.filter((slot) => slot.board === board).map((slot) => {
          const found = bySlot.get(slot.code);
          // an empty stack (count 0) is shown like an empty slot
          const got = found && found.count > 0 ? found : undefined;
          const def = GD.items[slot.code];
          const src = view !== 'tiles' ? store.art?.srcForCode(slot.code) : undefined;
          const w = cell - 2, h = slot.h * cell - 2;
          const style = { left: slot.x * cell + 3, top: slot.y * cell + 3, width: w, height: h };
          const target = hoverCode === slot.code ? (hover!.ok ? 'ring-2 ring-emerald-400/80 z-10' : 'ring-2 ring-red-500/70 z-10') : '';
          if (!got) {
            return (
              <div
                key={slot.code}
                className={`absolute flex items-center justify-center overflow-hidden rounded-[1px] border border-[#242424] bg-[#161616] ${target}`}
                style={style}
                title={`${def?.name ?? slot.code} · none`}
              >
                <SlotArt src={src} className="h-[92%] w-[92%] opacity-[.18] grayscale">
                  <span className="px-0.5 text-center text-[8px] leading-[1.05] text-[#4a4a4a]">{shortName(def?.name ?? slot.code)}</span>
                </SlotArt>
              </div>
            );
          }
          const first = got.items[0];
          const d = desc(first);
          return (
            <div
              key={slot.code}
              role="button"
              tabIndex={0}
              aria-label={`${d.name} × ${got.count}`}
              draggable={canDrag}
              onDragStart={(e) => {
                startDrag(store, e, first, docId, d.name);
                tip.hide();
              }}
              onDragEnd={endDrag}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) store.select(docId, [first], 'toggle');
                else if (store.selection.items.size && !store.isSelected(first)) store.clearSelection();
              }}
              onDoubleClick={
                canDrag
                  ? (e: React.MouseEvent) => (store.isSelected(first) && store.selection.items.size > 1 ? store.quickMoveMany(store.groupFor(first, docId), docId, pane) : store.quickMove(first, docId, pane, countFor(e)))
                  : undefined
              }
              className={`absolute overflow-hidden rounded-[1px] border bg-[#232220] hover:brightness-125 ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${store.isSelected(first) ? 'z-20 ring-2 ring-sky-400' : target}`}
              style={{ ...style, borderColor: view === 'tiles' ? '#5a5048' : FILLED_BORDER[slot.group] ?? '#d6d6d6' }}
              onContextMenu={(e) => {
                e.preventDefault();
                tip.hide();
                store.requestDelete(docId, [first]);
              }}
              onMouseMove={(e) => tip.show({ item: first, x: e.clientX, y: e.clientY, extra: `${got.count} in the ${label} tab${canDrag ? ' · drag or double-click to take one (hold Shift for 3) · right-click to delete one' : ''}` })}
              onMouseLeave={tip.hide}
            >
              <SlotArt src={src} className="absolute inset-[4%] h-[92%] w-[92%]">
                <span className={`absolute inset-0 flex items-center justify-center px-0.5 text-center text-[8.5px] font-semibold leading-[1.05] ${QUALITY_TEXT[d.qualityClass]}`}>{shortName(def?.name ?? slot.code)}</span>
              </SlotArt>
              {got.count > 1 && <span className="absolute bottom-[1px] right-[3px] text-[10.5px] font-bold leading-none text-white [text-shadow:0_1px_2px_#000,0_0_3px_#000]">{got.count}</span>}
            </div>
          );
        })}
      </div>
      {extra.length > 0 && (
        <div className="flex flex-wrap gap-1" style={{ maxWidth: size.cols * cell + 8 }}>
          {extra.map((it) => (
            <div key={itemKey(it)} className="relative" style={{ width: (it.def?.w ?? 1) * cell, height: (it.def?.h ?? 1) * cell }}>
              <ItemTile item={it} docId={docId} cell={cell} draggable={canDrag} pane={pane} style={{ left: 0, top: 0 }} tipExtra={label} onDoubleClick={canDrag ? (e) => store.quickMove(it, docId, pane, countFor(e)) : undefined} />
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-500" style={{ maxWidth: Math.max(size.cols * cell + 8, 300) }}>Drop runes, gems, keys and other stackables here to add them to their stack (99 max). Drag one out to take a single item.</p>
    </div>
  );
}

/** The slot's picture, or its text label when there is no picture (or it fails to load). */
function SlotArt({ src, className, children }: { src?: string; className: string; children: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{children}</>;
  return <img src={src} alt="" draggable={false} className={`object-contain ${className}`} onError={() => setFailed(true)} />;
}

/** "Perfect Amethyst" -> "P. Amethyst", "El Rune" -> "El", for the text-only slots. */
function shortName(name: string): string {
  return name
    .replace(/ Rune$/, '')
    .replace(/^(Chipped|Flawed|Flawless|Perfect) /, (m) => m[0] + '. ')
    .replace(/ Worldstone Shard$/, ' Shard')
    .replace(/^Key of /, 'Key: ')
    .replace(/Essen[cs]e of /, 'Ess. ');
}
