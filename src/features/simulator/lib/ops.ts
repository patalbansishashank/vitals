/**
 * Pure schedule operations behind the calendar painter and the program tray. Every function takes an engine
 * `Schedule` and returns a new one (structural sharing, never mutation), so the store can keep undo history and the
 * result is always exactly what `compileSchedule` consumes — there is no parallel format.
 */
import { mergeTemplate } from '@/engine/core/compileSchedule';
import type {
  DayTemplate,
  ExerciseSession,
  FastEvent,
  ResistanceSession,
  RtVolumePreset,
  Schedule,
  ScheduleBlock,
  ScheduleDay,
} from '@/engine';
import {
  type CalendarGrid,
  calendarGrid,
  dayAt,
  MAX_HORIZON_DAYS,
  MIN_HORIZON_DAYS,
  rowDays,
  weekdayOf,
} from './calendar';

export type DayOverride = NonNullable<ScheduleDay['override']>;

export const MAX_PROGRAMS = 26;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** First free letter key A–Z (null when all 26 are used). */
export function nextLetter(programs: readonly DayTemplate[]): string | null {
  const used = new Set(programs.map((p) => p.id));
  for (const l of LETTERS) if (!used.has(l)) return l;
  return null;
}

export function gridOf(s: Schedule): CalendarGrid {
  return calendarGrid(s.startDate, s.horizonDays);
}

const withDays = (s: Schedule, days: ScheduleDay[]): Schedule => ({ ...s, days });

/** Paint days with a program; painting replaces any per-day override. */
export function paint(s: Schedule, days: readonly number[], program: number): Schedule {
  if (program < 0 || program >= s.programs.length) return s;
  let changed = false;
  const next = s.days.slice();
  for (const d of days) {
    if (d < 0 || d >= next.length) continue;
    const cur = next[d]!;
    if (cur.program === program && !cur.override) continue;
    next[d] = { program };
    changed = true;
  }
  return changed ? withDays(s, next) : s;
}

/** Clear = back to the scenario's default program (A, index 0). */
export function clear(s: Schedule, days: readonly number[]): Schedule {
  return paint(s, days, 0);
}

/** The template a day actually uses (program merged with its override). */
export function dayTemplate(s: Schedule, d: number): DayTemplate {
  const sd = s.days[d] ?? { program: 0 };
  const prog = s.programs[sd.program] ?? s.programs[0]!;
  return mergeTemplate(prog, sd.override);
}

const TOP_KEYS = [
  'energy',
  'macros',
  'food',
  'meals',
  'exercise',
  // training source ("as usual" / custom / none, lib/training.ts): a day may differ from its program
  'habitualTraining',
  'steps',
  'sleep',
  'substances',
  'hydration',
  'modifiers',
] as const;

/** Override = the top-level fields of `merged` that differ from the program (full values, so merges are exact). */
export function diffOverride(program: DayTemplate, merged: DayTemplate): DayOverride | undefined {
  const ov: Record<string, unknown> = {};
  for (const k of TOP_KEYS) {
    const a = program[k];
    const b = merged[k];
    if (JSON.stringify(a) !== JSON.stringify(b) && b !== undefined) ov[k] = b;
  }
  return Object.keys(ov).length > 0 ? (ov as DayOverride) : undefined;
}

/** Edit days "this day only": apply `recipe` to each day's merged template and store the difference as override. */
export function editDays(
  s: Schedule,
  days: readonly number[],
  recipe: (t: DayTemplate) => DayTemplate,
): Schedule {
  const next = s.days.slice();
  let changed = false;
  for (const d of days) {
    if (d < 0 || d >= next.length) continue;
    const sd = next[d]!;
    const prog = s.programs[sd.program];
    if (!prog) continue;
    const merged = recipe(mergeTemplate(prog, sd.override));
    const override = diffOverride(prog, merged);
    const nd: ScheduleDay = override ? { program: sd.program, override } : { program: sd.program };
    if (JSON.stringify(nd) !== JSON.stringify(sd)) {
      next[d] = nd;
      changed = true;
    }
  }
  return changed ? withDays(s, next) : s;
}

export function resetOverrides(s: Schedule, days: readonly number[]): Schedule {
  let changed = false;
  const next = s.days.slice();
  for (const d of days) {
    const sd = next[d];
    if (sd?.override) {
      next[d] = { program: sd.program };
      changed = true;
    }
  }
  return changed ? withDays(s, next) : s;
}

// ---------------------------------------------------------------- weeks (calendar rows)

/** A copied week, by weekday column (null = blank slot in a partial row). */
export interface WeekClip {
  cols: Array<ScheduleDay | null>;
  fromRow: number;
}

export function copyRow(s: Schedule, row: number): WeekClip {
  const g = gridOf(s);
  const cols: Array<ScheduleDay | null> = [];
  for (let c = 0; c < 7; c++) {
    const d = dayAt(g, row, c);
    cols.push(d >= 0 ? structuredClone(s.days[d]!) : null);
  }
  return { cols, fromRow: row };
}

export function pasteRows(s: Schedule, clip: WeekClip, rows: readonly number[]): Schedule {
  const g = gridOf(s);
  const next = s.days.slice();
  let changed = false;
  for (const r of rows) {
    for (let c = 0; c < 7; c++) {
      const src = clip.cols[c];
      const d = dayAt(g, r, c);
      if (!src || d < 0 || src.program >= s.programs.length) continue;
      next[d] = structuredClone(src);
      changed = true;
    }
  }
  return changed ? withDays(s, next) : s;
}

/** Repeat one week over every later week. */
export function repeatRowToEnd(s: Schedule, row: number): Schedule {
  const g = gridOf(s);
  const rows: number[] = [];
  for (let r = row + 1; r < g.rows; r++) rows.push(r);
  return pasteRows(s, copyRow(s, row), rows);
}

/**
 * Apply a pattern of program indices from `fromDay` to `toDay` (inclusive). A 7-long pattern is weekday-aligned
 * (Monday first), so "A A B A A C fast" lands on the same weekdays every week; other lengths repeat in sequence.
 */
export function applyPattern(
  s: Schedule,
  pattern: readonly number[],
  fromDay = 0,
  toDay = s.horizonDays - 1,
): Schedule {
  if (pattern.length === 0) return s;
  const g = gridOf(s);
  const next = s.days.slice();
  let changed = false;
  for (let d = Math.max(0, fromDay); d <= Math.min(s.horizonDays - 1, toDay); d++) {
    const p = pattern.length === 7 ? pattern[(d + g.offset) % 7]! : pattern[(d - fromDay) % pattern.length]!;
    if (p < 0 || p >= s.programs.length) continue;
    const cur = next[d]!;
    if (cur.program === p && !cur.override) continue;
    next[d] = { program: p };
    changed = true;
  }
  return changed ? withDays(s, next) : s;
}

function shiftEvents(
  events: readonly FastEvent[] | undefined,
  at: number,
  by: number,
  dropFrom = Infinity,
  dropTo = -Infinity,
): FastEvent[] | undefined {
  if (!events) return events;
  const out: FastEvent[] = [];
  for (const e of events) {
    if (e.startDay >= dropFrom && e.startDay < dropTo) continue;
    out.push(e.startDay >= at ? { ...e, startDay: e.startDay + by } : e);
  }
  return out;
}

function shiftBlocks(
  blocks: readonly ScheduleBlock[] | undefined,
  at: number,
  by: number,
  n: number,
): ScheduleBlock[] | undefined {
  if (!blocks) return blocks;
  return blocks
    .map((b) => ({
      ...b,
      startDay: b.startDay >= at ? Math.max(at, b.startDay + by) : b.startDay,
      endDay: b.endDay > at ? Math.max(at, b.endDay + by) : b.endDay,
    }))
    .map((b) => ({ ...b, endDay: Math.min(n, b.endDay) }))
    .filter((b) => b.endDay > b.startDay && b.startDay < n);
}

/** Insert a copy of a week before it (later days shift; the horizon grows by the week's length, max 27 weeks). */
export function insertRow(s: Schedule, row: number): Schedule {
  const g = gridOf(s);
  const days = rowDays(g, row);
  if (days.length === 0 || s.horizonDays + days.length > MAX_HORIZON_DAYS) return s;
  const at = days[0]!;
  const copy = days.map((d) => structuredClone(s.days[d]!));
  const next = [...s.days.slice(0, at), ...copy, ...s.days.slice(at)];
  const n = next.length;
  return {
    ...s,
    horizonDays: n,
    days: next,
    events: shiftEvents(s.events, at, copy.length),
    blocks: shiftBlocks(s.blocks, at, copy.length, n),
  };
}

/** Delete a week (later days move up; fasts starting in it are removed). */
export function deleteRow(s: Schedule, row: number): Schedule {
  const g = gridOf(s);
  const days = rowDays(g, row);
  if (days.length === 0 || s.horizonDays - days.length < MIN_HORIZON_DAYS) return s;
  const at = days[0]!;
  const len = days.length;
  const next = [...s.days.slice(0, at), ...s.days.slice(at + len)];
  const n = next.length;
  return {
    ...s,
    horizonDays: n,
    days: next,
    events: shiftEvents(s.events, at + len, -len, at, at + len),
    blocks: shiftBlocks(s.blocks, at, -len, n),
  };
}

const DELOAD: Record<RtVolumePreset, RtVolumePreset> = {
  minimal: 'minimal',
  light: 'minimal',
  moderate: 'light',
  high: 'moderate',
  veryHigh: 'high',
};

/**
 * Deload a week: lifting volume × ½ on the days of the week that lift (as per-day overrides). Days that train as usual
 * lift the habitual week's sessions (`habitualByWeekday`, index 0 = Monday); their deload is those sessions halved,
 * written as this day's own (custom) sessions.
 */
export function deloadRow(s: Schedule, row: number, habitualByWeekday?: readonly ExerciseSession[][]): Schedule {
  const g = gridOf(s);
  const w0 = weekdayOf(s.startDate);
  const half = (e: ExerciseSession): ExerciseSession => {
    if (e.kind !== 'resistance') return e;
    const r: ResistanceSession = { ...e };
    if (r.setsByRegion) {
      const sets: NonNullable<ResistanceSession['setsByRegion']> = {};
      for (const [k, v] of Object.entries(r.setsByRegion))
        sets[k as keyof typeof sets] = Math.round((v ?? 0) * 5) / 10;
      r.setsByRegion = sets;
    } else r.volume = DELOAD[r.volume ?? 'moderate'];
    if (r.durationMin) r.durationMin = Math.round(r.durationMin / 2);
    return r;
  };
  let out = s;
  for (const d of rowDays(g, row)) {
    const t = dayTemplate(s, d);
    const usual = t.habitualTraining === true;
    // as usual = the weekday's habitual sessions, then the template's own extra sessions (engine contract)
    const sessions = usual ? [...(habitualByWeekday?.[(w0 + d) % 7] ?? []), ...(t.exercise ?? [])] : t.exercise;
    if (!sessions?.some((e) => e.kind === 'resistance')) continue;
    out = editDays(out, [d], (x) => ({
      ...x,
      ...(usual ? { habitualTraining: false } : {}),
      exercise: structuredClone(sessions).map(half),
    }));
  }
  return out;
}

/**
 * Shift the selected run of days by `delta` days, rotating the displaced days into the gap (nothing is lost).
 * Fast events that start inside the run move with it.
 */
export function shiftDays(s: Schedule, days: readonly number[], delta: number): Schedule {
  if (days.length === 0 || delta === 0) return s;
  const a = Math.min(...days);
  const b = Math.max(...days);
  const lo = Math.max(0, Math.min(a, a + delta));
  const hi = Math.min(s.horizonDays - 1, Math.max(b, b + delta));
  const d = Math.max(lo - a, Math.min(hi - b, delta));
  if (d === 0) return s;
  const window = s.days.slice(lo, hi + 1);
  const len = window.length;
  const rotated = new Array<ScheduleDay>(len);
  const runLen = b - a + 1;
  // block [a-lo, a-lo+runLen) moves by d; the rest keeps order in the freed positions
  const runStart = a - lo;
  const moved = window.slice(runStart, runStart + runLen);
  const rest = [...window.slice(0, runStart), ...window.slice(runStart + runLen)];
  const newStart = runStart + d;
  let ri = 0;
  for (let i = 0; i < len; i++)
    rotated[i] = i >= newStart && i < newStart + runLen ? moved[i - newStart]! : rest[ri++]!;
  const next = [...s.days.slice(0, lo), ...rotated, ...s.days.slice(hi + 1)];
  const events = s.events?.map((e) =>
    e.startDay >= a && e.startDay <= b ? { ...e, startDay: e.startDay + d } : e,
  );
  return { ...s, days: next, events };
}

// ---------------------------------------------------------------- horizon

/**
 * Change the horizon. Extending repeats the last full week (weekday-aligned); shortening drops the tail and the
 * fasts that start in it (the store keeps the old version in undo for "Restore").
 */
export function setHorizon(s: Schedule, days: number): Schedule {
  const n = Math.max(MIN_HORIZON_DAYS, Math.min(MAX_HORIZON_DAYS, Math.round(days)));
  if (n === s.horizonDays) return s;
  let next: ScheduleDay[];
  if (n > s.horizonDays) {
    const src = s.days.slice(Math.max(0, s.horizonDays - 7));
    next = s.days.slice();
    for (let d = s.horizonDays; d < n; d++) {
      // same weekday as 7·k days earlier within the last week
      const k =
        src.length === 7 ? (d - (s.horizonDays - 7)) % 7 : (d - s.horizonDays) % Math.max(1, src.length);
      next.push(structuredClone(src[k] ?? { program: 0 }));
    }
  } else next = s.days.slice(0, n);
  const events = s.events?.filter((e) => e.startDay < n);
  const blocks = s.blocks
    ?.map((b) => ({ ...b, endDay: Math.min(b.endDay, n) }))
    .filter((b) => b.startDay < n && b.endDay > b.startDay);
  return { ...s, horizonDays: n, days: next, events, blocks };
}

// ---------------------------------------------------------------- programs

export function addProgram(s: Schedule, t: DayTemplate): Schedule {
  if (s.programs.length >= MAX_PROGRAMS) return s;
  return { ...s, programs: [...s.programs, t] };
}

export function updateProgram(s: Schedule, index: number, recipe: (t: DayTemplate) => DayTemplate): Schedule {
  const cur = s.programs[index];
  if (!cur) return s;
  const nt = recipe(cur);
  if (nt === cur) return s;
  const programs = s.programs.slice();
  programs[index] = { ...nt, id: cur.id };
  return { ...s, programs };
}

/**
 * Delete a program. Days that use it are repainted with `replaceWith` (never leaves holes); indices above it shift
 * down. The last program cannot be deleted.
 */
export function deleteProgram(s: Schedule, index: number, replaceWith: number): Schedule {
  if (s.programs.length <= 1 || index < 0 || index >= s.programs.length || replaceWith === index) return s;
  if (replaceWith < 0 || replaceWith >= s.programs.length) return s;
  const map = (p: number): number => {
    const q = p === index ? replaceWith : p;
    return q > index ? q - 1 : q;
  };
  const days = s.days.map((sd) =>
    sd.program === index
      ? { program: map(replaceWith) }
      : sd.program > index
        ? { ...sd, program: sd.program - 1 }
        : sd,
  );
  return { ...s, programs: s.programs.filter((_, i) => i !== index), days };
}

export function programUsage(s: Schedule): number[] {
  const counts = new Array<number>(s.programs.length).fill(0);
  for (const sd of s.days) if (sd.program >= 0 && sd.program < counts.length) counts[sd.program]!++;
  return counts;
}

// ---------------------------------------------------------------- fast events

export function addFast(s: Schedule, ev: FastEvent): Schedule {
  return { ...s, events: [...(s.events ?? []), ev] };
}

export function updateFast(s: Schedule, index: number, patch: Partial<FastEvent>): Schedule {
  const events = (s.events ?? []).slice();
  const cur = events[index];
  if (!cur) return s;
  events[index] = { ...cur, ...patch, kind: 'fast' };
  return { ...s, events };
}

export function removeFast(s: Schedule, index: number): Schedule {
  const events = (s.events ?? []).filter((_, i) => i !== index);
  return { ...s, events: events.length > 0 ? events : undefined };
}

// ---------------------------------------------------------------- blocks (phase names)

/** Name a block of days; blocks it overlaps are trimmed so blocks never overlap. */
export function setBlock(s: Schedule, block: ScheduleBlock): Schedule {
  const a = Math.max(0, block.startDay);
  const b = Math.min(s.horizonDays, block.endDay);
  if (b <= a) return s;
  const out: ScheduleBlock[] = [];
  for (const x of s.blocks ?? []) {
    if (x.endDay <= a || x.startDay >= b) out.push(x);
    else {
      if (x.startDay < a) out.push({ ...x, endDay: a });
      if (x.endDay > b) out.push({ ...x, startDay: b });
    }
  }
  out.push({ ...block, startDay: a, endDay: b });
  out.sort((x, y) => x.startDay - y.startDay);
  return { ...s, blocks: out };
}

export function renameBlock(s: Schedule, index: number, name: string): Schedule {
  const blocks = (s.blocks ?? []).slice();
  const cur = blocks[index];
  if (!cur) return s;
  blocks[index] = { ...cur, name };
  return { ...s, blocks };
}

export function removeBlock(s: Schedule, index: number): Schedule {
  const blocks = (s.blocks ?? []).filter((_, i) => i !== index);
  return { ...s, blocks: blocks.length > 0 ? blocks : undefined };
}

export function setBlocks(s: Schedule, blocks: ScheduleBlock[]): Schedule {
  return { ...s, blocks: blocks.length > 0 ? blocks : undefined };
}
