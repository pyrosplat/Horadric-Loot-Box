import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Store } from '../state/store';
import type { D2Item } from '../core';

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreContext missing');
  useSyncExternalStore(s.subscribe, s.getRev);
  return s;
}

/** The item currently being dragged (HTML5 DnD can only carry strings, so the object lives here). */
export const drag: { item?: D2Item; fromDocId?: string; items?: D2Item[]; count?: number } = {};

/** Shift takes this many of a stackable (rune, gem, key…) at once. */
export const SHIFT_COUNT = 3;
/** How many to move for a click/drag: 3 with Shift, else 1. */
export const countFor = (e: { shiftKey?: boolean } | undefined) => (e?.shiftKey ? SHIFT_COUNT : 1);

/** A sidebar entry (character, stash or vault) being dragged onto a pane. */
export const docDrag: { id?: string } = {};

/** Drops the current drag (one item or a whole selection) at `loc`. */
export function dropDragged(store: Store, loc: Parameters<Store['move']>[2]) {
  if (!drag.item || !drag.fromDocId) return;
  if (drag.items && drag.items.length > 1) store.moveMany(drag.items, drag.fromDocId, loc);
  else if ((drag.count ?? 1) > 1) store.moveStackable(drag.item, drag.fromDocId, loc, drag.count!);
  else store.move(drag.item, drag.fromDocId, loc);
}

export function startDrag(store: Store, e: React.DragEvent, item: D2Item, docId: string, label: string) {
  drag.item = item;
  drag.fromDocId = docId;
  drag.items = store.groupFor(item, docId);
  drag.count = drag.items.length > 1 ? 1 : countFor(e);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.items.length > 1 ? `${drag.items.length} items` : drag.count! > 1 ? `${drag.count} × ${label}` : label);
}

export function endDrag() {
  drag.item = undefined;
  drag.fromDocId = undefined;
  drag.items = undefined;
  drag.count = undefined;
}
