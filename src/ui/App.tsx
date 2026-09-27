import { useEffect, useMemo, useState } from 'react';
import { GD } from '../core';
import { availablePlatforms, type Platform } from '../platform';
import { Store, desc, docLabel, savedSettings, type ItemView } from '../state/store';
import { QUALITY_TEXT } from './Tooltip';
import { UI_SCALE_MAX, UI_SCALE_MIN, applyUiScale } from './scale';
import { StoreContext, useStore } from './context';
import { Pane } from './Pane';
import { SearchPanel } from './SearchPanel';
import { Sidebar } from './Sidebar';
import { TooltipProvider } from './Tooltip';

export function App() {
  const platforms = useMemo(availablePlatforms, []);
  const [store, setStore] = useState<Store | null>(null);
  // desktop app: reopen the last save folder at launch (only once; "Open a different folder" shows the welcome screen)
  const last = platforms[0].id === 'tauri' ? savedSettings().lastFolder : undefined;
  const [autoOpen, setAutoOpen] = useState(!!last);
  const [lastError, setLastError] = useState<string | null>(null);

  const start = async (p: Platform, folder?: string | null) => {
    const s = new Store(p);
    const f = folder ?? (await p.pickFolder());
    if (!f) return;
    setStore(s);
    await s.openFolder(f);
  };

  useEffect(() => {
    if (!autoOpen || !last) return;
    platforms[0]
      .listSaves(last)
      .then(() => start(platforms[0], last))
      .catch(() => setLastError(`Couldn't open ${last} (it may have moved). Choose your save folder.`))
      .finally(() => setAutoOpen(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!store) {
    if (autoOpen) return <div className="min-h-screen bg-ink-950" />;
    return (
      <>
        <Welcome platforms={platforms} onStart={start} last={last} note={lastError} />
        <Credit />
      </>
    );
  }
  return (
    <StoreContext.Provider value={store}>
      <TooltipProvider>
        <Shell onSwitch={() => setStore(null)} />
      </TooltipProvider>
    </StoreContext.Provider>
  );
}

function Logo() {
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <svg viewBox="0 0 32 32" className="h-7 w-7 text-gold-400" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M6 10l10-6 10 6v12l-10 6-10-6V10z" />
        <path d="M6 10l10 6 10-6M16 16v12" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-wide text-gold-300">Horadric Loot Box</span>
    </div>
  );
}

function Welcome({ platforms, onStart, last, note }: { platforms: Platform[]; onStart: (p: Platform, folder?: string | null) => Promise<void>; last?: string; note?: string | null }) {
  const [detected, setDetected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const main = platforms[0];
  const demo = platforms.find((p) => p.id === 'demo');
  useEffect(() => {
    if (main.id === 'tauri')
      main
        .detectSaveFolders()
        .then((found) => setDetected(last && !note && !found.includes(last) ? [last, ...found] : found))
        .catch(() => setDetected(last && !note ? [last] : []));
  }, [main]);
  const go = (p: Platform, f?: string | null) => onStart(p, f).catch((e) => setError((e as Error).message));
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,#2a2217,#0b0a09_60%)] p-6">
      <div className="w-full max-w-xl rounded-xl border border-ink-700 bg-ink-900/80 p-8 shadow-tip">
        <Logo />
        <h1 className="mt-6 font-display text-2xl text-ink-200">Muling for Diablo II: Resurrected</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-400">
          Move items between your offline characters, shared stashes and unlimited vaults. Works with Reign of the Warlock, including the Warlock and
          all the new items.
        </p>
        <div className="mt-6 space-y-2">
          {detected.map((f) => (
            <button key={f} onClick={() => go(main, f)} className="block w-full rounded border border-gold-600/50 bg-gold-600/10 px-4 py-2.5 text-left text-[13px] text-gold-300 hover:bg-gold-600/20">
              Open <span className="font-mono text-[12px] text-ink-200">{f}</span>
            </button>
          ))}
          {main.id !== 'demo' && (
            <button onClick={() => go(main)} className="w-full rounded bg-gold-500 px-4 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-gold-400">
              Choose save folder…
            </button>
          )}
          {demo && (
            <button onClick={() => go(demo, 'demo/')} className="w-full rounded border border-ink-600 px-4 py-2.5 text-[14px] text-ink-200 hover:bg-ink-800">
              Try the demo with sample saves
            </button>
          )}
        </div>
        {(error ?? note) && <p className="mt-3 text-[13px] text-red-300">{error ?? note}</p>}
        <p className="mt-6 text-[12px] leading-relaxed text-ink-500">
          Close the game before saving. Your saves are backed up and checked before anything is written. They're usually in{' '}
          <span className="font-mono">Saved Games\Diablo II Resurrected</span>.
        </p>
      </div>
    </div>
  );
}

function Shell({ onSwitch }: { onSwitch: () => void }) {
  const store = useStore();
  const [search, setSearch] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const dirty = store.dirtyDocs.length;

  useEffect(() => {
    if (!store.settings.autoUpdate) return;
    const t = setTimeout(() => store.checkForUpdates(), 3000);
    return () => clearTimeout(t);
  }, [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') (e.preventDefault(), store.saveAll());
      else if (mod && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) (e.preventDefault(), store.undo());
      else if (mod && e.key.toLowerCase() === 'f') (e.preventDefault(), setSearch(true));
      else if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        const cur = store.settings.uiScale ?? 1;
        const next = e.key === '0' ? 1 : Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round((cur + (e.key === '-' ? -0.1 : 0.1)) * 20) / 20));
        store.setSettings({ uiScale: next });
        void applyUiScale(next);
      } else if (e.key === 'Escape') store.pendingDelete ? store.cancelDelete() : store.clearSelection();
      else if (e.key === 'Delete' && !(e.target instanceof HTMLInputElement) && store.selection.docId && store.selection.items.size)
        store.requestDelete(store.selection.docId, [...store.selection.items]);
    };
    window.addEventListener('keydown', onKey);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (store.dirtyDocs.length) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [store]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-ink-800 bg-ink-900 px-4 py-2">
        <Logo />
        <span className="ml-2 min-w-0 truncate rounded bg-ink-850 px-2 py-0.5 font-mono text-[11px] text-ink-400" title={store.folder}>
          {store.platform.id === 'demo' ? 'Demo sandbox — changes stay in memory' : store.folder}
        </span>
        {store.settings.readOnly && (
          <button onClick={() => setSettings(true)} className="rounded border border-sky-700/60 bg-sky-900/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-sky-200" title="Moving and saving are off. Change this in Settings.">
            Read-only
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {(store.update.state === 'available' || store.update.state === 'installing') && (
            <button
              onClick={() => setShowUpdate(true)}
              className="mr-1 rounded-full border border-emerald-600/70 bg-emerald-900/30 px-2.5 py-1 text-[12px] font-semibold text-emerald-200 hover:bg-emerald-900/50"
              title="A new version is available"
            >
              {store.update.state === 'installing' ? 'Updating…' : `Update to ${store.update.info?.version}`}
            </button>
          )}
          <HeaderBtn onClick={() => setSearch(true)} title="Search everything (Ctrl+F)">
            Search
          </HeaderBtn>
          <HeaderBtn onClick={() => store.undo()} disabled={!store.history.length} title="Undo (Ctrl+Z)">
            Undo
          </HeaderBtn>
          <HeaderBtn
            onClick={() => {
              if (dirty && !confirmReload) {
                setConfirmReload(true);
                setTimeout(() => setConfirmReload(false), 4000);
                return;
              }
              setConfirmReload(false);
              store.reload();
            }}
            disabled={store.busy}
            title={dirty ? 'Reload discards unsaved changes' : 'Re-read files from disk'}
          >
            {confirmReload ? <span className="text-amber-300">Discard {dirty} unsaved?</span> : 'Reload'}
          </HeaderBtn>
          <HeaderBtn onClick={() => setSettings(true)}>Settings</HeaderBtn>
          <button
            onClick={() => store.saveAll()}
            disabled={!dirty || store.busy || store.settings.readOnly}
            className="ml-1 rounded bg-gold-500 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 hover:bg-gold-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
            title="Save changes (Ctrl+S)"
          >
            {store.busy ? 'Working…' : dirty ? `Save ${dirty} file${dirty > 1 ? 's' : ''}` : 'Saved'}
          </button>
        </div>
      </header>
      {store.gameRunning && (
        <div className="border-b border-amber-800 bg-amber-900/30 px-4 py-1.5 text-[12.5px] text-amber-200">
          Diablo II: Resurrected is running. Close it before saving — the game keeps characters open and would overwrite your changes.
          <button className="ml-2 underline" onClick={async () => ((store.gameRunning = await store.platform.isGameRunning()), store.emit())}>
            Check again
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 gap-3 overflow-hidden p-3 pb-10">
          <Pane pane={0} />
          <Pane pane={1} />
          <button
            onClick={() => store.swapPanes()}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-ink-600 bg-ink-900 px-3 py-1 text-[12px] text-ink-300 shadow-tip hover:border-gold-500 hover:text-gold-300"
            title="Switch the left and right sides"
          >
            ⇄ Switch sides
          </button>
        </main>
      </div>
      <Toasts />
      <Credit />
      {store.pendingDelete && <ConfirmItemDelete />}
      {search && <SearchPanel onClose={() => setSearch(false)} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} onSwitch={onSwitch} />}
      {showUpdate && store.update.info && <UpdateDialog onClose={() => setShowUpdate(false)} />}
    </div>
  );
}

function HeaderBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...p} className="rounded px-2.5 py-1.5 text-[13px] text-ink-300 hover:bg-ink-800 hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}

function Toasts() {
  const store = useStore();
  return (
    <div className="pointer-events-none fixed bottom-7 right-4 z-50 flex w-96 max-w-[90vw] flex-col gap-2" aria-live="polite">
      {store.toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-md border px-3.5 py-2.5 text-[13px] shadow-tip [overflow-wrap:anywhere] ${
            t.kind === 'error' ? 'border-red-800 bg-red-950/95 text-red-100' : t.kind === 'success' ? 'border-emerald-800 bg-emerald-950/95 text-emerald-100' : 'border-ink-600 bg-ink-850/95 text-ink-200'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-ink-700 pt-4 first:mt-4 first:border-0 first:pt-0">
      <h3 className="mb-2 font-display text-[11px] uppercase tracking-[.2em] text-ink-400">{title}</h3>
      {children}
    </section>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{children}</p>;

function SettingsModal({ onClose, onSwitch }: { onClose: () => void; onSwitch: () => void }) {
  const store = useStore();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-ink-600 bg-ink-900 p-6 shadow-tip" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-gold-300">Settings</h2>
        <div>
          <Section title="General">
            <label className="flex items-start gap-3 text-[13px] text-ink-200">
              <input type="checkbox" className="mt-0.5 accent-[#c7a04a]" checked={store.settings.readOnly} onChange={(e) => store.setSettings({ readOnly: e.target.checked })} />
              <span>
                Read-only mode
                <span className="block text-[12px] text-ink-500">Look around without changing anything.</span>
              </span>
            </label>
            <ScaleSetting />
          </Section>
          <ArtSettings />
          {store.platform.updates && <UpdateSettings />}
          <Section title="About">
            <p className="text-[13px] text-ink-200">
              <span className="text-gold-300">Horadric Loot Box</span> {__APP_VERSION__} · created by <span className="font-semibold">PyroSplat</span>
            </p>
            <Hint>Game data from {GD.meta.source.replace(/ \(.*\)$/, '')}. Not affiliated with Blizzard.</Hint>
            {store.platform.id === 'tauri' && store.folder && (
              <Hint>
                Vaults are saved in <span className="font-mono text-ink-400 [overflow-wrap:anywhere]">{store.folder.replace(/[\\/]+$/, '')}{store.folder.includes('\\') ? '\\' : '/'}HoradricLootBox-Vaults</span>, next to your characters.
              </Hint>
            )}
            <Hint>
              Items only move between saves of the same edition, and hardcore never mixes with softcore. {store.lastBackup ? `Last backup: ${store.lastBackup}.` : 'Each file is backed up the first time you save it.'}
            </Hint>
            {store.platform.revealBackups && (
              <button className="mt-1.5 text-[12.5px] text-gold-400 hover:text-gold-300" onClick={() => store.platform.revealBackups!()}>
                Open backups folder
              </button>
            )}
          </Section>
        </div>
        <div className="mt-6 flex justify-between">
          <button className="text-[13px] text-ink-400 hover:text-ink-200" onClick={onSwitch}>
            Open a different folder
          </button>
          <button className="rounded bg-ink-700 px-3 py-1.5 text-[13px] text-ink-200 hover:bg-ink-600" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const VIEWS: { id: ItemView; label: string; hint: string }[] = [
  { id: 'art', label: 'Game art', hint: 'Item pictures from your game files' },
  { id: 'artNames', label: 'Art + names', hint: 'Pictures with the item name on top' },
  { id: 'tiles', label: 'Classic tiles', hint: 'Coloured tiles with names' },
];

function ArtSettings() {
  const store = useStore();
  const st = store.artStatus;
  const backend = store.platform.art;
  const [artPath, setArtPath] = useState(store.settings.artPath ?? store.art?.info.path ?? '');
  const tone = st.state === 'ready' ? 'text-emerald-300' : st.state === 'error' || st.state === 'missing' ? 'text-amber-300' : 'text-ink-400';
  return (
    <Section title="Items">
      <div className="grid grid-cols-3 gap-1 rounded-md bg-ink-950 p-1" role="radiogroup" aria-label="Item display">
        {VIEWS.map((v) => {
          const on = store.settings.itemView === v.id;
          return (
            <button
              key={v.id}
              role="radio"
              aria-checked={on}
              title={v.hint}
              onClick={() => store.setSettings({ itemView: v.id })}
              className={`rounded px-2 py-1.5 text-[12.5px] transition ${on ? 'bg-gold-500 font-semibold text-ink-950' : 'text-ink-300 hover:bg-ink-800'}`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[13px] text-ink-200">Game art</p>
      {backend ? (
        <>
          <Hint>
            Needs unpacked game files. Extract the game's <span className="font-mono">data</span> folder with CascView, then type or paste where it is (any drive), or browse to it.
            Nothing is copied or shared.
          </Hint>
          <p className={`mt-2 text-[12px] [overflow-wrap:anywhere] ${tone}`}>{st.state === 'loading' ? 'Loading…' : st.message}</p>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const p = artPath.trim().replace(/^"(.*)"$/, '$1');
              if (p) store.loadArt(p);
            }}
          >
            <input
              value={artPath}
              onChange={(e) => setArtPath(e.target.value)}
              placeholder="e.g. D:\D2R-Extracted"
              aria-label="Unpacked game files folder"
              spellCheck={false}
              className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-950 px-2 py-1 font-mono text-[11.5px] text-ink-200 outline-none placeholder:text-ink-600 focus:border-gold-500"
            />
            <button type="submit" disabled={!artPath.trim()} className="rounded border border-ink-600 px-2.5 py-1 text-[12.5px] text-ink-200 hover:bg-ink-800 disabled:opacity-40">
              Use
            </button>
            <button
              type="button"
              className="rounded border border-ink-600 px-2.5 py-1 text-[12.5px] text-ink-200 hover:bg-ink-800"
              onClick={async () => {
                const p = await backend.pickFolder();
                if (p) (setArtPath(p), store.loadArt(p));
              }}
            >
              Browse…
            </button>
            {store.art && (
              <button type="button" className="rounded px-2 py-1 text-[12.5px] text-ink-400 hover:text-ink-200" onClick={() => store.loadArt(store.art!.info.path)}>
                Reload
              </button>
            )}
          </form>
        </>
      ) : (
        <Hint>Game art needs the desktop app. Classic tiles are used here.</Hint>
      )}
    </Section>
  );
}

function UpdateSettings() {
  const store = useStore();
  const u = store.update;
  const status =
    u.state === 'checking' ? 'Checking…'
    : u.state === 'available' ? `Version ${u.info?.version} is available.`
    : u.state === 'installing' ? 'Installing the update…'
    : u.state === 'none' ? `You're on the latest version.`
    : u.state === 'error' ? `Couldn't check: ${u.message}`
    : '';
  return (
    <Section title="Updates">
      <label className="flex items-start gap-3 text-[13px] text-ink-200">
        <input type="checkbox" className="mt-0.5 accent-[#c7a04a]" checked={store.settings.autoUpdate} onChange={(e) => store.setSettings({ autoUpdate: e.target.checked })} />
        <span>
          Check for updates when the app starts
          <span className="block text-[12px] text-ink-500">New versions come from the project's GitHub releases. Nothing installs without you clicking Update.</span>
        </span>
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded border border-ink-600 px-2.5 py-1 text-[12.5px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          disabled={u.state === 'checking' || u.state === 'installing'}
          onClick={() => store.checkForUpdates(true)}
        >
          Check now
        </button>
        {u.state === 'available' && (
          <button className="rounded bg-emerald-700 px-2.5 py-1 text-[12.5px] font-semibold text-white hover:bg-emerald-600" onClick={() => store.installUpdate()}>
            Update to {u.info?.version} and restart
          </button>
        )}
        <span className={`text-[12px] ${u.state === 'error' ? 'text-amber-300' : 'text-ink-400'}`}>{status}</span>
      </div>
    </Section>
  );
}

function UpdateDialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const u = store.update;
  const installing = u.state === 'installing';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => !installing && onClose()}>
      <div role="dialog" aria-label="Update available" className="w-full max-w-md rounded-lg border border-ink-600 bg-ink-900 p-6 shadow-tip" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-gold-300">Update to {u.info?.version}</h2>
        <p className="mt-1 text-[12.5px] text-ink-400">You have {__APP_VERSION__}. The app restarts after updating; your saves and vaults aren't touched.</p>
        {u.info?.notes && <div className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-ink-700 bg-ink-950 p-3 text-[12.5px] leading-relaxed text-ink-300">{u.info.notes}</div>}
        {installing && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((u.progress ?? 0.05) * 100)}%` }} />
          </div>
        )}
        {store.dirtyDocs.length > 0 && !installing && <p className="mt-3 text-[12.5px] text-amber-300">Save or reload your {store.dirtyDocs.length} changed file(s) first.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded px-3 py-1.5 text-[13px] text-ink-300 hover:bg-ink-800 disabled:opacity-40" disabled={installing} onClick={onClose}>
            Later
          </button>
          <button
            className="rounded bg-emerald-700 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:bg-ink-700 disabled:text-ink-400"
            disabled={installing || store.dirtyDocs.length > 0}
            onClick={() => store.installUpdate()}
          >
            {installing ? 'Updating…' : 'Update and restart'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Credit() {
  return (
    <div className="pointer-events-none fixed bottom-1.5 right-3 z-40 select-none text-[11px] tracking-wide text-ink-500">
      Created by <span className="font-semibold text-ink-400">PyroSplat</span>
    </div>
  );
}

function ConfirmItemDelete() {
  const store = useStore();
  const p = store.pendingDelete!;
  const entry = store.docs.get(p.docId);
  const names = p.items.map((i) => {
    const d = desc(i);
    // Stackables: only one comes off the stack
    const n = i.advancedStackSize && i.advancedStackSize > 1 ? ` (1 of ${i.advancedStackSize})` : '';
    return { name: d.name + n, cls: QUALITY_TEXT[d.qualityClass] };
  });
  const many = p.items.length > 1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => store.cancelDelete()}>
      <div role="dialog" aria-label="Delete items" className="w-full max-w-md rounded-lg border border-red-900 bg-ink-900 p-6 shadow-tip" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-red-300">Delete {many ? `${p.items.length} items` : names[0].name}?</h2>
        <p className="mt-2 text-[13px] text-ink-300">
          From <span className="text-ink-100">{docLabel(entry?.doc, entry?.name ?? '')}</span>. You can undo with Ctrl+Z until you save; after saving the item{many ? 's are' : ' is'} gone for good.
        </p>
        {many && (
          <ul className="mt-3 max-h-48 space-y-0.5 overflow-auto rounded border border-ink-700 bg-ink-950 p-2 text-[12.5px]">
            {names.slice(0, 40).map((n, i) => (
              <li key={i} className={n.cls}>
                {n.name}
              </li>
            ))}
            {names.length > 40 && <li className="text-ink-500">…and {names.length - 40} more</li>}
          </ul>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded px-3 py-1.5 text-[13px] text-ink-300 hover:bg-ink-800" onClick={() => store.cancelDelete()}>
            Cancel
          </button>
          <button autoFocus className="rounded bg-red-700 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-red-600" onClick={() => store.deleteItems(p.docId, p.items)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ScaleSetting() {
  const store = useStore();
  const v = store.settings.uiScale ?? 1;
  const set = (n: number) => {
    const s = Math.round(n * 20) / 20;
    store.setSettings({ uiScale: s });
    void applyUiScale(s);
  };
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <label htmlFor="ui-scale" className="text-[13px] text-ink-200">
          Interface scale
        </label>
        <span className="flex items-center gap-2">
          <span className="w-12 text-right text-[13px] tabular-nums text-gold-300">{Math.round(v * 100)}%</span>
          {v !== 1 && (
            <button className="text-[11.5px] text-ink-400 hover:text-ink-200" onClick={() => set(1)}>
              Reset
            </button>
          )}
        </span>
      </div>
      <input
        id="ui-scale"
        type="range"
        min={UI_SCALE_MIN}
        max={UI_SCALE_MAX}
        step={0.05}
        value={v}
        onChange={(e) => set(Number(e.target.value))}
        className="mt-2 w-full accent-[#c7a04a]"
      />
      <div className="flex justify-between text-[10.5px] text-ink-500">
        <span>{Math.round(UI_SCALE_MIN * 100)}%</span>
        <span>100%</span>
        <span>{Math.round(UI_SCALE_MAX * 100)}%</span>
      </div>
      <p className="mt-1 text-[12px] text-ink-500">Shortcut: Ctrl + and Ctrl −. Ctrl 0 resets.</p>
    </div>
  );
}
