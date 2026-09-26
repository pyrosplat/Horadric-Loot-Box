import {
  GD,
  vaultNameProblem,
  STACKABLE_CODES,
  STASH_GOLD_CAP,
  goldPot,
  inventoryGoldCap,
  setCharacterGold,
  setTabGold,
  StashTabType,
  addToStack,
  beltPlacement,
  canBelt,
  canEquip,
  canStack,
  canUnequip,
  commonChecks,
  equipPlacement,
  firstFreeBeltSlot,
  inStackablesTab,
  takeFromStack,
  isBoardStackable,
  stackCount,
  withPlacement,
  GRID_SIZE,
  canDrop,
  createVault,
  describeItem,
  isCharacterFile,
  isStashFile,
  newUid,
  occupancy,
  parseCharacter,
  parseStash,
  parseVault,
  placeItem,
  removeItem,
  serializeVault,
  serializeVerified,
  tabIsEditable,
  type D2Character,
  type D2Item,
  type D2SharedStash,
  type GridKind,
  type ItemDescription,
  type Vault,
} from '../core';
import type { Platform, SaveFileEntry, UpdateInfo } from '../platform';
import { ArtIndex } from '../art';
import type { Held } from '../core';

export type AnyDoc = D2Character | D2SharedStash | Vault;

export interface LoadedDoc {
  id: string;
  path: string;
  name: string;
  doc?: AnyDoc;
  error?: string;
  dirty: boolean;
  /** Set once this session has backed up the original file. */
  backedUp: boolean;
}

export type Loc =
  | { docId: string; area: Exclude<GridKind, 'shared'>; x?: number; y?: number }
  | { docId: string; area: 'shared'; tab: number; x?: number; y?: number }
  | { docId: string; area: 'vault' }
  /** Worn by the character (bodyLoc 1–12, 11/12 = weapon swap). */
  | { docId: string; area: 'equip'; bodyLoc: number }
  /** Worn by the character's mercenary. */
  | { docId: string; area: 'merc'; bodyLoc: number }
  /** Potion belt slot 0–15 (bottom row first); omitted = first free. */
  | { docId: string; area: 'belt'; x?: number }
  /** A shared stash's RotW Stackables tab: the item joins its stack. */
  | { docId: string; area: 'stackables'; tab: number };

/** Anywhere gold can be kept. */
export type GoldRef =
  | { docId: string; kind: 'inventory' | 'stash' }
  | { docId: string; kind: 'shared'; tab: number }
  | { docId: string; kind: 'vault'; pot: string };

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface PaneState {
  docId?: string;
  tab: number;
}

export type ItemView = 'art' | 'artNames' | 'tiles';

export interface Settings {
  /** Blocks every move and save, for browsing without risk. */
  readOnly: boolean;
  /** How items are drawn: game artwork, artwork with names on top, or the text tiles. */
  itemView: ItemView;
  /** Vault items as a list or as cards. */
  vaultView: 'list' | 'cards';
  /** Collections: give ethereal copies their own slot. */
  grailEth: boolean;
  /** Interface scale (1 = 100%). */
  uiScale: number;
  /** Collections count runes and jewels socketed into items ("made" runes). */
  grailSocketed: boolean;
  /** Look for a new release on GitHub when the app starts. */
  autoUpdate: boolean;
  /** Game install or extracted data folder that artwork is read from (auto-detected when unset). */
  artPath?: string;
}

interface Snapshot {
  label: string;
  /** Per document: puts its items and gold back, plus the dirty flag it had. */
  lists: Map<string, { restore: () => void; dirty: boolean }>;
}

const descCache = new WeakMap<D2Item, ItemDescription>();
export function desc(item: D2Item): ItemDescription {
  let d = descCache.get(item);
  if (!d) {
    d = describeItem(item);
    descCache.set(item, d);
  }
  return d;
}

let itemSeq = 0;
const itemKeys = new WeakMap<D2Item, number>();
export function itemKey(item: D2Item): number {
  let k = itemKeys.get(item);
  if (k === undefined) itemKeys.set(item, (k = ++itemSeq));
  return k;
}

export function docLabel(d: AnyDoc | undefined, fallback: string): string {
  if (!d) return fallback;
  if (d.kind === 'character') return d.name;
  if (d.kind === 'vault') return d.name;
  const base = d.modern ? 'RotW Shared Stash' : 'Legacy Shared Stash';
  return `${base}${d.hardcore ? ' (HC)' : ''}`;
}

const POT_LABEL: Record<string, string> = {
  'rotw-sc': 'RotW softcore',
  'rotw-hc': 'RotW hardcore',
  'lod-sc': 'LoD softcore',
  'lod-hc': 'LoD hardcore',
  'classic-sc': 'Classic softcore',
  'classic-hc': 'Classic hardcore',
};
export const potLabel = (pot: string) => POT_LABEL[pot] ?? pot;

export class Store {
  platform: Platform;
  folder?: string;
  files: SaveFileEntry[] = [];
  docs = new Map<string, LoadedDoc>();
  panes: [PaneState, PaneState] = [{ tab: 0 }, { tab: 0 }];
  toasts: Toast[] = [];
  history: Snapshot[] = [];
  settings: Settings = { readOnly: false, itemView: 'art', vaultView: 'list', grailEth: false, uiScale: 1, grailSocketed: true, autoUpdate: true };
  art?: ArtIndex;
  artStatus: { state: 'off' | 'loading' | 'ready' | 'missing' | 'error'; message: string } = { state: 'off', message: 'Not loaded' };
  busy = false;
  gameRunning = false;
  lastBackup?: string;
  rev = 0;
  private listeners = new Set<() => void>();
  private toastSeq = 0;

  constructor(platform: Platform) {
    this.platform = platform;
    try {
      const s = localStorage.getItem('hlb-settings') ?? localStorage.getItem('hv-settings');
      if (s) this.settings = { ...this.settings, ...JSON.parse(s) };
    } catch {
      /* storage unavailable */
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getRev = () => this.rev;
  emit() {
    this.rev++;
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------ updates

  update: { state: 'idle' | 'checking' | 'none' | 'available' | 'installing' | 'error'; info?: UpdateInfo; progress?: number; message?: string } = { state: 'idle' };

  /** Asks GitHub for a newer release. Quiet unless `manual` (the Settings button). */
  async checkForUpdates(manual = false) {
    const u = this.platform.updates;
    if (!u || this.update.state === 'checking' || this.update.state === 'installing') return;
    this.update = { state: 'checking' };
    this.emit();
    try {
      const info = await u.check();
      this.update = info ? { state: 'available', info } : { state: 'none' };
      if (manual && !info) this.toast('success', `You're on the latest version (${__APP_VERSION__}).`);
    } catch (e) {
      this.update = { state: 'error', message: (e as Error)?.message ?? String(e) };
      if (manual) this.toast('error', `Couldn't check for updates: ${this.update.message}`);
    }
    this.emit();
  }

  /** Downloads and installs the available update, then restarts. Refused while there are unsaved changes. */
  async installUpdate() {
    const u = this.platform.updates;
    if (!u || this.update.state !== 'available') return;
    if (this.dirtyDocs.length) return this.toast('error', 'Save or reload your changes before updating.');
    const info = this.update.info;
    this.update = { state: 'installing', info, progress: 0 };
    this.emit();
    try {
      await u.install((done, total) => {
        this.update = { state: 'installing', info, progress: total ? done / total : undefined };
        this.emit();
      });
    } catch (e) {
      this.update = { state: 'available', info, message: (e as Error)?.message ?? String(e) };
      this.toast('error', `Update failed: ${this.update.message}`);
      this.emit();
    }
  }

  toast(kind: Toast['kind'], text: string) {
    const t = { id: ++this.toastSeq, kind, text };
    this.toasts = [...this.toasts.slice(-3), t];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.emit();
    }, kind === 'error' ? 7000 : 3500);
  }

  setSettings(s: Partial<Settings>) {
    this.settings = { ...this.settings, ...s };
    try {
      localStorage.setItem('hlb-settings', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.emit();
  }

  // ------------------------------------------------------------------ artwork

  /** True when items should be drawn with game art right now. */
  get showArt(): boolean {
    return this.settings.itemView !== 'tiles' && !!this.art;
  }

  /** Opens the game's artwork: the saved folder, else the first detected install. Never throws. */
  async loadArt(path?: string) {
    const backend = this.platform.art;
    if (!backend) {
      this.artStatus = { state: 'off', message: 'Game art needs the desktop app.' };
      this.emit();
      return;
    }
    this.artStatus = { state: 'loading', message: 'Reading game data…' };
    this.emit();
    try {
      let target = path ?? this.settings.artPath;
      if (!target) target = (await backend.detectInstalls())[0];
      if (!target) {
        this.art = undefined;
        this.artStatus = { state: 'missing', message: 'Not set up yet. Choose your unpacked game files below.' };
        return;
      }
      const info = await backend.open(target);
      const idx = new ArtIndex(info, backend.url);
      if (!idx.listed) await this.probeArt(idx);
      this.art = idx;
      if (path) this.setSettings({ artPath: path });
      const n = idx.listed ? `${idx.sprites.size} item images` : 'item images';
      this.artStatus = { state: 'ready', message: `Loaded ${n} from ${info.path}` };
    } catch (e) {
      this.art = undefined;
      this.artStatus = { state: 'error', message: (e as Error).message ?? String(e) };
    } finally {
      this.emit();
    }
  }

  /** When the storage can't be listed, asks the backend which candidate sprites exist for every loaded item. */
  private async probeArt(idx: ArtIndex) {
    const backend = this.platform.art;
    if (!backend) return;
    const keys = new Set<string>();
    const visit = (i: D2Item) => {
      idx.unprobed(i).forEach((k) => keys.add(k));
      i.sockets.forEach(visit);
    };
    for (const d of this.docs.values()) {
      const doc = d.doc;
      if (!doc) continue;
      if (doc.kind === 'character') [...doc.items, ...doc.mercItems, ...doc.corpseItems].forEach(visit);
      else if (doc.kind === 'stash') doc.tabs.forEach((t) => t.items.forEach(visit));
    }
    for (const code of STACKABLE_CODES) idx.candidates({ code, def: GD.items[code], quality: 2 } as D2Item).forEach((k) => keys.add(k));
    const list = [...keys].filter((k) => !idx.probed.has(k));
    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      const found = new Set(await backend.probe(chunk));
      chunk.forEach((k) => idx.probed.set(k, found.has(k)));
    }
    idx.resetCache();
  }

  // ------------------------------------------------------------------ loading

  get dirtyDocs() {
    return [...this.docs.values()].filter((d) => d.dirty);
  }

  async openFolder(folder: string) {
    this.busy = true;
    this.emit();
    try {
      this.folder = folder;
      this.files = await this.platform.listSaves(folder);
      this.docs.clear();
      this.history = [];
      for (const f of this.files) await this.loadFile(f);
      for (const v of await this.platform.listVaults(folder).catch(() => [])) await this.loadVault(v);
      if (![...this.docs.values()].some((d) => d.doc?.kind === 'vault')) this.addVault('MainVault', false, false);
      const docs = [...this.docs.values()].filter((d) => d.doc);
      const stash = docs.find((d) => d.doc?.kind === 'stash' && (d.doc as D2SharedStash).modern && !(d.doc as D2SharedStash).hardcore) ?? docs.find((d) => d.doc?.kind === 'stash');
      const chars = docs
        .filter((d) => d.doc?.kind === 'character')
        .sort((a, b) => {
          const ca = a.doc as D2Character, cb = b.doc as D2Character;
          return Number(cb.gameVersion === 3) - Number(ca.gameVersion === 3) || cb.level - ca.level;
        });
      const char = chars[0];
      this.panes = [{ docId: (stash ?? docs.find((d) => d.doc?.kind === 'vault'))?.id, tab: 0 }, { docId: char?.id, tab: 0 }];
      this.gameRunning = await this.platform.isGameRunning().catch(() => false);
      if (this.files.length === 0) this.toast('info', 'No .d2s or .d2i files found in that folder.');
      if (!this.art) void this.loadArt();
      else if (!this.art.listed) void this.probeArt(this.art).then(() => this.emit());
    } catch (e) {
      this.toast('error', (e as Error).message);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private async loadFile(f: SaveFileEntry) {
    const entry: LoadedDoc = { id: f.path, path: f.path, name: f.name, dirty: false, backedUp: false };
    try {
      const data = await this.platform.readFile(f.path);
      if (isCharacterFile(data) && f.name.toLowerCase().endsWith('.d2s')) entry.doc = parseCharacter(data, f.name);
      else if (isStashFile(data)) entry.doc = parseStash(data, f.name);
      else throw new Error('Unrecognised file');
    } catch (e) {
      entry.error = (e as Error).message;
    }
    this.docs.set(entry.id, entry);
  }

  private async loadVault(f: SaveFileEntry) {
    const entry: LoadedDoc = { id: f.path, path: f.path, name: f.name, dirty: false, backedUp: true };
    try {
      entry.doc = parseVault(await this.platform.readText(f.path), f.name);
    } catch (e) {
      entry.error = (e as Error).message;
    }
    this.docs.set(entry.id, entry);
  }

  /** Names of the loaded vaults (for the uniqueness check). */
  vaultNames(exceptDocId?: string): string[] {
    return [...this.docs.values()].filter((d) => d.doc?.kind === 'vault' && d.id !== exceptDocId).map((d) => (d.doc as Vault).name);
  }

  addVault(name: string, open = true, dirty = true) {
    const problem = vaultNameProblem(name, this.vaultNames());
    if (problem) throw new Error(problem);
    const id = `new-vault:${newUid()}`;
    this.docs.set(id, { id, path: '', name, doc: createVault(name), dirty, backedUp: true });
    if (open) this.panes[0] = { docId: id, tab: 0 };
    this.emit();
    return id;
  }

  async reload() {
    if (this.folder) await this.openFolder(this.folder);
  }

  showInPane(pane: 0 | 1, docId: string, tab = 0) {
    this.panes = pane === 0 ? [{ docId, tab }, this.panes[1]] : [this.panes[0], { docId, tab }];
    this.emit();
  }

  setTab(pane: 0 | 1, tab: number) {
    this.panes[pane] = { ...this.panes[pane], tab };
    this.panes = [...this.panes] as [PaneState, PaneState];
    this.emit();
  }

  // ------------------------------------------------------------------ history

  private snapshot(label: string, docIds: string[]) {
    const lists: Snapshot['lists'] = new Map();
    for (const id of docIds) {
      const e = this.docs.get(id);
      const d = e?.doc;
      if (!e || !d) continue;
      let restore: () => void;
      if (d.kind === 'character') {
        const [items, merc, head, stats, statList, statsAt] = [[...d.items], [...d.mercItems], d.head, { ...d.stats }, [...d.statList], { ...d.statsAt }];
        restore = () => Object.assign(d, { items, mercItems: merc, head, stats, statList, statsAt });
      } else if (d.kind === 'stash') {
        const tabs = d.tabs.map((t) => ({ items: [...t.items], header: t.header, gold: t.gold }));
        restore = () => d.tabs.forEach((t, i) => Object.assign(t, tabs[i]));
      } else {
        const [entries, gold] = [[...d.entries], { ...d.gold }];
        restore = () => Object.assign(d, { entries, gold });
      }
      lists.set(id, { restore, dirty: e.dirty });
    }
    this.history = [...this.history.slice(-49), { label, lists }];
  }

  undo() {
    const snap = this.history.pop();
    if (!snap) return;
    for (const [id, s] of snap.lists) {
      const e = this.docs.get(id);
      if (!e?.doc) continue;
      s.restore();
      e.dirty = s.dirty || e.dirty;
    }
    this.toast('info', `Undid: ${snap.label}`);
    this.emit();
  }

  // ------------------------------------------------------------------ moving

  private hardcoreOf(docId: string, item?: D2Item): boolean | undefined {
    const d = this.docs.get(docId)?.doc;
    if (!d) return undefined;
    if (d.kind === 'character') return d.hardcore;
    if (d.kind === 'stash') return d.hardcore;
    const entry = item && d.entries.find((e) => e.item === item);
    return entry?.hardcore;
  }

  private realmOf(docId: string): 'rotw' | 'lod' | 'classic' | undefined {
    const d = this.docs.get(docId)?.doc;
    if (!d) return undefined;
    if (d.kind === 'character') return d.gameVersion >= 3 ? 'rotw' : d.expansion ? 'lod' : 'classic';
    if (d.kind === 'stash') return d.modern ? 'rotw' : 'lod';
    return undefined;
  }

  private realmName(r: 'rotw' | 'lod' | 'classic') {
    return r === 'rotw' ? 'Reign of the Warlock' : r === 'lod' ? 'Lord of Destruction' : 'Classic';
  }

  /** The item as it would travel: taking from a Stackables tab moves a single one. */
  private travelling(item: D2Item, fromDocId: string): D2Item {
    const d = this.docs.get(fromDocId)?.doc;
    if (d?.kind === 'stash' && inStackablesTab(d, item)) return { ...item, advancedStackSize: undefined };
    return item;
  }

  /** Validates a move without performing it. */
  check(item: D2Item, fromDocId: string, to: Loc): { ok: boolean; reason?: string; warning?: string; x?: number; y?: number } {
    if (this.settings.readOnly) return { ok: false, reason: 'Read-only mode is on (turn it off in Settings to move items).' };
    const target = this.docs.get(to.docId)?.doc;
    const source = this.docs.get(fromDocId)?.doc;
    if (!target) return { ok: false, reason: 'Target file is not loaded' };
    if (!source) return { ok: false, reason: 'Source is not loaded' };
    const same = fromDocId === to.docId;

    // hardcore and softcore never mix; neither do Reign of the Warlock, Lord of Destruction and Classic
    if (to.area !== 'vault') {
      const a = this.hardcoreOf(fromDocId, item);
      const b = this.hardcoreOf(to.docId);
      if (a !== undefined && b !== undefined && a !== b) return { ok: false, reason: 'Hardcore and softcore items are kept apart.' };
      const ra = source.kind === 'vault' ? source.entries.find((e) => e.item === item)?.realm : this.realmOf(fromDocId);
      const rb = this.realmOf(to.docId);
      if (ra && rb && ra !== rb) return { ok: false, reason: `This is a ${this.realmName(ra)} item; it can only go to ${this.realmName(ra)} characters and stashes.` };
    }

    // leaving the current spot
    if (source.kind === 'character' && !(same && to.area === 'equip' && item.bodyLoc === (to as { bodyLoc: number }).bodyLoc)) {
      const out = canUnequip(source, item);
      if (!out.ok) return out;
    }

    const moving = this.travelling(item, fromDocId);
    if (to.area === 'vault') return target.kind === 'vault' ? { ok: true } : { ok: false, reason: 'Not a vault' };
    if (target.kind === 'vault') return { ok: false, reason: 'Not a grid' };

    if (to.area === 'stackables') {
      if (target.kind !== 'stash') return { ok: false, reason: 'Not a stash' };
      if (same && source.kind === 'stash' && target.tabs[to.tab]?.items.includes(item)) return { ok: false, reason: 'Already in this stack.' };
      return canStack(target, to.tab, moving);
    }

    if (to.area === 'equip' || to.area === 'merc' || to.area === 'belt') {
      if (target.kind !== 'character') return { ok: false, reason: 'Not a character' };
      const common = commonChecks(target, moving, same ? item : undefined);
      if (!common.ok) return common;
      if (to.area === 'belt') {
        const slot = to.x ?? firstFreeBeltSlot(target, same ? item : undefined);
        if (slot === undefined) return { ok: false, reason: 'The belt is full.' };
        const r = canBelt(target, moving, slot, same ? item : undefined);
        return { ...r, x: slot, y: 0 };
      }
      return canEquip(target, moving, to.bodyLoc, { merc: to.area === 'merc', ignore: same ? item : undefined });
    }

    const tab = to.area === 'shared' ? to.tab : 0;
    let { x, y } = to;
    if (x === undefined || y === undefined) {
      const occ = occupancy(target, to.area, tab);
      const spot = occ.findSpot(moving.def?.w ?? 1, moving.def?.h ?? 1);
      if (!spot) return { ok: false, reason: 'No room left there.' };
      ({ x, y } = spot);
    }
    const r = canDrop(target, to.area, tab, moving, x, y, same ? item : undefined);
    return { ...r, x, y };
  }

  move(item: D2Item, fromDocId: string, to: Loc, opts: { quiet?: boolean; label?: string; noSnapshot?: boolean } = {}): boolean {
    const chk = this.check(item, fromDocId, to);
    if (!chk.ok) {
      if (!opts.quiet) this.toast('error', chk.reason ?? 'Cannot move there');
      return false;
    }
    const src = this.docs.get(fromDocId)!;
    const dst = this.docs.get(to.docId)!;
    if (!opts.noSnapshot) this.snapshot(opts.label ?? `move ${desc(item).name}`, [fromDocId, to.docId]);

    // detach
    let realm: 'rotw' | 'lod' | 'classic' | undefined = this.realmOf(fromDocId);
    let hardcore = this.hardcoreOf(fromDocId, item);
    let source = docLabel(src.doc, src.name);
    let moving = item;
    try {
      const sd = src.doc!;
      if (sd.kind === 'vault') {
        const i = sd.entries.findIndex((e) => e.item === item);
        if (i < 0) return false;
        const [entry] = sd.entries.splice(i, 1);
        realm = entry.realm;
        hardcore = entry.hardcore;
        source = entry.source ?? source;
      } else if (sd.kind === 'stash' && inStackablesTab(sd, item)) {
        moving = takeFromStack(sd, item);
      } else if (sd.kind === 'character' && sd.mercItems.includes(item)) {
        sd.mercItems.splice(sd.mercItems.indexOf(item), 1);
      } else if (!removeItem(sd as D2Character | D2SharedStash, item)) return false;
      src.dirty = true;

      // attach
      const td = dst.doc!;
      if (to.area === 'vault') {
        (td as Vault).entries.push({ uid: newUid(), item: moving, addedAt: new Date().toISOString(), source, realm, hardcore });
      } else if (to.area === 'stackables') {
        addToStack(td as D2SharedStash, to.tab, moving);
      } else if (to.area === 'equip') {
        (td as D2Character).items.push(withPlacement(moving, equipPlacement(to.bodyLoc)));
      } else if (to.area === 'merc') {
        (td as D2Character).mercItems.push(withPlacement(moving, equipPlacement(to.bodyLoc)));
      } else if (to.area === 'belt') {
        (td as D2Character).items.push(withPlacement(moving, beltPlacement(chk.x!)));
      } else {
        placeItem(td as D2Character | D2SharedStash, to.area, to.area === 'shared' ? to.tab : 0, moving, chk.x!, chk.y!);
      }
    } catch (e) {
      // put everything back the way it was
      if (!opts.noSnapshot) this.undoQuiet();
      this.toast('error', (e as Error).message);
      return false;
    }
    dst.dirty = true;
    if (chk.warning && !opts.quiet) this.toast('info', chk.warning);
    this.emit();
    return true;
  }

  private undoQuiet() {
    const snap = this.history.pop();
    snap?.lists.forEach((s) => s.restore());
  }


  /** Renames a vault; returns the problem with the name instead if it can't be used. */
  renameVault(docId: string, name: string): string | undefined {
    const e = this.docs.get(docId);
    if (e?.doc?.kind !== 'vault') return 'Not a vault';
    if (name === e.doc.name) return undefined;
    const problem = vaultNameProblem(name, this.vaultNames(docId));
    if (problem) return problem;
    e.doc.name = name;
    e.dirty = true;
    this.emit();
    return undefined;
  }

  // ------------------------------------------------------------------ deleting characters

  /** Why a character can't be deleted right now, or undefined if it can. */
  deleteBlocker(docId: string): string | undefined {
    const e = this.docs.get(docId);
    if (!e || e.doc?.kind !== 'character') return 'Not a character.';
    if (!this.platform.deleteCharacter) return "This version of the app can't delete files.";
    if (this.settings.readOnly) return 'Read-only mode is on.';
    if (e.dirty) return 'This character has unsaved changes. Save or reload first, so no moved items are lost.';
    return undefined;
  }

  /** Deletes a character's files after the typed name matches. Returns true on success. */
  async deleteCharacter(docId: string, typedName: string): Promise<boolean> {
    const block = this.deleteBlocker(docId);
    const e = this.docs.get(docId);
    if (block || !e) return (this.toast('error', block ?? 'Not found'), false);
    const ch = e.doc as D2Character;
    if (typedName.trim().toLowerCase() !== ch.name.toLowerCase()) return (this.toast('error', 'The name typed does not match.'), false);
    if (await this.platform.isGameRunning().catch(() => false)) {
      this.gameRunning = true;
      this.emit();
      return (this.toast('error', 'Close Diablo II: Resurrected before deleting a character.'), false);
    }
    try {
      const kept = await this.platform.deleteCharacter!(e.path);
      this.docs.delete(docId);
      this.files = this.files.filter((f) => f.path !== e.path);
      // undo steps that involve this character can't be replayed any more
      this.history = this.history.filter((h) => !h.lists.has(docId));
      this.panes = this.panes.map((p) => (p.docId === docId ? { tab: 0 } : p)) as [PaneState, PaneState];
      if (this.selection.docId === docId) this.clearSelection();
      this.toast('success', `Deleted ${ch.name}. A copy was kept in ${kept}.`);
      return true;
    } catch (err) {
      this.toast('error', (err as Error).message ?? String(err));
      return false;
    } finally {
      this.emit();
    }
  }

  /** Why a vault can't be deleted right now, or undefined if it can. */
  vaultDeleteBlocker(docId: string): string | undefined {
    const e = this.docs.get(docId);
    if (!e || e.doc?.kind !== 'vault') return 'Not a vault.';
    if (this.settings.readOnly) return 'Read-only mode is on.';
    // items moved in and not yet saved would vanish from both sides
    if (e.dirty && (e.path || e.doc.entries.length)) return 'This vault has unsaved changes. Save or reload first, so no moved items are lost.';
    if (e.path && !this.platform.deleteVault) return "This version of the app can't delete vault files.";
    return undefined;
  }

  async deleteVault(docId: string, typedName: string): Promise<boolean> {
    const block = this.vaultDeleteBlocker(docId);
    const e = this.docs.get(docId);
    if (block || !e) return (this.toast('error', block ?? 'Not found'), false);
    const v = e.doc as Vault;
    if (typedName.trim().toLowerCase() !== v.name.toLowerCase()) return (this.toast('error', 'The name typed does not match.'), false);
    try {
      const kept = e.path ? await this.platform.deleteVault!(e.path) : undefined;
      this.docs.delete(docId);
      this.history = this.history.filter((h) => !h.lists.has(docId));
      this.panes = this.panes.map((p) => (p.docId === docId ? { tab: 0 } : p)) as [PaneState, PaneState];
      if (this.selection.docId === docId) this.clearSelection();
      this.toast('success', `Deleted vault ${v.name}${kept ? `. A copy was kept in ${kept}` : ''}.`);
      return true;
    } catch (err) {
      this.toast('error', (err as Error).message ?? String(err));
      return false;
    } finally {
      this.emit();
    }
  }

  // ------------------------------------------------------------------ collections

  private heldCache?: { rev: number; vaultId: string; list: Held[] };

  /**
   * Every item on the account for a vault's collection tabs: that vault's items (inVault) plus what the loaded
   * characters, shared stashes and other vaults hold. Socketed runes and jewels don't count (they're in use).
   */
  held(vaultId: string): Held[] {
    if (this.heldCache && this.heldCache.rev === this.rev && this.heldCache.vaultId === vaultId) return this.heldCache.list;
    const list: Held[] = [];
    const PAGE: Record<number, string> = { 0: 'Inventory', 3: 'Horadric Cube', 4: 'Personal stash' };
    // an item plus whatever is socketed into it (those count as found, but are in use)
    const add = (item: D2Item, docId: string, where: string, inVault: boolean) => {
      list.push({ item, docId, where, inVault });
      const parent = desc(item).name;
      for (const s of item.sockets) list.push({ item: s, docId, where: `${parent} · ${where}`, inVault, socketedIn: parent });
    };
    for (const e of this.docs.values()) {
      const d = e.doc;
      if (!d) continue;
      const name = docLabel(d, e.name);
      if (d.kind === 'vault') for (const v of d.entries) add(v.item, e.id, e.id === vaultId ? name : `Vault ${name}`, e.id === vaultId);
      else if (d.kind === 'character') {
        for (const it of d.items) {
          const where = it.mode === 1 ? 'equipped' : it.mode === 2 ? 'belt' : PAGE[it.page] ?? 'carried';
          add(it, e.id, `${name} · ${where}`, false);
        }
        for (const it of d.mercItems) add(it, e.id, `${name} · mercenary`, false);
      } else
        d.tabs.forEach((t, i) => {
          const tab = t.type === StashTabType.Advanced ? 'Stackables' : `Shared ${i + 1}`;
          for (const it of t.items) add(it, e.id, `${name} · ${tab}`, false);
        });
    }
    this.heldCache = { rev: this.rev, vaultId, list };
    return list;
  }

  // ------------------------------------------------------------------ deleting items

  /** Items waiting for the user to confirm deletion (the app shows a dialog while this is set). */
  pendingDelete?: { docId: string; items: D2Item[] };

  requestDelete(docId: string, items: D2Item[]) {
    if (this.settings.readOnly) return this.toast('error', 'Read-only mode is on (turn it off in Settings to delete items).');
    const list = items.filter((i) => i.mode !== 6); // socketed children go with their parent
    if (!list.length) return;
    this.pendingDelete = { docId, items: list };
    this.emit();
  }

  cancelDelete() {
    this.pendingDelete = undefined;
    this.emit();
  }

  /** Deletes items from a character, stash or vault (one undo step; nothing is written until Save). */
  deleteItems(docId: string, items: D2Item[]): number {
    this.pendingDelete = undefined;
    if (this.settings.readOnly) return (this.toast('error', 'Read-only mode is on.'), 0);
    const e = this.docs.get(docId);
    const d = e?.doc;
    if (!e || !d) return 0;
    if (d.kind === 'character') {
      const belt = items.find((i) => !canUnequip(d, i).ok);
      if (belt) return (this.toast('error', canUnequip(d, belt).reason ?? "Can't delete that"), 0);
    }
    this.snapshot(`delete ${items.length} item${items.length === 1 ? '' : 's'}`, [docId]);
    let n = 0;
    for (const it of items) {
      if (d.kind === 'vault') {
        const i = d.entries.findIndex((x) => x.item === it);
        if (i >= 0) (d.entries.splice(i, 1), n++);
      } else if (d.kind === 'stash' && inStackablesTab(d, it)) {
        // a Stackables stack loses one, not the whole stack
        takeFromStack(d, it);
        n++;
      } else if (removeItem(d as D2Character | D2SharedStash, it)) n++;
    }
    if (!n) {
      this.history.pop();
      this.emit();
      return 0;
    }
    e.dirty = true;
    if (items.some((i) => this.selection.items.has(i))) this.selection = { items: new Set() };
    this.toast('success', `Deleted ${n} item${n === 1 ? '' : 's'}. Undo with Ctrl+Z; nothing is written until you save.`);
    this.emit();
    return n;
  }

  // ------------------------------------------------------------------ selection

  selection: { docId?: string; items: Set<D2Item> } = { items: new Set() };

  isSelected(item: D2Item): boolean {
    return this.selection.items.has(item);
  }

  /** Selects items in one file ('toggle' for Ctrl+click, 'add' for Ctrl+box, 'replace' for a plain box). */
  select(docId: string, items: D2Item[], mode: 'replace' | 'add' | 'toggle') {
    const same = this.selection.docId === docId;
    const next = new Set(same && mode !== 'replace' ? this.selection.items : []);
    for (const it of items) {
      if (mode === 'toggle' && next.has(it)) next.delete(it);
      else next.add(it);
    }
    this.selection = { docId: next.size ? docId : undefined, items: next };
    this.emit();
  }

  clearSelection() {
    if (!this.selection.items.size) return;
    this.selection = { items: new Set() };
    this.emit();
  }

  /** The items a drag or double-click on `item` should carry: the whole selection if the item is part of it. */
  groupFor(item: D2Item, docId: string): D2Item[] {
    if (this.selection.docId === docId && this.selection.items.has(item) && this.selection.items.size > 1) {
      return [item, ...[...this.selection.items].filter((i) => i !== item)];
    }
    return [item];
  }

  /**
   * Moves several items as one undo step. Items keep their arrangement relative to the first one when there is
   * room; otherwise each goes to the first free spot.
   */
  /**
   * Moves up to `count` of a stackable (rune, gem, key, part…) in one undo step: taken one at a time off a
   * Stackables stack, or from matching loose copies in the same vault / grid. Shift+drag and Shift+double-click.
   */
  moveStackable(item: D2Item, fromDocId: string, to: Loc, count: number): boolean {
    if (count <= 1 || !isBoardStackable(item)) return this.move(item, fromDocId, to);
    if (this.settings.readOnly) return (this.toast('error', 'Read-only mode is on (turn it off in Settings to move items).'), false);
    const src = this.docs.get(fromDocId)?.doc;
    if (!src) return false;
    const stackTab = src.kind === 'stash' ? src.tabs.findIndex((t) => t.type === StashTabType.Advanced && t.items.includes(item)) : -1;
    const next = (moved: D2Item[]): D2Item | undefined => {
      if (src.kind === 'stash' && stackTab >= 0) return src.tabs[stackTab].items.find((i) => i.code === item.code && stackCount(i) > 0);
      const loose = (i: D2Item) => i.code === item.code && !i.sockets.length && !moved.includes(i);
      if (src.kind === 'vault') return src.entries.find((e) => loose(e.item))?.item;
      if (src.kind === 'stash') return src.tabs.flatMap((t) => (t.items.includes(item) ? t.items : [])).find(loose);
      return src.items.find((i) => loose(i) && i.mode === item.mode && i.page === item.page);
    };
    const name = desc(item).name;
    this.snapshot(`move ${count} × ${name}`, [fromDocId, to.docId]);
    const gridArea = to.area === 'inventory' || to.area === 'stash' || to.area === 'cube' || to.area === 'shared';
    const moved: D2Item[] = [];
    let cur: D2Item | undefined = item;
    while (cur && moved.length < count) {
      const loc: Loc = moved.length === 0 ? to : gridArea ? ({ ...to, x: undefined, y: undefined } as Loc) : to.area === 'belt' ? { ...to, x: undefined } : to;
      if (!this.move(cur, fromDocId, loc, { noSnapshot: true, quiet: moved.length > 0 })) break;
      moved.push(cur);
      cur = next(moved);
    }
    if (!moved.length) {
      this.history.pop();
      this.emit();
      return false;
    }
    if (moved.length > 1) this.toast('info', `Moved ${moved.length} × ${name}.`);
    this.emit();
    return true;
  }

  moveMany(items: D2Item[], fromDocId: string, to: Loc): number {
    if (items.length === 1) return this.move(items[0], fromDocId, to) ? 1 : 0;
    if (this.settings.readOnly) return (this.toast('error', 'Read-only mode is on (turn it off in Settings to move items).'), 0);
    const anchor = items[0];
    this.snapshot(`move ${items.length} items`, [fromDocId, to.docId]);
    let moved = 0;
    const reasons = new Set<string>();
    const gridArea = to.area === 'inventory' || to.area === 'stash' || to.area === 'cube' || to.area === 'shared';
    for (const it of items) {
      const tries: Loc[] = [];
      const at = to as { x?: number; y?: number };
      if (gridArea && at.x !== undefined && at.y !== undefined && it.mode === anchor.mode && it.page === anchor.page) {
        tries.push({ ...to, x: at.x + it.x - anchor.x, y: at.y + it.y - anchor.y } as Loc);
      }
      if (gridArea) tries.push({ ...to, x: undefined, y: undefined } as Loc);
      else if (to.area === 'equip' || to.area === 'merc') {
        if (it !== anchor) continue; // one item per slot
        tries.push(to);
      } else tries.push(to.area === 'belt' ? { ...to, x: undefined } : to);
      let ok = false;
      for (const loc of tries) {
        const chk = this.check(it, fromDocId, loc);
        if (chk.ok && this.move(it, fromDocId, loc, { quiet: true, noSnapshot: true })) {
          ok = true;
          break;
        }
        if (!chk.ok && chk.reason) reasons.add(chk.reason);
      }
      if (ok) moved++;
    }
    this.clearSelection();
    if (!moved) this.history.pop();
    const total = to.area === 'equip' || to.area === 'merc' ? 1 : items.length;
    if (moved === total) this.toast('success', `Moved ${moved} items.`);
    else this.toast(moved ? 'info' : 'error', `Moved ${moved} of ${total} items. ${[...reasons].slice(0, 2).join(' ')}`);
    this.emit();
    return moved;
  }

  /** Double-click on a selected item: send the whole selection to the other pane. */
  quickMoveMany(items: D2Item[], fromDocId: string, pane: 0 | 1) {
    if (items.length === 1) return this.quickMove(items[0], fromDocId, pane);
    const other = this.panes[pane === 0 ? 1 : 0];
    const target = other.docId ? this.docs.get(other.docId)?.doc : undefined;
    if (!other.docId || !target) return this.toast('error', 'Open a file in the other pane first.');
    const locs = this.candidateLocs(other.docId, target, other.tab);
    if (this.settings.readOnly) return this.toast('error', 'Read-only mode is on (turn it off in Settings to move items).');
    this.snapshot(`move ${items.length} items`, [fromDocId, other.docId]);
    let moved = 0;
    for (const it of items) if (locs.some((loc) => this.check(it, fromDocId, loc).ok && this.move(it, fromDocId, loc, { quiet: true, noSnapshot: true }))) moved++;
    this.clearSelection();
    if (!moved) this.history.pop();
    this.toast(moved === items.length ? 'success' : moved ? 'info' : 'error', moved === items.length ? `Moved ${moved} items.` : `Moved ${moved} of ${items.length} items (no room or not allowed for the rest).`);
    this.emit();
  }

  // ------------------------------------------------------------------ gold

  /** Vault pot a character or stash's gold belongs to (edition + hardcore/softcore). */
  goldPotOf(docId: string): string | undefined {
    const realm = this.realmOf(docId);
    const hc = this.hardcoreOf(docId);
    return realm && hc !== undefined ? goldPot(realm, hc) : undefined;
  }

  goldOf(ref: GoldRef): number {
    const d = this.docs.get(ref.docId)?.doc;
    if (!d) return 0;
    if (ref.kind === 'vault') return d.kind === 'vault' ? d.gold[ref.pot] ?? 0 : 0;
    if (ref.kind === 'shared') return d.kind === 'stash' ? d.tabs[ref.tab]?.gold ?? 0 : 0;
    if (d.kind !== 'character') return 0;
    return (ref.kind === 'inventory' ? d.stats.gold : d.stats.goldbank) ?? 0;
  }

  goldCap(ref: GoldRef): number {
    const d = this.docs.get(ref.docId)?.doc;
    if (ref.kind === 'vault') return Number.MAX_SAFE_INTEGER;
    if (ref.kind === 'inventory' && d?.kind === 'character') return inventoryGoldCap(d);
    return STASH_GOLD_CAP;
  }

  goldLabel(ref: GoldRef): string {
    const e = this.docs.get(ref.docId);
    const name = docLabel(e?.doc, e?.name ?? '');
    if (ref.kind === 'vault') return `${name} (${POT_LABEL[ref.pot] ?? ref.pot})`;
    if (ref.kind === 'shared') return `${name} · Shared ${ref.tab + 1}`;
    return `${name} · ${ref.kind === 'inventory' ? 'Inventory' : 'Stash'}`;
  }

  private potOfRef(ref: GoldRef): string | undefined {
    return ref.kind === 'vault' ? ref.pot : this.goldPotOf(ref.docId);
  }

  /** Every other place this gold could go: same edition and hardcore/softcore only. */
  goldTargets(ref: GoldRef): GoldRef[] {
    const pot = this.potOfRef(ref);
    if (!pot) return [];
    const out: GoldRef[] = [];
    for (const e of this.docs.values()) {
      const d = e.doc;
      if (!d) continue;
      if (d.kind === 'vault') out.push({ docId: e.id, kind: 'vault', pot });
      else if (this.goldPotOf(e.id) !== pot) continue;
      else if (d.kind === 'character') out.push({ docId: e.id, kind: 'stash' }, { docId: e.id, kind: 'inventory' });
      else d.tabs.forEach((t, tab) => t.type === StashTabType.Normal && out.push({ docId: e.id, kind: 'shared', tab }));
    }
    const same = (a: GoldRef, b: GoldRef) => JSON.stringify(a) === JSON.stringify(b);
    return out.filter((r) => !same(r, ref));
  }

  private setGold(ref: GoldRef, value: number) {
    const d = this.docs.get(ref.docId)!.doc!;
    if (ref.kind === 'vault') (d as Vault).gold = { ...(d as Vault).gold, [ref.pot]: value };
    else if (ref.kind === 'shared') setTabGold(d as D2SharedStash, ref.tab, value);
    else setCharacterGold(d as D2Character, ref.kind === 'inventory' ? 'gold' : 'goldbank', value);
  }

  /** Moves `amount` gold between two places. Returns the amount moved (0 if refused). */
  transferGold(from: GoldRef, to: GoldRef, amount: number): number {
    const fail = (m: string) => (this.toast('error', m), 0);
    if (this.settings.readOnly) return fail('Read-only mode is on (turn it off in Settings to move gold).');
    if (!Number.isInteger(amount) || amount <= 0) return fail('Enter an amount of gold to move.');
    const pa = this.potOfRef(from), pb = this.potOfRef(to);
    if (!pa || pa !== pb) return fail('Gold only moves between the same edition and hardcore/softcore.');
    const have = this.goldOf(from);
    if (amount > have) return fail(`Only ${have.toLocaleString()} gold there.`);
    const room = this.goldCap(to) - this.goldOf(to);
    if (room <= 0) return fail(`${this.goldLabel(to)} is full (${this.goldCap(to).toLocaleString()} max).`);
    const n = Math.min(amount, room);
    this.snapshot(`move ${n.toLocaleString()} gold`, [...new Set([from.docId, to.docId])]);
    try {
      this.setGold(from, have - n);
      this.setGold(to, this.goldOf(to) + n);
    } catch (e) {
      this.undoQuiet();
      return fail((e as Error).message);
    }
    this.docs.get(from.docId)!.dirty = true;
    this.docs.get(to.docId)!.dirty = true;
    this.toast('success', `Moved ${n.toLocaleString()} gold to ${this.goldLabel(to)}${n < amount ? ` (it only had room for ${n.toLocaleString()})` : ''}.`);
    this.emit();
    return n;
  }

  /** Double-click behaviour: send the item to the other pane, picking a free spot. */
  quickMove(item: D2Item, fromDocId: string, pane: 0 | 1, count = 1) {
    const other = this.panes[pane === 0 ? 1 : 0];
    const target = other.docId ? this.docs.get(other.docId)?.doc : undefined;
    if (!other.docId || !target) return this.toast('error', 'Open a file in the other pane first.');
    for (const loc of this.candidateLocs(other.docId, target, other.tab)) {
      if (this.check(item, fromDocId, loc).ok) return void (count > 1 ? this.moveStackable(item, fromDocId, loc, count) : this.move(item, fromDocId, loc));
    }
    const last = this.candidateLocs(other.docId, target, other.tab)[0];
    if (last) this.move(item, fromDocId, last); // shows the reason
  }

  private candidateLocs(docId: string, target: AnyDoc, tab: number): Loc[] {
    if (target.kind === 'vault') return [{ docId, area: 'vault' }];
    if (target.kind === 'character')
      return (['stash', 'inventory', 'cube'] as const).map((area) => ({ docId, area }));
    const tabs = target.tabs.map((_, i) => i).filter((i) => tabIsEditable(target, i));
    const grids: Loc[] = [tab, ...tabs.filter((t) => t !== tab)].filter((t) => tabIsEditable(target, t)).map((t) => ({ docId, area: 'shared', tab: t }));
    // showing the Stackables tab: stackables go onto their stacks first
    return target.tabs[tab]?.type === StashTabType.Advanced ? [{ docId, area: 'stackables', tab }, ...grids] : grids;
  }

  /** Moves every item of a grid into a vault. */
  moveAllToVault(fromDocId: string, area: GridKind, tab: number, vaultId: string) {
    const d = this.docs.get(fromDocId)?.doc;
    if (!d || d.kind === 'vault') return;
    const items = area === 'shared' ? [...((d as D2SharedStash).tabs[tab]?.items ?? [])] : (d as D2Character).items.filter((i) => i.mode === 0 && i.page === ({ inventory: 0, cube: 3, stash: 4 } as const)[area]);
    let n = 0;
    this.snapshot(`move ${items.length} items to the vault`, [fromDocId, vaultId]);
    for (const it of items) if (this.move(it, fromDocId, { docId: vaultId, area: 'vault' }, { quiet: true, noSnapshot: true })) n++;
    this.toast('success', `Moved ${n} of ${items.length} items to the vault.`);
  }

  // ------------------------------------------------------------------ saving

  async saveAll() {
    if (this.settings.readOnly) return this.toast('error', 'Read-only mode is on: nothing is written. Turn it off in Settings to save.');
    const dirty = this.dirtyDocs.filter((d) => d.doc);
    if (!dirty.length) return this.toast('info', 'Nothing to save.');
    if (!this.platform.canWrite && this.platform.id === 'demo') {
      // demo still "writes" to memory so the flow can be tried end to end
    }
    this.busy = true;
    this.emit();
    try {
      if (await this.platform.isGameRunning().catch(() => false)) {
        this.gameRunning = true;
        throw new Error('Diablo II: Resurrected is running. Close the game first — it keeps saves open and will overwrite your changes.');
      }
      // 1) serialize + verify everything first; abort before touching disk if anything is off
      const outputs: { doc: LoadedDoc; bytes?: Uint8Array; text?: string }[] = [];
      for (const d of dirty) {
        if (d.doc!.kind === 'vault') outputs.push({ doc: d, text: serializeVault(d.doc as Vault) });
        else outputs.push({ doc: d, bytes: serializeVerified(d.doc as D2Character | D2SharedStash) });
      }
      // 2) back up originals (once per session)
      const toBackup = outputs.filter((o) => o.bytes && !o.doc.backedUp).map((o) => o.doc.path);
      if (toBackup.length) {
        this.lastBackup = await this.platform.backupFiles(toBackup);
        outputs.forEach((o) => (o.doc.backedUp = true));
      }
      // 3) write
      for (const o of outputs) {
        if (o.bytes) await this.platform.writeFileAtomic(o.doc.path, o.bytes);
        else {
          const v = o.doc.doc as Vault;
          const path = await this.platform.writeVault(this.folder ?? '', v.name, o.text!, o.doc.path || undefined);
          if (o.doc.path !== path) {
            this.docs.delete(o.doc.id);
            o.doc.id = path;
            o.doc.path = path;
            this.docs.set(path, o.doc);
            this.panes = this.panes.map((p) => (p.docId && !this.docs.has(p.docId) ? { ...p, docId: path } : p)) as [PaneState, PaneState];
          }
        }
        o.doc.dirty = false;
      }
      const shortBackup = this.lastBackup?.split(/[\\/]/).slice(-2).join('/');
      this.toast('success', `Saved ${outputs.length} file${outputs.length > 1 ? 's' : ''}${shortBackup && toBackup.length ? ` · originals backed up to …/${shortBackup}` : ''}.`);
    } catch (e) {
      this.toast('error', `Save failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  // ------------------------------------------------------------------ queries

  allItems(): { docId: string; item: D2Item; where: string }[] {
    const out: { docId: string; item: D2Item; where: string }[] = [];
    for (const e of this.docs.values()) {
      const d = e.doc;
      if (!d) continue;
      if (d.kind === 'character') {
        for (const it of d.items) out.push({ docId: e.id, item: it, where: whereLabel(it) });
        for (const it of d.mercItems) out.push({ docId: e.id, item: it, where: 'Mercenary' });
      } else if (d.kind === 'stash') {
        d.tabs.forEach((t, i) => t.items.forEach((it) => out.push({ docId: e.id, item: it, where: `Tab ${i + 1}` })));
      } else d.entries.forEach((en) => out.push({ docId: e.id, item: en.item, where: 'Vault' }));
    }
    return out;
  }
}

export function whereLabel(it: D2Item): string {
  if (it.mode === 1) return 'Equipped';
  if (it.mode === 2) return 'Belt';
  return ({ 0: 'Inventory', 3: 'Cube', 4: 'Stash' } as Record<number, string>)[it.page] ?? 'Other';
}

export { GRID_SIZE };
