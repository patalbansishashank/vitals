import { describe, expect, it } from 'vitest';
import { resolveDays } from '../resolve';
import { inferTier, sourceKeyOf, suggestedPolicies, defaultPolicies, policyStreamOf } from '../source';
import type { BioSourceDoc } from '../types';
import { daily, prov, sleep } from './factory';

const ring = prov();
const watch = prov({ device: { type: 'watch', manufacturer: 'Wrist', model: 'W2', tier: 'A' } });
const doc = (p: typeof ring, priority: number): BioSourceDoc => ({ sourceKey: sourceKeyOf(p), label: 'x', tier: inferTier(p), priority, policies: [], baselineEpochs: [] });

describe('source', () => {
  it('keys are stable and normalised', () => {
    expect(sourceKeyOf(ring)).toBe('file:canonical|acme:r1');
    expect(sourceKeyOf(prov({ device: undefined, source_app: 'Health App' }))).toBe('file:canonical|app:health_app');
    expect(sourceKeyOf(prov({ device: undefined }))).toBe('file:canonical');
    expect(inferTier(prov({ device: undefined }))).toBe('C');
  });
  it('policies: all off by default; suggestions import+score, coach hidden, vendor never scores', () => {
    expect(defaultPolicies().every((p) => !p.imported && !p.scores && !p.engine && p.coach === 'hidden')).toBe(true);
    const [steps, spo2, vendor] = suggestedPolicies(['steps', 'spo2', 'vendor_scores']);
    expect(steps).toMatchObject({ imported: true, scores: true, engine: true, coach: 'hidden' });
    expect(spo2).toMatchObject({ imported: true, scores: true, engine: false });
    expect(vendor).toMatchObject({ imported: true, scores: false, engine: false });
    expect(policyStreamOf(sleep('s', '2026-03-10', 1, true))).toBe('sleep_sessions');
  });
});

describe('resolveDays', () => {
  const rk = sourceKeyOf(ring);
  const wk = sourceKeyOf(watch);
  const recs = [
    { sourceKey: rk, record: daily('r1', '2026-03-10', { steps: 9000, resting_hr_bpm: 55, spo2_avg_pct: 96 }, ring) },
    { sourceKey: wk, record: daily('w1', '2026-03-10', { steps: 9500, resting_hr_bpm: 58, hrv: { metric: 'sdnn', value_ms: 40, window: 'night' } }, watch) },
    { sourceKey: rk, record: sleep('rs', '2026-03-10', 25_000, true, ring) },
    { sourceKey: wk, record: sleep('ws', '2026-03-10', 27_000, true, watch) },
    { sourceKey: rk, record: daily('r2', '2026-03-09', { steps: 100 }, ring) },
  ];
  it('picks one source per metric by priority and never averages', () => {
    const days = resolveDays(recs, [doc(ring, 2), doc(watch, 1)]);
    expect(days.map((d) => d.localDate)).toEqual(['2026-03-09', '2026-03-10']);
    const d = days[1]!;
    expect(d.daily?.steps).toBe(9500);
    expect(d.daily?.resting_hr_bpm).toBe(58);
    expect(d.sourceByMetric.steps).toBe(wk);
    expect(d.tierByMetric.steps).toBe('A');
    expect(d.daily?.hrv?.value_ms).toBe(40);
    expect(d.sourceByMetric.spo2).toBe(rk); // only the ring has it: fall through, same group same source
    expect(d.tierByMetric.spo2).toBe('B');
    expect(d.mainSleep?.record_id).toBe('ws');
    expect(d.sleeps).toHaveLength(1);
  });
  it('stored priorities have no effect: the fixed order is tier, coverage, recency, source key', () => {
    expect(resolveDays(recs, [doc(ring, 1), doc(watch, 2)])[1]!.daily?.steps).toBe(9500);
    expect(resolveDays(recs, [{ ...doc(ring, 0), priorityByMetric: { steps: 0 } }, doc(watch, 9)])[1]!.daily?.steps).toBe(9500);
    // same tier: more fields present wins, then the newer import, then the key
    const b2 = prov({ device: { type: 'ring', manufacturer: 'Zed', model: 'Z1', tier: 'B' } });
    const zk = sourceKeyOf(b2);
    const one = [
      { sourceKey: rk, record: daily('a', '2026-03-10', { steps: 1 }, ring) },
      { sourceKey: zk, record: daily('b', '2026-03-10', { steps: 2, resting_hr_bpm: 50 }, b2) },
    ];
    expect(resolveDays(one, [])[0]!.daily?.steps).toBe(2);
    const newer = { ...b2, ingested_at: '2030-01-01T00:00:00.000Z' };
    const two = [
      { sourceKey: rk, record: daily('a', '2026-03-10', { steps: 1 }, ring) },
      { sourceKey: zk, record: daily('b', '2026-03-10', { steps: 2 }, newer) },
    ];
    expect(resolveDays(two, [])[0]!.daily?.steps).toBe(2);
    const tie = [
      { sourceKey: rk, record: daily('a', '2026-03-10', { steps: 1 }, ring) },
      { sourceKey: zk, record: daily('b', '2026-03-10', { steps: 2 }, b2) },
    ];
    expect(resolveDays(tie, [])[0]!.daily?.steps).toBe(1); // 'acme:r1' < 'zed:z1'
    expect(resolveDays(tie, [])[0]!.basisByMetric.steps).toBe('device');
  });
  it('an entry by hand is the fallback below every device', () => {
    const manual = prov({ channel: 'manual', device: { type: 'manual', tier: 'C' } });
    const both = [
      { sourceKey: 'manual', record: daily('m', '2026-03-10', { steps: 50_000 }, manual) },
      { sourceKey: rk, record: daily('a', '2026-03-10', { steps: 1 }, ring) },
    ];
    const d = resolveDays(both, [])[0]!;
    expect(d.daily?.steps).toBe(1);
    expect(d.basisByMetric.steps).toBe('device');
    const alone = resolveDays([both[0]!], [])[0]!;
    expect(alone.daily?.steps).toBe(50_000);
    expect(alone.basisByMetric.steps).toBe('manual');
  });
  it('main sleep: is_main wins over longer nap; else longest; latest version wins', () => {
    const recs2 = [
      { sourceKey: rk, record: sleep('nap', '2026-03-10', 9000, false, ring, '2026-03-10T14:00:00.000Z') },
      { sourceKey: rk, record: sleep('main', '2026-03-10', 7000, true, ring) },
    ];
    expect(resolveDays(recs2, [])[0]!.mainSleep?.record_id).toBe('main');
    const recs3 = [recs2[0]!, { sourceKey: rk, record: sleep('a', '2026-03-10', 100, false, ring) }];
    expect(resolveDays(recs3, [])[0]!.mainSleep?.record_id).toBe('nap');
    const v2 = [{ sourceKey: rk, record: daily('x', '2026-03-10', { steps: 1 }, ring, 1) }, { sourceKey: rk, record: daily('x', '2026-03-10', { steps: 2 }, ring, 2) }];
    expect(resolveDays(v2, [])[0]!.daily?.steps).toBe(2);
  });
  it('range filter', () => {
    expect(resolveDays(recs, [], { from: '2026-03-10' }).map((d) => d.localDate)).toEqual(['2026-03-10']);
  });
});
