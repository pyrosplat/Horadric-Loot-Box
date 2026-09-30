import { Suspense, lazy, useState } from 'react';
import type { D2Item } from '../core';
import { TRADE_ID, desc, docLabel } from '../state/store';
import { CharacterView } from './CharacterView';
import { useStore, docDrag } from './context';
import { StashView } from './StashView';
import { VaultView } from './VaultView';

// the optional Trade panel is loaded only when it's opened
const TradeView = lazy(() => import('../trade/TradeView').then((m) => ({ default: m.TradeView })));

export function Pane({ pane }: { pane: 0 | 1 }) {
  const store = useStore();
  const state = store.panes[pane];
  const entry = state.docId ? store.docs.get(state.docId) : undefined;
  const [query, setQuery] = useState('');
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length ? (i: D2Item) => terms.every((t) => desc(i).search.includes(t)) : undefined;
  const docs = [...store.docs.values()].filter((d) => d.doc);
  const [docOver, setDocOver] = useState(false);
  const dragged = docDrag.id ? store.docs.get(docDrag.id) : undefined;

  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col rounded-lg border border-ink-700 bg-ink-850/60"
      onDragOver={(e) => {
        if (!docDrag.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!docOver) setDocOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDocOver(false);
      }}
      onDrop={(e) => {
        if (!docDrag.id) return;
        e.preventDefault();
        setDocOver(false);
        store.showInPane(pane, docDrag.id);
        docDrag.id = undefined;
      }}
    >
      {docOver && dragged && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-gold-400 bg-black/55">
          <span className="rounded-md bg-ink-900/95 px-4 py-2 text-[14px] text-gold-300 shadow-tip">
            Open <span className="font-semibold">{docLabel(dragged.doc, dragged.name)}</span> on the {pane === 0 ? 'left' : 'right'}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <select
          className="min-w-0 max-w-[55%] flex-1 truncate rounded border border-ink-600 bg-ink-900 px-2 py-1 text-[13px] text-ink-200"
          value={state.docId ?? ''}
          onChange={(e) => store.showInPane(pane, e.target.value)}
          aria-label={`File in ${pane === 0 ? 'left' : 'right'} pane`}
        >
          <option value="" disabled>
            Choose a file…
          </option>
          {store.settings.tradeEnabled && <option value={TRADE_ID}>Trade</option>}
          {(['vault', 'stash', 'character'] as const).map((k) => (
            <optgroup key={k} label={k === 'vault' ? 'Vaults' : k === 'stash' ? 'Shared stashes' : 'Characters'}>
              {docs
                .filter((d) => d.doc!.kind === k)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {docLabel(d.doc, d.name)}
                    {d.dirty ? ' •' : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <div className="relative ml-auto w-44">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={entry?.doc?.kind === 'vault' ? 'Search vault…' : 'Highlight…'}
            className="w-full rounded border border-ink-600 bg-ink-900 py-1 pl-2 pr-6 text-[12px] text-ink-200 placeholder:text-ink-500 focus:border-gold-500 focus:outline-none"
          />
          {query && (
            <button className="absolute right-1.5 top-1 text-ink-400 hover:text-ink-200" onClick={() => setQuery('')} aria-label="Clear">
              ×
            </button>
          )}
        </div>
      </div>
      {entry && store.selection.docId === entry.id && store.selection.items.size > 0 && <SelectionBar docId={entry.id} pane={pane} />}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state.docId === TRADE_ID && store.settings.tradeEnabled ? (
          <Suspense fallback={<Empty text="Loading Trade…" />}>
            <TradeView />
          </Suspense>
        ) : !entry ? (
          <Empty text="Pick a character, stash or vault from the list." />
        ) : entry.error ? (
          <div className="rounded border border-red-900 bg-red-950/40 p-4 text-[13px] text-red-200">
            <p className="font-medium">Couldn't read {entry.name}</p>
            <p className="mt-1 text-red-300/80">{entry.error}</p>
          </div>
        ) : entry.doc!.kind === 'character' ? (
          <CharacterView docId={entry.id} ch={entry.doc!} pane={pane} matches={matches} />
        ) : entry.doc!.kind === 'stash' ? (
          <StashView docId={entry.id} stash={entry.doc!} pane={pane} tab={state.tab} matches={matches} />
        ) : (
          <VaultView docId={entry.id} vault={entry.doc!} pane={pane} query={query} />
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full min-h-[300px] items-center justify-center text-[13px] text-ink-500">{text}</div>;
}

function SelectionBar({ docId, pane }: { docId: string; pane: 0 | 1 }) {
  const store = useStore();
  const items = [...store.selection.items];
  const isVault = store.docs.get(docId)?.doc?.kind === 'vault';
  const vaultId = [...store.docs.values()].find((d) => d.doc?.kind === 'vault')?.id;
  const btn = 'rounded px-2 py-0.5 text-[12px] font-medium hover:bg-sky-800/60 disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-sky-800/60 bg-sky-950/60 px-3 py-1.5 text-[12.5px] text-sky-100">
      <span className="font-semibold">{items.length} selected</span>
      <span className="text-sky-300/70">· drag one to move them all</span>
      <span className="ml-auto" />
      <button className={btn} onClick={() => store.quickMoveMany(items, docId, pane)} disabled={store.settings.readOnly}>
        Send to other pane
      </button>
      {!isVault && vaultId && (
        <button className={btn} onClick={() => store.moveMany(items, docId, { docId: vaultId, area: 'vault' })} disabled={store.settings.readOnly}>
          Send to vault
        </button>
      )}
      <button className={`${btn} text-red-200 hover:bg-red-900/50`} onClick={() => store.requestDelete(docId, items)} disabled={store.settings.readOnly} title="Delete key">
        Delete…
      </button>
      <button className={btn} onClick={() => store.clearSelection()} title="Esc">
        Clear
      </button>
    </div>
  );
}
