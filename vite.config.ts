import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Tauri expects a fixed port in dev and relative asset paths in production builds.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Don't watch Rust build output: on Windows, cargo locks DLLs in target/ and the watcher crashes with EBUSY.
    watch: { ignored: ['**/src-tauri/**', '**/node_modules/**', '**/dist/**', '**/scratch/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: 'es2021', outDir: 'dist', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
});
