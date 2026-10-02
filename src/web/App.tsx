import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { GD, type D2Character, type D2SharedStash } from '../core';
import { DEMO_FILES } from '../platform/demo';
import { createDroppedPlatform } from '../platform/dropped';
import { ArtSettings, ConfirmItemDelete, Credit, HeaderBtn, Hint, ScaleSetting, Section, SharedStashSetting, Toasts } from '../ui/App';
import { CharacterView } from '../ui/CharacterView';
import { StoreContext, useStore } from '../ui/context';
import { UI_SCALE_MAX, UI_SCALE_MIN, applyUiScale, defaultUiScale } from '../ui/scale';
import { StashView } from '../ui/StashView';
import { TooltipProvider } from '../ui/Tooltip';
import { fromDrop, fromInput, pickFiles, pickFolder, type Picked } from './files';
import { WebStore } from './WebStore';

// the Trade panel pulls in the screenshot reader, so it loads after the first paint
const TradeView = lazy(() => import('../trade/TradeView').then((m) => ({ default: m.TradeView })));

const REPO = 'https://github.com/pyrosplat/Horadric-Loot-Box';
const SAMPLES = DEMO_FILES;

export function WebApp() {
  const store = useMemo(() => new WebStore(createDroppedPlatform()), []);
  return (
    <StoreContext.Provider value={store}>
      <TooltipProvider>
        <Page />
      </TooltipProvider>
    </StoreContext.Provider>
  );
}

function Logo() {
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <svg viewBox="0 0 32 32" className="h-7 w-7 text-gold-400" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 10l10-6 10 6v12l-10 6-10-6V10z" />
        <path d="M11 13.5h10l-3-3M21 18.5H11l3 3" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-wide text-gold-300">Horadric Trading Post</span>
    </div>
  );
}

function Page() {
  const store = useStore() as WebStore;
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const loaded = store.saves.length > 0;

  const add = (files: Picked[] | null) => files?.length && store.addFiles(files);
  const choose = async () => add(await pickFiles(input.current));
  const chooseFolder = async () => {
    try {
      const files = await pickFolder(folderInput.current);
      if (files && !files.length) store.toast('error', 'No saves (.d2s, .d2i) in that folder.');
      else add(files);
    } catch (e) {
      store.toast('error', `Couldn't open that folder: ${(e as Error).message}`);
    }
  };
  const samples = async () => {
    const base = `${import.meta.env.BASE_URL}demo/`;
    const files = await Promise.all(SAMPLES.map(async (name) => ({ name, data: new Uint8Array(await (await fetch(base + name)).arrayBuffer()) })));
    add(files);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (mod && e.key.toLowerCase() === 's') (e.preventDefault(), store.saveAll());
      else if (mod && e.key.toLowerCase() === 'z' && !typing) (e.preventDefault(), store.undo());
      else if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        const cur = store.settings.uiScale ?? defaultUiScale();
        const next = e.key === '0' ? defaultUiScale() : Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round((cur + (e.key === '-' ? -0.1 : 0.1)) * 20) / 20));
        store.setSettings({ uiScale: next });
        void applyUiScale(next);
      } else if (e.key === 'Escape') store.pendingDelete ? store.cancelDelete() : store.clearSelection();
      else if (e.key === 'Delete' && !typing && store.selection.docId && store.selection.items.size) store.requestDelete(store.selection.docId, [...store.selection.items]);
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (store.dirtyDocs.length || store.tradeReceived.length || store.tradeOffered.length) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    // item art loads once, whether or not a file is dropped yet
    if (!store.art) void store.loadArt();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [store]);

  // files can be dropped anywhere on the page, any time (items being dragged inside the page are ignored)
  const isFileDrag = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');
  return (
    <div
      className="flex h-screen flex-col"
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={async (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setOver(false);
        const dropped = await fromDrop(e.dataTransfer);
        if (dropped.length) add(dropped);
        else store.toast('error', 'Drop a .d2i shared stash, a .d2s character, or your save folder.');
      }}
    >
      <input ref={input} type="file" accept=".d2i,.d2s" multiple hidden onChange={async (e) => (add(await fromInput(e.target.files)), (e.target.value = ''))} />
      <input
        ref={(el) => {
          folderInput.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        hidden
        onChange={async (e) => {
          const files = await fromInput(e.target.files);
          e.target.value = '';
          if (files.length) add(files);
          else store.toast('error', 'No saves (.d2s, .d2i) in that folder.');
        }}
      />
      <header className="flex items-center gap-3 border-b border-ink-800 bg-ink-900 px-4 py-2">
        <Logo />
        <span className="rounded border border-ink-600 px-1.5 py-[1px] text-[10px] uppercase tracking-wider text-ink-400">Web</span>
        {store.settings.readOnly && <span className="rounded border border-sky-700/60 bg-sky-900/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-sky-200">Read-only</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {loaded && store.saves.length > 1 && (
            <select
              className="mr-1 max-w-[18rem] truncate rounded border border-ink-600 bg-ink-900 px-2 py-1 text-[13px] text-ink-200"
              value={store.currentId ?? ''}
              onChange={(e) => store.use(e.target.value)}
              aria-label="File to trade from"
            >
              {store.saves.map((s) => (
                <option key={s.id} value={s.id}>
                  {store.label(s)}
                  {s.dirty ? ' •' : ''}
                </option>
              ))}
            </select>
          )}
          {loaded && <HeaderBtn onClick={choose}>Add files</HeaderBtn>}
          {loaded && (
            <HeaderBtn onClick={chooseFolder} title="Load every Reign of the Warlock character and stash in your save folder">
              Add folder
            </HeaderBtn>
          )}
          {loaded && store.hasChanges && (
            <HeaderBtn
              onClick={() => {
                if (!confirmDiscard) {
                  setConfirmDiscard(true);
                  setTimeout(() => setConfirmDiscard(false), 4000);
                  return;
                }
                setConfirmDiscard(false);
                void store.discard();
              }}
              disabled={store.busy}
              title="Put every file back to how it was last saved, and clear the trade"
            >
              {confirmDiscard ? <span className="text-amber-300">Discard all changes?</span> : 'Discard changes'}
            </HeaderBtn>
          )}
          <HeaderBtn onClick={() => store.undo()} disabled={!store.history.length} title="Undo (Ctrl+Z)">
            Undo
          </HeaderBtn>
          <HeaderBtn onClick={() => setSettings(true)}>Settings</HeaderBtn>
          {loaded && (
            <button
              onClick={() => store.saveAll()}
              disabled={!store.dirtyDocs.length || store.busy || store.settings.readOnly}
              className="ml-1 rounded bg-gold-500 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 hover:bg-gold-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
              title={store.savesInPlace ? 'Write the changes back to your save (Ctrl+S)' : 'Download the changed save to put back in your save folder (Ctrl+S)'}
            >
              {store.busy ? 'Working…' : store.saveLabel()}
            </button>
          )}
        </div>
      </header>
      {loaded && (
        <div className="border-b border-amber-800 bg-amber-900/30 px-4 py-1.5 text-[12.5px] text-amber-200">
          Close Diablo II: Resurrected before saving — the game would overwrite your changes.
          {!store.savesInPlace && store.dirtyDocs.length > 0 && ' Saving downloads the changed file: put it back in your save folder, replacing the old one.'}
        </div>
      )}
      {loaded ? <Trading /> : <DropZone onChoose={choose} onFolder={chooseFolder} onSamples={samples} />}
      {over && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-xl border-2 border-dashed border-gold-400 bg-ink-900/95 px-10 py-8 text-center shadow-tip">
            <p className="font-display text-xl text-gold-300">Drop your saves here</p>
            <p className="mt-1 text-[13px] text-ink-300">A Reign of the Warlock shared stash (.d2i), a character (.d2s), or your whole save folder</p>
          </div>
        </div>
      )}
      <Toasts />
      <Credit />
      {store.pendingDelete && <ConfirmItemDelete />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

function DropZone({ onChoose, onFolder, onSamples }: { onChoose: () => void; onFolder: () => void; onSamples: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center overflow-auto bg-[radial-gradient(ellipse_at_top,#2a2217,#0b0a09_60%)] p-6">
      <div className="w-full max-w-2xl rounded-xl border border-ink-700 bg-ink-900/80 p-8 shadow-tip">
        <h1 className="font-display text-2xl text-ink-200">Offline trading for Diablo II: Resurrected</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-400">
          Trade in single player for items listed on Traderie: drop in your save, paste a screenshot of a listing, pay what it asks, and the item lands in your stash or
          character. Reign of the Warlock only; softcore and hardcore never mix.
        </p>
        <button
          onClick={onChoose}
          className="mt-6 flex w-full flex-col items-center rounded-lg border-2 border-dashed border-gold-600/60 bg-gold-600/5 px-6 py-10 text-center hover:border-gold-400 hover:bg-gold-600/10"
        >
          <span className="font-display text-lg text-gold-300">Drop your save folder, shared stash or character here</span>
          <span className="mt-1 text-[13px] text-ink-400">or click to choose files (.d2i, .d2s)</span>
        </button>
        <button onClick={onFolder} className="mt-2 w-full rounded border border-ink-600 px-3 py-2 text-[13px] text-ink-200 hover:bg-ink-800">
          Choose your save folder: every Reign of the Warlock character and stash loads at once
        </button>
        <div className="mt-4 rounded border border-ink-700 bg-ink-950 p-3 text-[12px] leading-relaxed text-ink-400">
          <p>Your saves are in:</p>
          <p className="mt-1">
            <span className="text-ink-300">Windows</span> <span className="font-mono text-ink-200">%USERPROFILE%\Saved Games\Diablo II Resurrected</span>
          </p>
          <p>
            <span className="text-ink-300">Steam Deck / Linux</span>{' '}
            <span className="font-mono text-ink-200 [overflow-wrap:anywhere]">~/.local/share/Steam/steamapps/compatdata/&lt;id&gt;/pfx/drive_c/users/steamuser/Saved Games/Diablo II Resurrected</span>
          </p>
          <p className="mt-2">The shared stash is <span className="font-mono text-ink-200">ModernSharedStashSoftCoreV2.d2i</span> (or HardCore).</p>
        </div>
        <ul className="mt-4 space-y-1 text-[12.5px] text-ink-400">
          <li>• Your saves never leave your computer: everything, including reading screenshots, happens in this page.</li>
          <li>• Chrome and Edge save straight back to the file. Other browsers download the changed file for you to put back.</li>
          <li>• A copy of the original is downloaded before the first save.</li>
        </ul>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <button onClick={onSamples} className="rounded border border-ink-600 px-3 py-1.5 text-ink-200 hover:bg-ink-800">
            Try it with sample saves
          </button>
          <a href={REPO} target="_blank" rel="noreferrer" className="text-gold-400 hover:text-gold-300">
            Want vaults and muling too? Get Horadric Loot Box →
          </a>
        </div>
      </div>
    </main>
  );
}

function Trading() {
  const store = useStore() as WebStore;
  const entry = store.currentId ? store.docs.get(store.currentId) : undefined;
  return (
    <main className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3 pb-8">
      <Panel>
        {!entry?.doc ? (
          <div className="flex h-full min-h-[300px] items-center justify-center text-[13px] text-ink-500">{store.busy ? 'Loading…' : 'Drop a save to trade from.'}</div>
        ) : entry.doc.kind === 'stash' ? (
          <StashView docId={entry.id} stash={entry.doc as D2SharedStash} pane={0} tab={store.panes[0].tab} />
        ) : (
          <CharacterView docId={entry.id} ch={entry.doc as D2Character} pane={0} />
        )}
      </Panel>
      <Panel>
        <Suspense fallback={<div className="p-4 text-[13px] text-ink-500">Loading Trade…</div>}>
          <TradeView />
        </Suspense>
      </Panel>
    </main>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-ink-700 bg-ink-850/60 p-4">{children}</div>;
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-ink-600 bg-ink-900 p-6 shadow-tip" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-gold-300">Settings</h2>
        <Section title="General">
          <label className="flex items-start gap-3 text-[13px] text-ink-200">
            <input type="checkbox" className="mt-0.5 accent-[#c7a04a]" checked={store.settings.readOnly} onChange={(e) => store.setSettings({ readOnly: e.target.checked })} />
            <span>
              Read-only mode
              <span className="block text-[12px] text-ink-500">Look around without changing anything.</span>
            </span>
          </label>
          <ScaleSetting />
          <SharedStashSetting />
        </Section>
        <ArtSettings />
        <Section title="About">
          <p className="text-[13px] text-ink-200">
            <span className="text-gold-300">Horadric Trading Post</span> (web) {__APP_VERSION__} · created by <span className="font-semibold">PyroSplat</span>
          </p>
          <Hint>
            Trading <span className="text-ink-300">creates new items</span> in your save, so it's a single-player cheat by design. Trades can be undone until you save.
          </Hint>
          <Hint>
            Part of{' '}
            <a href={REPO} target="_blank" rel="noreferrer" className="text-gold-400 hover:text-gold-300">
              Horadric Loot Box
            </a>
            . Game data from {GD.meta.source.replace(/ \(.*\)$/, '')}. Diablo® II: Resurrected™ is a trademark of Blizzard Entertainment; not affiliated with Blizzard.
          </Hint>
        </Section>
        <div className="mt-6 flex justify-end">
          <button className="rounded bg-ink-700 px-3 py-1.5 text-[13px] text-ink-200 hover:bg-ink-600" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
