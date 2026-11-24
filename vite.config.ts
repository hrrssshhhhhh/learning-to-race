import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), results: resolve(import.meta.dirname, 'results.html') },
    },
  },
  test: { globals: true },
});
