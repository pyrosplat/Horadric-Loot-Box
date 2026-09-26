import { useState } from 'react';
import type { D2Character, D2SharedStash } from '../core';
import { docLabel, type LoadedDoc } from '../state/store';
import { vaultNameProblem, type Vault } from '../core';
import { useStore, docDrag } from './context';

export function Sidebar() {
  const store = useStore();
  const [naming, setNaming] = useState(false);
  const docs = [...store.docs.values()];
  const chars = docs.filter((d) => d.doc?.kind === 'character' || (d.error && d.name.endsWith('.d2s')));
  const stashes = docs.filter((d) => d.doc?.kind === 'stash' || (d.error && d.name.endsWith('.d2i')));
  const vaults = docs.filter((d) => d.doc?.kind === 'vault' || d.name.endsWith('.hlb.json') || d.name.endsWith('.hvault.json'));
  const rotw = chars.filter((c) => (c.doc as D2Character | undefined)?.gameVersion === 3);
  const other = chars.filter((c) => !rotw.includes(c));

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink-800 bg-ink-900/60 p-3">
      <Section title="Vaults" action={<button className="text-[11px] text-gold-400 hover:text-gold-300" onClick={() => setNaming(true)}>+ New</button>}>
        {naming && <NewVault onDone={() => setNaming(false)} />}
        {vaults.map((d) => (
          <VaultRow key={d.id} d={d} />
        ))}
      </Section>
      <Section title="Shared stashes">
        {stashes.map((d) => {
          const s = d.doc as D2SharedStash | undefined;
          return <Row key={d.id} d={d} sub={s ? `${s.tabs.length} tabs · ${s.tabs.reduce((n, t) => n + t.items.length, 0)} items` : ''} />;
        })}
        {!stashes.length && <p className="px-2 text-[12px] text-ink-500">None found</p>}
      </Section>
      {rotw.length > 0 && (
        <Section title="Reign of the Warlock">
          {rotw.map((d) => (
            <CharRow key={d.id} d={d} />
          ))}
        </Section>
      )}
      {(other.length > 0 || !chars.length) && (
        <Section title={rotw.length ? 'Other characters' : 'Characters'}>
          {other.map((d) => (
            <CharRow key={d.id} d={d} />
          ))}
          {!chars.length && <p className="px-2 text-[12px] text-ink-500">None found</p>}
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-2">
        <h2 className="font-display text-[10.5px] uppercase tracking-[.2em] text-ink-500">{title}</h2>
        {action}
      </div>
      <div className="space-y-[1px]">{children}</div>
    </div>
  );
}

function CharRow({ d }: { d: LoadedDoc }) {
  const c = d.doc as D2Character | undefined;
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Row
        d={d}
        sub={c ? `${c.level} ${c.className}${c.hardcore ? ' · HC' : ''}` : ''}
        extra={c ? <BinButton label={`Delete ${c.name}`} onClick={() => setConfirm(true)} /> : null}
      />
      {confirm && c && <DeleteCharacter docId={d.id} name={c.name} onClose={() => setConfirm(false)} />}
    </>
  );
}

function DeleteCharacter({ docId, name, onClose }: { docId: string; name: string; onClose: () => void }) {
  const store = useStore();
  return (
    <ConfirmDelete
      name={name}
      title={`Delete ${name}?`}
      body="This removes the character and everything it carries, wears and stashes from your save folder (the .d2s and the game's companion files). The game won't show it any more and this can't be undone in the app."
      blocker={store.deleteBlocker(docId)}
      onConfirm={(typed) => store.deleteCharacter(docId, typed)}
      onClose={onClose}
    />
  );
}

function DeleteVault({ docId, onClose }: { docId: string; onClose: () => void }) {
  const store = useStore();
  const v = store.docs.get(docId)?.doc as Vault | undefined;
  if (!v) return null;
  const gold = Object.values(v.gold ?? {}).reduce((a, b) => a + b, 0);
  const what = [v.entries.length ? `${v.entries.length} item${v.entries.length === 1 ? '' : 's'}` : '', gold ? `${gold.toLocaleString()} gold` : ''].filter(Boolean).join(' and ');
  return (
    <ConfirmDelete
      name={v.name}
      title={`Delete vault ${v.name}?`}
      body={`This deletes the vault${what ? ` and the ${what} in it` : ''}. It can't be undone in the app. Move anything you want to keep out first.`}
      blocker={store.vaultDeleteBlocker(docId)}
      onConfirm={(typed) => store.deleteVault(docId, typed)}
      onClose={onClose}
    />
  );
}

function ConfirmDelete({ name, title, body, blocker, onConfirm, onClose }: { name: string; title: string; body: string; blocker?: string; onConfirm: (typed: string) => Promise<boolean>; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const match = typed.trim().toLowerCase() === name.toLowerCase();
  const go = async () => {
    setBusy(true);
    const ok = await onConfirm(typed);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div role="dialog" aria-label={title} className="w-full max-w-md rounded-lg border border-red-900 bg-ink-900 p-6 shadow-tip" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-red-300">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{body}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-500">A copy is kept in the app's backups folder (Settings → Open backups folder), which you can delete yourself.</p>
        {blocker ? (
          <p className="mt-4 rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-[12.5px] text-amber-200">{blocker}</p>
        ) : (
          <>
            <label className="mt-4 block text-[12px] text-ink-300">
              Type <span className="font-semibold text-ink-100">{name}</span> to confirm
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && match && !busy && go()}
              className="mt-1 w-full rounded border border-ink-600 bg-ink-950 px-2 py-1.5 text-[14px] text-ink-100 focus:border-red-500 focus:outline-none"
              spellCheck={false}
              autoComplete="off"
            />
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded px-3 py-1.5 text-[13px] text-ink-300 hover:bg-ink-800" onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={!!blocker || !match || busy}
            onClick={go}
            className="rounded bg-red-700 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BinButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      title={`${label}…`}
      aria-label={label}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded border border-transparent text-ink-500 hover:border-red-800 hover:text-red-300"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
      </svg>
    </button>
  );
}

function VaultRow({ d }: { d: LoadedDoc }) {
  const [confirm, setConfirm] = useState(false);
  const v = d.doc?.kind === 'vault' ? d.doc : undefined;
  return (
    <>
      <Row d={d} sub={v ? `${v.entries.length} items` : ''} extra={v ? <BinButton label={`Delete vault ${v.name}`} onClick={() => setConfirm(true)} /> : null} />
      {confirm && <DeleteVault docId={d.id} onClose={() => setConfirm(false)} />}
    </>
  );
}

function Row({ d, sub, extra }: { d: LoadedDoc; sub: string; extra?: React.ReactNode }) {
  const store = useStore();
  const inLeft = store.panes[0].docId === d.id;
  const inRight = store.panes[1].docId === d.id;
  const defaultPane: 0 | 1 = d.doc?.kind === 'character' ? 1 : 0;
  const [dragging, setDragging] = useState(false);
  return (
    <div
      draggable={!!d.doc}
      onDragStart={(e) => {
        docDrag.id = d.id;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', docLabel(d.doc, d.name));
        setDragging(true);
      }}
      onDragEnd={() => {
        docDrag.id = undefined;
        setDragging(false);
        store.emit();
      }}
      className={`group flex cursor-grab items-center gap-1 rounded px-2 py-1.5 active:cursor-grabbing ${dragging ? 'opacity-50' : ''} ${inLeft || inRight ? 'bg-ink-800' : 'hover:bg-ink-850'}`}
    >
      <button className="min-w-0 flex-1 text-left" onClick={() => store.showInPane(defaultPane, d.id)} title={d.error ?? `${d.path}\nDrag onto the left or right side to open it there`}>
        <div className={`truncate text-[13px] ${d.error ? 'text-red-300' : 'text-ink-200'}`}>
          {docLabel(d.doc, d.name)}
          {d.dirty && <span className="ml-1 text-gold-400" title="Unsaved changes">•</span>}
        </div>
        <div className="truncate text-[11px] text-ink-500">{d.error ? 'Unreadable' : sub}</div>
      </button>
      {d.doc && (
        <div className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
          {(inLeft || inRight) && (
            <span className="rounded bg-gold-600/20 px-1 text-[9px] font-semibold uppercase tracking-wider text-gold-300" title={`Open on the ${inLeft && inRight ? 'left and right' : inLeft ? 'left' : 'right'}`}>
              {inLeft && inRight ? 'L · R' : inLeft ? 'Left' : 'Right'}
            </span>
          )}
          {extra}
        </div>
      )}
    </div>
  );
}

/** Inline name box for a new vault: no spaces; letters, numbers, - and _. Enter creates, Esc cancels. */
function NewVault({ onDone }: { onDone: () => void }) {
  const store = useStore();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = vaultNameProblem(name, store.vaultNames());
  const create = () => {
    setTouched(true);
    if (problem) return;
    store.addVault(name);
    onDone();
  };
  return (
    <div className="mb-1 rounded border border-gold-600/50 bg-ink-850 p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => {
          // spaces are turned into underscores as you type
          setName(e.target.value.replace(/\s/g, '_'));
          setTouched(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
          if (e.key === 'Escape') onDone();
        }}
        placeholder="VaultName"
        maxLength={32}
        spellCheck={false}
        aria-label="New vault name"
        className="w-full rounded border border-ink-600 bg-ink-950 px-2 py-1 text-[13px] text-ink-100 focus:border-gold-500 focus:outline-none"
      />
      <p className={`mt-1 text-[11px] ${touched && problem ? 'text-red-300' : 'text-ink-500'}`}>{touched && problem ? problem : 'No spaces · letters, numbers, - and _'}</p>
      <div className="mt-1.5 flex justify-end gap-1">
        <button className="rounded px-2 py-0.5 text-[12px] text-ink-400 hover:text-ink-200" onClick={onDone}>
          Cancel
        </button>
        <button className="rounded bg-gold-500 px-2 py-0.5 text-[12px] font-semibold text-ink-950 hover:bg-gold-400 disabled:bg-ink-700 disabled:text-ink-400" disabled={!!problem} onClick={create}>
          Create
        </button>
      </div>
    </div>
  );
}
