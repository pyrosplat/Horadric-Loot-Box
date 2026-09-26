import { useMemo, useState } from 'react';
import { CATEGORIES, GD, ItemFlag, Quality, canMake, collectHeld, countHeld, runeCounts, slots, type CatalogEntry, type CollectionKind, type D2Item, type Held } from '../core';
import { desc } from '../state/store';
import { endDrag, startDrag, useStore, countFor } from './context';
import { GlyphIcon, glyphFor } from './glyphs';
import { ItemFace } from './ItemArt';
import { QUALITY_TEXT, useTooltip } from './Tooltip';

const LEGACY = 'Not tracked by the game (legacy or unobtainable)';

// found/missing counts include the whole account: vault copies are lit, copies elsewhere are faded
const KIND_LABEL: Record<CollectionKind, string> = { unique: 'Uniques', set: 'Sets', runeword: 'Runewords', rune: 'Runes' };
const FOUND_BORDER: Record<CollectionKind, string> = { unique: '#b9a063', set: '#2fb82f', runeword: '#b9a063', rune: '#e38a1f' };

/** A stand-in item for a catalog entry that isn't stored, so it can show its picture and a basic tooltip. */
const phantoms = new Map<string, D2Item | undefined>();
function phantom(kind: CollectionKind, e: CatalogEntry): D2Item | undefined {
  const key = `${kind}:${e.id}`;
  if (!phantoms.has(key)) phantoms.set(key, makePhantom(kind, e));
  return phantoms.get(key);
}
function makePhantom(kind: CollectionKind, e: CatalogEntry): D2Item | undefined {
  const code = e.code;
  if (!code || !GD.items[code]) return undefined;
  return {
    saveVersion: 105, raw: new Uint8Array(0), sockets: [], flags: ItemFlag.Identified, formatVersion: 5, mode: 0, bodyLoc: 0, x: 0, y: 0, page: 4,
    code, def: GD.items[code], compact: false, identified: true, ethereal: false, socketed: false, runeword: false, itemLevel: 1,
    quality: kind === 'set' ? Quality.Set : kind === 'rune' ? Quality.Normal : Quality.Unique,
    compactRune: undefined, uniqueId: kind === 'unique' ? e.id : undefined, setId: kind === 'set' ? e.id : undefined,
    prefixes: [], suffixes: [], socketCount: 0, stats: [], setBonusStats: [], runewordStats: [], filledSockets: 0,
  } as D2Item;
}

function Pic({ item, code, size, missing }: { item?: D2Item; code?: string; size: number; missing?: boolean }) {
  const store = useStore();
  const [failed, setFailed] = useState(false);
  const src = store.showArt && !failed ? (item ? store.art?.srcFor(item) : code ? store.art?.srcForCode(code) : undefined) : undefined;
  const style = { width: size, height: size };
  if (src) return <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className={`pointer-events-none object-contain ${missing ? 'opacity-[.22] grayscale' : ''}`} style={style} />;
  if (!item) return <span style={style} />;
  const d = desc(item);
  return (
    <span className="flex items-center justify-center" style={style}>
      <GlyphIcon glyph={glyphFor(item)} className={`h-7 w-7 ${missing ? 'text-ink-600' : QUALITY_TEXT[d.qualityClass]}`} />
    </span>
  );
}

/** "2 in MainVault, 1 on ChaosSC · Personal stash" */
function summarize(copies: Held[]): string {
  const by = new Map<string, number>();
  for (const c of copies) {
    // "socketed in Enigma on ChaosSC · equipped" / "3 in RotW Shared Stash · Stackables"
    const label = c.socketedIn ? `socketed in ${c.where.replace(`${c.socketedIn} · `, `${c.socketedIn} on `)}` : `in ${c.where}`;
    by.set(label, (by.get(label) ?? 0) + (c.item.advancedStackSize ?? 1));
  }
  return [...by].map(([w, n]) => `${n} ${w}`).join(', ');
}

/** A stored item scaled into the slot, drawn like the stash grids: art (or tile) with its sockets filled. */
function Stored({ item, size }: { item: D2Item; size: number }) {
  const store = useStore();
  const w = item.def?.w ?? 1, h = item.def?.h ?? 1;
  const cell = Math.floor(size / Math.max(w, h));
  const view = store.showArt ? store.settings.itemView : 'tiles';
  return (
    <span className="flex items-center justify-center" style={{ width: size, height: size }}>
      <span className="relative" style={{ width: w * cell, height: h * cell }}>
        <ItemFace item={item} width={w * cell} height={h * cell} cell={cell} view={view === 'artNames' ? 'art' : view} art={store.art} socketPx={13} />
      </span>
    </span>
  );
}

type Slot = { entry: CatalogEntry; eth: boolean; key: string };
interface Section {
  title: string;
  entries: Slot[];
}

/**
 * Path of Exile-style collection tab: one slot for every unique, set item or runeword in the game. Stored ones
 * are lit (duplicates stack with a count); missing ones are dimmed. Drag or double-click a lit slot to take one out.
 */
export function CollectionView({ docId, pane, kind, query }: { docId: string; pane: 0 | 1; kind: CollectionKind; query: string }) {
  const store = useStore();
  const tip = useTooltip();
  const [cat, setCat] = useState<string>('All');
  const [show, setShow] = useState<'all' | 'found' | 'missing'>('all');
  const [hiMake, setHiMake] = useState(false);
  const split = kind === 'unique' && store.settings.grailEth;
  // the vault's entry list is changed in place by moves, so recompute on every store change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allHeld = store.held(docId);
  // runes socketed into items count only when "Include runes in items" is on; socketed jewels always count
  const withSocketed = kind !== 'rune' || store.settings.grailSocketed !== false;
  const held = useMemo(() => (withSocketed ? allHeld : allHeld.filter((h) => !h.socketedIn)), [allHeld, withSocketed]);
  const have = useMemo(() => collectHeld(kind, held, split), [kind, held, split]);
  const runesOwned = useMemo(() => (kind === 'runeword' ? runeCounts(held) : new Map<string, number>()), [kind, held]);
  const all = slots(kind, split, have);
  const tracked = all.filter((sl) => !sl.entry.legacy);
  const count = (key: string) => countHeld(have.get(key)?.filter((h) => !h.socketedIn));
  const inItems = (key: string) => countHeld(have.get(key)?.filter((h) => h.socketedIn));
  const makeable = (e: CatalogEntry) => kind === 'runeword' && canMake(e, runesOwned);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const visible = all.filter(({ entry: e, key, eth }) => {
    if (cat !== 'All' && e.category !== cat) return false;
    const found = have.has(key);
    if (show === 'found' && !found) return false;
    if (show === 'missing' && found) return false;
    const hay = `${e.name} ${eth ? 'ethereal eth' : ''} ${e.group ?? ''} ${e.code ? GD.items[e.code]?.name ?? '' : ''} ${(e.runes ?? []).map((r) => GD.items[r]?.name ?? '').join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });

  const sections: Section[] = [];
  const push = (title: string, sl: Slot) => {
    let s = sections.find((x) => x.title === title);
    if (!s) sections.push((s = { title, entries: [] }));
    s.entries.push(sl);
  };
  for (const sl of visible) {
    const e = sl.entry;
    if (e.legacy) push(LEGACY, sl);
    else if (kind === 'set' || kind === 'rune') push(e.group ?? KIND_LABEL[kind], sl);
    else if (e.category === 'Weapons' && e.sub) push(`Weapons · ${e.sub}`, sl);
    else push(e.category, sl);
  }
  if (kind !== 'set' && kind !== 'rune') sections.sort((a, b) => CATEGORIES.indexOf(a.title.split(' · ')[0] as never) - CATEGORIES.indexOf(b.title.split(' · ')[0] as never) || a.title.localeCompare(b.title));

  const foundAll = tracked.filter((sl) => have.has(sl.key)).length;
  // legacy copies always go last
  const li = sections.findIndex((x) => x.title === LEGACY);
  if (li >= 0) sections.push(...sections.splice(li, 1));
  const cats = kind === 'rune' ? [] : ['All', ...CATEGORIES.filter((c) => all.some((sl) => sl.entry.category === c))];
  const pct = tracked.length ? Math.round((foundAll / tracked.length) * 100) : 0;
  const cellW = 76, img = 46;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mt-2 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full rounded-full bg-gradient-to-r from-[#8a6d2f] to-[#d9b86a]" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-[12.5px] text-ink-300">
          <span className="font-semibold text-gold-300">{foundAll}</span> / {tracked.length} {KIND_LABEL[kind].toLowerCase()} found · {pct}%
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {cats.map((c) => {
          const inCat = c === 'All' ? tracked : tracked.filter((sl) => sl.entry.category === c);
          const f = inCat.filter((sl) => have.has(sl.key)).length;
          return (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded border px-2 py-0.5 text-[11px] ${cat === c ? 'border-gold-500 bg-gold-600/15 text-gold-300' : 'border-ink-700 text-ink-400 hover:text-ink-200'}`}
            >
              {c} <span className="text-ink-500">{f}/{inCat.length}</span>
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-1">
          {kind === 'runeword' && (
            <button
              onClick={() => setHiMake(!hiMake)}
              aria-pressed={hiMake}
              className={`mr-1 rounded-full border px-2.5 py-0.5 text-[11px] ${hiMake ? 'border-emerald-500 bg-emerald-900/30 text-emerald-200' : 'border-ink-600 text-ink-400 hover:text-ink-200'}`}
              title="Highlight runewords you have the loose runes for (vaults, stashes and characters): missing ones glow green, ones you've already made get a green ring"
            >
              Highlight makeable {all.filter((sl) => !sl.eth && makeable(sl.entry)).length}
            </button>
          )}
          {kind === 'rune' && (
            <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-300" title="Count runes socketed into items (runewords and socketed gear) anywhere on the account">
              <input type="checkbox" className="accent-[#9ab8d8]" checked={withSocketed} onChange={(e) => store.setSettings({ grailSocketed: e.target.checked })} />
              Include runes in items
            </label>
          )}
          {kind === 'unique' && (
            <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-300" title="Give every item that can be ethereal a second slot for its ethereal copy">
              <input type="checkbox" className="accent-[#9ab8d8]" checked={store.settings.grailEth} onChange={(e) => store.setSettings({ grailEth: e.target.checked })} />
              Track ethereal separately
            </label>
          )}
          {(['all', 'found', 'missing'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setShow(s)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] capitalize ${show === s ? 'border-sky-500 bg-sky-900/30 text-sky-200' : 'border-ink-600 text-ink-400 hover:text-ink-200'}`}
            >
              {s}
            </button>
          ))}
        </span>
      </div>
      <div className="mt-2 flex-1 overflow-auto rounded border border-[#2b2b2b] bg-[radial-gradient(ellipse_at_top,#1b1712,#0e0d0c_70%)] p-3">
        {sections.length === 0 && <p className="p-6 text-center text-[13px] text-ink-500">Nothing matches.</p>}
        {sections.map((s) => {
          const legacy = s.title === LEGACY;
          const f = s.entries.filter((sl) => have.has(sl.key)).length;
          const complete = kind === 'set' && !legacy && f === s.entries.length;
          return (
            <section key={s.title} className="mb-4">
              <h4 className="mb-1.5 flex items-baseline gap-2 border-b border-[#2e2a22] pb-1 font-display text-[11px] uppercase tracking-[.18em] text-[#a8956a]">
                <span className={complete ? 'text-q-set' : ''}>{s.title}</span>
                <span className="font-body text-[11px] normal-case tracking-normal text-ink-500">
                  {legacy ? `${f} stored · not counted` : `${f}/${s.entries.length}`}
                  {complete && ' · complete'}
                </span>
              </h4>
              <div className={`flex flex-wrap ${hiMake && kind === 'runeword' ? 'gap-x-2 gap-y-3.5 p-1' : 'gap-1.5'}`}>
                {s.entries.map(({ entry: e, eth, key }) => {
                  const copies = have.get(key) ?? [];
                  const n = count(key);
                  const nItems = inItems(key);
                  const found = copies.length > 0;
                  // only loose copies inside this vault can be moved from here
                  const inVault = copies.filter((c) => c.inVault && !c.socketedIn);
                  const elsewhere = found && !inVault.length;
                  // shown: the best copy anywhere; usable here: only copies inside this vault
                  const first = copies[0]?.item;
                  const usable = inVault[0]?.item;
                  const from = docId;
                  const canCraft = hiMake && makeable(e);
                  const where = summarize(copies);
                  const shownItem = first ?? phantom(kind, e);
                  const color = kind === 'set' ? 'text-q-set' : 'text-q-unique';
                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${eth ? 'Ethereal ' : ''}${e.name}${found ? ` × ${n}` : ' (missing)'}`}
                      draggable={!!usable && !store.settings.readOnly}
                      onDragStart={(ev) => {
                        if (!usable) return ev.preventDefault();
                        startDrag(store, ev, usable, from, e.name);
                        tip.hide();
                      }}
                      onDragEnd={endDrag}
                      onDoubleClick={(ev) => usable && !store.settings.readOnly && store.quickMove(usable, from, pane, countFor(ev))}
                      onContextMenu={(ev) => {
                        ev.preventDefault();
                        if (!usable) return;
                        tip.hide();
                        store.requestDelete(from, [usable]);
                      }}
                      onMouseMove={(ev) =>
                        shownItem
                          ? tip.show({
                              item: shownItem,
                              x: ev.clientX,
                              y: ev.clientY,
                              extra: found
                                ? `${where}${eth ? ' (ethereal)' : ''} · ${
                                    usable ? 'drag or double-click to move one out of the vault · right-click to delete one' : 'not in this vault: move it from where it is'
                                  }${canCraft ? ' · you have the runes to make another' : ''}`
                                : `${eth ? 'No ethereal copy' : 'Not found'} on this account yet${canCraft ? ' · you have the runes to make it' : ''}`,
                            })
                          : undefined
                      }
                      onMouseLeave={tip.hide}
                      title={
                        !shownItem
                          ? `${e.name} — ${(e.runes ?? []).map((r) => GD.items[r]?.name.replace(/ Rune$/, '')).join(' + ')}${found ? ` · ${where}` : canCraft ? ' · you have the runes to make it' : ' (missing)'}`
                          : undefined
                      }
                      className={`relative flex flex-col items-center rounded-[3px] border px-1 pb-1 pt-1.5 text-center transition ${
                        found
                          ? elsewhere
                            ? 'cursor-default border-dashed bg-[#17150f] [&>*]:opacity-[.55]'
                            : 'cursor-grab bg-[#1f1b14] hover:brightness-125 active:cursor-grabbing'
                          : canCraft
                            ? 'cursor-default border-emerald-600/80 bg-emerald-950/30 shadow-[0_0_10px_rgba(16,185,129,.25)]'
                            : 'cursor-default border-dashed border-[#2d2b27] bg-[#121110]'
                      } ${found && canCraft ? 'outline outline-2 outline-offset-2 outline-emerald-500/90 shadow-[0_0_12px_rgba(16,185,129,.45)]' : ''}`}
                      style={{ width: cellW, borderColor: found ? FOUND_BORDER[kind] : undefined }}
                    >
                      {kind === 'runeword' && !first ? (
                        <span className="flex h-[46px] items-center justify-center gap-[1px]">
                          {(e.runes ?? []).slice(0, 4).map((r, i) => (
                            <Pic key={i} code={r} size={e.runes!.length > 3 ? 16 : 20} missing={!canCraft} />
                          ))}
                        </span>
                      ) : (
                        first ? <Stored item={first} size={img + 10} /> : <Pic item={shownItem} size={img} missing />
                      )}
                      <span className={`mt-1 line-clamp-2 text-[10px] font-medium leading-[1.15] ${found ? color : 'text-ink-500'}`}>{e.name}</span>
                      {kind === 'runeword' && (
                        <span className={`mt-0.5 text-[8.5px] leading-tight ${found || canCraft ? 'text-q-rune' : 'text-ink-600'}`}>
                          {(e.runes ?? []).map((r) => GD.items[r]?.name.replace(/ Rune$/, '')).join(' ')}
                        </span>
                      )}
                      {n > 1 && <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px] font-bold leading-[14px] text-white !opacity-100">×{n}</span>}
                      {nItems > 0 && (
                        <span className="mt-0.5 text-[9px] leading-tight text-sky-300 !opacity-100" title={where}>
                          {nItems} in item{nItems > 1 ? 's' : ''}
                        </span>
                      )}
                      {elsewhere && (
                        <span className="absolute left-1 top-1 rounded bg-sky-900/90 px-1 text-[8px] font-bold uppercase leading-[12px] tracking-wide text-sky-100 !opacity-100" title={where}>
                          {copies.every((c) => c.socketedIn)
                            ? 'in item'
                            : store.docs.get(copies[0].docId)?.doc?.kind === 'character'
                              ? 'on char'
                              : copies[0].where.startsWith('Vault ')
                                ? 'vault'
                                : 'stash'}
                        </span>
                      )}
                      {canCraft && found && (
                        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-emerald-700 px-1 text-[8px] font-bold uppercase leading-[12px] text-white !opacity-100">can make</span>
                      )}
                      {canCraft && !found && (
                        <span className="absolute left-1 top-1 rounded bg-emerald-700/90 px-1 text-[8px] font-bold uppercase leading-[12px] text-white">can make</span>
                      )}
                      {eth && (
                        <span className={`absolute left-1 top-1 rounded px-1 text-[8.5px] font-bold uppercase leading-[13px] ${found ? 'bg-[#3a4a5a] text-[#cfe3ff]' : 'bg-[#1c2229] text-[#5d6b78]'}`}>eth</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
