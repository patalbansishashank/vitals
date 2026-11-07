/* ==========================================================================
   <WindowBar> (r071, AUDIT §5.2): when something happened against when it usually does. The Ring's Timing card (the
   night's window against the usual one) and the Today sleep window. One horizontal axis between two instants (20:00 to
   12:00 the next day), the person's `usual` window as a hairline-outlined band, the `actual` window as a solid ivory
   bar on top of it, `marks` (fell asleep, woke) as ticks with their words, round hours as mono labels.

   - A window outside the axis is clipped to it and says so in the sentence's "clipped" word, never silently.
   - Quiet: no clock, no digit anywhere: the bars stay, the sentence says "later than usual" in words.
   - The bars wipe in over 600 ms on first view; the axis never moves.
   ========================================================================== */
import { useCallback, useRef } from 'react';
import { cx } from '../lib/cx';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { clamp, clockText, durationText, isNum, minuteOfDay, speak } from './geometry';
import { useWidth } from './hooks';
import { InlineTwin, twinFileName, type TwinData } from './twin';
import './viz-base.css';
import './window.css';

export interface TimeWindow {
  from: number;
  to: number;
}

export interface WindowMark {
  t: number;
  /** "Fell asleep 23:14": the caller's words (hidden when quiet). */
  label: string;
}

export interface WindowBarProps {
  /** "Sleep timing" */
  label: string;
  /** The axis, two instants (ms). */
  axis: readonly [number, number];
  /** The person's usual window: a hairline outline. */
  usual?: TimeWindow;
  /** The window that happened: a solid bar. */
  actual?: TimeWindow;
  marks?: ReadonlyArray<WindowMark>;
  quiet?: boolean;
  /** Time zone for the hours (default the device's). */
  tz?: string;
  /** Override the card's domain colours for this picture. */
  hue?: Domain;
  animate?: boolean;
  /** Draw the "Table" key and the table twin under the picture. */
  twin?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ pure model */

const H = 3_600_000;
const MIN = 60_000;

export interface WindowModel {
  /** Share of the axis, 0..100. */
  x: (t: number) => number;
  usual: { x0: number; x1: number; clipped: boolean } | null;
  actual: { x0: number; x1: number; clipped: boolean } | null;
  marks: Array<{ x: number; label: string }>;
  /** Round-hour ticks on the axis. */
  ticks: Array<{ t: number; x: number; text: string }>;
  /** Started and ended earlier or later than usual (a half hour either way is "usual"), null without both windows. */
  relation: { start: 'earlier' | 'later' | 'usual'; end: 'earlier' | 'later' | 'usual' } | null;
}

/** The hour ticks of an axis: every hour on a short axis, every two to six on a long one, on clock-aligned hours. */
export function windowTicks(from: number, to: number, tz?: string): Array<{ t: number; text: string }> {
  if (!(to > from)) return [];
  const spanH = (to - from) / H;
  const step = spanH <= 6 ? 1 : spanH <= 10 ? 2 : spanH <= 24 ? 4 : 6;
  const minute = minuteOfDay(from, tz) % 60;
  const first = from - (from % MIN) + ((60 - minute) % 60) * MIN;
  const out: Array<{ t: number; text: string }> = [];
  for (let t = first; t <= to + 1; t += H) {
    const hh = Math.floor(minuteOfDay(t, tz) / 60);
    if (hh % step === 0) out.push({ t, text: String(hh).padStart(2, '0') });
  }
  return out;
}

const side = (delta: number): 'earlier' | 'later' | 'usual' => (Math.abs(delta) <= 30 * MIN ? 'usual' : delta > 0 ? 'later' : 'earlier');

/** The picture's geometry in shares of the axis. Pure. */
export function windowModel(p: Pick<WindowBarProps, 'axis' | 'usual' | 'actual' | 'marks' | 'tz'>): WindowModel {
  const [a, b] = p.axis;
  const span = Math.max(1, b - a);
  const x = (t: number) => clamp(((t - a) / span) * 100, 0, 100);
  const bar = (w?: TimeWindow) =>
    w && isNum(w.from) && isNum(w.to) && w.to > w.from ? { x0: x(w.from), x1: x(w.to), clipped: w.from < a || w.to > b } : null;
  const usual = bar(p.usual);
  const actual = bar(p.actual);
  const ok = (w?: TimeWindow) => Boolean(w && isNum(w.from) && isNum(w.to) && w.to > w.from);
  return {
    x,
    usual,
    actual,
    marks: (p.marks ?? []).filter((m) => isNum(m.t) && m.t >= a && m.t <= b).map((m) => ({ x: x(m.t), label: m.label })),
    ticks: windowTicks(a, b, p.tz).map((t) => ({ ...t, x: x(t.t) })),
    relation: ok(p.usual) && ok(p.actual) ? { start: side(p.actual!.from - p.usual!.from), end: side(p.actual!.to - p.usual!.to) } : null,
  };
}

/** Mono caps at 11 px with +0.08em: about 7.6 px a character. */
const CHAR_PX = 7.6;

export interface MarkPlace {
  /** 0 the row nearest the track, 1 the row above it, null when it would overprint another word (the tick stays). */
  row: 0 | 1 | null;
  /** Where the word sits against its tick: centred, or inside the plot when a centred word would leave it. */
  align: 'start' | 'center' | 'end';
}

/**
 * Where the marks' words go on a plot `width` px wide: each is centred on its tick, kept inside the plot, and put on the
 * first of two rows where it overprints no earlier word (8 px apart); a third that fits nowhere is left to its tick and
 * the sentence. Pure.
 */
export function windowMarkLayout(marks: ReadonlyArray<{ x: number; label: string }>, width: number): MarkPlace[] {
  const taken: Array<Array<[number, number]>> = [[], []];
  return marks.map((k) => {
    const w = k.label.length * CHAR_PX;
    const px = (k.x / 100) * width;
    const align: MarkPlace['align'] = px - w / 2 < 0 ? 'start' : px + w / 2 > width ? 'end' : 'center';
    const span: [number, number] = align === 'start' ? [px, px + w] : align === 'end' ? [px - w, px] : [px - w / 2, px + w / 2];
    for (const row of [0, 1] as const) {
      if (taken[row]!.every(([a, b]) => span[1] + 8 <= a || span[0] >= b + 8)) {
        taken[row]!.push(span);
        return { row, align };
      }
    }
    return { row: null, align };
  });
}

/* ------------------------------------------------------------------ words */

type SpokenInput = Pick<WindowBarProps, 'label' | 'axis' | 'usual' | 'actual' | 'marks' | 'quiet' | 'tz'>;

/** "started later than usual, ended at your usual time" (words only). */
function relationWords(r: NonNullable<WindowModel['relation']>): string {
  const w = (s: 'earlier' | 'later' | 'usual', verb: string) => (s === 'usual' ? `${verb} at your usual time` : `${verb} ${s} than usual`);
  if (r.start === r.end) return r.start === 'usual' ? 'at your usual time' : `${r.start} than usual`;
  return `${w(r.start, 'started')}, ${w(r.end, 'ended')}`;
}

/**
 * "Sleep timing: 23:12 to 07:08, usual 23:00 to 07:00". A window that runs past the axis says "clipped to the axis".
 * Quiet: "Sleep timing: started later than usual, ended at your usual time", never a digit. Pure.
 */
export function spokenWindow(p: SpokenInput): string {
  const m = windowModel(p);
  const clock = (t: number) => clockText(t, p.tz);
  if (!m.actual) {
    if (p.quiet) return `${p.label}: nothing recorded`;
    return speak(`${p.label}: no window recorded${p.usual ? `, usual ${clock(p.usual.from)} to ${clock(p.usual.to)}` : ''}`);
  }
  if (p.quiet) return `${p.label}: ${m.relation ? relationWords(m.relation) : 'a window is drawn'}${m.actual.clipped ? ', clipped to the axis' : ''}`;
  const usual = p.usual && m.usual ? `, usual ${clock(p.usual.from)} to ${clock(p.usual.to)}` : '';
  return speak(`${p.label}: ${clock(p.actual!.from)} to ${clock(p.actual!.to)}${usual}${m.actual.clipped ? ', clipped to the axis' : ''}`);
}

/** The Table twin: the actual and usual windows (from, to, length) and each mark's time. Pure. */
export function windowTwin(p: SpokenInput): TwinData {
  const clock = (t: number) => clockText(t, p.tz);
  const row = (name: string, w: TimeWindow): Array<string | number> => [name, clock(w.from), clock(w.to), durationText((w.to - w.from) / MIN)];
  const rows: Array<Array<string | number>> = [];
  if (p.actual && p.actual.to > p.actual.from) rows.push(row('Actual', p.actual));
  if (p.usual && p.usual.to > p.usual.from) rows.push(row('Usual', p.usual));
  for (const m of p.marks ?? []) rows.push([m.label, clock(m.t), '', '']);
  return { title: `${p.label} table`, caption: spokenWindow(p), head: ['Window', 'From', 'To', 'Length'], rows, fileName: twinFileName(p.label), rowNoun: ['row', 'rows'] };
}

/* ------------------------------------------------------------------ component */

export function WindowBar(props: WindowBarProps) {
  const { quiet = false, hue, animate = true, twin = false, className } = props;
  const [widthRef, width] = useWidth<HTMLDivElement>(300);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(revealRef);
  const pending = animate && !inView;
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      widthRef.current = el;
      revealRef.current = el;
    },
    [widthRef, revealRef],
  );
  const m = windowModel(props);
  const spoken = spokenWindow(props);
  const marks = quiet ? [] : m.marks;
  const places = windowMarkLayout(marks, width);
  const rows = places.some((p) => p.row === 1) ? 2 : marks.length ? 1 : 0;
  return (
    <div ref={setRef} className={cx('lmz lmz-win', className)} data-hue={hue} data-reveal={pending ? 'pending' : undefined} data-marks={rows || undefined} data-axis={quiet ? undefined : ''}>
      <div className="lmz-win__plot" role="img" aria-label={spoken}>
        {marks.map((k, i) =>
          places[i]!.row === null ? null : (
            <span key={i} className="lm-mono lmz-win__markword" data-size="sm" data-tone="ink" data-row={places[i]!.row} data-align={places[i]!.align} style={{ left: `${k.x}%` }} aria-hidden="true">
              {k.label}
            </span>
          ),
        )}
        <div className="lmz-win__track" aria-hidden="true">
          <div className="lmz-win__bars">
            {m.usual ? <i className="lmz-win__usual" style={{ left: `${m.usual.x0}%`, width: `${m.usual.x1 - m.usual.x0}%` }} /> : null}
            {m.actual ? <i className="lmz-win__actual" data-clipped={m.actual.clipped || undefined} style={{ left: `${m.actual.x0}%`, width: `${m.actual.x1 - m.actual.x0}%` }} /> : null}
            {m.marks.map((k, i) => (
              <i key={i} className="lmz-win__mark" style={{ left: `${k.x}%` }} />
            ))}
          </div>
          {m.ticks.map((t) => (
            <i key={t.t} className="lmz-win__tick" style={{ left: `${t.x}%` }} />
          ))}
        </div>
        {quiet ? null : (
          <div className="lmz-win__axis" aria-hidden="true">
            {m.ticks.map((t) => (
              <span key={t.t} className="lm-mono" data-size="sm" data-tone="ink" data-edge={t.x < 4 ? 'start' : t.x > 96 ? 'end' : undefined} style={{ left: `${t.x}%` }}>
                {t.text}
              </span>
            ))}
          </div>
        )}
      </div>
      {twin && !quiet ? <InlineTwin data={windowTwin(props)} /> : null}
    </div>
  );
}
