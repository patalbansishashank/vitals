// @vitest-environment node
/**
 * D7-02 through the real engine: accepted LDL 310 / TG 1200 / FPG 300 mg/dL and HbA1c 14 % are recorded exactly on day 0
 * (no solver clamp relabels them), every recorded value stays finite (no NaN as abstention), and a day-stamped snapshot
 * continues bit-identically, so a resumed run keeps the same observed anchors and out-of-domain semantics.
 */
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import type { PersonProfile } from '../../types/profile';
import { MAN, repeatSchedule } from '../../core/__tests__/fixtures';
import { cardiometabolicObservedAnchors } from './constants';

const HIGH = { ldlMmolL: 310 / 38.67, tgMmolL: 1200 / 88.57, fastingGlucoseMmolL: 300 / 18.02, hba1cPct: 14 };
const person: PersonProfile = { ...MAN, labs: HIGH };
const profile = resolveProfile(person);
const sched = compileSchedule(repeatSchedule(60, [0, 1, 0, 1, 0, 1, 1]), profile);

describe('observed baselines through the engine (D7-02)', () => {
  const full = runEngine(profile, sched, { record: 'daily', captureSnapshotAt: [20] });

  it('the first recorded day sits on the measured values (one day of response, never the old clamp); all finite', () => {
    // daily[0] is the end of day 0 (one day of mechanism deltas on the exact t = 0 anchor; module.test.ts checks t = 0)
    expect(Math.abs(full.daily.ldl![0]! * 38.67 - 310)).toBeLessThan(5);
    // TG is multiplicative with a 4-day time constant: within 10 % of 1200 after a day, far from the old 800 clamp
    expect(Math.abs(full.daily.triglycerides![0]! * 88.57 - 1200)).toBeLessThan(120);
    expect(full.daily.triglycerides![0]! * 88.57).toBeGreaterThan(1000);
    expect(Math.abs(full.daily.fastingGlucose![0]! * 18.02 - 300)).toBeLessThan(5);
    for (const id of ['ldl', 'triglycerides', 'fastingGlucose', 'apoB', 'hdl'] as const) for (const v of full.daily[id]!) expect(Number.isFinite(v)).toBe(true);
  });

  it('the out-of-domain status names the affected series from daily index 0 (the core copies it into the run meta)', () => {
    const meta = cardiometabolicObservedAnchors(person.labs);
    expect(Object.keys(meta.outputStatus).sort()).toEqual(['apoB', 'fastingGlucose', 'insulinSensitivity', 'ldl', 'triglycerides']);
    // A1-052: daily[0] is one day of modelled response, not the observation (which stays in initial / observedAnchors)
    for (const s of Object.values(meta.outputStatus)) expect(s).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
  });

  it('a snapshot taken mid-run continues bit-identically (same anchors after a resume)', () => {
    const cont = runEngine(profile, sched, { record: 'daily', initialSnapshot: full.snapshots![20]! });
    for (const id of ['ldl', 'triglycerides', 'fastingGlucose', 'apoB'] as const) {
      const a = full.daily[id]!;
      const b = cont.daily[id]!;
      for (let i = 20; i < a.length; i++) expect(Object.is(a[i], b[i]), `${id}[${i}]`).toBe(true);
    }
  });
});
