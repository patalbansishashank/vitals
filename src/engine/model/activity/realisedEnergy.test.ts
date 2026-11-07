// @vitest-environment node
/**
 * SPEC V1.5 gate: an approved bout's chosen gross energy G, passed into the engine as an equivalent session MET
 * (met = G / (1.05 · m · t_h), m = the dated body mass), must replay to the same ledger terms G, R, A, D, I (within 0.5 %)
 * and book recovery once — for cardio AND resistance, with phases, across midnight, with the dated mass differing from the
 * engine's simulated mass, and after a late edit. These oracle tests run the activity module hour by hour and compare its
 * booked terms against the shared ledger (core/exerciseCost.boutCost) at the same RMR.
 *
 * Gate outcome (2026-10-27): the equivalent MET alone passes phases, midnight and a late edit, but FAILS when the dated
 * mass differs from the simulated mass (+3.1 % at 80 vs 82.5 kg) and under a drawn O2 energy equivalent (−4.0 % at
 * 4.8 kcal/L), for both session kinds. Per SPEC V1.5 the explicit field `realisedGrossKcal` was therefore added and is read
 * first by `sessionGrossKcalPerMin`; every case below passes with it. The failing MET-only cases are kept as recorded
 * deviations, so a future change cannot silently claim the MET adapter is sufficient.
 */
import { describe, expect, it } from 'vitest';
import { boutCost } from '../../core/exerciseCost';
import { createSignalBus, type SignalBus } from '../../types/signals';
import type { AnyEngineModule } from '../../types/module';
import type { DayInput, SessionResolved } from '../../types/inputs';
import type { IntervalPhase } from '../../types/schedule';
import { makeCtx, makeDay, miniRun, person, withSessions } from '../moderators/testkit';
import { activityModule, epocPhi, realisedEngineDose, realisedSessionMet, type ActivityState } from './index';

const mods = [activityModule] as unknown as readonly AnyEngineModule[];
const RMR = 1800;
const DISPLACED = 0.2;

interface Booked {
  G: number;
  R: number;
  A: number;
  D: number;
  I: number;
  /** Recovery energy released after the bout over the run (exEE − incremental). */
  recovery: number;
  /** The module's VO2max at the start of the run (relative intensity of the recovery check). */
  vo2max: number;
}

function sessionOf(kind: 'cardio' | 'resistance', startH: number, durationMin: number, met: number, phases?: readonly IntervalPhase[], realisedGrossKcal?: number): Partial<SessionResolved> {
  return {
    kind,
    startH,
    durationMin,
    modality: kind === 'cardio' ? 7 : 0,
    intensityFrac: Number.NaN,
    met,
    speedKmh: Number.NaN,
    powerW: Number.NaN,
    rpe: Number.NaN,
    setsByRegion: new Float64Array(9),
    ...(phases ? { phases } : {}),
    ...(realisedGrossKcal !== undefined ? { realisedGrossKcal } : {}),
  };
}

/** The session V3 would write from an approved estimate: equivalent MET + realised gross (+ phases from segments). */
function approved(kind: 'cardio' | 'resistance', startH: number, G: number, durationMin: number, massKg: number, segments?: { durationMin: number; grossKcal: number }[]): Partial<SessionResolved> {
  const d = realisedEngineDose({ grossKcal: G, durationMin, massKg, ...(segments ? { segments } : {}) })!;
  return sessionOf(kind, startH, durationMin, d.met, d.phases, d.realisedGrossKcal);
}

/**
 * Replay `sess` on day 0 of a 3-day run with the engine's simulated mass `simKg` and RMR 1800 kcal/d, and read back the
 * terms the module booked. Overrides go to the parameter vector (e.g. a drawn O2 energy equivalent).
 */
function replay(sess: Partial<SessionResolved>, simKg: number, ov: Record<string, number> = {}): Booked {
  const ctx = makeCtx(mods, person({ body: { weightKg: simKg, heightCm: 178 }, labs: { measuredRmrKcal: RMR, vo2maxMlKgMin: 40 } }), ov);
  const bus: SignalBus = createSignalBus();
  bus.scaleWeightKg = simKg;
  bus.tissueMassKg = simKg;
  bus.rmrKcalH = RMR / 24;
  let S: ActivityState | null = null;
  let A = 0;
  let I = 0;
  let ex = 0;
  let minutes = 0;
  const days: { clockDay: number; day: DayInput }[] = [0, 1, 2].map((d) => ({ clockDay: d, day: d === 0 ? withSessions(makeDay(ctx.profile), [sess]) : makeDay(ctx.profile) }));
  let vo2max = Number.NaN;
  miniRun(mods, ctx, days, {
    bus,
    withPrevDay: true,
    afterInit: (s) => {
      S = s[0] as ActivityState;
      vo2max = S.vo2max;
    },
    afterHour: (_d, _h, b) => {
      ex += b.exEEKcalH;
      if (b.exMinutesH > 0) {
        minutes += b.exMinutesH;
        A += b.exSessionNetKcalH;
        I += S!.hInc;
      }
    },
  });
  const R = (RMR / 1440) * minutes;
  return { G: A + R, R, A, D: A - I, I, recovery: ex - I, vo2max };
}

function oracle(G: number, durationMin: number) {
  return boutCost({ grossKcal: G, durationMin, rmrKcalPerDay: RMR, displacedFracOfRmr: DISPLACED, method: 'modelled', source: 'derived' });
}

const within = (a: number, b: number, tol = 0.005): boolean => Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-9);

function expectLedger(b: Booked, G: number, durationMin: number): void {
  const o = oracle(G, durationMin);
  expect(within(b.G, o.grossKcal), `G ${b.G} vs ${o.grossKcal}`).toBe(true);
  expect(within(b.R, o.ownRestKcal), `R ${b.R} vs ${o.ownRestKcal}`).toBe(true);
  expect(within(b.A, o.netAboveRestKcal), `A ${b.A} vs ${o.netAboveRestKcal}`).toBe(true);
  expect(within(b.D, o.displacedLifestyleKcal!), `D ${b.D} vs ${o.displacedLifestyleKcal}`).toBe(true);
  expect(within(b.I, o.incrementalKcal!), `I ${b.I} vs ${o.incrementalKcal}`).toBe(true);
}

describe('SPEC V1.5 realised-energy adapter: equivalent session MET', () => {
  it('worked check 80 kg, 60 min, 5.0 MET, RMR 1800 → G 420, R 75, A 345, D 15, I 330 kcal (SPEC §1.3)', () => {
    const o = oracle(420, 60);
    expect(o.grossKcal).toBeCloseTo(420, 9);
    expect(o.ownRestKcal).toBeCloseTo(75, 9);
    expect(o.netAboveRestKcal).toBeCloseTo(345, 9);
    expect(o.displacedLifestyleKcal!).toBeCloseTo(15, 9);
    expect(o.incrementalKcal!).toBeCloseTo(330, 9);
    expect(realisedSessionMet(420, 80, 60)).toBeCloseTo(5, 12);
  });

  for (const kind of ['cardio', 'resistance'] as const) {
    it(`${kind}: replay at the dated mass reproduces G, R, A, D, I (the worked check)`, () => {
      const b = replay(sessionOf(kind, 8, 60, realisedSessionMet(420, 80, 60)), 80);
      expectLedger(b, 420, 60);
      expect(b.G).toBeCloseTo(420, 6);
      expect(b.I).toBeCloseTo(330, 6);
    });

    it(`${kind}: a bout across midnight reproduces the terms once`, () => {
      const b = replay(sessionOf(kind, 23.5, 90, realisedSessionMet(600, 80, 90)), 80);
      expectLedger(b, 600, 90);
    });

    it(`${kind}: GATE (recorded deviation) — dated mass 80 kg vs simulated 82.5 kg: the MET alone books G × 82.5/80`, () => {
      const b = replay(sessionOf(kind, 8, 60, realisedSessionMet(420, 80, 60)), 82.5);
      expect(b.G).toBeCloseTo((420 * 82.5) / 80, 6);
      expect(within(b.G, 420)).toBe(false);
    });

    it(`${kind}: GATE (recorded deviation) — a drawn O2 energy equivalent 4.8 kcal/L: the MET alone books G × 4.8/5`, () => {
      const b = replay(sessionOf(kind, 8, 60, realisedSessionMet(420, 80, 60)), 80, { 'activity.kcalPerLO2': 4.8 });
      expect(b.G).toBeCloseTo((420 * 4.8) / 5, 6);
      expect(within(b.G, 420)).toBe(false);
    });

    it(`${kind}: a late edit replays the edited estimate, with no residue of the first`, () => {
      const first = replay(sessionOf(kind, 8, 60, realisedSessionMet(420, 80, 60)), 80);
      const edited = replay(sessionOf(kind, 8, 45, realisedSessionMet(260, 80, 45)), 80);
      expectLedger(edited, 260, 45);
      expect(edited.G).not.toBeCloseTo(first.G, 0);
    });
  }

  it('cardio phases from supported intensity segments (two steady speed runs) reproduce Σ G', () => {
    const phases: IntervalPhase[] = [
      { kind: 'steady', durationMin: 20, met: realisedSessionMet(150, 80, 20) },
      { kind: 'steady', durationMin: 25, met: realisedSessionMet(260, 80, 25) },
    ];
    const b = replay(sessionOf('cardio', 8.75, 45, realisedSessionMet(410, 80, 45), phases), 80);
    expectLedger(b, 410, 45);
  });

  it('recovery is booked once: the released energy equals φ·A of the bout, never twice', () => {
    const b = replay(sessionOf('cardio', 8, 60, realisedSessionMet(600, 80, 60)), 80);
    const x = Math.min(1.2, (600 / 60 / 80 / 5) * 1000 / b.vo2max);
    // φ at the bout's own relative intensity with the module's default kinetics
    const ctx = makeCtx(mods, person({ body: { weightKg: 80, heightCm: 178 }, labs: { measuredRmrKcal: RMR, vo2maxMlKgMin: 40 } }));
    const k = activityModule.prepare(ctx);
    const phi = epocPhi(x, 60, false, false, k);
    expect(b.recovery).toBeGreaterThan(0);
    expect(within(b.recovery, phi * b.A, 0.01), `recovery ${b.recovery} vs φ·A ${phi * b.A}`).toBe(true);
  });
});

describe('SPEC V1.5 realised-energy adapter: realisedGrossKcal (booked first)', () => {
  for (const kind of ['cardio', 'resistance'] as const) {
    it(`${kind}: worked check at the dated mass`, () => {
      const b = replay(approved(kind, 8, 420, 60, 80), 80);
      expectLedger(b, 420, 60);
      expect(b.G).toBeCloseTo(420, 6);
      expect(b.R).toBeCloseTo(75, 6);
      expect(b.A).toBeCloseTo(345, 6);
      expect(b.D).toBeCloseTo(15, 6);
      expect(b.I).toBeCloseTo(330, 6);
    });

    it(`${kind}: dated mass 80 kg vs the engine's simulated 82.5 kg reproduces G, R, A, D, I`, () => {
      expectLedger(replay(approved(kind, 8, 420, 60, 80), 82.5), 420, 60);
      expectLedger(replay(approved(kind, 8, 420, 60, 80), 76), 420, 60);
    });

    it(`${kind}: a drawn O2 energy equivalent (4.686 and 5.047 kcal/L, the registry range) reproduces the terms`, () => {
      for (const kpl of [4.686, 5.047]) expectLedger(replay(approved(kind, 8, 420, 60, 80), 80, { 'activity.kcalPerLO2': kpl }), 420, 60);
    });

    it(`${kind}: a bout across midnight (23:30, 90 min) reproduces the terms once`, () => {
      expectLedger(replay(approved(kind, 23.5, 600, 90, 80), 81), 600, 90);
    });

    it(`${kind}: a late edit (420 kcal / 60 min → 260 kcal / 45 min) replays the edited estimate only`, () => {
      const first = replay(approved(kind, 8, 420, 60, 80), 81);
      const edited = replay(approved(kind, 8, 260, 45, 80), 81);
      expectLedger(first, 420, 60);
      expectLedger(edited, 260, 45);
    });
  }

  it('cardio phases from supported speed segments (tiling the bout) reproduce Σ G at a mismatched mass', () => {
    const segs = [
      { durationMin: 20, grossKcal: 150 },
      { durationMin: 25, grossKcal: 260 },
    ];
    expectLedger(replay(approved('cardio', 8.75, 410, 45, 80, segs), 83), 410, 45);
  });

  it('a phase without its own value takes its time share of the bout (uniform rate)', () => {
    const phases: IntervalPhase[] = [{ kind: 'steady', durationMin: 30 }];
    const b = replay(sessionOf('cardio', 8, 60, realisedSessionMet(420, 80, 60), phases, 420), 83);
    expectLedger(b, 420, 60);
  });

  it('recovery is booked once at the realised gross (φ·A of the bout)', () => {
    const b = replay(approved('cardio', 8, 600, 60, 80), 83);
    const x = Math.min(1.2, ((600 / 60 / 83 / 5) * 1000) / b.vo2max);
    const ctx = makeCtx(mods, person({ body: { weightKg: 83, heightCm: 178 }, labs: { measuredRmrKcal: RMR, vo2maxMlKgMin: 40 } }));
    const phi = epocPhi(x, 60, false, false, activityModule.prepare(ctx));
    expect(within(b.recovery, phi * b.A, 0.01), `recovery ${b.recovery} vs φ·A ${phi * b.A}`).toBe(true);
  });

  it('realisedEngineDose: one steady segment for HR/MET bouts; segments must tile the bout and match G', () => {
    const one = realisedEngineDose({ grossKcal: 420, durationMin: 60, massKg: 80 })!;
    expect(one).toMatchObject({ met: 5, realisedGrossKcal: 420, version: 'realised-dose/1' });
    expect(one.phases).toBeUndefined();
    const two = realisedEngineDose({ grossKcal: 410, durationMin: 45, massKg: 80, segments: [{ durationMin: 20, grossKcal: 150 }, { durationMin: 25, grossKcal: 260 }] })!;
    expect(two.phases!.map((p) => [p.kind, p.durationMin, p.realisedGrossKcal])).toEqual([['steady', 20, 150], ['steady', 25, 260]]);
    expect(realisedEngineDose({ grossKcal: 410, durationMin: 45, massKg: 80, segments: [{ durationMin: 20, grossKcal: 150 }] })).toBeNull();
    expect(realisedEngineDose({ grossKcal: 500, durationMin: 45, massKg: 80, segments: [{ durationMin: 20, grossKcal: 150 }, { durationMin: 25, grossKcal: 260 }] })).toBeNull();
    expect(realisedEngineDose({ grossKcal: Number.NaN, durationMin: 45, massKg: 80 })).toBeNull();
  });
});

describe('0.6.3: a reported 0 kcal (the machine showed 0) replays as no energy above rest', () => {
  it('the adapter takes 0: MET 0 and a realised gross of 0; a negative or non-finite G stays refused', () => {
    expect(realisedSessionMet(0, 80, 30)).toBe(0);
    expect(realisedEngineDose({ grossKcal: 0, durationMin: 30, massKg: 80 })).toMatchObject({ met: 0, realisedGrossKcal: 0 });
    expect(realisedSessionMet(-1, 80, 30)).toBeNaN();
    expect(realisedSessionMet(Number.NaN, 80, 30)).toBeNaN();
    expect(realisedEngineDose({ grossKcal: -5, durationMin: 30, massKg: 80 })).toBeNull();
  });

  for (const kind of ['cardio', 'resistance'] as const) {
    it(`${kind}: A = 0 and R, D, I as the shared ledger books G = 0 (never a MET or modality default)`, () => {
      const b = replay(approved(kind, 8, 0, 30, 80), 80);
      const o = oracle(0, 30);
      expect(o.netAboveRestKcal).toBe(0);
      expect(b.A).toBeCloseTo(0, 9);
      expect(within(b.R, o.ownRestKcal)).toBe(true);
      expect(within(b.D, o.displacedLifestyleKcal!), `D ${b.D} vs ${o.displacedLifestyleKcal}`).toBe(true);
      expect(within(b.I, o.incrementalKcal!), `I ${b.I} vs ${o.incrementalKcal}`).toBe(true);
      expect(b.recovery).toBeCloseTo(0, 6);
      // the same bout without the reported 0 would have been estimated from its MET: clearly more
      expect(replay(sessionOf(kind, 8, 30, 5), 80).A).toBeGreaterThan(50);
    });
  }
});
