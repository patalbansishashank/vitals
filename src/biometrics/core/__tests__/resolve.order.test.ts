/** V2 review: one resolved basis per metric whatever the order the records arrive in; two devices + a hand entry + a correction. */
import { describe, expect, it } from 'vitest';
import { correctionKey, resolveDays, type SourcedRecord } from '../resolve';
import { sourceKeyOf } from '../source';
import type { BioCorrection, DeviceTier } from '../types';
import { daily, prov, sleep } from './factory';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const shuffle = <T,>(xs: T[], r: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

describe('resolveDays is order independent', () => {
  it('shuffling the records never changes the resolved view; each metric has exactly one basis', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      const tiers: DeviceTier[] = ['A', 'B', 'C'];
      const provs = [0, 1, 2].map((i) => prov({ device: { type: 'ring', manufacturer: `M${i}`, model: `R${i}`, tier: tiers[Math.floor(r() * 3)]! }, ingested_at: `2026-03-1${Math.floor(r() * 3)}T00:00:00.000Z` }));
      const recs: SourcedRecord[] = [];
      for (const [i, p] of provs.entries()) {
        // 04:00 rollover / timezone edge: a night ending at 02:30 local with a +10 h offset belongs to its own local_date
        recs.push({ sourceKey: sourceKeyOf(p), record: sleep(`s${i}`, '2026-03-10', 3600 * (4 + r() * 4), true, p) });
        recs.push({ sourceKey: sourceKeyOf(p), record: daily(`d${i}`, '2026-03-10', { steps: Math.floor(r() * 9000), ...(r() < 0.5 ? { resting_hr_bpm: 55 } : {}) }, p, 1) });
        recs.push({ sourceKey: sourceKeyOf(p), record: daily(`d${i}b`, '2026-03-10', { steps: Math.floor(r() * 9000) }, p, 1) }); // same version, other id
      }
      const manual = prov({ channel: 'manual', device: { type: 'manual', tier: 'C' } });
      recs.push({ sourceKey: 'manual', record: daily('m', '2026-03-10', { steps: 7, resting_hr_bpm: 99 }, manual) });
      const target = { kind: 'daily', localDate: '2026-03-10', metric: 'steps' } as const;
      const corr: BioCorrection[] = r() < 0.5 ? [{ correctionId: 'c', key: correctionKey(target), target, value: { fields: { steps: 4242 } }, createdAt: '2026-03-12T00:00:00.000Z', actor: 'user:local-user', replaced: null }] : [];
      const base = JSON.stringify(resolveDays(recs, [], {}, corr));
      for (let k = 0; k < 4; k++) expect(JSON.stringify(resolveDays(shuffle(recs, r), [], {}, corr)), `seed ${seed}`).toBe(base);
      const day = resolveDays(recs, [], {}, corr)[0]!;
      expect(Object.keys(day.basisByMetric).sort()).toEqual(Object.keys(day.sourceByMetric).sort());
      // a hand entry never beats a device that reports the metric
      expect(day.basisByMetric['resting_hr_bpm'] === 'manual').toBe(!recs.some((x) => x.sourceKey !== 'manual' && (x.record as { resting_hr_bpm?: number }).resting_hr_bpm !== undefined));
      if (corr.length) expect(day.daily?.steps).toBe(4242);
    }
  });
});
