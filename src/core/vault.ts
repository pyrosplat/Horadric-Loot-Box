import { itemBytes, parseItemBytes, type D2Item } from './item';

/**
 * A vault is Horadric Loot Box's own unlimited item store (the equivalent of GoMule's .d2x stash).
 * Items are kept as their exact original bit-streams, so they can be put back into any save of the same version.
 */
export interface VaultEntry {
  uid: string;
  item: D2Item;
  addedAt: string;
  /** Where the item came from, for reference. */
  source?: string;
  /** 'rotw' when it came from a Reign of the Warlock character/stash. */
  realm?: 'rotw' | 'lod' | 'classic';
  hardcore?: boolean;
}

export interface Vault {
  kind: 'vault';
  fileName?: string;
  name: string;
  entries: VaultEntry[];
  /** Gold kept in the vault, in separate pots per edition and hardcore/softcore (see `goldPot`). */
  gold: Record<string, number>;
}

/** Vault gold pot key, e.g. "rotw-sc": gold never crosses editions or hardcore/softcore. */
export const goldPot = (realm: 'rotw' | 'lod' | 'classic', hardcore: boolean) => `${realm}-${hardcore ? 'hc' : 'sc'}`;

interface VaultFileV1 {
  format: 'horadric-loot-box' | 'horadric-vault';
  formatVersion: 1;
  name: string;
  items: { uid: string; v: number; data: string; addedAt: string; source?: string; realm?: VaultEntry['realm']; hardcore?: boolean }[];
  gold?: Record<string, number>;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let counter = 0;
export function newUid(): string {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Why a vault name can't be used, or undefined if it's fine. Names have no spaces (they become file names):
 * letters, numbers, - and _ only, up to 32 characters.
 */
export function vaultNameProblem(name: string, taken: string[] = []): string | undefined {
  if (!name) return 'Give the vault a name.';
  if (/\s/.test(name)) return 'Vault names cannot contain spaces.';
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'Use only letters, numbers, - and _.';
  if (name.length > 32) return 'Keep the name to 32 characters or fewer.';
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) return 'A vault with that name already exists.';
  return undefined;
}

export function createVault(name: string): Vault {
  return { kind: 'vault', name, entries: [], gold: {} };
}

export function parseVault(text: string, fileName?: string): Vault {
  const json = JSON.parse(text) as VaultFileV1;
  if (json.format !== 'horadric-loot-box' && json.format !== 'horadric-vault') throw new Error('Not a Horadric Loot Box file');
  if (json.formatVersion !== 1) throw new Error(`Unsupported vault format version ${json.formatVersion}`);
  const entries: VaultEntry[] = [];
  const errors: string[] = [];
  for (const e of json.items) {
    try {
      entries.push({ uid: e.uid, item: parseItemBytes(fromB64(e.data), e.v), addedAt: e.addedAt, source: e.source, realm: e.realm, hardcore: e.hardcore });
    } catch (err) {
      errors.push(`${e.uid}: ${(err as Error).message}`);
    }
  }
  if (errors.length) throw new Error(`Vault has ${errors.length} unreadable item(s): ${errors.slice(0, 3).join('; ')}`);
  const gold: Record<string, number> = {};
  for (const [k, n] of Object.entries(json.gold ?? {})) if (Number.isInteger(n) && n > 0) gold[k] = n;
  return { kind: 'vault', fileName, name: json.name, entries, gold };
}

export function serializeVault(v: Vault): string {
  const file: VaultFileV1 = {
    format: 'horadric-loot-box',
    formatVersion: 1,
    name: v.name,
    items: v.entries.map((e) => ({
      uid: e.uid,
      v: e.item.saveVersion,
      data: toB64(itemBytes(e.item)),
      addedAt: e.addedAt,
      source: e.source,
      realm: e.realm,
      hardcore: e.hardcore,
    })),
    gold: Object.fromEntries(Object.entries(v.gold ?? {}).filter(([, n]) => n > 0)),
  };
  return JSON.stringify(file, null, 1);
}
