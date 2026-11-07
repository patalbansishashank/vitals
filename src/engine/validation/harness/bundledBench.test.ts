// @vitest-environment node
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withBundledBench } from './bundledBench';
import { measureWithLoadRetry } from './loadRetry';

const { build } = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('vite', () => ({ build }));
const directories: string[] = [];

beforeEach(() => {
  build.mockReset();
  build.mockImplementation(async (config: { build: { outDir: string } }) => {
    directories.push(config.build.outDir);
    writeFileSync(join(config.build.outDir, 'bench.mjs'), `
      let calls = 0;
      export function benchEngine(runs) {
        calls++;
        return [{mode:'planner', bestMs:calls === 1 ? 12 : 9, medianMs:runs}];
      }
    `);
  });
});
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('production benchmark module lifecycle', () => {
  it('builds/imports once for the 15/25 retry, then removes its temporary bundle', async () => {
    let clock = 0;
    const loads = [1.28, 0.4, 0.3];
    const result = await withBundledBench((bench) => measureWithLoadRetry(bench, (rows) => rows[0]!.bestMs <= 10, {
      deadlineMs: 240_000,
      load: () => loads.shift()!, now: () => clock, sleep: async (ms) => { clock += ms; },
    }));
    expect(build).toHaveBeenCalledTimes(1);
    expect(result.first.rows).toEqual([{ mode: 'planner', bestMs: 12, medianMs: 15 }]);
    expect(result.retry?.rows).toEqual([{ mode: 'planner', bestMs: 9, medianMs: 25 }]);
    expect(result.wait?.waitedMs).toBe(1000);
    expect(existsSync(directories[0]!)).toBe(false);
  });

  it('a later measurement scope builds a fresh module instead of keeping a global source cache', async () => {
    const first = await withBundledBench((bench) => bench(15));
    const second = await withBundledBench((bench) => bench(15));
    expect(build).toHaveBeenCalledTimes(2);
    expect(directories[0]).not.toBe(directories[1]);
    expect(first[0]!.bestMs).toBe(12);
    expect(second[0]!.bestMs).toBe(12);
    expect(directories.every((dir) => !existsSync(dir))).toBe(true);
  });

  it('cleans the bundle when a budget assertion or measurement callback fails', async () => {
    await expect(withBundledBench((bench) => {
      bench(15);
      throw new Error('synthetic budget failure');
    })).rejects.toThrow('synthetic budget failure');
    expect(existsSync(directories[0]!)).toBe(false);
  });

  it.each(['build', 'import'])('cleans up after a %s failure', async (stage) => {
    build.mockImplementation(async (config: { build: { outDir: string } }) => {
      directories.push(config.build.outDir);
      if (stage === 'build') throw new Error('synthetic build failure');
      writeFileSync(join(config.build.outDir, 'bench.mjs'), "throw new Error('synthetic import failure');");
    });
    await expect(withBundledBench((bench) => bench(15))).rejects.toThrow(`synthetic ${stage} failure`);
    expect(existsSync(directories[0]!)).toBe(false);
  });
});
