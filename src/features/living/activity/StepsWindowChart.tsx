/**
 * (r069 D3) The steps of an activity's time: one chart for every activity sheet (a detected one in review, an approved
 * one, one logged by hand) and for "Log an activity" before it is saved. The minutes of the window and 15 min either side
 * (`windowSteps`), the window's bars in gold; under them what was counted inside it and by whom: "1 940 steps counted ·
 * ring", with the ring's and the phone's own counts when they are known. Where both sources watched and saw no step (a
 * treadmill desk with the hands on the desk and the phone beside them), it says so instead of switching to another
 * chart; heart rate stands in, named, only when no source covered the time at all. Quiet mode: no counts, no clock axis.
 */
import type { ReactNode } from 'react';
import { clockText, formatNumber } from '@/components';
import type { WindowSteps } from './stepsTime';
import './activity.css';

export const WINDOW_WORDS = {
  counted: (n: string) => `${n} steps counted`,
  from: { ring: 'ring', phone: 'phone', both: 'ring and phone' } as Record<'ring' | 'phone' | 'both', string>,
  sources: (ring: string, phone: string) => `Ring ${ring} · phone ${phone}`,
  noReading: 'no reading',
  zero: 'No steps counted in this time',
  zeroWhy: 'Both sources were on and counted no step. On a treadmill desk or a bike the hands rest and the phone lies still, so neither sees the walking. The activity’s energy comes from its type and minutes, not from steps.',
  noData: 'No step reading for this time yet',
  hrOnly: 'No step reading for this time; heart rate shown',
  partial: (covered: string, of: string) => `Steps seen for ${covered} of ${of} min`,
  quietSome: 'Steps were counted during this time',
  quietZero: 'No steps were counted during this time',
  quietNone: 'No step reading for this time yet',
} as const;

/** The line under the bars (what was counted inside the window). */
export function windowStepsText(m: WindowSteps, quiet: boolean): { head: string; why: string | null; detail: string | null } {
  const c = m.inside.counted;
  if (quiet) return { head: c === null ? WINDOW_WORDS.quietNone : c > 0 ? WINDOW_WORDS.quietSome : WINDOW_WORDS.quietZero, why: null, detail: null };
  if (m.kind === 'hr') return { head: WINDOW_WORDS.hrOnly, why: null, detail: null };
  if (c === null) return { head: WINDOW_WORDS.noData, why: null, detail: null };
  const lanes =
    m.inside.ring !== null || m.inside.phone !== null
      ? WINDOW_WORDS.sources(m.inside.ring === null ? WINDOW_WORDS.noReading : formatNumber(m.inside.ring, 0), m.inside.phone === null ? WINDOW_WORDS.noReading : formatNumber(m.inside.phone, 0))
      : null;
  const partial = m.inside.coveredMin < m.inside.minutes ? WINDOW_WORDS.partial(formatNumber(m.inside.coveredMin, 0), formatNumber(m.inside.minutes, 0)) : null;
  const detail = [lanes, partial].filter(Boolean).join(' · ') || null;
  if (c === 0) return { head: WINDOW_WORDS.zero, why: WINDOW_WORDS.zeroWhy, detail };
  const from = m.inside.from ? ` · ${WINDOW_WORDS.from[m.inside.from]}` : '';
  return { head: `${WINDOW_WORDS.counted(formatNumber(c, 0))}${from}`, why: null, detail };
}

/**
 * (r068 V10) Where the time labels of a window's minute bars go (0..1 across): its start and end, and each whole hour
 * (half hour in a short window) between that keeps clear of both ends.
 */
export function timeAxisMarks(from: number, to: number): Array<{ t: number; at: number; edge?: 'start' | 'end' }> {
  if (!(to > from)) return [];
  const span = to - from;
  const marks: Array<{ t: number; at: number; edge?: 'start' | 'end' }> = [{ t: from, at: 0, edge: 'start' }];
  // whole hours; half hours too when the window is short (an hour and a quarter holds no whole hour clear of the ends)
  const step = span <= 2.5 * 3_600_000 ? 1_800_000 : 3_600_000;
  const h = new Date(from);
  h.setMinutes(step === 1_800_000 && h.getMinutes() >= 30 ? 30 : 0, 0, 0);
  for (let t = h.getTime() + step; t < to; t += step) {
    const at = (t - from) / span;
    if (at > 0.2 && at < 0.8) marks.push({ t, at });
  }
  marks.push({ t: to, at: 1, edge: 'end' });
  return marks;
}

export interface StepsWindowChartProps {
  model: WindowSteps;
  /** The window as the sheet has it now (the scrubber moves it): its bars are gold and its counts are said. */
  range: { start: number; end: number };
  quiet: boolean;
  /** Under the bars, before the counts (the start and end scrubber). */
  children?: ReactNode;
}

export function StepsWindowChart({ model, range, quiet, children }: StepsWindowChartProps) {
  const words = windowStepsText(model, quiet);
  const marks = timeAxisMarks(model.from, model.to);
  return (
    <div className="lv-swin">
      {model.kind !== 'none' ? (
        <svg className="lv-asheet__minutes" viewBox={`0 0 ${model.bars.length} 40`} preserveAspectRatio="none" aria-hidden="true" data-kind={model.kind}>
          {model.bars.map((b, i) => {
            const inside = b.t >= range.start && b.t < range.end;
            if (b.v === null) return <rect key={i} x={i + 0.15} y={38} width={0.7} height={2} className="lv-asheet__bar" data-none="" />;
            const h = b.v > 0 ? Math.max(1, (b.v / model.max) * 38) : 0.6;
            return <rect key={i} x={i + 0.15} y={40 - h} width={0.7} height={h} className="lv-asheet__bar" data-in={inside || undefined} data-zero={b.v === 0 || undefined} />;
          })}
        </svg>
      ) : null}
      {model.kind !== 'none' && !quiet ? (
        <div className="lv-asheet__axis lm-num" aria-hidden="true">
          {marks.map((m) => (
            <span key={m.t} data-edge={m.edge} style={{ left: `${m.at * 100}%` }}>
              {clockText(m.t)}
            </span>
          ))}
        </div>
      ) : null}
      {children}
      <div className="lv-swin__facts" role="status">
        <p className="lv-swin__head lm-num">{words.head}</p>
        {words.detail ? <p className="lv-act__fact lm-num">{words.detail}</p> : null}
        {words.why ? <p className="lv-act__fact">{words.why}</p> : null}
      </div>
    </div>
  );
}
