import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        forest: resolve(__dirname, 'forest.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
