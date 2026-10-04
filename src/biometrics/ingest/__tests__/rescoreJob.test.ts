import { describe, expect, it } from 'vitest';
import { makeResult } from '../../core/scores/util';
import { daily, dateRange, fakeDef } from '../../core/scores/__tests__/fixtures';
import type { ScoreDef } from '../../core/types';
import { InMemoryBioStore } from '../../store/memory';
import { rescoreHistory } from '../rescoreJob';

const NOW = '2026-10-01T00:00:00.000Z';
const dates = dateRange('2026-06-30', 5);

/** Value = number of resolved days seen; hash covers the day's steps so edited inputs change it. */
const counting = (version: string): ScoreDef => fakeDef('t.count', version, [], (i) =>
  makeResult('t.count', version, i, { status: 'ok', value: i.days.length, hashOf: i.days.map((d) => [d.localDate, d.daily?.steps ?? null]) }));

async function seeded(): Promise<InMemoryBioStore> {
  const s = new InMemoryBioStore();
  for (const d of dates) await s.putRecord(daily(d, { steps: 1000 }), 'src');
  return s;
}
const base = { from: dates[0]!, to: dates.at(-1)!, now: NOW, build: 't' };

describe('rescoreHistory', () => {
  it('computes every day, newest first, with progress', async () => {
    const s = await seeded();
    const seen: number[] = [];
    const rep = await rescoreHistory(s, { ...base, defs: [counting('1.0.0')], onProgress: (p) => seen.push(p.done) });
    expect(rep).toMatchObject({ planned: 5, computed: 5, written: 5, skipped: 0, aborted: false });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(await s.scores({ scoreId: 't.count' })).toHaveLength(5);
  });
  it('bumping the version recomputes the whole history; both versions coexist', async () => {
    const s = await seeded();
    await rescoreHistory(s, { ...base, defs: [counting('1.0.0')] });
    const rep = await rescoreHistory(s, { ...base, defs: [counting('1.0.0'), counting('1.1.0')], mode: 'missing' });
    expect(rep.planned).toBe(5);
    expect(rep.written).toBe(5);
    const all = await s.scores({ scoreId: 't.count' });
    expect(all).toHaveLength(10);
    expect(new Set(all.map((r) => r.version))).toEqual(new Set(['1.0.0', '1.1.0']));
    expect(await s.scores({ scoreId: 't.count', version: '1.0.0' })).toHaveLength(5);
  });
  it('unchanged inputs are skipped; changed inputs rewrite only affected days', async () => {
    const s = await seeded();
    const defs = [counting('1.0.0')];
    await rescoreHistory(s, { ...base, defs });
    expect((await rescoreHistory(s, { ...base, defs, mode: 'missing' })).planned).toBe(0);
    const again = await rescoreHistory(s, { ...base, defs });
    expect(again).toMatchObject({ computed: 5, written: 0, skipped: 5 });
    await s.putRecord({ ...daily(dates[2]!, { steps: 9999 }), version: 2 }, 'src');
    const edited = await rescoreHistory(s, { ...base, defs });
    expect(edited).toMatchObject({ written: 3, skipped: 2 }); // the edited day and later days that see it in their history
  });
  it('a day whose input cannot be read is reported and the other days are scored', async () => {
    const s = await seeded();
    const bad = dates[2]!;
    // as a synced chunk whose bytes are not on the sync server yet: reading that day fails
    const records = s.records.bind(s);
    s.records = (q) => (q?.to === bad ? Promise.reject(new Error('Chunk x is not stored on this device or on the sync server.')) : records(q));
    const rep = await rescoreHistory(s, { ...base, defs: [counting('1.0.0')] });
    expect(rep).toMatchObject({ computed: 4, written: 4, aborted: false, unavailable: [bad] });
    expect((await s.scores({ scoreId: 't.count' })).map((r) => r.scope.localDate).sort()).toEqual(dates.filter((d) => d !== bad));
  });
  it('is interruptible via AbortSignal', async () => {
    const s = await seeded();
    const ac = new AbortController();
    const rep = await rescoreHistory(s, { ...base, defs: [counting('1.0.0')], signal: ac.signal, onProgress: (p) => { if (p.done === 2) ac.abort(); } });
    expect(rep.aborted).toBe(true);
    expect(rep.written).toBe(2);
    // resume continues with what is missing
    const rest = await rescoreHistory(s, { ...base, defs: [counting('1.0.0')], mode: 'missing' });
    expect(rest.written).toBe(3);
  });
  it('dependents see earlier days as prior regardless of the newest-first order', async () => {
    const s = await seeded();
    const dep = fakeDef('t.dep', '1.0.0', ['t.count'], (i) => makeResult('t.dep', '1.0.0', i, { status: 'ok', value: i.prior['t.count']?.length ?? 0, hashOf: i.localDate }));
    await rescoreHistory(s, { ...base, defs: [counting('1.0.0'), dep] });
    const v = (await s.scores({ scoreId: 't.dep' })).sort((a, b) => a.scope.localDate.localeCompare(b.scope.localDate)).map((r) => r.value);
    expect(v).toEqual([1, 2, 3, 4, 5]);
  });
});
