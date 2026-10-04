// @vitest-environment node
import { captureInitialSnapshot, runEngine, simulate, simulateEnsemble } from '../loop';
import { compileSchedule, habitualWeek } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { MODULES, checkWiring } from '../moduleRegistry';
import { buildModelParams, validateParamDefs } from '../paramsRegistry';
import { N_SERIES, SERIES, SIGNAL_MIRRORS } from '../../types/metrics';
import type { AnyEngineModule } from '../../types/module';
import { SIGNAL_DEFS } from '../../types/signals';
import { MAN, repeatSchedule } from './fixtures';
import { STUB_MODULES, stubSpy } from './stubModules';
import { measureUnderLoad } from '../../testing/benchLoad';

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

  it('detects a module that moves fat mass outside the energy ledger', () => {
    const leaky = MODULES.map((m) =>
      m.id !== 'composition' ? m : { ...m, stepHour: (s: object, k: object, bus: Parameters<typeof m.stepHour>[2], h: Parameters<typeof m.stepHour>[3], d: Parameters<typeof m.stepHour>[4], c: Parameters<typeof m.stepHour>[5]) => {
        m.stepHour(s, k, bus, h, d, c);
        bus.fatMassKg += 1e-6;
      } },
    );
    const r = runEngine(profile, sched180, { checks: true, record: 'none' }, leaky);
    expect(r.meta.checks!.storageMaxAbsKcal).toBeGreaterThan(1e-3);
  });
});
