// @vitest-environment node
/**
 * Output-mask invariance (D8-01 with D1-02, C7): choosing which series to record changes allocation and rendering cost,
 * never the simulated body. For equal inputs, parameters and seed, every recording mask — full, singleton, pair, a seeded
 * random subset and `record: 'none'` — must give identical shared series, bus signals consumed by physics or safety,
 * safety trace, constraint margins, events, validity and continuation state. Display caveats that exist because a series
 * is shown (W-U04 blood-marker note, W-U05 autophagy note) are the only mask-dependent warnings.
 *
 * Snapshots keep the series mask in their key (cross-mask restore stays rejected until equivalence is proven for every
 * latent state); captures are compared under their own valid masks instead.
 */
import { runEngine, captureInitialSnapshot } from '../loop';
import { compileSchedule } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { mulberry32 } from '../math';
import { SERIES, type SeriesId } from '../../types/metrics';
import { SIGNAL_DEFS } from '../../types/signals';
import type { PersonProfile } from '../../types';
import type { RunOptions, SimulationResult } from '../../types/result';
import { MAN, repeatSchedule } from './fixtures';

const POSTMENOPAUSAL: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 61, heightCm: 163, weightKg: 76, menopause: 'post' },
  habits: { typicalSteps: 6000, sessionsPerWeek: 2 },
  startDate: '2026-10-05',
};

/** Warnings that exist because a series is displayed (MODEL_SPEC §7: shown-series caveats). */
const DISPLAY_CAVEATS = new Set(['W-U04', 'W-U05']);
/** Signals some module or safety consumes (a signal without readers is an output mirror). */
const CONSUMED = SIGNAL_DEFS.map((d, j) => ({ name: d.name, j, consumed: d.readers.length > 0 })).filter((x) => x.consumed);

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]));

function sharedState(r: SimulationResult, day: number) {
  const snap = r.snapshots?.[day];
  return {
    bus: snap ? CONSUMED.map((c) => [c.name, snap.bus[c.j]] as const) : [],
    warnings: r.warnings.filter((w) => !DISPLAY_CAVEATS.has(w.id)),
    events: r.events,
    validity: r.meta.validity ?? null,
  };
}

function expectInvariant(full: SimulationResult, other: SimulationResult, mask: readonly SeriesId[], days: readonly number[]): void {
  for (const id of mask) {
    const a = full.daily[id];
    const b = other.daily[id];
    if (!a || !b) continue;
    expect(sameArray(a, b), `series ${id}`).toBe(true);
  }
  for (const k of Object.keys(full.safety) as Array<keyof SimulationResult['safety']>) {
    expect(sameArray(full.safety[k] as Float32Array, other.safety[k] as Float32Array), `safety trace ${k}`).toBe(true);
  }
  if (full.constraints && other.constraints) {
    expect(other.constraints.length).toBe(full.constraints.length);
    full.constraints.forEach((c, i) => expect(sameArray(c.margin, other.constraints![i]!.margin), `constraint ${c.id}`).toBe(true));
  }
  for (const d of days) expect(sharedState(other, d)).toEqual(sharedState(full, d));
}

describe('recording masks never change the simulated body (D8-01, D1-02)', () => {
  const profile = resolveProfile(MAN);
  const n = 60;
  const cs = compileSchedule(repeatSchedule(n, [0, 1, 0, 1, 1]), profile);
  const days = [10, 30, n - 1];
  const opts: RunOptions = { constraints: true, captureSnapshotAt: days };
  const full = runEngine(profile, cs, { ...opts, record: 'daily' });
  const allIds = SERIES.map((s) => s.id);

  it('singleton, pair, seeded random subsets and record none give the full run’s shared outputs, safety and state', () => {
    const rng = mulberry32(2026);
    const random = (k: number): SeriesId[] => {
      const pool = [...allIds];
      const out: SeriesId[] = [];
      while (out.length < k) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
      return out;
    };
    const masks: SeriesId[][] = [
      ['fatMass'],
      ['hipBmdChange'],
      ['visceralFat'],
      ['tdee', 'ldl'],
      ['micronutrientScore', 'hipBmdChange'],
      random(5),
      random(12),
    ];
    for (const m of masks) expectInvariant(full, runEngine(profile, cs, { ...opts, record: 'daily', series: m }), m, days);
    expectInvariant(full, runEngine(profile, cs, { ...opts, record: 'none' }), [], days);
  });

  it('visceral fat follows one transition for every mask and stays within total fat (D1-02)', () => {
    const vatJ = SIGNAL_DEFS.findIndex((d) => d.name === 'vatKg');
    const capture = Array.from({ length: n - 1 }, (_, i) => i + 1);
    const a = runEngine(profile, cs, { record: 'daily', series: ['visceralFat', 'fatMass'], captureSnapshotAt: capture });
    const b = runEngine(profile, cs, { record: 'daily', series: ['tdee'], captureSnapshotAt: capture });
    const c = runEngine(profile, cs, { record: 'none', captureSnapshotAt: capture });
    for (const d of capture) {
      expect(b.snapshots![d]!.bus[vatJ]).toBe(a.snapshots![d]!.bus[vatJ]);
      expect(c.snapshots![d]!.bus[vatJ]).toBe(a.snapshots![d]!.bus[vatJ]);
    }
    const vat = a.daily.visceralFat!;
    const fm = a.daily.fatMass!;
    for (let d = 0; d < n; d++) {
      expect(vat[d]!).toBeGreaterThanOrEqual(0);
      expect(vat[d]!).toBeLessThanOrEqual(fm[d]! + 1e-6);
    }
  });

  it('capture/continue under the same valid mask equals the uninterrupted run; a capture under another mask holds the same state', () => {
    const mask: SeriesId[] = ['fatMass', 'scaleWeight', 'hipBmdChange'];
    const k = 25;
    const a = runEngine(profile, cs, { record: 'daily', series: mask, captureSnapshotAt: [k] });
    const cont = runEngine(profile, cs, { record: 'daily', series: mask, initialSnapshot: a.snapshots![k]! });
    for (const id of mask) expect(sameArray(cont.daily[id]!.subarray(k), a.daily[id]!.subarray(k)), id).toBe(true);
    const other = runEngine(profile, cs, { record: 'daily', series: ['tdee'], captureSnapshotAt: [k] });
    expect(CONSUMED.map((c) => other.snapshots![k]!.bus[c.j])).toEqual(CONSUMED.map((c) => a.snapshots![k]!.bus[c.j]));
    // the mask stays part of the key: a cross-mask restore is still rejected (no shortcut through validation)
    expect(() => runEngine(profile, cs, { record: 'daily', series: ['tdee'], initialSnapshot: a.snapshots![k]! })).toThrow(/does not match/);
    const post = captureInitialSnapshot(profile, cs, { series: mask });
    expect(() => runEngine(profile, cs, { record: 'daily', series: ['tdee'], initialSnapshot: post })).toThrow(/does not match/);
    const viaPost = runEngine(profile, cs, { record: 'daily', series: mask, initialSnapshot: post });
    for (const id of mask) expect(sameArray(viaPost.daily[id]!, a.daily[id]!), id).toBe(true);
  });
});

describe('bone output does not depend on the micronutrient display (D8-01)', () => {
  it('postmenopausal hypocaloric 180 d: hip BMD alone equals hip BMD + micronutrient score; safety and resumed state match', () => {
    const p = resolveProfile(POSTMENOPAUSAL);
    const tmpl = {
      id: 'deficit',
      label: 'deficit',
      energy: { kind: 'pctMaintenance' as const, pct: 65 },
      macros: { protein: { unit: 'gPerKgBw' as const, value: 1.2 }, carbs: { unit: 'pctEnergy' as const, value: 40 }, fat: { unit: 'remainder' as const } },
      meals: { count: 3, window: { startH: 8, lengthH: 11 } },
    };
    const cs = compileSchedule(repeatSchedule(180, [0], [tmpl]), p);
    const alone = runEngine(p, cs, { record: 'daily', series: ['hipBmdChange'], captureSnapshotAt: [179] });
    const both = runEngine(p, cs, { record: 'daily', series: ['hipBmdChange', 'micronutrientScore'], captureSnapshotAt: [179] });
    expect(sameArray(alone.daily.hipBmdChange!, both.daily.hipBmdChange!)).toBe(true);
    for (const k of Object.keys(alone.safety) as Array<keyof SimulationResult['safety']>) expect(sameArray(alone.safety[k] as Float32Array, both.safety[k] as Float32Array), k).toBe(true);
    expect(CONSUMED.map((c) => alone.snapshots![179]!.bus[c.j])).toEqual(CONSUMED.map((c) => both.snapshots![179]!.bus[c.j]));
  });
});
