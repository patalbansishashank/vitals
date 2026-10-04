/**
 * Test support for the composition module (used only by *.test.ts in this folder).
 *
 * Drives `compositionModule` directly with a hand-built SignalBus and DayInput (WP_BRIEF: other modules may be stubs),
 * plus two reference energy models used as test oracles:
 *  - `bwp()`: the Hall 2011 Body Weight Planner port of 01 §4.12 (Python reference, DERIVED) — oracle O-1/O-2;
 *  - `hallEnergyHarness`: the same Hall 2011 expenditure/glycogen/ECF equations, but with FM/LT supplied by the
 *    composition module (so the only difference to `bwp()` is the partition rule);
 *  - `surplusHarness`: the 11 §4.15 rule-set expenditure (TEF by macro, TH_C, AT_OF, glycogen cap, DNL overflow) with the
 *    composition module doing the partition — reproduces the dossier's prototype table.
 */
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import type { DayInput } from '../../types/inputs';
import type { ModuleContext, StepClock } from '../../types/module';
import { createSignalBus, type SignalBus } from '../../types/signals';
import { N_SERIES } from '../../types/metrics';
import { buildModelParams } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import { habitualDay } from '../../core/compileSchedule';
import type { AnyEngineModule } from '../../types/module';
import { compositionModule, type CompositionK, type CompositionState } from './index';

export interface Rig {
  ctx: ModuleContext;
  k: CompositionK;
  s: CompositionState;
  bus: SignalBus;
  day: DayInput;
  clock: StepClock;
  profile: ResolvedProfile;
  /** Events emitted by the module: [type, hourIndex, value]. */
  events: [string, number, number][];
}

export const PERSON_MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 },
  startDate: '2026-10-05',
};

/** Build a rig. `overrides` replaces fields of the resolved profile (e.g. fm0Kg/ffm0Kg for oracle scenarios). */
export function makeRig(
  person: PersonProfile = PERSON_MAN,
  opts: { regional?: boolean; paramOverrides?: Record<string, number>; profile?: Partial<ResolvedProfile> } = {},
): Rig {
  const base = resolveProfile(person);
  const profile: ResolvedProfile = { ...base, ...(opts.profile ?? {}) };
  const modules = [compositionModule] as unknown as readonly AnyEngineModule[];
  const mp = buildModelParams(modules);
  let params = mp;
  if (opts.paramOverrides) {
    const v = new Float64Array(mp.values);
    for (const [id, x] of Object.entries(opts.paramOverrides)) {
      const i = mp.index.get(id);
      if (i === undefined) throw new Error(`unknown param ${id}`);
      v[i] = x;
    }
    params = { ...mp, values: v };
  }
  const seriesEnabled = new Uint8Array(N_SERIES).fill(opts.regional === false ? 0 : 1);
  const events: [string, number, number][] = [];
  const schedule: ModuleContext['schedule'] = { nDays: 1, startDate: '2026-10-05', startWeekday: 0, days: [], fastSpans: [], notes: [] };
  const ctx: ModuleContext = {
    profile,
    params,
    schedule,
    nDays: 1,
    mode: 'simulate',
    seriesEnabled,
    events: { emit: (type, hourIndex, value) => void events.push([type, hourIndex, value]) },
    checks: true,
    safetyTrace: {} as ModuleContext['safetyTrace'],
  };
  const bus = createSignalBus();
  bus.ageYears = profile.ageYears;
  bus.tdeeEstKcalD = profile.tdee0Kcal;
  bus.maintenanceKcalD = profile.tdee0Kcal;
  const k = compositionModule.prepare(ctx);
  const s = compositionModule.init(k, ctx, bus);
  const day = habitualDay(profile);
  const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  return { ctx, k, s, bus, day, clock, profile, events };
}

/** Set today's planned intake on the rig's DayInput (engine energy convention; protein g, carbs g, fat g). */
export function setIntake(r: Rig, kcal: number, proteinG: number, carbG?: number): void {
  const d = r.day;
  d.energyKcal = kcal;
  d.proteinG = proteinG;
  const c = carbG ?? Math.max(0, (0.5 * kcal) / 4);
  d.carbG = c;
  d.fatG = Math.max(0, (kcal - 4 * proteinG - 4 * c) / 9);
  d.satFatG = 0.32 * d.fatG;
  d.pufaG = 0.23 * d.fatG;
  d.mufaG = 0.34 * d.fatG;
  d.fastHours = 0;
  d.zeroIntake = false;
}

/**
 * Run one day: startDay, 24 hours with the hourly fluxes produced by `hourFlux(h)` (which writes eAbs/teePre/... on the
 * bus), endOfDay. Returns the day's Σ S_h and Σ deposition cost, kcal.
 */
export function runDay(r: Rig, hourFlux: (h: number, bus: SignalBus) => void): { sumS: number; sumDep: number; maxHourResid: number } {
  const m = compositionModule;
  m.startDay(r.s, r.k, r.bus, r.day, r.clock);
  let sumS = 0;
  let sumDep = 0;
  let maxHourResid = 0;
  for (let h = 0; h < 24; h++) {
    r.clock.hourOfDay = h;
    r.clock.hourIndex = r.clock.day * 24 + h;
    hourFlux(h, r.bus);
    const fm0 = r.s.fmKg;
    const lt0 = r.s.ltKg;
    m.stepHour(r.s, r.k, r.bus, undefined as never, r.day, r.clock);
    const b = r.bus;
    const sh = b.eAbsKcalH - b.teePreKcalH - b.dnlHeatKcalH - b.ketoneLossKcalH - b.glycogenChangeKcalH;
    const stored = r.k.effF * (r.s.fmKg - fm0) + r.k.effL * (r.s.ltKg - lt0);
    maxHourResid = Math.max(maxHourResid, Math.abs(sh - stored), Math.abs(b.tissueEnergyKcalH - stored));
    sumS += sh;
    sumDep += b.depositionCostKcalH;
  }
  m.endOfDay(r.s, r.k, r.bus, r.day, r.clock);
  // the core calls endBurnIn once after day −1's endOfDay (MODEL_SPEC §3.4)
  if (r.clock.day === -1) m.endBurnIn!(r.s, r.k, r.bus, r.ctx);
  r.clock.day += 1;
  return { sumS, sumDep, maxHourResid };
}

/** Constant-flux hour writer: tissue energy S/24 per hour on top of a fixed TEE. */
export function flatFlux(eiKcalD: number, teeKcalD: number, extra?: (h: number, bus: SignalBus) => void) {
  return (h: number, bus: SignalBus): void => {
    bus.eAbsKcalH = eiKcalD / 24;
    bus.teePreKcalH = teeKcalD / 24;
    bus.dnlHeatKcalH = 0;
    bus.ketoneLossKcalH = 0;
    bus.glycogenChangeKcalH = 0;
    if (extra) extra(h, bus);
  };
}

/** Meal-shaped flux: all intake in hours 8-19 (12 equal hours), TEE flat — hourly S_h changes sign within the day. */
export function mealFlux(eiKcalD: number, teeKcalD: number) {
  return (h: number, bus: SignalBus): void => {
    bus.eAbsKcalH = h >= 8 && h < 20 ? eiKcalD / 12 : 0;
    bus.teePreKcalH = teeKcalD / 24;
    bus.dnlHeatKcalH = 0;
    bus.ketoneLossKcalH = 0;
    bus.glycogenChangeKcalH = 0;
  };
}

// ================================================================== Hall 2011 BWP port (01 §4.12), MJ / kg / d

export interface BwpOut {
  t: number;
  BW: number;
  F: number;
  L: number;
}

export interface BwpPerson {
  sex: 'm' | 'f';
  BW0: number;
  H: number;
  age: number;
  PAL?: number;
}

const MJ = 239.0057; // kcal per MJ

/** Jackson 2002 initial fat mass (01 §4.2.3). */
export function jacksonFat(p: BwpPerson): number {
  const bmi = p.BW0 / (p.H * p.H);
  return (p.BW0 / 100) * (0.14 * p.age + (p.sex === 'm' ? 37.31 : 39.96) * Math.log(bmi) - (p.sex === 'm' ? 103.94 : 102.01));
}

/** Hall 2011 constants shared by `bwp` and `hallEnergyHarness` (01 §4.12). */
export function bwpSetup(p: BwpPerson, carbfrac = 0.5) {
  const rhoG = 17.6;
  const gF = 0.013;
  const gL = 0.092;
  const bTEF = 0.1;
  const bAT = 0.14;
  const tauAT = 14.0;
  const hG = 2.7;
  const Na = 3.22;
  const xiNa = 3000;
  const xiCI = 4000;
  const PAL = p.PAL ?? 1.5;
  const F0 = jacksonFat(p);
  const rmr = (10 * p.BW0 + 6.25 * p.H * 100 - 5 * p.age + (p.sex === 'm' ? 5 : -161)) * 4.184e-3;
  const delta = (((1 - bTEF) * PAL - 1) * rmr) / p.BW0;
  const EI0 = PAL * rmr;
  const G0 = 0.5;
  const ECF0 = 0.2 * p.BW0;
  const L0 = p.BW0 - F0 - ECF0 - G0 * (1 + hG);
  const CIb = carbfrac * EI0;
  const kG = CIb / (G0 * G0);
  const K = EI0 - (gF * F0 + gL * L0 + delta * p.BW0);
  return { rhoG, gF, gL, bTEF, bAT, tauAT, hG, Na, xiNa, xiCI, PAL, F0, rmr, delta, EI0, G0, ECF0, L0, CIb, kG, K, carbfrac };
}

/** 01 §4.12 reference implementation (Euler, dt = 0.05 d). EI in MJ/d. */
export function bwp(p: BwpPerson, EIfn: (t: number) => number, days: number, dt = 0.05): BwpOut[] {
  const c = bwpSetup(p);
  const rhoF = 39.5;
  const rhoL = 7.6;
  const etaF = 0.75;
  const etaL = 0.96;
  const C = (10.4 * rhoL) / rhoF;
  let F = c.F0;
  let L = c.L0;
  let G = c.G0;
  let ECF = c.ECF0;
  let AT = 0;
  const out: BwpOut[] = [];
  const n = Math.round(days / dt);
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    const EI = EIfn(t);
    const CI = c.carbfrac * EI;
    const dEI = EI - c.EI0;
    const BW = F + L + G * (1 + c.hG) + ECF;
    if (Math.abs(t - Math.round(t)) < 1e-9) out.push({ t: Math.round(t), BW, F, L });
    const dG = (CI - c.kG * G * G) / c.rhoG;
    const pp = C / (C + F);
    const s = (pp * etaL) / rhoL + ((1 - pp) * etaF) / rhoF;
    const EE = (c.K + c.gF * F + c.gL * L + c.delta * BW + c.bTEF * dEI + AT + (EI - c.rhoG * dG) * s) / (1 + s);
    const dF = ((1 - pp) * (EI - EE - c.rhoG * dG)) / rhoF;
    const dL = (pp * (EI - EE - c.rhoG * dG)) / rhoL;
    const dECF = (-c.xiNa * (ECF - c.ECF0) - c.xiCI * (1 - CI / c.CIb)) / (c.Na * 1000);
    const dAT = (c.bAT * dEI - AT) / c.tauAT;
    F += dF * dt;
    L += dL * dt;
    G += dG * dt;
    ECF += dECF * dt;
    AT += dAT * dt;
  }
  return out;
}

/**
 * Same Hall 2011 expenditure, glycogen and ECF equations as `bwp`, but the fat/lean split is the composition module's
 * (driven hourly through the bus). `proteinFrac` = protein share of intake energy (macronutrient-neutral scenarios keep it
 * constant). Returns daily BW (kg) = FM + LT-derived lean + glycogen·(1 + h) + ECF on the BWP's absolute scale.
 */
export function hallEnergyHarness(
  p: BwpPerson,
  EIfn: (t: number) => number,
  days: number,
  proteinFrac: (t: number) => number,
  opts: { rtRetentionFrac?: number } = {},
): { BW: number[]; F: number[]; L: number[]; rig: Rig } {
  const c = bwpSetup(p);
  const person: PersonProfile = {
    schemaVersion: 1,
    body: { sex: p.sex === 'm' ? 'male' : 'female', ageYears: p.age, heightCm: p.H * 100, weightKg: p.BW0 },
    startDate: '2026-10-05',
  };
  const ffm0 = p.BW0 - c.F0;
  const r = makeRig(person, { regional: false, profile: { fm0Kg: c.F0, ffm0Kg: ffm0 } });
  const lt0 = r.s.ltKg;
  let G = c.G0;
  let ECF = c.ECF0;
  let AT = 0;
  const BWs: number[] = [];
  const Fs: number[] = [];
  const Ls: number[] = [];
  const sub = 24; // hourly
  const dt = 1 / sub;
  for (let d = 0; d < days; d++) {
    const EI = EIfn(d);
    const EIk = EI * MJ;
    const CI = c.carbfrac * EI;
    const dEI = EI - c.EI0;
    // day plan for composition: planned intake and a TEE estimate (current expenditure incl. AT)
    const F = r.s.fmKg;
    const Lh = c.L0 + (r.s.ltKg - lt0);
    const BW = F + Lh + G * (1 + c.hG) + ECF;
    const teeEst = (c.K + c.gF * F + c.gL * Lh + c.delta * BW + c.bTEF * dEI + AT) * MJ;
    setIntake(r, EIk, (proteinFrac(d) * EIk) / 4);
    r.bus.tdeeEstKcalD = teeEst;
    r.bus.rtRetentionFrac = opts.rtRetentionFrac ?? 0;
    runDay(r, (_h, bus) => {
      const Fh = r.s.fmKg;
      const Lc = c.L0 + (r.s.ltKg - lt0);
      const BWh = Fh + Lc + G * (1 + c.hG) + ECF;
      const dG = (CI - c.kG * G * G) / c.rhoG; // kg/d
      const EEpre = c.K + c.gF * Fh + c.gL * Lc + c.delta * BWh + c.bTEF * dEI + AT; // MJ/d (no η: composition books it)
      bus.eAbsKcalH = (EI * MJ) / 24;
      bus.teePreKcalH = (EEpre * MJ) / 24;
      bus.glycogenChangeKcalH = (c.rhoG * dG * MJ) / 24;
      bus.dnlHeatKcalH = 0;
      bus.ketoneLossKcalH = 0;
      const dECF = (-c.xiNa * (ECF - c.ECF0) - c.xiCI * (1 - CI / c.CIb)) / (c.Na * 1000);
      G += dG * dt;
      ECF += dECF * dt;
      AT += ((c.bAT * dEI - AT) / c.tauAT) * dt;
    });
    const Lc = c.L0 + (r.s.ltKg - lt0);
    BWs.push(r.s.fmKg + Lc + G * (1 + c.hG) + ECF);
    Fs.push(r.s.fmKg);
    Ls.push(Lc);
  }
  return { BW: BWs, F: Fs, L: Ls, rig: r };
}

// ================================================================== 11 §4.15 surplus rule-set harness

export interface SurplusStudy {
  name: string;
  sex: 'm' | 'f';
  BW0: number;
  H: number;
  age: number;
  fm0: number;
  /** Baseline (weight-stable) intake, kcal/d. */
  ei0: number;
  /** Intake on overfeeding days, kcal/d, and macro shares of that intake (P, F, C energy fractions). */
  eiOver: number;
  shares: [number, number, number];
  /** Baseline macro shares (default = the overfeeding shares). */
  shares0?: [number, number, number];
  days: number;
  /** Overfed on day d? (default: every day). */
  overfedOn?: (d: number) => boolean;
}

/**
 * 11 §4.15 steps 1-6 (Hall 2011 constants, sedentary δ = 7 kcal/kg/d, TEF_P/C/F 0.25/0.075/0.025, φ_C 0.10, β_OF 0.12,
 * τ_OF 14 d, G_max = 0.015·BW, w_G 2.7, y_DNL 0.32) with the composition module doing step 7 (partition). Daily
 * expenditure, glycogen sub-stepped at 1 h. Returns ΔBW = ΔFM + ΔLT + ΔG·(1 + w_G) (gut/ECF excluded, as the prototype),
 * plus the stored share of the excess energy.
 */
export function surplusHarness(st: SurplusStudy): { dBW: number; dFM: number; dLT: number; storedPct: number; rig: Rig } {
  const person: PersonProfile = {
    schemaVersion: 1,
    body: { sex: st.sex === 'm' ? 'male' : 'female', ageYears: st.age, heightCm: st.H * 100, weightKg: st.BW0 },
    startDate: '2026-10-05',
  };
  const r = makeRig(person, { regional: false, profile: { fm0Kg: st.fm0, ffm0Kg: st.BW0 - st.fm0 } });
  const gF = 3.1;
  const gL = 22;
  const delta = 7;
  const tef = (pp: number, f: number, cc: number, ei: number) => ei * (0.25 * pp + 0.025 * f + 0.075 * cc);
  const s0 = st.shares0 ?? st.shares;
  const lt0 = r.s.ltKg;
  const fm0 = r.s.fmKg;
  const choRef = (s0[2] * st.ei0) / 4;
  // glycogen: Hall quadratic sink normalised to the baseline carbohydrate intake, capped at G_max (11 §4.3)
  const G0 = 0.5;
  const kG = (4 * choRef) / 4207 / (G0 * G0); // kg/d per kg² (ρG dG/dt = CI − kG·G²)
  let G = G0;
  let AT = 0;
  const bw0 = st.BW0;
  const K = st.ei0 - (gF * fm0 + gL * lt0 + delta * bw0) - tef(s0[0], s0[1], s0[2], st.ei0);
  let excess = 0;
  let stored = 0;
  for (let d = 0; d < st.days; d++) {
    const over = st.overfedOn ? st.overfedOn(d) : true;
    const ei = over ? st.eiOver : st.ei0;
    const sh = over ? st.shares : s0;
    const eP = sh[0] * ei;
    const eF = sh[1] * ei;
    const eC = sh[2] * ei;
    const bw = r.s.fmKg + r.s.ltKg - lt0 + (bw0 - fm0) + (G - G0) * 3.7;
    const eeBase = K + gF * r.s.fmKg + gL * r.s.ltKg + delta * bw;
    const thC = ei > st.ei0 ? 0.1 * Math.max(0, eC - 4 * choRef) : 0;
    AT += (0.12 * Math.max(0, ei - st.ei0) - AT) / 14;
    let eePre = eeBase + tef(sh[0], sh[1], sh[2], ei) + thC + AT;
    // glycogen over the day (hourly sub-steps), overflow to DNL
    const gMax = 0.015 * bw;
    let dGday = 0;
    for (let h = 0; h < 24; h++) {
      let dG = (eC / 4207 - kG * G * G) / 24; // kg per hour (energy in kcal/d → kg glycogen/d at 4207 kcal/kg)
      if (G + dG > gMax) dG = Math.max(0, gMax - G);
      G += dG;
      dGday += dG;
    }
    const cRoom = Math.max(0, (eePre - 0 - eP) / 4);
    const cOver = Math.max(0, eC / 4 - cRoom - (4207 * dGday) / 4);
    const dnl = 0.32 * cOver;
    const cDnl = 4 * cOver - 9.44 * dnl;
    eePre += cDnl;
    setIntake(r, ei, eP / 4, eC / 4);
    r.day.fatG = eF / 9;
    r.day.satFatG = 0.32 * r.day.fatG;
    r.day.pufaG = 0.23 * r.day.fatG;
    r.bus.tdeeEstKcalD = eePre - cDnl;
    const glyK = 4207 * dGday;
    runDay(r, (_h, bus) => {
      bus.eAbsKcalH = ei / 24;
      bus.teePreKcalH = (eePre - cDnl) / 24;
      bus.dnlHeatKcalH = cDnl / 24;
      bus.glycogenChangeKcalH = glyK / 24;
      bus.ketoneLossKcalH = 0;
    });
    if (over) {
      excess += ei - st.ei0;
      stored += ei - eePre;
    }
  }
  const dFM = r.s.fmKg - fm0;
  const dLT = r.s.ltKg - lt0;
  return { dBW: dFM + dLT + (G - G0) * 3.7, dFM, dLT, storedPct: excess > 0 ? (100 * stored) / excess : 0, rig: r };
}
