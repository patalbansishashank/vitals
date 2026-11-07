/**
 * (r069 D3/D4) The day's activities on a chart's time axis: one band per activity at its clock time, numbered, under the
 * plot it belongs to, and the same numbers in a legend under the axis (name and time). Approved activities and ones logged
 * by hand are solid; detected ones still waiting for review are dashed ("not counted yet"). One component for the
 * steps and the energy charts, so an activity sits at the same place on both.
 *
 * `dayMarks` reads the Ring's canonical activity list (`ringActivities`: the in-force session entries, hand logs
 * included, and the pending candidates), never Gauge's undecided sessions.
 */
import type { RingActivity } from '@/features/ring/activities';
import type { ReviewRow } from '@/living/activityCandidates';
import { clockText } from '@/components';
import { activityName, partOfDayWords } from './model';

export interface DayMark {
  id: string;
  start: number;
  end: number;
  label: string;
  /** Detected, waiting for review: not counted. */
  pending?: boolean;
  /** Logged by hand (no device saw it). */
  logged?: boolean;
}

/** "Treadmill walking" (the catalogue's name without its alternative: "Jogging / running" → "Jogging"). */
export const shortActivityName = (exerciseId: string | null): string => (exerciseId ? activityName(exerciseId).split(' / ')[0]! : 'Activity');

/** The activities of [from, to) as marks, oldest first (an activity without a clock time has no place on the axis). */
export function dayMarks(acts: { approved: readonly RingActivity[]; pending: readonly RingActivity[] }, from: number, to: number): DayMark[] {
  const out: DayMark[] = [];
  for (const a of [...acts.approved, ...acts.pending]) {
    if (!a.window || a.window.end <= from || a.window.start >= to) continue;
    out.push({
      id: a.id,
      start: a.window.start,
      end: a.window.end,
      label: shortActivityName(a.exerciseId),
      ...(a.status === 'pending' ? { pending: true } : {}),
      ...(a.sources.length === 1 && a.sources[0] === 'logged' ? { logged: true } : {}),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Review rows of the day as marks (Today's own list: approved, edited, logged by hand and to review; not the rejected). */
export function marksOfRows(rows: readonly ReviewRow[], from: number, to: number): DayMark[] {
  const out: DayMark[] = [];
  for (const r of rows) {
    if (r.status === 'rejected' || r.status === 'superseded' || r.timeUnknown) continue;
    const start = Date.parse(r.startAt);
    const end = Date.parse(r.endAt);
    if (!(end > start) || end <= from || start >= to) continue;
    out.push({
      id: r.id,
      start,
      end,
      label: shortActivityName(r.exerciseId),
      ...(r.status === 'pending' ? { pending: true } : {}),
      ...(r.sources.length === 0 ? { logged: true } : {}),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The words for "not counted yet" and the legend's name. */
export const LANE_WORDS = {
  legend: 'Activities',
  toReview: 'not counted yet',
  byHand: 'logged by hand',
} as const;

/** "Treadmill walking 14:08–14:53, logged by hand"; quiet: "Treadmill walking in the afternoon". */
export function markText(m: DayMark, quiet: boolean): string {
  const when = quiet ? partOfDayWords(m.start) : `${clockText(m.start)}–${clockText(m.end)}`;
  const tag = m.pending ? `, ${LANE_WORDS.toReview}` : m.logged ? `, ${LANE_WORDS.byHand}` : '';
  return `${m.label} ${when}${tag}`;
}

/** The bands, aligned with a plot spanning [from, to). Decorative: the legend says the same in words. */
export function ActivityLane({ marks, from, to }: { marks: readonly DayMark[]; from: number; to: number }) {
  if (marks.length === 0) return null;
  const pct = (t: number) => `${(Math.max(0, Math.min(1, (t - from) / (to - from))) * 100).toFixed(3)}%`;
  return (
    <div className="lv-lane" aria-hidden="true">
      {marks.map((m, i) => (
        <span
          key={m.id}
          className="lv-lane__band"
          data-pending={m.pending || undefined}
          style={{ left: pct(m.start), width: `calc(${pct(m.end)} - ${pct(m.start)})` }}
        >
          <span className="lv-lane__n">{i + 1}</span>
        </span>
      ))}
    </div>
  );
}

/** The numbered legend under the axis (the lane's words, read by everyone). */
export function ActivityLegend({ marks, quiet }: { marks: readonly DayMark[]; quiet: boolean }) {
  if (marks.length === 0) return null;
  return (
    <ol className="lv-lane__legend" aria-label={LANE_WORDS.legend}>
      {marks.map((m, i) => (
        <li key={m.id} data-pending={m.pending || undefined}>
          {/* quiet mode: no numbers anywhere, so a plain mark stands for the band (the lane is not drawn then) */}
          <span className="lv-lane__n" data-dot={quiet || undefined} aria-hidden="true">
            {quiet ? '' : i + 1}
          </span>
          <span className="lv-lane__name">{m.label}</span>
          <span className="lv-lane__when lm-num">
            {quiet ? partOfDayWords(m.start) : `${clockText(m.start)}–${clockText(m.end)}`}
            {m.pending ? ` · ${LANE_WORDS.toReview}` : m.logged ? ` · ${LANE_WORDS.byHand}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
