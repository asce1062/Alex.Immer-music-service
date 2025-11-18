import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  target: 'es2018',
  outDir: 'dist',
  treeshake: true,
  globalName: 'MusicServiceSDK',
  esbuildOptions(options) {
    options.banner = {
      js: '/* @asce1062/music-service-sdk v1.0.0-beta.1 | MIT License | https://github.com/asce1062/Alex.Immer-music-service */',
    };
  },
  // Mark Workbox as external for CDN usage
  external: [],
  // Bundle everything for easier distribution
  noExternal: [
    'flexsearch',
    'jsmediatags',
    'zod',
    'workbox-cacheable-response',
    'workbox-core',
    'workbox-expiration',
    'workbox-range-requests',
    'workbox-routing',
    'workbox-strategies',
  ],
});
