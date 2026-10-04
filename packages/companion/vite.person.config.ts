import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The person worker (src/home/personWorkerEntry.ts) as one ES module for plain Node: `pnpm build:person` →
// dist/person-worker.mjs. App code under the repo's src/ and the app's npm dependencies are bundled; only this
// package's own dependencies stay external (installed next to it with `npm install --omit=dev`; better-sqlite3 is
// native, R17 blocker 13), so the server runs without the repo checkout.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
const own = Object.keys(pkg.dependencies);
const external = (id: string) => id.startsWith('node:') || builtinModules.includes(id) || own.some((d) => id === d || id.startsWith(`${d}/`));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  logLevel: 'warn',
  build: {
    ssr: 'src/home/personWorkerEntry.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node22',
    rolldownOptions: { external, output: { format: 'es', entryFileNames: 'person-worker.mjs', codeSplitting: false } },
  },
  ssr: { target: 'node', noExternal: true },
});
