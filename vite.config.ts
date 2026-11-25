import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    // The page opens straight into the 3D view, so Three.js (~600 kB of the main chunk) is needed at once;
    // splitting it off would add a request without making first paint any sooner.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), results: resolve(import.meta.dirname, 'results.html') },
    },
  },
  test: { globals: true },
});
