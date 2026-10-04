/**
 * The store-backed signals source. `bio.series` keeps only the newest 5 000 raw samples of one answer, so a window of
 * several local dates (a week or a month of heart rate) must be read one date at a time, or the earlier days silently
 * drop out of the week and month charts.
 */
import { describe, expect, it, vi } from 'vitest';

const { calls, answers } = vi.hoisted(() => ({
  calls: [] as Array<{ metric: string; from: string; to: string; resolution: string }>,
  answers: new Map<string, { ok: boolean; output?: { points: Array<{ t: string; value: number }> } }>(),
}));

vi.mock('@/features/lib/sendCommand', () => ({
  sendCommand: vi.fn(async (_name: string, input: { metric: string; from: string; to: string; resolution: string }) => {
    calls.push(input);
    return (
      answers.get(input.from) ?? {
        ok: true,
        output: { points: [{ t: `${input.from}T18:00:00Z`, value: 70 }, { t: `${input.from}T06:00:00Z`, value: 60 }] },
      }
    );
  }),
}));

// a document store that is still loading until `release()` (the real one hydrates in about 0.5 to 3 s at start)
const { slowStore } = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((r) => (release = r));
  return { slowStore: { ready, release: () => release(), peekAll: () => [], subscribe: () => () => undefined } };
});
vi.mock('@/state/runtime', async (importOriginal) => ({ ...(await importOriginal<object>()), getDocumentStore: () => slowStore }));

import { storeSignalsSource } from '../data';

describe('storeSignalsSource.ready', () => {
  it('is false while the store hydrates (no answer yet), then true with a revision bump to subscribers', async () => {
    const src = storeSignalsSource();
    const seen = vi.fn();
    const off = src.subscribe(seen);
    const rev0 = src.revision();
    expect(src.ready?.()).toBe(false);
    expect(src.firstDate()).toBeNull();
    slowStore.release();
    await slowStore.ready;
    await Promise.resolve();
    expect(src.ready?.()).toBe(true);
    expect(src.revision()).toBeGreaterThan(rev0);
    expect(seen).toHaveBeenCalled();
    expect(src.firstDate()).toBeNull(); // loaded and empty: now "nothing stored" is an answer
    off();
  });
});

describe('storeSignalsSource.series', () => {
  it('reads one raw day per local date (deduplicated, in order) and merges the answers in time order', async () => {
    calls.length = 0;
    const src = storeSignalsSource();
    const from = Date.parse('2026-10-01T00:00:00Z'), to = Date.parse('2026-10-03T00:00:00Z');
    const pts = await src.series('hr', from, to, ['2026-10-02', '2026-10-01', '2026-10-01']);
    expect(calls).toEqual([
      { metric: 'hr', from: '2026-10-01', to: '2026-10-01', resolution: 'raw' },
      { metric: 'hr', from: '2026-10-02', to: '2026-10-02', resolution: 'raw' },
    ]);
    expect(pts.map((p) => `${new Date(p.t).toISOString()} ${p.v}`)).toEqual([
      '2026-10-01T06:00:00.000Z 60',
      '2026-10-01T18:00:00.000Z 70',
      '2026-10-02T06:00:00.000Z 60',
      '2026-10-02T18:00:00.000Z 70',
    ]);
  });

  it('keeps only samples inside [fromMs, toMs] and nothing with no dates', async () => {
    calls.length = 0;
    const src = storeSignalsSource();
    const from = Date.parse('2026-10-01T12:00:00Z'), to = Date.parse('2026-10-02T12:00:00Z');
    const pts = await src.series('hr', from, to, ['2026-10-01', '2026-10-02']);
    expect(pts.map((p) => new Date(p.t).toISOString())).toEqual(['2026-10-01T18:00:00.000Z', '2026-10-02T06:00:00.000Z']);
    expect(await src.series('hr', from, to, [])).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('one failed day fails the read (the chart offers Try again), never a half answer', async () => {
    answers.set('2026-10-02', { ok: false });
    const src = storeSignalsSource();
    await expect(src.series('hr', 0, Date.parse('2026-10-03T00:00:00Z'), ['2026-10-01', '2026-10-02'])).rejects.toThrow();
    answers.clear();
  });
});
