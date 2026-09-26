import type { ArtBackend } from '../art';

export interface SaveFileEntry {
  name: string;
  path: string;
  size: number;
  modified?: number;
}

/**
 * Everything the UI needs from the host. Implemented for the Tauri desktop app, for Chromium browsers
 * (File System Access API) and for an in-memory demo.
 */
export interface Platform {
  readonly id: 'tauri' | 'browser' | 'demo';
  readonly label: string;
  /** Whether writes go back to real files. */
  readonly canWrite: boolean;
  /** Likely D2R save folders on this machine (Windows Saved Games, Proton/Wine prefixes on Linux). */
  detectSaveFolders(): Promise<string[]>;
  pickFolder(): Promise<string | null>;
  listSaves(folder: string): Promise<SaveFileEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Writes via a temporary file + rename so a crash never leaves a half-written save. */
  writeFileAtomic(path: string, data: Uint8Array): Promise<void>;
  /** Copies the given files into a timestamped backup folder; returns the folder path. */
  backupFiles(paths: string[]): Promise<string>;
  /** Vault storage (Horadric Loot Box's own unlimited stash files), kept in a folder inside the save folder. */
  listVaults(folder: string): Promise<SaveFileEntry[]>;
  readText(path: string): Promise<string>;
  writeVault(folder: string, name: string, text: string, existingPath?: string): Promise<string>;
  /** True if Diablo II: Resurrected appears to be running (saves must not be edited while it is). */
  isGameRunning(): Promise<boolean>;
  revealBackups?(): Promise<void>;
  /** Deletes a character (.d2s + companion files), keeping a copy in the backups folder. Returns that folder. */
  deleteCharacter?(path: string): Promise<string>;
  /** Deletes a saved vault file, keeping a copy in the backups folder. */
  deleteVault?(path: string): Promise<string>;
  /** Reads item artwork from the player's own game install (desktop app only). */
  art?: ArtBackend;
}
