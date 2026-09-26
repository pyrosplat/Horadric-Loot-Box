import { useEffect, useRef, useState } from 'react';
import { characterBelt, characterEquipped, characterGridItems, gridDims, mercInfo, type D2Character, type D2Item } from '../core';
import { desc, itemKey } from '../state/store';
import { useStore } from './context';
import { BeltPanel, EquipmentPanel, MercPanel, Panel } from './Equipment';
import { GoldBar } from './Gold';
import { Grid } from './Grid';
import { QUALITY_TEXT, useTooltip } from './Tooltip';

const EDITION = ['', 'Classic', 'Lord of Destruction', 'Reign of the Warlock'];

export function CharacterView({ docId, ch, pane, matches }: { docId: string; ch: D2Character; pane: 0 | 1; matches?: (i: D2Item) => boolean }) {
  const store = useStore();
  const cell = store.showArt ? 38 : 34;
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vaultId = [...store.docs.values()].find((d) => d.doc?.kind === 'vault')?.id;
  const allToVault = (area: 'inventory' | 'stash' | 'cube') =>
    vaultId ? (
      <button
        className="rounded px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-800 hover:text-gold-300"
        title="Move everything here into the first vault"
        onClick={() => store.moveAllToVault(docId, area, 0, vaultId)}
      >
        All → vault
      </button>
    ) : null;
  const grid = (area: 'inventory' | 'stash' | 'cube') => (
    <Grid docId={docId} area={area} cols={gridDims(ch, area).w} rows={gridDims(ch, area).h} items={characterGridItems(ch, area)} editable pane={pane} matches={matches} cell={cell} />
  );
  const stash = (
    <Panel title="Personal stash" right={allToVault('stash')}>
      {grid('stash')}
      <div className="mt-2">
        <GoldBar gref={{ docId, kind: 'stash' }} label="Gold" />
      </div>
    </Panel>
  );
  // Three columns (stash beside the belt/cube/mercenary column) when the pane is wide enough; otherwise the
  // stash goes straight under the inventory instead of wrapping below the taller right-hand column.
  const panelW = gridDims(ch, 'stash').w * cell + 28;
  const threeCols = width >= panelW * 2 + (4 * cell + 28 + 60) + 24;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-300">
        <span className="font-display text-lg font-semibold text-gold-300">{ch.name}</span>
        <span>
          Level {ch.level} {ch.className}
        </span>
        <Badge tone={ch.gameVersion === 3 ? 'gold' : 'plain'}>{EDITION[ch.gameVersion] ?? 'Unknown'}</Badge>
        {ch.hardcore && <Badge tone="red">Hardcore</Badge>}
        {ch.ladder && <Badge>Ladder</Badge>}
        {ch.dead && ch.hardcore && <Badge tone="red">Dead</Badge>}
        <span className="ml-auto text-ink-400">
          Gold {(ch.stats.gold ?? 0).toLocaleString()} · Stash {(ch.stats.goldbank ?? 0).toLocaleString()}
        </span>
      </div>
      {ch.warnings.length > 0 && <div className="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-[12px] text-amber-200">{ch.warnings.join(' · ')}</div>}
      <div ref={boxRef} className="flex flex-wrap items-start gap-3">
        <div className="space-y-3">
          <EquipmentPanel docId={docId} pane={pane} equipped={characterEquipped(ch)} cell={cell} />
          <Panel title="Inventory" right={allToVault('inventory')}>
            {grid('inventory')}
            <div className="mt-2">
              <GoldBar gref={{ docId, kind: 'inventory' }} label="Gold" />
            </div>
          </Panel>
          {!threeCols && stash}
        </div>
        <div className="space-y-3">
          <BeltPanel docId={docId} pane={pane} items={characterBelt(ch)} belt={characterEquipped(ch).find((i) => i.bodyLoc === 8)} cell={cell} />
          <Panel title="Horadric Cube">{grid('cube')}</Panel>
          {(ch.mercSplit || ch.mercItems.length > 0) && <MercPanel docId={docId} pane={pane} items={ch.mercItems} cell={cell} info={mercInfo(ch)} />}
        </div>
        {threeCols && stash}
        {ch.corpseItems.length > 0 && <ReadOnlyList title="Corpse" items={ch.corpseItems} label={() => ''} />}
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'gold' | 'red' }) {
  const cls = tone === 'gold' ? 'border-gold-600/60 text-gold-300 bg-gold-600/10' : tone === 'red' ? 'border-red-800 text-red-300 bg-red-900/20' : 'border-ink-600 text-ink-300';
  return <span className={`rounded border px-1.5 py-[1px] text-[10px] uppercase tracking-wider ${cls}`}>{children}</span>;
}

function ReadOnlyList({ title, items, label }: { title: string; items: D2Item[]; label: (i: D2Item) => string }) {
  const tip = useTooltip();
  if (!items.length) return null;
  return (
    <Panel title={`${title} · read-only`}>
      <ul className="min-w-[220px] space-y-[2px] text-[12px]">
        {items.map((it) => {
          const d = desc(it);
          return (
            <li
              key={itemKey(it)}
              className="flex cursor-default justify-between gap-3 rounded px-1.5 py-[2px] hover:bg-ink-800"
              onMouseMove={(e) => tip.show({ item: it, x: e.clientX, y: e.clientY })}
              onMouseLeave={tip.hide}
            >
              <span className={`truncate ${QUALITY_TEXT[d.qualityClass]}`}>{d.name}</span>
              <span className="shrink-0 text-ink-500">{label(it)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
