import { describe, expect, it } from 'vitest';
import { reconcileSleep } from '../reconcileSleep';
import { resolveDays, type SourcedRecord } from '../resolve';
import { daily, sleep } from './factory';

const BASE = Date.parse('2026-10-03T22:00:00.000Z');
const HOUR = 3_600_000;
const iso = (hours: number) => new Date(BASE + hours * HOUR).toISOString();
function session(id: string, start: number, end: number, provisional = false, sourceKey = 'synthetic-ring-a', version = 1): SourcedRecord {
  const record = sleep(id, iso(end).slice(0, 10), (end - start) * 3600, true, undefined, iso(start));
  record.time.end = iso(end);
  record.version = version;
  if (provisional) record.quality.flags.push('provisional_stages');
  return { sourceKey, record };
}
function permutations<T>(entries: readonly T[]): T[][] {
  return entries.length === 0 ? [[]] : entries.flatMap((entry, i) => permutations(entries.filter((_, j) => i !== j)).map((rest) => [entry, ...rest]));
}
const ids = (entries: readonly SourcedRecord[]) => reconcileSleep(entries).map((e) => e.record.record_id).sort();

describe('reconcileSleep', () => {
  it('converges strict and equal containment in every delivery order, regardless of provisional recency', () => {
    const complete = session('complete', 0, 8, false, undefined, 1);
    const entries = [complete, session('tail', 3, 7, true, undefined, 500), session('same', 0, 8, true, undefined, 900)];
    for (const order of permutations(entries)) {
      expect(ids(order)).toEqual(['complete']);
      expect(reconcileSleep(order)[0]).toBe(complete);
    }
    expect(entries[1]!.record.quality.flags).toContain('provisional_stages');
  });

  it('keeps the containing provisional while a night grows, with deterministic equal-interval ties', () => {
    const entries = [session('outer-old', 0, 8, true, undefined, 1), session('outer-z', 0, 8, true, undefined, 2), session('outer-a', 0, 8, true, undefined, 2), session('inner', 1, 7, true, undefined, 100)];
    for (const order of permutations(entries)) expect(ids(order)).toEqual(['outer-a']);
  });

  it('keeps distinct sources even when one source contains another source\'s provisional read', () => {
    const a = session('full-a', 0, 8);
    const b = session('tail-b', 2, 6, true, 'synthetic-ring-b');
    expect(ids([a, b])).toEqual(['full-a', 'tail-b']);
    expect(ids([b, a])).toEqual(['full-a', 'tail-b']);
  });

  it('preserves complete sessions, disjoint and touching naps, and partial overlaps', () => {
    const entries = [session('full', 0, 8), session('complete-inner', 1, 7), session('partial', 7, 9, true), session('touching', 9, 10, true), session('nap', 12, 13, true)];
    const expected = ['complete-inner', 'full', 'nap', 'partial', 'touching'];
    for (const order of permutations(entries)) expect(ids(order)).toEqual(expected);
  });

  it('does not discard a provisional containing a shorter complete session', () => {
    const entries = [session('outer', 0, 8, true), session('complete', 2, 6)];
    for (const order of permutations(entries)) expect(ids(order)).toEqual(['complete', 'outer']);
  });

  it('preserves missing, malformed, reversed, and zero-duration intervals and ordinary records', () => {
    const missing = session('missing', 0, 4, true);
    delete missing.record.time.end;
    const malformed = session('malformed', 0, 4, true);
    malformed.record.time.start = 'invalid';
    const reversed = session('reversed', 4, 0, true);
    const empty = session('empty', 2, 2, true);
    const ordinary: SourcedRecord = { sourceKey: 'synthetic-ring-a', record: daily('daily', '2026-10-04', { steps: 100 }) };
    const entries = [session('full', 0, 8), missing, malformed, reversed, empty, ordinary];
    expect(ids(entries)).toEqual(['daily', 'empty', 'full', 'malformed', 'missing', 'reversed']);
    expect(ids(entries.toReversed())).toEqual(ids(entries));
  });

  it('resolves raw nights before filtering wake dates across midnight', () => {
    const tail = session('tail', 0.5, 1, true);
    const full = session('full', 0, 8);
    for (const order of permutations([tail, full])) {
      expect(resolveDays(order, [], { from: '2026-10-03', to: '2026-10-03' })).toEqual([]);
      const [day] = resolveDays(order, [], { from: '2026-10-04', to: '2026-10-04' });
      expect(day?.sleeps.map((r) => r.record_id)).toEqual(['full']);
      expect(day?.mainSleep?.record_id).toBe('full');
    }
  });
});
