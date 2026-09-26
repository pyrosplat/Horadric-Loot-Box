import { useMemo, useState } from 'react';
import { TYPE_GROUPS, collectHeld, groupOfType, itemTypeOf, progress, vaultNameProblem, type CollectionKind, type D2Item, type QualityClass, type Vault } from '../core';
import { CollectionView } from './Collection';
import { ItemThumb } from './ItemArt';
import { desc, itemKey, potLabel } from '../state/store';
import { GoldBar } from './Gold';
import { drag, dropDragged, endDrag, startDrag, useStore, countFor } from './context';
import { QUALITY_TEXT, useTooltip } from './Tooltip';

const FILTERS: { key: string; label: string; test: (q: QualityClass) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'rare', label: 'Rare/Craft', test: (q) => q === 'rare' || q === 'crafted' || q === 'tempered' },
  { key: 'magic', label: 'Magic', test: (q) => q === 'magic' },
  { key: 'base', label: 'Bases', test: (q) => q === 'normal' || q === 'superior' || q === 'inferior' },
];

const TABS: { id: 'items' | CollectionKind; label: string; kind?: CollectionKind }[] = [
  { id: 'items', label: 'Items' },
  { id: 'unique', label: 'Uniques', kind: 'unique' },
  { id: 'set', label: 'Sets', kind: 'set' },
  { id: 'runeword', label: 'Runewords', kind: 'runeword' },
  { id: 'rune', label: 'Runes', kind: 'rune' },
  { id: 'gem', label: 'Gems', kind: 'gem' },
];

type Sort = 'recent' | 'oldest' | 'name' | 'levelAsc' | 'levelDesc' | 'quality';
const SORTS: [Sort, string][] = [
  ['recent', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['quality', 'Quality'],
  ['name', 'Name (A–Z)'],
  ['levelAsc', 'Level: lowest first'],
  ['levelDesc', 'Level: highest first'],
];

/** 'all', 'group:Weapons' or a single type like 'Swords'. */
const typeMatches = (want: string, t: string) => want === 'all' || t === want || want === `group:${groupOfType(t)}`;
/** Uniques, sets, runewords, runes and gems live in their own collection tabs, not in the Items list. */
const IN_COLLECTION = new Set<QualityClass>(['unique', 'set', 'runeword', 'rune', 'gem']);

const Q_ORDER: QualityClass[] = ['rare', 'crafted', 'tempered', 'magic', 'rune', 'gem', 'superior', 'normal', 'inferior', 'quest', 'gold'];

export function VaultView({ docId, vault, pane, query }: { docId: string; vault: Vault; pane: 0 | 1; query: string }) {
  const store = useStore();
  const tip = useTooltip();
  const [filter, setFilter] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [tab, setTab] = useState<'items' | CollectionKind>('items');

  const otherCount = vault.entries.filter((e) => !IN_COLLECTION.has(desc(e.item).qualityClass)).length;
  // Collection tab counts: distinct Chronicle entries found (legacy rows excluded), across the whole account and
  // in this vault alone (the tooltip).
  const counts = (() => {
    const everything = store.held(docId);
    const loose = everything.filter((h) => !h.socketedIn);
    const here = loose.filter((h) => h.inVault);
    const out = {} as Record<CollectionKind, { account: { found: number; total: number }; vault: number }>;
    for (const kind of ['unique', 'set', 'runeword', 'rune', 'gem'] as CollectionKind[]) {
      const split = kind === 'unique' && store.settings.grailEth;
      // runes and gems socketed into items count only with "Include … in items"; socketed jewels always count
      const all = (kind === 'rune' || kind === 'gem') && store.settings.grailSocketed === false ? loose : everything;
      out[kind] = { account: progress(kind, split, collectHeld(kind, all, split)), vault: progress(kind, split, collectHeld(kind, here, split)).found };
    }
    return out;
  })();
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = vault.entries
      .map((e, i) => ({ e, d: desc(e.item), i }))
      .filter(({ e, d }) => !IN_COLLECTION.has(d.qualityClass) && f.test(d.qualityClass) && typeMatches(type, itemTypeOf(e.item.code)) && terms.every((t) => d.search.includes(t)));
    list.sort((a, b) => {
      if (sort === 'name') return a.d.name.localeCompare(b.d.name);
      if (sort === 'levelAsc') return a.d.requiredLevel - b.d.requiredLevel || a.d.name.localeCompare(b.d.name);
      if (sort === 'levelDesc') return b.d.requiredLevel - a.d.requiredLevel || a.d.name.localeCompare(b.d.name);
      if (sort === 'oldest') return a.i - b.i;
      if (sort === 'quality') return Q_ORDER.indexOf(a.d.qualityClass) - Q_ORDER.indexOf(b.d.qualityClass) || a.d.name.localeCompare(b.d.name);
      return b.i - a.i;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.entries, vault.entries.length, filter, type, sort, query, store.rev]);
  // item types present in the Items list, with counts, for the type filter
  const types = new Map<string, number>();
  for (const e of vault.entries) if (!IN_COLLECTION.has(desc(e.item).qualityClass)) { const t = itemTypeOf(e.item.code); types.set(t, (types.get(t) ?? 0) + 1); }
  const groupCount = (types_: string[]) => types_.reduce((n, t) => n + (types.get(t) ?? 0), 0);

  return (
    <div
      className={`flex h-full min-h-[420px] flex-col rounded border ${over ? 'border-gold-400 bg-gold-600/5' : 'border-transparent'}`}
      onDragOver={(e) => {
        if (!drag.item || drag.fromDocId === docId) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (drag.item && drag.fromDocId !== docId) dropDragged(store, { docId, area: 'vault' });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            defaultValue={vault.name}
            className="rounded border border-ink-600 bg-ink-900 px-2 py-0.5 font-display text-lg text-gold-300 outline-none focus:border-gold-500"
            onChange={(e) => {
              e.currentTarget.value = e.currentTarget.value.replace(/\s/g, '_');
              setRenameError(vaultNameProblem(e.currentTarget.value, store.vaultNames(docId)) ?? null);
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              const problem = v === vault.name ? undefined : store.renameVault(docId, v);
              if (problem) store.toast('error', `Vault not renamed: ${problem}`);
              setRenameError(null);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.currentTarget.value = vault.name;
                e.currentTarget.blur();
              }
            }}
            maxLength={32}
            spellCheck={false}
          />
        ) : (
          <button className="font-display text-lg font-semibold text-gold-300 hover:text-gold-400" title="Rename" onClick={() => setRenaming(true)}>
            {vault.name}
          </button>
        )}
        {renaming && renameError && <span className="text-[11.5px] text-red-300">{renameError}</span>}
        <span className="text-[12px] text-ink-400">
          {vault.entries.length} item{vault.entries.length === 1 ? '' : 's'} · unlimited storage
        </span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="ml-auto rounded border border-ink-600 bg-ink-900 px-2 py-1 text-[12px] text-ink-200"
          aria-label="Sort"
        >
          {SORTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <VaultGold docId={docId} vault={vault} />
      <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-ink-700" role="tablist">
        {TABS.map((t) => {
          const c = t.kind ? counts[t.kind] : undefined;
          const total = c ? c.account.total : otherCount;
          const found = c?.account.found;
          return (
            <button
              key={t.id}
              role="tab"
              title={c ? `${c.account.found} of ${c.account.total} found across the account · ${c.vault} in this vault` : undefined}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px rounded-t border-b-2 px-3 py-1.5 text-[12.5px] ${tab === t.id ? 'border-gold-400 text-gold-300' : 'border-transparent text-ink-400 hover:text-ink-200'}`}
            >
              {t.label} <span className="text-[11px] text-ink-500">{found === undefined ? total : `${found}/${total}`}</span>
            </button>
          );
        })}
        {tab === 'items' && (
          <span className="mb-1 ml-auto flex overflow-hidden rounded border border-ink-600 text-[11px]" role="radiogroup" aria-label="Layout">
            {(['list', 'cards'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={store.settings.vaultView === v}
                onClick={() => store.setSettings({ vaultView: v })}
                className={`px-2.5 py-1 capitalize ${store.settings.vaultView === v ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200'}`}
              >
                {v}
              </button>
            ))}
          </span>
        )}
      </div>
      {tab === 'items' ? (
        <>
        <div className="mt-2 flex flex-wrap gap-1">
          {rows.length > 0 && (
            <button
              className="order-last ml-auto rounded-full border border-ink-600 px-2.5 py-0.5 text-[11px] text-ink-300 hover:text-ink-100"
              onClick={() => store.select(docId, rows.map((r) => r.e.item), 'replace')}
              title="Select every item shown (then drag one, or double-click, to move them all)"
            >
              Select all shown
            </button>
          )}
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${filter === f.key ? 'border-gold-500 bg-gold-600/15 text-gold-300' : 'border-ink-600 text-ink-400 hover:text-ink-200'}`}
            >
              {f.label}
            </button>
          ))}
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Item type"
            className={`rounded-full border bg-ink-900 px-2 py-0.5 text-[11px] ${type !== 'all' ? 'border-gold-500 text-gold-300' : 'border-ink-600 text-ink-300'}`}
          >
            <option value="all">All types</option>
            {TYPE_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                <option value={`group:${g.group}`} disabled={!groupCount(g.types)}>
                  All {g.group.toLowerCase()} ({groupCount(g.types)})
                </option>
                {g.types
                  .filter((t) => types.get(t))
                  .map((t) => (
                    <option key={t} value={t}>
                      {t} ({types.get(t)})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="mt-2 flex-1 overflow-auto rounded border border-ink-700 bg-ink-900">
          {rows.length === 0 ? (
            <div className="flex h-full min-h-[200px] items-center justify-center p-6 text-center text-[13px] text-ink-500">
              {otherCount
                ? 'No items match.'
                : vault.entries.length
                  ? 'Everything here is a unique, set item, runeword or rune: see their tabs above.'
                  : 'Drag items here from a character or stash, or double-click an item in the other pane.'}
            </div>
          ) : (
            store.settings.vaultView === 'cards' ? (
            <div className="flex flex-wrap gap-1.5 p-2">
              {rows.map(({ e, d }) => (
                <VaultCard key={itemKey(e.item)} item={e.item} docId={docId} pane={pane} source={e.source} onTip={tip} name={d.name} />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-ink-800">
              {rows.map(({ e, d }) => (
                <VaultRow key={itemKey(e.item)} item={e.item} docId={docId} pane={pane} source={e.source} onTip={tip} name={d.name} />
              ))}
            </ul>
          )
          )}
        </div>

        </>
      ) : (
        <CollectionView docId={docId} pane={pane} kind={tab} query={query} />
      )}
    </div>
  );
}

function VaultRow({ item, docId, pane, source, onTip, name }: { item: D2Item; docId: string; pane: 0 | 1; source?: string; onTip: ReturnType<typeof useTooltip>; name: string }) {
  const store = useStore();
  const d = desc(item);
  const selected = store.isSelected(item);
  const firstMod = d.lines.find((l) => l.kind === 'mod')?.text;
  return (
    <li
      draggable={!store.settings.readOnly}
      onDragStart={(e) => {
        startDrag(store, e, item, docId, name);
        onTip.hide();
      }}
      onDragEnd={endDrag}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) store.select(docId, [item], 'toggle');
        else if (store.selection.items.size && !selected) store.clearSelection();
      }}
      onDoubleClick={(e) => (selected && store.selection.items.size > 1 ? store.quickMoveMany(store.groupFor(item, docId), docId, pane) : store.quickMove(item, docId, pane, countFor(e)))}
      onContextMenu={(e) => {
        e.preventDefault();
        onTip.hide();
        store.requestDelete(docId, store.groupFor(item, docId));
      }}
      onMouseMove={(e) => onTip.show({ item, x: e.clientX, y: e.clientY, extra: `${source ? `From ${source} · ` : ''}Drag into a grid · double-click to send to the other pane · Ctrl+click to select` })}
      onMouseLeave={onTip.hide}
      className={`flex cursor-grab items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] active:cursor-grabbing ${selected ? 'bg-sky-900/40 ring-1 ring-inset ring-sky-500/70' : 'hover:bg-ink-800'}`}
    >
      <ItemThumb item={item} size={40} />
      <div className="min-w-0 flex-1">
        <div className={`truncate font-medium ${QUALITY_TEXT[d.qualityClass]}`}>
          {d.name}
          {d.name !== d.baseName && <span className="ml-1.5 font-normal text-ink-500">{d.baseName}</span>}
          {item.ethereal && <span className="ml-1.5 text-[10px] uppercase text-ink-400">eth</span>}
          {item.socketCount > 0 && <span className="ml-1.5 text-[10px] text-ink-400">{item.socketCount} os</span>}
        </div>
        {firstMod && <div className="truncate text-[11px] text-ink-400">{firstMod}</div>}
      </div>
      {d.requiredLevel > 1 && <span className="shrink-0 text-[11px] text-ink-500">lvl {d.requiredLevel}</span>}
    </li>
  );
}

/** Gold pots: one per edition + hardcore/softcore that holds gold or matches a loaded character or stash. */
function VaultGold({ docId, vault }: { docId: string; vault: Vault }) {
  const store = useStore();
  const pots = new Set(Object.keys(vault.gold).filter((k) => vault.gold[k] > 0));
  for (const e of store.docs.values()) {
    if (e.doc && e.doc.kind !== 'vault') {
      const p = store.goldPotOf(e.id);
      if (p) pots.add(p);
    }
  }
  const order = ['rotw-sc', 'rotw-hc', 'lod-sc', 'lod-hc', 'classic-sc', 'classic-hc'];
  const list = [...pots].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!list.length) return null;
  return (
    <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {list.map((pot) => (
        <GoldBar key={pot} gref={{ docId, kind: 'vault', pot }} label={`Gold (${potLabel(pot)})`} />
      ))}
    </div>
  );
}

function useItemDrag(item: D2Item, docId: string, pane: 0 | 1, name: string, onTip: ReturnType<typeof useTooltip>, source?: string) {
  const store = useStore();
  const selected = store.isSelected(item);
  return {
    selected,
    props: {
      draggable: !store.settings.readOnly,
      onDragStart: (e: React.DragEvent) => {
        startDrag(store, e, item, docId, name);
        onTip.hide();
      },
      onDragEnd: endDrag,
      onClick: (e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) store.select(docId, [item], 'toggle');
        else if (store.selection.items.size && !selected) store.clearSelection();
      },
      onDoubleClick: (e: React.MouseEvent) => (selected && store.selection.items.size > 1 ? store.quickMoveMany(store.groupFor(item, docId), docId, pane) : store.quickMove(item, docId, pane, countFor(e))),
      onMouseMove: (e: React.MouseEvent) =>
        onTip.show({ item, x: e.clientX, y: e.clientY, extra: `${source ? `From ${source} · ` : ''}Drag into a grid · double-click to send to the other pane · Ctrl+click to select` }),
      onMouseLeave: onTip.hide,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        onTip.hide();
        store.requestDelete(docId, store.groupFor(item, docId));
      },
    },
  };
}

/** A compact card, the same size as the collection tabs' slots. Stats are in the tooltip. */
function VaultCard({ item, docId, pane, source, onTip, name }: { item: D2Item; docId: string; pane: 0 | 1; source?: string; onTip: ReturnType<typeof useTooltip>; name: string }) {
  const d = desc(item);
  const { selected, props } = useItemDrag(item, docId, pane, name, onTip, source);
  const tags = [item.ethereal && 'eth', item.socketCount > 0 && `${item.socketCount}os`, d.requiredLevel > 1 && `lvl ${d.requiredLevel}`].filter(Boolean).join(' · ');
  return (
    <div
      {...props}
      aria-label={d.name}
      className={`relative flex w-[76px] cursor-grab flex-col items-center rounded-[3px] border bg-[#1a1714] px-1 pb-1 pt-1.5 text-center active:cursor-grabbing ${selected ? 'border-sky-500 ring-1 ring-sky-500/70' : 'border-ink-700 hover:border-ink-500 hover:brightness-125'}`}
    >
      <ItemThumb item={item} size={56} />
      <span className={`mt-1 line-clamp-2 text-[10px] font-medium leading-[1.15] ${QUALITY_TEXT[d.qualityClass]}`}>{d.name}</span>
      {tags && <span className="mt-0.5 text-[8.5px] leading-tight text-ink-500">{tags}</span>}
    </div>
  );
}
