import { useMemo, useState } from 'react';
import { desc, docLabel, itemKey } from '../state/store';
import { useStore } from './context';
import { QUALITY_TEXT, useTooltip } from './Tooltip';

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const tip = useTooltip();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return store
      .allItems()
      .filter(({ item }) => terms.every((t) => desc(item).search.includes(t)))
      .slice(0, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, store.rev]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-6 pt-20" onClick={onClose}>
      <div className="flex max-h-[75vh] w-full max-w-2xl flex-col rounded-lg border border-ink-600 bg-ink-900 shadow-tip" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-ink-700 p-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Search every character, stash and vault — e.g. “shako”, “+2 warlock”, “ber”, “faster cast”"
            className="w-full rounded border border-ink-600 bg-ink-950 px-3 py-2 text-[14px] text-ink-200 placeholder:text-ink-500 focus:border-gold-500 focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-auto">
          {q && !results.length && <p className="p-6 text-center text-[13px] text-ink-500">Nothing found.</p>}
          <ul className="divide-y divide-ink-800">
            {results.map(({ docId, item, where }) => {
              const d = desc(item);
              const entry = store.docs.get(docId)!;
              return (
                <li
                  key={itemKey(item)}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2 text-[13px] hover:bg-ink-800"
                  onMouseMove={(e) => tip.show({ item, x: e.clientX, y: e.clientY })}
                  onMouseLeave={tip.hide}
                  onClick={() => {
                    const tabIdx = entry.doc?.kind === 'stash' ? entry.doc.tabs.findIndex((t) => t.items.includes(item)) : 0;
                    store.showInPane(entry.doc?.kind === 'character' ? 1 : 0, docId, Math.max(0, tabIdx));
                    tip.hide();
                    onClose();
                  }}
                >
                  <span className={`min-w-0 flex-1 truncate ${QUALITY_TEXT[d.qualityClass]}`}>
                    {d.name}
                    {d.name !== d.baseName && <span className="ml-2 text-ink-500">{d.baseName}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-400">
                    {docLabel(entry.doc, entry.name)} · {where}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
