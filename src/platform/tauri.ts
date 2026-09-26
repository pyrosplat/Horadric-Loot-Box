import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { ArtInfo } from '../art';
import { open } from '@tauri-apps/plugin-dialog';
import type { Platform, SaveFileEntry } from './types';

export const tauriPlatform: Platform = {
  id: 'tauri',
  label: 'Desktop',
  canWrite: true,
  detectSaveFolders: () => invoke<string[]>('detect_save_folders'),
  async pickFolder() {
    const r = await open({ directory: true, multiple: false, title: 'Choose your Diablo II: Resurrected save folder' });
    return typeof r === 'string' ? r : null;
  },
  listSaves: (folder) => invoke<SaveFileEntry[]>('list_saves', { folder }),
  readFile: async (path) => new Uint8Array(await invoke<number[]>('read_file', { path })),
  writeFileAtomic: (path, data) => invoke('write_file_atomic', { path, data: Array.from(data) }),
  backupFiles: (paths) => invoke<string>('backup_files', { paths }),
  listVaults: (folder) => invoke<SaveFileEntry[]>('list_vaults', { folder }),
  readText: (path) => invoke<string>('read_text', { path }),
  writeVault: (folder, name, text, existingPath) => invoke<string>('write_vault', { folder, name, text, existingPath: existingPath ?? null }),
  isGameRunning: () => invoke<boolean>('is_game_running'),
  revealBackups: () => invoke('reveal_backups'),
  deleteCharacter: (path) => invoke<string>('delete_character', { path }),
  deleteVault: (path) => invoke<string>('delete_vault', { path }),
  art: {
    detectInstalls: () => invoke<string[]>('art_detect_installs'),
    async pickFolder() {
      const r = await open({ directory: true, multiple: false, title: 'Choose your Diablo II Resurrected install folder (or an extracted data folder)' });
      return typeof r === 'string' ? r : null;
    },
    open: (path) => invoke<ArtInfo>('art_open', { path }),
    close: () => invoke('art_close'),
    probe: (keys) => invoke<string[]>('art_probe', { keys }),
    url: (key) => convertFileSrc(key, 'hlbart'),
  },
};

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
