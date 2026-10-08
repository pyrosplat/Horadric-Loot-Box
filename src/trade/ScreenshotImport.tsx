import { useCallback, useEffect, useRef, useState } from 'react';
import { GD, createAffixItem, createBaseItem, createRunewordItem, createTemplateItem, wantName, type D2Item } from '../core';
import { useStore } from '../ui/context';
import { ItemCard, useTooltip } from '../ui/Tooltip';
import { MAX_LISTING_AGE_DAYS, askText, readListing, type AskItem, type ListingResult } from './listing';
import { displayItem } from './TradeGrid';
import { ItemThumb } from '../ui/ItemArt';

type Built = { item?: D2Item; pieces?: { item: D2Item; name: string; id: number }[]; error?: string };

type State =
  | { status: 'idle' }
  | { status: 'reading'; progress: number; preview: string }
  | { status: 'done'; preview: string; result: ListingResult; item?: D2Item; pieces?: Built['pieces']; errors: string[] }
  | { status: 'failed'; preview?: string; message: string };

/** "50 seconds", "3 hours", "2 days" */
function ago(s: number): string {
  const [n, u] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day'];
  return `${n} ${u}${n === 1 ? '' : 's'}`;
}

/** Builds what the listing describes, so you see (and get) exactly that item. */
function build(r: ListingResult): Built {
  const it = r.item;
  if (!it) return {};
  try {
    if (it.kind === 'rune' || it.kind === 'gem' || it.kind === 'uber') return { item: displayItem(it.code) };
    if (it.kind === 'fullset') return { pieces: it.pieces.map((p) => ({ id: p.id, name: p.name, item: createTemplateItem('set', p.id, p.rolls, { defense: p.defense }) })) };
    if (it.kind === 'unique' || it.kind === 'set') return { item: createTemplateItem(it.kind, it.id, it.rolls, { ethereal: it.ethereal, defense: it.defense }) };
    if (it.kind === 'runeword') {
      const d = GD.items[it.code];
      // the base's own defense isn't on the listing: a random roll in its range, like any roll it doesn't show
      const defense = d?.minAc !== undefined && d.maxAc !== undefined ? d.minAc + Math.floor(Math.random() * (d.maxAc - d.minAc + 1)) : undefined;
      return { item: createRunewordItem(it.row, it.code, it.rolls, { ethereal: it.ethereal, defense, superior: it.superior }) };
    }
    if (it.kind === 'magic' || it.kind === 'rare' || it.kind === 'crafted')
      return { item: createAffixItem(it.code, { quality: it.kind, affixes: it.affixes, craft: it.craft, auto: it.auto, sockets: it.sockets, ethereal: it.ethereal, defense: it.defense, exactStats: it.exact }) };
    if (it.kind !== 'base') return {};
    return { item: createBaseItem(it.code, { sockets: it.sockets, defense: it.defense, ethereal: it.ethereal, superior: it.superior, auto: it.auto, skills: it.skills }) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A listing's name in the trade: "Ethereal Superior Thresher (4 sockets)". */
function itemLabel(it: NonNullable<ListingResult['item']>): string {
  if (it.kind === 'base') return `${it.ethereal ? 'Ethereal ' : ''}${it.superior ? 'Superior ' : ''}${it.name}${it.sockets ? ` (${it.sockets} sockets)` : ''}`;
  if (it.kind === 'unique' || it.kind === 'set') return `${it.ethereal ? 'Ethereal ' : ''}${it.name}`;
  if (it.kind === 'runeword') return `${it.name} (${it.ethereal ? 'Ethereal ' : ''}${it.superior ? 'Superior ' : ''}${it.base})`;
  if (it.kind === 'magic' || it.kind === 'rare' || it.kind === 'crafted') return `${it.ethereal ? 'Ethereal ' : ''}${it.name}${it.sockets ? ` (${it.sockets} sockets)` : ''}`;
  return it.name;
}

const thumbs = new Map<string, D2Item | null>();
/** A picture for one thing in a price: the rune or gem, or the named item (any rolls). */
function thumbOf(a: AskItem): D2Item | undefined {
  if (!a.item) return displayItem(a.code);
  const w = a.item;
  const code = w.kind === 'base' || w.kind === 'runeword' ? w.code : undefined;
  const key = JSON.stringify([w.kind, 'id' in w ? w.id : '', code ?? '']);
  if (!thumbs.has(key)) {
    try {
      thumbs.set(key, w.kind === 'unique' || w.kind === 'set' ? createTemplateItem(w.kind, w.id) : code ? createBaseItem(code) : null);
    } catch {
      thumbs.set(key, null);
    }
  }
  return thumbs.get(key) ?? undefined;
}

/**
 * "Trading for: [Ist] 1× Ist Rune or [Ohm] 1× Ohm Rune". With `onPick` the options are buttons (selling: which of
 * the buyer's options you take).
 */
export function AskLine({ ask, matched, label = 'Trading for:', picked, onPick }: { ask: AskItem[][]; matched?: number; label?: string; picked?: number; onPick?: (i: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-300">
      <span className="text-gold-300">{label}</span>
      {ask.map((opt, i) => {
        const on = matched === i || picked === i;
        const cls = `flex items-center gap-1.5 rounded border px-1.5 py-0.5 ${on ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200' : 'border-ink-700'} ${onPick ? 'cursor-pointer hover:border-ink-400' : ''}`;
        const body = (
          <>
            {!opt.length && <span>Free</span>}
            {opt.map((a, k) => {
              const img = thumbOf(a);
              return (
                <span key={`${a.code}:${a.name}:${k}`} className="flex items-center gap-1">
                  {img && <ItemThumb item={img} size={18} />}
                  {a.qty}× {a.item ? wantName(a.item) : a.name}
                </span>
              );
            })}
            {on && <span>✓</span>}
          </>
        );
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-ink-500">or</span>}
            {onPick ? (
              <button type="button" className={cls} onClick={() => onPick(i)}>
                {body}
              </button>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] ${ok ? 'border-emerald-700/70 text-emerald-300' : 'border-red-800 text-red-300'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

/**
 * Import a Traderie listing from a screenshot: paste it (Ctrl+V), drop it here or choose the file. The text is
 * read on this computer (./ocr.ts), checked against the trade rules (./listing.ts), and the item is built so you
 * can see exactly what you'd get before adding it to the trade.
 */
export function ScreenshotImport() {
  const store = useStore();
  const tip = useTooltip();
  const [state, setState] = useState<State>({ status: 'idle' });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | undefined>(undefined);

  const run = useCallback(async (file: Blob) => {
    if (!file.type.startsWith('image/')) return setState({ status: 'failed', message: "That isn't an image. Paste or drop a screenshot of the listing." });
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const preview = (previewRef.current = URL.createObjectURL(file));
    setState({ status: 'reading', progress: 0, preview });
    try {
      const { readScreenshot } = await import('./ocr');
      const read = await readScreenshot(file, (p) => setState((s) => (s.status === 'reading' ? { ...s, progress: p } : s)));
      const result = readListing(read.lines, read.price);
      const b = build(result);
      setState({ status: 'done', preview, result, item: b.item, pieces: b.pieces, errors: [...result.errors, ...(b.error ? [b.error] : [])] });
    } catch (e) {
      setState({ status: 'failed', preview, message: `Couldn't read the screenshot: ${(e as Error).message}` });
    }
  }, []);

  // paste anywhere while the Trade panel is open (but not into a text box)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const img = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
      if (img) {
        e.preventDefault();
        void run(img);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [run]);
  useEffect(() => () => void (previewRef.current && URL.revokeObjectURL(previewRef.current)), []);

  const add = () => {
    if (state.status !== 'done' || errors.length || !state.result.item || !state.result.tags.mode || !state.result.ask) return;
    const it = state.result.item;
    if (state.result.direction === 'sell') {
      if (!state.result.want) return;
      const replacing = store.trade.listing;
      const problem = store.tradeSetListing({ name: it.name, mode: state.result.tags.mode, ask: [state.result.want], receive: state.result.ask });
      if (problem) return store.toast('error', problem);
      store.toast('success', `${replacing ? `Replaced ${replacing} with` : 'Added'} a buyer for ${it.name}. Drag it into your offer and pick what you get.`);
      return setState({ status: 'idle' });
    }
    const items =
      it.kind === 'fullset'
        ? (state.pieces ?? []).map((p) => ({ kind: 'set' as const, id: p.id, name: p.name, item: p.item }))
        : state.item && it.kind !== 'rune' && it.kind !== 'gem' && it.kind !== 'uber'
          ? [{ kind: it.kind, id: 'id' in it ? it.id : it.kind === 'runeword' ? it.row : GD.items[it.code].index, name: itemLabel(it), item: state.item }]
          : [];
    const want: [string, number][] = it.kind === 'rune' || it.kind === 'gem' || it.kind === 'uber' ? [[it.code, it.quantity]] : [];
    const replacing = store.trade.listing;
    const problem = store.tradeSetListing({ name: it.name, mode: state.result.tags.mode, ask: state.result.ask, want, items });
    if (problem) return store.toast('error', problem);
    store.toast('success', `${replacing ? `Replaced ${replacing} with` : 'Added'} ${it.name}. ${state.result.ask.some((o) => !o.length) ? 'It is free: just accept the trade.' : `Now drag ${askText(state.result.ask)} into your offer.`}`);
    setState({ status: 'idle' });
  };

  const r = state.status === 'done' ? state.result : undefined;
  const t = r?.tags;
  // checked live, so switching the file on the other side updates it
  const modeProblem = t?.mode ? store.tradeModeProblem(t.mode) : undefined;
  // a normal listing is for buying, a buyer's ("I Give", "Offering") for selling: it has to match the Buy / Sell switch
  const side = store.trade.side;
  const sideProblem = r && r.direction !== side ? (r.direction === 'sell' ? 'This listing is someone buying the item ("I Give"). Switch to Sell to sell it to them.' : 'This listing is someone selling the item ("Trading For"). Switch to Buy to buy it.') : undefined;
  const errors = state.status === 'done' ? [...(sideProblem ? [sideProblem] : []), ...state.errors, ...(modeProblem ? [modeProblem] : [])] : [];
  return (
    <section
      className={`rounded-md border-2 p-3 ${over ? 'border-gold-400 bg-gold-600/15' : 'border-gold-600/60 bg-gold-600/[.06] shadow-[0_0_14px_rgba(201,165,74,.12)]'}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void run(f);
      }}
    >
      <div className="flex items-center gap-2">
        <h3 className="font-display text-[11.5px] uppercase tracking-[.22em] text-gold-300">Import a listing</h3>
        <span className="text-[11.5px] text-ink-500">Paste (Ctrl+V) or drop a Traderie screenshot</span>
        <button className="ml-auto rounded border border-ink-600 px-2 py-0.5 text-[11.5px] text-ink-200 hover:border-ink-400" onClick={() => input.current?.click()}>
          Choose…
        </button>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => (e.target.files?.[0] && void run(e.target.files[0]), (e.target.value = ''))} />
      </div>

      {state.status === 'reading' && (
        <div className="mt-2 flex items-center gap-3">
          <img src={state.preview} alt="" className="max-h-16 rounded border border-ink-700" />
          <div className="flex-1">
            <div className="text-[12px] text-ink-300">Reading the listing on this computer…</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {state.status === 'failed' && <p className="mt-2 text-[12px] text-red-300">{state.message}</p>}

      {state.status === 'done' && r && t && (
        <div className="mt-2">
          <div className="flex flex-wrap items-start gap-3">
            <img src={state.preview} alt="The screenshot" className="max-h-40 max-w-[45%] rounded border border-ink-700 object-contain" />
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <div className="flex flex-wrap gap-1">
                <Check ok={!t.nonLadder && t.ladder} label={t.nonLadder ? 'Non Ladder' : 'Ladder'} />
                <Check ok={t.pc} label={t.otherPlatform && !t.pc ? t.otherPlatform : 'PC'} />
                <Check ok={t.rotw} label="Reign of the Warlock" />
                <Check ok={!!t.mode && !modeProblem} label={t.mode === 'hardcore' ? 'Hardcore' : t.mode === 'softcore' ? 'Softcore' : 'Softcore / Hardcore?'} />
                <Check ok={r.age !== undefined && r.age <= MAX_LISTING_AGE_DAYS * 86400} label={r.age === undefined ? 'Posted: ?' : `Posted ${ago(r.age)} ago`} />
              </div>
              {errors.map((e) => (
                <p key={e} className="text-[12px] text-red-300">
                  {e}
                </p>
              ))}
              {sideProblem && (
                <button className="rounded border border-gold-600/70 px-2 py-0.5 text-[12px] text-gold-200 hover:bg-gold-600/15" onClick={() => store.tradeSetSide(r!.direction)}>
                  Switch to {r!.direction === 'sell' ? 'Sell' : 'Buy'}
                </button>
              )}
              {r.warnings.map((w) => (
                <p key={w} className="text-[12px] text-amber-300">
                  {w}
                </p>
              ))}
              {r.item && (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-[12.5px] text-ink-200">
                    {r.direction === 'sell' ? 'Buying: ' : ''}
                    {'quantity' in r.item ? `${r.item.quantity}× ` : ''}
                    {r.item.name}
                  </span>
                </div>
              )}
              {r.direction === 'sell' && r.want && <AskLine ask={[r.want]} label="They want:" />}
              {r.ask && <AskLine ask={r.ask} label={r.direction === 'sell' ? 'They give:' : 'Trading for:'} />}
              <div className="flex gap-2 pt-1">
                <button
                  disabled={!!errors.length || !r.item}
                  onClick={add}
                  className="rounded bg-gold-600/80 px-3 py-1 text-[12px] font-semibold text-black hover:bg-gold-500 disabled:bg-ink-700 disabled:text-ink-400"
                >
                  Add to trade
                </button>
                <button className="rounded px-2 py-1 text-[12px] text-ink-400 hover:text-ink-200" onClick={() => setState({ status: 'idle' })}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
          {state.item && <ItemCard item={state.item} className="mt-2 !w-full" />}
          {state.pieces && (
            <div className="mt-2 flex flex-wrap gap-1">
              {state.pieces.map((p) => (
                <span
                  key={p.id}
                  onMouseMove={(e) => tip.show({ item: p.item, x: e.clientX, y: e.clientY })}
                  onMouseLeave={tip.hide}
                  className="cursor-default rounded border border-ink-600 bg-ink-900 px-2 py-0.5 text-[12px] text-q-set"
                >
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
