/**
 * One elapsed day of Progress from the living plan's own records (energy SPEC §V4.6, §V3.5, §V2.3, §V2.6). Pure: the
 * loader in `../v3Adapter.ts` gathers the inputs, this reads them out. Nothing new is estimated here:
 *  - Heart Points: V2 `heartPoints` over the app day's fused minute timeline with the APPROVED activities (the day's done
 *    session entries: approved or edited device bouts and the person's own logs; a pending candidate writes no entry, so
 *    it adds no activity context). A minute earns inside an approved activity or with supported locomotion (§V2.3), as
 *    Today counts them (one metric, §V4.1, §V4.6). A bout without a clock time (a past-day manual log) is read on its
 *    equivalent MET for its minutes. null when no minute of the day has step or HR coverage and no activity is booked;
 *  - session stimuli: the `stimulus` of every done session entry;
 *  - energy out: V2 `energyDay` over the realised run's 24 hours of the day, the same minutes and the same approved bouts
 *    (each bout's incremental rate and gross envelope from its booked cost): `.total` with its scenario envelope; null
 *    without a realised run of the day;
 *  - intake: what `toLoggedDay` observed, only when every meal of the day is resolved (no meal with unknown energy and no
 *    imputed energy remainder, so no tapped or open slot); else null.
 */
import type { LocalDate, LogEntry } from '@/living';
import type { LoggedDayResult } from '@/living/loggedDay';
import { localToInstant } from '@/living/dates';
import { energyDay, type EnergyBout, type EnergyHour, type EnergyMinute } from '@/living/sensors/energyDay';
import { heartPoints, type PointsMinute } from '@/living/sensors/heartPoints';
import { minuteUsesExact, segmentsIn } from '@/living/sensors/hrZones';
import { movingIntervalsOf } from '@/living/boutParts';
import { exerciseRecordOf } from '@/living/sensors/activityEnergy';
import type { Envelope, HrSegment, Interval, Ms } from '@/living/sensors';
import type { TimelineMinute } from './timelines';
import type { ProgressDayActual } from '../v3Adapter';

type Session = Extract<LogEntry, { kind: 'session' }>;

/** An approved activity of the day: its window, its moving parts and what V2 reads of it. */
export interface DayBout {
  id: string;
  /** The bout's whole span (first start to last end). */
  window: Interval;
  /** (r063 S10/A15) Its moving intervals (pauses left out); absent or one part = the whole window. */
  parts?: Interval[];
  met: number | null;
  gait: 'walk' | 'run' | null;
  incrementalKcalPerMin: number | null;
  envelope: Envelope | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The equivalent MET of a session's engine dose (duration-weighted over its parts and phases); null = unknown. (r063 S11)
 * Resistance doses count too: an approved strength bout carries its booked equivalent MET like a cardio one.
 */
function sessionMet(e: Session): number | null {
  let w = 0;
  let sum = 0;
  for (const s of e.engine ?? []) {
    const phases = s.kind === 'cardio' ? (s.phases ?? []).filter((p) => isNum(p.met) && p.durationMin > 0) : [];
    if (phases.length > 0) {
      for (const p of phases) {
        w += p.durationMin;
        sum += p.durationMin * p.met!;
      }
    } else if (isNum(s.met) && isNum(s.durationMin) && s.durationMin > 0) {
      w += s.durationMin;
      sum += s.durationMin * s.met;
    }
  }
  return w > 0 ? sum / w : null;
}

function sessionGait(e: Session): 'walk' | 'run' | null {
  for (const s of e.engine ?? []) if (s.kind === 'cardio' && (s.modality === 'walk' || s.modality === 'run')) return s.modality;
  const id = e.performed.find((p) => p.exerciseId)?.exerciseId;
  const m = id ? exerciseRecordOf(id)?.cardioModality : undefined;
  return m === 'walk' || m === 'run' ? m : null;
}

/**
 * The day's approved activities with a known time: done session entries with a start and minutes. (r063 S10/A15) A paused
 * bout's moving intervals (`moving`) are its parts; otherwise one part from its clock start for its minutes.
 */
export function dayBouts(sessions: readonly Session[], date: LocalDate, tz: string): DayBout[] {
  const out: DayBout[] = [];
  for (const e of sessions) {
    if (e.status !== 'done' || !isNum(e.startH) || !isNum(e.durationMin) || e.durationMin <= 0) continue;
    let parts = e.moving && e.moving.length > 0 ? movingIntervalsOf(e) : null;
    if (!parts) {
      const start = Date.parse(localToInstant(date, e.startH, tz));
      if (!Number.isFinite(start)) continue;
      parts = [{ start, end: start + e.durationMin * 60_000 }];
    }
    const inc = e.cost?.incrementalKcal;
    const env = e.cost?.envelope;
    out.push({
      id: e.physicalBoutId ?? e.id,
      window: { start: parts[0]!.start, end: parts[parts.length - 1]!.end },
      parts,
      met: sessionMet(e),
      gait: sessionGait(e),
      incrementalKcalPerMin: isNum(inc) ? inc / e.durationMin : null,
      envelope: env && isNum(env.lo) && isNum(env.hi) ? { lo: env.lo, hi: env.hi } : null,
    });
  }
  return out;
}

/** An approved activity with minutes but no clock time (a manual log on a past day): V2 reads it on its equivalent MET. */
export interface UnplacedBout {
  durationMin: number;
  met: number | null;
  gait: 'walk' | 'run' | null;
}

export function unplacedBouts(sessions: readonly Session[]): UnplacedBout[] {
  const out: UnplacedBout[] = [];
  for (const e of sessions) {
    if (e.status !== 'done' || isNum(e.startH) || !isNum(e.durationMin) || e.durationMin <= 0) continue;
    out.push({ durationMin: e.durationMin, met: sessionMet(e), gait: sessionGait(e) });
  }
  return out;
}

/**
 * Heart Points of [start, end) (V2 `fit-points/1`, §V2.3). (r063 FX2, final review sR04/aR07, sR05/aR06) Time is cut into
 * disjoint pieces at minute, bout and day boundaries, and each second counts once, on one channel:
 *  - a piece inside an approved bout's moving parts has that bout as its activity; where approved bouts overlap, the one
 *    that started first (then by id, as Ring's day zones) takes the piece, so overlapping bouts never count a second
 *    twice and adjacent bouts each keep their own MET;
 *  - V2 keeps a piece only inside an approved activity or in a minute with supported locomotion (cadence ≥ 60), the
 *    settled §V2.3 rule;
 *  - HR (`minuteUsesExact`, the one source-resolved rule): Gauge's exact segments (`hrExact`, already clipped to the span
 *    the answer covers) rate each supported sub-interval on its own bpm, clipped to the piece (so a bout's moving parts
 *    and the day's bounds), exactly as a bout's own points do; a minute without exact time (a Health Connect minute, or
 *    one the exact answer missed) shares its minute mean's supported seconds out once: bout pieces first, then the rest;
 *  - untimed bouts (a past-day manual log without a clock time): their minutes earn on their equivalent MET only in time
 *    that earned nothing else (not asleep, not in a timed bout, not earning from HR or cadence), in entry order. A
 *    window with no such time adds nothing: an untimed log never stacks on counted time.
 * Partial minutes count their seconds (a 30-second moderate bout earns 0.5). null when no minute has step or HR coverage
 * and no activity is booked (unknown, never 0).
 */
export function dayHeartPoints(i: { start: Ms; end: Ms; minuteAt: (t: Ms) => TimelineMinute | undefined; bouts: readonly DayBout[]; unplaced?: readonly UnplacedBout[]; hrExact?: readonly HrSegment[] | null; ageY: number | null }): number | null {
  const exact = i.hrExact ? [...i.hrExact].filter((g) => isNum(g.start) && isNum(g.end) && g.end > g.start && isNum(g.bpm) && g.bpm > 0).sort((a, b) => a.start - b.start) : null;
  // the bouts' moving parts, each with its bout's rank (earlier start first, then id)
  const ranked = [...i.bouts].sort((a, b) => a.window.start - b.window.start || a.id.localeCompare(b.id));
  const parts = ranked.flatMap((b, rank) => (b.parts && b.parts.length > 0 ? b.parts : [b.window]).filter((p) => p.end > p.start).map((p) => ({ start: p.start, end: p.end, b, rank })));
  const minutes: PointsMinute[] = [];
  /** Per piece: asleep, or inside a timed bout (occupied whatever it earned). */
  const held: boolean[] = [];
  let covered = (i.unplaced?.length ?? 0) > 0 || i.bouts.length > 0;
  for (let t = i.start; t < i.end; t += 60_000) {
    const m = i.minuteAt(t);
    if (m && (m.steps !== null || m.hr !== null)) covered = true;
    const pieceEnd = Math.min(t + 60_000, i.end);
    const cuts = new Set<number>([t, pieceEnd]);
    const here = parts.filter((p) => p.start < pieceEnd && p.end > t);
    for (const p of here) {
      if (p.start > t && p.start < pieceEnd) cuts.add(p.start);
      if (p.end > t && p.end < pieceEnd) cuts.add(p.end);
    }
    const edges = [...cuts].sort((a, b) => a - b);
    const pieces: Array<{ a: Ms; b: Ms; bout: DayBout | null }> = [];
    for (let k = 0; k + 1 < edges.length; k++) {
      const a = edges[k]!;
      const b = edges[k + 1]!;
      let best: (typeof here)[number] | null = null;
      for (const p of here) if (p.start <= a && p.end >= b && (!best || p.rank < best.rank)) best = p;
      pieces.push({ a, b, bout: best ? best.b : null });
    }
    const asleep = m?.sleep === 'asleep';
    const cadence = m && m.support === 'minute' ? m.steps : null;
    const useExact = !!exact && minuteUsesExact(m?.hr?.source, segmentsIn(exact, t, t + 60_000).reduce((s, g) => s + (g.end - g.start), 0));
    // a minute mean's supported seconds, scaled to the part of the minute inside the window, shared once: bouts first
    let left = !useExact && m?.hr ? (m.hr.supportedS * (pieceEnd - t)) / 60_000 : 0;
    const hrOf = new Map<number, PointsMinute['hr']>();
    for (const k of [...pieces.keys()].sort((x, y) => Number(pieces[y]!.bout !== null) - Number(pieces[x]!.bout !== null) || x - y)) {
      const p = pieces[k]!;
      if (useExact) {
        const segs = segmentsIn(exact!, p.a, p.b);
        let ms = 0;
        let sum = 0;
        for (const g of segs) {
          ms += g.end - g.start;
          sum += (g.end - g.start) * g.bpm;
        }
        hrOf.set(k, ms > 0 ? { bpm: sum / ms, supportedS: ms / 1000, parts: segs.map((g) => ({ bpm: g.bpm, seconds: (g.end - g.start) / 1000 })) } : null);
      } else if (m?.hr && left > 0) {
        const s = Math.min(left, (p.b - p.a) / 1000);
        left -= s;
        hrOf.set(k, s > 0 ? { bpm: m.hr.bpm, supportedS: s } : null);
      }
    }
    pieces.forEach((p, k) => {
      const hr = hrOf.get(k) ?? null;
      minutes.push({ start: t, seconds: (p.b - p.a) / 1000, asleep, activity: p.bout ? { met: p.bout.met, gait: p.bout.gait } : null, cadence, hr });
      held.push(asleep || p.bout !== null);
    });
  }
  if (!covered) return null;
  const timed = heartPoints({ ageY: i.ageY, minutes });
  let points = timed.points;
  const un = i.unplaced ?? [];
  if (un.length > 0) {
    // the window's free time: not asleep, not in a timed bout, not earning on any channel
    let free = 0;
    timed.minutes.forEach((r, k) => {
      if (held[k]) return;
      const earning = r.channels.reduce((s, c) => s + (c.rate > 0 ? c.seconds : 0), 0);
      free += Math.max(0, (minutes[k]!.seconds ?? 60) - earning);
    });
    const extra: PointsMinute[] = [];
    for (const u of un) {
      let take = Math.min(u.durationMin * 60, free);
      free -= take;
      for (let k = 0; take > 0; k++) {
        const s = Math.min(60, take);
        extra.push({ start: i.start + k * 60_000, seconds: s, asleep: false, activity: { met: u.met, gait: u.gait }, cadence: null, hr: null });
        take -= s;
      }
    }
    if (extra.length > 0) points += heartPoints({ ageY: i.ageY, minutes: extra }).points;
  }
  return Number.isFinite(points) ? points : null;
}

const NO_MINUTE: EnergyMinute = { sleep: 'none', steps: null, support: null };

/** Energy out of the day: `energyDay(...).total` over the realised run's hours, with its envelope. */
export function dayEnergyOut(i: { hours: readonly EnergyHour[] | null; minuteAt: (t: Ms) => TimelineMinute | undefined; bouts: readonly DayBout[] }): ProgressDayActual['energyOut'] {
  if (!i.hours || i.hours.length === 0 || !i.hours.every((h) => isNum(h.tdee))) return null;
  const minutes: EnergyMinute[] = [];
  for (const h of i.hours) {
    for (let k = 0; k < 60; k++) {
      const m = i.minuteAt(h.start + k * 60_000);
      minutes.push(m ? { sleep: m.sleep, steps: m.steps, support: m.support } : NO_MINUTE);
    }
  }
  const bouts: EnergyBout[] = i.bouts.map((b) => ({ id: b.id, window: b.window, ...(b.parts && b.parts.length > 1 ? { parts: b.parts } : {}), incrementalKcalPerMin: b.incrementalKcalPerMin, envelope: b.envelope }));
  const d = energyDay({ hours: i.hours, minutes, bouts });
  return isNum(d.total) ? { kcal: d.total, envelope: { ...d.envelope } } : null;
}

/** Intake of the day when every meal is resolved (see the file comment); else null. */
export function dayIntakeKcal(r: LoggedDayResult | null): number | null {
  if (!r || r.assumedDay) return null;
  const kcal = r.observed.energyKcal;
  if (kcal === null || !isNum(kcal) || r.observed.unknownEnergyMeals > 0) return null;
  if (r.remainders.some((x) => x.channel === 'energy')) return null;
  return kcal;
}

export interface DayActualInput {
  date: LocalDate;
  /** The app day's window, [start, end) (end = now for today). */
  start: Ms;
  end: Ms;
  tz: string;
  /** Effective session entries of the day (any status). */
  sessions: readonly Session[];
  /** The realised history's day (null outside the plan). */
  result: LoggedDayResult | null;
  minuteAt: (t: Ms) => TimelineMinute | undefined;
  /** The realised run's hours of the day (null: no run). */
  hours: readonly EnergyHour[] | null;
  ageY: number | null;
  /**
   * (r063 FX2) Gauge's exact HR segments of the day (`/hr-intervals`, clipped to the span the answer covers), when the
   * loader has them; the minute means stand in for every minute they do not cover.
   */
  hrExact?: readonly HrSegment[] | null;
}

export function dayActual(i: DayActualInput): ProgressDayActual {
  const bouts = dayBouts(i.sessions, i.date, i.tz);
  return {
    date: i.date,
    heartPoints: dayHeartPoints({ start: i.start, end: i.end, minuteAt: i.minuteAt, bouts, unplaced: unplacedBouts(i.sessions), hrExact: i.hrExact ?? null, ageY: i.ageY }),
    sessionStimuli: i.sessions.filter((e) => e.status === 'done' && e.stimulus).map((e) => e.stimulus),
    energyOut: dayEnergyOut({ hours: i.hours, minuteAt: i.minuteAt, bouts }),
    intakeKcal: dayIntakeKcal(i.result),
  };
}
