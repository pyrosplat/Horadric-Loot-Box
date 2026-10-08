import {
  GD,
  vaultNameProblem,
  STACKABLE_CODES,
  STASH_GOLD_CAP,
  goldPot,
  inventoryGoldCap,
  setCharacterGold,
  setTabGold,
  setStashGold,
  stashGold,
  stashGoldCap,
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
  STACKABLES_LABEL,
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
  createCompactItem,
  createUberItem,
  createBaseItem,
  createTemplateItem,
  offerMatches,
  pickRolls,
  rollSlots,
  isUberCode,
  withNewId,
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
  type WantEntry,
} from '../core';
import type { Platform, SaveFileEntry, UpdateInfo } from '../platform';
import { ArtIndex } from '../art';
import type { Held } from '../core';
import { loadTradeLog, storeTradeLog, tradeLines, type TradeLogEntry } from './tradeLog';
import { askText } from '../trade/listing';

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
  /** How many times it has been saved this session (so undo knows whether "unchanged" still means "saved"). */
  saves?: number;
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
  /** Shared stash pages: one Shared tab with a page switcher (like the game), or a tab per page. */
  sharedStash?: 'pages' | 'tabs';
  /** Collections count runes and jewels socketed into items ("made" runes). */
  grailSocketed: boolean;
  /** Look for a new release on GitHub when the app starts. */
  autoUpdate: boolean;
  /** The save folder opened last (desktop app): reopened automatically at the next launch. */
  lastFolder?: string;
  /** Optional Trade panel (creates items); off unless the player turns it on. */
  tradeEnabled?: boolean;
  /** Game install or extracted data folder that artwork is read from (auto-detected when unset). */
  artPath?: string;
}

interface Snapshot {
  label: string;
  /** Per document: puts its items and gold back, plus the dirty flag it had. */
  lists: Map<string, { restore: () => void; dirty: boolean; saves: number }>;
  /** Anything else to take back with this step (a trade leaves the trade history). */
  also?: () => void;
}

/** Settings as last saved (empty if none or storage is unavailable). */
export function savedSettings(): Partial<Settings> {
  try {
    const s = localStorage.getItem('hlb-settings') ?? localStorage.getItem('hv-settings');
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

/** A unique or set item wanted in a trade, already built with its rolls (so the tooltip shows exactly what you get). */
export interface TradeWantItem {
  key: string;
  kind: 'unique' | 'set' | 'base' | 'runeword' | 'magic' | 'rare' | 'crafted';
  /** Unique, set or runeword row, or the base's item index. */
  id: number;
  name: string;
  item: D2Item;
}

/** What can be offered as payment in a trade: runes, gems, and uber keys and parts. */
export const tradeGood = (i: D2Item) => !i.sockets.length && ((i.compact && (!!i.def?.flags.includes('R') || !!i.def?.flags.includes('g'))) || isUberCode(i.code));

/** One thing an imported listing asks for or gives: "1 X Ist Rune", or an item by name. */
export type TradeAsk = WantEntry;

/** Pane id for the optional Trade panel. */
export const TRADE_ID = 'trade';
/** The Trade panel's offer box: runes, gems and uber items you've put up as payment (moved out of their file). */
export const TRADE_OFFER_ID = 'trade-offer';

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

/** How an app uses the store: the desktop app loads a whole save folder; the web trade page only dropped files. */
export interface StoreOptions {
  /** Settings to start from before the saved ones are applied (e.g. Trade always on). */
  defaults?: Partial<Settings>;
  /** Load and create vaults when a folder opens (default true). */
  vaults?: boolean;
}

export class Store {
  platform: Platform;
  readonly options: StoreOptions;
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

  constructor(platform: Platform, options: StoreOptions = {}) {
    this.platform = platform;
    this.options = options;
    this.settings = { ...this.settings, ...options.defaults, ...savedSettings() };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getRev = () => this.rev;
  emit() {
    // what you offer is whatever sits in the offer box
    const offer = new Map<string, number>();
    for (const e of (this.tradeOfferBox.doc as Vault).entries) offer.set(e.item.code, (offer.get(e.item.code) ?? 0) + 1);
    this.trade.offer = offer;
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

  /**
   * Opens the item artwork from the game files the player chose in Settings. Items show as tiles until they choose
   * some; nothing is read automatically. Never throws.
   */
  async loadArt(path?: string) {
    const backend = this.platform.art;
    const target = path ?? this.settings.artPath;
    if (!backend || !target) {
      this.art = undefined;
      this.artStatus = { state: 'off', message: 'Items show as tiles.' };
      this.emit();
      return;
    }
    this.artStatus = { state: 'loading', message: 'Reading game data…' };
    this.emit();
    try {
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
      if (this.platform.id === 'tauri' && this.settings.lastFolder !== folder) this.setSettings({ lastFolder: folder });
      this.docs.clear();
      this.history = [];
      // trades that were never saved didn't happen; ones undone after a save are still in the files
      this.tradeLog = loadTradeLog();
      for (const f of this.files) await this.loadFile(f);
      this.files = this.files.filter((f) => this.docs.has(f.path));
      if (this.options.vaults !== false) {
        for (const v of await this.platform.listVaults(folder).catch(() => [])) await this.loadVault(v);
        if (![...this.docs.values()].some((d) => d.doc?.kind === 'vault')) this.addVault('MainVault', false, false);
      }
      this.arrangePanes();
      this.gameRunning = await this.platform.isGameRunning().catch(() => false);
      if (this.files.length === 0) this.toast('info', this.emptyFolderMessage);
      if (!this.art) void this.loadArt();
      else if (!this.art.listed) void this.probeArt(this.art).then(() => this.emit());
    } catch (e) {
      this.toast('error', (e as Error).message);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Shown when a folder has nothing this app can open. */
  protected emptyFolderMessage = 'No .d2s or .d2i files found in that folder.';

  /** Whether gold bars offer Transfer (moving gold between stashes, characters and vaults). */
  goldTransfers = true;

  /** Where traded items can go, for the Trade panel's hints. */
  tradeDestination = 'a stash, character or vault';

  /** Which files an app keeps after loading (all by default). `doc` is undefined when the file couldn't be read. */
  protected accepts(_doc: AnyDoc | undefined, _file: SaveFileEntry): boolean {
    return true;
  }

  /** What the two panes show after a folder opens. */
  protected arrangePanes() {
    const docs = [...this.docs.values()].filter((d) => d.doc);
    const stash = docs.find((d) => d.doc?.kind === 'stash' && (d.doc as D2SharedStash).modern && !(d.doc as D2SharedStash).hardcore) ?? docs.find((d) => d.doc?.kind === 'stash');
    const chars = docs
      .filter((d) => d.doc?.kind === 'character')
      .sort((a, b) => {
        const ca = a.doc as D2Character, cb = b.doc as D2Character;
        return Number(cb.gameVersion === 3) - Number(ca.gameVersion === 3) || cb.level - ca.level;
      });
    // start with the fullest vault on the left and the most recently played character on the right
    const modified = new Map(this.files.map((f) => [f.path, f.modified ?? 0]));
    const known = [...modified.values()].some(Boolean);
    const char = known ? [...chars].sort((a, b) => (modified.get(b.path) ?? 0) - (modified.get(a.path) ?? 0))[0] : chars[0];
    const vault = docs.filter((d) => d.doc?.kind === 'vault').sort((a, b) => (b.doc as Vault).entries.length - (a.doc as Vault).entries.length)[0];
    this.panes = [{ docId: (vault ?? stash)?.id, tab: 0 }, { docId: (char ?? stash)?.id, tab: 0 }];
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
    if (!this.accepts(entry.doc, f)) return;
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

  /**
   * Opens the Trade panel on the right with a Reign of the Warlock shared stash on the left, on its Stackables
   * tab, where the runes, gems, keys and parts you pay with live. Keeps a RotW stash already on the left (so a
   * hardcore one stays), otherwise picks the softcore one. Without a RotW stash the left side is left alone.
   */
  openTrade() {
    const isRotwStash = (id?: string) => {
      const d = id ? this.docs.get(id)?.doc : undefined;
      return d?.kind === 'stash' && d.modern ? d : undefined;
    };
    const stashes = [...this.docs.values()].filter((e) => isRotwStash(e.id));
    const pick = isRotwStash(this.panes[0].docId) ? this.panes[0].docId : (stashes.find((e) => !(e.doc as D2SharedStash).hardcore) ?? stashes[0])?.id;
    const d = isRotwStash(pick);
    if (!pick || !d) return this.showInPane(1, TRADE_ID);
    const stackTab = d.tabs.findIndex((t) => t.type === StashTabType.Advanced);
    this.panes = [{ docId: pick, tab: stackTab >= 0 ? stackTab : 0 }, { docId: TRADE_ID, tab: 0 }];
    this.emit();
  }

  /** Swaps what the left and right panes show. */
  swapPanes() {
    this.panes = [this.panes[1], this.panes[0]];
    this.emit();
  }

  setTab(pane: 0 | 1, tab: number) {
    this.panes[pane] = { ...this.panes[pane], tab };
    this.panes = [...this.panes] as [PaneState, PaneState];
    this.emit();
  }

  // ------------------------------------------------------------------ history

  private snapshot(label: string, docIds: string[], also?: () => void) {
    const lists: Snapshot['lists'] = new Map();
    for (const id of docIds) {
      const e = this.entryOf(id);
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
      lists.set(id, { restore, dirty: e.dirty, saves: e.saves ?? 0 });
    }
    this.history = [...this.history.slice(-49), { label, lists, also }];
  }

  undo() {
    const snap = this.history.pop();
    if (!snap) return;
    for (const [id, s] of snap.lists) {
      const e = this.entryOf(id);
      if (!e?.doc) continue;
      s.restore();
      // back to how it was: unsaved only if it was then, or if it has been saved since (the file on disk moved on)
      e.dirty = s.dirty || (e.saves ?? 0) !== s.saves;
    }
    snap.also?.();
    this.toast('info', `Undid: ${snap.label}`);
    this.emit();
  }

  // ------------------------------------------------------------------ moving

  /**
   * A loaded file, or one of the Trade panel's boxes, which work like small vaults that are never saved: "Received"
   * (TRADE_ID) and the offer (TRADE_OFFER_ID).
   */
  private entryOf(id: string): LoadedDoc | undefined {
    return id === TRADE_ID ? this.tradeInbox : id === TRADE_OFFER_ID ? this.tradeOfferBox : this.docs.get(id);
  }

  private hardcoreOf(docId: string, item?: D2Item): boolean | undefined {
    const d = this.entryOf(docId)?.doc;
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
    const d = this.entryOf(fromDocId)?.doc;
    if (d?.kind === 'stash' && inStackablesTab(d, item)) return { ...item, advancedStackSize: undefined };
    return item;
  }

  /** Validates a move without performing it. */
  check(item: D2Item, fromDocId: string, to: Loc): { ok: boolean; reason?: string; warning?: string; x?: number; y?: number } {
    if (this.settings.readOnly) return { ok: false, reason: 'Read-only mode is on (turn it off in Settings to move items).' };
    const target = (to.docId === TRADE_ID ? undefined : this.entryOf(to.docId))?.doc;
    const source = this.entryOf(fromDocId)?.doc;
    if (!target) return { ok: false, reason: 'Target file is not loaded' };
    if (!source) return { ok: false, reason: 'Source is not loaded' };
    const same = fromDocId === to.docId;
    if (to.docId === TRADE_OFFER_ID) {
      if (!tradeGood(item) && !this.tradeAsksItems) return { ok: false, reason: 'Only runes, gems, keys and uber parts can be offered (this trade doesn\u2019t ask for items).' };
      if (item.mode === 6) return { ok: false, reason: 'Take it out of its socket first.' };
      if (fromDocId !== this.tradeDocId()) return { ok: false, reason: 'Pay from the file on the other side of the Trade panel.' };
      const realm = source.kind === 'vault' ? source.entries.find((e) => e.item === item)?.realm : this.realmOf(fromDocId);
      if (realm !== 'rotw') return { ok: false, reason: 'Only Reign of the Warlock items can be offered.' };
      const hc = this.hardcoreOf(fromDocId, item);
      if (this.trade.mode && hc !== undefined && hc !== (this.trade.mode === 'hardcore')) return { ok: false, reason: `This listing is ${this.trade.mode}; that one is ${hc ? 'hardcore' : 'softcore'}. Softcore and hardcore never mix.` };
      const other = (this.tradeOfferBox.doc as Vault).entries[0];
      if (other && hc !== undefined && !!other.hardcore !== hc) return { ok: false, reason: 'Your offer already has items from the other mode. Softcore and hardcore never mix.' };
    }

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
    const src = this.entryOf(fromDocId)!;
    const dst = this.entryOf(to.docId)!;
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
          const page = d.tabs.slice(0, i + 1).filter((x) => x.type === StashTabType.Normal).length;
          for (const it of t.items) {
            const tab = t.type === StashTabType.Advanced ? STACKABLES_LABEL : `Shared page ${page}`;
            add(it, e.id, `${name} · ${tab}`, false);
          }
        });
    }
    this.heldCache = { rev: this.rev, vaultId, list };
    return list;
  }

  // ------------------------------------------------------------------ trade (optional feature, Settings → Trade)

  /** What the player wants and what they're offering: runes and gems by item code, plus built unique and set items. */
  trade = {
    want: new Map<string, number>(),
    offer: new Map<string, number>(),
    items: [] as TradeWantItem[],
    mode: undefined as 'softcore' | 'hardcore' | undefined,
    /** The imported listing's price: options (Traderie's "OR"), each a list of runes, gems or uber items. */
    ask: undefined as TradeAsk[][] | undefined,
    /** The imported listing's name, for messages. */
    listing: undefined as string | undefined,
    /** Buying (you get the listed item) or selling (someone's buying it; you give it). Kept when the trade clears. */
    side: 'buy' as 'buy' | 'sell',
    /** Selling: what the buyer gives, as options (Traderie's "OR"), and which one you take. */
    receive: undefined as TradeAsk[][] | undefined,
    pick: 0,
  };

  /** Switches between buying and selling; the current trade is cleared (your offer goes back). */
  tradeSetSide(side: 'buy' | 'sell') {
    if (this.trade.side === side) return;
    this.tradeClear();
    this.trade.side = side;
    this.emit();
  }

  /** Selling: which of the buyer's options you take. */
  tradePick(i: number) {
    if (!this.trade.receive?.[i]) return;
    this.trade.pick = i;
    this.emit();
  }

  /** Whether the trade asks for items (not just runes, gems and uber items), so the offer box takes them too. */
  get tradeAsksItems(): boolean {
    return !!this.trade.ask?.some((o) => o.some((a) => a.item));
  }

  /**
   * Puts an imported listing in the trade, replacing any listing (and anything picked by hand) already there:
   * what it sells, its asking price and its Softcore/Hardcore tag. Returns why it can't, or undefined.
   */
  tradeSetListing(l: {
    name: string;
    mode: 'softcore' | 'hardcore';
    ask: TradeAsk[][];
    want?: [string, number][];
    items?: Omit<TradeWantItem, 'key'>[];
    /** Selling: what the buyer gives (then `ask` is the listed item you give). */
    receive?: TradeAsk[][];
  }): string | undefined {
    const prev = this.trade.mode;
    this.trade.mode = undefined;
    const problem = this.tradeModeProblem(l.mode);
    if (problem) {
      this.trade.mode = prev;
      return problem;
    }
    this.trade = {
      ...this.trade,
      want: new Map(l.want ?? []),
      items: (l.items ?? []).map((w) => ({ ...w, key: newUid() })),
      mode: l.mode,
      ask: l.ask,
      listing: l.name,
      receive: l.receive,
      pick: 0,
    };
    this.emit();
    return undefined;
  }

  /** Which of the listing's price options the offer is exactly (same runes, same counts), or -1. */
  tradeAskMatch(): number {
    const { ask } = this.trade;
    if (!ask) return -1;
    const offered = this.tradeOffered;
    return ask.findIndex((opt) => offerMatches(opt, offered));
  }

  /**
   * Remembers the Softcore/Hardcore tag of a listing imported from a screenshot; every listing in one trade must
   * agree, and it must match the file you pay from when you accept. Returns why it can't, or undefined.
   */
  tradeListingMode(mode: 'softcore' | 'hardcore'): string | undefined {
    const problem = this.tradeModeProblem(mode);
    if (problem) return problem;
    this.trade.mode = mode;
    return undefined;
  }

  /**
   * Why a Softcore or Hardcore listing can't go into this trade: it clashes with listings already in it, or with
   * the character or stash you pay from (a vault can hold both, so its runes are checked when you accept).
   */
  tradeModeProblem(mode: 'softcore' | 'hardcore'): string | undefined {
    const Mode = mode === 'hardcore' ? 'Hardcore' : 'Softcore';
    if (this.trade.mode && this.trade.mode !== mode) return `This is a ${Mode} listing, but the listings already in this trade are ${this.trade.mode}. Softcore and hardcore never mix.`;
    const docId = this.tradeDocId();
    const e = docId ? this.docs.get(docId) : undefined;
    if (!docId || !e?.doc) return undefined;
    const name = docLabel(e.doc, e.name);
    if (e.doc.kind === 'vault') {
      const goods = this.tradeSources(docId);
      if (goods.length && goods.every((g) => !!g.hardcore !== (mode === 'hardcore'))) return `This is a ${Mode} listing, but everything you could pay with in ${name} is ${mode === 'hardcore' ? 'softcore' : 'hardcore'}. Softcore and hardcore never mix.`;
      return undefined;
    }
    const hc = this.hardcoreOf(docId);
    if (hc !== undefined && hc !== (mode === 'hardcore')) return `This is a ${Mode} listing, but ${name} is ${hc ? 'hardcore' : 'softcore'}. Softcore and hardcore never mix.`;
    return undefined;
  }

  /** Runes, gems and uber items offered as payment, taken out of their file until the trade is accepted or cleared. */
  tradeOfferBox: LoadedDoc = { id: TRADE_OFFER_ID, path: '', name: 'Offer', dirty: false, backedUp: true, doc: { ...createVault('Offer'), entries: [] } };

  get tradeOffered(): D2Item[] {
    return (this.tradeOfferBox.doc as Vault).entries.map((e) => e.item);
  }

  /** Traded items waiting to be dragged into a character, stash or vault (never saved). */
  tradeInbox: LoadedDoc = { id: TRADE_ID, path: '', name: 'Trade', dirty: false, backedUp: true, doc: { ...createVault('Received'), entries: [] } };

  get tradeReceived(): D2Item[] {
    return (this.tradeInbox.doc as Vault).entries.map((e) => e.item);
  }

  /** Moves every received item into the file on the other side (onto Stackables stacks when possible). */
  tradeDeliverAll() {
    const docId = this.tradeDocId();
    const target = docId ? this.docs.get(docId)?.doc : undefined;
    if (!docId || !target) return this.toast('error', 'Open a character, stash or vault on the other side first.');
    const items = [...this.tradeReceived];
    this.snapshot(`move ${items.length} traded items`, [TRADE_ID, docId]);
    let n = 0;
    for (const it of items) {
      const stackTab = target.kind === 'stash' ? target.tabs.findIndex((t) => t.type === StashTabType.Advanced) : -1;
      const locs: Loc[] = [...(stackTab >= 0 ? [{ docId, area: 'stackables', tab: stackTab } as Loc] : []), ...this.candidateLocs(docId, target, this.panes.find((p) => p.docId === docId)?.tab ?? 0)];
      for (const loc of locs) {
        if (this.check(it, TRADE_ID, loc).ok && this.move(it, TRADE_ID, loc, { quiet: true, noSnapshot: true })) {
          n++;
          break;
        }
      }
    }
    this.toast(n === items.length ? 'success' : 'error', n === items.length ? `Moved ${n} traded item${n === 1 ? '' : 's'}.` : `Moved ${n} of ${items.length}; there's no room for the rest.`);
    this.emit();
  }

  /** The file the Trade panel pays from and delivers to: whatever the other pane shows. */
  tradeDocId(): string | undefined {
    const i = this.panes.findIndex((p) => p.docId === TRADE_ID);
    return i < 0 ? undefined : this.panes[i === 0 ? 1 : 0].docId;
  }

  /** Why the other pane can't trade, or undefined when it can. */
  tradeProblem(docId = this.tradeDocId()): string | undefined {
    const d = docId ? this.docs.get(docId)?.doc : undefined;
    if (!d) return 'Open a Reign of the Warlock character, shared stash or vault on the other side.';
    if (this.settings.readOnly) return 'Read-only mode is on (turn it off in Settings to trade).';
    if (d.kind === 'vault') return undefined;
    if (this.realmOf(docId!) !== 'rotw') return 'Trades only work with Reign of the Warlock saves.';
    return undefined;
  }

  /** Runes and gems a file holds that can be offered, by code (Stackables stacks count fully). */
  tradeOwned(docId = this.tradeDocId(), codes?: (c: string) => boolean): Map<string, number> {
    const out = new Map<string, number>();
    for (const { item, count } of this.tradeSources(docId)) if (!codes || codes(item.code)) out.set(item.code, (out.get(item.code) ?? 0) + count);
    return out;
  }

  private tradeSources(docId?: string): { item: D2Item; count: number; hardcore?: boolean; realm?: string }[] {
    const d = docId ? this.docs.get(docId)?.doc : undefined;
    if (!d) return [];
    const ok = tradeGood;
    if (d.kind === 'vault') return d.entries.filter((e) => ok(e.item)).map((e) => ({ item: e.item, count: 1, hardcore: e.hardcore, realm: e.realm }));
    if (d.kind === 'stash')
      return d.tabs.flatMap((t) => t.items.filter(ok).map((i) => ({ item: i, count: t.type === StashTabType.Advanced ? stackCount(i) : 1, hardcore: d.hardcore, realm: 'rotw' })));
    return d.items.filter((i) => i.mode === 0 && ok(i)).map((i) => ({ item: i, count: 1, hardcore: d.hardcore, realm: 'rotw' }));
  }

  /**
   * Offers more (moves that many out of the file on the other side into the offer box) or takes some back (moves
   * them home). Each is one undo step.
   */
  tradeOffer(code: string, delta: number) {
    if (delta > 0) {
      const docId = this.tradeDocId();
      const first = docId ? this.tradeSources(docId).find((s) => s.item.code === code) : undefined;
      if (!docId || !first) return this.emit();
      return void this.moveStackable(first.item, docId, { docId: TRADE_OFFER_ID, area: 'vault' }, delta);
    }
    this.tradeReturn(code, -delta);
  }

  /** Moves offered items back to the file on the other side (onto Stackables stacks when possible). */
  tradeReturn(code?: string, n = Infinity): number {
    const docId = this.tradeDocId();
    const target = docId ? this.docs.get(docId)?.doc : undefined;
    const items = this.tradeOffered.filter((i) => !code || i.code === code).slice(0, n === Infinity ? undefined : n);
    if (!items.length) return 0;
    if (!docId || !target) {
      this.toast('error', 'Open the file you paid from on the other side to take your offer back.');
      return 0;
    }
    this.snapshot(`take back ${items.length} offered`, [TRADE_OFFER_ID, docId]);
    let moved = 0;
    for (const it of items) {
      const stackTab = target.kind === 'stash' ? target.tabs.findIndex((t) => t.type === StashTabType.Advanced) : -1;
      const locs: Loc[] = [...(stackTab >= 0 ? [{ docId, area: 'stackables', tab: stackTab } as Loc] : []), ...this.candidateLocs(docId, target, this.panes.find((p) => p.docId === docId)?.tab ?? 0)];
      if (locs.some((loc) => this.check(it, TRADE_OFFER_ID, loc).ok && this.move(it, TRADE_OFFER_ID, loc, { quiet: true, noSnapshot: true }))) moved++;
    }
    if (moved < items.length) this.toast('error', `Put ${moved} of ${items.length} back; there's no room for the rest.`);
    this.emit();
    return moved;
  }

  /** Takes one offered item back (to the file on the other side). */
  tradeReturnItem(item: D2Item): boolean {
    const docId = this.tradeDocId();
    const target = docId ? this.docs.get(docId)?.doc : undefined;
    if (!docId || !target) return (this.toast('error', 'Open the file you paid from on the other side to take your offer back.'), false);
    const locs = this.candidateLocs(docId, target, this.panes.find((p) => p.docId === docId)?.tab ?? 0);
    const loc = locs.find((l) => this.check(item, TRADE_OFFER_ID, l).ok);
    if (!loc) return (this.toast('error', "There's no room to put it back."), false);
    return !!this.move(item, TRADE_OFFER_ID, loc);
  }

  /** Empties the trade: what you offered goes back where it came from. */
  tradeClear() {
    if (this.tradeOffered.length) this.tradeReturn();
    this.trade = { want: new Map(), offer: new Map(), items: [], mode: undefined, ask: undefined, listing: undefined, side: this.trade.side, receive: undefined, pick: 0 };
    this.emit();
  }

  /**
   * Performs the trade: the offer (exactly what the listing asks for) is used up, and what the listing sells is
   * created in the Received box, ready to drag where you want it. One undo step; nothing is written until Save.
   */
  tradeAccept(): boolean {
    const docId = this.tradeDocId();
    const problem = this.tradeProblem(docId);
    const fail = (m: string) => (this.toast('error', m), false);
    if (problem) return fail(problem);
    const { want, items, ask, receive, pick } = this.trade;
    const selling = !!receive;
    if (!ask || (!selling && !want.size && !items.length)) return fail('Import a listing first.');
    if (this.tradeAskMatch() < 0) {
      const text = askText(ask);
      return fail(selling ? `Offer exactly what the buyer wants: ${text}.` : `Offer exactly what the listing asks for: ${text}.`);
    }
    // the payment is what's in the offer box: all Reign of the Warlock, all softcore or all hardcore
    const paid = (this.tradeOfferBox.doc as Vault).entries;
    const free = !paid.length && !selling && ask[0]?.length === 0;
    if (!paid.length && !free) return fail('Drag what you pay with into your offer first.');
    if (paid.some((p) => p.realm !== 'rotw')) return fail('Only Reign of the Warlock items can be traded.');
    const hcs = new Set(paid.map((p) => !!p.hardcore));
    if (hcs.size > 1) return fail('Your offer mixes softcore and hardcore items. Softcore and hardcore never mix.');
    const hardcore = free ? this.trade.mode === 'hardcore' : [...hcs][0] ?? false;
    if (!free && this.trade.mode && (this.trade.mode === 'hardcore') !== hardcore)
      return fail(`The listing you imported is ${this.trade.mode}, but you're paying from a ${hardcore ? 'hardcore' : 'softcore'} file. Softcore and hardcore never mix.`);
    const logId = newUid();
    this.snapshot('trade', [TRADE_OFFER_ID, TRADE_ID], () => (this.tradeLog = this.tradeLog.filter((x) => x.id !== logId)));
    const inbox = this.tradeInbox.doc as Vault;
    const before = inbox.entries.length;
    const gave = paid.map((p) => p.item);
    try {
      (this.tradeOfferBox.doc as Vault).entries = [];
      // what you get waits in the Received box until you drag it where you want it
      const add = (item: D2Item) => inbox.entries.push({ uid: newUid(), item, addedAt: new Date().toISOString(), source: 'Trade', realm: 'rotw', hardcore });
      for (const [code, n] of want) for (let i = 0; i < n; i++) add(isUberCode(code) ? createUberItem(code) : createCompactItem(code, 105));
      for (const w of items) add(withNewId(w.item));
      // selling: what the buyer gives (items named without rolls get random rolls)
      for (const a of selling ? receive![pick] ?? [] : [])
        for (let i = 0; i < a.qty; i++) {
          const w = a.item;
          if (!w) add(isUberCode(a.code) ? createUberItem(a.code) : createCompactItem(a.code, 105));
          else if (w.kind === 'unique' || w.kind === 'set') add(createTemplateItem(w.kind, w.id, pickRolls(rollSlots(w.kind, w.id), 'random'), { ethereal: w.ethereal }));
          else if (w.kind === 'base') add(createBaseItem(w.code, { sockets: w.sockets, ethereal: w.ethereal }));
          else throw new Error(`The app can't make ${a.name} without knowing its base.`);
        }
    } catch (err) {
      this.undoQuiet();
      this.emit();
      return fail((err as Error).message);
    }
    const sold = selling ? receive![pick] ?? [] : [];
    const got = [...[...want].map(([c, n]) => `${n}× ${GD.items[c]?.name ?? c}`), ...items.map((w) => w.name), ...sold.map((a) => `${a.qty}× ${a.name}`)].join(', ');
    const count = [...want.values()].reduce((a, b) => a + b, 0) + items.length + sold.reduce((t, a) => t + a.qty, 0);
    const e = this.docs.get(docId!);
    this.tradeLog = [
      { id: logId, at: new Date().toISOString(), side: selling ? 'sell' : 'buy', got: tradeLines(inbox.entries.slice(before).map((x) => x.item)), paid: tradeLines(gave), mode: hardcore ? 'hardcore' : 'softcore', file: docLabel(e?.doc, e?.name ?? ''), saved: false },
      ...this.tradeLog,
    ];
    this.trade = { want: new Map(), offer: new Map(), items: [], mode: undefined, ask: undefined, listing: undefined, side: this.trade.side, receive: undefined, pick: 0 };
    this.toast('success', `Traded for ${got}. Drag ${count === 1 ? 'it' : 'them'} from Received into ${this.tradeDestination}. Undo with Ctrl+Z.`);
    this.emit();
    return true;
  }

  /**
   * Trades made in the Trade panel, newest first. A trade is kept (in this app or browser's storage) once the files
   * are saved, because that is when it lands in the game. Until then it is only in memory: undoing it takes it
   * out, and reloading the files goes back to the stored history.
   */
  tradeLog: TradeLogEntry[] = loadTradeLog();

  /** Removes one trade from the history. */
  tradeLogRemove(id: string) {
    this.tradeLog = this.tradeLog.filter((e) => e.id !== id);
    storeTradeLog(this.tradeLog);
    this.emit();
  }

  tradeLogClear() {
    this.tradeLog = [];
    storeTradeLog(this.tradeLog);
    this.emit();
  }

  /** The files were saved: the trades made since are real now. */
  private tradeLogKeep() {
    this.tradeLog = this.tradeLog.map((e) => (e.saved ? e : { ...e, saved: true }));
    storeTradeLog(this.tradeLog);
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
    const src = this.entryOf(fromDocId)?.doc;
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

  /** Whether a shared stash's gold is one pool over its pages (Reign of the Warlock). */
  goldPooled(docId: string): boolean {
    const d = this.docs.get(docId)?.doc;
    return d?.kind === 'stash' && d.modern;
  }

  /** The gold ref for a shared stash page: the whole pool for a RotW stash (so every page shows the same). */
  sharedGoldRef(docId: string, tab?: number): GoldRef | undefined {
    const d = this.docs.get(docId)?.doc;
    if (d?.kind !== 'stash') return undefined;
    const first = d.tabs.findIndex((t) => t.type === StashTabType.Normal);
    return { docId, kind: 'shared', tab: d.modern || tab === undefined ? first : tab };
  }

  goldOf(ref: GoldRef): number {
    const d = this.docs.get(ref.docId)?.doc;
    if (!d) return 0;
    if (ref.kind === 'vault') return d.kind === 'vault' ? d.gold[ref.pot] ?? 0 : 0;
    if (ref.kind === 'shared') return d.kind !== 'stash' ? 0 : d.modern ? stashGold(d) : d.tabs[ref.tab]?.gold ?? 0;
    if (d.kind !== 'character') return 0;
    return (ref.kind === 'inventory' ? d.stats.gold : d.stats.goldbank) ?? 0;
  }

  goldCap(ref: GoldRef): number {
    const d = this.docs.get(ref.docId)?.doc;
    if (ref.kind === 'vault') return Number.MAX_SAFE_INTEGER;
    if (ref.kind === 'inventory' && d?.kind === 'character') return inventoryGoldCap(d);
    if (ref.kind === 'shared' && d?.kind === 'stash' && d.modern) return stashGoldCap(d);
    return STASH_GOLD_CAP;
  }

  goldLabel(ref: GoldRef): string {
    const e = this.docs.get(ref.docId);
    const name = docLabel(e?.doc, e?.name ?? '');
    if (ref.kind === 'vault') return `${name} (${POT_LABEL[ref.pot] ?? ref.pot})`;
    if (ref.kind === 'shared') return this.goldPooled(ref.docId) ? `${name} · Shared` : `${name} · Shared ${ref.tab + 1}`;
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
      else if (d.modern) out.push(this.sharedGoldRef(e.id)!);
      else d.tabs.forEach((t, tab) => t.type === StashTabType.Normal && out.push({ docId: e.id, kind: 'shared', tab }));
    }
    const same = (a: GoldRef, b: GoldRef) => JSON.stringify(a) === JSON.stringify(b);
    return out.filter((r) => !same(r, ref));
  }

  private setGold(ref: GoldRef, value: number) {
    const d = this.docs.get(ref.docId)!.doc!;
    if (ref.kind === 'vault') (d as Vault).gold = { ...(d as Vault).gold, [ref.pot]: value };
    else if (ref.kind === 'shared') (this.goldPooled(ref.docId) ? setStashGold(d as D2SharedStash, value) : setTabGold(d as D2SharedStash, ref.tab, value));
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
    if (other.docId === TRADE_ID && this.settings.tradeEnabled) {
      if (!tradeGood(item)) return this.toast('info', 'Only runes, gems, uber keys and uber parts can be offered in trades for now.');
      return void (count > 1 ? this.moveStackable(item, fromDocId, { docId: TRADE_OFFER_ID, area: 'vault' }, count) : this.move(item, fromDocId, { docId: TRADE_OFFER_ID, area: 'vault' }));
    }
    const target = other.docId ? this.docs.get(other.docId)?.doc : undefined;
    if (!other.docId || !target) return this.toast('error', 'Open a file in the other pane first.');
    for (const loc of this.candidateLocs(other.docId, target, other.tab)) {
      if (this.check(item, fromDocId, loc).ok) return void (count > 1 ? this.moveStackable(item, fromDocId, loc, count) : this.move(item, fromDocId, loc));
    }
    const last = this.candidateLocs(other.docId, target, other.tab)[0];
    if (last) this.move(item, fromDocId, last); // shows the reason
  }

  candidateLocs(docId: string, target: AnyDoc, tab: number): Loc[] {
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
    if (this.tradeReceived.length)
      return this.toast('error', `Move your ${this.tradeReceived.length} traded item${this.tradeReceived.length === 1 ? '' : 's'} out of the Trade panel's Received box before saving (or undo the trade).`);
    if (this.tradeOffered.length) return this.toast('error', 'Finish the trade or take your offer back (Clear) before saving, so no runes are lost.');
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
        o.doc.saves = (o.doc.saves ?? 0) + 1;
      }
      this.tradeLogKeep();
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
