import { useState } from 'react';
import type { Loc } from '../state/store';
import { drag, dropDragged, useStore } from './context';

/**
 * Drag-and-drop target for a slot-like area (equipment slot, belt cell, stackables board). `locFor` maps the
 * pointer position to a location; the hover state says whether the drop would be accepted.
 */
export function useDrop(locFor: (e: React.DragEvent) => Loc | null) {
  const store = useStore();
  const [hover, setHover] = useState<{ key: string; ok: boolean; reason?: string } | null>(null);
  const editable = !store.settings.readOnly;
  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!editable || !drag.item || !drag.fromDocId) return;
      const loc = locFor(e);
      if (!loc) return;
      e.preventDefault();
      const key = JSON.stringify(loc);
      if (hover?.key === key) {
        e.dataTransfer.dropEffect = hover.ok ? 'move' : 'none';
        return;
      }
      const r = store.check(drag.item, drag.fromDocId, loc);
      e.dataTransfer.dropEffect = r.ok ? 'move' : 'none';
      setHover({ key, ok: r.ok, reason: r.reason });
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHover(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setHover(null);
      if (!editable || !drag.item || !drag.fromDocId) return;
      const loc = locFor(e);
      if (loc) dropDragged(store, loc);
    },
  };
  const hoverLoc = hover ? (JSON.parse(hover.key) as Loc) : null;
  return { handlers, hover, hoverLoc };
}
