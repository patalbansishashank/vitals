// @vitest-environment node
/**
 * D1-02 (C7) on the real 16-module engine: an output-series mask changes rendering only, never the modelled VAT, the common
 * tissue outputs or the composition state a snapshot carries. The VAT trajectory is identical for minimal, daily-tissue
 * and full masks; regional geometry (depots, waist) is advanced only when a regional series is recorded, which is why the
 * mask stays in the snapshot key (core/snapshot.ts) until every latent regional state is advanced identically.
 */
import { describe, expect, it } from 'vitest';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { MODULES } from '../../core/moduleRegistry';
import type { SeriesId } from '../../types/metrics';
import type { CompositionState } from './index';

const START = '2026-10-05';
const WOMAN: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 44, heightCm: 166, weightKg: 82, waistCm: 94 }, startDate: START };
const day = (id: string, kcal: number): DayTemplate => ({
  id,
  label: id,
  energy: { kind: 'kcal', kcal },
  macros: { protein: { unit: 'g', value: 110 }, carbs: { unit: 'g', value: 180 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
  steps: 8000,
});
const HORIZON = 42;
/** Four weeks of loss, then two weeks of regain: both VAT branches (loss prior, labelled gain hypothesis). */
const SCHEDULE: Schedule = {
  schemaVersion: 1,
  startDate: START,
  horizonDays: HORIZON,
  programs: [day('loss', 1350), day('gain', 3100)],
  days: Array.from({ length: HORIZON }, (_, i) => ({ program: i < 28 ? 0 : 1 })),
};
const COMP_IDX = MODULES.findIndex((m) => m.id === 'composition');
const DAYS = [7, 14, 21, 28, 35, 41];

const MASKS: Record<string, readonly SeriesId[] | undefined> = {
  minimal: ['fatMass', 'leanTissue'],
  tissueRegional: ['fatMass', 'leanTissue', 'visceralFat', 'waist'],
  full: undefined,
};

function runMask(series: readonly SeriesId[] | undefined) {
  const rp = resolveProfile(WOMAN);
  const cs = compileSchedule(SCHEDULE, rp);
  return runEngine(rp, cs, { record: 'daily', ...(series ? { series } : {}), captureSnapshotAt: DAYS, checks: true });
}

describe('D1-02 — VAT and common outputs are independent of the output mask', () => {
  const runs = Object.fromEntries(Object.entries(MASKS).map(([k, m]) => [k, runMask(m)]));

  it('every mask gives the same VAT trajectory and the same fat/lean outputs; VAT stays within total fat', () => {
    const vat = (k: string) => DAYS.map((d) => (runs[k]!.snapshots![d]!.states[COMP_IDX] as CompositionState).vatKg);
    const fm = (k: string) => DAYS.map((d) => (runs[k]!.snapshots![d]!.states[COMP_IDX] as CompositionState).fmKg);
    expect(vat('minimal')).toEqual(vat('full'));
    expect(vat('tissueRegional')).toEqual(vat('full'));
    for (let i = 0; i < DAYS.length; i++) {
      expect(vat('full')[i]!).toBeGreaterThan(0);
      expect(vat('full')[i]!).toBeLessThanOrEqual(fm('full')[i]!);
    }
    for (const id of ['fatMass', 'leanTissue'] as const) {
      expect(Array.from(runs.minimal!.daily[id]!), id).toEqual(Array.from(runs.full!.daily[id]!));
      expect(Array.from(runs.tissueRegional!.daily[id]!), id).toEqual(Array.from(runs.full!.daily[id]!));
    }
    // VAT falls in the loss block and rises in the regain block
    expect(vat('full')[3]!).toBeLessThan(vat('full')[0]!);
    expect(vat('full')[5]!).toBeGreaterThan(vat('full')[3]!);
  });

  it('the recorded visceralFat series is the same modelled VAT in every mask that renders it', () => {
    expect(Array.from(runs.tissueRegional!.daily.visceralFat!)).toEqual(Array.from(runs.full!.daily.visceralFat!));
  });

  it('regional depots sum to total fat when rendered (other depots carry FM − VAT); conservation holds in every mask', () => {
    for (const d of DAYS) {
      const s = runs.full!.snapshots![d]!.states[COMP_IDX] as CompositionState;
      const f = s.regional.fat;
      expect(f.headKg + f.armsKg + f.legsKg + f.trunkSatKg + f.vatKg).toBeCloseTo(s.fmKg, 6);
      expect(f.vatKg).toBe(s.vatKg);
    }
    for (const r of Object.values(runs)) expect(r.meta.checks!.energyMaxAbsKcal).toBeLessThan(1e-6);
  });
});
