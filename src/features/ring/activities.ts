/**
 * (0.6.3 S25/A14) The Ring's workouts from the canonical activity collection, not Gauge's original sessions:
 *
 *  - **approved**: the effective done session entries (approved or edited device bouts, Health Connect sessions and the
 *    person's own logs), each with the window the person decided (an edited candidate's `decision`, else the entry's
 *    clock time and minutes), its pauses (the entry's moving intervals when it has them, else the candidate's), the frozen zone boundaries and the booked energy; the Gauge sessions behind it
 *    (`gauge:<id>` refs of its candidate, compact tombstones included) are linked as evidence;
 *  - **pending**: candidates nobody decided yet, listed apart and never counted;
 *  - a rejected or withdrawn candidate never appears, even if a stale entry still names it.
 *
 * `dayZoneBouts` turns them into V2 `dayZones` bouts: clipped to the day by V2, and overlap-resolved here (a stretch two
 * approved activities share counts once, for the earlier one). Pure: the hook in `useActivities.ts` reads the store.
 */
import type { LocalDate, LogEntry } from '@/living';
import type { SessionInputsProvenance } from '@/living/types';
import type { CandidateRecord } from '@/living/activityCandidates';
import { movingIntervalsOf } from '@/living/boutParts';
import { localToInstant } from '@/living/dates';
import type { HrSegment, Interval, ZoneBoundaries, ZoneBout } from '@/living/sensors';

type Session = Extract<LogEntry, { kind: 'session' }>;
export type SessionEntry = Session & { id: string; date: LocalDate };

export type ActivitySourceKind = 'ring' | 'healthConnect' | 'logged';

export interface RingActivity {
  /** The session entry id (approved) or the candidate key (pending). */
  id: string;
  status: 'approved' | 'pending';
  /** The app date it counts on. */
  date: LocalDate;
  /** The decided window (UTC ms); null for a log without a clock time. */
  window: Interval | null;
  pauses: Interval[];
  /** Minutes moving (the entry's minutes, else the window less its pauses). */
  durationMin: number | null;
  exerciseId: string | null;
  /** The booked gross energy (kcal; storage unit), null when not booked. */
  grossKcal: number | null;
  /** Energy above own rest (kcal), null when unknown. */
  aboveRestKcal: number | null;
  /** (r069 D4) The booked energy's likely range (kcal; the estimate's scenario envelope), null when none was booked. */
  kcalRange?: { lo: number; hi: number } | null;
  /** (r069 D4) How the booked energy was estimated (`compendiumMet`, `acsm`, `hr`, `power`, `reported`…), null when unknown. */
  kcalMethod?: string | null;
  /** (r069 D4) Which inputs of the estimate were measured, reported or assumed (heart rate, speed, power, duration). */
  inputs?: SessionInputsProvenance | null;
  candidateKey: string | null;
  /** The Gauge sessions behind it (evidence, `gauge:<id>` refs). */
  gaugeIds: string[];
  sources: ActivitySourceKind[];
  /** Zone boundaries frozen at approval (null: none frozen; a pending one never has them). */
  zones: ZoneBoundaries | null;
  /** A Borg CR10 session rating, for session-RPE load. */
  rpeCr10: number | null;
  /** Equivalent average heart rate the entry recorded, when any. */
  avgHr: number | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ms = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

function sourcesOf(refs: readonly string[], manual: boolean): ActivitySourceKind[] {
  const out = new Set<ActivitySourceKind>();
  for (const r of refs) {
    if (r.startsWith('gauge:')) out.add('ring');
    else if (r.startsWith('hc:') || r.startsWith('hc-')) out.add('healthConnect');
  }
  if (manual || out.size === 0) out.add('logged');
  return [...out];
}

const gaugeIdsOf = (refs: readonly string[]): string[] => refs.filter((r) => r.startsWith('gauge:')).map((r) => r.slice('gauge:'.length));

function clipPauses(pauses: readonly Interval[] | undefined, w: Interval): Interval[] {
  return (pauses ?? [])
    .map((p) => ({ start: Math.max(p.start, w.start), end: Math.min(p.end, w.end) }))
    .filter((p) => p.end > p.start)
    .sort((a, b) => a.start - b.start);
}

/** The stretches of `w` outside the moving intervals (the bout's pauses). */
function gapsOf(w: Interval, moving: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let t = w.start;
  for (const m of [...moving].sort((a, b) => a.start - b.start)) {
    if (m.start > t) out.push({ start: t, end: Math.min(m.start, w.end) });
    t = Math.max(t, m.end);
  }
  if (w.end > t) out.push({ start: t, end: w.end });
  return out.filter((g) => g.end > g.start);
}

const pausedMs = (pauses: readonly Interval[]): number => pauses.reduce((s, p) => s + (p.end - p.start), 0);

function rpeOf(e: Session): number | null {
  for (const p of e.performed ?? []) {
    const x = p as { rpe?: number; rpeScale?: string };
    if (x.rpeScale === 'cr10' && isNum(x.rpe) && x.rpe >= 0 && x.rpe <= 10) return x.rpe;
  }
  return null;
}

/** The approved and pending activities whose date falls in [from, to] (inclusive), newest first. */
export function ringActivities(i: { sessions: readonly SessionEntry[]; candidates: readonly CandidateRecord[]; from: LocalDate; to: LocalDate; tz: string }): { approved: RingActivity[]; pending: RingActivity[] } {
  const byKey = new Map(i.candidates.map((c) => [c.key, c] as const));
  const inRange = (d: string) => d >= i.from && d <= i.to;
  const approved: RingActivity[] = [];
  const claimed = new Set<string>();
  for (const e of i.sessions) {
    if (e.kind !== 'session' || e.status !== 'done' || !inRange(e.date)) continue;
    const key = e.candidate?.key ?? e.physicalBoutId ?? null;
    const c = key ? byKey.get(key) : undefined;
    // a rejected or withdrawn candidate never counts, whatever entry still names it
    if (c && (c.status === 'rejected' || c.status === 'superseded')) continue;
    if (key) claimed.add(key);
    const full = c && c.compact !== true ? c : null;
    // (r063 FX2 sR16) a log the person saved as "time unknown" has no clock time on its entry (no `startH`, a date-only
    // occurrence): no window at all, whatever placeholder its candidate keeps, so it never takes HR or zone time
    const spans = movingIntervalsOf(e);
    const timeKnown = isNum(e.startH) || spans !== null;
    let window: Interval | null = null;
    if (full && timeKnown) {
      const s = ms(full.decision?.startAt ?? full.startAt);
      const t = ms(full.decision?.endAt ?? full.endAt);
      if (s !== null && t !== null && t > s) window = { start: s, end: t };
    }
    // (r063 INT, ACT-B S10/A15 handoff) a paused bout's moving intervals, written on its entry at approval (`moving`), are
    // the canonical pauses: they follow the decided window and outlive the candidate's compaction
    const moving = e.moving && e.moving.length > 0 ? spans : null;
    // (r063 FX2 sR07/aR08) after compaction the entry itself places the bout: its moving intervals, else its occurrence
    // interval (exact instants), and only then its clock hours
    if (!window && spans) window = { start: spans[0]!.start, end: spans[spans.length - 1]!.end };
    if (!window && isNum(e.startH) && isNum(e.durationMin) && e.durationMin > 0) {
      const s = ms(localToInstant(e.date, e.startH, i.tz));
      if (s !== null) window = { start: s, end: s + e.durationMin * 60_000 };
    }
    const pauses = !window ? [] : moving ? clipPauses(gapsOf(window, moving), window) : full ? clipPauses(full.pauses, window) : [];
    const refs = c?.refs ?? [];
    const exerciseId = full?.decision?.exerciseId ?? e.performed.find((p) => p.exerciseId)?.exerciseId ?? null;
    const durationMin = isNum(e.durationMin) && e.durationMin > 0 ? e.durationMin : window ? (window.end - window.start - pausedMs(pauses)) / 60_000 : null;
    approved.push({
      id: e.id,
      status: 'approved',
      date: e.date,
      window,
      pauses,
      durationMin,
      exerciseId,
      grossKcal: isNum(e.cost?.grossKcal) ? e.cost!.grossKcal : null,
      aboveRestKcal: isNum(e.cost?.netAboveRestKcal) ? e.cost!.netAboveRestKcal : null,
      kcalRange: e.cost?.envelope && isNum(e.cost.envelope.lo) && isNum(e.cost.envelope.hi) ? { lo: e.cost.envelope.lo, hi: e.cost.envelope.hi } : null,
      kcalMethod: e.cost?.method ?? null,
      inputs: e.cost?.inputsProvenance ?? null,
      candidateKey: key,
      gaugeIds: gaugeIdsOf(refs),
      sources: sourcesOf(refs, e.candidate?.manual === true || !c),
      zones: e.zones && Array.isArray(e.zones.edgesBpm) && e.zones.edgesBpm.length === 6 ? (e.zones as unknown as ZoneBoundaries) : null,
      rpeCr10: rpeOf(e),
      avgHr: isNum(e.hr?.avgBpm) ? e.hr!.avgBpm! : null,
    });
  }
  const pending: RingActivity[] = [];
  for (const c of i.candidates) {
    if (c.compact === true || c.status !== 'pending' || c.supersededBy || claimed.has(c.key) || !inRange(c.date)) continue;
    const s = ms(c.startAt);
    const t = ms(c.endAt);
    const window = c.timeUnknown !== true && s !== null && t !== null && t > s ? { start: s, end: t } : null;
    const pauses = window ? clipPauses(c.pauses, window) : [];
    const est = c.estimate as { booked?: { grossKcal?: number; envelope?: { lo: number; hi: number }; method?: string } } | null;
    pending.push({
      id: c.key,
      status: 'pending',
      date: c.date,
      window,
      pauses,
      durationMin: window ? (window.end - window.start - pausedMs(pauses)) / 60_000 : isNum(c.measures?.durationMin) ? c.measures.durationMin : null,
      exerciseId: c.suggested?.exerciseId ?? null,
      grossKcal: isNum(est?.booked?.grossKcal) ? est.booked.grossKcal : null,
      aboveRestKcal: null,
      kcalRange: est?.booked?.envelope && isNum(est.booked.envelope.lo) && isNum(est.booked.envelope.hi) ? { lo: est.booked.envelope.lo, hi: est.booked.envelope.hi } : null,
      kcalMethod: est?.booked?.method ?? null,
      inputs: null,
      candidateKey: c.key,
      gaugeIds: gaugeIdsOf(c.refs),
      sources: sourcesOf(c.refs, false),
      zones: null,
      rpeCr10: null,
      avgHr: isNum(c.measures?.meanHr) ? c.measures.meanHr : null,
    });
  }
  const newest = (a: RingActivity, b: RingActivity) => (b.window?.start ?? Date.parse(`${b.date}T12:00:00Z`)) - (a.window?.start ?? Date.parse(`${a.date}T12:00:00Z`));
  return { approved: approved.sort(newest), pending: pending.sort(newest) };
}

/** Every calendar date (YYYY-MM-DD, in `tz`) an interval touches: a workout across midnight needs both days' minutes. */
export function datesOverlapping(w: Interval, tz: string): string[] {
  const fmt = (t: number) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
    } catch {
      return new Date(t).toISOString().slice(0, 10);
    }
  };
  const out: string[] = [];
  const end = Math.max(w.start, w.end - 1);
  for (let t = w.start; ; t += 3_600_000) {
    const d = fmt(Math.min(t, end));
    if (out.at(-1) !== d) out.push(d);
    if (t >= end) break;
  }
  return out;
}

/**
 * V2 `dayZones` bouts of activities, overlap-resolved: each later activity's stretch already covered by an earlier one's
 * MOVING time is treated as paused (it counts once). (r063 FX2 sR07/aR08) An earlier activity's pauses cover nothing, so
 * another activity during a pause keeps its time. `boundariesOf` gives each activity's boundaries (frozen, else the
 * profile now).
 */
export function dayZoneBouts(acts: readonly RingActivity[], segmentsOf: (a: RingActivity & { window: Interval }) => readonly HrSegment[], boundariesOf: (a: RingActivity) => ZoneBoundaries | null): ZoneBout[] {
  const timed = acts.filter((a): a is RingActivity & { window: Interval } => a.window !== null).sort((a, b) => a.window.start - b.window.start || a.id.localeCompare(b.id));
  const covered: Interval[] = [];
  const out: ZoneBout[] = [];
  for (const a of timed) {
    const overlap = covered.map((c) => ({ start: Math.max(c.start, a.window.start), end: Math.min(c.end, a.window.end) })).filter((c) => c.end > c.start);
    out.push({ id: a.id, window: a.window, pauses: mergeIntervals([...a.pauses, ...overlap]), segments: segmentsOf(a), boundaries: boundariesOf(a), status: a.status });
    // only counted (approved) time hides later activities' time; a pending one never takes time from an approved one
    if (a.status === 'approved') covered.push(...movingOf(a.window, a.pauses));
  }
  return out;
}

/** The moving stretches of a window (its complement of `pauses`). */
function movingOf(w: Interval, pauses: readonly Interval[]): Interval[] {
  const gaps = mergeIntervals(pauses.map((p) => ({ start: Math.max(w.start, p.start), end: Math.min(w.end, p.end) })).filter((p) => p.end > p.start));
  const out: Interval[] = [];
  let t = w.start;
  for (const g of gaps) {
    if (g.start > t) out.push({ start: t, end: g.start });
    t = Math.max(t, g.end);
  }
  if (w.end > t) out.push({ start: t, end: w.end });
  return out;
}

function mergeIntervals(xs: readonly Interval[]): Interval[] {
  const s = [...xs].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of s) {
    const last = out.at(-1);
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/** An activity's total minutes in zones 1-3 and 4-5 are V2's; this names where it came from. */
export function sourceWords(a: RingActivity): string {
  const words: Record<ActivitySourceKind, string> = { ring: 'Ring', healthConnect: 'Health Connect', logged: 'Logged' };
  return a.sources.map((s) => words[s]).join(' · ');
}

/** An instant as the wall-clock ISO of `tz` ("2026-10-28T23:50:00"), the form the Ring's clock helpers read. */
export function wallIso(t: number, tz: string): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value] as const),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return new Date(t).toISOString().slice(0, 19);
  }
}
