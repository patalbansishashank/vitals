import { describe, expect, it } from 'vitest';
import type { ScoreResult } from '../../types';
import { compareVersions, computeDay, latestVersions, planRescore, scoreOrder } from '../rescore';
import { makeResult } from '../util';
import { fakeDef, makeInput } from './fixtures';

const res = (id: string, version: string, date: string): ScoreResult => makeResult(id, version, makeInput(date), { status: 'ok', value: 1, scope: { kind: 'day', localDate: date } });

describe('versions and order', () => {
  it('compareVersions numeric', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('latestVersions picks the highest', () => {
    const m = latestVersions([fakeDef('a', '1.0.0'), fakeDef('a', '1.2.0'), fakeDef('b', '1.0.0')]);
    expect(m.get('a')!.version).toBe('1.2.0');
  });
  it('scoreOrder is topological; throws on cycles; ignores absent deps', () => {
    const o = scoreOrder([fakeDef('c', '1.0.0', ['b']), fakeDef('b', '1.0.0', ['a']), fakeDef('a', '1.0.0', ['gone'])]);
    expect(o.map((d) => d.scoreId)).toEqual(['a', 'b', 'c']);
    expect(() => scoreOrder([fakeDef('a', '1.0.0', ['b']), fakeDef('b', '1.0.0', ['a'])])).toThrow(/cycle/);
  });
});

describe('planRescore', () => {
  const dates = ['2026-01-01', '2026-06-01', '2026-06-02'];
  it('everything missing: newest first, recent 90 days before older', () => {
    const t = planRescore([fakeDef('a', '1.0.0')], [], dates);
    expect(t.map((x) => x.localDate)).toEqual(['2026-06-02', '2026-06-01', '2026-01-01']);
    expect(t.every((x) => x.reason === 'missing')).toBe(true);
  });
  it('a version bump plans every date for the new version only; old stays', () => {
    const cached = dates.map((d) => res('a', '1.0.0', d));
    const t = planRescore([fakeDef('a', '1.0.0'), fakeDef('a', '1.1.0')], cached, dates);
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.version === '1.1.0' && x.reason === 'new_version')).toBe(true);
  });
  it('unchanged: nothing unless verify or dirty', () => {
    const cached = dates.map((d) => res('a', '1.0.0', d));
    expect(planRescore([fakeDef('a', '1.0.0')], cached, dates)).toHaveLength(0);
    expect(planRescore([fakeDef('a', '1.0.0')], cached, dates, { verify: true })).toHaveLength(3);
    expect(planRescore([fakeDef('a', '1.0.0')], cached, dates, { dirtyDates: new Set(['2026-06-01']) })).toEqual([{ scoreId: 'a', version: '1.0.0', localDate: '2026-06-01', reason: 'verify' }]);
  });
  it('dependency order within a date', () => {
    const t = planRescore([fakeDef('b', '1.0.0', ['a']), fakeDef('a', '1.0.0')], [], ['2026-06-01']);
    expect(t.map((x) => x.scoreId)).toEqual(['a', 'b']);
  });
});

describe('computeDay', () => {
  it('feeds earlier results into prior for dependents; contains errors', () => {
    const a = fakeDef('a', '1.0.0');
    const b = fakeDef('b', '1.0.0', ['a'], (i) => makeResult('b', '1.0.0', i, { status: 'ok', value: i.prior['a']?.length ?? -1 }));
    const bad = fakeDef('bad', '1.0.0', [], () => { throw new Error('boom'); });
    const out = computeDay([b, bad, a], () => makeInput('2026-06-01'));
    expect(out.map((r) => r.scoreId)).toEqual(expect.arrayContaining(['a', 'b', 'bad']));
    expect(out.find((r) => r.scoreId === 'b')!.value).toBe(1);
    const e = out.find((r) => r.scoreId === 'bad')!;
    expect(e.status).toBe('withheld');
    expect(e.reason).toMatch(/boom/);
  });
});
