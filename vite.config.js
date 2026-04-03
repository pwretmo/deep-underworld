import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    open: false,
  },
  test: {
    include: ['src/**/*.test.js'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-three',
              test: /node_modules[\\/]three/,
              priority: 20,
            },
            {
              name: 'vendor-rapier',
              test: /node_modules[\\/]@dimforge/,
              priority: 15,
            },
            {
              name: 'creatures',
              test: /src[\\/]creatures[\\/](?!CreatureManager)/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
