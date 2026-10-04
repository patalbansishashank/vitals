/**
 * Ring views (R16 §6 gaps 1, 3–7), presentational only: the night stages timeline with minutes per stage, a day line
 * chart (heart rate with resting marked; overnight blood oxygen and skin temperature), steps per day with today's total
 * and active minutes, and the workouts list. SVG in the Living chart idiom (CHART_SPEC §7.8–7.10): the recovery hue for
 * sleep and night signals, the cardio hue for heart rate and activity, printed ticks, a table twin or a list in text.
 * Missing data is drawn as missing: hollow day marks, breaks in lines, an "unknown" row for unclassified sleep.
 */
import { memo, useRef } from 'react';
import { Engraved } from '@/components';
import { useElementWidth } from '@/features/charts/core/hooks';
import { fmtDay, fmtDayMonth, fmtHours } from '../../format';
import { RING_COPY as C, workoutTypeWord } from './copy';
import { NIGHT_STAGES, clockAt, runsOf, type NightModel, type NightStage, type SeriesPoint, type StepsDay, type WorkoutRow } from './ringData';
import './ring.css';

const nf = (n: number, d = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
const ROW: Record<NightStage, number> = { awake: 0, rem: 1, light: 2, deep: 3, unknown: 4 };

/* ------------------------------------------------------------------------------------------- night view */

export const NightStages = memo(function NightStages({ night }: { night: NightModel }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const padL = 64, padR = 8, rowH = 18, top = 4;
  const h = top + rowH * 5 + 22;
  const span = night.end - night.start;
  const X = (t: number) => padL + ((t - night.start) / span) * (width - padL - padR);
  const hours: number[] = [];
  const firstHour = Math.ceil((night.start + night.offsetS * 1000) / 3_600_000) * 3_600_000 - night.offsetS * 1000;
  const step = span > 10 * 3_600_000 ? 2 : 1;
  for (let t = firstHour; t <= night.end; t += step * 3_600_000) hours.push(t);
  const bed = clockAt(night.start, night.offsetS), wake = clockAt(night.end, night.offsetS);
  const summary = `${C.bedWake(bed, wake)}. ${NIGHT_STAGES.map((s) => `${C.stage[s]} ${night.minutes[s]} min`).join(', ')}${night.uncovered ? `. ${C.uncovered(night.uncovered)}` : ''}.`;
  return (
    <div ref={ref} className="lv-ring-night">
      <p className="lv-ring-lines">
        <span>{C.bedWake(bed, wake)}</span> · <span>{C.asleep(fmtHours(night.asleepMin / 60))}</span>
      </p>
      <svg className="lv-ring-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={summary}>
        {NIGHT_STAGES.map((s) => (
          <g key={s}>
            <line className="lv-ring-grid" x1={padL} x2={width - padR} y1={top + ROW[s] * rowH + rowH - 0.5} y2={top + ROW[s] * rowH + rowH - 0.5} />
            <text className="lv-ring-tick" x={padL - 6} y={top + ROW[s] * rowH + rowH - 5} textAnchor="end">
              {C.stage[s]}
            </text>
          </g>
        ))}
        {night.segments.map((g) => (
          <rect
            key={`${g.start}-${g.stage}`}
            className="lv-ring-stage"
            data-stage={g.stage}
            x={X(g.start)}
            y={top + ROW[g.stage] * rowH + 2}
            width={Math.max(1, X(g.end) - X(g.start))}
            height={rowH - 4}
          />
        ))}
        {hours.map((t) => (
          <text key={t} className="lv-ring-tick" x={X(t)} y={h - 6} textAnchor="middle">
            {clockAt(t, night.offsetS).slice(0, 2)}
          </text>
        ))}
      </svg>
      <table className="lv-prog-table lv-ring-table">
        <caption className="lm-sr">{C.stagesCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{C.stageCol}</th>
            <th scope="col">{C.minutesCol}</th>
          </tr>
        </thead>
        <tbody>
          {(['deep', 'light', 'rem', 'awake', 'unknown'] as const).map((s) => (
            <tr key={s} data-stage={s}>
              <th scope="row">
                <i className="lv-ring-key" data-stage={s} aria-hidden="true" /> {C.stage[s]}
                {s === 'unknown' ? <span className="lv-ring-note"> · {C.stageHelp.unknown}</span> : null}
              </th>
              <td className="lm-num">{night.minutes[s]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {night.uncovered ? <p className="lv-ring-note">{C.uncovered(night.uncovered)}</p> : null}
      {night.provisional ? <p className="lv-ring-note">{C.provisional}</p> : null}
    </div>
  );
});

/* ------------------------------------------------------------------------------------------- day line chart */

export interface DayLineProps {
  points: readonly SeriesPoint[];
  from: number;
  to: number;
  offsetS: number;
  unit: string;
  decimals?: number;
  /** Engraved label above the plot. */
  title: string;
  /** Horizontal reference (resting heart rate). */
  reference?: { value: number; label: string };
  hue: 'cardio' | 'recovery';
  empty: string;
  status?: 'loading' | 'ready' | 'failed';
}

export const DayLine = memo(function DayLine({ points, from, to, offsetS, unit, decimals = 0, title, reference, hue, empty, status = 'ready' }: DayLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  if (status === 'failed') return <p className="lv-prog-state">{C.failed}</p>;
  if (!points.length) return <p className="lv-prog-state">{status === 'loading' ? C.loading : empty}</p>;
  const h = 160, padL = 40, padR = 8, padT = 10, padB = 22;
  const vals = points.map((p) => p.v).concat(reference ? [reference.value] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const X = (t: number) => padL + ((t - from) / (to - from)) * (width - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const gaps = points.slice(1).map((p, i) => p.t - points[i]!.t).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
  const runs = runsOf(points, Math.max(3 * median, 20 * 60_000));
  const ticksY = [lo + pad, (lo + hi) / 2, hi - pad];
  const hourStep = to - from > 16 * 3_600_000 ? 4 : 2;
  const hours: number[] = [];
  const first = Math.ceil((from + offsetS * 1000) / (hourStep * 3_600_000)) * hourStep * 3_600_000 - offsetS * 1000;
  for (let t = first; t <= to; t += hourStep * 3_600_000) hours.push(t);
  const minP = points.reduce((a, b) => (b.v < a.v ? b : a)), maxP = points.reduce((a, b) => (b.v > a.v ? b : a));
  const summary = `${title}: ${C.readings(points.length)} from ${clockAt(points[0]!.t, offsetS)} to ${clockAt(points[points.length - 1]!.t, offsetS)}, lowest ${nf(minP.v, decimals)} ${unit} at ${clockAt(minP.t, offsetS)}, highest ${nf(maxP.v, decimals)} ${unit} at ${clockAt(maxP.t, offsetS)}${reference ? `, ${reference.label}` : ''}.`;
  return (
    <div ref={ref} className="lv-ring-day" data-hue={hue}>
      <Engraved as="p" className="lv-ring-title">
        {title}
      </Engraved>
      <svg className="lv-ring-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={summary}>
        {ticksY.map((v) => (
          <g key={v}>
            <line className="lv-ring-grid" x1={padL} x2={width - padR} y1={Y(v)} y2={Y(v)} />
            <text className="lv-ring-tick" x={padL - 4} y={Y(v) + 3} textAnchor="end">
              {nf(v, decimals)}
            </text>
          </g>
        ))}
        {reference ? (
          <g className="lv-ring-ref">
            <line x1={padL} x2={width - padR} y1={Y(reference.value)} y2={Y(reference.value)} />
            <text x={width - padR - 2} y={Y(reference.value) - 4} textAnchor="end">
              {reference.label}
            </text>
          </g>
        ) : null}
        {runs.map((r) =>
          r.length > 1 ? (
            <polyline key={r[0]!.t} className="lv-ring-line" points={r.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')} />
          ) : (
            <circle key={r[0]!.t} className="lv-ring-dot" cx={X(r[0]!.t)} cy={Y(r[0]!.v)} r={2.5} />
          ),
        )}
        {hours.map((t) => (
          <text key={t} className="lv-ring-tick" x={X(t)} y={h - 6} textAnchor="middle">
            {clockAt(t, offsetS)}
          </text>
        ))}
      </svg>
      <p className="lv-ring-note">
        {C.readings(points.length)} · {nf(minP.v, decimals)}–{nf(maxP.v, decimals)} {unit}
        {runs.length > 1 ? ` · ${C.gapNote}` : ''}
      </p>
    </div>
  );
});

/* ------------------------------------------------------------------------------------------- steps */

export const StepsBars = memo(function StepsBars({ days, today }: { days: readonly StepsDay[]; today: StepsDay | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const known = days.filter((d) => d.steps !== null);
  const head = (
    <p className="lv-ring-lines">
      <span className="lm-num">{today && today.steps !== null ? C.today(nf(today.steps)) : C.todayNone}</span>
      {today && today.activeMin !== null ? <span> · {C.activeToday(today.activeMin)}</span> : null}
    </p>
  );
  if (!known.length) return (
    <div ref={ref} className="lv-ring-steps">
      {head}
      <p className="lv-prog-state">{C.stepsEmpty}</p>
    </div>
  );
  const h = 140, padL = 44, padR = 4, padT = 8, padB = 20;
  const max = Math.max(...known.map((d) => d.steps!), 1);
  const nice = Math.ceil(max / 2000) * 2000;
  const slot = (width - padL - padR) / days.length;
  const bw = Math.max(2, Math.min(28, slot * 0.7));
  const Y = (v: number) => padT + (1 - v / nice) * (h - padT - padB);
  const avg = known.reduce((s, d) => s + d.steps!, 0) / known.length;
  const withActive = days.filter((d) => d.activeMin !== null);
  const labelEvery = days.length > 14 ? 7 : 1;
  return (
    <div ref={ref} className="lv-ring-steps">
      {head}
      <svg className="lv-ring-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={C.stepsSummary(days.length, known.length, nf(avg))}>
        {[0, nice / 2, nice].map((v) => (
          <g key={v}>
            <line className="lv-ring-grid" x1={padL} x2={width - padR} y1={Y(v)} y2={Y(v)} />
            <text className="lv-ring-tick" x={padL - 4} y={Y(v) + 3} textAnchor="end">
              {nf(v)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          return d.steps === null ? (
            <rect key={d.date} className="lv-ring-missing" data-missing="true" x={x + 0.5} y={Y(nice * 0.04) - 0.5} width={bw - 1} height={h - padB - Y(nice * 0.04)}>
              <title>{`${fmtDay(d.date)}: ${C.noDayData}`}</title>
            </rect>
          ) : (
            <rect key={d.date} className="lv-ring-bar" x={x} y={Y(d.steps)} width={bw} height={Math.max(0.5, h - padB - Y(d.steps))}>
              <title>{`${fmtDay(d.date)}: ${nf(d.steps)} steps${d.activeMin !== null ? `, ${d.activeMin} active min` : ''}`}</title>
            </rect>
          );
        })}
        {days.map((d, i) =>
          (days.length - 1 - i) % labelEvery === 0 ? (
            <text key={d.date} className="lv-ring-tick" x={padL + i * slot + slot / 2} y={h - 6} textAnchor="middle">
              {days.length > 14 ? fmtDayMonth(d.date) : fmtDay(d.date).split(' ')[0]}
            </text>
          ) : null,
        )}
      </svg>
      <p className="lv-ring-note">
        {C.stepsSummary(days.length, known.length, nf(avg))}
        {withActive.length ? ` · ${C.activeSummary(Math.round(withActive.reduce((s, d) => s + d.activeMin!, 0) / withActive.length))}` : ''}
      </p>
      <ul className="lm-sr">
        {days.map((d) => (
          <li key={d.date}>
            {fmtDay(d.date)}: {d.steps === null ? C.noDayData : `${nf(d.steps)} steps`}
            {d.activeMin !== null ? `, ${d.activeMin} active min` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
});

/* ------------------------------------------------------------------------------------------- workouts */

const dur = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};

export const WorkoutsTable = memo(function WorkoutsTable({ rows }: { rows: readonly WorkoutRow[] }) {
  if (!rows.length) return <p className="lv-prog-state">{C.workoutsEmpty}</p>;
  const W = C.workoutCols;
  return (
    <div className="lv-ring-scroll">
      <table className="lv-prog-table lv-ring-workouts">
        <thead>
          <tr>
            <th scope="col">{W.date}</th>
            <th scope="col">{W.type}</th>
            <th scope="col">{W.duration}</th>
            <th scope="col">{W.avgHr}</th>
            <th scope="col">{W.maxHr}</th>
            <th scope="col">{W.distance}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {fmtDay(r.date)} {clockAt(r.start, r.offsetS)}
              </th>
              <td>{workoutTypeWord(r.type)}</td>
              <td className="lm-num">{dur(r.durationS)}</td>
              <td className="lm-num">{r.avgHr !== null ? `${r.avgHr} bpm` : C.dash}</td>
              <td className="lm-num">{r.maxHr !== null ? `${r.maxHr} bpm` : C.dash}</td>
              <td className="lm-num">{r.distanceM !== null ? `${nf(r.distanceM / 1000, 2)} km` : C.dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
