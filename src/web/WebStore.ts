import { StashTabType, type D2Character, type D2SharedStash } from '../core';
import type { SaveFileEntry } from '../platform';
import { DROP_FOLDER, type DroppedPlatform } from '../platform/dropped';
import { Store, TRADE_ID, type AnyDoc, type LoadedDoc } from '../state/store';

/** Reign of the Warlock saves only: shared stashes and characters. */
const isRotw = (doc: AnyDoc) => (doc.kind === 'stash' ? doc.modern : doc.kind === 'character' ? doc.gameVersion >= 3 : false);

/**
 * The store for the web trade page: the files dropped on the page, one of them on the left (a shared stash on its
 * Stackables tab, or a character) and the Trade panel on the right. Trade is always on; no vaults.
 */
export class WebStore extends Store {
  declare platform: DroppedPlatform;
  tradeDestination = 'your stash or character';
  // one file at a time and no vaults, so there's nowhere to move gold to
  goldTransfers = false;
  protected emptyFolderMessage = 'Drop a Reign of the Warlock shared stash (.d2i) or character (.d2s).';
  /** Files the last load turned away, with why. */
  private turnedAway: string[] = [];

  constructor(platform: DroppedPlatform) {
    super(platform, { vaults: false, defaults: { tradeEnabled: true } });
    this.settings.tradeEnabled = true;
  }

  protected accepts(doc: AnyDoc | undefined, file: SaveFileEntry): boolean {
    if (!doc) this.turnedAway.push(`${file.name} couldn't be read`);
    else if (!isRotw(doc)) this.turnedAway.push(`${file.name} isn't a Reign of the Warlock save`);
    return !!doc && isRotw(doc);
  }

  protected arrangePanes() {
    const keep = this.panes[0].docId;
    const list = this.saves;
    const first = (keep && this.docs.has(keep) ? this.docs.get(keep) : undefined) ?? list[0];
    this.panes = [first ? { docId: first.id, tab: this.startTab(first) } : { tab: 0 }, { docId: TRADE_ID, tab: 0 }];
    if (this.turnedAway.length) this.toast('error', `${this.turnedAway.join('; ')}. Trading works with Reign of the Warlock saves only.`);
    this.turnedAway = [];
  }

  /** Loaded saves: softcore shared stash first, then other stashes, then characters. */
  get saves(): LoadedDoc[] {
    const rank = (e: LoadedDoc) => (e.doc?.kind === 'stash' ? ((e.doc as D2SharedStash).hardcore ? 1 : 0) : 2);
    return [...this.docs.values()].filter((e) => e.doc).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  get currentId(): string | undefined {
    return this.panes[0].docId;
  }

  private startTab(e: LoadedDoc): number {
    if (e.doc?.kind !== 'stash') return 0;
    const i = e.doc.tabs.findIndex((t) => t.type === StashTabType.Advanced);
    return i >= 0 ? i : 0;
  }

  /** Why the files can't change right now (a trade or unsaved changes would be lost), or undefined. */
  private busyReason(): string | undefined {
    if (this.tradeReceived.length) return 'Move your traded items out of Received first.';
    if (this.tradeOffered.length) return 'Take your offer back first (Clear in the Trade panel).';
    return undefined;
  }

  /** Adds dropped or picked files and reloads. Refused mid-trade or with unsaved changes. */
  async addFiles(list: { name: string; data: Uint8Array; modified?: number; handle?: FileSystemFileHandle }[]) {
    const saves = list.filter((f) => /\.(d2s|d2i)$/i.test(f.name));
    if (!saves.length) return this.toast('error', 'Drop a .d2i shared stash or a .d2s character.');
    const reason = this.busyReason() ?? (this.dirtyDocs.length ? 'Save your changes first.' : undefined);
    if (reason) return this.toast('error', reason);
    this.tradeClear();
    const paths = this.platform.add(saves);
    await this.openFolder(DROP_FOLDER);
    // show the newest drop on the left when it loaded
    const shown = paths.find((p) => this.docs.has(p));
    if (shown) this.use(shown);
  }

  /** Shows another loaded file on the left (the one you pay from and receive into). */
  use(id: string) {
    const e = this.docs.get(id);
    if (!e || id === this.currentId) return;
    const reason = this.busyReason();
    if (reason) return this.toast('error', reason);
    // a listing is softcore or hardcore, so it doesn't carry over to another file
    this.tradeClear();
    this.panes = [{ docId: id, tab: this.startTab(e) }, { docId: TRADE_ID, tab: 0 }];
    this.emit();
  }

  /** Whether saving writes the files back in place (otherwise they download). */
  get savesInPlace(): boolean {
    return this.platform.writesInPlace(this.dirtyDocs.map((d) => d.path));
  }

  /** Asks the browser for write access first (it needs the click that started the save), then saves. */
  async saveAll() {
    if (!this.settings.readOnly && !this.tradeReceived.length && !this.tradeOffered.length) await this.platform.askToWrite(this.dirtyDocs.map((d) => d.path));
    return super.saveAll();
  }

  /** Label for the save button. */
  saveLabel(): string {
    const n = this.dirtyDocs.length;
    if (!n) return 'Saved';
    return this.savesInPlace ? `Save ${n === 1 ? 'file' : `${n} files`}` : `Download ${n === 1 ? 'file' : `${n} files`}`;
  }

  /** The character or stash's name, for the file picker. */
  label(e: LoadedDoc): string {
    const d = e.doc;
    if (d?.kind === 'character') return `${(d as D2Character).name} (${(d as D2Character).hardcore ? 'hardcore' : 'softcore'} character)`;
    if (d?.kind === 'stash') return `Shared stash (${(d as D2SharedStash).hardcore ? 'hardcore' : 'softcore'})`;
    return e.name;
  }
}
