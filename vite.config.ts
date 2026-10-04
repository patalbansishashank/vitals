import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Response headers for `pnpm preview`. netlify.toml sends the same CSP and Permissions-Policy in production, and
// tests/config/headers.test.ts fails if the two drift apart or leave docs/SUITE_SPEC.md §9.1. HSTS and the immutable cache
// rules are Netlify-only (they mean nothing on http://localhost).
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=(), bluetooth=(self)';

// Evolu (opt-in sync, E11) is lazy: loaded only after a device pairs. Its files are kept OUT of the service worker's precache
// (every first-time visitor would otherwise download ~1.5 MB raw / ~700 KB gz for a feature most never turn on) and are
// cached at runtime instead: CacheFirst, the first time a paired device loads them. The wasm is not in `globPatterns`
// anyway; the JS names below are (`sync-evolu-*` is src/sync/evolu/{adapter,webPlatform}.ts, named in `chunkFileNames`;
// `Evolu-*` is the @evolu/common chunk; `Db.worker-*` / `Shared.worker-*` are @evolu/web's two workers). Keep the lists in
// step: the `evolu-chunks` plugin below fails the build if a pattern stops matching a built file.
const EVOLU_PREFIXES = ['sync-evolu-', 'Evolu-', 'Db.worker-', 'Shared.worker-', 'sqlite3-'];
const EVOLU_PRECACHE_IGNORES = EVOLU_PREFIXES.map((prefix) => `assets/${prefix}*`);
const EVOLU_RUNTIME_URL = new RegExp(`/assets/(?:${EVOLU_PREFIXES.map((prefix) => prefix.replaceAll('.', '\\.')).join('|')})[^/]+\\.(?:js|wasm)$`);
// pdf.js (blood-test report reading, E20) is lazy too: only the markers extraction worker loads it, when a person picks a
// report. Same treatment as Evolu: out of the precache (~1.6 MB raw), cached at runtime on first use.
const PDF_PREFIXES = ['pdf-', 'pdf.worker-'];
const PDF_PRECACHE_IGNORES = PDF_PREFIXES.map((prefix) => `assets/${prefix}*`);
const PDF_RUNTIME_URL = new RegExp(`/assets/(?:${PDF_PREFIXES.map((prefix) => prefix.replaceAll('.', '\\.')).join('|')})[^/]+\\.(?:js|mjs)$`);

// The version shown in Settings › About and written into exports comes from package.json, so a release bump reaches
// the app without a second edit (0.1.0 stayed on screen through v0.2.0 and v0.3.0).
const PKG_VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(PKG_VERSION) },
  plugins: [
    {
      name: 'evolu-chunks',
      apply: 'build',
      generateBundle(_options, bundle) {
        const names = Object.keys(bundle);
        for (const prefix of [...EVOLU_PREFIXES, ...PDF_PREFIXES]) {
          if (!names.some((name) => name.startsWith(`assets/${prefix}`))) {
            this.error(`vite.config.ts: no built file starts with assets/${prefix}; update EVOLU_PREFIXES / PDF_PREFIXES so the lazy chunks stay out of the precache.`);
          }
        }
      },
    },
    react(),
    tailwindcss(),
    // Offline-first shell: a Workbox generateSW worker at /sw.js precaches every built file (JS/CSS chunks, the
    // engine worker, fonts, icons, the manifest, index.html). The app registers it itself after load and asks the
    // user before swapping versions (src/app/pwa), so the plugin injects nothing and the manifest stays the
    // hand-written public/manifest.webmanifest. Everything that is not opt-in sync is precached; Evolu (paired devices
    // only) is cached at runtime. CSP stays strict: nothing external is cached or fetched.
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      strategies: 'generateSW',
      manifest: false,
      devOptions: { enabled: false },
      workbox: {
        // `figure/*.bin` is the 3D figure pack (public/figure/figure-v1.bin, 188 KB). It is precached rather than cached on
        // first use: the Body page draws it for everyone, it is small next to the rest of the shell, and "works offline"
        // should not depend on having opened that page once. Its file name is versioned, so the revision never churns.
        // No `.wasm` here: the only WebAssembly is Evolu's, which is runtime-cached below.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}', 'figure/*.bin'],
        // sourcemaps are never precached (and are off in this build anyway); Evolu stays out of the precache (see EVOLU_PREFIXES).
        globIgnores: ['**/*.map', ...EVOLU_PRECACHE_IGNORES, ...PDF_PRECACHE_IGNORES],
        // 5 MiB per file. The largest precached file is the engine worker, ~1.3 MB; the default 2 MiB leaves too little
        // room for it to grow. A file over the limit is dropped from the precache with a warning in the build log, so read
        // that log: `pnpm build` must not print "greater than maximumFileSizeToCacheInBytes".
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html', // the SPA: every navigation is served the shell, the router renders the route
        navigateFallbackDenylist: [/^\/sw\.js$/, /^\/workbox-[^/]+\.js$/, /^\/manifest\.webmanifest$/, /^\/assets\//, /^\/icons\//, /^\/figure\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true, // first visit: the worker controls the page at once, so "works offline" is true without a reload
        // Same-origin only, Evolu only. Cache-first is safe because every file has a content hash in its name: a new
        // release asks for new names, and the old entries age out below. A device that paired before an update reloads
        // them once, online; until then sync is paused and the app keeps working from the documents on the device.
        runtimeCaching: [
          {
            urlPattern: EVOLU_RUNTIME_URL,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vitals-evolu',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 24 * 60 * 60, purgeOnQuotaError: true }, // two releases' worth
            },
          },
          {
            urlPattern: PDF_RUNTIME_URL,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vitals-pdf',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 24 * 60 * 60, purgeOnQuotaError: true },
            },
          },
        ],
        sourcemap: false,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Give the two Evolu entry chunks a recognisable name: `adapter` alone also names a UI chunk (see EVOLU_PREFIXES).
        chunkFileNames: (chunk) => (chunk.facadeModuleId?.includes('/src/sync/evolu/') ? 'assets/sync-evolu-[name]-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  // Same CSP and Permissions-Policy as netlify.toml, so `pnpm preview` shows WASM, workers, the camera and Bluetooth under
  // the production policy.
  preview: {
    headers: {
      'Content-Security-Policy': CSP,
      'Permissions-Policy': PERMISSIONS_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    // the desktop and Android apps' build output (and the generated Android project) is never a test source
    exclude: [...configDefaults.exclude, 'apps/*/dist/**', 'apps/*/release/**', 'apps/android/android/**'],
    css: false,
  },
});
