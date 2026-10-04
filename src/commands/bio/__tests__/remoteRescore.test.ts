import { afterEach, describe, expect, it } from 'vitest';
import type { StoreChange } from '@/store';
import { flushRescore, remoteBioDate, rescoreOnRemoteBio, resetBioRuntime, setAutoRescore, setRescoreRunner } from '../runtime';

/** Q9: ring records that reach a browser by sync were never scored there (scores are derived, never synced). */
describe('rescore on biometrics that arrive by sync', () => {
  afterEach(() => {
    resetBioRuntime();
    setAutoRescore(false);
  });

  const fakeStore = () => {
    let fn: ((c: StoreChange) => void) | null = null;
    return { subscribe: (f: (c: StoreChange) => void) => ((fn = f), () => (fn = null)), emit: (c: Partial<StoreChange>) => fn?.({ seq: 1, id: 'x', doc: {}, origin: 'remote', col: 'bioRecords', ...c } as StoreChange) };
  };

  it('schedules a rescore from the earliest day a remote record or correction touches; local writes and other collections do not', async () => {
    setAutoRescore(false);
    const calls: Array<string | null> = [];
    setRescoreRunner(async (from) => void calls.push(from));
    const s = fakeStore();
    const off = rescoreOnRemoteBio(s);
    s.emit({ col: 'bioRecords', origin: 'local', doc: { time: { local_date: '2026-09-01' } } as never });
    s.emit({ col: 'logEntries' as never, doc: { time: { local_date: '2026-09-02' } } as never });
    s.emit({ col: 'bioRecords', doc: { kind: 'daily', time: { local_date: '2026-10-03' } } as never });
    s.emit({ col: 'bioRecords', doc: { kind: 'sleep', time: { start: '2026-10-02T17:40:00.000Z', end: '2026-10-03T01:10:00.000Z' } } as never });
    s.emit({ col: 'bioCorrections', doc: { target: { kind: 'sleep', localDate: '2026-10-03' } } as never });
    await flushRescore();
    // the local write (2026-09-01) and the other collection (2026-09-02) would have moved the start earlier
    expect(calls).toEqual(['2026-10-01']);
    s.emit({ col: 'bioChunks', doc: { stream: 'hr', local_date: '2026-09-25' } as never });
    await flushRescore();
    expect(calls).toEqual(['2026-10-01', '2026-09-24']);
    off();
  });

  it('reads the day of each document kind, a day early', () => {
    expect(remoteBioDate('bioRecords', { time: { local_date: '2026-10-03' } })).toBe('2026-10-02');
    expect(remoteBioDate('bioRecords', { time: { start: '2026-10-02T17:40:00Z' } })).toBe('2026-10-01');
    expect(remoteBioDate('bioCorrections', { target: { localDate: '2026-10-03' } })).toBe('2026-10-02');
    expect(remoteBioDate('bioRecords', {})).toBeNull();
    // a sample chunk (heart rate of a night that arrives after its sleep record); a replaced one is not news
    expect(remoteBioDate('bioChunks', { local_date: '2026-10-03', stream: 'hr' })).toBe('2026-10-02');
    expect(remoteBioDate('bioChunks', { local_date: '2026-10-03', superseded: true })).toBeNull();
  });
});
