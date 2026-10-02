import { useState } from 'react';
import { tradeLineText, tradeLogText } from '../state/tradeLog';
import { useStore } from '../ui/context';

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

/** The trades you've made: what you got and what you paid. Kept in this app (or browser), never sent anywhere. */
export function TradeHistory() {
  const store = useStore();
  const log = store.tradeLog;
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const small = 'rounded px-2 py-0.5 text-[11.5px] text-ink-400 hover:text-ink-200';
  return (
    <section className="rounded-md border border-[#2e2e2e] bg-[#161616] p-3">
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1.5 font-display text-[10.5px] uppercase tracking-[.22em] text-[#8a8a8a] hover:text-ink-200" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="text-[9px]">{open ? '▼' : '▶'}</span> History{log.length ? ` (${log.length})` : ''}
        </button>
        {open && log.length > 0 && (
          <span className="ml-auto flex items-center">
            <button
              className={small}
              onClick={() =>
                void navigator.clipboard?.writeText(tradeLogText(log)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            {confirm ? (
              <>
                <button className="rounded px-2 py-0.5 text-[11.5px] text-red-300 hover:text-red-200" onClick={() => (store.tradeLogClear(), setConfirm(false))}>
                  Clear all {log.length}?
                </button>
                <button className={small} onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button className={small} onClick={() => setConfirm(true)}>
                Clear history
              </button>
            )}
          </span>
        )}
      </div>
      {open &&
        (log.length ? (
          <ul className="mt-2 max-h-[260px] space-y-1 overflow-y-auto pr-1">
            {log.map((e) => (
              <li key={e.id} className="group flex items-baseline gap-2 rounded bg-ink-900/60 px-2 py-1 text-[12px]">
                <span className="w-[118px] shrink-0 text-[11px] text-ink-500" title={`${e.mode} · ${e.file}`}>
                  {when(e.at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink-400">{e.side === 'sell' ? 'Sold' : 'Got'} </span>
                  <span className="text-ink-100">{tradeLineText(e.side === 'sell' ? e.paid : e.got)}</span>
                  <span className="text-ink-400"> for </span>
                  <span className="text-gold-300">{tradeLineText(e.side === 'sell' ? e.got : e.paid)}</span>
                  {e.mode === 'hardcore' && <span className="ml-1.5 text-[10.5px] text-red-300">hardcore</span>}
                  {!e.saved && (
                    <span className="ml-1.5 text-[10.5px] text-amber-300" title="Trades are kept once you save. Undo takes this one back.">
                      not saved yet
                    </span>
                  )}
                </span>
                {e.saved && (
                  <button className="shrink-0 px-1 text-ink-500 opacity-0 hover:text-red-300 focus:opacity-100 group-hover:opacity-100" title="Remove from the history" aria-label="Remove from the history" onClick={() => store.tradeLogRemove(e.id)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12px] text-ink-500">Trades you make are listed here once you save: what you got and what you paid. The list stays on this {store.platform.id === 'tauri' ? 'computer' : 'browser'}.</p>
        ))}
    </section>
  );
}
