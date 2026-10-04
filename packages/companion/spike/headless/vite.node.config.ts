import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// R17: bundle main.ts for plain Node (`pnpm vite build -c packages/companion/spike/headless/vite.node.config.ts`).
// npm dependencies stay external (resolved from node_modules at run time); app code under src/ is bundled.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../../../src', import.meta.url)) } },
  build: {
    ssr: 'main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    rolldownOptions: { output: { format: 'es', entryFileNames: 'main.mjs' } },
  },
  ssr: { target: 'node' },
});
