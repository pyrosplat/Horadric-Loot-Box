import { useState } from 'react';
import { arrangeStackables, GD, gridDims, STACKABLE_SLOTS, STACKABLES_COLS, STACKABLES_ROWS, StashTabType, tabIsEditable, type D2Item, type D2SharedStash } from '../core';
import { ItemTile } from './ItemTile';
import { desc, itemKey } from '../state/store';
import { Badge } from './CharacterView';
import { drag, endDrag, startDrag, useStore, countFor } from './context';
import { useDrop } from './useDrop';
import { GoldBar } from './Gold';
import { Grid } from './Grid';
import { QUALITY_TEXT, useTooltip } from './Tooltip';

const TAB_TYPE = ['Shared', 'Stackables', 'Chronicle'];

export function StashView({ docId, stash, pane, tab, matches }: { docId: string; stash: D2SharedStash; pane: 0 | 1; tab: number; matches?: (i: D2Item) => boolean }) {
  const store = useStore();
  const t = stash.tabs[tab] ?? stash.tabs[0];
  const idx = stash.tabs.indexOf(t);
  const vaultId = [...store.docs.values()].find((d) => d.doc?.kind === 'vault')?.id;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-300">
        <span className="font-display text-lg font-semibold text-gold-300">{stash.modern ? 'Reign of the Warlock shared stash' : 'Legacy shared stash'}</span>
        {stash.hardcore ? <Badge tone="red">Hardcore</Badge> : <Badge>Softcore</Badge>}
        <span className="ml-auto text-ink-400">{stash.fileName}</span>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {stash.tabs.map((tb, i) => {
          const count = tb.items.length;
          const active = i === idx;
          return (
            <button
              key={i}
              role="tab"
              aria-selected={active}
              onClick={() => store.setTab(pane, i)}
              className={`rounded border px-2.5 py-1 text-[12px] transition ${active ? 'border-gold-500 bg-gold-600/15 text-gold-300' : 'border-ink-600 bg-ink-900 text-ink-300 hover:border-ink-500 hover:bg-ink-800 hover:text-ink-100'}`}
              title={`${TAB_TYPE[tb.type] ?? 'Tab'} tab · ${count} item${count === 1 ? '' : 's'}${tb.gold ? ` · ${tb.gold.toLocaleString()} gold` : ''}`}
            >
              {tb.type === StashTabType.Normal ? `Shared ${i + 1}` : TAB_TYPE[tb.type]}
              {tb.type !== StashTabType.Chronicle && count > 0 && <span className="ml-1 text-[11px] text-ink-500">{count}</span>}
            </button>
          );
        })}
      </div>
      {t.type === StashTabType.Normal ? (
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
          title={`Shared ${idx + 1}`}
          actions={
            vaultId && t.items.length ? (
              <button className="rounded px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-800 hover:text-gold-300" onClick={() => store.moveAllToVault(docId, 'shared', idx, vaultId)}>
                All → vault
              </button>
            ) : null
          }
        />
      ) : null}
      {t.type === StashTabType.Normal && (
        <div style={{ maxWidth: gridDims(stash, 'shared', idx).w * (store.showArt ? 38 : 34) + 2 }}>
          <GoldBar gref={{ docId, kind: 'shared', tab: idx }} label="Gold" />
        </div>
      )}
      {t.type === StashTabType.Normal ? null : t.type === StashTabType.Advanced ? (
        <MaterialsTab docId={docId} pane={pane} tab={idx} items={t.items} />
      ) : (
        <div className="max-w-md rounded border border-ink-700 bg-ink-900 p-4 text-[13px] text-ink-300">
          <p className="font-medium text-ink-200">Chronicle</p>
          <p className="mt-1 text-ink-400">
            The game's log of set, unique and runeword finds. It is kept exactly as it is and never changed by Horadric Loot Box.
          </p>
        </div>
      )}
    </div>
  );
}

const FILLED_BORDER: Record<string, string> = { rune: '#e38a1f' };

function MaterialsTab({ docId, pane, tab, items }: { docId: string; pane: 0 | 1; tab: number; items: D2Item[] }) {
  const store = useStore();
  const tip = useTooltip();
  const cell = 38;
  const view = store.showArt ? store.settings.itemView : 'tiles';
  const { bySlot, extra } = arrangeStackables(items);
  const { handlers, hover } = useDrop(() => ({ docId, area: 'stackables', tab }));
  const canDrag = !store.settings.readOnly;
  const hoverCode = hover && drag.item ? drag.item.code : undefined;
  return (
    <div className="space-y-2">
      <div
        {...handlers}
        className={`relative rounded-[3px] border bg-[#111] p-[3px] ${hover ? (hover.ok ? 'border-emerald-500/60' : 'border-red-500/60') : 'border-[#2c2c2c]'}`}
        style={{ width: STACKABLES_COLS * cell + 8, height: STACKABLES_ROWS * cell + 8 }}
        title={hover && !hover.ok ? hover.reason : undefined}
      >
        {STACKABLE_SLOTS.map((slot) => {
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
              onMouseMove={(e) => tip.show({ item: first, x: e.clientX, y: e.clientY, extra: `${got.count} in the Stackables tab${canDrag ? ' · drag or double-click to take one (hold Shift for 3) · right-click to delete one' : ''}` })}
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
        <div className="flex flex-wrap gap-1" style={{ maxWidth: STACKABLES_COLS * cell + 8 }}>
          {extra.map((it) => (
            <div key={itemKey(it)} className="relative" style={{ width: (it.def?.w ?? 1) * cell, height: (it.def?.h ?? 1) * cell }}>
              <ItemTile item={it} docId={docId} cell={cell} draggable={canDrag} pane={pane} style={{ left: 0, top: 0 }} tipExtra="Stackables" onDoubleClick={canDrag ? (e) => store.quickMove(it, docId, pane, countFor(e)) : undefined} />
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-500">Drop runes, gems, keys and other stackables here to add them to their stack (99 max). Drag one out to take a single item.</p>
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
