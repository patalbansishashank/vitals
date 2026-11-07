/**
 * The moving parts of one physical bout (r063 S10/A15). A recorded workout with pauses keeps its pauses out of exercise
 * time everywhere: its moving intervals travel from the approval (the session entry's `moving`) through the replay (one
 * engine session per moving interval, one bout identity, one recovery booking via `boutDurationMin`), Heart Points, zones,
 * the step-fusion context and the energy allocation. Pure.
 */
import type { ExerciseSession, IntervalPhase } from '@/engine';
import { unionMs, type Interval } from './sensors/types';
import type { Instant, LogEntry } from './types';

/** The moving intervals of `window` (its complement of `pauses`), in order; the whole window when nothing is paused. */
export function movingSpans(window: Interval, pauses?: readonly Interval[] | null): Interval[] {
  if (!(window.end > window.start)) return [];
  const ps = (pauses ?? [])
    .map((p) => ({ start: Math.max(window.start, p.start), end: Math.min(window.end, p.end) }))
    .filter((p) => p.end > p.start)
    .sort((a, b) => a.start - b.start);
  if (ps.length === 0) return [{ start: window.start, end: window.end }];
  const out: Interval[] = [];
  let t = window.start;
  for (const p of ps) {
    if (p.start > t) out.push({ start: t, end: p.start });
    t = Math.max(t, p.end);
  }
  if (window.end > t) out.push({ start: t, end: window.end });
  return out;
}

/** True when some pause actually removes time from the window. */
export const hasPauses = (window: Interval, pauses?: readonly Interval[] | null): boolean =>
  !!pauses && pauses.length > 0 && unionMs(pauses, window) > 0;

type Session = Extract<LogEntry, { kind: 'session' }>;

/**
 * The moving intervals of a session entry as instants (ms): its `moving` (written at approval for a paused bout), else
 * its interval occurrence, else null (a manual log without a clock time).
 */
export function movingIntervalsOf(e: Pick<Session, 'moving' | 'occurrence'>): Interval[] | null {
  if (e.moving && e.moving.length > 0) {
    const xs = e.moving
      .map((m) => ({ start: Date.parse(m.start), end: Date.parse(m.end) }))
      .filter((m) => Number.isFinite(m.start) && m.end > m.start);
    if (xs.length > 0) return xs;
  }
  const iv = e.occurrence?.precision === 'interval' ? e.occurrence.interval : null;
  if (!iv) return null;
  const w = { start: Date.parse(iv.start), end: Date.parse(iv.end) };
  return Number.isFinite(w.start) && w.end > w.start ? [w] : null;
}

/** The session entry's `moving` field for a window with pauses (absent when nothing is paused). */
export function movingField(
  window: Interval,
  pauses?: readonly Interval[] | null,
): { moving: Array<{ start: Instant; end: Instant }> } | Record<string, never> {
  if (!hasPauses(window, pauses)) return {};
  return {
    moving: movingSpans(window, pauses).map((s) => ({
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
    })),
  };
}

/** The phases of [off, off + len) minutes of a phase time line (clipped; a phase's own gross scaled by its kept share). */
function slicePhases(phases: readonly IntervalPhase[], off: number, len: number): IntervalPhase[] {
  const out: IntervalPhase[] = [];
  let t = 0;
  for (const ph of phases) {
    const d = ph.durationMin > 0 ? ph.durationMin : 0;
    const a = Math.max(t, off);
    const b = Math.min(t + d, off + len);
    if (b > a) {
      const f = (b - a) / d;
      out.push({
        ...ph,
        durationMin: b - a,
        ...(ph.realisedGrossKcal !== undefined ? { realisedGrossKcal: ph.realisedGrossKcal * f } : {}),
      });
    }
    t += d;
  }
  return out;
}

/**
 * One bout's engine sessions split at its pauses: each moving interval `parts[k]` (its clock start on the app day and its
 * minutes, in order, Σ = the sessions' booked minutes) becomes its own engine session with the time share of the realised
 * gross, the phases and the included steps, the same `boutId` and the whole bout's `boutDurationMin` (so EPOC is booked
 * once for the bout). (r063 FX2, final review sR07/aR08) With one part the sessions keep their minutes but move to that
 * part's clock start: a bout paused at its start or end is replayed where it moved, not at the window's start.
 */
export function splitBoutSessions(
  sessions: readonly ExerciseSession[],
  parts: ReadonlyArray<{ startH: number; durationMin: number }>,
): ExerciseSession[] {
  const ps = parts.filter((p) => p.durationMin > 0);
  if (ps.length === 0) return [...sessions];
  if (ps.length === 1) return sessions.map((s) => ({ ...s, startH: ps[0]!.startH }));
  const total = ps.reduce((a, p) => a + p.durationMin, 0);
  const out: ExerciseSession[] = [];
  for (const s of sessions) {
    const id = s.sessionId;
    const bout = s.boutId ?? id;
    let off = 0;
    let stepsLeft = s.kind === 'cardio' && s.stepsIncluded !== undefined ? s.stepsIncluded : undefined;
    ps.forEach((p, k) => {
      const f = p.durationMin / total;
      const base = {
        startH: p.startH,
        durationMin: p.durationMin,
        ...(s.realisedGrossKcal !== undefined ? { realisedGrossKcal: s.realisedGrossKcal * f } : {}),
        ...(id !== undefined ? { sessionId: `${id}#m${k}` } : {}),
        ...(bout !== undefined ? { boutId: bout } : {}),
        boutDurationMin: total,
      };
      if (s.kind === 'cardio') {
        let steps: number | undefined;
        if (stepsLeft !== undefined) {
          steps = k === ps.length - 1 ? stepsLeft : Math.round(s.stepsIncluded! * f);
          stepsLeft -= steps;
        }
        const phases =
          s.phases && s.phases.length > 0 ? slicePhases(s.phases, off, p.durationMin) : undefined;
        const { stepsIncluded: _st, phases: _ph, ...rest } = s;
        void _st;
        void _ph;
        out.push({
          ...rest,
          ...base,
          ...(phases && phases.length > 0 ? { phases } : {}),
          ...(steps !== undefined && steps > 0 ? { stepsIncluded: steps } : {}),
        });
      } else {
        out.push({ ...s, ...base });
      }
      off += p.durationMin;
    });
  }
  return out;
}
