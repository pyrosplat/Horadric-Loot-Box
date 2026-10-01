import { useEffect, useRef, useState } from 'react';
import type { GoldRef } from '../state/store';
import { useStore } from './context';

export const fmtGold = (n: number) => n.toLocaleString();

/** Picks the natural transfer partner: whatever the other pane shows, else the first vault. */
function defaultTarget(store: ReturnType<typeof useStore>, targets: GoldRef[], self: GoldRef): GoldRef | undefined {
  const selfPane = store.panes.findIndex((p) => p.docId === self.docId);
  const other = store.panes[selfPane === 0 ? 1 : 0];
  const od = other?.docId ? store.docs.get(other.docId)?.doc : undefined;
  const pick = (f: (r: GoldRef) => boolean) => targets.find(f);
  if (od && other.docId !== self.docId) {
    const hit =
      od.kind === 'vault'
        ? pick((r) => r.docId === other.docId)
        : od.kind === 'character'
          ? pick((r) => r.docId === other.docId && r.kind === 'stash')
          : pick((r) => r.docId === other.docId && r.kind === 'shared' && r.tab === other.tab) ?? pick((r) => r.docId === other.docId);
    if (hit) return hit;
  }
  return pick((r) => r.kind === 'vault') ?? targets[0];
}

/**
 * Gold held by one container, plus a transfer popover to move gold to or from any
 * compatible place (same edition and hardcore/softcore).
 */
export function GoldBar({ gref, label }: { gref: GoldRef; label: string }) {
  const store = useStore();
  const value = store.goldOf(gref);
  const cap = store.goldCap(gref);
  const [open, setOpen] = useState(false);
  const key = (r: GoldRef) => JSON.stringify(r);
  // Only nearby places: the other spot on this character, whatever the other pane shows, and vaults.
  const selfPane = store.panes.findIndex((p) => p.docId === gref.docId);
  const otherPane = store.panes[selfPane === 0 ? 1 : 0];
  const targets = store.goldTargets(gref).filter(
    (t) =>
      t.docId === gref.docId ||
      store.docs.get(t.docId)?.doc?.kind === 'vault' ||
      (t.docId === otherPane?.docId && (t.kind !== 'shared' || t.tab === otherPane.tab)),
  );
  const [target, setTarget] = useState<string>('');
  const [amount, setAmount] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = defaultTarget(store, targets, gref);
    setTarget(t ? key(t) : '');
    setAmount('');
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const other = targets.find((t) => key(t) === target);
  const typed = Math.floor(Number(amount.replace(/[, ]/g, '')) || 0);
  const vault = gref.kind === 'vault';
  const ro = store.settings.readOnly;
  const short = (t: GoldRef) => (t.docId === gref.docId ? (t.kind === 'inventory' ? 'Inventory' : t.kind === 'stash' ? 'Stash' : store.goldLabel(t)) : store.goldLabel(t));
  // an empty amount means "as much as possible"
  const sendN = other ? Math.min(typed || value, value, store.goldCap(other) - store.goldOf(other)) : 0;
  const takeN = other ? Math.min(typed || store.goldOf(other), store.goldOf(other), cap - value) : 0;
  const move = (from: GoldRef, to: GoldRef, n: number) => n > 0 && store.transferGold(from, to, n) && setOpen(false);
  return (
    <div ref={box} className="relative flex text-[12px] text-ink-400">
      <div className="inline-flex items-stretch overflow-hidden rounded border border-ink-600 bg-ink-950/60">
      <span className="px-2 py-[3px]">
        {label} <span className="tabular-nums text-ink-200">{fmtGold(value)}</span>
        {!vault && <span className="text-ink-500"> / {fmtGold(cap)}</span>}
      </span>
      {store.goldTransfers && (
        <button
          className="border-l border-ink-600 px-2 py-[3px] text-[11px] text-ink-300 hover:bg-ink-800 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setOpen((o) => !o)}
          disabled={ro || !targets.length}
          title={ro ? 'Read-only mode is on' : targets.length ? 'Move gold' : 'Open a character, stash or vault of the same edition on the other side, or add a vault'}
        >
          Transfer
        </button>
      )}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-[#5a4520] bg-ink-900 p-3 shadow-tip">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Move gold with">
            {targets.map((t) => {
              const on = key(t) === target;
              return (
                <button
                  key={key(t)}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTarget(key(t))}
                  className={`max-w-full truncate rounded border px-2 py-1 text-left text-[11.5px] ${on ? 'border-gold-500 bg-gold-600/15 text-gold-200' : 'border-ink-600 text-ink-300 hover:bg-ink-800'}`}
                >
                  {short(t)} <span className="tabular-nums text-ink-500">{fmtGold(store.goldOf(t))}</span>
                </button>
              );
            })}
          </div>
          <input
            autoFocus
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && other && move(gref, other, sendN)}
            placeholder="Amount (leave empty for all)"
            className="mt-2.5 w-full rounded border border-ink-600 bg-ink-950 px-2 py-1 text-[13px] tabular-nums text-ink-100 placeholder:text-[12px] placeholder:text-ink-600 focus:border-gold-500 focus:outline-none"
          />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              disabled={sendN <= 0}
              onClick={() => other && move(gref, other, sendN)}
              className="rounded bg-gold-500 px-2 py-1.5 text-[12px] font-semibold text-ink-950 hover:bg-gold-400 disabled:bg-ink-700 disabled:text-ink-400"
            >
              Send {fmtGold(Math.max(0, sendN))} →
            </button>
            <button
              disabled={takeN <= 0}
              onClick={() => other && move(other, gref, takeN)}
              className="rounded border border-gold-600/70 px-2 py-1.5 text-[12px] font-semibold text-gold-300 hover:bg-gold-600/10 disabled:border-ink-700 disabled:text-ink-500"
            >
              ← Take {fmtGold(Math.max(0, takeN))}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
