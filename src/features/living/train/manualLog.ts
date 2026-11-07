/**
 * The manual activity log's model (energy SPEC §V4.4): what was done, for how long and how hard, and a live preview from
 * V2's `projectActivity` (the same estimator chain a planned or approved bout uses, without HR): "About 310 kcal,
 * 220–400" (movement above your own rest, D15, a scenario range) and "40 Heart Points" (Fit-compatible estimate).
 * Pure; the panel renders it and the adapter sends it as `activity.logManual`.
 */
import type { ExerciseRecord, PerformedExercise, StimulusContext } from '@/catalogues';
import { formatNumber, toEnergyUnit, type EnergyUnitChoice } from '@/components';
import type { LocalDate } from '@/living';
import type { CandidateEstimate } from '@/living/activityCandidates';
import { exerciseRecordOf, projectActivity } from '@/living/sensors';
import type { ActivityIntensity, ActivityLogManualInput, ManualResolution } from './v3Adapter';

/** How hard, as the person states it: a stated class (`intensity.class`), never inferred from the type. */
export type Effort = 'light' | 'moderate' | 'vigorous';

/** The common activities offered before anything is typed (V1 types included), in this order. */
export const COMMON_ACTIVITY_IDS: readonly string[] = ['walk_brisk', 'walk', 'treadmill_incline_walk', 'jog_outdoor', 'cycle_outdoor', 'air_bike', 'treadmill_desk_slow', 'swim', 'badminton', 'other_moderate'];

/** The catalogue's generic activity a log falls back to when a typed name matches nothing (it has no new-record path). */
export const GENERIC_LOG_ACTIVITY_ID = 'other_moderate';

/** Speed (and incline on a treadmill) changes the estimate for gait only: walking and running. */
export function speedApplies(ex: Pick<ExerciseRecord, 'cardioModality'> | null | undefined): boolean {
  return ex?.cardioModality === 'walk' || ex?.cardioModality === 'run';
}

/** A belt speed (treadmill) rather than a ground speed; only a treadmill has a set incline. */
export function onTreadmill(ex: Pick<ExerciseRecord, 'id'> | null | undefined): boolean {
  return !!ex && /treadmill/.test(ex.id);
}

export interface ManualDose {
  minutes: number;
  effort?: Effort | null;
  speedKmh?: number | null;
  gradePct?: number | null;
}

export interface ManualPreview {
  /** Movement above own rest (A), kcal, and its scenario range. */
  kcal: number;
  lo: number;
  hi: number;
  points: { lo: number; hi: number };
  method: string;
  version: string;
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The preview for a dose, or null when it cannot be estimated (a type the catalogue does not know, no minutes, or no body
 * mass). The gross range is the booked estimator's envelope; above rest is gross less own rest, never below zero.
 */
export function manualPreview(exerciseId: string, dose: ManualDose, ctx: Pick<StimulusContext, 'bodyMassKg' | 'rmrKcalPerDay'>): ManualPreview | null {
  const ex = exerciseRecordOf(exerciseId);
  if (!ex || !finite(dose.minutes) || dose.minutes <= 0 || !finite(ctx.bodyMassKg) || ctx.bodyMassKg <= 0) return null;
  const gait = speedApplies(ex);
  const p = projectActivity({
    exerciseId,
    durationMin: dose.minutes,
    massKg: ctx.bodyMassKg,
    rmrKcalPerDay: ctx.rmrKcalPerDay ?? null,
    ...(gait && finite(dose.speedKmh) && dose.speedKmh > 0 ? { speedKmh: dose.speedKmh, gradeFrac: finite(dose.gradePct) ? dose.gradePct / 100 : null, speedSource: onTreadmill(ex) ? ('belt' as const) : ('gps' as const) } : {}),
    ...(dose.effort ? { intensityClass: dose.effort } : {}),
  });
  const above = (g: number) => Math.max(0, g - p.R);
  return { kcal: above(p.G), lo: above(p.envelope.lo), hi: above(p.envelope.hi), points: { lo: Math.round(p.pointsRange.lo), hi: Math.round(p.pointsRange.hi) }, method: p.method, version: p.version };
}

/**
 * (0.6.3 S12/A26) The manual log's preview from the estimate the log books (`manualCheck` → `estimateFor`, the same
 * request as `activity.logManual`): energy above own rest with the booked envelope moved by own rest, and the bout's
 * Heart Points from its equivalent MET (Fit-compatible); the stated WHO class stays the person's statement. Null without
 * an estimate (an unknown type, or no weight).
 */
export function manualLogPreview(e: CandidateEstimate | null): ManualPreview | null {
  if (!e) return null;
  const rest = e.cost.ownRestKcal;
  const above = (g: number) => Math.max(0, g - rest);
  const pts = e.heartPoints !== null && Number.isFinite(e.heartPoints) ? Math.round(e.heartPoints) : 0;
  return { kcal: Math.max(0, e.cost.netAboveRestKcal), lo: above(e.booked.envelope.lo), hi: above(e.booked.envelope.hi), points: { lo: pts, hi: pts }, method: e.booked.method, version: e.version };
}

/** kcal as spoken in a preview: to the nearest 10, so the figure never claims more than the range does. */
export function roundKcal(v: number): number {
  return Math.round(v / 10) * 10;
}

/** An energy figure in the display unit as spoken in a preview: to the nearest 10 in that unit (kcal or kJ). */
export function roundEnergy(kcal: number, unit: EnergyUnitChoice = 'kcal'): number {
  return Math.round(toEnergyUnit(kcal, unit) / 10) * 10;
}

/** "About 310 kcal, 220–400" (or "About 1 300 kJ, 920–1 650" when the person's energy unit is kJ). */
export function previewKcalText(p: Pick<ManualPreview, 'kcal' | 'lo' | 'hi'>, unit: EnergyUnitChoice = 'kcal'): string {
  const lo = roundEnergy(p.lo, unit);
  const hi = roundEnergy(p.hi, unit);
  const range = lo === hi ? '' : `, ${formatNumber(lo)}–${formatNumber(hi)}`;
  return `About ${formatNumber(roundEnergy(p.kcal, unit))} ${unit}${range}`;
}

/** "40 Heart Points", "20–40 Heart Points", "No Heart Points". */
export function previewPointsText(points: ManualPreview['points']): string {
  if (points.hi <= 0) return 'No Heart Points';
  return points.lo === points.hi ? `${formatNumber(points.hi)} Heart Points` : `${formatNumber(points.lo)}–${formatNumber(points.hi)} Heart Points`;
}

/** (0.6.3 INT) Quiet mode: whether it earns Heart Points, in words (no digits, aria too). */
export const quietPointsText = (points: ManualPreview['points']): string => (points.hi > 0 ? 'Earns Heart Points' : 'No Heart Points');

/** The preview as one sentence for its live region. Quiet mode: words only (Heart Points as a word, no kcal). */
export function spokenPreview(p: ManualPreview, quiet: boolean, unit: EnergyUnitChoice = 'kcal'): string {
  if (quiet) return `${quietPointsText(p.points)}, Fit-compatible estimate`;
  return `${previewKcalText(p, unit)} estimated, scenario range; ${previewPointsText(p.points)}, Fit-compatible estimate`;
}

/** The intensity fields `activity.logManual` takes from this screen. */
export function intensityOf(ex: Pick<ExerciseRecord, 'id' | 'cardioModality'> | null, dose: ManualDose): ActivityIntensity {
  const out: ActivityIntensity = {};
  if (dose.effort) out.class = dose.effort;
  if (speedApplies(ex) && finite(dose.speedKmh) && dose.speedKmh > 0) {
    out.speedKmh = dose.speedKmh;
    if (onTreadmill(ex) && finite(dose.gradePct)) out.gradePct = dose.gradePct;
  }
  return out;
}

/** The fields the same choices add to a performed exercise (a swap or a replaced session, `log.session`). */
export function perfIntensity(ex: Pick<ExerciseRecord, 'id' | 'cardioModality'> | null, dose: ManualDose): Partial<PerformedExercise> {
  const i = intensityOf(ex, dose);
  return {
    ...(i.class ? { healthIntensityClass: i.class } : {}),
    ...(i.speedKmh !== undefined ? { speedKmh: i.speedKmh } : {}),
    ...(i.gradePct !== undefined ? { gradePct: i.gradePct } : {}),
  };
}

/**
 * When it started, as an hour of the app day: on today, it ends now (a log right after the activity is the common case);
 * on a past day the time is not known and is left out (never guessed). `nowH` is the app clock hour (24 h and more after
 * midnight, before the rollover: `appClockH`), so a log at 00:30 on the app day D starts at 23.75 on D, not at 0 on D+1's
 * calendar date; the result is not clamped (a start before the day's own 00:00 is a late-evening hour of the day).
 */
export function startHOf(date: LocalDate, today: LocalDate, nowH: number, minutes: number): number | undefined {
  if (date !== today || !finite(nowH)) return undefined;
  return Math.round((nowH - minutes / 60) * 100) / 100;
}

/** "07:05" for an app-clock hour (24 and more after midnight wrap to the next day's clock). */
export function clockOf(h: number): string {
  const m = Math.round((((h % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * (0.6.3 A27) The app-clock start hour of a typed "HH:MM" on the app day: a clock before the rollover is after midnight
 * (24 h and more), as the app day reads it. Undefined for a malformed time.
 */
export function startHOfClock(text: string, rolloverH: number): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h < 24 && min >= 0 && min < 60)) return undefined;
  const v = h + min / 60;
  return Math.round((v < rolloverH ? v + 24 : v) * 100) / 100;
}

/** The `activity.logManual` input (`startH` absent = the person said the time is unknown). */
export function logManualInput(exerciseId: string, date: LocalDate, dose: ManualDose, startH?: number, resolution?: ManualResolution | null): ActivityLogManualInput {
  const ex = exerciseRecordOf(exerciseId) ?? null;
  return { exerciseId, date, ...(startH !== undefined ? { startH } : {}), durationMin: Math.max(1, Math.round(dose.minutes)), intensity: intensityOf(ex, dose), ...(resolution ? { resolution } : {}) };
}
