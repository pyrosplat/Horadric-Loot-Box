import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './context';
import { characterStats, type CharStatsResult, type D2Character, type ResistRow } from '../core';

const n = (v: number) => Math.round(v).toLocaleString();

/** One stat as the in-game character screen draws it: a dark label box beside a dark value box. */
function Stat({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: React.ReactNode }) {
  return (
    <div className="d2-statrow flex items-stretch text-[13px]">
      <span className="flex flex-1 items-center px-2.5 py-[6px] font-display text-[11px] uppercase tracking-[.08em] text-ink-200">{label}</span>
      <span className="d2-statval flex min-w-[84px] flex-col items-end justify-center px-2.5 py-[3px] text-right">
        <span className={`tabular-nums ${tone ?? 'text-ink-100'}`}>{value}</span>
        {hint && <span className="text-[9.5px] leading-tight text-ink-500">{hint}</span>}
      </span>
    </div>
  );
}

/** An attribute: a label box with its value in a small box beside it, as in the game. */
function Attr({ label, value }: { label: string; value: number }) {
  return (
    <div className="d2-statrow flex items-stretch self-center text-[13px]">
      <span className="flex flex-1 items-center px-2.5 py-[7px] font-display text-[11px] uppercase tracking-[.08em] text-ink-200">{label}</span>
      <span className="d2-statval flex min-w-[46px] items-center justify-center px-2 tabular-nums text-[#8c8cff]">{n(value)}</span>
    </div>
  );
}

type Diff = 'normal' | 'nightmare' | 'hell';
const DIFFS: [Diff, string][] = [
  ['normal', 'Norm'],
  ['nightmare', 'Nightmare'],
  ['hell', 'Hell'],
];

/** The resistance the game shows in the chosen difficulty: gear total less that difficulty's penalty, held to the cap. */
function Res({ label, r, colour, diff, anya }: { label: string; r: ResistRow; colour: string; diff: Diff; anya: number }) {
  const v = r[diff];
  return <Stat label={`${label} resistance`} value={<span style={{ color: v < 0 ? '#ff6a5a' : colour }}>{n(v)}%</span>} hint={`Gear ${n(r.total)}%${anya ? ` + Anya ${anya}` : ''} · cap ${r.max}%`} />;
}

/** A three-position slider: Norm, Nightmare, Hell. */
function DiffSlider({ value, onChange }: { value: Diff; onChange: (d: Diff) => void }) {
  const at = DIFFS.findIndex(([d]) => d === value);
  return (
    <div role="radiogroup" aria-label="Difficulty" className="d2-statrow relative mt-[6px] grid grid-cols-3 p-[3px] text-center">
      <span className="pointer-events-none absolute bottom-[3px] top-[3px] w-[calc((100%-6px)/3)] bg-gradient-to-b from-[#5a4a22] to-[#3a2e12] shadow-[inset_0_0_0_1px_#b9a979] transition-[left] duration-150" style={{ left: `calc(3px + ${at} * (100% - 6px) / 3)` }} />
      {DIFFS.map(([d, name]) => (
        <button key={d} role="radio" aria-checked={d === value} onClick={() => onChange(d)} className={`relative z-10 py-1 font-display text-[11px] uppercase tracking-[.12em] ${d === value ? 'text-gold-200' : 'text-ink-400 hover:text-ink-200'}`}>
          {name}
        </button>
      ))}
    </div>
  );
}

/**
 * The character screen, worked out from the save and what the character wears (weapon swap excluded) plus charms in the
 * inventory: Character and Advanced Stats in one box, like the game's. It follows gear changes live, doesn't block the
 * screen under it, and moves when you drag it by the frame (it stays inside the window). The red box or Esc closes it.
 */
export function CharStatsDialog({ ch, onClose }: { ch: D2Character; onClose: () => void }) {
  const store = useStore();
  // worked out again whenever the store changes (gear moved, swapped, removed), so the numbers follow the equipment live
  const s: CharStatsResult = useMemo(() => characterStats(ch), [ch, ch.items, store.rev]);
  const [diff, setDiff] = useState<Diff>('hell');
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,[data-nodrag]') || !box.current) return;
    e.preventDefault();
    const r = box.current.getBoundingClientRect();
    const [left0, top0] = [r.left - pos.x, r.top - pos.y];
    const [sx, sy] = [e.clientX - pos.x, e.clientY - pos.y];
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const move = (m: PointerEvent) =>
      setPos({ x: clamp(m.clientX - sx, -left0, window.innerWidth - r.width - left0), y: clamp(m.clientY - sy, -top0, window.innerHeight - r.height - top0) });
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const head = 'text-center font-display text-[15px] uppercase tracking-[.25em] text-[#b9a979]';
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6">
      <div
        ref={box}
        role="dialog"
        aria-label="Character"
        onPointerDown={drag}
        className="pointer-events-auto relative flex max-h-[92vh] w-[860px] max-w-full cursor-move touch-none select-none gap-4 bg-ink-900 p-4 shadow-tip"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <button className="d2-close absolute right-3 top-3 z-10 cursor-pointer" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
          ×
        </button>

        <div className="flex w-[480px] min-w-0 flex-none cursor-default flex-col" data-nodrag>
          <h2 className={`${head} mb-3 cursor-move`} data-drag>
            Character
          </h2>
          <div className="d2-statrow mb-3 px-3 py-2">
            <p className="font-display text-[19px] uppercase tracking-[.06em] text-gold-300">{s.name}</p>
            <p className="flex justify-between text-[10.5px] uppercase tracking-[.1em] text-ink-400">
              <span>
                Level {s.level} {s.className}
              </span>
              <span>Experience {n(s.experience)}</span>
            </p>
          </div>

          <div className="grid grid-cols-[170px_1fr] gap-x-3 gap-y-[6px]">
            <Attr label="Strength" value={s.strength} />
            <Stat label="Defense" value={n(s.defense)} />
            <Attr label="Dexterity" value={s.dexterity} />
            <Stat label="Stamina" value={n(s.stamina)} />
            <Attr label="Vitality" value={s.vitality} />
            <Stat label="Life" value={n(s.life)} />
            <Attr label="Energy" value={s.energy} />
            <Stat label="Mana" value={n(s.mana)} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-[3px]">
            <Res label="Fire" r={s.fire} colour="#ff8a5a" diff={diff} anya={s.anya[diff]} />
            <Res label="Lightning" r={s.lightning} colour="#ffe45a" diff={diff} anya={s.anya[diff]} />
            <Res label="Cold" r={s.cold} colour="#7fb6ff" diff={diff} anya={s.anya[diff]} />
            <Res label="Poison" r={s.poison} colour="#7bd64a" diff={diff} anya={s.anya[diff]} />
          </div>
          <DiffSlider value={diff} onChange={setDiff} />

          <p className="mt-3 text-center text-[10.5px] leading-snug text-ink-500">
            Worked out from {s.itemCount} worn items and inventory charms (not the weapon swap), plus Anya's resistance rewards for the quests you've finished. The game also counts skills, auras and buffs, so treat life, mana
            and speeds as gear totals. Attack damage and rating aren't worked out.
          </p>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 cursor-default flex-col" data-nodrag>
          <h2 className={`${head} mb-3 cursor-move`}>Advanced Stats</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto bg-[#0a0a0b] p-2 shadow-[inset_0_0_0_1px_#34343a]">
            {s.advanced.length ? (
              s.advanced.map((l) => (
                <p key={l} className="d2-statrow px-2 py-[7px] text-center font-display text-[11.5px] uppercase tracking-[.06em] text-ink-100">
                  {l}
                </p>
              ))
            ) : (
              <p className="p-3 text-center text-[12px] text-ink-500">Nothing here: no gear bonuses to list.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
