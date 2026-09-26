import { GD } from '../core';
import { norm, type ArtBackend, type ArtInfo } from '../art';
import type { Platform, SaveFileEntry } from './types';

/**
 * Stand-in artwork for UI development (`?demoart` in the URL). Blizzard's sprites can't be bundled, so these are
 * plain generated shapes; the real app reads the player's own install.
 */
function demoArt(): ArtBackend {
  const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const info = (): ArtInfo => {
    const items = Object.entries(GD.items).map(([code, d]) => ({ [code]: { asset: `${d.type}/${norm(d.name)}` } }));
    const sprites = Object.values(GD.items).map((d) => `${d.kind}/${d.type}/${norm(d.name)}`);
    return { kind: 'demo', path: 'Generated placeholder art', sprites, items_json: JSON.stringify(items), uniques_json: null, sets_json: null };
  };
  return {
    detectInstalls: async () => ['demo'],
    pickFolder: async () => 'demo',
    open: async () => info(),
    close: async () => {},
    probe: async () => [],
    url(key) {
      const base = key.slice(key.lastIndexOf('/') + 1);
      const h = hue(key.split('/')[1] ?? key);
      const label = base.split('_').map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 3);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="g" cx="40%" cy="35%"><stop offset="0" stop-color="hsl(${h},45%,62%)"/><stop offset="1" stop-color="hsl(${h},35%,22%)"/></radialGradient></defs><path d="M50 6 L88 30 L80 82 L50 96 L20 82 L12 30Z" fill="url(#g)" stroke="hsl(${h},30%,12%)" stroke-width="3"/><text x="50" y="62" font-family="serif" font-size="26" font-weight="bold" text-anchor="middle" fill="rgba(0,0,0,.45)">${label}</text></svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
  };
}


const DEMO_FILES = [
  'ChaosSC.d2s',
  'Warlock_v105.d2s',
  'Soska.d2s',
  'Roka.d2s',
  'barbexp_v105.d2s',
  'ModernSharedStashSoftCoreV2.d2i',
  'SharedStashSoftCoreV2.d2i',
];

/** In-memory sandbox using the bundled sample saves. Nothing touches the disk. */
export function createDemoPlatform(): Platform {
  const files = new Map<string, Uint8Array>();
  const vaults = new Map<string, string>();
  let loaded = false;
  const base = `${import.meta.env.BASE_URL ?? './'}demo/`;

  async function ensure() {
    if (loaded) return;
    loaded = true;
    await Promise.all(
      DEMO_FILES.map(async (f) => {
        const res = await fetch(base + f);
        if (res.ok) files.set(`demo/${f}`, new Uint8Array(await res.arrayBuffer()));
      }),
    );
  }

  return {
    id: 'demo',
    label: 'Demo sandbox',
    canWrite: false,
    async detectSaveFolders() {
      return ['demo/'];
    },
    async pickFolder() {
      return 'demo/';
    },
    async listSaves() {
      await ensure();
      return [...files.entries()].map(([path, d]): SaveFileEntry => ({ name: path.slice(5), path, size: d.length }));
    },
    async readFile(path) {
      await ensure();
      const d = files.get(path);
      if (!d) throw new Error(`No such demo file ${path}`);
      return d.slice();
    },
    async writeFileAtomic(path, data) {
      files.set(path, data.slice());
    },
    async backupFiles() {
      return '(demo: no backups needed)';
    },
    async listVaults() {
      return [...vaults.entries()].map(([path, t]) => ({ name: path.split('/').pop()!, path, size: t.length }));
    },
    async readText(path) {
      const t = vaults.get(path);
      if (t === undefined) throw new Error('No such vault');
      return t;
    },
    async writeVault(name, text, existingPath) {
      const path = existingPath ?? `vaults/${name}.hlb.json`;
      vaults.set(path, text);
      return path;
    },
    async isGameRunning() {
      return false;
    },
    async deleteVault(path) {
      vaults.delete(path);
      return '(demo: nothing kept)';
    },
    async deleteCharacter(path) {
      files.delete(path);
      return '(demo: nothing kept)';
    },
    art: typeof location !== 'undefined' && location.search.includes('demoart') ? demoArt() : undefined,
  };
}
