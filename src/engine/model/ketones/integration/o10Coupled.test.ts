/**
 * Integration (integrator A2, goal 4): invariant O-10 for the ketone model in the COUPLED engine. The hourly inputs the
 * ketones module sees in a full-engine run (liver glycogen and capacity, exercise-driven muscle-glycogen deficit,
 * insulin, protein/MCT/exogenous-ketone appearance, exercise, 24-h intake, TDEE, body scale) are captured with a spy and
 * replayed twice: (a) through `stepKetones` (must reproduce the engine's BHB exactly) and (b) through a 5-min explicit
 * Euler integration of the same 05 §4.17 equations with the inputs held over the hour (liver glycogen linear within the
 * hour, as the module's hour-mid value assumes). MODEL_SPEC §9.1 O-10 tolerance: 0.05 mM or 5 % (2 % of state).
 * Scenario: lean man, 3-day water-only fast, broken by a 110-g carbohydrate meal, with a 60-min run on day 1 of the fast
 * and a 25-g ketone ester 2 days after refeeding (fasted, 06:00).
 */
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../../core/moduleRegistry';
import { compileSchedule } from '../../../core/compileSchedule';
import { resolveProfile } from '../../../core/resolveProfile';
import { runEngine } from '../../../core/loop';
import { buildModelParams } from '../../../core/paramsRegistry';
import { createSignalBus, type SignalBus } from '../../../types/signals';
import type { AnyEngineModule, EventSink, ModuleContext } from '../../../types/module';
import { bhbFromTkb, initKetones, prepareKetones, stepKetones, syncCapacity, type KetonesConst } from '../index';
import { kitSchedule, neutral, program, waterDay } from './engineKit';
import { PEOPLE } from './targets';
import type { DayTemplate } from '../../../types/schedule';

const IN_KEYS = [
  'liverGlycogenG', 'liverGlycogenMaxG', 'muscleGlycogenExDefFrac', 'insulinRefRel', 'raProtGH', 'raMctGH', 'exoKetoneMmolH',
  'exIntensityFrac', 'exMinutesH', 'kcalEaten24', 'carbAbs24G', 'tdeeEstKcalD', 'ffmActKg', 'tissueMassKg', 'etohPoolG',
] as const;
type InKey = (typeof IN_KEYS)[number];

interface Capture {
  rows: Record<InKey, number>[];
  meal: { start: number; macro: number; exo: number }[];
  bhb: number[];
  initGL: number;
  ctx: ModuleContext;
}

function captureRun(): Capture {
  const person = PEOPLE.leanMan;
  const prof = resolveProfile(person);
  const run: DayTemplate = program('run', 100, neutral('male'), { exercise: [{ kind: 'cardio', modality: 'run', startH: 9, durationMin: 60, pctVo2max: 0.65 }] });
  const brk: DayTemplate = { id: 'brk', label: 'brk', energy: { kind: 'kcal', kcal: 600 }, macros: { protein: { unit: 'g', value: 20 }, carbs: { unit: 'g', value: 110 }, fat: { unit: 'g', value: 13 } }, meals: { meals: [{ clockH: 20, share: 1 }] } };
  const ester: DayTemplate = program('ester', 100, neutral('male'), { substances: { exogenousKetones: [{ clockH: 6, gBhb: 25, form: 'ester' }] } });
  const water: DayTemplate = { ...waterDay(), exercise: [] };
  const waterRun: DayTemplate = { ...waterDay('waterRun'), exercise: [{ kind: 'cardio', modality: 'run', startH: 9, durationMin: 60, pctVo2max: 0.65 }] };
  void run;
  // day 0 dinner 20:00 → water days 1 (with a run), 2 → day 3: water until the 110-g meal at 20:00 → day 4 normal → day 5 ester
  const sched = kitSchedule(7, [program('m', 100, neutral('male')), water, waterRun, brk, ester], (d) => [0, 2, 1, 3, 0, 4, 0][d]!, [{ kind: 'fast', startDay: 0, startH: 20, durationH: 72 }]);
  const compiled = compileSchedule(sched, prof);
  const rows: Record<InKey, number>[] = [];
  const meal: Capture['meal'] = [];
  const bhb: number[] = [];
  let ctxOut: ModuleContext | null = null;
  let initGL = 0;
  const mods = MODULES.map((m) => {
    if (m.id !== 'ketones') return m;
    return {
      ...m,
      prepare: (ctx: ModuleContext) => {
        ctxOut = ctx;
        return m.prepare(ctx);
      },
      init: (k: object, ctx: ModuleContext, bus: SignalBus) => {
        initGL = bus.liverGlycogenG;
        return m.init(k, ctx, bus);
      },
      stepHour: (s: object, k: object, bus: SignalBus, hour: Parameters<AnyEngineModule['stepHour']>[3], day: Parameters<AnyEngineModule['stepHour']>[4], clock: Parameters<AnyEngineModule['stepHour']>[5]) => {
        const b = bus as unknown as Record<string, number>;
        const row = {} as Record<InKey, number>;
        for (const key of IN_KEYS) row[key] = b[key]!;
        rows.push(row);
        meal.push({ start: hour.mealStart, macro: hour.proteinG + hour.carbG + hour.fatG, exo: hour.exoKetoneG });
        m.stepHour(s, k, bus, hour, day, clock);
        bhb.push(bus.bhbMmolL);
      },
    } as AnyEngineModule;
  });
  runEngine(prof, compiled, { mode: 'simulate', record: 'none', burnInDays: 14, checks: false, collectEvents: false }, mods);
  return { rows, meal, bhb, initGL, ctx: ctxOut! };
}

/** Explicit Euler (default 5 min) of the 05 §4.17 ketone equations (the module's constants), inputs held within the hour. */
function eulerKetones(k: KetonesConst, cap: Capture, steps = 12): { bhbMean: number[] } {
  const n = cap.rows.length;
  const dt = 1 / steps; // h
  let T = k.tkb0;
  let F = k.f0;
  let pEw = cap.ctx.profile.habitualProteinG;
  let xPost = 0;
  let aF = cap.ctx.profile.habitualCarbG < k.afInitCarbG ? 1 : 0;
  let aS = 0;
  let gPrev = cap.initGL;
  let postLeft = 0;
  let sinceMeal = 24;
  let doseAge = 1e6;
  let doseFed = 0;
  const out: number[] = [];
  for (let h = 0; h < n; h++) {
    const r = cap.rows[h]!;
    const m = cap.meal[h]!;
    if (m.start > 0 && m.macro > k.mctMealGramThr) sinceMeal = 0;
    else sinceMeal += 1;
    const fedRecent = sinceMeal < k.mctMealWindowH;
    if (m.exo > 0) {
      doseAge = 0;
      doseFed = fedRecent ? 1 : 0;
    } else doseAge += 1;
    const bw = r.tissueMassKg > 1 ? r.tissueMassKg : k.bw0;
    const ffm = r.ffmActKg > 1 ? r.ffmActKg : k.ffm0;
    const vd = k.vdPerBW * bw;
    const ins = r.insulinRefRel;
    const lipo = 1 / (k.lipoA + (1 - k.lipoA) * Math.pow(ins, k.lipoExp));
    const d = r.tdeeEstKcalD > 0 ? Math.max(0, 1 - r.kcalEaten24 / r.tdeeEstKcalD) : 0;
    const exMin = Math.min(60, r.exMinutesH);
    const x = exMin > 0 ? r.exIntensityFrac : 0;
    const deltaM = Math.min(1, Math.max(0, r.muscleGlycogenExDefFrac));
    const afStar = 1 / (1 + Math.pow(r.carbAbs24G / k.c50, k.afHill));
    let mEx = 1;
    const T0 = T;
    // R-KETEX: exercise effects wane with ketonaemia (Hill factor at the hour-start TKB, held for the hour as M_ex is)
    const exAtt = 1 / (1 + Math.pow(T0 / k.exCLTkb, k.exCLHill));
    if (exMin > 0) {
      mEx = 1 + (exMin / 60) * k.exCL * x * exAtt;
      postLeft = k.postDurH;
    } else if (postLeft > 0) {
      mEx = 1 - (1 - k.postCL) * exAtt;
      postLeft -= 1;
    }
    const pExoH = r.exoKetoneMmolH / 60; // mmol/min, hour mean
    let meanT = 0;
    for (let i = 0; i < steps; i++) {
      const frac = (i + 0.5) / steps;
      pEw += ((24 * r.raProtGH - pEw) * dt) / 8;
      xPost = exMin > 0 ? k.exF * x : xPost * Math.exp(-dt / 3);
      const fStar = (k.f0 * lipo * (1 + k.eDef * d) * (1 + xPost * exAtt) * (1 + k.kMgF * deltaM * (1 - d * (1 - exAtt)))) / (1 + T / k.kFB);
      F += ((fStar - F) * dt) / (fStar > F ? 1.0 : 1.5);
      aF += ((afStar - aF) * dt) / (afStar > aF ? 48 : 40);
      const asStar = Math.min(1, Math.max(0, (T - k.asLo) / k.asSpan));
      aS += ((asStar - aS) * dt) / 120;
      const gL = gPrev + (r.liverGlycogenG - gPrev) * frac;
      const gr = gL / k.g50G;
      const phi = (k.phiMin + (1 - k.phiMin) / (1 + Math.pow(gr, k.nG))) * (1 + k.aH * aF) * (1 + k.aHs * aS);
      let P = k.kP * ffm * (F + k.fHep) * phi / (1 + k.kIHep * ins) * Math.exp((-k.kProt * pEw) / k.pRef);
      if (r.etohPoolG > 0) P *= 1 - k.etohProdCut;
      if (r.raMctGH > 0) P += ((fedRecent ? k.mctMealFactor : 1) * (k.yC8 * k.mmolFaPerGC8 * k.mctC8Share + k.yC10 * k.mmolFaPerGC10 * (1 - k.mctC8Share)) * r.raMctGH) / 60;
      // exogenous appearance within the hour follows the module's gamma(2) quarter weights (the amount is intake's)
      let pExo = pExoH;
      if (pExoH > 0 && doseAge < 12) pExo = pExoH * 4 * k.exoW[(doseFed * 12 + doseAge) * 4 + Math.min(3, Math.floor((4 * i) / steps))]!;
      const U = ((k.clFFM * ffm * k.km * T) / (k.km + T)) * mEx * (1 - k.aM * aS);
      const Ren = k.renal * bw * Math.max(0, T - k.tThr);
      const Tn = Math.max(k.tkbFloor, T + ((P + pExo - U - Ren) * dt * 60) / vd);
      meanT += 0.5 * (T + Tn) / steps;
      T = Tn;
    }
    gPrev = r.liverGlycogenG;
    out.push(bhbFromTkb(k, meanT));
  }
  return { bhbMean: out };
}

describe('O-10 in the coupled engine: hourly ketone integrator vs a 5-min Euler reference on the engine’s own inputs', () => {
  const cap = captureRun();
  it('replaying the captured inputs through stepKetones reproduces the engine exactly', () => {
    const k = prepareKetones(cap.ctx);
    const bus = createSignalBus();
    bus.liverGlycogenG = cap.initGL;
    bus.liverGlycogenMaxG = cap.rows[0]!.liverGlycogenMaxG;
    const sink: EventSink = { emit: () => {} };
    const s = initKetones(k, cap.ctx, bus);
    let worst = 0;
    for (let h = 0; h < cap.rows.length; h++) {
      const b = bus as unknown as Record<string, number>;
      for (const key of IN_KEYS) b[key] = cap.rows[h]![key];
      if (h % 24 === 0) syncCapacity(k, bus);
      stepKetones(s, k, bus, cap.meal[h]!.start, cap.meal[h]!.macro, cap.meal[h]!.exo, h, sink);
      worst = Math.max(worst, Math.abs(bus.bhbMmolL - cap.bhb[h]!));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  // The literal 5-min Euler is itself not converged when the pool collapses on refeeding (clearance t½ ≈ 20 min: −8 % at
  // the hour after a 110-g meal), so the tolerance is checked against the converged Euler (30-s steps), as the module's
  // own O-10 test does for the ester (Δt = 5 s); the 5-min difference is reported.
  it('hour-mean BHB within 0.05 mM or 5 % of the converged Euler integration (burn-in, fast, exercise, refeeding exit, ester)', () => {
    const k = prepareKetones(cap.ctx);
    k.gLMaxG = cap.rows[0]!.liverGlycogenMaxG;
    k.g50G = k.g50Frac * k.gLMaxG;
    const burn = cap.rows.length - 7 * 24;
    const worstOf = (ref: number[]): { z: number; at: number } => {
      let z = 0;
      let at = -1;
      for (let h = burn - 48; h < cap.rows.length; h++) {
        const e = Math.abs(cap.bhb[h]! - ref[h]!) / Math.max(0.05, 0.05 * ref[h]!);
        if (e > z) {
          z = e;
          at = h - burn;
        }
      }
      return { z, at };
    };
    const conv = worstOf(eulerKetones(k, cap, 120).bhbMean);
    const five = worstOf(eulerKetones(k, cap, 12).bhbMean);
    console.info(`[O-10 coupled] worst |hourly − Euler| / max(0.05 mM, 5 %): converged ${conv.z.toFixed(2)} (hour ${conv.at}), 5-min ${five.z.toFixed(2)} (hour ${five.at})`);
    expect(conv.z).toBeLessThanOrEqual(1);
  });
});

void buildModelParams;
