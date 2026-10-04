/**
 * SUITE_SPEC §14.6 / §14.9 property: for any set of device records (several sources, versions, replays) and any set of
 * corrections, every resolved metric has exactly one basis and a correction always wins. Seeded generator (no
 * fast-check in this repo); 300 cases.
 */
import { describe, expect, it } from 'vitest';
import { correctionKey, resolveDays, type SourcedRecord } from '../resolve';
import { channelOfSourceKey, streamOwner } from '../policy';
import { sourceKeyOf } from '../source';
import type { BioCorrection, BioProvenance, BioSourceDoc, CorrectionTarget, DeviceTier, SpotRecord } from '../types';
import { daily, prov, sleep } from './factory';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DATES = ['2026-03-08', '2026-03-09', '2026-03-10'];
const TIERS: DeviceTier[] = ['A', 'B', 'C'];

function devices(r: () => number): BioProvenance[] {
  const n = 1 + Math.floor(r() * 3);
  return Array.from({ length: n }, (_, i) =>
    prov({ device: { type: 'ring', manufacturer: `M${i}`, model: `R${i}`, tier: TIERS[Math.floor(r() * 3)]! }, ingested_at: `2026-03-1${Math.floor(r() * 9)}T00:00:00.000Z` }),
  );
}

function spot(id: string, date: string, metric: SpotRecord['metric'], value: number, p: BioProvenance): SpotRecord {
  return { kind: 'spot', record_id: id, version: 1, metric, value, time: { at: `${date}T07:00:00.000Z`, tz_offset_s: 0, local_date: date }, provenance: p, quality: { validation: 'measured', confidence: null, flags: [] } };
}

describe('resolveDays with corrections (property)', () => {
  it('one basis per metric; the correction wins; replays and newer device versions change nothing', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const provs = devices(r);
      const recs: SourcedRecord[] = [];
      for (const [i, p] of provs.entries()) {
        const sk = sourceKeyOf(p);
        for (const d of DATES) {
          if (r() < 0.7) recs.push({ sourceKey: sk, record: daily(`d${i}${d}`, d, { steps: Math.floor(r() * 20000), ...(r() < 0.5 ? { resting_hr_bpm: 50 + Math.floor(r() * 20) } : {}) }, p, 1 + Math.floor(r() * 3)) });
          if (r() < 0.6) recs.push({ sourceKey: sk, record: sleep(`s${i}${d}`, d, 3600 * (4 + r() * 5), true, p) });
          if (r() < 0.4) recs.push({ sourceKey: sk, record: spot(`w${i}${d}`, d, 'weight_kg', 70 + r() * 20, p) });
        }
      }
      if (r() < 0.3) recs.push({ sourceKey: 'manual', record: daily(`m${seed}`, DATES[0]!, { steps: 123 }, prov({ channel: 'manual', device: { type: 'manual', tier: 'C' } })) });
      const corrections: BioCorrection[] = [];
      for (const d of DATES) {
        const targets: Array<[CorrectionTarget, BioCorrection['value']]> = [];
        if (r() < 0.4) targets.push([{ kind: 'sleep', localDate: d }, { asleepS: 6 * 3600 + seed }]);
        if (r() < 0.4) targets.push([{ kind: 'daily', localDate: d, metric: 'steps' }, { fields: { steps: 1000 + seed } }]);
        if (r() < 0.3) targets.push([{ kind: 'spot', localDate: d, metric: 'weight_kg' }, { value: 60 + (seed % 10) }]);
        for (const [target, value] of targets) {
          const key = correctionKey(target);
          corrections.push({ correctionId: `c:${key}`, key, target, value, createdAt: '2026-03-12T00:00:00.000Z', actor: 'user:local-user', replaced: null, ...(r() < 0.15 ? { clearedAt: '2026-03-12T01:00:00.000Z' } : {}) });
        }
      }
      const days = resolveDays(recs, [], {}, corrections);
      // replays (every record twice) and a newer device version of each record leave corrected values alone
      const replay = resolveDays([...recs, ...recs], [], {}, corrections);
      const newer = resolveDays([...recs, ...recs.map((x) => ({ ...x, record: { ...x.record, version: x.record.version + 10 } as typeof x.record }))], [], {}, corrections);
      for (const view of [days, replay, newer]) {
        for (const day of view) {
          for (const m of Object.keys(day.sourceByMetric)) expect(['correction', 'device', 'manual'], `${seed} ${day.localDate} ${m}`).toContain(day.basisByMetric[m]);
          expect(Object.keys(day.basisByMetric).sort()).toEqual(Object.keys(day.sourceByMetric).sort());
          for (const c of corrections.filter((x) => x.target.localDate === day.localDate)) {
            const active = !c.clearedAt;
            const t = c.target;
            if (t.kind === 'sleep') {
              if (active) expect(day.mainSleep?.asleep_s).toBe((c.value as { asleepS: number }).asleepS);
              if (active) expect(day.basisByMetric['sleep']).toBe('correction');
              else expect(day.basisByMetric['sleep']).not.toBe('correction');
            } else if (t.kind === 'daily') {
              if (active) expect(day.daily?.steps).toBe(1000 + seed);
              if (active) expect(day.basisByMetric['steps']).toBe('correction');
            } else if (active) {
              const w = day.spots.filter((s) => s.metric === 'weight_kg');
              expect(w.map((s) => s.value)).toEqual([60 + (seed % 10)]);
              expect(day.basisByMetric['spot:weight_kg']).toBe('correction');
            }
            if (active) expect(day.corrections.map((x) => x.key)).toContain(c.key);
          }
        }
      }
      // a day with only a correction still resolves
      expect(days.map((d) => d.localDate)).toEqual([...new Set([...recs.map((x) => x.record.time.local_date), ...corrections.filter((c) => !c.clearedAt).map((c) => c.target.localDate)])].sort());
      // inputs are never mutated
      expect(JSON.stringify(resolveDays(recs, [], {}, corrections))).toBe(JSON.stringify(days));
    }
  });
});

describe('streamOwner', () => {
  const src = (sourceKey: string, tier: DeviceTier, streams: Array<[string, boolean]>): BioSourceDoc => ({
    sourceKey, label: sourceKey, tier, baselineEpochs: [],
    policies: streams.map(([stream, imported]) => ({ stream: stream as never, imported, coach: 'hidden', engine: false, scores: false })),
  });
  it('a non-manual source with the stream imported owns it; manual never does; tier then key decide', () => {
    expect(streamOwner('sleep_sessions', [])).toBeNull();
    expect(streamOwner('sleep_sessions', [src('manual', 'C', [['sleep_sessions', true]])])).toBeNull();
    expect(streamOwner('sleep_sessions', [src('mqtt:lumen|jstyle2301:r1', 'B', [['sleep_sessions', false]])])).toBeNull();
    const two = [src('mqtt:lumen|zz:r', 'B', [['sleep_sessions', true]]), src('file:apple_health|aa:w', 'A', [['sleep_sessions', true]])];
    expect(streamOwner('sleep_sessions', two)?.sourceKey).toBe('file:apple_health|aa:w');
    expect(channelOfSourceKey('mqtt:lumen|zz:r')).toBe('mqtt:lumen');
  });
  it('daily totals arriving as daily_summary own steps unless the steps stream is switched off; body needs a body stream', () => {
    const ring = src('mqtt:lumen|jstyle2301:r1', 'B', [['daily_summary', true]]);
    expect(streamOwner('steps', [ring])?.label).toBe('mqtt:lumen|jstyle2301:r1');
    expect(streamOwner('body', [ring])).toBeNull();
    expect(streamOwner('steps', [src('x|y', 'B', [['daily_summary', true], ['steps', false]])])).toBeNull();
    expect(streamOwner('body', [src('file:health_connect|scale', 'B', [['body', true]])])).not.toBeNull();
  });
});
