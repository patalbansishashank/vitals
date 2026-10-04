/**
 * Repair (dossier 18 §4.4.4 steps 5-7; MODEL_SPEC §10.1): user hard constraints, then 17 input-space safety bounds,
 * then consistency, on the decoded Schedule. Every clip is logged as a `RepairEntry` (rule id, path, day, amount); the
 * log feeds the complexity penalty and the "binding constraint" explanations (18 §4.14.2).
 *
 * Runtime-resolved energy is never touched here beyond the planned-energy proxies (planned % of maintenance at the
 * block start ≈ the day's deficit), which keep hopeless genomes out; the simulated trajectory's margins (HC-E1/E3/E4/
 * E5/E6/E8, HC-P4/P5) remain authoritative.
 */
import type { RepairEntry } from '../optim/types';
import type { CardioSession, DayTemplate, ExerciseSession, FastEvent, MacroSpec, ResistanceSession, Schedule, ScheduleDay } from '../../types/schedule';
import { BLOCKS } from './registry/blocks';
import type { PlanningContext } from './context';
import { MIN_MEAL_SPACING_H } from './context';
import { estimateDay, mealClocks, mergeDay, type DayRefs } from './dayMath';
import { placeTraining, type DecodedPlan } from './decode';
import { eatingGapNeedH, eventPeriodDays, fastCoverage, fastEndDay, recoveryDayCount, refeedDayFactors } from './fastMath';
import { HC, fastAllowed, tierForHours } from './safety';
import { CARDIO_BANDS, supplementConsent } from './skeleton';
import { IDEAL_SLEEP, SESSION_BEFORE_BED_H, bedClockOf, mod24, sleepHoursOf } from './ideal';

type Override = NonNullable<ScheduleDay['override']>;

/** Tolerance on planned-energy checks, % of maintenance (rounding of genes). */
const PCT_EPS = 0.05;

export interface ZeroSpan {
  /** Absolute hours [start, end). */
  start: number;
  end: number;
  hours: number;
}

class Editor {
  readonly s: Schedule;
  readonly log: RepairEntry[] = [];
  constructor(schedule: Schedule) {
    this.s = structuredClone(schedule);
  }
  day(d: number): DayTemplate {
    const sd = this.s.days[d]!;
    return mergeDay(this.s.programs[sd.program]!, sd.override);
  }
  patch(d: number, ov: Override): void {
    const sd = this.s.days[d]!;
    const cur = sd.override ?? {};
    const next: Override = { ...cur, ...ov };
    if (ov.macros && cur.macros) next.macros = { ...cur.macros, ...ov.macros } as MacroSpec;
    sd.override = next;
  }
  note(rule: string, extra: Omit<RepairEntry, 'rule'> = {}): void {
    this.log.push({ rule, ...extra });
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function refsOf(ctx: PlanningContext): DayRefs {
  return { maintenanceKcal: ctx.rp.tdee0Kcal, bwKg: ctx.rp.weightKg, ffmKg: ctx.rp.ffm0Kg };
}

/** Hours covered by fast events on each day. */
function eventCoverage(s: Schedule): Float64Array {
  const cov = new Float64Array(s.horizonDays);
  for (const e of s.events ?? []) {
    const a = e.startDay * 24 + e.startH;
    const b = a + e.durationH;
    for (let d = Math.max(0, Math.floor(a / 24)); d <= Math.min(s.horizonDays - 1, Math.floor((b - 1e-9) / 24)); d++)
      cov[d] = cov[d]! + Math.min(b, d * 24 + 24) - Math.max(a, d * 24);
  }
  return cov;
}

/** Zero-intake spans ≥ `minHours` from meal times, zero days and fast events (≤ 50 kcal per intake, 17 §2.5). */
export function zeroSpans(ctx: PlanningContext, s: Schedule, minHours: number = HC.tierMaxH.T0): ZeroSpan[] {
  const refs = refsOf(ctx);
  const T = s.horizonDays;
  const meals: number[] = [];
  const evs = (s.events ?? []).map((e) => [e.startDay * 24 + e.startH, e.startDay * 24 + e.startH + e.durationH] as const);
  for (let d = 0; d < T; d++) {
    const sd = s.days[d]!;
    const t = mergeDay(s.programs[sd.program]!, sd.override);
    const est = estimateDay(t, refs);
    if (est.zero || est.kcal <= HC.zeroKcal) continue;
    const clocks = mealClocks(t);
    const per = est.kcal / Math.max(1, clocks.length);
    if (per <= HC.zeroKcal) continue;
    for (const c of clocks) {
      const h = d * 24 + c;
      // meals strictly inside a fast window are not eaten (last intake at t0 and first at t1 are)
      if (evs.some(([a, b]) => h > a + 1e-6 && h < b - 1e-6)) continue;
      meals.push(h);
    }
  }
  meals.sort((a, b) => a - b);
  const out: ZeroSpan[] = [];
  // the burn-in's habitual last meal sits before day 0; spans are measured between planned meals only
  for (let i = 1; i < meals.length; i++) {
    const h = meals[i]! - meals[i - 1]!;
    if (h > minHours + 1e-9) out.push({ start: meals[i - 1]!, end: meals[i]!, hours: h });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// template-level rules
// ---------------------------------------------------------------------------------------------------------------

/** Exercise rules on one session list: permission (HC-X4 lock), exclusions, intensity band, HIIT, session length. */
function repairExercise(ctx: PlanningContext, sessions: readonly ExerciseSession[], ed: Editor, path: (f: string) => string): ExerciseSession[] {
  const caps = ctx.caps;
  const p = ctx.practical;
  let ex: ExerciseSession[] = sessions.slice();
  if (!caps.exercise.allowed) {
    ex = [];
    ed.note('HC-X4', { path: path('exercise') });
  }
  if (p.excluded.has('resistanceTraining')) ex = ex.filter((s) => s.kind !== 'resistance');
  if (p.excluded.has('cardio')) ex = ex.filter((s) => s.kind !== 'cardio');
  ex = ex.map((s) => {
    if (s.kind === 'cardio') {
      let c: CardioSession = s;
      if (c.modality === 'hiit' && (caps.exercise.lightModerateOnly || caps.exercise.noVigorousOutdoor)) {
        c = { ...c, modality: 'cycle' };
        ed.note('HC-X4', { path: path('exercise.cardio.modality') });
      }
      const band = CARDIO_BANDS[c.modality] ?? CARDIO_BANDS.other!;
      if (c.pctVo2max !== undefined && c.pctVo2max > band.max + 1e-9) {
        ed.note('HC-X4', { path: path('exercise.cardio.pctVo2max'), amount: c.pctVo2max - band.max });
        c = { ...c, pctVo2max: band.max };
      }
      if (c.durationMin > p.maxSessionMin) {
        ed.note('user.maxSessionMin', { path: path('exercise.cardio.durationMin'), amount: c.durationMin - p.maxSessionMin });
        c = { ...c, durationMin: p.maxSessionMin };
      }
      return c;
    }
    let r: ResistanceSession = s;
    if (r.toFailure && caps.rtNovice) r = { ...r, toFailure: false };
    const dur = r.durationMin ?? 60;
    if (dur > p.maxSessionMin + 1e-9 && r.setsByRegion) {
      const f = p.maxSessionMin / dur;
      const sets: ResistanceSession['setsByRegion'] = {};
      for (const [k, v] of Object.entries(r.setsByRegion)) sets[k as keyof typeof sets] = +((v ?? 0) * f).toFixed(3);
      ed.note('user.maxSessionMin', { path: path('exercise.resistance'), amount: dur - p.maxSessionMin });
      r = { ...r, setsByRegion: sets, durationMin: p.maxSessionMin };
    }
    return r;
  });
  return ex;
}

function repairTemplate(ctx: PlanningContext, t: DayTemplate, ed: Editor, pi: number): DayTemplate {
  const caps = ctx.caps;
  const p = ctx.practical;
  const path = (f: string) => `programs[${pi}].${f}`;
  const out: DayTemplate = { ...t };
  // HC-M10 alcohol never prescribed; HC-M11 caffeine per dose / per day; HC-M12 creatine; exclusions
  if (out.substances) {
    const sub = { ...out.substances };
    if (sub.alcohol?.length) {
      delete sub.alcohol;
      ed.note('HC-M10', { path: path('substances.alcohol') });
    }
    if (sub.caffeine?.length) {
      let tot = 0;
      sub.caffeine = sub.caffeine.map((c) => ({ ...c, mg: Math.min(c.mg, 200) })).filter((c) => (tot += c.mg) <= 400);
      if (tot > 400) ed.note('HC-M11', { path: path('substances.caffeine') });
    }
    if (sub.creatineG !== undefined) {
      if (!caps.creatineAllowed || p.excluded.has('L7') || p.excluded.has('creatine') || !supplementConsent(ctx, 'L7')) {
        delete sub.creatineG;
        ed.note(!caps.creatineAllowed ? 'HC-M12' : !supplementConsent(ctx, 'L7') ? 'tier.optIn' : 'user.excluded', { path: path('substances.creatineG') });
      } else if (sub.creatineG > HC.creatineMaxG) {
        ed.note('HC-M12', { path: path('substances.creatineG'), amount: sub.creatineG - HC.creatineMaxG });
        sub.creatineG = HC.creatineMaxG;
      }
    }
    if (sub.creatineLoading) {
      delete sub.creatineLoading;
      ed.note('HC-M12', { path: path('substances.creatineLoading') });
    }
    out.substances = sub;
  }
  if (out.macros.fatTypes?.omega3G && (p.excluded.has('L8') || !(caps.optInLevers.has('L8') || caps.optInLevers.has('omega3')))) {
    out.macros = { ...out.macros, fatTypes: { ...out.macros.fatTypes, omega3G: undefined } };
    ed.note('tier.optIn', { path: path('macros.fatTypes.omega3G') });
  }
  // exercise: permission (HC-X4 lock), exclusions, intensity band, HIIT, session length
  if (out.exercise?.length) out.exercise = repairExercise(ctx, out.exercise, ed, path);
  if (out.energy.kind === 'zero') return out;
  // eating window: user bounds, HC-F5 minimum, meals ≥ 2 (single-meal days never planned), meal spacing
  const mp = out.meals ?? {};
  if (mp.window && !mp.meals) {
    let { startH, lengthH } = mp.window;
    const minW = Math.min(caps.minWindowH, p.latestH - p.earliestH);
    if (lengthH < minW - 1e-9) {
      ed.note('HC-F5', { path: path('meals.window'), amount: minW - lengthH });
      lengthH = minW;
    }
    if (startH < p.earliestH - 1e-9) {
      ed.note('user.eatingWindow', { path: path('meals.window.startH'), amount: p.earliestH - startH });
      startH = p.earliestH;
    }
    if (startH + lengthH > p.latestH + 1e-9) {
      ed.note('user.eatingWindow', { path: path('meals.window'), amount: startH + lengthH - p.latestH });
      startH = Math.max(p.earliestH, p.latestH - lengthH);
      lengthH = Math.min(lengthH, p.latestH - startH);
    }
    let count = Math.round(mp.count ?? 3);
    const maxBySpacing = 1 + Math.floor(lengthH / MIN_MEAL_SPACING_H + 1e-9);
    const hi = Math.min(p.meals.max, maxBySpacing);
    const lo = Math.min(Math.max(2, p.meals.min), hi);
    if (count > hi || count < lo) {
      ed.note(count > p.meals.max ? 'user.meals' : count < 2 ? 'HC-F5' : 'consistency.mealSpacing', { path: path('meals.count'), amount: count - clamp(count, lo, hi) });
      count = clamp(count, lo, hi);
    }
    out.meals = { ...mp, count, window: { startH, lengthH } };
  }
  // energy: HC-E8 surplus cap, no-deficit profiles
  if (out.energy.kind === 'pctMaintenance') {
    let pct = out.energy.pct;
    if (pct > caps.maxPctTdee + PCT_EPS) {
      ed.note('HC-E8', { path: path('energy'), amount: pct - caps.maxPctTdee });
      pct = caps.maxPctTdee;
    }
    if (caps.deficitCapPct <= 0 && pct < 100 - PCT_EPS) {
      ed.note(caps.mode === 'R1' ? 'HC-P3' : 'HC-P4', { path: path('energy'), amount: 100 - pct });
      pct = 100;
    }
    out.energy = { ...out.energy, pct };
  } else if (out.energy.kind === 'kcal' && caps.deficitCapPct <= 0 && out.energy.kcal < caps.tdee0Kcal) {
    ed.note('HC-P3', { path: path('energy'), amount: caps.tdee0Kcal - out.energy.kcal });
    out.energy = { kind: 'pctMaintenance', pct: 100, reference: 'blockStart' };
  }
  fitFloorsEnergy(ctx, out, ed, `programs[${pi}].energy`);
  out.macros = repairMacros(ctx, out, ed, pi);
  return out;
}

/**
 * When the protein, fat and carbohydrate floors (17 HC-M1/M3/M4 and the user's floors) cannot fit inside a day's energy,
 * raise the day's planned energy (never above the surplus cap): hard floors outrank the energy target.
 */
function fitFloorsEnergy(ctx: PlanningContext, t: DayTemplate, ed: Editor, path: string, partialDay = false): void {
  if (partialDay || t.energy.kind !== 'pctMaintenance') return;
  const caps = ctx.caps;
  const est = estimateDay(t, refsOf(ctx));
  if (est.zero || est.kcal < HC.fat.appliesAboveKcal) return;
  const P = Math.max(caps.proteinFloorRw, est.pct < 100 - HC.proteinDeficitThresholdPct ? caps.proteinFloorDeficitRw : 0) * caps.rwKg;
  const fixed = 4 * P + 4 * caps.carbFloorG + 2 * est.fibreG;
  const need = Math.max(fixed / (1 - HC.fat.minPctEnergy / 100), fixed + 9 * caps.fatFloorG, (4 * P) / (HC.protein.capPctEnergy / 100));
  if (est.kcal >= need - 0.5) return;
  const pct = Math.min(caps.maxPctTdee, (100 * need) / caps.tdee0Kcal + PCT_EPS);
  if (pct <= t.energy.pct + 1e-9) return;
  ed.note('floors.energy', { path, amount: pct - t.energy.pct });
  t.energy = { ...t.energy, pct: +pct.toFixed(3) };
}

/** HC-M1/M2 protein, HC-M3 fat, HC-M4 carbohydrate floor on one template (baseline-reference estimate). */
function repairMacros(ctx: PlanningContext, t: DayTemplate, ed: Editor, pi: number, partialDay = false): MacroSpec {
  const caps = ctx.caps;
  const refs = refsOf(ctx);
  const est = estimateDay(t, refs);
  if (est.zero) return t.macros;
  const m: MacroSpec = { ...t.macros };
  const path = (f: string) => `programs[${pi}].macros.${f}`;
  const E = est.kcal;
  const pct = est.pct;
  const low = t.energy.kind === 'kcal' && E < caps.restrictedDayUpperKcal;
  const inDeficit = pct < 100 - HC.proteinDeficitThresholdPct || caps.ageYears >= 65;
  // protein g/kg RW
  const pRw = est.proteinG / caps.rwKg;
  // floors are 7-day quantities (17 §2.2): a fast-shortened day (explicit kept meals) is exempt from the daily floors
  const floor = low || partialDay ? 0 : inDeficit ? caps.proteinFloorDeficitRw : caps.proteinFloorRw;
  const capPct = (HC.protein.capPctEnergy / 100) * E / 4;
  // planning headroom under the 3.1 g/kg FFM cap (W-M04), never below the protein floor that applies (a user floor wins
  // over the headroom, not over the hard caps)
  const cap = Math.min(caps.proteinCapRw * caps.rwKg, Math.max(HC.proteinPlanCapGPerKgFfm * caps.ffmKg, floor * caps.rwKg), caps.proteinCapGPerKgFfm * caps.ffmKg, low ? Infinity : capPct);
  let pG = est.proteinG;
  if (pRw < floor - 1e-6) {
    ed.note('HC-M1', { path: path('protein'), amount: floor - pRw });
    pG = floor * caps.rwKg;
  }
  if (pG > cap + 1e-6) {
    ed.note('HC-M2', { path: path('protein'), amount: (pG - cap) / caps.rwKg });
    pG = cap;
  }
  if (Math.abs(pG - est.proteinG) > 1e-6) {
    m.protein = m.protein.unit === 'gPerKgBw' ? { unit: 'gPerKgBw', value: +(pG / refs.bwKg).toFixed(4) } : { unit: 'g', value: +pG.toFixed(1) };
  }
  // fat ≥ max(15 %E, 30 g, lock) when EI ≥ 800 kcal (HC-M3)
  if (E >= HC.fat.appliesAboveKcal && !partialDay) {
    const fFloor = Math.max(((HC.fat.minPctEnergy / 100) * E) / 9, caps.fatFloorG);
    const e2 = estimateDay({ energy: t.energy, macros: m }, refs);
    if (e2.fatG < fFloor - 0.5) {
      ed.note('HC-M3', { path: path('fat'), amount: fFloor - e2.fatG });
      if (m.fat.unit === 'remainder') {
        // carbohydrate is fixed (very-low-carbohydrate) → lower it, but never below its own floor
        const room = E - 4 * e2.proteinG - 2 * e2.fibreG - 9 * fFloor;
        m.carbs = { unit: 'g', value: +Math.max(caps.carbFloorG, room / 4).toFixed(1) };
      } else {
        m.fat = { unit: 'g', value: +fFloor.toFixed(1) };
        if (m.carbs.unit !== 'remainder') m.carbs = { unit: 'remainder' };
      }
    }
    // ≥ one meal with ≥ 10 g fat when deficit ≥ 20 % (gallbladder rule): biggest meal last
    const e3 = estimateDay({ energy: t.energy, macros: m }, refs);
    const n = Math.max(1, Math.round(t.meals?.count ?? 3));
    if (pct <= 100 - HC.fat.mealRuleDeficitPct && (2 * e3.fatG) / (n + 1) < HC.fat.mealMinG && t.meals) {
      ed.note('HC-M3', { path: path('meals.split') });
    }
  }
  // carbohydrate floor (HC-M4 keto exclusions, HC-P3 R1 100 g, lock)
  if (caps.carbFloorG > 0 && !partialDay) {
    const e4 = estimateDay({ energy: t.energy, macros: m }, refs);
    if (e4.carbG < caps.carbFloorG - 0.5) {
      ed.note(caps.mode === 'R1' ? 'HC-P3' : 'HC-M4', { path: path('carbs'), amount: caps.carbFloorG - e4.carbG });
      if (m.carbs.unit === 'remainder') {
        // make room by lowering fat toward its floor, then protein toward its floor
        const fFloor = Math.max(((HC.fat.minPctEnergy / 100) * E) / 9, caps.fatFloorG);
        const need = 4 * (caps.carbFloorG - e4.carbG);
        const fatCut = Math.min(need, 9 * Math.max(0, e4.fatG - fFloor));
        const newFat = e4.fatG - fatCut / 9;
        m.fat = { unit: 'g', value: +newFat.toFixed(1) };
        const still = need - fatCut;
        if (still > 0) {
          const pFloorG = (low ? 0 : inDeficit ? caps.proteinFloorDeficitRw : caps.proteinFloorRw) * caps.rwKg;
          const pCut = Math.min(still, 4 * Math.max(0, e4.proteinG - pFloorG));
          m.protein = { unit: 'g', value: +(e4.proteinG - pCut / 4).toFixed(1) };
        }
      } else {
        m.carbs = { unit: 'g', value: caps.carbFloorG };
        if (m.fat.unit !== 'remainder' && m.protein.unit !== 'remainder') m.fat = { unit: 'remainder' };
      }
    }
  }
  // consistency: fixed macros must fit the day's energy (else the engine would realise their sum)
  const e5 = estimateDay({ energy: t.energy, macros: m }, refs);
  if (e5.exceeds) {
    const over = 4 * e5.proteinG + 4 * e5.carbG + 9 * e5.fatG + 2 * e5.fibreG - E;
    let left = over + 1;
    const fFloor = partialDay ? 0 : Math.max(((HC.fat.minPctEnergy / 100) * E) / 9, E >= HC.fat.appliesAboveKcal ? caps.fatFloorG : 0);
    if (m.fat.unit !== 'remainder' && left > 0) {
      const cut = Math.min(left, 9 * Math.max(0, e5.fatG - fFloor));
      m.fat = { unit: 'g', value: +(e5.fatG - cut / 9).toFixed(2) };
      left -= cut;
    }
    if (m.carbs.unit !== 'remainder' && left > 0) {
      const cut = Math.min(left, 4 * Math.max(0, e5.carbG - caps.carbFloorG));
      m.carbs = { unit: 'g', value: +(e5.carbG - cut / 4).toFixed(2) };
      left -= cut;
    }
    if (left > 0) {
      const pFloorG = (low || partialDay ? 0 : inDeficit ? caps.proteinFloorDeficitRw : caps.proteinFloorRw) * caps.rwKg;
      const cut = Math.min(left, 4 * Math.max(0, e5.proteinG - pFloorG));
      m.protein = { unit: 'g', value: +(e5.proteinG - cut / 4).toFixed(2) };
      left -= cut;
    }
    if (left > 0 && m.fibre && m.fibre.unit === 'g') m.fibre = { unit: 'g', value: +Math.max(0, e5.fibreG - left / 2).toFixed(2) };
    ed.note('consistency.energy', { path: path('macros'), amount: over });
  }
  return m;
}

/**
 * HC-M1 per day with the 17 definition of "deficit" (trailing 7-d planned deficit > 10 %): raise the protein of plain
 * eating days whose trailing week is in deficit to the deficit floor.
 */
function proteinFloors(ctx: PlanningContext, ed: Editor): void {
  const caps = ctx.caps;
  const refs = refsOf(ctx);
  const T = ed.s.horizonDays;
  const cov = eventCoverage(ed.s);
  // planned intake with fast windows and refeed ramps (same trailing mean the validator and the engine use)
  const kc = intakeProfile(ctx, ed).kcal;
  for (let d = 0; d < T; d++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, d - 6); k <= d; k++) {
      sum += kc[k]!;
      n++;
    }
    const pct = (100 * sum) / n / caps.tdee0Kcal;
    // + 0.1 %: borderline weeks get the deficit floor (the validator judges them with the lower one)
    const floor = pct < 100 - HC.proteinDeficitThresholdPct + 0.1 || caps.ageYears >= 65 ? caps.proteinFloorDeficitRw : caps.proteinFloorRw;
    const t = ed.day(d);
    const e = estimateDay(t, refs);
    if (e.zero || e.kcal < caps.restrictedDayUpperKcal || cov[d]! > 0 || t.meals?.meals?.length) continue;
    if (e.proteinG / caps.rwKg < floor - 1e-4) {
      const g = floor * caps.rwKg * 1.0005;
      const m: MacroSpec = { ...t.macros, protein: { unit: 'g', value: +g.toFixed(2) } };
      ed.patch(d, { macros: repairMacros(ctx, { ...t, macros: m }, ed, ed.s.days[d]!.program) });
      ed.note('HC-M1', { day: d, amount: floor - e.proteinG / caps.rwKg });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// day-level rules
// ---------------------------------------------------------------------------------------------------------------

/** Days touched by an event (span) plus its recovery days (≥ 48 h: end day and the next). */
function eventDays(e: FastEvent, T: number): { touched: number[]; recovery: number[] } {
  const a = e.startDay * 24 + e.startH;
  const b = a + e.durationH;
  const touched: number[] = [];
  for (let d = Math.max(0, Math.floor(a / 24)); d <= Math.min(T - 1, Math.floor((b - 1e-9) / 24)); d++) touched.push(d);
  const endDay = fastEndDay(e);
  // multi-day water fasts lock the refeed-ramp days (at least the end day and the next; 17 HC-F3, 13 rule 4)
  const recovery = Array.from({ length: recoveryDayCount(e.durationH) }, (_, i) => endDay + i).filter((d) => d < T);
  return { touched, recovery };
}

function dropEvent(ed: Editor, i: number, rule: string): void {
  const s = ed.s;
  const e = s.events![i]!;
  const { touched, recovery } = eventDays(e, s.horizonDays);
  // days another remaining fast touches or locks keep their overrides (frozen meals, recovery locks)
  const kept = new Set<number>();
  s.events!.forEach((o, j) => {
    if (j === i) return;
    const k = eventDays(o, s.horizonDays);
    for (const d of [...k.touched, ...k.recovery]) kept.add(d);
  });
  for (const d of [...touched, ...recovery]) {
    if (kept.has(d)) continue;
    const sd = s.days[d]!;
    if (sd.override) {
      const { meals: _m, energy: _e, macros: _mac, exercise: _ex, hydration: _h, ...rest } = sd.override;
      sd.override = Object.keys(rest).length ? rest : undefined;
    }
  }
  s.events!.splice(i, 1);
  ed.note(rule, { path: 'events', day: e.startDay, amount: e.durationH });
}

/** Normal energy of a zero/low day's phase (from the decoded plan), % of maintenance. */
function normalPctFor(plan: DecodedPlan | undefined, d: number): number {
  if (!plan) return 100;
  const ph = plan.phases[plan.dayPhase[d] ?? 0];
  return ph ? ph.energyPct : 100;
}

const CLEAR_HYDRATION = { electrolytes: undefined, fluidL: undefined, sodiumG: undefined };

/** Macros of a plain eating day of the same phase (so a converted zero/low day eats like its phase). */
function normalMacrosFor(ed: Editor, plan: DecodedPlan | undefined, d: number): MacroSpec | null {
  if (!plan) return null;
  const ph = plan.dayPhase[d];
  for (let k = 0; k < ed.s.horizonDays; k++) {
    if (plan.dayPhase[k] !== ph || plan.dayKind[k] !== 'normal' || ed.s.days[k]!.override) continue;
    const t = ed.s.programs[ed.s.days[k]!.program]!;
    if (t.energy.kind === 'pctMaintenance') return t.macros;
  }
  return null;
}

function convertToNormal(ctx: PlanningContext, ed: Editor, d: number, plan: DecodedPlan | undefined, rule: string, pctOverride?: number): void {
  const pct = pctOverride ?? Math.min(normalPctFor(plan, d), ctx.caps.maxPctTdee);
  const t = ed.day(d);
  const macros = normalMacrosFor(ed, plan, d) ?? { ...t.macros, fat: { unit: 'pctEnergy' as const, value: 30 }, carbs: { unit: 'remainder' as const } };
  ed.s.days[d]!.override = { ...(ed.s.days[d]!.override ?? {}), energy: { kind: 'pctMaintenance', pct, reference: 'blockStart' }, macros, hydration: { ...(t.hydration ?? {}), ...CLEAR_HYDRATION } };
  ed.note(rule, { path: 'days', day: d });
}

function fastRules(ctx: PlanningContext, ed: Editor, plan: DecodedPlan | undefined): void {
  const s = ed.s;
  const caps = ctx.caps;
  const T = s.horizonDays;
  s.events = s.events ?? [];
  // exclusions, refusal and tier/length gate per event (HC-F1)
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]!;
    const lever = e.durationH <= 24 ? 'fastDay24' : 'waterFast';
    const refused = ctx.practical.fastingRefused || ctx.practical.excluded.has(lever) || !ctx.fastingRelevant;
    if (refused) dropEvent(ed, i, 'user.excluded');
    else if (!fastAllowed(caps, e.durationH)) dropEvent(ed, i, 'HC-F1');
    else if (e.durationH > 48 + 1e-6 && e.refeed !== 'auto' && !e.refeedFactors?.length) {
      e.refeed = 'auto';
      ed.note('HC-F3', { day: e.startDay });
    }
  }
  // zero days: gate by the length of the span they create
  let spans = zeroSpans(ctx, s);
  for (let d = 0; d < T; d++) {
    const t = ed.day(d);
    if (t.energy.kind !== 'zero') continue;
    const sp = spans.find((z) => z.start < d * 24 + 24 && z.end > d * 24);
    const h = sp ? sp.hours : 24;
    if (ctx.practical.fastingRefused || ctx.practical.excluded.has('zeroDay') || !fastAllowed(caps, h)) convertToNormal(ctx, ed, d, plan, ctx.practical.fastingRefused ? 'user.excluded' : 'HC-F1');
  }
  // HC-F2 spacing / frequency and 13 B14/B15 limits: walk spans in time order, drop the later offender
  for (let guard = 0; guard < 2000; guard++) {
    spans = zeroSpans(ctx, s);
    const bad = firstSpacingViolation(spans);
    if (!bad) break;
    const sp = bad.span;
    const ei = s.events.findIndex((e) => {
      const a = e.startDay * 24 + e.startH;
      return a < sp.end && a + e.durationH > sp.start;
    });
    if (ei >= 0) {
      dropEvent(ed, ei, bad.rule);
      continue;
    }
    let converted = false;
    for (let d = Math.floor(sp.start / 24); d <= Math.min(T - 1, Math.floor((sp.end - 1e-9) / 24)); d++) {
      if (ed.day(d).energy.kind === 'zero') {
        convertToNormal(ctx, ed, d, plan, bad.rule);
        converted = true;
      }
    }
    if (!converted) break;
  }
  // HC-F1 per span (spans may merge, e.g. a zero day next to a 24-h fast)
  for (let guard = 0; guard < 2000; guard++) {
    spans = zeroSpans(ctx, s);
    const sp = spans.find((z) => !fastAllowed(caps, z.hours));
    if (!sp) break;
    const ei = s.events.findIndex((e) => {
      const a = e.startDay * 24 + e.startH;
      return a < sp.end && a + e.durationH > sp.start;
    });
    if (ei >= 0) {
      dropEvent(ed, ei, 'HC-F1');
      continue;
    }
    let converted = false;
    for (let d = Math.floor(sp.start / 24); d <= Math.min(T - 1, Math.floor((sp.end - 1e-9) / 24)); d++) {
      if (ed.day(d).energy.kind === 'zero') {
        convertToNormal(ctx, ed, d, plan, 'HC-F1');
        converted = true;
        break;
      }
    }
    if (!converted) break; // a pure meal-gap span > tier (cannot happen with windows ≥ 4 h); the validator will reject
  }
  // HC-F4 / HC-F3 / 13 rule 4: no sessions inside fasts (T1: none in the fast at all; T2+: no training on any day the
  // fast touches); no training and ≤ 100 % energy on the two days after a ≥ 48-h fast
  spans = zeroSpans(ctx, s, 24 - 1e-6);
  for (const sp of spans) {
    for (let d = Math.floor(sp.start / 24); d <= Math.min(T - 1, Math.floor((sp.end - 1e-9) / 24)); d++) {
      const ex = ed.day(d).exercise ?? [];
      const kept = ex.filter((x) => {
        if (sp.hours > 24 + 1e-6) return false;
        const s0 = d * 24 + x.startH;
        const s1 = s0 + (x.durationMin ?? 60) / 60;
        return s1 <= sp.start || s0 >= sp.end;
      });
      if (kept.length < ex.length) {
        ed.patch(d, { exercise: kept });
        ed.note('HC-F4', { day: d, amount: ex.length - kept.length });
      }
    }
    if (sp.hours >= 48 - 1e-6) {
      const endDay = Math.floor((sp.end + 1e-9) / 24);
      const n = Math.max(2, recoveryDayCount(sp.hours));
      for (let d = endDay; d < endDay + n; d++) {
        if (d >= T) continue;
        const t = ed.day(d);
        if (t.exercise?.length) {
          ed.patch(d, { exercise: [] });
          ed.note('HC-F3', { day: d });
        }
        if (t.energy.kind === 'pctMaintenance' && t.energy.pct > 100 + PCT_EPS) {
          ed.patch(d, { energy: { ...t.energy, pct: 100 } });
          ed.note('HC-F3', { day: d, amount: t.energy.pct - 100 });
        }
      }
    }
  }
}

const TIER_INDEX: Readonly<Record<string, number>> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4, T5: 5 };

/**
 * First HC-F2 violation (and 13 B14/B15 frequency), in time order, with the engine's semantics (safety
 * `spacingViolation` and the fastH_7 ledger):
 *  - normal eating between a fast and the one before it ≥ 24 h (T1/T2), ≥ 7 d if either is T3, ≥ 28 d if either is T4
 *    (so an expert-tier fast is alone in its 28-day window, ruling R-T4CAP);
 *  - counts by resume time: ≤ 3 fasts > T0 in 7 d (for a T1/T2 fast), ≤ 2 fasts > 36 h in 7 d, ≤ 2 T3+ in 30 d, ≤ 1 T4
 *    in 12 weeks and ≤ 4 a year;
 *  - cumulative fasted hours ≤ 108 in every 7 calendar days, counting T0-T3 fasts only (R-T4CAP: a single T4 fast is
 *    governed by its own tier rule and refeed days, not by the weekly cap);
 *  - 13 B14/B15: 48-h fasts ≥ 14 d apart, 72-h ≥ 30 d (start to start; planner-only, stricter).
 */
export function firstSpacingViolation(spans: readonly ZeroSpan[]): { rule: string; span: ZeroSpan } | null {
  const fasts = spans.filter((z) => z.hours > HC.tierMaxH.T0 + 1e-6);
  const dayH = new Map<number, number>();
  for (let i = 0; i < fasts.length; i++) {
    const z = fasts[i]!;
    const tz = TIER_INDEX[tierForHours(z.hours)]!;
    if (i > 0) {
      const y = fasts[i - 1]!;
      if (z.start - y.end < eatingGapNeedH(y.hours, z.hours) - 1e-6) return { rule: 'HC-F2', span: z };
    }
    let nWeek = 1;
    let nWeekLong = z.hours > HC.t2SplitH + 1e-6 ? 1 : 0;
    let nT3 = tz >= 3 ? 1 : 0;
    let nT4wk = tz >= 4 ? 1 : 0;
    let nT4yr = nT4wk;
    for (let j = i - 1; j >= 0; j--) {
      const y = fasts[j]!;
      if (y.end < z.end - 365 * 24 - 1e-6) break;
      const ty = TIER_INDEX[tierForHours(y.hours)]!;
      // look-back windows are closed at their start (the engine counts a fast that resumed exactly 7 d earlier)
      if (y.end >= z.end - 7 * 24 - 1e-6) {
        nWeek++;
        if (y.hours > HC.t2SplitH + 1e-6) nWeekLong++;
      }
      if (y.end >= z.end - 30 * 24 - 1e-6 && ty >= 3) nT3++;
      if (ty >= 4) {
        if (y.end >= z.end - 84 * 24 - 1e-6) nT4wk++;
        nT4yr++;
      }
      if (y.hours >= 48 - 1e-6 && z.hours >= 48 - 1e-6 && z.start - y.start < eventPeriodDays(Math.max(y.hours, z.hours)) * 24 - 1e-6)
        return { rule: 'B14/B15', span: z };
    }
    if (tz <= 2 && (nWeek > HC.fastsPerWeekMax || (z.hours > HC.t2SplitH + 1e-6 && nWeekLong > HC.fastsGt36PerWeekMax))) return { rule: 'HC-F2', span: z };
    if (tz >= 3 && nT3 > HC.t3Per30dMax) return { rule: 'HC-F2', span: z };
    if (tz >= 4 && (nT4wk > HC.t4Per12wkMax || nT4yr > HC.t4PerYearMax)) return { rule: 'HC-F2', span: z };
    // fasted-hours ledger per calendar day (T0-T3 only) and every 7-day window touching this fast
    if (tz <= 3) {
      for (let d = Math.floor(z.start / 24); d <= Math.floor((z.end - 1e-9) / 24); d++)
        dayH.set(d, (dayH.get(d) ?? 0) + Math.min(z.end, d * 24 + 24) - Math.max(z.start, d * 24));
      for (let end = Math.floor(z.start / 24); end <= Math.floor((z.end - 1e-9) / 24) + 6; end++) {
        let h7 = 0;
        for (let d = end - 6; d <= end; d++) h7 += dayH.get(d) ?? 0;
        if (h7 > HC.fastH7Max + 1e-6) return { rule: 'HC-F2', span: z };
      }
    }
  }
  return null;
}

/** HC-E2 restricted days: ≥ min kcal, ≤ 2 per rolling 7 d, never consecutive (planned kcal at baseline references). */
function restrictedDays(ctx: PlanningContext, ed: Editor): void {
  const caps = ctx.caps;
  const refs = refsOf(ctx);
  const T = ed.s.horizonDays;
  const cov = eventCoverage(ed.s);
  const isRestricted = (d: number) => {
    if (cov[d]! > 0) return false; // fast-touched days are governed by the fasting tiers
    const e = estimateDay(ed.day(d), refs);
    return !e.zero && e.kcal > HC.zeroKcal && e.kcal < caps.restrictedDayUpperKcal;
  };
  const raise = (d: number, rule: string) => {
    const t = ed.day(d);
    const pct = t.energy.kind === 'pctMaintenance' ? t.energy.pct : 100;
    const kcal = Math.max(caps.restrictedDayUpperKcal, (pct / 100) * caps.tdee0Kcal);
    ed.patch(d, { energy: { kind: 'kcal', kcal: Math.round(kcal) } });
    ed.note(rule, { day: d });
  };
  for (let d = 0; d < T; d++) {
    if (!isRestricted(d)) continue;
    const e = estimateDay(ed.day(d), refs);
    if (e.kcal < caps.restrictedDayMinKcal - 0.5) {
      const t = ed.day(d);
      if (t.energy.kind === 'kcal') {
        ed.patch(d, { energy: { kind: 'kcal', kcal: caps.restrictedDayMinKcal } });
        ed.note('HC-E2', { day: d, amount: caps.restrictedDayMinKcal - e.kcal });
      }
    }
    if (d > 0 && isRestricted(d - 1)) {
      raise(d, 'HC-E2');
      continue;
    }
    let n = 0;
    for (let k = Math.max(0, d - 6); k <= d; k++) if (isRestricted(k)) n++;
    if (n > HC.restrictedDay.maxPer7d) raise(d, 'HC-E2');
  }
}

/** Rolling 7-d planned mean vs HC-E3 cap and HC-E1 floor (planned % of maintenance at baseline references). */
/**
 * Planned intake per day (baseline references, fast windows and refeed ramps applied) and the fast-day mask: days
 * touched by a ≥ 24-h fast event, zero-energy days and the locked refeed days (ruling 18:10: governed by the tier rules).
 */
function intakeProfile(ctx: PlanningContext, ed: Editor): { kcal: Float64Array; fast: Uint8Array } {
  const refs = refsOf(ctx);
  const T = ed.s.horizonDays;
  const { covered, fastDay } = fastCoverage(ed.s);
  const rf = refeedDayFactors(ed.s);
  const kcal = new Float64Array(T);
  const fast = new Uint8Array(T);
  for (const e of ed.s.events ?? []) {
    if (e.durationH <= 24 + 1e-6) continue;
    const end = fastEndDay(e);
    for (let i = 0; i < recoveryDayCount(e.durationH); i++) if (end + i < T) fast[end + i] = 1;
  }
  for (let d = 0; d < T; d++) {
    const t = ed.day(d);
    kcal[d] = covered[d]! >= 24 - 1e-9 ? 0 : estimateDay(t, refs).kcal * rf[d]!;
    if (fastDay[d] || t.energy.kind === 'zero') fast[d] = 1;
  }
  return { kcal, fast };
}

/**
 * Planned-energy proxies of 17 HC-E1 / HC-E3 (ruling 18:10): the rolling 7-day mean of NON-fast days must meet the
 * deficit cap and the kcal floor; the rolling 28-day mean of all days (fasts included) must meet the kcal floor. The
 * simulated trajectory's margins remain authoritative.
 */
function weeklyEnergy(ctx: PlanningContext, ed: Editor, plan: DecodedPlan | undefined): void {
  const caps = ctx.caps;
  const T = ed.s.horizonDays;
  const floorPct = (100 * caps.energyFloorKcal) / caps.tdee0Kcal;
  const needPct = Math.max(caps.deficitCapPct > 0 ? 100 - caps.deficitCapPct : 100, floorPct);
  const rule7 = needPct === floorPct ? 'HC-E1' : caps.deficitCapPct > 0 ? 'HC-E3' : 'HC-P4';
  const raise = (from: number, to: number, fast: Uint8Array, deficitKcal: number, need: number): boolean => {
    const eating: number[] = [];
    for (let d = from; d < to; d++) {
      if (fast[d]) continue;
      const t = ed.day(d);
      if (t.energy.kind === 'pctMaintenance' && t.energy.pct < caps.maxPctTdee - PCT_EPS) eating.push(d);
      else if (t.energy.kind === 'kcal' && t.energy.kcal > HC.zeroKcal) eating.push(d);
    }
    if (!eating.length) return false;
    const add = deficitKcal / eating.length;
    for (const d of eating) {
      const t = ed.day(d);
      if (t.energy.kind === 'pctMaintenance') {
        const pct = Math.min(caps.maxPctTdee, t.energy.pct + (100 * add) / caps.tdee0Kcal + PCT_EPS);
        ed.patch(d, { energy: { ...t.energy, pct: +pct.toFixed(3) } });
      } else if (t.energy.kind === 'kcal') {
        ed.patch(d, { energy: { kind: 'pctMaintenance', pct: Math.min(caps.maxPctTdee, need + PCT_EPS), reference: 'blockStart' } });
      }
    }
    return true;
  };
  for (let guard = 0; guard < 400; guard++) {
    const { kcal, fast } = intakeProfile(ctx, ed);
    // ---- 7-day rule on non-fast days
    let bad7 = -1;
    let def7 = 0;
    for (let s = 0; s + 7 <= T && bad7 < 0; s++) {
      let sum = 0;
      let n = 0;
      for (let d = s; d < s + 7; d++) if (!fast[d]) {
        sum += kcal[d]!;
        n++;
      }
      if (!n) continue;
      const pct = (100 * sum) / n / caps.tdee0Kcal;
      if (pct < needPct - PCT_EPS) {
        bad7 = s;
        def7 = ((needPct - pct) / 100) * caps.tdee0Kcal * n;
      }
    }
    if (bad7 >= 0) {
      // low (kcal) days first become normal eating days; then eating days are raised
      let lowFixed = false;
      for (let d = bad7 + 6; d >= bad7 && !lowFixed; d--) {
        const t = ed.day(d);
        if (!fast[d] && t.energy.kind === 'kcal' && t.energy.kcal < caps.restrictedDayUpperKcal) {
          convertToNormal(ctx, ed, d, plan, rule7);
          lowFixed = true;
        }
      }
      if (lowFixed) continue;
      if (!raise(bad7, bad7 + 7, fast, def7, needPct)) return;
      ed.note(rule7, { day: bad7, amount: def7 / 7 });
      continue;
    }
    // ---- 28-day mean-intake floor on all days (fasts included)
    let bad28 = -1;
    let def28 = 0;
    const W = Math.min(28, T);
    for (let s = 0; s + W <= T && bad28 < 0; s++) {
      let sum = 0;
      for (let d = s; d < s + W; d++) sum += kcal[d]!;
      if (sum / W < caps.energyFloorKcal - 0.5) {
        bad28 = s;
        def28 = caps.energyFloorKcal * W - sum;
      }
    }
    if (bad28 < 0) return;
    const evs = ed.s.events ?? [];
    let ei = -1;
    for (let i = evs.length - 1; i >= 0 && ei < 0; i--) {
      const e = evs[i]!;
      if (e.startDay < bad28 + W && fastEndDay(e) >= bad28) ei = i;
    }
    if (ei >= 0) {
      dropEvent(ed, ei, 'HC-E1.28d');
      continue;
    }
    let zeroFixed = false;
    for (let d = bad28 + W - 1; d >= bad28 && !zeroFixed; d--) {
      if (ed.day(d).energy.kind === 'zero') {
        convertToNormal(ctx, ed, d, plan, 'HC-E1.28d');
        zeroFixed = true;
      }
    }
    if (zeroFixed) continue;
    if (!raise(bad28, bad28 + W, fast, def28, floorPct)) return;
    ed.note('HC-E1.28d', { day: bad28, amount: def28 / W });
  }
}

/** HC-E7: ≥ 15 % planned deficit for > 12 wk → 2-wk break at maintenance; 5-15 % for > 26 wk → 2 wk. */
function deficitBreaks(ctx: PlanningContext, ed: Editor, plan: DecodedPlan | undefined): void {
  const caps = ctx.caps;
  const T = ed.s.horizonDays;
  const cfg = HC.deficitBlocks;
  // trailing 7-day planned deficit over non-fast days (the engine's deficit_pct_7 definition; fast days are governed
  // by the tier rules, ruling 18:10)
  const mean7 = (): Float64Array => {
    const { kcal: k, fast } = intakeProfile(ctx, ed);
    const m = new Float64Array(T);
    for (let d = 0; d < T; d++) {
      let s = 0;
      let n = 0;
      for (let j = Math.max(0, d - 6); j <= d; j++) if (!fast[j]) {
        s += k[j]!;
        n++;
      }
      m[d] = n ? (100 * s) / n / caps.tdee0Kcal : 100;
    }
    return m;
  };
  for (const [thr, maxW, brk] of [
    [100 - cfg.highThresholdPct, cfg.highMaxWeeks, cfg.highBreakWeeksDefault],
    [100 - cfg.moderateLowPct, cfg.moderateMaxWeeks, cfg.moderateBreakWeeks],
  ] as const) {
    for (let guard = 0; guard < 8; guard++) {
      const m = mean7();
      let run = 0;
      let at = -1;
      for (let d = 0; d < T; d++) {
        run = m[d]! <= thr + PCT_EPS ? run + 1 : 0;
        if (run > maxW * 7) {
          at = d;
          break;
        }
      }
      if (at < 0) break;
      // the trailing mean lags the plan by up to a week: the break starts early enough for the run to end in time
      at = Math.max(0, at - 7);
      const end = Math.min(T, at + brk * 7);
      for (let d = at; d < end; d++) {
        const evs = ed.s.events ?? [];
        for (let i = evs.length - 1; i >= 0; i--) if (evs[i]!.startDay === d) dropEvent(ed, i, 'HC-E7');
        const t = ed.day(d);
        if (t.energy.kind === 'pctMaintenance' && t.energy.pct >= 100) continue;
        convertToNormal(ctx, ed, d, plan, 'HC-E7.day', 100);
      }
      ed.note('HC-E7', { day: at, amount: end - at });
    }
  }
}

/** HC-X2 novice RT ramp, HC-X3 sedentary volume ramp, B20 fibre ramp, L1 step ramp; ≥ 1 rest day per week. */
function ramps(ctx: PlanningContext, ed: Editor): void {
  const caps = ctx.caps;
  const rp = ctx.rp;
  const T = ed.s.horizonDays;
  const weekOf = (d: number) => Math.floor(d / 7);
  // weekly RT sets per region and weekly exercise minutes (moderate-equivalent) per calendar week of the plan
  const weeks = Math.ceil(T / 7);
  for (let w = 0; w < weeks; w++) {
    const from = w * 7;
    const to = Math.min(T, from + 7);
    let sets = 0;
    let minutes = 0;
    for (let d = from; d < to; d++) {
      for (const s of ed.day(d).exercise ?? []) {
        if (s.kind === 'resistance') {
          const v = Object.values(s.setsByRegion ?? {});
          sets += v.length ? Math.max(...v.map((x) => x ?? 0)) : 0;
          minutes += s.durationMin ?? 60;
        } else minutes += s.durationMin;
      }
    }
    const setCap = caps.rtNovice ? HC.rtNovice.startSetsMax + HC.rtNovice.setsIncreasePerWeek * w : Infinity;
    const minCap = caps.sedentaryStart ? HC.sedentary.startMinPerWeek * Math.pow(1 + HC.sedentary.increasePct / 100, w) : Infinity;
    const fSets = sets > setCap + 1e-6 ? setCap / sets : 1;
    const fMin = minutes > minCap + 1e-6 ? minCap / minutes : 1;
    if (fSets < 1 || fMin < 1) {
      for (let d = from; d < to; d++) {
        const ex = ed.day(d).exercise ?? [];
        if (!ex.length) continue;
        const scaled = ex.map((s) => {
          if (s.kind === 'resistance') {
            const f = Math.min(fSets, fMin);
            const sets2: ResistanceSession['setsByRegion'] = {};
            for (const [k, v] of Object.entries(s.setsByRegion ?? {})) sets2[k as keyof typeof sets2] = +((v ?? 0) * f).toFixed(3);
            return { ...s, setsByRegion: sets2, durationMin: Math.max(1, Math.floor((s.durationMin ?? 60) * f)) };
          }
          return { ...s, durationMin: Math.max(1, Math.floor(s.durationMin * fMin)) };
        });
        ed.patch(d, { exercise: scaled });
      }
      if (fSets < 1) ed.note('HC-X2', { day: from, amount: sets - setCap });
      if (fMin < 1) ed.note('HC-X3', { day: from, amount: minutes - minCap });
    }
    // ≥ 1 full rest day per week (17 §2.5)
    let active = 0;
    let last = -1;
    for (let d = from; d < to; d++) if ((ed.day(d).exercise ?? []).length) {
      active++;
      last = d;
    }
    if (to - from === 7 && active >= 7 && last >= 0) {
      ed.patch(last, { exercise: [] });
      ed.note('HC-X3', { day: last });
    }
  }
  // B20 fibre ramp (≤ +5 g/d per week from habitual) and L1 step ramp (≤ +1,000 steps/d per week)
  const habFibre = rp.habitualFibreG;
  const habSteps = rp.habits.typicalSteps;
  for (let d = 0; d < T; d++) {
    const t = ed.day(d);
    const w = weekOf(d);
    const fib = t.macros.fibre;
    if (fib && fib.unit === 'g') {
      const cap = habFibre + 5 * (w + 1);
      if (fib.value > cap + 1e-6 && t.energy.kind !== 'zero') {
        ed.patch(d, { macros: { ...t.macros, fibre: { unit: 'g', value: +cap.toFixed(1) } } });
        if (d % 7 === 0 || d === 0) ed.note('B20', { day: d, amount: fib.value - cap });
      }
    }
    if (t.steps !== undefined) {
      const cap = Math.max(habSteps, 0) + 1000 * (w + 1);
      if (t.steps > cap + 1e-6) {
        ed.patch(d, { steps: Math.round(cap) });
        if (d % 7 === 0) ed.note('L1.ramp', { day: d, amount: t.steps - cap });
      }
    }
  }
}

/**
 * Sessions never over a meal (QA item 9): the decoder places sessions against the planned meal clocks; when repair moved
 * a day's window or meal count, the day's sessions are moved to the nearest clear slot on the 15-minute grid.
 */
function sessionsClearOfMeals(ctx: PlanningContext, ed: Editor): void {
  const p = ctx.practical;
  const bedClock = p.bedH < 12 ? p.bedH + 24 : p.bedH;
  const cov = eventCoverage(ed.s);
  for (let d = 0; d < ed.s.horizonDays; d++) {
    const t = ed.day(d);
    const ex = t.exercise ?? [];
    // fast-touched days keep the fast rules' session placement
    if (!ex.length || t.energy.kind === 'zero' || cov[d]! > 0) continue;
    const meals = mealClocks(t);
    const start = Math.min(...ex.map((x) => x.startH));
    const end = Math.max(...ex.map((x) => x.startH + (x.durationMin ?? 60) / 60));
    if (!meals.some((m) => m > start - 1e-9 && m < end - 1e-9)) continue;
    // Ideal sleep genes (PLANNER_V2_SPEC §2.2): the day's own night bounds the waking day
    const own = p.idealGenes?.sleep ? t.sleep : undefined;
    const s0 = own ? placeTraining(meals, start, end - start, own.wakeH ?? p.wakeH, bedClockOf(own.bedH ?? p.bedH), 6) : placeTraining(meals, start, end - start, p.wakeH, bedClock, 6);
    if (Math.abs(s0 - start) < 1e-9) continue;
    const shift = s0 - start;
    ed.patch(d, { exercise: ex.map((x) => ({ ...x, startH: +(x.startH + shift).toFixed(4) })) });
    ed.note('consistency.sessionMeal', { day: d, amount: shift });
  }
}

/**
 * Ideal-only genes (PLANNER_V2_SPEC §2.2): the decoded night stays a 7-8.5-h sleep with clock values in [0, 24), and
 * every session ends ≥ 1 h before that night's bedtime and starts ≥ 1 h after waking (16 §4.2.6). The decoder already
 * places them so; this layer keeps hand-edited or transferred genomes inside the rule (logged `ideal.sleep` /
 * `ideal.sessionClock`).
 */
function idealGeneRules(ctx: PlanningContext, ed: Editor): void {
  const ig = ctx.practical.idealGenes;
  if (!ig?.sleep && !ig?.clock) return;
  const p = ctx.practical;
  if (ig.sleep) {
    for (let i = 0; i < ed.s.programs.length; i++) {
      const sl = ed.s.programs[i]!.sleep;
      if (!sl || sl.bedH === undefined || sl.wakeH === undefined) continue;
      const bed = mod24(sl.bedH);
      const dur = Math.min(IDEAL_SLEEP.maxH, Math.max(IDEAL_SLEEP.minH, sleepHoursOf(bed, mod24(sl.wakeH))));
      const wake = mod24(bed + dur);
      if (Math.abs(bed - sl.bedH) > 1e-9 || Math.abs(wake - sl.wakeH) > 1e-9) {
        ed.s.programs[i] = { ...ed.s.programs[i]!, sleep: { ...sl, bedH: +bed.toFixed(2), wakeH: +wake.toFixed(2) } };
        ed.note('ideal.sleep', { path: `programs[${i}].sleep` });
      }
    }
  }
  for (let d = 0; d < ed.s.horizonDays; d++) {
    const t = ed.day(d);
    const ex = t.exercise ?? [];
    if (!ex.length) continue;
    const bedClock = bedClockOf(t.sleep?.bedH ?? p.bedH);
    const wake = t.sleep?.wakeH ?? p.wakeH;
    const start = Math.min(...ex.map((x) => x.startH));
    const end = Math.max(...ex.map((x) => x.startH + (x.durationMin ?? 60) / 60));
    const over = end - (bedClock - SESSION_BEFORE_BED_H);
    if (over <= 1e-9) continue;
    const shift = -Math.min(over, Math.max(0, start - (wake + 1)));
    if (shift > -1e-9) continue;
    ed.patch(d, { exercise: ex.map((x) => ({ ...x, startH: +(x.startH + shift).toFixed(4) })) });
    ed.note('ideal.sessionClock', { day: d, amount: shift });
  }
}

/** Training only on allowed weekdays (user hard constraint). */
function trainingDays(ctx: PlanningContext, ed: Editor): void {
  const allowed = new Set(ctx.practical.allowedTrainingWeekdays);
  for (let d = 0; d < ed.s.horizonDays; d++) {
    const w = (ctx.startWeekday + d) % 7;
    if (allowed.has(w)) continue;
    const t = ed.day(d);
    if (t.exercise?.length) {
      ed.patch(d, { exercise: [] });
      ed.note('user.trainingWeekdays', { day: d });
    }
  }
}

/** Repair a decoded schedule. `plan` (the decoded description) improves zero-day conversions and logs decode notes. */
export function repairSchedule(ctx: PlanningContext, schedule: Schedule, plan?: DecodedPlan): { schedule: Schedule; log: RepairEntry[] } {
  const ed = new Editor(schedule);
  for (const n of plan?.notes ?? []) ed.log.push(n);
  const isBaseline = plan?.structureId === 'baseline';
  // blocks never proposed by the planner (defence in depth: the grammar already excludes them)
  for (const b of ed.s.blocks ?? []) {
    const id = b.buildingBlockId as keyof typeof BLOCKS | undefined;
    if (id && BLOCKS[id] && (BLOCKS[id].use === 'simulateOnly' || BLOCKS[id].use === 'registryOnly')) ed.note('tier.never', { path: 'blocks', day: b.startDay });
  }
  ed.s.programs = ed.s.programs.map((t, i) => repairTemplate(ctx, t, ed, i));
  if (!isBaseline) {
    fastRules(ctx, ed, plan);
    restrictedDays(ctx, ed);
    weeklyEnergy(ctx, ed, plan);
    deficitBreaks(ctx, ed, plan);
  }
  // day overrides can carry sessions, energy and macros (fast-adjacent, converted or raised days): same rules
  for (let d = 0; d < ed.s.horizonDays; d++) {
    const sd = ed.s.days[d]!;
    if (sd.override?.exercise?.length) sd.override.exercise = repairExercise(ctx, sd.override.exercise, ed, (f) => `days[${d}].${f}`);
    if (!sd.override?.macros && !sd.override?.energy) continue;
    const t = ed.day(d);
    const partial = !!sd.override.meals?.meals;
    const e0 = t.energy;
    fitFloorsEnergy(ctx, t, ed, `days[${d}].energy`, partial);
    if (t.energy !== e0) ed.patch(d, { energy: t.energy });
    const fixed = repairMacros(ctx, t, ed, sd.program, partial);
    if (fixed !== t.macros) ed.patch(d, { macros: fixed });
  }
  proteinFloors(ctx, ed);
  trainingDays(ctx, ed);
  if (!isBaseline) {
    ramps(ctx, ed);
    sessionsClearOfMeals(ctx, ed);
    idealGeneRules(ctx, ed);
  }
  return { schedule: ed.s, log: ed.log };
}
