/**
 * safety — planner hard-constraint margins from `result.safety` (docs/MODEL_SPEC.md §7.3, §10.1; dossier 17 §2.2).
 *
 * The planner treats the state-space HC-* constraints as normalised margins `m = (bound − value)/scale` with
 * `m ≥ 0` satisfied and the bound's natural unit as the scale (100 kcal, 5 %, 5 kcal/kg FFM, 0.25 %BW/wk, 5 %, 1 BMI
 * unit, 2 % BF). The minimum over days of each margin is the constraint's slack. Margins are `NaN` on days where the
 * constraint does not apply (the trace value is missing, or the regime is not a deficit). Pure function of the
 * SafetyTrace plus a few facts about the person, so the planner domain layer can call it on any result — including
 * aborted runs (days past the abort stay NaN).
 *
 * Input-space constraints (HC-E2, HC-M1…M12, HC-F1…F5, HC-X*) are the planner's `repair`, not evaluated here. HC-F2's
 * `fastH_7 ≤ 108 h` clause is included because the trace carries `fastH7`.
 */
import type {
  ConstraintAction,
  ConstraintMargin,
  ConstraintWindow,
  HardConstraintId,
  Severity,
  WarningMargin,
  WarningRuleId,
} from '../../types/events';
import { RULES, RULE_INDEX } from './rules';
import type { SafetyTrace } from '../../types/result';
import type { SafetyConstants } from './params';
import { defaultSafetyConstants } from './params';
import { bfFloorPct, deficitCapPct, energyFloorKcal, rateBoundPct, rateCapPct } from './derived';

/** Facts about the person the margins need (all known before the run). */
export interface ConstraintPerson {
  sex: 'male' | 'female';
  /** Age at day 0, years (advanced by day/365.25). */
  ageYears: number;
  heightM: number;
  /** Waist at t = 0 and WHtR (HC-E8), when known. */
  waistCm?: number;
  whtr?: number;
  /** Entered body weight, kg (W-E13 "plan-induced tissue loss" of the warning margins); default: day-0 tissue mass. */
  weightKg?: number;
}

export interface ConstraintOptions {
  /** Registry constants (defaults to the nominal registry). */
  constants?: SafetyConstants;
  /** 1 on days with planned exercise: HC-E4 applies "to any regime with exercise" (default: every day). */
  exerciseDays?: Uint8Array;
}

const NAN = Number.NaN;

function make(id: string, action: ConstraintAction, window: ConstraintWindow, n: number): ConstraintMargin {
  return { id: id as HardConstraintId, margin: new Float32Array(n).fill(NAN), action, window };
}

/** All state-space HC margins for one run: HC-E1, E3, E4, E5, E6, E7, E8, P4, P5 and the HC-F2 fastH_7 clause. */
export function computeConstraintMargins(
  trace: SafetyTrace,
  person: ConstraintPerson,
  opts: ConstraintOptions = {},
): ConstraintMargin[] {
  const k = opts.constants ?? defaultSafetyConstants();
  const n = trace.ei7.length;
  const female = person.sex === 'female';
  const floor = energyFloorKcal(k, female);
  const bfFloor = bfFloorPct(k, female);
  const e1 = make('HC-E1', 'CLIP', '7d', n);
  const e3 = make('HC-E3', 'CLIP', '7d', n);
  const e4 = make('HC-E4', 'CLIP', '7d', n);
  const e5 = make('HC-E5', 'CLIP', '14d', n);
  const e6 = make('HC-E6', 'CLIP', 'plan', n);
  const e7 = make('HC-E7', 'INSERT_BREAK', 'block', n);
  const e8 = make('HC-E8', 'CLIP', '14d', n);
  const p4 = make('HC-P4', 'REJECT', 'daily', n);
  const p5 = make('HC-P5', 'CLIP', 'daily', n);
  const f2 = make('HC-F2', 'REJECT', '7d', n);

  let run15 = 0;
  let run5 = 0;
  let bmiStart = NAN;
  let bfStart = NAN;
  let inDeficit = false;
  for (let d = 0; d < n; d++) {
    const def7 = trace.deficitPct7[d]!;
    const ei7 = trace.ei7[d]!;
    if (Number.isNaN(def7) || Number.isNaN(ei7)) continue; // day not evaluated (after an abort, or planner-skipped)
    const bmi = trace.bmi[d]!;
    const bf = trace.bodyFatPct[d]!;
    const tm = trace.tissueMassKg[d]!;
    const age = person.ageYears + d / 365.25;
    const deficit = def7 > k.deficitAnyPct;
    const surplus = def7 < -k.deficitAnyPct;

    // deficit spell bookkeeping (start-of-deficit clauses of HC-P4/P5, HC-E7 block lengths)
    if (deficit && !inDeficit) {
      bmiStart = bmi;
      bfStart = bf;
    }
    inDeficit = deficit;
    run15 = def7 >= k.blockDeficitPct ? run15 + 1 : 0;
    run5 = def7 > k.deficitAnyPct ? run5 + 1 : 0;

    if (deficit) {
      e1.margin[d] = (ei7 - floor) / k.scaleKcal;
      const cap = deficitCapPct(k, bmi, age, bf, bfFloor);
      e3.margin[d] = (cap - def7) / k.scalePct;
      const capPct = rateCapPct(k, bmi, age, bf, bfFloor, female);
      e5.margin[d] = (rateBoundPct(k, capPct, tm) - trace.rate14PctPerWk[d]!) / k.scaleRatePct;
      p4.margin[d] = Math.min((bmi - k.bmiProjectedMin) / k.scaleBmi, (bmiStart - k.bmiCaution) / k.scaleBmi);
      p5.margin[d] = Math.min(
        (bf - bfFloor) / k.scaleBf,
        (bfStart - bfFloor - k.bfStartMarginPts) / k.scaleBf,
      );
    }
    const ea7 = trace.ea7[d]!;
    if (!Number.isNaN(ea7) && (!opts.exerciseDays || opts.exerciseDays[d] === 1))
      e4.margin[d] = (ea7 - k.eaHardMin) / k.scaleEa;
    e6.margin[d] = (k.cumLossMaxPct - trace.cumLossPct[d]!) / k.scalePct;
    if (def7 >= k.blockDeficitPct) e7.margin[d] = (k.blockMaxDays - run15) / 7 / k.scaleWeeks;
    else if (def7 > k.deficitAnyPct) e7.margin[d] = (k.blockModerateMaxDays - run5) / 7 / k.scaleWeeks;

    if (surplus) {
      // HC-E8: EI <= 120 % TDEE; gain <= 0.5 %BW/wk (0.25 with WHtR 0.5-0.59); no planned gain with a high waist/WHtR/BMI
      const surplusPct = -def7; // def7 = 100·(1 − EI/TDEE), so the surplus 100·(EI/TDEE − 1) is its negative
      let m = (k.surplusMaxPct - surplusPct) / k.scalePct;
      const whtr = person.whtr ?? NAN;
      const gainCap = whtr >= k.whtrCaution && whtr < k.whtrHigh ? k.surplusGainCapWhtrPct : k.gainRateMaxPct;
      const gain = -trace.rate14PctPerWk[d]!;
      m = Math.min(m, (gainCap - gain) / k.scaleRatePct);
      const waistLimit = female ? k.waistCautionFemaleCm : k.waistCautionMaleCm;
      if ((person.waistCm ?? 0) > waistLimit || whtr >= k.whtrHigh || bmi >= k.capBmiHigh)
        m = Math.min(m, -1);
      e8.margin[d] = m;
    }
    // R-T4CAP: the 108-h cap counts T1-T3 fasting only (`fastH7Cap`; a single T4 fast follows its own tier rule)
    f2.margin[d] = (k.fastH7Max - (trace.fastH7Cap ? trace.fastH7Cap[d]! : trace.fastH7[d]!)) / k.scaleHours;
  }
  return [e1, e3, e4, e5, e6, e7, e8, p4, p5, f2];
}

/** Minimum over days (ignoring NaN) of one margin, and the first day it is reached; `NaN`/−1 when it never applied. */
export function worstMargin(m: ConstraintMargin): { value: number; day: number } {
  let value = NAN;
  let day = -1;
  for (let d = 0; d < m.margin.length; d++) {
    const v = m.margin[d]!;
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(value) || v < value) {
      value = v;
      day = d;
    }
  }
  return { value, day };
}

// ================================================================================================ R-PLAN-SAFETY

/**
 * Planner margins per Simulator warning (ruling R-PLAN-SAFETY, final round 2026-09-30): for every caution- or danger-level
 * warning that is evaluated on the simulated trajectory, a normalised per-day margin m = (bound − value)/scale that is at
 * least as strict as the rule — m ≥ 0 on every day ⇒ the warning does not fire. Where a rule needs persistence (a count of
 * days) the margin either mirrors the rule's own counter ((limit − run)/7 weeks) or bounds the level on every day, which
 * is stricter (energy availability: EA ≥ 35 whenever the EA rules apply, instead of "not 30-35 for > 14 days"). Days on
 * which a rule cannot apply are NaN. Mapping (id → margin → rules it guards):
 *   W-E01  (EI_floor − floor)/100 kcal ............................ W-E01 caution, W-E02 danger
 *   W-E03  (cap − deficitPct7)/5 %, every day ...................... W-E03 caution, W-E04 danger (warning: deficit days)
 *   W-E05  min((cap_pct − rate14Pct)/0.25, (1.5 − rate14Kg)/0.25) .. W-E05 caution, W-E06 danger
 *   W-E07  (EA7 − 35)/5 where EA applies (exercise + deficit) ...... W-E07, W-E20 caution, W-E08 danger
 *   W-E10  (84 − run(deficit ≥ 15 %))/7 wk ......................... W-E10 caution
 *   W-E11  (20 − cumLossPct)/5 % ................................... W-E11 caution, W-E12 danger
 *   W-E13  (BMI − 20)/1 after a > 1 % tissue loss, else (BMI − 18.5) W-E13 caution, W-E14 danger
 *   W-E15  (BF − 12 M / 20 F)/2 % .................................. W-E15 caution, W-E16 danger
 *   W-E18  women: min((28 − run(EA < 45))/7, (BF − 20)/2) ........... W-E18 caution
 *   W-M01  (protein/RW − 0.8)/0.1 g/kg (7-d, non-fast days) ......... W-M01 caution
 *   W-M06  min((fat%E − 15)/5, (fat g − 30)/10) with EI ≥ 800 ....... W-M06 caution
 *   W-S01  (0.5 + rate14Pct)/0.25 (gain ≤ 0.5 %BW/wk) ............... W-S01 caution
 *   W-S03  high waist/WHtR only: (deficitPct7 + 5)/5 (no surplus) ... W-S03 caution
 *   W-13-ALPERT (0.75·69·FM − deficit kcal)/100, every day .......... W-13-ALPERT caution (warning: deficit days)
 *   W-20-FAST-LEAN on days with a fast > 48 h: (BF − floor − 6)/2 ... W-20-FAST-LEAN caution
 *   W-F13  (108 − fastH7Cap)/24 h .................................. W-F13 caution (cap leg; the "≥ 3 fasts ≥ T2 in 14 d" leg
 *                                                                     is input-side, as are the fast tiers W-F01-F12)
 * Not covered here (input- or profile-side, the planner's repair and lever tiers): the macro/fluid/substance rules other
 * than W-M01/W-M06, the fast tiers and spacing (W-F01…W-F12, W-F14), exercise progression (W-X*), profile flags (W-P*),
 * header notes (W-U*); W-05-KETO-FED (BHB is not in the trace) and W-01-FATFLOOR (guarded by W-E15's BF margin).
 */
export function computeWarningMargins(
  trace: SafetyTrace,
  person: ConstraintPerson,
  opts: ConstraintOptions = {},
): WarningMargin[] {
  const k = opts.constants ?? defaultSafetyConstants();
  const n = trace.ei7.length;
  const female = person.sex === 'female';
  const floor = energyFloorKcal(k, female);
  const bfFloor = bfFloorPct(k, female);
  const bfCaution = female ? k.bfCautionFemale : k.bfCautionMale;
  const waistLimit = female ? k.waistCautionFemaleCm : k.waistCautionMaleCm;
  const highWaist = (person.waistCm ?? 0) > waistLimit || (person.whtr ?? 0) >= k.whtrCaution;
  const w0 = person.weightKg ?? trace.tissueMassKg[0]!;
  const mk = (id: WarningRuleId, unit: string): WarningMargin => ({
    id,
    severity: RULES[RULE_INDEX[id as keyof typeof RULE_INDEX]]!.severity as Severity,
    margin: new Float32Array(n).fill(NAN),
    unit,
  });
  const e01 = mk('W-E01', '100 kcal/d');
  const e03 = mk('W-E03', '5 % of TDEE');
  const e05 = mk('W-E05', '0.25 %BW/wk');
  const e07 = mk('W-E07', '5 kcal/kg FFM/d');
  const e10 = mk('W-E10', '1 week');
  const e11 = mk('W-E11', '5 % of the start weight');
  const e13 = mk('W-E13', '1 BMI unit');
  const e15 = mk('W-E15', '2 % body fat');
  const e18 = mk('W-E18', '1 week / 2 % body fat');
  const m01 = mk('W-M01', '0.1 g/kg reference weight');
  const m06 = mk('W-M06', '5 %E / 10 g');
  const s01 = mk('W-S01', '0.25 %BW/wk');
  const s03 = mk('W-S03', '5 % of TDEE');
  const alp = mk('W-13-ALPERT', '100 kcal/d');
  const lean = mk('W-20-FAST-LEAN', '2 % body fat');
  const f13 = mk('W-F13', '24 h');
  let run15 = 0;
  let runEa45 = 0;
  for (let d = 0; d < n; d++) {
    const ei = trace.ei7[d]!;
    const def7 = trace.deficitPct7[d]!;
    const fastDay = trace.fastDay ? trace.fastDay[d]! > 0 : false;
    const bmi = trace.bmi[d]!;
    const bf = trace.bodyFatPct[d]!;
    const tm = trace.tissueMassKg[d]!;
    const age = person.ageYears + d / 365.25;
    if (Number.isFinite(ei)) e01.margin[d] = (ei - floor) / k.scaleKcal;
    if (Number.isFinite(def7) && Number.isFinite(bmi)) {
      e03.margin[d] = (deficitCapPct(k, bmi, age, bf, bfFloor) - def7) / k.scalePct;
      const tdee7 = trace.tdee7[d]!;
      const fm = (bf * tm) / 100;
      if (Number.isFinite(tdee7)) alp.margin[d] = (k.alpertFraction * k.alpertKcalPerKgFm * fm - (tdee7 * def7) / 100) / k.scaleKcal;
      if (highWaist) s03.margin[d] = (def7 + k.deficitAnyPct) / k.scalePct;
    }
    if (!fastDay) run15 = Number.isFinite(def7) && def7 >= k.blockDeficitPct ? run15 + 1 : 0;
    e10.margin[d] = (k.blockMaxDays - run15) / 7;
    const rp = trace.rate14PctPerWk[d]!;
    const rk = trace.rate14KgPerWk[d]!;
    if (Number.isFinite(rp) && Number.isFinite(bmi)) {
      const cap = rateCapPct(k, bmi, age, bf, bfFloor, female);
      e05.margin[d] = Math.min((cap - rp) / k.scaleRatePct, (k.rateCapAbsKgWk - rk) / k.scaleRatePct);
      s01.margin[d] = (k.gainRateMaxPct + rp) / k.scaleRatePct;
    }
    const ea = trace.ea7[d]!;
    const eaApplies = Number.isFinite(ea) && (!trace.eee7 || trace.eee7[d]! > 0) && Number.isFinite(def7) && def7 > k.deficitAnyPct;
    if (eaApplies) e07.margin[d] = (ea - k.eaReducedUpper) / k.scaleEa;
    // the EA persistence counter pauses on fast-event days, as the rule's does (ruling R-FAST-GATE)
    if (!fastDay) runEa45 = eaApplies && ea < k.eaAdequate ? runEa45 + 1 : 0;
    e11.margin[d] = (k.cumLossMaxPct - trace.cumLossPct[d]!) / k.scalePct;
    if (Number.isFinite(bmi)) {
      const cumTm = w0 > 0 ? (100 * (w0 - tm)) / w0 : 0;
      e13.margin[d] = (bmi - (cumTm > k.bmiCautionMinLossPct ? k.bmiCaution : k.bmiUnderweight)) / k.scaleBmi;
    }
    if (Number.isFinite(bf)) {
      e15.margin[d] = (bf - bfCaution) / k.scaleBf;
      if (female) e18.margin[d] = Math.min((k.eaFemaleDays - runEa45 - 0.5) / 7, (bf - k.bfCautionFemale) / k.scaleBf);
      if (trace.fastHMax[d]! > k.tierT2MaxH) lean.margin[d] = (bf - (bfFloor + k.leanFastMarginPts)) / k.scaleBf;
    }
    const prot = trace.proteinGPerKgRw[d]!;
    if (Number.isFinite(prot)) m01.margin[d] = (prot - k.proteinFloor) / 0.1;
    const fatPct = trace.fatPctEnergy[d]!;
    if (Number.isFinite(fatPct) && Number.isFinite(ei) && ei >= k.vledKcal)
      m06.margin[d] = Math.min((fatPct - k.fatMinPctEnergy) / 5, ((fatPct * ei) / 900 - k.fatMinG) / 10);
    const fh = trace.fastH7Cap ? trace.fastH7Cap[d]! : trace.fastH7[d]!;
    if (Number.isFinite(fh)) f13.margin[d] = (k.fastH7Max - fh) / k.scaleHours;
  }
  return [e01, e03, e05, e07, e10, e11, e13, e15, e18, m01, m06, s01, s03, alp, lean, f13];
}
