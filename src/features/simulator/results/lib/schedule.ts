/**
 * Schedule → chart context: phase bands (named blocks, or runs of repeating weeks / programs) and the intake context
 * of the inputs lane (realised macros per day from the engine's input echo series, the moving maintenance line,
 * steps, and — from the compiled schedule — meals, eating windows, training sessions and sleep for the day view).
 */
import type { CompiledSchedule, Schedule, SimulationResult } from '@/engine';
import type { DayWindow, ExerciseSession, IntakeContext, MacroSeries, Meal, Phase, PhaseTone } from '@/features/charts';
import { balanceLabel } from '../../lib/energy';

const WALK_MODALITY = 1;

/** Tone of a block from its mean energy as a fraction of maintenance (tokens §8 steps; zero intake → fast). */
export function phaseTone(fraction: number): PhaseTone {
  if (!Number.isFinite(fraction)) return 'neutral';
  if (fraction <= 0.02) return 'fast';
  const d = Math.abs(1 - fraction);
  const side = fraction < 1 ? 'deficit' : 'surplus';
  if (d < 0.03) return 'neutral';
  const step = d <= 0.1 ? 1 : d <= 0.2 ? 2 : d <= 0.35 ? 3 : 4;
  return `${side}-${step}` as PhaseTone;
}

function meanFraction(energy: Float32Array | undefined, maint: Float32Array | undefined, a: number, b: number): number {
  if (!energy || !maint) return Number.NaN;
  let e = 0;
  let m = 0;
  for (let d = a; d < b; d++) {
    e += energy[d] ?? 0;
    m += maint[d] ?? 0;
  }
  return m > 0 ? e / m : Number.NaN;
}

/** Auto names of energy regimes; such blocks are labelled by their true balance. */
const REGIME = new Set(['deficit', 'maintenance', 'surplus']);

/** First words that carry a block's meaning on their own; a modifier ("Small", "very", "long") does not. */
const MEANINGFUL_FIRST = /^(fasting|fast|deficit|maintenance|surplus|refeed|training|lifting|rest|cut|bulk|diet)$/i;

/**
 * Honest short form: the first word when it keeps the meaning ("fasting block" → "fasting"), never a clipped word or a
 * lone modifier (QA: a planner block "Small surplus with resistance training …" was labelled just "Small").
 */
function shortOf(label: string): string | undefined {
  const words = label.split(/\s+/);
  if (words.length < 2) return undefined;
  const first = words[0]!.replace(/[,:;·]+$/, '');
  return MEANINGFUL_FIRST.test(first) ? first : undefined;
}

/**
 * Chart phases. Named `schedule.blocks` win; otherwise consecutive whole weeks with the same 7-day program pattern
 * form a block, named after its single program ("training day") or its energy regime ("deficit", "maintenance",
 * "surplus", "fasting block") — never a clipped user label. With the compiled schedule, planned fasts are part of a
 * week's pattern and a block with a fast (≥ 20 h on a day) is a "fasting block", exactly as the schedule's phase column
 * splits them (`lib/phases.ts`), so the two screens show the same blocks and percentages.
 */
export function schedulePhases(
  schedule: Schedule | null | undefined,
  result: SimulationResult,
  compiled?: CompiledSchedule | null,
): Phase[] {
  const n = result.meta.nDays;
  const energy = result.daily.inEnergy;
  // R-MAINT: blocks are toned and labelled against the maintenance reference at the activity the schedule plans
  // (`inMaintRef`); the engine's moving maintenance at habitual activity is the fallback for older results
  const maint = (result.daily as Partial<Record<string, Float32Array>>).inMaintRef ?? result.daily.maintenance;
  if (!schedule || n <= 0) return [];
  const mk = (startDay: number, endDay: number, label: string): Phase => {
    const f = meanFraction(energy, maint, startDay, endDay);
    const balance = balanceLabel(100 * f);
    // an auto-named regime block ("deficit") is named by its balance outright ("deficit 18 %")
    if (Number.isFinite(f) && REGIME.has(label)) return { startDay, endDay, label: balance, shortLabel: label, tone: phaseTone(f) };
    return { startDay, endDay, label, shortLabel: shortOf(label) ?? (Number.isFinite(f) ? balance : undefined), tone: phaseTone(f), ...(Number.isFinite(f) && balance !== label ? { balance } : {}) };
  };
  if (schedule.blocks && schedule.blocks.length) {
    return [...schedule.blocks]
      .filter((b) => b.endDay > b.startDay && b.startDay < n)
      .sort((a, b) => a.startDay - b.startDay)
      .map((b) => mk(Math.max(0, b.startDay), Math.min(n, b.endDay), b.name));
  }
  const programOf = (d: number) => schedule.days[d]?.program ?? 0;
  const fastH = (d: number) => compiled?.days[d]?.fastHours ?? 0;
  const weekKey = (w: number) => {
    const out: string[] = [];
    for (let d = w * 7; d < Math.min(n, w * 7 + 7); d++)
      out.push(`${programOf(d)}${schedule.days[d]?.override ? '*' : ''}${fastH(d) > 0 ? `f${fastH(d)}` : ''}`);
    return out.join(',');
  };
  const weeks = Math.ceil(n / 7);
  const out: Phase[] = [];
  let w = 0;
  while (w < weeks) {
    const key = weekKey(w);
    let w1 = w;
    while (w1 + 1 < weeks && (weekKey(w1 + 1) === key || (w1 + 1 === weeks - 1 && key.startsWith(weekKey(w1 + 1))))) w1++;
    const a = w * 7;
    const b = Math.min(n, (w1 + 1) * 7);
    const programs = new Set<number>();
    for (let d = a; d < b; d++) programs.add(programOf(d));
    const f = meanFraction(energy, maint, a, b);
    let label: string;
    let fastBlock = false;
    for (let d = a; d < b && !fastBlock; d++) if (fastH(d) >= 20) fastBlock = true;
    if (fastBlock) label = 'fasting block';
    else if (programs.size === 1) label = schedule.programs[[...programs][0]!]?.label ?? 'block';
    else {
      let fastDays = 0;
      for (let d = a; d < b; d++) if ((energy?.[d] ?? 1) < 1) fastDays++;
      label = fastDays > 0 ? 'fasting block' : f < 0.97 ? 'deficit' : f <= 1.03 ? 'maintenance' : 'surplus';
    }
    const prev = out[out.length - 1];
    const prevKey = prev ? (REGIME.has(prev.shortLabel ?? '') ? prev.shortLabel : prev.label) : null;
    if (prev && prevKey === label) out[out.length - 1] = mk(prev.startDay, b, label);
    else out.push(mk(a, b, label));
    w = w1 + 1;
  }
  return out;
}

const ZERO = (n: number) => new Float32Array(n);

/** Realised macro grams per day (engine input echo). Missing series read as zero. */
export function macroSeries(result: SimulationResult): MacroSeries {
  const n = result.meta.nDays;
  const d = result.daily;
  return {
    protein: d.inProtein ?? ZERO(n),
    netCarbs: d.inCarbs ?? ZERO(n),
    fibre: d.inFibre ?? ZERO(n),
    fat: d.inFat ?? ZERO(n),
    alcohol: d.inAlcohol ?? ZERO(n),
  };
}

/**
 * Inputs-lane context. Macros and steps are the engine's realised inputs (what was simulated, including runtime
 * "% of current maintenance" days); maintenance is the engine's moving maintenance estimate. Meals, windows,
 * sessions and sleep come from the compiled schedule; meal grams are scaled to the realised daily totals.
 */
export function intakeContext(result: SimulationResult, compiled?: CompiledSchedule | null): IntakeContext | undefined {
  const n = result.meta.nDays;
  const maintenance = result.daily.maintenance;
  if (!maintenance || !result.daily.inEnergy) return undefined;
  const grams = macroSeries(result);
  const ctx: IntakeContext = { grams, maintenance, steps: result.daily.inSteps };
  if (!compiled) return ctx;

  const meals: Meal[] = [];
  const exercise: ExerciseSession[] = [];
  const eatingWindows: DayWindow[] = [];
  const sleep: DayWindow[] = [];
  for (let day = 0; day < Math.min(n, compiled.days.length); day++) {
    const di = compiled.days[day]!;
    // meals/sessions are preallocated arrays; only the first nMeals / nSessions entries are real
    const dm = di.meals.slice(0, di.nMeals ?? di.meals.length);
    const ds = di.sessions.slice(0, di.nSessions ?? di.sessions.length);
    const sum = { p: 0, c: 0, fb: 0, f: 0, a: 0 };
    for (const m of dm) {
      sum.p += m.proteinG;
      sum.c += m.carbG;
      sum.fb += m.fibreG;
      sum.f += m.fatG;
      sum.a += m.alcoholG;
    }
    const k = (real: number | undefined, planned: number) => (planned > 0 && real != null && Number.isFinite(real) ? real / planned : 1);
    const kp = k(grams.protein[day], sum.p);
    const kc = k(grams.netCarbs[day], sum.c);
    const kfb = k(grams.fibre[day], sum.fb);
    const kf = k(grams.fat[day], sum.f);
    const ka = k(grams.alcohol[day], sum.a);
    const dayMeals = di.zeroIntake ? [] : dm.filter((m) => m.kcal > 0 || m.proteinG + m.carbG + m.fatG > 0);
    for (const m of dayMeals) {
      meals.push({
        day,
        startHour: m.clockH,
        durationMin: 30,
        grams: { protein: m.proteinG * kp, netCarbs: m.carbG * kc, fibre: m.fibreG * kfb, fat: m.fatG * kf, alcohol: m.alcoholG * ka },
      });
    }
    if (dayMeals.length) {
      const first = Math.min(...dayMeals.map((m) => m.clockH));
      const last = Math.max(...dayMeals.map((m) => m.clockH));
      // the window ends at the last meal, as the schedule editor draws it ("Eat 08:00 to 20:00", 12:12)
      eatingWindows.push({ day, startHour: first, endHour: Math.max(first + 0.5, last) });
    }
    for (const s of ds) {
      if (!(s.durationMin > 0)) continue;
      const type: ExerciseSession['type'] = s.kind === 'resistance' ? 'resistance' : s.modality === WALK_MODALITY ? 'walk' : 'cardio';
      exercise.push({ day, startHour: s.startH, durationMin: s.durationMin, type, label: type === 'resistance' ? 'lifting' : type === 'walk' ? 'walk' : 'cardio' });
    }
    if (Number.isFinite(di.sleepBedH) && Number.isFinite(di.sleepWakeH)) {
      const end = di.sleepWakeH <= di.sleepBedH ? di.sleepWakeH + 24 : di.sleepWakeH;
      sleep.push({ day, startHour: di.sleepBedH, endHour: end });
    }
  }
  return { ...ctx, meals, exercise, eatingWindows, sleep };
}
