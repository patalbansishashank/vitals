// @vitest-environment node
/**
 * Synthetic-truth runs (docs/SUITE_SPEC.md §9.4 "Living plan"): the engine with a hidden energy-balance error produces the
 * person's true trajectory; noisy, gappy weigh-ins come from it; weekly check-ins with the nominal engine must recover the
 * trend within 2 SD and δ within its SE, keep the conservation identities across every re-anchor, and be deterministic.
 */
import { mulberry32 } from '../../core/math';
import type { PersonProfile } from '../../types/profile';
import type { AnchorSpec, IntakeOffset } from '../../types/result';
import type { DayTemplate, Schedule } from '../../types/schedule';
import { runCheckIn, type CheckInOutput } from '../checkIn';
import { buildRealisedSchedule } from '../realised';
import { reanchorSnapshot } from '../reanchor';
import { runReplay } from '../replay';
import type { WeighInObs } from '../trendFilter';
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { REPLAY_SERIES } from '../replay';

const MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 92 },
  habits: { typicalSteps: 7000, sessionsPerWeek: 3 },
  startDate: '2026-10-05',
};
const TRAIN: DayTemplate = {
  id: 'A', label: 'training day', energy: { kind: 'pctMaintenance', pct: 80 },
  macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'g', value: 180 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 12 } }, exercise: [{ kind: 'resistance', startH: 17, volume: 'moderate' }], steps: 9000,
};
const REST: DayTemplate = {
  id: 'B', label: 'rest day', energy: { kind: 'pctMaintenance', pct: 75 },
  macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 35 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 12 } }, steps: 8000,
};
const PATTERN = [0, 1, 0, 1, 0, 1, 1];
const H = 84;
const PLAN: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: H, programs: [TRAIN, REST], days: Array.from({ length: H }, (_, d) => ({ program: PATTERN[d % 7]! })) };
const TRUE_DELTA = -250;

function normals(seed: number): () => number {
  const u = mulberry32(seed);
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

const truth = runReplay({ profile: MAN, schedule: PLAN, intakeOffsets: [{ fromDay: 0, kcal: TRUE_DELTA }] });
const z = normals(42);
const keep = mulberry32(43);
const weighIns: WeighInObs[] = [];
for (let d = 0; d < H; d++) {
  const noise = 0.005 * truth.scaleWakeKg[d]! * z();
  if (keep() < 0.85) weighIns.push({ day: d, scaleKg: truth.scaleWakeKg[d]! + noise });
}
const allDays = Array.from({ length: H }, (_, d) => d);

interface Carry { anchors: AnchorSpec[]; offsets: IntakeOffset[]; bias: { mean: number; sd: number } }
function checkInAt(day: number, c: Carry): CheckInOutput {
  return runCheckIn({
    day, profile: MAN, schedule: PLAN, anchors: c.anchors, intakeOffsets: c.offsets, weighIns: weighIns.filter((o) => o.day <= day),
    startWeekday: 0, intakeDays: allDays.filter((d) => d < day), previousBias: c.bias,
  });
}

const carry: Carry = { anchors: [], offsets: [], bias: { mean: 0, sd: 150 } };
const outs: CheckInOutput[] = [];
for (let day = 14; day < H; day += 7) {
  const out = checkInAt(day, carry);
  outs.push(out);
  if (out.anchor) carry.anchors = [...carry.anchors.filter((a) => a.day !== day), out.anchor];
  if (out.intakeOffset) carry.offsets = [...carry.offsets, out.intakeOffset];
  carry.bias = { mean: out.bias.mean, sd: out.bias.sd };
}

describe('weekly check-ins on a synthetic truth (hidden δ = −250 kcal/d)', () => {
  it('every check-in is confirmed and the trend is within 2 SD of the true tissue mass', () => {
    for (const o of outs) {
      expect(o.verdict).toBe('confirmed');
      const t = truth.tissueWakeKg[o.day]!;
      expect(Math.abs(o.trend!.w - t)).toBeLessThan(2 * o.trend!.wSd + 0.05);
    }
  });

  it('δ moves toward the hidden value in capped weekly steps and ends within 2 SE of it', () => {
    const means = outs.map((o) => o.bias.mean);
    for (let i = 1; i < means.length; i++) expect(Math.abs(means[i]! - means[i - 1]!)).toBeLessThanOrEqual(100 + 1e-9);
    // every weekly measurement is within 2.5 SE of the hidden value (water and adaptation differences included)
    for (const o of outs) if (o.bias.measurement) expect(Math.abs(o.bias.measurement.value - TRUE_DELTA)).toBeLessThan(2.5 * o.bias.measurement.se);
    // the later half of the plan sits below zero (the person burns more / eats less than the model assumed)
    for (const m of means.slice(Math.floor(means.length / 2))) expect(m).toBeLessThan(0);
    const last = outs[outs.length - 1]!.bias;
    expect(last.sd).toBeLessThan(150);
    expect(Math.abs(last.mean - TRUE_DELTA)).toBeLessThan(2 * last.sd);
  });

  it('the confirmed state starts each anchor day on the filtered trend (morning tissue ≈ w)', () => {
    for (const o of outs) {
      const r = o.replay!;
      expect(Math.abs(r.tissueWakeKg[o.day]! - o.trend!.w)).toBeLessThan(0.08);
      expect(o.snapshot!.day).toBe(o.day);
      expect(o.residualSplit!.source).toBe('engine');
      if (Math.abs(o.residualSplit!.residualKg) > 0.05) expect(Math.abs(o.residualSplit!.leanKg)).toBeLessThan(Math.abs(o.residualSplit!.residualKg) * 0.6);
    }
  });

  it('energy and mass identities hold on both sides of every re-anchor (full replay with checks)', () => {
    const r = runReplay({ profile: MAN, schedule: PLAN, anchors: carry.anchors, intakeOffsets: carry.offsets, checks: true });
    const c = r.result.meta.checks!;
    expect(c.energyMaxAbsKcal).toBeLessThanOrEqual(1e-6);
    expect(c.energyDayMaxAbsKcal).toBeLessThanOrEqual(1);
    expect(c.massMaxAbsKg).toBeLessThanOrEqual(1e-9);
    expect(r.anchorsApplied).toHaveLength(carry.anchors.length);
    // the ledger closes: tissue path + anchor jumps = recorded tissue
    const lastDay = H - 1;
    const jumps = r.anchorsApplied.reduce((s, a) => s + a.tissueAfterKg - a.tissueBeforeKg, 0);
    expect(r.tissueWakeKg[lastDay]! - r.tissuePathKg[lastDay]!).toBeCloseTo(jumps, 9);
  });

  it('replaying from the cached confirmed snapshot equals the full replay from day 0 (logged past identical)', () => {
    const o = outs[3]!;
    const anchors = carry.anchors.filter((a) => a.day <= o.day);
    const offsets = carry.offsets.filter((x) => x.fromDay <= o.day);
    const full = runReplay({ profile: MAN, schedule: PLAN, anchors, intakeOffsets: offsets });
    const fast = runReplay({ profile: MAN, schedule: PLAN, anchors, intakeOffsets: offsets, from: o.snapshot! });
    for (let d = o.day; d < H; d++) {
      expect(fast.scaleWakeKg[d]).toBe(full.scaleWakeKg[d]);
      expect(fast.fatKg[d]).toBe(full.fatKg[d]);
    }
  });

  it('is deterministic (same documents → same δ, anchor and confirmed state)', () => {
    const o = outs[2]!;
    const prevCarry: Carry = {
      anchors: carry.anchors.filter((a) => a.day < o.day),
      offsets: carry.offsets.filter((x) => x.fromDay < o.day),
      bias: { mean: outs[1]!.bias.mean, sd: outs[1]!.bias.sd },
    };
    const again = checkInAt(o.day, prevCarry);
    expect(again.bias).toEqual(o.bias);
    expect(again.anchor).toEqual(o.anchor);
    expect(Array.from(again.snapshot!.bus)).toEqual(Array.from(o.snapshot!.bus));
    expect(again.snapshot!.key).toBe(o.snapshot!.key);
  });
});

describe('check-in gates and composition readings', () => {
  it('needs ≥ 4 weigh-ins in 7 days or ≥ 10 in 14 (a hard re-anchor needs one in 3 days)', () => {
    const sparse = [{ day: 10, scaleKg: 91 }, { day: 13, scaleKg: 90.8 }];
    const base = { day: 14, profile: MAN, schedule: PLAN, anchors: [], intakeOffsets: [], startWeekday: 0, intakeDays: [], previousBias: { mean: 0, sd: 150 } };
    const no = runCheckIn({ ...base, weighIns: sparse });
    expect(no.verdict).toBe('notEnoughWeighIns');
    expect(no.anchor).toBeNull();
    expect(no.bias.mean).toBe(0);
    const hard = runCheckIn({ ...base, weighIns: sparse, hard: true });
    expect(hard.verdict).toBe('confirmed');
    expect(hard.bias.updated).toBe(false);
  });

  it('a DXA reading re-anchors the composition; consumer body-fat readings only nudge it', () => {
    const base = { day: 21, profile: MAN, schedule: PLAN, anchors: [], intakeOffsets: [], startWeekday: 0, weighIns: weighIns.filter((o) => o.day <= 21), intakeDays: allDays, previousBias: { mean: 0, sd: 150 } };
    const plain = runCheckIn(base);
    const snap = plain.replay!.snapshots[21]!;
    const ci = snap.moduleIds.indexOf('composition');
    const st = snap.states[ci] as { fmKg: number; ltKg: number; lt0Kg: number; ffm0Kg: number };
    const fracPlain = st.fmKg / (st.fmKg + st.ffm0Kg + st.ltKg - st.lt0Kg);
    const dxa = runCheckIn({ ...base, composition: { dxa: { day: 20, pct: 20, sdPct: 0.5 } } });
    expect(dxa.residualSplit!.source).toBe('dxa');
    const sd = dxa.replay!.snapshots[21]!;
    const sd0 = sd.states[ci] as typeof st;
    const fracDxa = sd0.fmKg / (sd0.fmKg + sd0.ffm0Kg + sd0.ltKg - sd0.lt0Kg);
    // DXA 20 % with SD 0.5 against the engine's SD 2 → ≈ 94 % of the way to 0.20
    expect(Math.abs(fracDxa - 0.2)).toBeLessThan(Math.abs(fracPlain - 0.2) * 0.1 + 1e-6);
    const bia = runCheckIn({ ...base, composition: { bodyFatBia: [{ day: 18, pct: 15 }, { day: 11, pct: 15 }] } });
    expect(bia.residualSplit!.source).toBe('bia');
    const sb = bia.replay!.snapshots[21]!.states[ci] as typeof st;
    const fracBia = sb.fmKg / (sb.fmKg + sb.ffm0Kg + sb.ltKg - sb.lt0Kg);
    // at most 30 % of the way (never overrides)
    expect(fracBia).toBeLessThan(fracPlain);
    expect((fracPlain - fracBia) / (fracPlain - 0.15)).toBeLessThanOrEqual(0.3 + 1e-9);
    // the tissue total is unchanged by the readings
    expect(bia.anchor!.tissueMassKg).toBeCloseTo(plain.anchor!.tissueMassKg, 9);
  });
});

describe('realised schedule and snapshot re-anchoring', () => {
  it('logged days replace the prescription (own programs, de-duplicated) and logged fasts replace prescribed ones', () => {
    const logged: DayTemplate = { id: 'x', label: 'logged', energy: { kind: 'kcal', kcal: 1500 }, macros: { protein: { unit: 'g', value: 140 }, carbs: { unit: 'g', value: 120 }, fat: { unit: 'remainder' } } };
    const base: Schedule = { ...PLAN, events: [{ kind: 'fast', startDay: 2, startH: 20, durationH: 24 }, { kind: 'fast', startDay: 30, startH: 20, durationH: 24 }] };
    const s = buildRealisedSchedule({ base, days: [{ day: 3, template: logged }, { day: 4, template: { ...logged, id: 'y' } }], events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 18 }] });
    expect(s.days[3]!.program).toBe(s.days[4]!.program);
    expect(s.programs).toHaveLength(3);
    expect(s.events!.map((e) => e.startDay)).toEqual([1, 30]);
    const r = runReplay({ profile: MAN, schedule: s });
    expect(r.result.daily.inEnergy![3]).toBeCloseTo(1500, 3);
    expect(s.horizonDays).toBe(H);
    expect(buildRealisedSchedule({ base, days: [], horizonDays: 100 }).days).toHaveLength(100);
  });

  it('reanchorSnapshot on a captured state equals the in-run anchor (bit for bit afterwards)', () => {
    const rp = resolveProfile(MAN);
    const cs = compileSchedule(PLAN, rp);
    const opts = { record: 'daily' as const, series: REPLAY_SERIES };
    const a = runEngine(rp, cs, { ...opts, captureSnapshotAt: [20] });
    const target = 88;
    const { snapshot, applied } = reanchorSnapshot(a.snapshots![20]!, { tissueMassKg: target });
    expect(applied.tissueAfterKg).toBeCloseTo(target, 9);
    const viaSnap = runEngine(rp, cs, { ...opts, initialSnapshot: snapshot });
    const inRun = runEngine(rp, cs, { ...opts, anchors: [{ day: 20, tissueMassKg: target }] });
    for (let d = 20; d < H; d++) expect(viaSnap.daily.scaleWeight![d]).toBe(inRun.daily.scaleWeight![d]);
    // the input snapshot is not mutated
    expect(a.snapshots![20]!.bus).not.toBe(snapshot.bus);
  });
});
