// @vitest-environment node
/**
 * D2-05 / D1-05 (contracts C3/C4/C7): the fasting N model's boundary and ledger. Urinary N (a prior, g N/d), body protein,
 * model lean tissue, skeletal muscle and scale mass are distinct quantities; in a water fast the tissue N change equals the
 * urinary-N prior (dN_body = N_absorbed − N_urine − N_other with N_absorbed = 0, no second fecal subtraction); repletion
 * needs dietary protein and is held — not denied — when protein is unknown; refeeding safety never reads the oedema
 * scenario.
 */
import { describe, expect, it } from 'vitest';
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import type { AnyEngineModule } from '../../types/module';
import type { PersonProfile } from '../../types/profile';
import type { RunOptions } from '../../types/result';
import type { DayTemplate, Schedule } from '../../types/schedule';
import { kitPerson, kitSchedule, neutral, program, waterDay } from '../ketones/integration/engineKit';
import {
  FASTING_NITROGEN_BOUNDARY,
  FASTING_PARAMS,
  fastingConstants,
  fastingInitialState,
  fastingNitrogenLedger,
  fastingStepHour,
  REPLETION_GATE,
  type FastingBus,
  type FastingState,
} from './index';

const MAN = kitPerson({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 78, bodyFatPct: 16 });

interface Captured {
  /** Fasting-module urinary-N ledger at the end of each day (completed-day total read at the next day's first hour). */
  urinaryNByDay: number[];
  states: FastingState[];
  result: ReturnType<typeof runEngine>;
}

/** Full engine with a spy on the fasting module: the urinary-N total of each completed day. */
function run(person: PersonProfile, schedule: Schedule, params: Record<string, number> = {}): Captured {
  const profile = resolveProfile(person);
  const compiled = compileSchedule(schedule, profile);
  const byDay: number[] = [];
  const states: FastingState[] = [];
  const mods: AnyEngineModule[] = MODULES.map((m) => {
    if (m.id !== 'fasting') return m;
    const inner = m.stepHour.bind(m);
    return {
      ...m,
      stepHour: (s: object, k: object, bus: Parameters<AnyEngineModule['stepHour']>[2], hour: Parameters<AnyEngineModule['stepHour']>[3], day: Parameters<AnyEngineModule['stepHour']>[4], clock: Parameters<AnyEngineModule['stepHour']>[5]) => {
        inner(s, k, bus, hour, day, clock);
        const fs = s as FastingState;
        if (clock.hourOfDay === 23 && clock.day >= 0) byDay[clock.day] = fs.uNTodayG;
        if (clock.hourOfDay === 23 && clock.day >= 0) states[clock.day] = { ...fs, ring: fs.ring.slice() };
      },
    } as AnyEngineModule;
  });
  const options: RunOptions = { mode: 'simulate', record: 'daily', burnInDays: 14, checks: true, collectEvents: true };
  if (Object.keys(params).length) {
    const base = buildModelParams(mods);
    const v = new Float64Array(base.values);
    for (const [id, val] of Object.entries(params)) v[base.index.get(id)!] = val;
    options.paramOverrides = v;
  }
  const result = runEngine(profile, compiled, options, mods);
  return { urinaryNByDay: byDay, states, result };
}

/** Day 0 normal, days 1-4 water only (dinner→dinner fast from day 0 20:00), days 5-9 normal refeed. */
function fastSchedule(): Schedule {
  const water = waterDay();
  return kitSchedule(10, [program('m', 100, neutral('male')), water], (d) => (d >= 1 && d <= 4 ? 1 : 0), [{ kind: 'fast', startDay: 0, startH: 20, durationH: 96 }]);
}

describe('nitrogen boundary and conversions are declared, not re-derived', () => {
  it('body excluding the GI lumen, reported-ME intake, no second fecal-N subtraction, approximate conversions', () => {
    expect(FASTING_NITROGEN_BOUNDARY.system).toBe('bodyExcludingGutLumen');
    expect(FASTING_NITROGEN_BOUNDARY.intakeBoundary).toBe('reportedME');
    expect(FASTING_NITROGEN_BOUNDARY.balance).toBe('dN_body = N_absorbed - N_urine - N_otherEndogenous');
    expect(FASTING_NITROGEN_BOUNDARY.proteinPerN.status).toBe('approximation');
    expect(FASTING_NITROGEN_BOUNDARY.urinaryNitrogen.operator).toBe('urinaryNitrogen');
    expect(FASTING_NITROGEN_BOUNDARY.skeletalMuscle).toBe(false);
    expect(FASTING_NITROGEN_BOUNDARY.oedema.refeedSafetyInput).toBe(false);
  });
  it('labile pool, repletion and oedema constants are labelled structural scenarios, never measured constants', () => {
    for (const n of ['lMax', 'tauRep', 'aOed', 'repEnergyFrac', 'repProteinGPerKg']) {
      const p = FASTING_PARAMS.find((x) => x.id === `fasting.${n}`)!;
      expect(p.distribution!.uncertaintyKind, n).toBe('scenario');
      expect(p.distribution!.basis, n).toMatch(/not a measured constant/);
    }
    expect(FASTING_PARAMS.find((x) => x.id === 'fasting.hP')!.distribution!.basis).toMatch(/approximation/);
  });
});

describe('water fast in the full engine: urinary N, tissue N, lean tissue, skeletal muscle and scale are distinct', () => {
  const c = run(MAN, fastSchedule());
  const d = c.result.daily;
  it('tissue N change equals the urinary-N prior on full fast days (N_absorbed = 0; no other loss counted twice)', () => {
    for (const day of [2, 3, 4]) {
      const uN = c.urinaryNByDay[day]!;
      const tissueN = d.nitrogenBalance![day]!;
      expect(uN, `day ${day}`).toBeGreaterThan(5);
      // composition books the same protein flux as lean tissue; residual = explicit lean terms (age drift) only
      expect(Math.abs(-tissueN - uN) / uN, `day ${day}: tissue ${tissueN} vs urinary ${uN}`).toBeLessThan(0.02);
    }
  });
  it('the ledger closes: protein oxidised = 6.25 × urinary N; net protein = oxidised − repleted', () => {
    const s = c.states[9]!;
    const l = fastingNitrogenLedger(s);
    expect(l.proteinOxidisedG).toBeCloseTo(6.25 * l.urinaryNCumG, 6);
    expect(l.netProteinG).toBeCloseTo(l.proteinOxidisedG - l.proteinRepletedG, 9);
    expect(l.proteinRepletedG).toBeGreaterThan(0); // adequate refeed with dietary protein repletes part of the labile deficit
    expect(l.proteinRepletedG).toBeLessThanOrEqual(l.proteinOxidisedG);
  });
  it('a urinary-N spike is not skeletal-muscle loss: lean tissue, skeletal muscle and scale mass move by different amounts', () => {
    const dLt = d.leanTissue![4]! - d.leanTissue![0]!;
    const dSm = d.skeletalMuscle![4]! - d.skeletalMuscle![0]!;
    const dScale = d.scaleWeight![4]! - d.scaleWeight![0]!;
    const proteinFromN = (6.25 * (c.urinaryNByDay[1]! + c.urinaryNByDay[2]! + c.urinaryNByDay[3]! + c.urinaryNByDay[4]!)) / 1000; // kg protein
    expect(dLt).toBeLessThan(0);
    expect(Math.abs(dSm)).toBeLessThan(Math.abs(dLt)); // model SM takes only part of the lean change
    expect(Math.abs(dScale)).toBeGreaterThan(Math.abs(dLt)); // scale also carries glycogen, water and gut contents
    expect(Math.abs(dLt)).toBeGreaterThan(proteinFromN); // lean tissue = protein × (1 + h_P): not the protein mass itself
  });
});

describe('repletion needs substrate; unknown protein holds the deficit (D1-05)', () => {
  function rig(): { s: FastingState; k: ReturnType<typeof fastingConstants>; bus: FastingBus } {
    const k = fastingConstants(buildModelParams(MODULES), { ffm0Kg: 60, nHours: 48 });
    const s = fastingInitialState({ tdee0Kcal: 2500, habitualProteinG: 90, habitualCarbG: 250 });
    const bus: FastingBus = {
      bhbMmolL: 0.1, bhbEndoMmolL: 0.1, maintenanceKcalD: 2500, tdeeEstKcalD: 2500, fatMassKg: 15, ffmActKg: 60,
      fastActive: 0, fastHoursH: 0, fastRmrMult: 1, fastProtOxGH: 0, fastRepletionGH: 0, fastOedemaL: 0,
    };
    s.dLabG = 40;
    return { s, k, bus };
  }
  it('adequate energy and known protein: repletes, never faster than the window\'s dietary protein supply', () => {
    const { s, k, bus } = rig();
    fastingStepHour(s, k, bus, 2500 / 24, 90 / 24, 250 / 24, 0, 2000, 250, 0, 0);
    expect(s.repGate).toBe(REPLETION_GATE.repleting);
    expect(bus.fastRepletionGH).toBeGreaterThan(0);
    expect(bus.fastRepletionGH).toBeLessThanOrEqual(s.protein24 / 24 + 1e-12);
  });
  /** 24 h of a low known-protein day first (the habitual ring rolls out), then the labile deficit appears. */
  function lowProteinDay(unknown: 0 | 1) {
    const r = rig();
    r.s.dLabG = 0;
    for (let h = 0; h < 24; h++) fastingStepHour(r.s, r.k, r.bus, 2500 / 24, 20 / 24, 300 / 24, 0, 2000, 300, 0, h, unknown);
    r.s.dLabG = 40;
    for (let h = 24; h < 48; h++) fastingStepHour(r.s, r.k, r.bus, 2500 / 24, 20 / 24, 300 / 24, 0, 2000, 300, 1, h, unknown);
    return r;
  }
  it('known protein below the gate: no repletion (scenario gate), labelled as such', () => {
    const { s } = lowProteinDay(0);
    expect(s.repGate).toBe(REPLETION_GATE.belowGate);
    expect(s.repletedCumG).toBe(0);
    expect(s.repUnknownProteinH).toBe(0);
  });
  it('energy-only intake with unknown protein: the gate is undetermined — the deficit is held and flagged, not called deficient', () => {
    const { s } = lowProteinDay(1);
    expect(s.repGate).toBe(REPLETION_GATE.proteinUnknown);
    expect(s.repUnknownProteinH).toBe(24);
    expect(s.dLabG).toBe(40);
  });
});

describe('refeeding safety is independent of the oedema scenario', () => {
  it('the low and high ends of the oedema amplitude give identical safety warnings and traces; only water moves', () => {
    const sched = (() => {
      const water: DayTemplate = waterDay();
      return kitSchedule(12, [program('m', 100, neutral('male')), water], (d) => (d >= 1 && d <= 5 ? 1 : 0), [{ kind: 'fast', startDay: 0, startH: 20, durationH: 120 }]);
    })();
    const lo = run(MAN, sched, { 'fasting.aOed': 0.03 });
    const hi = run(MAN, sched, { 'fasting.aOed': 0.15 });
    expect(hi.result.warnings).toEqual(lo.result.warnings);
    const firstDiff = (a: Float32Array, b: Float32Array): number => {
      for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
      return -1;
    };
    // fasting/intake/refeed traces are identical; mass-based traces (and protein per kg reference weight) carry the oedema water
    for (const key of ['ei7', 'tdee7', 'deficitPct7', 'ea7', 'fastHMax', 'fastH7', 'fatPctEnergy', 'hungerIdx'] as const) {
      expect(firstDiff(hi.result.safety[key], lo.result.safety[key]), String(key)).toBe(-1);
    }
    // the oedema does move scale weight after the refeed (the scenario is not inert)
    expect(hi.result.daily.scaleWeight![9]!).toBeGreaterThan(lo.result.daily.scaleWeight![9]!);
  });
});
