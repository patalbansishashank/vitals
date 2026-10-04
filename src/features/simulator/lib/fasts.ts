/**
 * Fasts as the user experiences them: a planned zero-intake span (fast event or water-only day) plus the gap from
 * the last meal before it to the first meal after it. A water-only Sunday between days eating 08:00–20:00 is a
 * 36 h fast (Sat 20:00 → Mon 08:00), which is what the cell prints.
 */
import type { CompiledSchedule } from '@/engine';

export interface FastSpan {
  /** Absolute hours since day 0, 00:00. */
  startHour: number;
  endHour: number;
  hours: number;
  /** Planned zero-intake core of the span (for electrolyte flags and the multi-day timeline). */
  plannedStart: number;
  plannedEnd: number;
  electrolytes: boolean;
  /** Days the span touches, first and last (inclusive). */
  firstDay: number;
  lastDay: number;
  /** Index into schedule.events when the span comes from a fast event, else −1 (water-only days). */
  eventIndex: number;
  /** Graded refeed after the fast (compiler's view: event `refeed: 'auto'` or `refeedFactors`). */
  refeed: 'none' | 'auto';
  /** Length of the refeed ramp, days (0 without a refeed). */
  refeedDays: number;
}

/** Meal clock times in absolute hours, in order (meals dropped inside a fast are excluded). */
export function mealHours(c: CompiledSchedule): number[] {
  const mask = new Set<number>();
  for (const s of c.fastSpans) for (let h = s.startHour; h < s.endHour; h++) mask.add(h);
  const out: number[] = [];
  for (const d of c.days) {
    if (d.zeroIntake) continue;
    for (let i = 0; i < d.nMeals; i++) {
      const m = d.meals[i]!;
      const abs = d.day * 24 + m.clockH;
      if (mask.has(Math.floor(abs))) continue;
      out.push(abs);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * The first scheduled meal at or after absolute hour `t` (meals inside existing fasts excluded), or null at the horizon
 * edge. The compiler drops the meals a fast covers and adds none at its end, so a "72 h" fast that ends at 20:00 on a
 * day whose window closes at 19:00 really lasts until the next day's first meal: the insert-fast tool says so.
 */
export function nextMealAt(c: CompiledSchedule, t: number): number | null {
  for (const m of mealHours(c)) if (m >= t - 1e-9) return m;
  return null;
}

/**
 * Fast spans with their meal gaps. `events` maps planned spans back to schedule.events (by overlap) so the day
 * editor can edit the event.
 */
export function fastSpans(
  c: CompiledSchedule,
  events: ReadonlyArray<{ startDay: number; startH: number; durationH: number }> = [],
): FastSpan[] {
  const meals = mealHours(c);
  const out: FastSpan[] = [];
  for (const s of c.fastSpans) {
    let before = s.startHour;
    let after = s.endHour;
    for (let i = meals.length - 1; i >= 0; i--)
      if (meals[i]! < s.startHour) {
        before = meals[i]!;
        break;
      }
    for (const m of meals)
      if (m >= s.endHour) {
        after = m;
        break;
      }
    // Without a meal on one side (horizon edge) the planned edge is the honest bound.
    if (before === s.startHour && s.startHour > 0) before = s.startHour;
    const eventIndex = events.findIndex((e) => {
      const a = e.startDay * 24 + e.startH;
      return a < s.endHour && a + e.durationH > s.startHour;
    });
    // the compiler reports the meal-to-meal length itself (contract 2026-09-30); fall back to our own gap search
    const m2m = (s as { mealToMealH?: number }).mealToMealH;
    const hours = m2m !== undefined && Number.isFinite(m2m) && m2m > 0 ? m2m : after - before;
    out.push({
      startHour: before,
      endHour: after,
      hours,
      plannedStart: s.startHour,
      plannedEnd: s.endHour,
      electrolytes: s.electrolytes,
      firstDay: Math.floor(before / 24),
      lastDay: Math.floor((after - 1e-9) / 24),
      eventIndex,
      refeed: s.refeed === 'auto' ? 'auto' : 'none',
      refeedDays: s.refeed === 'auto' && Number.isFinite(s.refeedDays) ? Math.max(0, s.refeedDays ?? 0) : 0,
    });
  }
  return out;
}

/** Per-day view of fasting: hours of the day inside a fast span (with gaps) and the span it belongs to. */
export interface DayFast {
  /** Fasted fraction of the day [from, to] in hours 0..24, or null. */
  from: number;
  to: number;
  span: FastSpan;
  full: boolean;
  /** The span starts on this day (glyph) / this is the first fully fasted day (label). */
  isStart: boolean;
  isLabelDay: boolean;
}

/** Only spans longer than a normal overnight fast (> 20 h) are drawn on the raster. */
export const DRAW_FAST_MIN_H = 20;

export function dayFasts(spans: readonly FastSpan[], nDays: number): Array<DayFast | null> {
  const out: Array<DayFast | null> = Array.from({ length: nDays }, () => null);
  for (const s of spans) {
    if (s.hours < DRAW_FAST_MIN_H) continue;
    let labelled = false;
    for (let d = Math.max(0, s.firstDay); d <= Math.min(nDays - 1, s.lastDay); d++) {
      const from = Math.max(0, s.startHour - d * 24);
      const to = Math.min(24, s.endHour - d * 24);
      const full = from <= 0 && to >= 24;
      const isLabelDay = !labelled && (full || d === s.lastDay);
      if (isLabelDay) labelled = true;
      out[d] = { from, to, span: s, full, isStart: d === s.firstDay, isLabelDay };
    }
  }
  return out;
}

/** "36 h" up to 99 h, then days to the half day ("4.5 d") so it never wraps in a 44 px cell. */
export function formatFastHours(h: number): string {
  const r = Math.round(h);
  if (r <= 99) return `${r} h`;
  const d = Math.round((r / 24) * 2) / 2;
  return `${d} d`;
}

/**
 * How fasting shapes one calendar day, as the day editor shows it (QA release check 2026-10-01): a day inside a fast is
 * fasted — no kcal, no meals — whatever its program says; the day a fast starts or ends loses the meals inside it; the
 * days after a fast with a graded refeed eat a fraction of the plan.
 */
export interface DayFastInfo {
  /** The whole day is at zero intake. */
  fasted: boolean;
  /**
   * A fast event (not the day's own water-only program) sets this day's food: the fast overrides the program's energy
   * and meals here, fully (`fasted`) or partly (`droppedMeals` > 0).
   */
  overridden: boolean;
  /** The fast touching this day (spans longer than an overnight fast), if any. */
  span: FastSpan | null;
  /** Hours of the day inside the planned zero-intake span. */
  fastHours: number;
  /** Planned meals of the day that the fast drops (partly fasted days). */
  droppedMeals: number;
  /** Graded-refeed ramp this day is part of: day `n` of `of`, eating `factor` of the planned energy. */
  refeed: { n: number; of: number; factor: number } | null;
}

export function dayFastInfo(
  c: CompiledSchedule,
  spans: readonly FastSpan[],
  day: number,
  programIsZero: boolean,
): DayFastInfo {
  const d = c.days[day];
  const none: DayFastInfo = { fasted: false, overridden: false, span: null, fastHours: 0, droppedMeals: 0, refeed: null };
  if (!d) return none;
  const span =
    spans.find((s) => s.hours >= DRAW_FAST_MIN_H && day >= s.firstDay && day <= s.lastDay) ??
    spans.find((s) => day >= Math.floor(s.plannedStart / 24) && day <= Math.floor((s.plannedEnd - 1e-9) / 24)) ??
    null;
  let droppedMeals = 0;
  const mask = d.mealDropMask ?? 0;
  for (let i = 0; i < d.nMeals; i++) if (mask & (1 << i)) droppedMeals++;
  const fasted = d.zeroIntake;
  const overridden = !programIsZero && (fasted || droppedMeals > 0) && (span?.eventIndex ?? -1) >= 0;
  let refeed: DayFastInfo['refeed'] = null;
  const f = d.refeedFactor;
  if (!fasted && f !== undefined && Number.isFinite(f) && f < 1 - 1e-9) {
    // the ramp starts on the calendar day the fast ends (FastEvent.refeedFactors: day 1 = that day)
    let start = day;
    while (start > 0) {
      const p = c.days[start - 1]!;
      if (p.zeroIntake || !(p.refeedFactor !== undefined && p.refeedFactor < 1 - 1e-9)) break;
      start--;
    }
    let end = day;
    while (end + 1 < c.nDays) {
      const q = c.days[end + 1]!.refeedFactor;
      if (!(q !== undefined && q < 1 - 1e-9)) break;
      end++;
    }
    refeed = { n: day - start + 1, of: end - start + 1, factor: f };
  }
  return { fasted, overridden, span, fastHours: d.fastHours, droppedMeals, refeed };
}

/** Refeed ramp after a fast, as fractions of the planned energy (compiled), from the day the fast ends. */
export function refeedRamp(c: CompiledSchedule, span: FastSpan): number[] {
  if (span.refeed !== 'auto') return [];
  const out: number[] = [];
  for (let d = Math.floor((span.plannedEnd - 1e-9) / 24); d < c.nDays && out.length < 14; d++) {
    const day = c.days[d]!;
    if (day.zeroIntake) continue;
    const f = day.refeedFactor;
    if (!(f !== undefined && f < 1 - 1e-9)) break;
    out.push(f);
  }
  return out;
}
