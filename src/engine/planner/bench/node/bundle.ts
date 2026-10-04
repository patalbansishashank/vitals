/**
 * Bundles the benchmark worker (`worker.ts` with the live planner, the frozen v1 optimiser, the domain and the engine)
 * into one ES module with Vite, so Node `worker_threads` can load it without a TypeScript loader. Rebuilt for every
 * benchmark run (the planner code changes between runs); output under node_modules/.cache (never /tmp).
 */
import path from 'node:path';

export async function bundleWorker(root: string): Promise<string> {
  const { build } = await import('vite');
  const outDir = path.join(root, 'node_modules', '.cache', 'planner-bench');
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    mode: 'production',
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: {
      ssr: path.join(root, 'src', 'engine', 'planner', 'bench', 'node', 'worker.ts'),
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: 'node22',
      write: true,
      rolldownOptions: { output: { format: 'es', entryFileNames: 'worker.mjs', codeSplitting: false } },
    },
    ssr: { noExternal: true, target: 'node' },
  });
  return path.join(outDir, 'worker.mjs');
}
