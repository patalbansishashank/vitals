/**
 * Deterministic explanation templates (dossier 18 §4.12 naming, §4.17 explanations; no LLM, no backend). Numbers are
 * rounded to meaningful precision; hedging follows the evidence grade (A/B plain, C "the model suggests", D
 * "speculative"). Sequencing is never credited (MODEL_SPEC R-SEQ): diet breaks and refeeds are explained by hunger and
 * adherence only; fasting protocols carry their lean-mass cost (20 §4C).
 */
import type { Schedule } from '../../types/schedule';
import type { SimulationResult } from '../../types/result';
import { BLOCKS, type BlockId } from './registry/blocks';
import type { PlanningContext } from './context';
import type { DecodedPlan } from './decode';
import { descriptors } from './features';
import { estimateDay, mergeDay } from './dayMath';
import type { ConstraintNote, EvidenceGrade, HungerAssessment, PhaseExplanation } from './types';

const r1 = (x: number) => Math.round(x * 10) / 10;
const clock = (h: number) => {
  const hh = ((Math.floor(h) % 24) + 24) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
};

/** Plain-language text for repair / constraint rule ids (18 §4.14.2 binding constraints). */
export const RULE_TEXT: Record<string, string> = {
  'HC-E1': 'the minimum average daily intake (1,200 kcal women / 1,500 kcal men)',
  'HC-E2': 'the limits on very-low-energy days (at most 2 a week, never consecutive)',
  'HC-E3': 'the maximum safe energy deficit for your body',
  'HC-E3.28': 'the maximum safe energy deficit over four weeks, fast days included',
  'HC-E4': 'the minimum energy availability while training in a deficit (30 kcal per kg fat-free mass, kept at about 31)',
  'HC-E5': 'the maximum safe rate of weight loss',
  'HC-E6': 'the 20 % cap on total weight loss in one plan',
  'HC-E7': 'the rule of a maintenance break after 12 weeks of a larger deficit',
  'HC-E7.day': 'the rule of a maintenance break after 12 weeks of a larger deficit',
  'HC-E8': 'the surplus limits (at most 120 % of maintenance; weight gain at most 0.5 % of body weight a week, 0.25 % with a waist-to-height ratio of 0.5 or more)',
  'HC-P3': 'your safety mode (maintenance or surplus only)',
  'HC-P4': 'the minimum body-mass index',
  'HC-P5': 'the body-fat floor',
  'HC-M1': 'the protein floor',
  'HC-M2': 'the protein ceiling',
  'HC-M3': 'the fat floor (≥ 15 % of energy and ≥ 30 g)',
  'HC-M4': 'the carbohydrate floor for your profile',
  'HC-M10': 'no alcohol in planned days',
  'HC-M11': 'the caffeine limits',
  'HC-M12': 'the creatine limits',
  'HC-F1': 'your fasting tier',
  'HC-F2': 'the spacing rules between fasts',
  'HC-F3': 'the graded refeed after longer fasts',
  'HC-F4': 'no hard training during fasts',
  'HC-F5': 'the minimum daily eating window',
  'HC-X2': 'the gradual start for resistance-training beginners',
  'HC-X3': 'the gradual start for exercise volume',
  'HC-X4': 'your exercise restriction',
  'HC-X5': 'your exercise restriction in heat',
  'HC-X4/X5': 'your exercise restriction',
  'HC-E1.28d': 'the minimum average daily intake over four weeks',
  'HC-E3/E1': 'the maximum safe energy deficit and the minimum average daily intake',
  'HC-P3/P4': 'your safety mode (no deficit)',
  'HC-F3/F4': 'the graded refeed and no hard training around fasts',
  'tier.optIn': 'the options you opted into',
  'floors.energy': 'the minimum daily intake',
  'decode.energyEnvelope': 'the energy range your limits allow',
  'decode.lowDayEnvelope': 'the energy range for low-intake days',
  'decode.fast24Placement': 'the days available for 24-hour fasts',
  'decode.rtOnSpecialDay': 'keeping training off fast and low-intake days',
  'decode.eventPlacement': 'the days available for longer fasts',
  user: 'your own limits',
  'B14/B15': 'the maximum frequency of multi-day fasts',
  B20: 'the gradual fibre increase',
  'L1.ramp': 'the gradual step increase',
  'user.trainingWeekdays': 'your available training days',
  'user.eatingWindow': 'your eating-time limits',
  'user.meals': 'your meals-per-day limit',
  'user.maxSessionMin': 'your maximum session length',
  'user.excluded': 'the options you excluded',
  hungerCap: 'your hunger tolerance',
  gainRate: 'the rate of weight gain that still adds mostly muscle for your training status',
  'W-E07': 'keeping energy availability above 30 kcal per kg fat-free mass while training in a deficit (with a small margin)',
  'W-M06': 'the fat floor (at least 15 % of energy and 30 g a day)',
  'W-05-KETO-FED': 'keeping blood ketones moderate on eating days',
  'W-S03': 'a surplus of at most 5 % at your waist size (a larger surplus raises cardiometabolic risk)',
  'W-E01': 'the minimum average daily intake',
  'W-E03': 'the maximum energy deficit for your body',
  'W-E05': 'the maximum rate of weight loss',
  'W-E10': 'a maintenance break after 12 weeks of a larger deficit',
  'W-E11': 'the 20 % cap on total weight loss',
  'W-E13': 'staying clear of a BMI near the underweight range',
  'W-E15': 'staying clear of a low body-fat percentage',
  'W-M01': 'the protein minimum',
  'W-S01': 'the lean-gain rate of weight gain (0.25-0.5 % of body weight a week)',
  'W-13-ALPERT': 'the largest deficit your fat stores can supply (about 50 kcal per kg of body fat a day)',
  abort: 'a safety bound reached during the simulation',
  'consistency.mealSpacing': 'meal spacing of at least 3 hours',
  'consistency.energy': 'fitting the macros inside the day’s energy',
};

export function ruleText(rule: string): string {
  return RULE_TEXT[rule] ?? rule;
}

/** Evidence hedge (18 §4.17). */
export function hedge(grade: EvidenceGrade, sentence: string): string {
  if (grade === 'C') return `The model suggests that ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
  if (grade === 'D') return `Speculative (mechanistic or animal data): ${sentence}`;
  return sentence;
}

/**
 * Phases as the explanations show them: consecutive phases of the same block merged (check-in splits are not separate
 * phases), maintenance breaks of a cycle kept apart.
 */
export function mergedPhases(plan: DecodedPlan): DecodedPlan['phases'] {
  const merged: DecodedPlan['phases'] = [];
  for (const ph of plan.phases) {
    const last = merged[merged.length - 1];
    if (last && last.blockId === ph.blockId && last.endDay === ph.startDay) merged[merged.length - 1] = { ...last, endDay: ph.endDay };
    else merged.push(ph);
  }
  return merged;
}

/**
 * Option name from the plan's features (18 §4.12 naming rules; QA item 9: named by the true energy balance). With the
 * option's own simulation the energy % is read exactly as the phase names read it (the resolved intake over the
 * maintenance reference of the merged phase, rounded the same way), so the title and the phases always show the same %
 * (release check 2026-10-01); without it (provisional options during the run) the planned % is used.
 */
export function optionName(ctx: PlanningContext, s: Schedule, plan: DecodedPlan | undefined, sim?: SimulationResult): string {
  const b = descriptors(ctx, s);
  const blocks = plan ? plan.phases.map((p) => p.blockId) : [];
  const has = (id: BlockId) => blocks.includes(id);
  const events = s.events ?? [];
  const multi = events.some((e) => e.durationH > 24);
  const f24 = events.some((e) => e.durationH <= 24);
  if (plan?.structureId === 'baseline') return 'Keep current habits';
  // balance sequence of the (merged) phases, from the repaired schedule's planned % of maintenance
  const seq: Array<'deficit' | 'maintenance' | 'surplus'> = [];
  const pcts: number[] = [];
  for (const ph of plan ? mergedPhases(plan) : []) {
    if (ph.role === 'cycleOff' || ph.blockId === 'B8') continue;
    const act = phaseActuals(ctx, s, ph.startDay, ph.endDay, sim);
    const pct = act?.pct ?? ph.energyPct;
    const k = balanceOf(pct).kind;
    if (seq[seq.length - 1] !== k) seq.push(k);
    pcts.push(pct);
  }
  const main = pcts.length ? pcts[0]! : 100;
  const size = (p: number) => Math.abs(Math.round(p) - 100);
  let name: string;
  if (multi) name = 'Periodic multi-day fasts (opt-in)';
  else if (has('B12')) name = 'Alternate zero-energy days (opt-in)';
  else if (has('B11')) name = 'Two low-energy days a week';
  else if (f24) name = 'Weekly 24-hour fasts';
  else if (has('B3')) name = 'Short aggressive cut, then maintenance';
  else if (has('B8')) name = `Deficit blocks (−${size(main)} %) with maintenance breaks`;
  else {
    const key = seq.join('>');
    const sur = pcts.find((p) => p > 102.5);
    const def = pcts.find((p) => p < 97.5);
    if (key === 'surplus') name = sur !== undefined && size(sur) <= 10 ? `Lean gain: small surplus (+${size(sur)} %)` : `Surplus (+${size(sur ?? main)} %)`;
    else if (key === 'maintenance') name = plan && plan.lifestyle.rtSessions > 0 ? 'Recomposition at maintenance' : 'Maintenance';
    else if (key === 'deficit') name = plan?.phases.some((p) => p.refeedWeekdays.length) ? `Deficit (−${size(def ?? main)} %)` : `Steady deficit (−${size(def ?? main)} %)`;
    else if (key === 'deficit>maintenance') name = `Deficit (−${size(def ?? main)} %), then maintenance`;
    else if (key === 'surplus>deficit' || key === 'surplus>deficit>maintenance') name = 'Gain, then cut';
    else if (key === 'deficit>surplus') name = 'Cut, then gain';
    else if (key === 'maintenance>surplus' || key === 'surplus>maintenance') name = `Small surplus (+${size(sur ?? main)} %) and maintenance`;
    else name = 'Varied energy phases';
  }
  if (plan?.phases.some((p) => p.refeedWeekdays.length)) name += ' with weekly refeed days';
  if (has('B2')) name += ' · very-low-carbohydrate';
  else if (has('B6')) name += ' · very-low-fat';
  // 18 §4.12 carbohydrate tags, applied to the carbohydrate energy share (b₂ × 0.6): ≥ 55 % high, ≤ 15 % low
  else if (b[1]! * 0.6 >= 0.55) name += ' · high-carbohydrate';
  else if (b[1]! * 0.6 <= 0.15) name += ' · low-carbohydrate';
  if (s.days.some((d) => s.programs[d.program]?.meals?.window?.lengthH !== undefined && s.programs[d.program]!.meals!.window!.lengthH <= 8)) name += ' · time-restricted eating';
  return name;
}

/** Short distinguishing tags of a plan for unique names (18 §4.12 "most distinguishing feature"). */
export function distinguishingTags(s: Schedule, plan: DecodedPlan | undefined): string[] {
  const tags: string[] = [];
  const ev = (s.events ?? []).length;
  if (ev) tags.push(`${ev} fasts`);
  if (plan) {
    const ls = plan.lifestyle;
    if (plan.phases.some((p) => p.blockId === 'B22' || p.blockId === 'B8')) tags.push('with maintenance weeks');
    tags.push(`${Math.round(ls.windowLengthH)}-h eating window`);
    tags.push(`resistance training ${ls.rtSessions}×/week`);
    tags.push(`${Math.round(ls.cardioSessions * ls.cardioMinutes)} min cardio/week`);
  }
  return tags;
}

/** Make names unique by appending the most distinguishing feature (18 §4.12). */
export function uniqueNames(names: string[], extras: string[][]): string[] {
  const out = names.slice();
  for (let i = 0; i < out.length; i++) {
    const dup = out.some((n, j) => j !== i && n === out[i]);
    if (!dup) continue;
    const ex = extras[i]?.find((e) => !out.some((n, j) => j !== i && n.includes(e)));
    out[i] = `${out[i]} · ${ex ?? `option ${String.fromCharCode(65 + i)}`}`;
  }
  return out;
}

function trainingSummary(plan: DecodedPlan, ph: DecodedPlan['phases'][number]): string {
  const ls = plan.lifestyle;
  const parts: string[] = [];
  if (ph.rtWeekdays.length && ls.rtSessions > 0) parts.push(`resistance training ${ph.rtWeekdays.length}×/week (${Math.round(ls.rtSetsPerRegionWeek)} hard sets per muscle group per week)`);
  if (ph.cardioWeekdays.length && ls.cardioSessions > 0) parts.push(`cardio ${ph.cardioWeekdays.length}× ${Math.round(ls.cardioMinutes)} min`);
  parts.push(`${Math.round(ls.steps / 500) * 500} steps/day`);
  return parts.join(', ');
}

/**
 * Planned (repaired) energy % and protein g/kg RW of a phase's plain eating days, from the final schedule; with the
 * simulation, also the resolved intake and maintenance reference (R-MAINT series `inEnergy` / `inMaintRef`), so the
 * % is the true planned balance at the plan's own activity.
 */
function phaseActuals(ctx: PlanningContext, s: Schedule | undefined, from: number, to: number, sim?: SimulationResult): { pct: number; protein: number; kcal: number | null } | null {
  if (!s) return null;
  const refs = { maintenanceKcal: ctx.rp.tdee0Kcal, bwKg: ctx.rp.weightKg, ffmKg: ctx.rp.ffm0Kg };
  const ei = sim?.daily.inEnergy;
  const ref = sim?.daily.inMaintRef;
  let pct = 0;
  let prot = 0;
  let n = 0;
  let eiSum = 0;
  let refSum = 0;
  let m = 0;
  for (let d = from; d < Math.min(to, s.horizonDays); d++) {
    const sd = s.days[d]!;
    const t = mergeDay(s.programs[sd.program]!, sd.override);
    if (sd.override?.meals?.meals || t.energy.kind !== 'pctMaintenance' || t.label.includes('refeed day')) continue;
    const e = estimateDay(t, refs);
    pct += t.energy.pct;
    prot += e.proteinG / ctx.caps.rwKg;
    n++;
    const a = ei?.[d];
    const b = ref?.[d];
    if (a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) && b > 0) {
      eiSum += a;
      refSum += b;
      m++;
    }
  }
  if (!n) return null;
  return m ? { pct: (100 * eiSum) / refSum, protein: prot / n, kcal: eiSum / m } : { pct: pct / n, protein: prot / n, kcal: null };
}

/** Planned energy balance of a phase, from its actual % of maintenance. */
export function balanceOf(pct: number): { kind: 'deficit' | 'maintenance' | 'surplus'; label: string } {
  const r = Math.round(pct);
  if (r <= 97) return { kind: 'deficit', label: `deficit ${100 - r} %` };
  if (r >= 103) return { kind: 'surplus', label: `surplus ${r - 100} %` };
  return { kind: 'maintenance', label: 'maintenance' };
}

/**
 * Energy reference phrase for phase summaries. Once the engine resolves "% of maintenance" against maintenance for the
 * scheduled activity (ruling R-MAINT), added training no longer creates a hidden deficit; before that, the phrase says so.
 */
export function maintenancePhrase(addedExercise: boolean, scheduledActivity: boolean): string {
  if (scheduledActivity) return 'of your maintenance with this plan’s training and steps (re-set every 4 weeks)';
  return `of your maintenance at your usual activity${addedExercise ? ', so the added training and steps enlarge the deficit' : ''} (re-set every 4 weeks)`;
}

/** The engine's "% of maintenance" includes the scheduled activity (ruling R-MAINT, landed 2026-09-30). */
export const ENERGY_REFERENCE = { scheduledActivity: true };

/** Measurable phase name (QA item 9: composition, never a diet brand name). */
export function phaseName(ph: { blockId: BlockId; carbG: number | null; lowKcal: number | null; zeroPerWeek: number; role?: string }, pct: number, protein: number, weeks: number): string {
  const bal = balanceOf(pct);
  const head = bal.kind === 'maintenance' ? 'Maintenance' : bal.kind === 'deficit' ? `Deficit ${100 - Math.round(pct)} %` : `Surplus ${Math.round(pct) - 100} %`;
  const p = `protein ${r1(protein)} g/kg`;
  switch (ph.blockId) {
    case 'B8':
      return `Maintenance break (${r1(weeks)} week${weeks === 1 ? '' : 's'})`;
    case 'B11':
      return `Two ${Math.round(ph.lowKcal ?? 600)}-kcal days a week, other days ${Math.round(pct)} %`;
    case 'B12':
      return `${ph.zeroPerWeek} zero-energy days a week, other days ${Math.round(pct)} %`;
    case 'B2':
      return `${head} · net carbohydrate ${Math.round(ph.carbG ?? 30)} g/day · ${p}`;
    case 'B6':
      return `${head} · fat 15 % of energy · ${p}`;
    default:
      return `${head} · ${p}`;
  }
}

/** Plain-language "why" of a phase from its actual numbers and the ranked goals (never crediting sequencing, R-SEQ). */
function phaseWhy(ctx: PlanningContext, blockId: BlockId, pct: number, protein: number, carbG: number | null, isLast: boolean, phases: number, refeed?: { days: number; weekPct: number }): string {
  const bal = balanceOf(pct);
  const has = (c: string) => ctx.classRank[c as keyof typeof ctx.classRank] !== undefined;
  const d = 100 - Math.round(pct);
  const sur = Math.round(pct) - 100;
  const p = r1(protein);
  switch (blockId) {
    case 'B1':
    case 'B24':
    case 'B3':
      if (refeed && refeed.days > 0)
        return `A ${d} % energy deficit on most days with ${refeed.days} refeed day${refeed.days > 1 ? 's' : ''} a week (about ${100 - Math.round(refeed.weekPct)} % below maintenance over the week), protein at ${p} g/kg to protect lean tissue; fat loss follows the weekly deficit, and the refeed days ease hunger (see Evidence › Hormones and appetite) without adding fat loss of their own.`;
      return `A steady ${d} % energy deficit with protein at ${p} g/kg to protect lean tissue; fat loss follows the size of the deficit.`;
    case 'B2':
      return `Net carbohydrate at ${Math.round(carbG ?? 30)} g/day so the body runs mainly on fat and ketones${has('transient') ? ', which serves your ketone or autophagy-signal goal' : ''}; ${bal.kind === 'deficit' ? `the ${d} % deficit, not the carbohydrate level, drives the fat loss` : 'energy stays at maintenance'}.`;
    case 'B6':
      return `Fat at the 15 %-of-energy floor with most energy from carbohydrate${has('lipids') ? ', which lowers LDL and ApoB (your ranked goal)' : ''}; ${bal.kind === 'deficit' ? `fat loss follows the ${d} % deficit, not the macro split` : 'energy stays at maintenance'}.`;
    case 'B11':
      return 'Two non-consecutive low-energy days deliver most of the weekly deficit; the same weekly deficit spread evenly gives the same fat loss.';
    case 'B12':
      return 'Zero-energy days deliver the weekly deficit; they give no fat-loss advantage over the same deficit spread evenly and cost slightly more lean tissue (see Evidence › Extended water fasting).';
    case 'B23':
      return `A small ${sur} % surplus with protein at ${p} g/kg and resistance training: in resistance-trained people (Helms 2023) +5 % and +15 % surpluses built the same muscle, and extra energy beyond that goes mostly to fat (see Evidence › Energy surplus).`;
    case 'B21':
      return `A ${sur} % surplus with protein at ${p} g/kg and resistance training, so the extra energy supports muscle gain; surpluses above about 10 % add mostly fat (see Evidence › Energy surplus).`;
    case 'B8':
      return 'A short stretch at maintenance: it lowers hunger and diet fatigue. It is not expected to add fat loss by itself.';
    case 'B22':
      return isLast ? 'Maintenance at the end, so the plan finishes weight-stable and the result can be held.' : 'A stretch at maintenance with protein kept high.';
    case 'B0':
      if (phases > 1) return isLast ? 'Maintenance at the end, so the plan finishes weight-stable and the result can be held.' : 'A stretch at maintenance.';
      return has('muscle')
        ? `Eating at maintenance with protein at ${p} g/kg while resistance training builds muscle (recomposition: trained people can gain muscle at maintenance, more slowly than in a small surplus; see Evidence › Resistance training and muscle).`
        : 'Eating at maintenance while the training and lifestyle levers work on your goals.';
    default:
      return BLOCKS[blockId].rationale;
  }
}

export function phaseExplanations(ctx: PlanningContext, plan: DecodedPlan, schedule?: Schedule, sim?: SimulationResult): PhaseExplanation[] {
  const out: PhaseExplanation[] = [];
  const ls = plan.lifestyle;
  const habitSessions = ctx.rp.habits.sessionsPerWeek;
  const addedExercise = ls.rtSessions + ls.cardioSessions > habitSessions || ls.steps > ctx.rp.habits.typicalSteps + 999;
  const eat = `eating ${clock(ls.windowStartH)}-${clock(ls.windowStartH + ls.windowLengthH)}, ${ls.meals} meals`;
  // merge consecutive phases of the same block (check-in splits are not separate phases)
  const merged = mergedPhases(plan);
  merged.forEach((ph, k) => {
    const blk = BLOCKS[ph.blockId];
    const bits: string[] = [];
    const act = phaseActuals(ctx, schedule, ph.startDay, ph.endDay, sim);
    const pctRaw = act?.pct ?? ph.energyPct;
    const pct = Math.round(pctRaw);
    const protein = act?.protein ?? ph.proteinGPerKg;
    const maint = maintenancePhrase(addedExercise, ENERGY_REFERENCE.scheduledActivity);
    if (ph.blockId === 'B11') bits.push(`two non-consecutive days at ${Math.round(ph.lowKcal ?? 600)} kcal, other days ${pct} % ${maint}`);
    else if (ph.blockId === 'B12') bits.push(`${ph.zeroPerWeek} zero-energy days a week (water and electrolytes), other days ${pct} % ${maint}`);
    else bits.push(`energy ${pct} % ${maint}${act?.kcal ? ` (about ${Math.round(act.kcal / 10) * 10} kcal/day)` : ''}`);
    bits.push(`protein ${r1(protein)} g/kg`);
    if (ph.carbG !== null) bits.push(`net carbohydrate ${Math.round(ph.carbG)} g/day, fat the rest`);
    else if (ph.blockId === 'B6') bits.push('fat 15 % of energy, carbohydrate the rest');
    else if (ph.fatGPerKg !== null) bits.push(`fat ${r1(ph.fatGPerKg)} g/kg, carbohydrate the rest`);
    if (ph.refeedWeekdays.length) {
      const n = ph.refeedWeekdays.length;
      const weekMean = ((7 - n) * pctRaw + n * ls.refeedPct) / 7;
      bits.push(`${n} refeed day${n > 1 ? 's' : ''} a week at ${Math.round(ls.refeedPct)} % (about ${Math.round(weekMean)} % over the week)`);
    }
    if (ph.fast24Weekdays.length) bits.push(`${ph.fast24Weekdays.length} × 24-hour fast a week`);
    bits.push(trainingSummary(plan, ph), eat);
    const weeks = r1((ph.endDay - ph.startDay) / 7);
    const nRef = ph.refeedWeekdays.length;
    let why = phaseWhy(ctx, ph.blockId, pctRaw, protein, ph.carbG, k === merged.length - 1, merged.length, nRef ? { days: nRef, weekPct: ((7 - nRef) * pctRaw + nRef * ls.refeedPct) / 7 } : undefined);
    if (ph.blockId === 'B0' && merged.length === 1 && plan.structureId !== 'baseline' && addedExercise && !ENERGY_REFERENCE.scheduledActivity)
      why = 'Eating as usual while the added training and steps create the energy deficit.';
    out.push({ name: phaseName(ph, pctRaw, protein, weeks), blockId: ph.blockId, startDay: ph.startDay, endDay: ph.endDay, weeks, summary: `${bits.join('; ')}.`, why: `${why} ${blk.tradeoffs}`.trim() });
  });
  if (plan.events.some((e) => e.lever === 'waterFast')) {
    const ev = plan.events.filter((e) => e.lever === 'waterFast');
    const blockId: BlockId = ev[0]!.nominalH > 72 ? 'B16' : ev[0]!.nominalH > 48 ? 'B15' : 'B14';
    out.push({
      name: `${ev[0]!.nominalH}-hour water-only fast × ${ev.length}`,
      blockId,
      startDay: ev[0]!.startDay,
      endDay: Math.max(...ev.map((e) => e.recoveryDays[e.recoveryDays.length - 1] ?? e.startDay)) + 1,
      weeks: 0,
      summary: `Starts after the last meal (${clock(ev[0]!.startH)}); water, electrolytes (sodium ≈ 2 g/day) and 2-3 L fluids; no training on fast and recovery days${ev[0]!.nominalH > 72 ? '; the following days are a locked graded refeed (≈ 50 %, 50 %, 75 % of maintenance)' : ev[0]!.nominalH > 48 ? '; the first two days after it are a graded refeed (≈ 50 % then ≈ 90 %)' : ''}.`,
      why: `${BLOCKS[blockId].rationale} ${BLOCKS[blockId].tradeoffs}`,
    });
  }
  return out;
}

/**
 * Goal-specific explanation sentences (QA item 9): the autophagy index's confidence and its cost for muscle (08 §4.10,
 * §4.15), the hunger levers actually used (12 §4.9: protein, fibre, energy density, diet breaks — sequencing earns
 * nothing), and the strength prescription (09 §4.2/§4.3, 10 §4.11).
 */
export function goalNotes(ctx: PlanningContext, plan: DecodedPlan, schedule: Schedule): string[] {
  const out: string[] = [];
  const ls = plan.lifestyle;
  const rank = (id: string) => ctx.goals.findIndex((g) => g.metric === id);
  const muscleRank = ctx.classRank.muscle ?? Infinity;
  const fasts = (schedule.events ?? []).map((e) => e.durationH);
  const longest = fasts.length ? Math.max(...fasts) : 0;
  const dailyFast = Math.round(24 - ls.windowLengthH);
  const iA = rank('autophagyIdx');
  if (iA >= 0) {
    const L = ls.windowLengthH;
    const compat =
      L >= 10 ? 'fully compatible with muscle gain' : L >= 8 ? 'compatible with muscle gain when protein of at least 1.6 g/kg is spread over 3 or more meals' : L >= 6 ? 'a mild conflict with muscle gain' : 'a conflict with muscle gain';
    let t = `Goal ${iA + 1} (autophagy signal) is a relative, conditions-based index with low confidence (grade C/D): it is not a measurement of autophagy in your cells (see Evidence › Autophagy and nutrient-sensing pathways). The daily fast of about ${dailyFast} h raises it by a few points and is ${compat}.`;
    if (longest > 24) t += ` The ${Math.round(longest)}-hour fasts raise it most but cost lean tissue (a strong conflict with muscle gain).`;
    else if (longest > 20) t += ' The 24-hour fasts raise it further at a moderate lean-tissue cost.';
    else if (muscleRank < iA) t += ' Because you ranked muscle above it, no fast longer than a day is used.';
    out.push(t);
  }
  const iH = rank('hunger');
  if (iH >= 0) {
    const levers: string[] = [`protein ${r1(avgProtein(ctx, schedule))} g/kg`, `fibre ${Math.round(ls.fibreG + ls.viscousG)} g/day`];
    if (plan.phases.some((p) => p.blockId === 'B8')) levers.push('maintenance breaks');
    if (plan.phases.some((p) => p.refeedWeekdays.length)) levers.push('refeed days');
    if (ls.meals >= 3) levers.push(`${ls.meals} meals a day`);
    out.push(`Goal ${iH + 1} (hunger) is served by ${levers.join(', ')} and the size of the deficit; meal order and timing earn nothing extra (see Evidence › Hormones and appetite).`);
  }
  const iS = rank('strength');
  if (iS >= 0 && ls.rtSessions > 0) {
    const cardio = ls.cardioSessions > 0 ? `${ls.cardioSessions} × ${Math.round(ls.cardioMinutes)} min ${ctx.practical.cardioModality}` : 'none';
    out.push(`Goal ${iS + 1} (strength): ${Math.round(ls.rtSetsPerRegionWeek)} hard sets per muscle group a week over ${ls.rtSessions} sessions (strength gains level off above about 4-5 sets; more sessions help; see Evidence › Resistance training and muscle); cardio ${cardio}, which studies of combined training find does not blunt strength at this dose (see Evidence › Cardio, daily movement and activity energy).`);
  }
  return out;
}

function avgProtein(ctx: PlanningContext, s: Schedule): number {
  const a = phaseActuals(ctx, s, 0, s.horizonDays);
  return a ? a.protein : 0;
}

export function hungerAssessment(ctx: PlanningContext, sim: SimulationResult): HungerAssessment {
  const h = sim.daily.hunger;
  const ad = sim.final.adherence;
  if (!h || !h.length || !Number.isFinite(h[0]!)) {
    return { meanIdx: NaN, peak7Idx: NaN, daysAboveTolerance: 0, adherencePct: ad ?? NaN, rating: 'unknown', text: 'Hunger is not yet modelled (appetite module pending).' };
  }
  let s = 0;
  let above = 0;
  let peak = -Infinity;
  const tol = 100 * ctx.practical.hTol;
  for (let d = 0; d < h.length; d++) {
    s += h[d]!;
    if (h[d]! > tol) above++;
    if (d >= 6) {
      let w = 0;
      for (let k = d - 6; k <= d; k++) w += h[k]!;
      peak = Math.max(peak, w / 7);
    }
  }
  const mean = s / h.length;
  if (!Number.isFinite(peak)) peak = mean;
  const rating: HungerAssessment['rating'] = mean <= tol - 10 ? 'low' : mean <= tol ? 'moderate' : 'high';
  const text =
    rating === 'low'
      ? 'Hunger should stay comfortably within your tolerance.'
      : rating === 'moderate'
        ? `Hunger stays near your tolerance${above ? `, above it on about ${above} days` : ''}.`
        : `Expect noticeable hunger: above your tolerance on about ${above} days.`;
  return { meanIdx: r1(mean), peak7Idx: r1(peak), daysAboveTolerance: above, adherencePct: ad ?? NaN, rating, text };
}

/** Safety notes shown with an option (17 wording; 20 §4C lean cost of fasting; scale-weight caveats). */
export function safetyNotes(ctx: PlanningContext, s: Schedule, plan: DecodedPlan | undefined): string[] {
  const out = [...ctx.caps.reasons];
  const blocks = new Set(plan?.phases.map((p) => p.blockId) ?? []);
  const evs = s.events ?? [];
  if (evs.some((e) => e.durationH > 24)) {
    out.push('Multi-day fasts cost some lean tissue (about 270 g of protein per 72-h fast, partly regained) and give no fat-loss advantage over the same weekly deficit (see Evidence › Extended water-only fasting).');
    out.push('Stop the fast and start the refeed if you faint or nearly faint, have chest pain or an irregular heartbeat, new confusion or difficulty speaking, a severe headache, vomiting or diarrhoea over 6 hours, cramps or tremor, severe abdominal or flank pain, or a hot swollen joint.');
  }
  if (evs.some((e) => e.durationH <= 24) || blocks.has('B12')) out.push('Fasting days deliver part of the weekly deficit; they add no metabolic benefit and cost slightly more lean tissue than the same deficit spread evenly (see Evidence › Extended water-only fasting).');
  if (blocks.has('B2')) out.push('Very-low-carbohydrate eating often raises LDL cholesterol; consider a lipid check after 3-6 weeks. Expect 1.5-2.5 kg of water to leave in the first week and return later.');
  if (plan && plan.lifestyle.creatineG > 0) out.push('Creatine adds about 1 kg of water to scale weight; this is not fat.');
  if (blocks.has('B9') || plan?.phases.some((p) => p.refeedWeekdays.length)) out.push('Scale weight rises 0.5-1.5 kg after a refeed day from glycogen and water, and falls again within 2-4 days.');
  if (ctx.goals.some((g) => g.useTissueMass)) out.push('Weight goals are judged on trend weight (fat and lean tissue), not on day-to-day scale readings, so water swings cannot be used to game the result.');
  out.push('These are model projections for an average person with your inputs, not medical advice.');
  return [...new Set(out)];
}

/** Binding constraints from the repair log and the state-space margins (18 §4.14.2). */
export function bindingNotes(log: ReadonlyArray<{ rule: string; day?: number }>, horizonDays: number, margins: ArrayLike<number>, marginIds: readonly string[]): ConstraintNote[] {
  const days = new Map<string, Set<number>>();
  const plain = new Map<string, number>();
  for (const e of log) {
    if (e.rule.startsWith('decode.')) continue;
    if (e.day === undefined) {
      plain.set(e.rule, (plain.get(e.rule) ?? 0) + 1);
      continue;
    }
    let s = days.get(e.rule);
    if (!s) days.set(e.rule, (s = new Set()));
    s.add(e.day);
  }
  const out: ConstraintNote[] = [];
  for (const [rule, s] of days) {
    const share = s.size / Math.max(1, horizonDays);
    if (share >= 0.2 || rule.startsWith('HC-F') || rule === 'HC-E7') out.push({ rule, share, text: `Limited by ${ruleText(rule)}.` });
  }
  for (const [rule] of plain) if (!rule.startsWith('consistency') && !out.some((o) => o.rule === rule)) out.push({ rule, share: 1, text: `Shaped by ${ruleText(rule)}.` });
  for (let i = 0; i < margins.length; i++) {
    const m = margins[i]!;
    if (m >= 0 && m < 0.1 && marginIds[i] !== 'abort') out.push({ rule: marginIds[i]!, share: 1, text: `Close to ${ruleText(marginIds[i]!)}.` });
  }
  return out.sort((a, b) => b.share - a.share || (a.rule < b.rule ? -1 : 1)).slice(0, 5);
}
