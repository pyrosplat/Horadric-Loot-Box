import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Tauri expects a fixed port in dev and relative asset paths in production builds.
// `--mode web` builds the trade-only web page from web/ into dist-web (published to GitHub Pages).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  clearScreen: false,
  ...(mode === 'web' ? { root: 'web', publicDir: '../public' } : {}),
  server: {
    port: mode === 'web' ? 5175 : 5173,
    strictPort: true,
    // Don't watch Rust build output: on Windows, cargo locks DLLs in target/ and the watcher crashes with EBUSY.
    watch: { ignored: ['**/src-tauri/**', '**/node_modules/**', '**/dist/**', '**/scratch/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: 'es2021', outDir: mode === 'web' ? '../dist-web' : 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
}));
