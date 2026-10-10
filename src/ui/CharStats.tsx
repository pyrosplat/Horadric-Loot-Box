import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './context';
import {
  AURA_SKILL,
  attackSkills,
  availableForms,
  type Form,
  BREAKPOINTS,
  LEVELLED_SKILLS,
  WEAPONS,
  breakpointStatus,
  characterStats,
  iasTables,
  type BreakpointTable,
  type CharStatsResult,
  type D2Character,
  type ResistRow,
} from '../core';

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
  return (
    <Stat
      label={`${label} resistance`}
      value={<span style={{ color: v < 0 ? '#ff6a5a' : colour }}>{n(v)}%</span>}
      hint={`Gear ${n(r.total)}%${anya ? ` + Anya ${anya}` : ''} · cap ${r.max}%`}
    />
  );
}

/** A three-position slider: Norm, Nightmare, Hell. */
function DiffSlider({ value, onChange }: { value: Diff; onChange: (d: Diff) => void }) {
  const at = DIFFS.findIndex(([d]) => d === value);
  return (
    <div role="radiogroup" aria-label="Difficulty" className="d2-statrow relative mt-[6px] grid grid-cols-3 p-[3px] text-center">
      <span
        className="pointer-events-none absolute bottom-[3px] top-[3px] w-[calc((100%-6px)/3)] bg-gradient-to-b from-[#5a4a22] to-[#3a2e12] shadow-[inset_0_0_0_1px_#b9a979] transition-[left] duration-150"
        style={{ left: `calc(3px + ${at} * (100% - 6px) / 3)` }}
      />
      {DIFFS.map(([d, name]) => (
        <button
          key={d}
          role="radio"
          aria-checked={d === value}
          onClick={() => onChange(d)}
          className={`relative z-10 py-1 font-display text-[11px] uppercase tracking-[.12em] ${d === value ? 'text-gold-200' : 'text-ink-400 hover:text-ink-200'}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

const STAT_LABEL = {
  fcr: 'Faster Cast Rate',
  fhr: 'Faster Hit Recovery',
  fbr: 'Faster Block Rate',
} as const;

/** One breakpoint table as a row of steps: the one you are on is lit, the next one is outlined with what it still needs. */
function BreakpointRow({ table, value }: { table: BreakpointTable; value: number }) {
  const at = breakpointStatus(table, value);
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2 font-display text-[11px] uppercase tracking-[.08em] text-ink-200">
        <span>
          {STAT_LABEL[table.stat]}
          {table.variant && <span className="ml-1.5 normal-case tracking-normal text-ink-400">· {table.variant}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-gold-300">
          {n(value)}% · {at.frames} frames
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-[3px]">
        {table.pct.map((p, i) => (
          <div
            key={p}
            className={`d2-statrow w-[42px] py-[3px] text-center tabular-nums ${
              i === at.index
                ? '!bg-gradient-to-b from-[#5a4a22] to-[#3a2e12] text-gold-200 ring-1 ring-[#b9a979]'
                : i < at.index
                  ? 'text-ink-300'
                  : i === at.index + 1
                    ? 'text-ink-200 outline-dashed outline-1 outline-ink-500'
                    : 'text-ink-600'
            }`}
          >
            <div className="font-display text-[12.5px] leading-tight">{table.start - i}</div>
            <div className="text-[9.5px] leading-tight opacity-80">{p}%</div>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10.5px] text-ink-500">
        {at.next ? `Next: ${at.next.frames} frames at ${at.next.pct}% (+${n(at.next.need)}% more)` : 'Fastest step reached'}
      </p>
    </div>
  );
}

/** The attack speed steps of the weapon in hand: the frames per animation (FPA) and the item IAS each step needs. */
function AttackSpeed({ s }: { s: CharStatsResult }) {
  const [formPick, setForm] = useState<Form>('human');
  const form: Form = availableForms(s.className, s.gearSkills).includes(formPick) ? formPick : 'human';
  const [skill, setSkill] = useState('Standard');
  const [lv, setLv] = useState<Record<string, number>>({});
  const [on, setOn] = useState<Record<string, boolean>>({});
  // only the skills the weapon in hand can use: a bow means bow skills, no Jab or Double Swing with a spear
  const weaponInfo = {
    weaponType: s.weaponType,
    mainIas: s.mainIas,
    off: s.offBase ? { name: s.offBase, type: s.offType, ias: s.offIas } : undefined,
    oneHanded: on.oneHanded,
  };
  const skills = attackSkills(s.className, form, s.gearSkills).filter(
    (k) => k === 'Standard' || !iasTables(s.className, s.weaponBase, s.iasGear, { ...weaponInfo, form, skill: k, gearSkills: s.gearSkills })?.problem,
  );
  const chosen = skills.includes(skill) ? skill : 'Standard';
  // auras on the gear fill in Fanaticism, Burst of Speed and Holy Freeze until you type something else
  const fromGear: Record<string, number> = {
    fanaticism: s.auras[AURA_SKILL.fanaticism] ?? 0,
    burstOfSpeed: s.auras[AURA_SKILL.burstOfSpeed] ?? 0,
    holyFreeze: s.auras[AURA_SKILL.holyFreeze] ?? 0,
  };
  const level = (k: string) => lv[k] ?? fromGear[k] ?? 0;
  const res = iasTables(s.className, s.weaponBase, s.iasGear, {
    skill: chosen,
    form,
    gearSkills: s.gearSkills,
    skillLevel: level('skill'),
    fanaticism: level('fanaticism'),
    burstOfSpeed: level('burstOfSpeed'),
    frenzy: level('frenzy'),
    werewolf: level('werewolf'),
    maul: level('maul'),
    purge: level('purge'),
    holyFreeze: level('holyFreeze'),
    markOfTheBear: on.markOfTheBear,
    decrepify: on.decrepify,
    chilled: on.chilled,
    lethargy: on.lethargy,
    oneHanded: on.oneHanded,
    weaponType: s.weaponType,
    mainIas: s.mainIas,
    off: s.offBase ? { name: s.offBase, type: s.offType, ias: s.offIas } : undefined,
  });
  if (!res) return null;
  const head = res.tables[0];
  const twoHandedSword = s.className === 'Barbarian' && WEAPONS[res.weapon]?.[1] === '2HS';
  const box = 'flex items-center gap-1 text-[11px] text-ink-300';
  const input = 'w-11 rounded-sm border border-ink-600 bg-ink-800 px-1 py-px text-center tabular-nums text-ink-100';
  const num = (k: string, label: string) => (
    <label className={box} key={k} title={lv[k] === undefined && fromGear[k] ? 'Filled in from your gear; type a level to change it' : undefined}>
      {label}
      <input
        type="number"
        min={0}
        max={60}
        value={level(k)}
        onChange={(e) => setLv({ ...lv, [k]: Math.max(0, Math.min(60, Math.floor(Number(e.target.value)) || 0)) })}
        className={`${input} ${lv[k] === undefined && fromGear[k] ? 'border-gold-500 text-gold-300' : ''}`}
        aria-label={`${label} level (0 for off)`}
      />
    </label>
  );
  const check = (k: string, label: string) => (
    <label className={box} key={k}>
      <input type="checkbox" checked={!!on[k]} onChange={(e) => setOn({ ...on, [k]: e.target.checked })} /> {label}
    </label>
  );
  const select = (value: string, set: (v: string) => void, options: string[], label: string) => (
    <label className={box}>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} className="rounded-sm border border-ink-600 bg-ink-800 px-1 py-px text-ink-100">
        {options.map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
    </label>
  );
  const weapons = res.weapon === 'None' ? 'Bare hands' : res.weapon;
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-2 font-display text-[11px] uppercase tracking-[.08em] text-ink-200">
        <span>
          Attack speed
          <span className="ml-1.5 normal-case tracking-normal text-ink-400">
            · {weapons}
            {s.offBase && res.tables.length > 1 ? ` + ${s.offBase}` : ''}
          </span>
        </span>
        {head && (
          <span className="shrink-0 tabular-nums text-gold-300" title="Frames per animation: how many frames the whole attack animation takes">
            {head.label} FPA
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1" data-nodrag>
        {select(form, (v) => setForm(v as Form), availableForms(s.className, s.gearSkills), 'Form')}
        {skills.length > 1 && select(chosen, setSkill, skills, 'Skill')}
        {LEVELLED_SKILLS.includes(chosen) && num('skill', `${chosen} level`)}
      </div>
      {res.problem && <p className="mt-1 text-[11px] text-[#d98c8c]">{res.problem}</p>}
      {res.tables.map((t, ti) => {
        const at = t.steps.reduce((a, st, i) => (t.current >= st.need ? i : a), 0);
        const next = t.steps[at + 1];
        return (
          <div key={ti} className="mt-1.5">
            {(t.variant || res.tables.length > 1) && (
              <p className="text-[10.5px] uppercase tracking-[.08em] text-ink-400">
                {t.variant ?? `Table ${ti + 1}`}
                {t.note && <span className="ml-1.5 normal-case tracking-normal text-ink-500">· {t.note}</span>}
                <span className="ml-1.5 tabular-nums normal-case tracking-normal text-gold-300">
                  {n(t.current)}% · {t.label} FPA
                </span>
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-[3px]">
              {t.steps.map((st, i) => (
                <div
                  key={`${st.need}-${i}`}
                  className={`d2-statrow min-w-[42px] px-1 py-[3px] text-center tabular-nums ${
                    i === at
                      ? '!bg-gradient-to-b from-[#5a4a22] to-[#3a2e12] text-gold-200 ring-1 ring-[#b9a979]'
                      : i < at
                        ? 'text-ink-300'
                        : i === at + 1
                          ? 'text-ink-200 outline-dashed outline-1 outline-ink-500'
                          : 'text-ink-600'
                  }`}
                >
                  <div className="font-display text-[12.5px] leading-tight">{st.label ?? st.frames}</div>
                  <div className="text-[9.5px] leading-tight opacity-80">{st.need}%</div>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10.5px] text-ink-500">
              {next ? `Next: ${next.label ?? next.frames} FPA at ${next.need}% (+${n(next.need - t.current)}% more)` : 'Fastest step reached'}
            </p>
          </div>
        );
      })}
      <p className="mt-2 text-[10.5px] uppercase tracking-[.08em] text-ink-400">Skills and effects on you</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1" data-nodrag>
        {num('fanaticism', 'Fanaticism')}
        {num('burstOfSpeed', 'Burst of Speed')}
        {num('holyFreeze', 'Holy Freeze')}
        {s.className === 'Barbarian' && num('frenzy', 'Frenzy')}
        {s.className === 'Warlock' && num('purge', 'Purge')}
        {form === 'werewolf' && num('werewolf', 'Werewolf')}
        {form === 'werebear' && s.className === 'Druid' && num('maul', 'Maul')}
        {check('markOfTheBear', 'Mark of the Bear')}
        {check('chilled', 'Chilled')}
        {check('decrepify', 'Decrepify')}
        {check('lethargy', 'Lethargy')}
        {twoHandedSword && check('oneHanded', 'One-handed')}
      </div>
    </div>
  );
}

function Breakpoints({ s }: { s: CharStatsResult }) {
  const tables = BREAKPOINTS[s.className] ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <AttackSpeed s={s} />
      {tables.map((t) => (
        <BreakpointRow key={`${t.stat}-${t.variant ?? ''}`} table={t} value={s[t.stat]} />
      ))}
      <p className="text-[10.5px] leading-snug text-ink-500">
        From your worn gear and inventory charms. Where a class has one table per weapon type, the one for the weapon you use applies. Cast rate, hit recovery
        and block rate each have their own steps; more percent only helps once it reaches the next one. Attack speed is in frames per animation (FPA) for the
        attack skill you pick, in human form, with the weapon in your main hand; set the auras and curses that apply to you. Attack speed method and data:
        Warren1001's IAS Calculator (warren1001.github.io/IAS_Calculator), built on RuffnecKk's animation data.
      </p>
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
  const [tab, setTab] = useState<'stats' | 'breakpoints'>('stats');
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
      setPos({
        x: clamp(m.clientX - sx, -left0, window.innerWidth - r.width - left0),
        y: clamp(m.clientY - sy, -top0, window.innerHeight - r.height - top0),
      });
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
        className="pointer-events-auto relative flex max-h-[92vh] w-[860px] max-w-full cursor-move touch-none select-none gap-4 rounded-lg border-2 border-gold-500 bg-ink-900 p-4 shadow-[0_0_0_1px_#000,0_10px_40px_rgba(0,0,0,.8)]"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <button className="d2-close absolute right-3 top-3 z-10 cursor-pointer" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
          ×
        </button>

        <div className="flex w-[480px] min-w-0 flex-none cursor-default flex-col">
          <div className="mb-3 flex cursor-move items-center justify-center gap-6">
            {(['stats', 'breakpoints'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`!border-0 !bg-none !bg-transparent !p-0 !shadow-none font-display text-[15px] uppercase tracking-[.25em] ${tab === t ? 'text-[#b9a979] underline decoration-1 underline-offset-[6px]' : 'text-ink-500 hover:text-ink-300'}`}
              >
                {t === 'stats' ? 'Character' : 'Breakpoints'}
              </button>
            ))}
          </div>
          {tab === 'breakpoints' ? (
            <Breakpoints s={s} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="d2-statrow mb-3 px-3 py-2">
                <p className="font-display text-[19px] uppercase tracking-[.06em] text-gold-300">{s.name}</p>
                <p className="flex justify-between text-[10.5px] uppercase tracking-[.1em] text-ink-400">
                  <span>
                    Level {s.level} {s.className}
                  </span>
                  <span>Experience {n(s.experience)}</span>
                </p>
              </div>

              <div className="mb-[6px] grid grid-cols-2 gap-x-2">
                <Stat label="Attack damage" value={`${n(s.damage.min)}–${n(s.damage.max)}`} tone="text-[#6fdc6f]" />
                <Stat label="Attack rating" value={n(s.attackRating)} />
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
                Worked out from {s.itemCount} worn items and inventory charms (not the weapon swap), plus Anya's resistance rewards for the quests you've
                finished. The game also counts skills, auras and buffs, so treat life, mana and speeds as gear totals.
              </p>
            </div>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 cursor-default flex-col">
          <h2 className={`${head} mb-3 cursor-move`}>Advanced Stats</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto bg-[#0a0a0b] p-2 shadow-[inset_0_0_0_1px_#34343a]">
            {s.advanced.length ? (
              s.advanced.map((l) => (
                <p key={l.text} className="d2-statrow px-2 py-[7px] text-center font-display text-[11.5px] uppercase tracking-[.06em] text-ink-100">
                  {l.text}
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
