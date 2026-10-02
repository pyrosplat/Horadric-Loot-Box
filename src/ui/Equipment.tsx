import { itemName, mercGearProblem, type D2Character, type D2Item, type MercInfo } from '../core';
import { itemKey } from '../state/store';
import { cellBackground } from './Grid';
import { useStore, countFor } from './context';
import { ItemTile } from './ItemTile';
import { useDrop } from './useDrop';
import { uiZoom } from './scale';

/** Body locations (see BODY_LOCATIONS in core/item.ts). */
export const LOC = { head: 1, neck: 2, torso: 3, rightHand: 4, leftHand: 5, rightRing: 6, leftRing: 7, belt: 8, feet: 9, gloves: 10, rightSwap: 11, leftSwap: 12 } as const;

interface SlotDef {
  loc: number;
  /** Position and size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

// Paper doll, laid out like the in-game character screen: weapon | helm, armor, belt | amulet, shield,
// with gloves, rings and boots along the bottom.
const DOLL: SlotDef[] = [
  { loc: LOC.head, x: 2, y: 0, w: 2, h: 2, label: 'Helm' },
  { loc: LOC.neck, x: 4, y: 0.5, w: 1, h: 1, label: 'Amulet' },
  { loc: LOC.rightHand, x: 0, y: 2.2, w: 2, h: 4, label: 'Weapon' },
  { loc: LOC.torso, x: 2, y: 2.2, w: 2, h: 3, label: 'Armor' },
  { loc: LOC.leftHand, x: 4, y: 2.2, w: 2, h: 4, label: 'Shield' },
  { loc: LOC.belt, x: 2, y: 5.4, w: 2, h: 1, label: 'Belt' },
  { loc: LOC.gloves, x: 0, y: 6.6, w: 2, h: 2, label: 'Gloves' },
  { loc: LOC.rightRing, x: 2, y: 7.2, w: 1, h: 1, label: 'Ring' },
  { loc: LOC.leftRing, x: 3, y: 7.2, w: 1, h: 1, label: 'Ring' },
  { loc: LOC.feet, x: 4, y: 6.6, w: 2, h: 2, label: 'Boots' },
];

const SWAP: SlotDef[] = [
  { loc: LOC.rightSwap, x: 0, y: 0, w: 2, h: 4, label: 'Swap Right' },
  { loc: LOC.leftSwap, x: 0, y: 4.25, w: 2, h: 4, label: 'Swap Left' },
];

const MERC_WORN: SlotDef[] = [
  { loc: LOC.head, x: 0, y: 0, w: 2, h: 2, label: 'Helm' },
  { loc: LOC.torso, x: 0, y: 2.2, w: 2, h: 3, label: 'Armor' },
  { loc: LOC.rightHand, x: 2.2, y: 0, w: 2, h: 4, label: 'Weapon' },
];
const MERC_SHIELD: SlotDef = { loc: LOC.leftHand, x: 2.2, y: 4.2, w: 2, h: 2, label: 'Shield' };
const MERC_SECOND: SlotDef = { loc: LOC.leftHand, x: 4.4, y: 0, w: 2, h: 4, label: 'Weapon' };

/**
 * A mercenary's slots: helm, armor and a weapon, plus a shield (Iron Wolves) or a second weapon (the Frenzy
 * Barbarian). The second hand is also shown when the kind of mercenary isn't known or something is already in it.
 */
function mercSlots(info: MercInfo | undefined, items: D2Item[]): SlotDef[] {
  const off = info?.gear?.offHand;
  if (off === 'weapon') return [...MERC_WORN, MERC_SECOND];
  if (off === 'shield' || !info?.gear || items.some((i) => i.bodyLoc === LOC.leftHand)) return [...MERC_WORN, MERC_SHIELD];
  return MERC_WORN;
}

export function Panel({ title, children, className, right }: { title: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section className={`rounded-md border border-[#2e2e2e] bg-[#161616] px-3 pb-3 pt-2 ${className ?? ''}`}>
      <div className="relative mb-2 flex items-center justify-center">
        <h3 className="font-display text-[10.5px] uppercase tracking-[.22em] text-[#8a8a8a]">{title}</h3>
        {right && <div className="absolute right-0 top-1/2 -translate-y-1/2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

function Slot({ docId, pane, area, s, item, cell, px, tipExtra }: { docId: string; pane: 0 | 1; area: 'equip' | 'merc'; s: SlotDef; item?: D2Item; cell: number; px: (v: number) => number; tipExtra: string }) {
  const store = useStore();
  const { handlers, hover } = useDrop(() => ({ docId, area, bodyLoc: s.loc }));
  const box = { w: s.w * cell - 2, h: s.h * cell - 2 };
  const canDrag = !store.settings.readOnly;
  return (
    <div
      {...handlers}
      className={`absolute rounded-[2px] border bg-[linear-gradient(135deg,#1a1a1a,#101010)] ${hover ? (hover.ok ? 'border-emerald-400/80 ring-1 ring-emerald-400/60' : 'border-red-500/70 ring-1 ring-red-500/50') : 'border-[#2e2e2e]'}`}
      style={{ left: px(s.x), top: px(s.y), width: box.w + 2, height: box.h + 2 }}
      title={hover && !hover.ok ? hover.reason : undefined}
    >
      {item ? (
        <ItemTile
          key={itemKey(item)}
          item={item}
          docId={docId}
          cell={cell}
          draggable={canDrag}
          box={box}
          style={{ left: -1, top: -1, width: box.w + 2, height: box.h + 2 }}
          tipExtra={canDrag ? `${tipExtra} · drag to move · double-click to send to the other pane` : tipExtra}
          pane={pane}
          onDoubleClick={canDrag ? () => store.quickMove(item, docId, pane) : undefined}
        />
      ) : (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[10px] leading-tight text-[#4a4a4a]">{s.label}</span>
      )}
    </div>
  );
}

function Slots({ docId, pane, area, slots, items, cell, gap, tipExtra }: { docId: string; pane: 0 | 1; area: 'equip' | 'merc'; slots: SlotDef[]; items: D2Item[]; cell: number; gap: number; tipExtra: string }) {
  // positions are in cells; each cell of offset also adds half a gap so neighbouring slots don't touch
  const px = (v: number) => Math.round(v * (cell + gap / 2));
  const width = Math.max(...slots.map((s) => px(s.x) + s.w * cell));
  const height = Math.max(...slots.map((s) => px(s.y) + s.h * cell));
  return (
    <div className="relative" style={{ width, height }}>
      {slots.map((s) => (
        <Slot key={`${s.loc}-${s.x}-${s.y}`} docId={docId} pane={pane} area={area} s={s} item={items.find((i) => i.bodyLoc === s.loc)} cell={cell} px={px} tipExtra={tipExtra} />
      ))}
    </div>
  );
}

export function EquipmentPanel({ docId, pane, equipped, cell }: { docId: string; pane: 0 | 1; equipped: D2Item[]; cell: number }) {
  const gap = 6;
  return (
    <Panel title="Equipment">
      <div className="flex items-start gap-4">
        <Slots docId={docId} pane={pane} area="equip" slots={DOLL} items={equipped} cell={cell} gap={gap} tipExtra="Equipped" />
        <div className="border-l border-[#2a2a2a] pl-4">
          <p className="mb-1.5 text-center font-display text-[10px] uppercase tracking-[.2em] text-[#8a8a8a]">Swap</p>
          <Slots docId={docId} pane={pane} area="equip" slots={SWAP} items={equipped} cell={cell} gap={gap} tipExtra="Weapon swap" />
        </div>
      </div>
    </Panel>
  );
}

export function MercPanel({ docId, pane, ch, cell, info }: { docId: string; pane: 0 | 1; ch: D2Character; cell: number; info?: MercInfo }) {
  const items = ch.mercItems;
  const gear = info?.gear;
  // gear this kind of mercenary can't use in the game (put there before the app checked, or by another tool)
  const wrong = items.filter((i) => mercGearProblem(ch, i, i.bodyLoc));
  const uses = gear && `Uses ${gear.offHand === 'weapon' ? `two ${gear.weaponText}` : gear.weaponText}${gear.offHand === 'shield' ? ' and a shield' : ''}`;
  return (
    <Panel title="Mercenary">
      {info && (
        <div className="-mt-1 mb-2 text-center text-[11.5px] leading-snug" title={`Hired in Act ${info.act} ${info.difficulty} · ${info.exp.toLocaleString()} experience`}>
          <div className="text-ink-200">
            {info.name && <span className="text-gold-300">{info.name} · </span>}
            {info.level > 0 && <>Level {info.level} </>}
            {info.className}
          </div>
          <div className="text-ink-400">
            {[info.role, info.act ? `Act ${info.act} ${info.difficulty}` : ''].filter(Boolean).join(' · ')}
          </div>
          {uses && <div className="text-ink-500">{uses}</div>}
        </div>
      )}
      <Slots docId={docId} pane={pane} area="merc" slots={mercSlots(info, items)} items={items} cell={cell} gap={6} tipExtra="Mercenary" />
      {wrong.length > 0 && (
        <p className="mx-auto mt-2 max-w-[15rem] text-center text-[11px] leading-snug text-amber-300">
          {wrong.map(itemName).join(', ')} can&rsquo;t be used by this mercenary in the game. Take {wrong.length === 1 ? 'it' : 'them'} off before you play.
        </p>
      )}
    </Panel>
  );
}

/** Potion slots the equipped belt gives: 4 without a belt, else 8 / 12 / 16 from belts.txt. */
export function beltSlots(belt: D2Item | undefined): number {
  return belt?.def?.beltBoxes ?? 4;
}

/**
 * The potion belt: slots 0–3 are the bottom row in game, so rows are drawn bottom-up. Rows the equipped belt
 * doesn't have are greyed out.
 */
export function BeltPanel({ docId, pane, items, belt, cell }: { docId: string; pane: 0 | 1; items: D2Item[]; belt?: D2Item; cell: number }) {
  const store = useStore();
  const rows = 4;
  const size = cell;
  const usable = Math.max(1, Math.min(rows, Math.ceil(beltSlots(belt) / 4)));
  const locked = rows - usable;
  const why = belt ? `${belt.def?.name ?? 'This belt'} holds ${usable * 4} potions` : 'No belt equipped: 4 potion slots';
  const slotAt = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const z = uiZoom();
    const col = Math.max(0, Math.min(3, Math.floor((e.clientX - r.left) / z / size)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - r.top) / z / size)));
    return (rows - 1 - row) * 4 + col;
  };
  const { handlers, hover, hoverLoc } = useDrop((e) => ({ docId, area: 'belt', x: slotAt(e) }));
  const canDrag = !store.settings.readOnly;
  const hx = hoverLoc && hoverLoc.area === 'belt' ? hoverLoc.x ?? 0 : 0;
  return (
    <Panel title="Belt">
      <div {...handlers} className="relative rounded-[3px] border border-[#2c2c2c] bg-[#111]" style={{ width: 4 * size + 2, height: rows * size + 2, ...cellBackground(size) }} title={hover && !hover.ok ? hover.reason : undefined}>
        {locked > 0 && (
          <div
            className="absolute left-[1px] right-[1px] top-[1px] bg-[#0b0b0b]/80 [background-image:repeating-linear-gradient(135deg,transparent_0_5px,rgba(255,255,255,.035)_5px_7px)]"
            style={{ height: locked * size }}
            title={why}
            aria-label={`${locked * 4} belt slots unavailable`}
          />
        )}
        {hover && (
          <div
            className={`pointer-events-none absolute rounded-sm ${hover.ok ? 'bg-emerald-500/25 ring-1 ring-emerald-400/70' : 'bg-red-500/25 ring-1 ring-red-400/70'}`}
            style={{ left: (hx % 4) * size + 1, top: (rows - 1 - Math.floor(hx / 4)) * size + 1, width: size, height: size }}
          />
        )}
        {items.map((it) => {
          const col = it.x % 4;
          const row = rows - 1 - Math.floor(it.x / 4);
          return (
            <ItemTile
              key={itemKey(it)}
              item={it}
              docId={docId}
              cell={size}
              draggable={canDrag}
              style={{ left: col * size + 2, top: row * size + 2 }}
              tipExtra="Belt"
              pane={pane}
              onDoubleClick={canDrag ? (e) => store.quickMove(it, docId, pane, countFor(e)) : undefined}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-center text-[10.5px] text-[#6a6a6a]">{usable * 4} slots</p>
    </Panel>
  );
}
