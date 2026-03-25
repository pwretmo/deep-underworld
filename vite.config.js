import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
