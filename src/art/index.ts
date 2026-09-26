import { GD, Quality, type D2Item } from '../core';

/** What the host returns after opening the player's game data. */
export interface ArtInfo {
  kind: 'casc' | 'folder' | 'demo';
  path: string;
  /** Sprite keys like `weapon/axe/hand_axe` (lower case, no extension). May be empty if the storage can't be listed. */
  sprites: string[];
  items_json?: string | null;
  uniques_json?: string | null;
  sets_json?: string | null;
}

export interface ArtBackend {
  detectInstalls(): Promise<string[]>;
  pickFolder(): Promise<string | null>;
  open(path: string): Promise<ArtInfo>;
  close(): Promise<void>;
  /** Only needed when `sprites` is empty: returns which keys exist. */
  probe(keys: string[]): Promise<string[]>;
  url(key: string): string;
}

/** Lower case, non-alphanumerics collapsed to `_` (how the HD asset files and json keys are named). */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Pulls `key -> asset` pairs out of the HD item json files, whatever their exact nesting. */
export function parseAssetMap(text: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!text) return out;
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    // tolerate trailing commas, which Blizzard's json files sometimes have
    try {
      data = JSON.parse(text.replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      return out;
    }
  }
  const take = (key: string, v: unknown) => {
    if (typeof v === 'string') out.set(key, v);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const s = o.asset ?? o.normal ?? o.Asset ?? Object.values(o).find((x) => typeof x === 'string');
      if (typeof s === 'string') out.set(key, s);
    }
  };
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) take(k, x);
  };
  visit(data);
  return out;
}

const CATEGORY = { weapon: 'weapon/', armor: 'armor/', misc: 'misc/' } as const;

export class ArtIndex {
  readonly sprites: Set<string>;
  readonly byBase = new Map<string, string[]>();
  readonly items: Map<string, string>;
  readonly uniques = new Map<string, string>();
  readonly sets = new Map<string, string>();
  /** Filled by probing when the storage can't be listed. */
  readonly probed = new Map<string, boolean>();
  private cache = new Map<string, string | null>();

  constructor(
    readonly info: ArtInfo,
    readonly url: (key: string) => string,
  ) {
    this.sprites = new Set(info.sprites.map((s) => s.toLowerCase()));
    for (const s of this.sprites) {
      const base = s.slice(s.lastIndexOf('/') + 1);
      const list = this.byBase.get(base) ?? [];
      list.push(s);
      this.byBase.set(base, list);
    }
    this.items = new Map([...parseAssetMap(info.items_json)].map(([k, v]) => [k.trim(), v.toLowerCase()]));
    for (const [k, v] of parseAssetMap(info.uniques_json)) this.uniques.set(norm(k), v.toLowerCase());
    for (const [k, v] of parseAssetMap(info.sets_json)) this.sets.set(norm(k), v.toLowerCase());
  }

  get listed(): boolean {
    return this.sprites.size > 0;
  }

  private has(key: string): boolean {
    return this.listed ? this.sprites.has(key) : this.probed.get(key) === true;
  }

  /** Every sprite key worth trying for an item, best first. */
  candidates(item: D2Item): string[] {
    const def = item.def;
    if (!def) return [];
    const prefix = CATEGORY[def.kind] ?? '';
    const out: string[] = [];
    const push = (asset: string | undefined) => {
      if (!asset) return;
      const a = asset.toLowerCase().replace(/\\/g, '/').replace(/\.(lowend\.)?sprite$/, '');
      out.push(prefix + a, a, 'weapon/' + a, 'armor/' + a, 'misc/' + a);
    };
    const named = (map: Map<string, string>, name: string | undefined) => {
      if (!name) return;
      const n = norm(name);
      push(map.get(n));
      push(map.get(n.replace(/_/g, '')));
      for (const k of this.byBase.get(n) ?? []) out.push(k);
    };
    if (item.quality === Quality.Unique && item.uniqueId !== undefined) named(this.uniques, GD.uniques[item.uniqueId]?.name);
    if (item.quality === Quality.Set && item.setId !== undefined) named(this.sets, GD.setItems[item.setId]?.name);
    const base = this.items.get(item.code);
    // rings, amulets, charms and jewels have several pictures picked by the item's gfx index
    if (base && item.gfx !== undefined) {
      const n = item.gfx + 1;
      push(`${base}${n}`);
      push(`${base}_${n}`);
      push(`${base}${String(n).padStart(2, '0')}`);
    }
    push(base);
    const nameGuess = norm(def.name);
    for (const k of this.byBase.get(nameGuess) ?? []) out.push(k);
    return [...new Set(out)];
  }

  /** Keys that still need probing before `keyFor` can answer (only when the storage couldn't be listed). */
  unprobed(item: D2Item): string[] {
    if (this.listed) return [];
    return this.candidates(item).filter((k) => !this.probed.has(k));
  }

  keyFor(item: D2Item): string | undefined {
    const ck = `${item.code}|${item.quality}|${item.uniqueId ?? ''}|${item.setId ?? ''}|${item.gfx ?? ''}`;
    const hit = this.cache.get(ck);
    if (hit !== undefined) return hit ?? undefined;
    const cands = this.candidates(item);
    if (!this.listed && cands.some((k) => !this.probed.has(k))) return undefined; // not known yet
    const key = cands.find((k) => this.has(k));
    this.cache.set(ck, key ?? null);
    return key;
  }

  /** Art for a bare item code (used for empty stackables slots). */
  keyForCode(code: string): string | undefined {
    const def = GD.items[code];
    if (!def) return undefined;
    return this.keyFor({ code, def, quality: Quality.Normal } as D2Item);
  }

  srcFor(item: D2Item): string | undefined {
    const k = this.keyFor(item);
    return k ? this.url(k) : undefined;
  }

  srcForCode(code: string): string | undefined {
    const k = this.keyForCode(code);
    return k ? this.url(k) : undefined;
  }

  resetCache() {
    this.cache.clear();
  }
}
