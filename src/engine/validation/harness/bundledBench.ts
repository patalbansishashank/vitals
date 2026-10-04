/**
 * Runs `bench/benchEntry.ts` as a production bundle (Vite/Rolldown build, minified off, no Vitest transform) inside the
 * current Node process — the honest O-11 measurement from a test. Node-only (uses the file system and a dynamic import).
 */
import type { BenchRow } from '../bench/benchEntry';

export async function runBundledBench(runs = 15): Promise<BenchRow[]> {
  const g = globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } };
  const get = g.process?.getBuiltinModule;
  if (!get) throw new Error('runBundledBench needs Node');
  const path = get('node:path') as { join(...p: string[]): string; resolve(...p: string[]): string };
  const os = get('node:os') as { tmpdir(): string };
  const fs = get('node:fs') as { mkdtempSync(p: string): string; rmSync(p: string, o: object): void };
  const url = get('node:url') as { pathToFileURL(p: string): { href: string } };
  const { build } = await import('vite');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitals-bench-'));
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: path.resolve('src/engine/validation/bench/benchEntry.ts'),
        outDir,
        minify: false,
        sourcemap: false,
        target: 'es2022',
        rollupOptions: { output: { format: 'es', entryFileNames: 'bench.mjs' } },
      },
    });
    const mod = (await import(/* @vite-ignore */ url.pathToFileURL(path.join(outDir, 'bench.mjs')).href)) as { benchEngine(runs: number): BenchRow[] };
    return mod.benchEngine(runs);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
