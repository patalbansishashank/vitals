/**
 * Calendar day → app day for fused steps (audit F12, energy SPEC §1.1 "the adapter into the engine's days").
 *
 * The server's `steps-fuse/1` days are local calendar days (midnight to midnight), while everything else in Vitals —
 * sessions, meals, fasts and the engine's day — sits on the APP day, which rolls over at `settings.dayRolloverH` (default
 * 04:00, SUITE_SPEC §3.4). A walk at 01:00 belongs to the app day before; with calendar steps its `stepsIncluded` was
 * subtracted from the wrong day's total (a step-energy deficit on D−1 and a double count on D).
 *
 * The adapter moves the LOCATED steps of the small hours (intervals whose last instant falls after local midnight and
 * before the rollover, r063 FX2) onto the app day they belong to, the same rule the app uses for every other instant
 * (`appDay`, read off the local wall clock, so a DST change in the small hours moves nothing):
 *
 *   located_app(D)  = located_cal(D)  − small(D) + small(D+1)
 *   headline_app(D) = max(located_app(D), headline_cal(D) − small(D) + small(D+1))   ('atLeast'; 'located' = located_app)
 *
 * It aggregates totals and never stretches them (§1.1): a 23- or 25-hour day keeps its observed steps. The ring's daily
 * total and its unlocated residual are not placed in time, so they stay on their calendar day; `unknownMin` stays the
 * server's figure (no Vitals rule reads it). The observed coverage minutes of the small hours move by time (see
 * `appDayStepsOf`). Pure.
 */
import { appDay } from './appDay';
import { addDays, instantToLocal, localToInstant } from './dates';
import type { LocalDate } from './types';

export interface FusedInterval {
  start: string;
  end: string;
  steps: number;
  lineage: string;
}

export interface FusedDay {
  date: string;
  located: number;
  headline: number;
  headlinePolicy: 'located' | 'atLeast';
  ringDailyTotal?: number | null;
  ringResidual?: number | null;
  coverage?: { ringMin: number; phoneMin: number; eitherMin: number; unknownMin: number };
}

export interface AppDaySteps {
  date: LocalDate;
  located: number;
  headline: number;
  headlinePolicy: 'located' | 'atLeast';
  ringDailyTotal?: number | null;
  ringResidual?: number | null;
  coverage?: { ringMin: number; phoneMin: number; eitherMin: number; unknownMin: number };
  /** The lineages of the app day's located intervals with steps (`hc-other:*` as `hc-other`), sorted. */
  lineages: string[];
  /** Located steps that came in from the next calendar day's small hours, and that left to the day before. */
  movedIn: number;
  movedOut: number;
  /**
   * (r063 A12) The app day's observed step coverage as disjoint spans (the union of its located intervals, zero-step ones
   * included: a counted 0 is coverage), ISO instants, sorted. What "covered" means for today's awake time.
   */
  spans: Array<{ start: string; end: string }>;
}

/** The union of [start, end) spans (ms), merged and sorted. */
export function mergeSpans(xs: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of [...xs].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

interface Small {
  steps: number;
  ringMin: number;
  phoneMin: number;
  eitherMin: number;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const lineageKey = (l: string) => (l.startsWith('hc-other') ? 'hc-other' : l.startsWith('ring') ? 'ring' : l.startsWith('phone') ? 'phone' : l);

/**
 * (r063 FX2, final review sR08/aR03) One allocation contract for counts and coverage:
 *  - a count stays indivisible and goes by its LAST instant (`end − 1 ms`), the server's counter rule `(prev, cur]` that
 *    put it on its calendar day: it moves when that instant's app day differs from its calendar day. So a 23:50–00:10
 *    span (counted on the 21st) moves to the 20th with a 04:00 rollover, and a coarse span across the rollover keeps the
 *    server's day for its count (its uncertainty is not split by a guess). The server splits merged minute units at the
 *    person's rollover (`rolloverH` in the fusion context), so located minutes are never merged across it;
 *  - coverage is time: the part of each interval inside a calendar day's small hours ([00:00, rollover)) moves to the app
 *    day before, as the server clipped it per calendar day; the app day's spans are clipped at the app-day boundaries.
 */
const toMs = (date: string, h: number, tz: string): number => {
  try {
    return Date.parse(localToInstant(date, h, tz));
  } catch {
    return Number.NaN;
  }
};

/** The fused calendar days as app days (rollover at `rolloverH` in `tz`); one row per calendar day of `days`. */
export function appDayStepsOf(i: { intervals: readonly FusedInterval[]; days: readonly FusedDay[]; tz: string; rolloverH: number }): AppDaySteps[] {
  // per calendar day X: the steps whose last instant falls in [X 00:00, X rollover) (they belong to app day X−1), and the
  // coverage minutes of that stretch
  const small = new Map<string, Small>();
  const lineages = new Map<string, Set<string>>();
  const spans = new Map<string, Array<[number, number]>>();
  const smallOf = (cal: string) => small.get(cal) ?? (small.set(cal, { steps: 0, ringMin: 0, phoneMin: 0, eitherMin: 0 }), small.get(cal)!);
  for (const iv of i.intervals) {
    const s = Date.parse(iv.start);
    const e0 = Date.parse(iv.end);
    if (!Number.isFinite(s) || !fin(iv.steps) || iv.steps < 0) continue;
    const e = Number.isFinite(e0) && e0 > s ? e0 : s;
    const last = e > s ? e - 1 : s;
    let cal: string;
    try {
      cal = instantToLocal(new Date(last).toISOString(), i.tz).date;
    } catch {
      continue;
    }
    const app = appDay(last, { tz: i.tz, rolloverH: i.rolloverH });
    const k = lineageKey(String(iv.lineage));
    if (iv.steps > 0) {
      const set = lineages.get(app) ?? new Set<string>();
      set.add(k);
      lineages.set(app, set);
    }
    if (app !== cal) smallOf(cal).steps += iv.steps;
    if (!(e > s)) continue;
    // coverage and spans by time: walk the calendar days the interval touches
    let firstCal: string;
    try {
      firstCal = instantToLocal(new Date(s).toISOString(), i.tz).date;
    } catch {
      continue;
    }
    for (let d = firstCal, n = 0; d <= cal && n < 400; d = addDays(d, 1), n++) {
      const midnight = toMs(d, 0, i.tz);
      const roll = toMs(d, i.rolloverH, i.tz);
      const next = toMs(addDays(d, 1), 0, i.tz);
      if (!Number.isFinite(midnight) || !Number.isFinite(roll) || !Number.isFinite(next)) continue;
      // [midnight, roll): app day d−1, moved off calendar day d; [roll, next midnight): app day d
      const a = Math.max(s, midnight);
      const b = Math.min(e, roll);
      if (b > a) {
        const m = smallOf(d);
        const min = (b - a) / 60_000;
        m.eitherMin += min;
        if (k === 'ring') m.ringMin += min;
        else if (k === 'phone') m.phoneMin += min;
        const prev = addDays(d, -1);
        spans.set(prev, [...(spans.get(prev) ?? []), [a, b]]);
      }
      const c = Math.max(s, roll);
      const f = Math.min(e, next);
      if (f > c) spans.set(d, [...(spans.get(d) ?? []), [c, f]]);
    }
  }
  const none: Small = { steps: 0, ringMin: 0, phoneMin: 0, eitherMin: 0 };
  return i.days.map((d) => {
    const out = small.get(d.date) ?? none;
    const into = small.get(addDays(d.date, 1)) ?? none;
    const located = Math.max(0, (fin(d.located) ? d.located : 0) - out.steps + into.steps);
    const policy = d.headlinePolicy === 'located' ? 'located' : 'atLeast';
    const headline = policy === 'located' ? located : Math.max(located, (fin(d.headline) ? d.headline : 0) - out.steps + into.steps);
    const cov = d.coverage;
    const shift = (v: number, o: number, n: number) => Math.max(0, Math.round(v - o + n));
    return {
      date: d.date,
      located,
      headline,
      headlinePolicy: policy,
      ...(d.ringDailyTotal !== undefined ? { ringDailyTotal: d.ringDailyTotal } : {}),
      ...(d.ringResidual !== undefined ? { ringResidual: d.ringResidual } : {}),
      ...(cov
        ? {
            coverage: {
              ringMin: shift(cov.ringMin, out.ringMin, into.ringMin),
              phoneMin: shift(cov.phoneMin, out.phoneMin, into.phoneMin),
              eitherMin: shift(cov.eitherMin, out.eitherMin, into.eitherMin),
              unknownMin: cov.unknownMin,
            },
          }
        : {}),
      lineages: [...(lineages.get(d.date) ?? [])].sort(),
      movedIn: into.steps,
      movedOut: out.steps,
      spans: mergeSpans(spans.get(d.date) ?? []).map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() })),
    };
  });
}
