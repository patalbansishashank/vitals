// @vitest-environment node
import { captureInitialSnapshot, runEngine, simulate, simulateEnsemble } from '../loop';
import { compileSchedule, habitualWeek } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { MODULES, checkSignalHooks, checkWiring } from '../moduleRegistry';
import { buildModelParams, sampleParams, validateParamDefs } from '../paramsRegistry';
import { defineModule } from '../moduleKit';
import { ensembleBands, memberBandInputs } from '../bands';
import { N_SERIES, SERIES, SIGNAL_MIRRORS } from '../../types/metrics';
import type { AnyEngineModule } from '../../types/module';
import { SIGNAL_DEFS } from '../../types/signals';
import type { Schedule } from '../../types/schedule';
import { MAN, PROGRAM_A, PROGRAM_B, repeatSchedule } from './fixtures';
import { STUB_MODULES, stubSpy } from './stubModules';
import { measureUnderLoad } from '../../testing/benchLoad';
import { BAND_DAY_METHOD } from '@/lib/bodyContracts';

const profile = resolveProfile(MAN);
const sched180 = compileSchedule(repeatSchedule(180, [0, 1, 0, 1, 0, 1, 1]), profile);

describe('core loop with placeholder-physics stubs (independent of module implementations)', () => {
  it('runs 180 days end to end and produces every recorded series', () => {
    const r = runEngine(profile, sched180, {}, STUB_MODULES);
    expect(r.meta.nDays).toBe(180);
    expect(r.daily.fatMass).toHaveLength(180);
    expect(r.hourly.scaleWeight).toHaveLength(180 * 24);
    expect(Number.isFinite(r.daily.fatMass![179]!)).toBe(true);
    expect(r.daily.fatMass![179]!).toBeLessThan(profile.fm0Kg); // placeholder physics: deficit loses fat
    expect(r.meta.aborted).toBeUndefined();
  });

  it('is bit-for-bit deterministic', () => {
    const a = runEngine(profile, sched180, {}, STUB_MODULES);
    const b = runEngine(profile, sched180, {}, STUB_MODULES);
    for (const id of Object.keys(a.daily) as (keyof typeof a.daily)[]) {
      expect(Array.from(b.daily[id]!)).toEqual(Array.from(a.daily[id]!));
    }
    expect(Array.from(b.hourly.scaleWeight!)).toEqual(Array.from(a.hourly.scaleWeight!));
  });

  it('honours record modes and series subsets', () => {
    const full = runEngine(profile, sched180, { record: 'full' }, STUB_MODULES);
    const daily = runEngine(profile, sched180, { record: 'daily' }, STUB_MODULES);
    const none = runEngine(profile, sched180, { record: 'none' }, STUB_MODULES);
    const subset = runEngine(profile, sched180, { record: 'daily', series: ['fatMass', 'scaleWeight'] }, STUB_MODULES);
    expect(Object.keys(full.hourly).length).toBeGreaterThan(0);
    expect(Object.keys(daily.hourly)).toHaveLength(0);
    expect(Object.keys(none.daily)).toHaveLength(0);
    expect(Object.keys(subset.daily).sort()).toEqual(['fatMass', 'scaleWeight']);
    expect(Array.from(daily.daily.fatMass!)).toEqual(Array.from(full.daily.fatMass!));
    expect(subset.final.fatMass).toBe(full.final.fatMass);
  });

  it('keeps the energy and mass identities (test mode)', () => {
    const r = runEngine(profile, sched180, { checks: true }, STUB_MODULES);
    expect(r.meta.checks!.energyMaxAbsKcal).toBeLessThan(1e-9);
    expect(r.meta.checks!.energyDayMaxAbsKcal).toBeLessThan(1e-6);
    expect(r.meta.checks!.massMaxAbsKg).toBeLessThan(1e-9);
  });

  it('aborts early on a state bound (planner mode)', () => {
    const r = runEngine(profile, sched180, { mode: 'planner', abortOn: [{ id: 'fm-floor', series: 'fatMass', op: '<', value: profile.fm0Kg - 0.5 }] }, STUB_MODULES);
    expect(r.meta.aborted?.bound).toBe('fm-floor');
    expect(r.meta.aborted!.day).toBeLessThan(179);
  });

  it('accepts UI-level inputs through simulate() and supports ensembles', () => {
    const r = simulate(MAN, repeatSchedule(14, [0]));
    expect(r.daily.scaleWeight).toHaveLength(14);
    const e = simulateEnsemble(MAN, repeatSchedule(14, [0]), { draws: 4, seed: 7 });
    expect(e.p10.fatMass).toHaveLength(14);
    expect(e.p10.fatMass![13]!).toBeLessThanOrEqual(e.p90.fatMass![13]!);
  });
});


describe('burn-in on the habitual week (MODEL_SPEC §3.4, review B3)', () => {
  it('runs the habitual week with its sessions and calls endBurnIn once, after day −1', () => {
    stubSpy.endBurnInCalls = 0;
    stubSpy.burnInExerciseDays = 0;
    const r = runEngine(profile, sched180, { burnInDays: 14 }, STUB_MODULES);
    expect(stubSpy.endBurnInCalls).toBe(1);
    expect(stubSpy.lastBurnInDays).toBe(14);
    // MAN has 3 habitual sessions per week → 6 exercise days in a 14-day burn-in
    expect(stubSpy.burnInExerciseDays).toBe(2 * profile.habits.sessionsPerWeek);
    // composition reset at the end of burn-in: t = 0 fat mass equals the profile's
    expect(r.initial.fatMass).toBeCloseTo(profile.fm0Kg, 9);
  });

  it('calls endBurnIn with burnInDays = 0 when burn-in is disabled', () => {
    stubSpy.endBurnInCalls = 0;
    runEngine(profile, sched180, { burnInDays: 0 }, STUB_MODULES);
    expect(stubSpy.endBurnInCalls).toBe(1);
    expect(stubSpy.lastBurnInDays).toBe(0);
  });

  it('habitual week: sessions spread over alternating days at the habitual intake', () => {
    const week = habitualWeek(profile);
    expect(week).toHaveLength(7);
    const days = week.map((d) => d.nSessions);
    expect(days.reduce((a, b) => a + b, 0)).toBe(3);
    expect(days).toEqual([1, 0, 1, 0, 1, 0, 0]);
    for (const d of week) expect(d.energyKcal).toBeCloseTo(profile.tdee0Kcal, 6);
  });
});

describe('module wiring and registry', () => {
  it('every signal has exactly one declared writer and all reads exist', () => {
    const { issues } = checkWiring();
    expect(issues).toEqual([]);
  });

  it('module list matches the signal owners and every series owner exists', () => {
    const ids = new Set(MODULES.map((m) => m.id));
    for (const d of SIGNAL_DEFS) expect(ids.has(d.writer)).toBe(true);
    for (const s of SERIES) expect(s.owner === 'core' || ids.has(s.owner as never)).toBe(true);
    expect(N_SERIES).toBe(SERIES.length);
  });

  it('series ids are unique and every module records only series it owns', () => {
    expect(new Set(SERIES.map((s) => s.id)).size).toBe(SERIES.length);
    for (const m of MODULES) for (const id of m.records) expect(SERIES.find((s) => s.id === id)!.owner).toBe(m.id);
    const metrics = SERIES.filter((s) => s.kind === 'metric');
    expect(metrics.length).toBeGreaterThanOrEqual(40);
    expect(metrics.length).toBeLessThanOrEqual(55);
  });

  it('signal-mirror detail series: written by their owner module, recorded by the core only, finite when requested', () => {
    for (const mr of SIGNAL_MIRRORS) {
      const def = SIGNAL_DEFS.find((d) => d.name === mr.signal)!;
      expect(def.writer).toBe(SERIES.find((x) => x.id === mr.series)!.owner);
      for (const m of MODULES) expect(m.records.includes(mr.series)).toBe(false);
    }
    const r = runEngine(profile, compileSchedule(repeatSchedule(10, [0, 1]), profile), { record: 'full', series: ['totalKetones', 'dietFatigue', 'fatTrunk', 'muscleLegs', 'atResting'] });
    for (const id of ['totalKetones', 'dietFatigue', 'fatTrunk', 'muscleLegs', 'atResting'] as const) {
      expect(Number.isFinite(r.initial[id]!)).toBe(true);
      expect(Array.from(r.daily[id]!).every(Number.isFinite)).toBe(true);
    }
    expect(r.hourly.totalKetones).toHaveLength(240);
  });

  it('parameter registry validates', () => {
    expect(validateParamDefs(MODULES)).toEqual([]);
    expect(buildModelParams(MODULES).registryHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('performance (micro-benchmark, reported)', () => {
  it('180-day runs stay well inside the budget with stubs', () => {
    const { result: report, factor } = measureUnderLoad(() => {
      for (let i = 0; i < 20; i++) runEngine(profile, sched180, { mode: 'planner', burnInDays: 0 }, STUB_MODULES);
      const rep: Record<string, number> = {};
      for (const record of ['none', 'daily', 'full'] as const) {
        const n = 40;
        const t0 = performance.now();
        for (let i = 0; i < n; i++) runEngine(profile, sched180, { record, burnInDays: 0 }, STUB_MODULES);
        rep[record] = (performance.now() - t0) / n;
      }
      return rep;
    });
    console.info(`[bench] ms per 180-day run (contract overhead, stub modules): none ${report.none!.toFixed(2)} · daily ${report.daily!.toFixed(2)} · full ${report.full!.toFixed(2)} (load factor ${factor.toFixed(2)})`);
    // Generous CI bound on the core's own overhead; the target for the full engine is ≤ 10 ms (desktop) — MODEL_SPEC §0.3.
    // limit scales with the machine load (benchLoad.ts)
    expect(report.daily!).toBeLessThan(25 * factor);
  });

  it('reports the full engine (real modules; not gating while modules are in progress)', () => {
    let ms = Number.NaN;
    try {
      runEngine(profile, sched180, { record: 'daily', burnInDays: 0 });
      const n = 5;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) runEngine(profile, sched180, { record: 'daily', burnInDays: 0 });
      ms = (performance.now() - t0) / n;
    } catch (e) {
      console.info(`[bench] full engine threw (module work in progress): ${(e as Error).message}`);
    }
    console.info(`[bench] ms per 180-day run (real modules, record daily): ${ms.toFixed(2)}`);
    expect(true).toBe(true);
  });
});

describe('initial snapshot (RunOptions.initialSnapshot, MODEL_SPEC §3.4 / §10)', () => {
  const sched90 = compileSchedule(repeatSchedule(90, [0, 1, 0, 1, 0, 1, 1]), profile);
  const other90 = compileSchedule(repeatSchedule(90, [1, 1, 0]), profile);

  function sameResult(a: ReturnType<typeof runEngine>, b: ReturnType<typeof runEngine>): string | null {
    for (const id of Object.keys(a.daily) as (keyof typeof a.daily)[]) {
      const x = a.daily[id]!;
      const y = b.daily[id];
      if (!y || x.length !== y.length) return `daily ${id} missing`;
      for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `daily ${id}[${i}] ${x[i]} vs ${y[i]}`;
    }
    for (const id of Object.keys(a.hourly) as (keyof typeof a.hourly)[]) {
      const x = a.hourly[id]!;
      const y = b.hourly[id]!;
      for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `hourly ${id}[${i}]`;
    }
    for (const k of Object.keys(a.safety) as (keyof typeof a.safety)[]) {
      const x = a.safety[k]!;
      const y = b.safety[k]!;
      for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `safety ${k}[${i}]`;
    }
    if (JSON.stringify(a.initial) !== JSON.stringify(b.initial)) return 'initial';
    if (JSON.stringify(a.events) !== JSON.stringify(b.events)) return 'events';
    if (JSON.stringify(a.warnings) !== JSON.stringify(b.warnings)) return 'warnings';
    return null;
  }

  /**
   * Test adapter: a module whose constants object is built inside its state (prepare → {}, init → { k, s }), so a module
   * that keeps run state in K (contract violation, MODEL_SPEC §0.5) is still snapshotted completely. Lets the core's
   * snapshot/restore be verified on the whole real engine independently of that module's fix.
   */
  function kInState(m: AnyEngineModule): AnyEngineModule {
    type W = { k: object; s: object };
    return {
      ...m,
      prepare: () => ({}),
      init: (_k, ctx, bus) => {
        const k = m.prepare(ctx);
        return { k, s: m.init(k, ctx, bus) } as W;
      },
      startDay: (x, _k, bus, d, c) => m.startDay((x as W).s, (x as W).k, bus, d, c),
      stepHour: (x, _k, bus, h, d, c) => m.stepHour((x as W).s, (x as W).k, bus, h, d, c),
      endOfDay: (x, _k, bus, d, c) => m.endOfDay((x as W).s, (x as W).k, bus, d, c),
      recordHour: (x, _k, bus, o) => m.recordHour((x as W).s, (x as W).k, bus, o),
      recordDay: (x, _k, bus, o) => m.recordDay((x as W).s, (x as W).k, bus, o),
      finalize: (x, _k, sink) => m.finalize((x as W).s, (x as W).k, sink),
      ...(m.endBurnIn ? { endBurnIn: (x: object, _k: object, bus: Parameters<NonNullable<AnyEngineModule['endBurnIn']>>[2], ctx: Parameters<NonNullable<AnyEngineModule['endBurnIn']>>[3]) => m.endBurnIn!((x as W).s, (x as W).k, bus, ctx) } : {}),
    };
  }
  // intake keeps its meal-trajectory caches in K (CONTRACT_REQUESTS 2026-09-30 18:45); every other module is used as is
  const EXACT = MODULES.map((m) => (m.id === 'intake' ? kInState(m) : m));

  it('restoring the post-burn-in state is bit-identical to running the burn-in (all 16 real modules, two schedules)', () => {
    const snap = captureInitialSnapshot(profile, sched90, { record: 'full' }, EXACT);
    expect(snap.states).toHaveLength(MODULES.length);
    for (const cs of [sched90, other90]) {
      const full = runEngine(profile, cs, { record: 'full', checks: true }, EXACT);
      const fast = runEngine(profile, cs, { record: 'full', checks: true, initialSnapshot: snap }, EXACT);
      expect(sameResult(full, fast)).toBeNull();
      expect(fast.meta.checks!.t0WeightErrKg).toBe(full.meta.checks!.t0WeightErrKg);
    }
    // the snapshot is not consumed: a second restore gives the same result again
    const again = runEngine(profile, other90, { record: 'full', initialSnapshot: snap }, EXACT);
    expect(sameResult(runEngine(profile, other90, { record: 'full' }, EXACT), again)).toBeNull();
  });

  // Formerly a known fail (intake kept its meal-trajectory caches in K); passing since A2 moved them into IntakeState.
  it('the registry modules as they are restore bit-identically', () => {
    const snap = captureInitialSnapshot(profile, sched90, { record: 'full' });
    expect(sameResult(runEngine(profile, other90, { record: 'full' }), runEngine(profile, other90, { record: 'full', initialSnapshot: snap }))).toBeNull();
  });

  it('planner mode: snapshot per parameter draw, captured from a run and reused', () => {
    const opts = { mode: 'planner' as const, record: 'daily' as const, series: ['fatMass', 'scaleWeight'] as const };
    const first = runEngine(profile, sched90, { ...opts, captureSnapshot: true }, EXACT);
    expect(first.snapshot).toBeDefined();
    const reuse = runEngine(profile, other90, { ...opts, initialSnapshot: first.snapshot! }, EXACT);
    expect(sameResult(runEngine(profile, other90, opts, EXACT), reuse)).toBeNull();
  });

  it('rejects a snapshot taken for another horizon, mode, series mask or parameter vector', () => {
    const snap = captureInitialSnapshot(profile, sched90, { record: 'daily' });
    expect(() => runEngine(profile, sched180, { record: 'daily', initialSnapshot: snap })).toThrow(/does not match/);
    expect(() => runEngine(profile, sched90, { record: 'daily', mode: 'planner', initialSnapshot: snap })).toThrow(/does not match/);
    expect(() => runEngine(profile, sched90, { record: 'daily', series: ['fatMass'], initialSnapshot: snap })).toThrow(/does not match/);
    const v = new Float64Array(buildModelParams(MODULES).values);
    v[0] = v[0]! * 1.01;
    expect(() => runEngine(profile, sched90, { record: 'daily', paramOverrides: v, initialSnapshot: snap })).toThrow(/does not match/);
  });
});

describe('planner hooks: abortOn on SafetyTrace quantities, constraint margins, record subsets', () => {
  it('aborts on a SafetyTrace bound (ModuleContext.abortOn is handed to the modules)', () => {
    let seen: unknown;
    const spyMods = STUB_MODULES.map((m) => (m.id === 'safety' ? { ...m, prepare: (ctx: Parameters<typeof m.prepare>[0]) => ((seen = ctx.abortOn), m.prepare(ctx)) } : m));
    const bound = { id: 'bmi-floor', series: 'tissueMassKg' as const, op: '<' as const, value: profile.weightKg + 1 };
    // stub safety writes no trace: the NaN trace never violates
    const r0 = runEngine(profile, sched180, { mode: 'planner', abortOn: [bound] }, spyMods);
    expect(seen).toEqual([bound]);
    expect(r0.meta.aborted).toBeUndefined();
    // real engine: tissue mass is below entered + 1 kg from day 0 → abort on day 0 via the trace
    const r = runEngine(profile, sched180, { mode: 'planner', record: 'daily', abortOn: [bound] });
    expect(r.meta.aborted?.bound).toBe('bmi-floor');
    expect(r.meta.aborted!.day).toBe(0);
    expect(() => runEngine(profile, sched180, { abortOn: [{ id: 'x', series: 'nope' as never, op: '<', value: 0 }] })).toThrow(/neither a series/);
  });

  it('returns the planner hard-constraint margins when asked (RunOptions.constraints)', () => {
    const r = runEngine(profile, sched180, { mode: 'planner', record: 'none', constraints: true });
    expect(r.constraints?.length).toBeGreaterThan(5);
    expect(r.constraints![0]!.margin).toHaveLength(180);
    expect(runEngine(profile, sched180, { mode: 'planner', record: 'none' }).constraints).toBeUndefined();
  });

  it('a series subset records the same daily values as a full run (record hooks skipped only for modules without enabled series)', () => {
    const full = runEngine(profile, sched180, { record: 'full' });
    const ids = ['fatMass', 'scaleWeight', 'bhb', 'hunger', 'ldl', 'tdee'] as const;
    const sub = runEngine(profile, sched180, { mode: 'planner', record: 'daily', series: ids });
    for (const id of ids) expect(Array.from(sub.daily[id]!)).toEqual(Array.from(full.daily[id]!));
  });
});

describe('conservation checks are evaluated against module states (O-4/O-5)', () => {
  it('real modules: hourly storage, deposition-cost and glycogen identities, daily balance from states, mass identity', () => {
    const r = runEngine(profile, sched180, { checks: true, record: 'none' });
    const c = r.meta.checks!;
    expect(c.storageMaxAbsKcal).toBeLessThan(1e-6);
    expect(c.depositionMaxAbsKcal).toBeLessThan(1e-6);
    expect(c.glycogenMaxAbsKcal).toBeLessThan(1e-6);
    expect(c.energyDayMaxAbsKcal).toBeLessThan(1);
    expect(c.massMaxAbsKg).toBeLessThan(1e-9);
    expect(Math.abs(c.t0WeightErrKg!)).toBeLessThan(0.05);
    // whole-run balance: absorbed − expended = stored (tissue + glycogen), up to the ketone loss
    expect(Math.abs(c.eiTotalKcal! - c.teeTotalKcal! - c.storedTotalKcal!)).toBeLessThan(0.01 * c.eiTotalKcal! + 50);
  });

  it('a module that moves fat mass outside the energy ledger ends the run at a model limit (D1-08), conserved until then', () => {
    const leakFrom = 5 * 24 + 10; // absolute hour of the first leak
    const leaky = MODULES.map((m) =>
      m.id !== 'composition' ? m : { ...m, stepHour: (s: object, k: object, bus: Parameters<typeof m.stepHour>[2], h: Parameters<typeof m.stepHour>[3], d: Parameters<typeof m.stepHour>[4], c: Parameters<typeof m.stepHour>[5]) => {
        m.stepHour(s, k, bus, h, d, c);
        if (c.hourIndex >= leakFrom) bus.fatMassKg += 1e-6;
      } },
    );
    const r = runEngine(profile, sched180, { checks: true, record: 'daily' }, leaky);
    expect(r.meta.validity).toMatchObject({ status: 'modelLimit', validThroughHour: leakFrom - 1, reasonCode: 'tissueLedgerNotConserved' });
    // every accepted hour closed the ledger; the clipped hour is never recorded and later days are not forecasts
    expect(r.meta.checks!.storageMaxAbsKcal).toBeLessThan(1e-6);
    expect(Number.isFinite(r.daily.fatMass![4]!)).toBe(true);
    expect(Number.isNaN(r.daily.fatMass![5]!)).toBe(true);
    expect(Number.isNaN(r.daily.fatMass![179]!)).toBe(true);
    expect(r.meta.outputStatus?.fatMass).toMatchObject({ status: 'modelLimit', fromDay: 5 });
    expect(r.meta.aborted).toBeUndefined();
    // the conserving reference run has no validity record
    expect(runEngine(profile, sched180, { record: 'none' }).meta.validity).toBeUndefined();
  });
});

// ---------------------------------------------------------------- W1-core contributions (2026-10-18)

describe('D8-02: ensemble bands are stochastic-only parameter-sensitivity ranges', () => {
  const sched = repeatSchedule(10, [0, 1]);

  it('quantiles never include the nominal run; zero draws export no band', () => {
    const e = simulateEnsemble(MAN, sched, { draws: 6, seed: 3, series: ['fatMass', 'ldl'] });
    expect(e.method.fatMass).toBe('draws');
    expect(e.bandMeta!.fatMass).toMatchObject({ method: 'draws', uncertaintyKind: 'parameterSensitivity', coverage: 'unvalidated', nominalInQuantiles: false, endpoint: 'raw', draws: 6 });
    expect(e.bandMeta!.ldl!.endpoint).toBe('deltaRebasedOnNominal');
    // recompute from the same members without the nominal
    const rp = resolveProfile(MAN);
    const cs = compileSchedule(sched, rp);
    const vectors = sampleParams(buildModelParams(MODULES).defs, { count: 6, seed: 3 });
    const members = vectors.map((v) => runEngine(rp, cs, { series: ['fatMass', 'ldl'], record: 'daily', paramOverrides: v, collectEvents: false }));
    const d = 9;
    const vals = members.map((r) => r.daily.fatMass![d]!).sort((a, b) => a - b);
    const q = (p: number) => { const i = (vals.length - 1) * p; const lo = Math.floor(i); return vals[lo]! + (vals[Math.ceil(i)]! - vals[lo]!) * (i - lo); };
    expect(e.p50.fatMass![d]!).toBeCloseTo(q(0.5), 4);
    expect(e.p10.fatMass![d]!).toBeCloseTo(q(0.1), 4);
    // change series: member change from its own t = 0, re-based on the nominal t = 0
    const ch = members.map((r) => r.daily.ldl![d]! - r.initial.ldl!).sort((a, b) => a - b);
    const med = (ch[2]! + ch[3]!) / 2;
    expect(e.p50.ldl![d]!).toBeCloseTo(e.nominal.initial.ldl! + med, 4);
    const none = simulateEnsemble(MAN, sched, { draws: 0, seed: 3, series: ['fatMass'] });
    expect(none.method.fatMass).toBe('none');
    expect(none.p10.fatMass).toBeUndefined();
    expect(none.bandMeta!.fatMass).toMatchObject({ method: 'none', coverage: 'notApplicable', draws: 0 });
  });

  it('core simulateEnsemble and the streaming reducer give identical bands for the same members', () => {
    const e = simulateEnsemble(MAN, sched, { draws: 5, seed: 9, series: ['fatMass', 'ldl', 'scaleWeight'] });
    const rp = resolveProfile(MAN);
    const cs = compileSchedule(sched, rp);
    const vectors = sampleParams(buildModelParams(MODULES).defs, { count: 5, seed: 9 });
    // what the worker streams: band inputs per draw (change series as change from the member's own t = 0)
    const streamed = vectors.map((v) => {
      const r = runEngine(rp, cs, { series: ['fatMass', 'ldl', 'scaleWeight'], record: 'daily', paramOverrides: v, collectEvents: false });
      return memberBandInputs(r.daily, r.initial);
    });
    // the Simulator's `computeBands` is this reducer over the streamed members (parity test in simulationModel.test.ts)
    const s = ensembleBands(e.nominal.daily, e.nominal.initial, streamed);
    for (const id of ['fatMass', 'ldl', 'scaleWeight'] as const) {
      expect(Array.from(s.p10[id]!)).toEqual(Array.from(e.p10[id]!));
      expect(Array.from(s.p50[id]!)).toEqual(Array.from(e.p50[id]!));
      expect(Array.from(s.p90[id]!)).toEqual(Array.from(e.p90[id]!));
      expect(s.bandMeta![id]).toEqual(e.bandMeta![id]);
    }
  });

  it('members without finite values are counted, never claimed: no band rather than a counterfeit one', () => {
    const nominal = { fatMass: new Float32Array([10, 10]) };
    const b = ensembleBands(nominal, undefined, [{ fatMass: new Float32Array([Number.NaN, Number.NaN]) }]);
    expect(b.p10.fatMass).toBeUndefined();
    expect(b.bandMeta!.fatMass).toMatchObject({ method: 'none', draws: 0 });
    const c = ensembleBands(nominal, undefined, [8, 9, 11, 12].map((v) => ({ fatMass: new Float32Array([v, Number.NaN]) })));
    expect(c.p50.fatMass![0]).toBeCloseTo(10, 6);
    expect(c.p10.fatMass![0]).toBeCloseTo(8.3, 6); // 8 + 0.3·(9 − 8): the nominal 10 is not a member
    // A1-049: storage is always finite; the day's availability lives in the per-day mask
    expect(c.p50.fatMass![1]).toBe(0);
    expect(c.bandDays.fatMass!.method[1]).toBe(BAND_DAY_METHOD.none);
    expect(c.bandDays.fatMass!.valid[1]).toBe(0);
    expect(c.bandMeta!.fatMass!.draws).toBe(4);
  });
});

describe('D5-03: the actually applied intake correction is booked per day', () => {
  it('requested vs applied kcal; zero-energy days are skipped and flagged; a zero offset adds nothing', () => {
    const tmplZero = { ...PROGRAM_B, id: 'Z', energy: { kind: 'zero' as const } };
    const cs = compileSchedule(repeatSchedule(6, [1, 1, 2, 1, 1, 1], [PROGRAM_A, PROGRAM_B, tmplZero]), profile);
    const r = runEngine(profile, cs, { record: 'daily', intakeOffsetKcal: [{ fromDay: 1, kcal: 150 }, { fromDay: 4, kcal: -100 }] });
    const a = r.meta.offsetsApplied!;
    expect(a.map((x) => x.day)).toEqual([1, 2, 3, 4, 5]);
    expect(a[0]).toMatchObject({ day: 1, requestedKcal: 150 });
    expect(a[0]!.appliedKcal).toBeCloseTo(150, 6);
    expect(a[1]).toEqual({ day: 2, requestedKcal: 150, appliedKcal: 0, skippedReason: 'zeroEnergyDay' });
    expect(a[3]!.appliedKcal).toBeCloseTo(-100, 6);
    // the input echoes keep the logged/prescribed day
    expect(r.daily.inEnergy![1]!).toBeCloseTo(cs.days[1]!.energyKcal, 3);
    expect(runEngine(profile, cs, { record: 'none', intakeOffsetKcal: [{ fromDay: 0, kcal: 0 }] }).meta.offsetsApplied).toBeUndefined();
  });
});

describe('D8-06: day 0 starts after the last observed sleep episode', () => {
  it('a short observed night before day 0 changes the carried sleep; the post-burn-in snapshot stays schedule-independent', () => {
    const base: Schedule = repeatSchedule(3, [1]);
    const withObs: Schedule = {
      ...base,
      programs: [PROGRAM_A, { ...PROGRAM_B, sleep: { observed: { bedAt: '2026-10-05T02:00:00+02:00', wakeAt: '2026-10-05T06:00:00+02:00', tz: 'Europe/Berlin' } } }],
    };
    const c0 = compileSchedule(base, profile);
    const c1 = compileSchedule(withObs, profile);
    expect(c1.initialSleep).toMatchObject({ bedClockH: 26, sleepHours: 4, totalAsleepHours: 4, qualityStatus: 'unrated', coverage: 'complete' });
    const r0 = runEngine(profile, c0, { record: 'full', series: ['scaleWeight'] });
    const r1 = runEngine(profile, c1, { record: 'full', series: ['scaleWeight'] });
    expect(Array.from(r1.daily.scaleWeight!)).not.toEqual(Array.from(r0.daily.scaleWeight!));
    // restoring the post-burn-in snapshot reproduces the uninterrupted run with the observed initial sleep
    const snap = captureInitialSnapshot(profile, c1, { series: ['scaleWeight'] });
    const r2 = runEngine(profile, c1, { record: 'full', series: ['scaleWeight'], initialSnapshot: snap });
    expect(Array.from(r2.daily.scaleWeight!)).toEqual(Array.from(r1.daily.scaleWeight!));
  });
});

describe('D8-07: hook-aware signal declarations', () => {
  const mod = (id: string, writes: string[], reads: string[], hooks: Array<{ signal: string; access: 'write' | 'read'; hook: string; lag?: 0 | 1 }>): AnyEngineModule =>
    ({ ...MODULES.find((m) => m.id === id)!, writes, reads, signalHooks: hooks }) as unknown as AnyEngineModule;

  it('same-endOfDay daily EEE (lag 0) and a next-day strength multiplier read by an earlier module (lag 1) pass', () => {
    const activity = mod('activity', ['exSessionNetKcalD'], [], [{ signal: 'exSessionNetKcalD', access: 'write', hook: 'endOfDay' }]);
    const muscle = mod('muscle', [], ['strengthEaMult'], [{ signal: 'strengthEaMult', access: 'read', hook: 'endOfDay', lag: 1 }]);
    const wellbeing = mod('wellbeing', ['strengthEaMult'], ['exSessionNetKcalD'], [
      { signal: 'strengthEaMult', access: 'write', hook: 'endOfDay' },
      { signal: 'exSessionNetKcalD', access: 'read', hook: 'endOfDay', lag: 0 },
    ]);
    expect(checkSignalHooks([activity, muscle, wellbeing])).toEqual([]);
  });

  it('mismatched lags, foreign writes and undeclared accesses fail', () => {
    const activity = mod('activity', ['exSessionNetKcalD'], [], [{ signal: 'exSessionNetKcalD', access: 'write', hook: 'endOfDay' }]);
    const muscle = mod('muscle', [], ['strengthEaMult'], [{ signal: 'strengthEaMult', access: 'read', hook: 'endOfDay', lag: 0 }]);
    const wellbeing = mod('wellbeing', ['strengthEaMult'], ['exSessionNetKcalD', 'fatMassKg'], [
      { signal: 'strengthEaMult', access: 'write', hook: 'endOfDay' },
      { signal: 'exSessionNetKcalD', access: 'read', hook: 'endOfDay', lag: 1 },
      { signal: 'leanTissueKg', access: 'write', hook: 'stepHour' },
    ]);
    const problems = checkSignalHooks([activity, muscle, wellbeing]).map((i) => `${i.module}:${i.signal}:${i.problem}`);
    expect(problems.some((p) => p.startsWith('muscle:strengthEaMult') && p.includes('lag 0'))).toBe(true);
    expect(problems.some((p) => p.startsWith('wellbeing:exSessionNetKcalD') && p.includes('lag 1'))).toBe(true);
    expect(problems.some((p) => p.startsWith('wellbeing:leanTissueKg') && p.includes('owned by composition'))).toBe(true);
    expect(problems.some((p) => p.startsWith('wellbeing:fatMassKg') && p.includes('read without a hook declaration'))).toBe(true);
  });

  it('the production registry has no hook-declaration violations', () => {
    expect(checkSignalHooks()).toEqual([]);
  });
});

describe('D1-01: internal daily TEE equals the recorded hourly ledger', () => {
  it('energy’s yesterday TEE (state) equals the sum of the recorded hourly TDEE across midnight, burn-in and resume', () => {
    const cs = compileSchedule(repeatSchedule(8, [0, 1, 1]), profile);
    const days = [1, 2, 3, 4, 5, 6, 7];
    const r = runEngine(profile, cs, { record: 'daily', series: ['tdee'], captureSnapshotAt: days });
    const ei = MODULES.findIndex((m) => m.id === 'energy');
    for (const d of days) {
      const st = r.snapshots![d]!.states[ei] as { prevDayTeeKcal: number };
      // recorded daily values are Float32: compare within its resolution (the endpoint defect is whole kcal)
      expect(Math.abs(st.prevDayTeeKcal - r.daily.tdee![d - 1]!)).toBeLessThan(1e-3);
    }
    // resume from day 4: the same internal and recorded values
    const k = 4;
    const resumed = runEngine(profile, cs, { record: 'daily', series: ['tdee'], initialSnapshot: r.snapshots![k]!, captureSnapshotAt: [7] });
    expect(resumed.daily.tdee![6]!).toBeCloseTo(r.daily.tdee![6]!, 9);
    expect((resumed.snapshots![7]!.states[ei] as { prevDayTeeKcal: number }).prevDayTeeKcal).toBeCloseTo((r.snapshots![7]!.states[ei] as { prevDayTeeKcal: number }).prevDayTeeKcal, 9);
  });
});

describe('D1-08: a tissue floor solved as a conserved boundary ends the run after that hour', () => {
  it('validity says the boundary hour is the last valid one; later days are not forecasts', () => {
    const at = 3 * 24 + 15;
    const floored = MODULES.map((m) =>
      m.id !== 'composition' ? m : { ...m, stepHour: (s: object, k: object, bus: Parameters<typeof m.stepHour>[2], h: Parameters<typeof m.stepHour>[3], d: Parameters<typeof m.stepHour>[4], c: Parameters<typeof m.stepHour>[5]) => {
        m.stepHour(s, k, bus, h, d, c);
        if (c.hourIndex === at) (s as { limitThisHour: number }).limitThisHour = 1;
      } },
    );
    const r = runEngine(profile, sched180, { record: 'full', series: ['fatMass', 'scaleWeight'], checks: true }, floored);
    expect(r.meta.validity).toMatchObject({ status: 'modelLimit', validThroughHour: at, reasonCode: 'tissueFloorModelLimit' });
    expect(Number.isFinite(r.hourly.scaleWeight![at]!)).toBe(true); // the conserved boundary hour is recorded
    expect(Number.isNaN(r.hourly.scaleWeight![at + 1]!)).toBe(true);
    expect(Number.isNaN(r.daily.fatMass![3]!)).toBe(true); // the partial day is never committed as a daily value
    expect(r.meta.checks!.storageMaxAbsKcal).toBeLessThan(1e-6);
  });

  it('a partial module set (a ledger term without its writer) is not a model-limit crossing', () => {
    const stub = (id: string, writes: string[], step?: (bus: Record<string, number>) => void): AnyEngineModule =>
      defineModule<object>({
        id: id as 'intake',
        specSection: 'test',
        dossiers: 'test',
        params: [],
        reads: [],
        writes: writes as ['fatMassKg'],
        records: [],
        init: (_k, ctx, bus) => {
          if (writes.includes('fatMassKg')) bus.fatMassKg = ctx.profile.fm0Kg;
          if (writes.includes('leanTissueKg')) bus.leanTissueKg = ctx.profile.ffm0Kg;
          return {};
        },
        ...(step ? { stepHour: (_s: object, _k: object, bus: object) => step(bus as Record<string, number>) } : {}),
      }) as unknown as AnyEngineModule;
    // intake and composition without the energy/fuel/ketone flux writers: the identity is undefined, never "violated"
    const mods = [stub('intake', ['eAbsKcalH']), stub('composition', ['fatMassKg', 'leanTissueKg'], (bus) => (bus.fatMassKg! -= 1e-3))];
    const r = runEngine(profile, compileSchedule(repeatSchedule(5, [0]), profile), { record: 'daily' }, mods);
    expect(r.meta.validity).toBeUndefined();
  });
});

describe('C6: module assumptions and run statuses reach the result', () => {
  it('during-session carbohydrate of unknown mixture is a named glucose scenario; a stated mixture is not', () => {
    const ride = (comp?: Record<string, number>) =>
      compileSchedule(
        repeatSchedule(4, [0], [{ ...PROGRAM_B, exercise: [{ kind: 'cardio', modality: 'cycle', startH: 9, durationMin: 90, carbDuringGPerH: 60, ...(comp ? { carbDuringComposition: comp } : {}) }] }]),
        profile,
      );
    const unknown = runEngine(profile, ride(), { record: 'daily', series: ['glucose', 'fatMass'] });
    expect(unknown.meta.assumptions).toContain('unknownCarbMixtureAsGlucose');
    expect(unknown.meta.outputStatus?.glucose).toMatchObject({ status: 'scenario', reasonCode: 'carbMixtureUnknown', fromDay: 0 });
    const known = runEngine(profile, ride({ glucoseEqG: 40, fructoseG: 20 }), { record: 'daily', series: ['glucose'] });
    expect(known.meta.assumptions ?? []).not.toContain('unknownCarbMixtureAsGlucose');
  });

  it('activity and muscle assumptions and the growth scenario are named in every full-module run', () => {
    const r = runEngine(profile, compileSchedule(repeatSchedule(3, [0]), profile), { record: 'none' });
    for (const a of ['fitnessMemHeuristic', 'mealDistributionNeutral', 'growthBurnInAnchor']) expect(r.meta.assumptions).toContain(a);
    expect(runEngine(profile, compileSchedule(repeatSchedule(3, [0]), profile), { record: 'none' }, STUB_MODULES).meta.assumptions ?? []).not.toContain('growthBurnInAnchor');
  });
});
