import { useState } from 'react';
import { UBER_CODES, itemName } from '../core';
import { TRADE_ID, TRADE_OFFER_ID, docLabel } from '../state/store';
import { countFor, drag, dropDragged, endDrag, startDrag, useStore } from '../ui/context';
import { ItemThumb } from '../ui/ItemArt';
import { useTooltip } from '../ui/Tooltip';
import { isTradeable, nameOf } from './goods';
import { AskLine, ScreenshotImport } from './ScreenshotImport';
import { TradeGrid, displayItem, type GridEntry } from './TradeGrid';
import { TradeHistory } from './TradeHistory';
import { isTauri } from '../platform/tauri';

const TRADERIE = 'https://traderie.com/diablo2resurrected';

/** Tile labels for uber items (the full name is in the tooltip). */
const UBER_SHORT: Record<string, string> = {
  pk1: 'Terror', pk2: 'Hate', pk3: 'Destruction', dhn: 'Horn', bey: 'Eye', mbr: 'Brain', toa: 'Token',
  tes: 'Twisted', ceh: 'Charged', bet: 'Burning', fed: 'Festering', xa1: 'West', xa2: 'East', xa3: 'South', xa4: 'Deep', xa5: 'North',
};
/** Tile label colours by quality (magic, set, rare, unique, crafted). */
const QUALITY_TEXT: Record<number, string> = { 4: 'text-q-magic', 5: 'text-q-set', 6: 'text-q-rare', 7: 'text-q-unique', 8: 'text-q-crafted' };
const short = (code: string) => UBER_SHORT[code] ?? nameOf(code).replace(/ Rune$/, '');

/** Items you traded for, waiting to be dragged into a stash, character or vault. */
function Received() {
  const store = useStore();
  const tip = useTooltip();
  const items = store.tradeReceived;
  const pane = store.panes.findIndex((p) => p.docId === TRADE_ID) as 0 | 1;
  const other = store.tradeDocId();
  const otherName = other ? docLabel(store.docs.get(other)?.doc, store.docs.get(other)?.name ?? '') : undefined;
  // runes and gems of a kind share a tile; every unique or set item gets its own
  const groups = new Map<string, typeof items>();
  items.forEach((it, i) => {
    const k = it.compact || UBER_CODES.includes(it.code) ? it.code : `#${i}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  });
  return (
    <section className={`rounded-md border p-3 ${items.length ? 'border-emerald-700/70 bg-emerald-950/20' : 'border-[#2e2e2e] bg-[#161616]'}`}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-display text-[10.5px] uppercase tracking-[.22em] text-[#8a8a8a]">Received</h3>
        {items.length > 0 && otherName && (
          <button className="ml-auto rounded border border-emerald-700 px-2.5 py-0.5 text-[11.5px] text-emerald-200 hover:bg-emerald-900/40" onClick={() => store.tradeDeliverAll()}>
            Move all to {otherName}
          </button>
        )}
      </div>
      {items.length ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {[...groups].map(([key, list]) => {
              const it = list[0];
              const label = it.compact || UBER_CODES.includes(it.code) ? short(it.code) : itemName(it);
              return (
                <div
                  key={key}
                  draggable
                  onDragStart={(e) => (startDrag(store, e, it, TRADE_ID, label), tip.hide())}
                  onDragEnd={endDrag}
                  onDoubleClick={(e) => store.quickMove(it, TRADE_ID, pane, countFor(e))}
                  onMouseMove={(e) => tip.show({ item: it, x: e.clientX, y: e.clientY, extra: `Drag into ${store.tradeDestination} (Shift for 3) · double-click to send to the other side` })}
                  onMouseLeave={tip.hide}
                  className="relative flex w-[56px] cursor-grab flex-col items-center rounded-[3px] border border-emerald-700/70 bg-ink-900 px-0.5 pb-0.5 pt-1 active:cursor-grabbing"
                >
                  <ItemThumb item={it} size={32} />
                  <span className={`mt-0.5 w-full truncate text-center text-[9px] ${it.runeword ? 'text-q-runeword' : QUALITY_TEXT[it.compact ? 2 : it.quality] ?? 'text-ink-200'}`}>{label}</span>
                  {list.length > 1 && <span className="absolute right-0.5 top-0 rounded bg-black/80 px-1 text-[9px] font-bold text-white">×{list.length}</span>}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-ink-500">Drag them where you want them (Shift for 3), double-click to send to the other side, or move them all at once. Save is blocked until this box is empty.</p>
        </>
      ) : (
        <p className="text-[12px] text-ink-500">Items you trade for show up here, ready to drag into {store.tradeDestination}.</p>
      )}
    </section>
  );
}

/**
 * The Trade panel (Settings → Trade): import a Traderie listing from a screenshot, drag in what it's trading
 * for from the file on the other side, and accept. What you get waits in Received.
 */
export function TradeView() {
  const store = useStore();
  const [over, setOver] = useState(false);
  const docId = store.tradeDocId();
  const entry = docId ? store.docs.get(docId) : undefined;
  const problem = store.tradeProblem(docId);
  const { want, offer, items, ask, side, receive, pick } = store.trade;
  const selling = side === 'sell';
  const wanting = want.size > 0 || items.length > 0 || !!receive;
  const matched = store.tradeAskMatch();
  const other = entry ? docLabel(entry.doc, entry.name) : 'the other side';

  const wantEntries: GridEntry[] = [
    ...[...want].map(([code, n]) => ({ key: `c:${code}`, item: displayItem(code), count: n, tip: `${n}× ${nameOf(code)} from the listing · right-click to remove the listing`, onRemove: () => store.tradeClear() })),
    ...items.map((w) => ({ key: w.key, item: w.item, tip: 'From the listing · right-click to remove the listing', onRemove: () => store.tradeClear() })),
  ];
  // runes, gems and uber items share a tile per kind; items you offer (a Shako, the pieces of a set) each get their own
  const offered = store.tradeOffered;
  const stackable = (i: (typeof offered)[number]) => isTradeable(i.code) && (i.compact || UBER_CODES.includes(i.code));
  const offerEntries: GridEntry[] = [
    ...[...offer]
      .filter(([code]) => offered.some((i) => i.code === code && stackable(i)))
      .map(([code, n]) => ({
        key: `o:${code}`,
        item: offered.find((i) => i.code === code) ?? displayItem(code),
        count: n,
        dragFrom: TRADE_OFFER_ID,
        tip: `${n}× ${nameOf(code)} offered · right-click or drag back to take one back (Shift for 3)`,
        onRemove: (k: number) => store.tradeOffer(code, -k),
      })),
    ...offered
      .filter((i) => !stackable(i))
      .map((i, k) => ({ key: `i:${k}:${i.id}`, item: i, dragFrom: TRADE_OFFER_ID, tip: `${itemName(i)} offered · right-click or drag back to take it back`, onRemove: () => void store.tradeReturnItem(i) })),
  ];
  const canDrop = () => !!drag.item && drag.fromDocId === docId && (isTradeable(drag.item.code) || store.tradeAsksItems);

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-lg font-semibold text-gold-300">Trade</h2>
        <div className="flex self-center overflow-hidden rounded border border-gold-600/60 text-[12px]" role="group" aria-label="Buy or sell">
          {(['buy', 'sell'] as const).map((s2) => (
            <button
              key={s2}
              aria-pressed={side === s2}
              onClick={() => store.tradeSetSide(s2)}
              className={`px-3 py-0.5 ${side === s2 ? 'bg-gold-600/80 font-semibold text-black' : 'text-ink-300 hover:text-ink-100'}`}
            >
              {s2 === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>
        <a
          href={TRADERIE}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            // the desktop app opens it in the player's browser
            if (isTauri()) (e.preventDefault(), void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(TRADERIE)));
          }}
          className="self-center text-[12px] text-gold-400 hover:text-gold-300"
          title="Find listings on Traderie, then paste a screenshot below"
        >
          Traderie ↗
        </a>
        {entry && !problem && <span className="ml-auto text-[12px] text-ink-400">Paying from and delivering to <span className="text-ink-200">{docLabel(entry.doc, entry.name)}</span></span>}
      </div>
      {problem && <p className="rounded border border-amber-800 bg-amber-900/20 px-3 py-2 text-[12.5px] text-amber-200">{problem}</p>}

      <ScreenshotImport />

      {selling ? (
        <section className="rounded-md border border-[#2e2e2e] bg-[#161616] p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-display text-[10.5px] uppercase tracking-[.22em] text-[#8a8a8a]">Selling to a buyer</h3>
            {store.trade.listing && <span className="truncate text-[12px] text-ink-300">{store.trade.listing}</span>}
          </div>
          {ask && receive ? (
            <div className="space-y-2">
              <AskLine ask={ask} matched={matched >= 0 ? matched : undefined} label="They want:" />
              <AskLine ask={receive} picked={pick} onPick={(i) => store.tradePick(i)} label="You get:" />
              <p className="text-[11px] text-ink-500">
                {receive.length > 1 ? 'Click the option you want to get. ' : ''}Rolls the listing shows are minimums; anything it doesn&rsquo;t show can be any roll.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-ink-500">Import a buyer&rsquo;s listing above (&ldquo;They Give&rdquo; / &ldquo;I Give&rdquo;) to sell them an item, runes or gems at their price.</p>
          )}
        </section>
      ) : (
        <section className="rounded-md border border-[#2e2e2e] bg-[#161616] p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-display text-[10.5px] uppercase tracking-[.22em] text-[#8a8a8a]">You want</h3>
            {store.trade.listing && <span className="truncate text-[12px] text-ink-300">{store.trade.listing}</span>}
          </div>
          <TradeGrid entries={wantEntries} empty="Import a Traderie listing above to see what you get here." />
          {ask && (
            <div className="mt-2">
              <AskLine ask={ask} matched={matched >= 0 ? matched : undefined} />
            </div>
          )}
        </section>
      )}

      <section
        className={`rounded-md border p-3 ${over ? 'border-gold-400 bg-gold-600/10' : 'border-[#2e2e2e] bg-[#161616]'}`}
        onDragOver={(e) => {
          if (!canDrop()) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (canDrop()) dropDragged(store, { docId: TRADE_OFFER_ID, area: 'vault' });
        }}
      >
        <h3 className="mb-2 font-display text-[10.5px] uppercase tracking-[.22em] text-[#8a8a8a]">Your offer</h3>
        <TradeGrid
          entries={offerEntries}
          empty={
            problem
              ? ''
              : store.tradeAsksItems
                ? `Drag what ${selling ? 'the buyer wants' : 'the listing asks for'} here from ${other} (Shift for 3 runes or gems). It leaves ${other} until you trade or take it back.`
                : `Drag runes, gems, keys and parts here from ${other} (Shift for 3). They leave ${other} until you trade or take them back.`
          }
        />
      </section>

      <div className="rounded-md border border-[#2e2e2e] bg-[#161616] p-3">
        <div className="flex items-center gap-2">
          <span className={`text-[12px] ${matched >= 0 ? 'text-emerald-300' : 'text-ink-400'}`}>
            {!wanting || !ask
              ? 'Import a listing to start a trade.'
              : matched >= 0
                ? selling
                  ? 'Your offer is what the buyer wants.'
                  : 'Your offer is what the listing asks for.'
                : offered.length
                  ? selling
                    ? 'Your offer has to be exactly what the buyer wants (at least the rolls the listing shows).'
                    : 'Your offer has to be exactly one of the options the listing asks for.'
                  : selling
                    ? 'Drag what the buyer wants into your offer.'
                    : 'Drag what the listing asks for into your offer.'}
          </span>
          <button className="ml-auto rounded px-3 py-1.5 text-[12.5px] text-ink-400 hover:text-ink-200" onClick={() => store.tradeClear()}>
            Clear
          </button>
          <button
            disabled={matched < 0 || !!problem}
            onClick={() => store.tradeAccept()}
            className="rounded bg-emerald-700 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:bg-ink-700 disabled:text-ink-400"
          >
            {selling ? 'Sell' : 'Accept trade'}
          </button>
        </div>
      </div>

      <Received />
      <TradeHistory />
    </div>
  );
}
