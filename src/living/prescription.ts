/**
 * Prescription snapshot (docs/SUITE_SPEC.md §3.3): when a date becomes the current day its prescription is frozen, so
 * re-plans never rewrite what the person was asked to do on a past day. Items carry the adherence weights of the version
 * (`PlanSensitivities.itemWeights`, floor 0.02, renormalised over the day's items — not equal weights, §3.7). Pure.
 */
// the modules, not the engine index (which loads every model module and the planner): the command registry reaches this file
import { compileSchedule } from '@/engine/core/compileSchedule';
import { resolveProfile } from '@/engine/core/resolveProfile';
import type { CompiledSchedule, DayTemplate, FastEvent, PersonProfile, Schedule } from '@/engine';
import { mergeTemplate } from '@/engine/core/compileSchedule';
import { addDays, localToInstant, weekdayOf } from './dates';
import { habitualTemplateFor, planDay } from './calendar';
import type { PlanItemType, PlanSensitivities } from './plannerContract';
import type { Id, LocalDate, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot, PrescribedItem, PrescribedSession } from './types';

/** Floor of an item weight before renormalising (§3.7). */
export const ITEM_WEIGHT_FLOOR = 0.02;

/**
 * Fallback item-type weights for a version without planner sensitivities (scenario-started plans, or before E6 exposes
 * `computePlanSensitivities`). Engineering defaults (grade D) shaped like a fat-loss-with-training plan: energy dominates,
 * then training and protein. Replaced by the planner's counterfactual shares whenever present.
 */
export const DEFAULT_ITEM_WEIGHTS: Readonly<Record<PlanItemType, number>> = {
  energy: 0.34,
  protein: 0.16,
  rtSession: 0.2,
  cardioSession: 0.1,
  fast: 0.08,
  window: 0.03,
  steps: 0.05,
  sleep: 0.04,
  supplement: 0.02,
};

/** Lowest per-day share of a fast, h, that counts as a fast item (shorter gaps are the eating window). */
export const FAST_ITEM_MIN_H = 16;

export function defaultSensitivities(planVersion: string): PlanSensitivities {
  return { planVersion, itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} };
}

/** Template of plan day `d` of a schedule (program merged with the day's override). */
export function templateOfDay(schedule: Schedule, d: number): DayTemplate {
  const sd = schedule.days[Math.max(0, Math.min(d, schedule.days.length - 1))]!;
  return mergeTemplate(schedule.programs[sd.program]!, sd.override);
}

/** The fast event covering (or starting on) plan day d. */
export function fastEventOn(schedule: Schedule, d: number): FastEvent | undefined {
  for (const e of schedule.events ?? []) {
    if (e.kind !== 'fast') continue;
    const endDay = e.startDay + Math.floor((e.startH + e.durationH) / 24);
    if (d >= e.startDay && d <= endDay) return e;
  }
  return undefined;
}

export interface FreezeInput {
  plan: PlanDoc & { id: Id };
  version: PlanVersionDoc;
  date: LocalDate;
  tz: string;
  /** Realised energy of the day from the replay echo (runtime days whose energy follows the simulated body). */
  echo?: { energyKcal: number; proteinG: number; carbG: number; fatG: number; fibreG?: number; maintenanceKcal?: number };
  /** True on a paused day: the habitual prescription (logs still count, nothing is scored). */
  paused?: boolean;
  /** Compiled version schedule, when the caller already has it (memoised per version). */
  compiled?: CompiledSchedule;
}

/** Compile a version schedule for the plan's baseline body (static days resolve at compile time). */
export function compileVersion(baseline: PersonProfile, schedule: Schedule): CompiledSchedule {
  const rp = resolveProfile({ ...baseline, startDate: schedule.startDate });
  return compileSchedule(schedule, rp);
}

function weightsFor(types: readonly PlanItemType[], s: PlanSensitivities | undefined): number[] {
  const raw = types.map((t) => Math.max(ITEM_WEIGHT_FLOOR, s?.itemWeights?.[t] ?? DEFAULT_ITEM_WEIGHTS[t]));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (sum > 0 ? w / sum : 0));
}

/** Freeze the prescription of `date`. */
export function freezePrescription(i: FreezeInput): PrescribedDaySnapshot {
  const d = planDay(i.plan, i.date);
  const paused = i.paused === true;
  const schedule = paused
    ? ({ schemaVersion: 1, startDate: i.date, horizonDays: 1, programs: [habitualTemplateFor(i.plan.baselineProfile, weekdayOf(i.date))], days: [{ program: 0 }] } as Schedule)
    : i.version.schedule;
  const dd = paused ? 0 : d;
  const compiled = paused ? compileVersion(i.plan.baselineProfile, schedule) : (i.compiled ?? compileVersion(i.plan.baselineProfile, schedule));
  const day = compiled.days[Math.max(0, Math.min(dd, compiled.days.length - 1))]!;
  const template = templateOfDay(schedule, dd);

  const compiledKcal = Number.isFinite(day.energyKcal) ? day.energyKcal : 0;
  const energyKcal = i.echo && Number.isFinite(i.echo.energyKcal) ? i.echo.energyKcal : compiledKcal;
  const scale = compiledKcal > 0 ? energyKcal / compiledKcal : 1;
  const macros = {
    proteinG: i.echo?.proteinG ?? day.proteinG,
    carbG: i.echo?.carbG ?? day.carbG,
    fatG: i.echo?.fatG ?? day.fatG,
    fibreG: i.echo?.fibreG ?? day.fibreG,
  };
  const maintenanceKcal = i.echo?.maintenanceKcal ?? (Number.isFinite(day.maintenanceKcal) ? day.maintenanceKcal : NaN);

  const meals: PrescribedDaySnapshot['meals'] = [];
  for (let k = 0; k < day.nMeals; k++) {
    const m = day.meals[k]!;
    if (m.kcal <= 0) continue;
    meals.push({ slot: `meal${k + 1}`, clockH: m.clockH, energyKcal: m.kcal * scale, proteinG: m.proteinG * scale, carbG: m.carbG * scale, fatG: m.fatG * scale });
  }
  const win = template.meals?.window;
  const eatWindow = win ? { startH: win.startH, endH: win.startH + win.lengthH } : undefined;

  const engineSessions = template.exercise ?? [];
  const sessions: PrescribedSession[] = engineSessions.map((s, k) => {
    const slotKey = `${dd}:${k}`;
    const concrete = paused ? null : (i.version.sessions[slotKey] ?? null);
    const durationMin = s.kind === 'cardio' ? s.durationMin : (s.durationMin ?? day.sessions[k]?.durationMin ?? 60);
    return {
      slotKey,
      startH: s.startH,
      kind: s.kind,
      durationMin,
      concrete,
      stimulus: concrete ? concrete.delivered : null,
      engine: [s],
    };
  });

  const fastEvent = paused ? undefined : fastEventOn(schedule, dd);
  let fast: PrescribedDaySnapshot['fast'];
  if (fastEvent && fastEvent.durationH >= FAST_ITEM_MIN_H) {
    const startDate = addDays(i.plan.startDate, fastEvent.startDay);
    const last = localToInstant(startDate, fastEvent.startH, i.tz);
    const first = new Date(Date.parse(last) + fastEvent.durationH * 3_600_000).toISOString();
    fast = { lastIntakeAt: last, firstIntakeAt: first, hours: fastEvent.durationH };
  }
  if (Number.isFinite(day.refeedFactor) && (day.refeedFactor ?? 1) < 1 && fast) fast.refeedFactor = day.refeedFactor;

  const supplements: PrescribedDaySnapshot['supplements'] = [];
  if ((template.substances?.creatineG ?? 0) > 0) supplements.push({ supplementId: 'creatine', dose: template.substances!.creatineG!, unit: 'g' });

  // ---- items with weights
  const raw: Array<{ itemId: string; type: PlanItemType; target: Record<string, number> }> = [];
  if (energyKcal > 50) raw.push({ itemId: 'energy', type: 'energy', target: { energyKcal, ...(Number.isFinite(maintenanceKcal) ? { maintenanceKcal } : {}) } });
  if (macros.proteinG > 0 && energyKcal > 50) raw.push({ itemId: 'protein', type: 'protein', target: { proteinG: macros.proteinG } });
  if (eatWindow) raw.push({ itemId: 'window', type: 'window', target: { startH: eatWindow.startH, endH: eatWindow.endH } });
  if (fast) raw.push({ itemId: 'fast', type: 'fast', target: { hours: fast.hours } });
  else if (day.zeroIntake) raw.push({ itemId: 'fast', type: 'fast', target: { hours: 24 } });
  for (const s of sessions) {
    const sets = s.engine[0]?.kind === 'resistance' ? Object.values(s.engine[0].setsByRegion ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0) : 0;
    raw.push({ itemId: `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`, type: s.kind === 'resistance' ? 'rtSession' : 'cardioSession', target: { durationMin: s.durationMin, ...(sets > 0 ? { sets } : {}) } });
  }
  if (template.steps !== undefined) raw.push({ itemId: 'steps', type: 'steps', target: { steps: template.steps } });
  const sleepH = template.sleep?.hours ?? (template.sleep?.bedH !== undefined && template.sleep?.wakeH !== undefined ? (template.sleep.wakeH - template.sleep.bedH + 24) % 24 : undefined);
  if (sleepH !== undefined) raw.push({ itemId: 'sleep', type: 'sleep', target: { hours: sleepH } });
  for (const s of supplements) raw.push({ itemId: `supplement:${s.supplementId}`, type: 'supplement', target: { dose: s.dose } });
  const weights = paused ? raw.map(() => 0) : weightsFor(raw.map((r) => r.type), i.version.sensitivities);
  const items: PrescribedItem[] = raw.map((r, k) => ({ ...r, weight: weights[k]! }));

  return {
    planId: i.plan.id,
    version: i.version.version,
    planDay: d,
    dayType: paused ? 'habitual day' : template.label || `program ${(i.version.schedule.days[dd]?.program ?? 0) + 1}`,
    energyKcal,
    macros,
    ...(eatWindow ? { window: eatWindow } : {}),
    meals,
    sessions,
    ...(fast ? { fast } : {}),
    ...(template.steps !== undefined ? { steps: template.steps } : {}),
    ...(template.sleep?.bedH !== undefined && template.sleep?.wakeH !== undefined ? { sleep: { bedH: template.sleep.bedH, wakeH: template.sleep.wakeH } } : {}),
    supplements,
    items,
    template,
    maintenanceKcal,
    ...(fastEvent ? { fastEvent } : {}),
    ...(paused ? { paused: true } : {}),
  };
}
