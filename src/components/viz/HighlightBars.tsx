/* ==========================================================================
   <HighlightBars> (r071, AUDIT §5.2, RESEARCH §4.6): a daily series as bars with the current day highlighted. The
   other days wear the domain's ink tint at 40 % (3.1:1 on the card), the highlighted bar the domain solid, the goal a
   hairline across. Bars grow with each date slot up to a moderate cap, with 4 px rounded tops and a square base; they grow from the baseline on
   first view (700 ms, 60 ms apart, today's last) and never turn another colour for "goal met". It replaces DayBars,
   StackedDays and the Steps and Sleep period views.

   `stacks` draws a per-app stack in each bar (2 px gaps) with an optional `limit` line; `outline` marks a partial or
   "at least" day with a dashed outline instead of a fill (a pattern, never colour alone); `variant="spark"` is bars
   only, for a 14-day sketch. The "avg" word sits in the left margin, never over a bar.

   One tab stop: left and right step through the days, Home and End jump, Escape clears; hover and touch scrub; each
   day is read in a polite live region and shown in a tooltip (the value first, then the date). The bars are
   aria-hidden; the picture is one image whose sentence is the summary. Quiet: no digit anywhere, words only.
   ========================================================================== */
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { MonoMeta } from '../MonoMeta';
import { clamp, ratioWord, speak } from './geometry';
import { InlineTwin, twinFileName, type TwinData } from './twin';
import './viz-base.css';
import './bars.css';

export interface BarStack {
  id: string;
  label: string;
  hue: Domain;
  /** One value per date; a missing or non-finite value is nothing in that bar. */
  values: number[];
}

export interface HighlightBarsProps {
  /** One ISO date per bar ("2026-10-30"); anything else is used as its own label. */
  dates: string[];
  /** One value per date; null (or NaN) is no bar. With `stacks` the bars are the stacks' sums and this may be empty. */
  values: Array<number | null>;
  format?: (n: number) => string;
  /** The words of one day for the live region and the tooltip. Default "Fri 30 Oct, 7 605". */
  spoken?: (i: number) => string;
  /** A hairline across at this value. Never changes a bar's colour. */
  goal?: number;
  /** A line at the average, with "avg" in the left margin. */
  average?: number;
  /** The bar drawn in the domain solid: `last` (default), an index, or null for none (all bars solid). */
  highlight?: 'last' | number | null;
  /** Stacked bars: one entry per app, drawn in its hue with 2 px gaps. */
  stacks?: BarStack[];
  /** With `stacks`: a limit line (a daily limit). */
  limit?: number;
  /** Per bar: a partial or "at least" day, drawn as a dashed outline. */
  outline?: boolean[];
  /** Overrides the card's domain hue for this picture. */
  hue?: Domain;
  /** Height of the bars area in px (default 72; 28 for the spark). */
  height?: number;
  /** Weekday letters under the bars (default true for `full`). */
  showAxis?: boolean;
  variant?: 'full' | 'spark';
  /** The picture's name, first in the sentence: "Steps, last seven days". */
  name: string;
  /** The top of the scale. Default the largest value, goal, average or limit. */
  max?: number;
  /** A unit after a value in the words ("steps"). */
  unit?: string;
  /** Quiet mode: no digit in the DOM or aria; words compared with the goal. */
  quiet?: boolean;
  /** Called as a bar is scrubbed (pointer or keys), null when it ends. */
  onScrub?: (i: number | null) => void;
  /** First view grows the bars (default true). False renders the final frame at once. */
  animate?: boolean;
  /** `true` draws a "Table" key and the table under the picture; a node is drawn as given. */
  twin?: boolean | ReactNode;
  className?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fmtShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtNarrow = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' });
const fmtDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const fmtWeekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** "Fri 30 Oct", "F", "30" and "Friday" for an ISO date; a label that is not one is used as it is. */
export function barDate(date: string): { short: string; narrow: string; day: string; weekday: string } {
  if (!ISO.test(date)) return { short: date, narrow: date.slice(0, 1), day: date, weekday: date };
  const t = new Date(`${date}T00:00:00Z`);
  return { short: fmtShort.format(t).replace(',', ''), narrow: fmtNarrow.format(t), day: fmtDay.format(t), weekday: fmtWeekday.format(t) };
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** A count in words for quiet mode ("seven days"); past twelve it is "many". */
const countWord = (n: number): string => COUNT_WORDS[n] ?? 'many';

const defaultFormat = (n: number): string => formatNumber(n, Number.isInteger(n) ? 0 : 1);
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export interface BarSegModel {
  id: string;
  label: string;
  hue: Domain;
  value: number;
}

export interface BarModel {
  i: number;
  date: string;
  /** "Fri 30 Oct" */
  label: string;
  /** "Friday": the label in quiet mode, which has no digit. */
  weekday: string;
  narrow: string;
  day: string;
  value: number | null;
  /** value / max, 0..1+ (0 when there is no value). */
  ratio: number;
  segs: BarSegModel[] | null;
  outline: boolean;
}

export interface BarsModel {
  n: number;
  max: number;
  bars: BarModel[];
  stacked: boolean;
  /** The bar drawn in the solid, or null. */
  highlight: number | null;
  goalRatio: number | null;
  avgRatio: number | null;
  limitRatio: number | null;
  /** The average as given, else the mean of the values (for the sentence); null with no values. */
  mean: number | null;
}

type ModelProps = Pick<HighlightBarsProps, 'dates' | 'values' | 'goal' | 'average' | 'highlight' | 'stacks' | 'limit' | 'outline' | 'max'>;

/** Pure layout of the bars: values, ratios, stacks, the highlighted index and the lines. */
export function barsModel(p: ModelProps): BarsModel {
  const n = p.dates.length;
  const stacked = !!p.stacks?.length;
  const valueAt = (i: number): number | null => {
    if (stacked) {
      const vs = p.stacks!.map((s) => s.values[i]).filter(finite);
      return vs.length ? vs.reduce((a, b) => a + Math.max(0, b), 0) : null;
    }
    const v = p.values[i];
    return finite(v) ? v : null;
  };
  const vals = Array.from({ length: n }, (_, i) => valueAt(i));
  const known = vals.filter(finite);
  const top = Math.max(0, ...known, finite(p.goal) ? p.goal : 0, finite(p.average) ? p.average : 0, finite(p.limit) ? p.limit : 0);
  const max = finite(p.max) && p.max > 0 ? p.max : top > 0 ? top : 1;
  const bars = vals.map<BarModel>((value, i) => {
    const d = barDate(p.dates[i] ?? '');
    return {
      i,
      date: p.dates[i] ?? '',
      label: d.short,
      weekday: d.weekday,
      narrow: d.narrow,
      day: d.day,
      value,
      ratio: value === null ? 0 : Math.max(0, value) / max,
      segs: stacked ? p.stacks!.flatMap((s) => (finite(s.values[i]) && s.values[i]! > 0 ? [{ id: s.id, label: s.label, hue: s.hue, value: s.values[i]! }] : [])) : null,
      outline: !!p.outline?.[i],
    };
  });
  const highlight = p.highlight === null ? null : p.highlight === undefined || p.highlight === 'last' ? (n ? n - 1 : null) : p.highlight >= 0 && p.highlight < n ? p.highlight : null;
  const at = (v: number | undefined) => (finite(v) ? v / max : null);
  return {
    n,
    max,
    bars,
    stacked,
    highlight,
    goalRatio: at(p.goal),
    avgRatio: at(p.average),
    limitRatio: at(p.limit),
    mean: finite(p.average) ? p.average : known.length ? known.reduce((a, b) => a + b, 0) / known.length : null,
  };
}

const wordFor = (b: BarModel, goalRatio: number | null, goal: number | undefined): string => (b.value === null ? 'no reading' : goal && goalRatio ? ratioWord(b.value / goal) : b.ratio < 0.34 ? 'low' : b.ratio < 0.67 ? 'medium' : 'high');

/** One day in words: "Fri 30 Oct, 7 605 steps"; "no reading"; quiet "Fri 30 Oct, over half of the goal". */
export function spokenBar(p: ModelProps & Pick<HighlightBarsProps, 'format' | 'unit' | 'quiet' | 'spoken'>, i: number): string {
  if (p.spoken) return p.spoken(i);
  const m = barsModel(p);
  const b = m.bars[i];
  if (!b) return '';
  const fmt = p.format ?? defaultFormat;
  if (p.quiet) return speak(`${b.weekday}, ${wordFor(b, m.goalRatio, p.goal)}`);
  return speak(`${b.label}, ${b.value === null ? 'no reading' : `${fmt(b.value)}${p.unit ? ` ${p.unit}` : ''}`}`);
}

/**
 * The picture's one sentence. Up to eight days are listed ("Steps, last 7 days: Sat 5 260, Sun 7 290 ..."); more are
 * summarised (latest, average, highest). The goal and the limit follow. Quiet: the latest day in words, no digit.
 */
export function spokenBars(p: ModelProps & Pick<HighlightBarsProps, 'name' | 'format' | 'unit' | 'quiet' | 'spoken'>): string {
  const m = barsModel(p);
  const fmt = p.format ?? defaultFormat;
  const unit = p.unit ? ` ${p.unit}` : '';
  const known = m.bars.filter((b) => b.value !== null);
  if (!known.length) return `${p.name}: no readings`;
  if (p.quiet) {
    const hb = m.highlight !== null ? m.bars[m.highlight] : undefined;
    return speak(`${p.name}, ${countWord(m.n)} days${hb ? `, ${hb.weekday}: ${wordFor(hb, m.goalRatio, p.goal)}` : ''}`);
  }
  const head = `${p.name}, ${m.n} ${m.n === 1 ? 'day' : 'days'}`;
  const lines: string[] = [];
  if (m.n <= 8) lines.push(m.bars.map((b) => `${b.label} ${b.value === null ? 'no reading' : fmt(b.value)}`).join(', '));
  else {
    const last = [...m.bars].reverse().find((b) => b.value !== null)!;
    const hi = known.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
    lines.push(`latest ${fmt(last.value as number)}${unit} on ${last.label}`, `average ${fmt(m.mean as number)}`, `highest ${fmt(hi.value as number)} on ${hi.label}`);
  }
  if (finite(p.goal)) lines.push(`goal ${fmt(p.goal)}${unit}`);
  if (finite(p.limit)) lines.push(`limit ${fmt(p.limit)}${unit}`);
  if (p.stacks?.length) lines.push(`stacked by ${p.stacks.map((s) => s.label).join(' and ')}`);
  return speak(`${head}: ${lines.join('; ')}`);
}

/** The table twin: one row per day, with a column per stack when the bars are stacked. */
export function barsTwin(p: ModelProps & Pick<HighlightBarsProps, 'name' | 'format' | 'unit' | 'quiet' | 'spoken'>): TwinData {
  const m = barsModel(p);
  const fmt = p.format ?? defaultFormat;
  const stacks = p.stacks ?? [];
  const cell = (v: number | null | undefined) => (finite(v) ? fmt(v) : '—');
  return {
    title: `${p.name} table`,
    caption: spokenBars(p),
    head: ['Day', stacks.length ? 'Total' : 'Value', ...stacks.map((s) => s.label)],
    rows: m.bars.map((b) => [b.label, cell(b.value), ...stacks.map((s) => cell(s.values[b.i]))]),
    fileName: twinFileName(p.name),
    rowNoun: ['day', 'days'],
  };
}

/** The axis word under bar `i`: a weekday letter up to 10 bars, else the day number every 7th bar and the last (never two side by side). */
function axisWord(b: BarModel, n: number, quiet: boolean): string {
  if (n <= 10) return b.narrow;
  if (quiet) return '';
  return b.i === n - 1 || (b.i % 7 === 0 && n - 1 - b.i >= 4) ? b.day : '';
}

export function HighlightBars(props: HighlightBarsProps) {
  const { variant = 'full', quiet = false, hue, animate = true, average, onScrub, twin, className } = props;
  const spark = variant === 'spark';
  const height = props.height ?? (spark ? 28 : 72);
  const showAxis = props.showAxis ?? !spark;
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref);
  const pending = animate && !inView;
  const m = barsModel(props);
  const summary = spokenBars(props);
  const fmt = props.format ?? defaultFormat;
  const [active, setActive] = useState<number | null>(null);
  const interactive = !spark && m.n > 0;

  const scrub = (i: number | null) => {
    if (i === active) return;
    setActive(i);
    onScrub?.(i);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const last = m.n - 1;
    let next: number;
    if (e.key === 'ArrowRight') next = active === null ? 0 : Math.min(last, active + 1);
    else if (e.key === 'ArrowLeft') next = active === null ? last : Math.max(0, active - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') {
      scrub(null);
      return;
    } else return;
    e.preventDefault();
    scrub(next);
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    scrub(clamp(Math.floor(((e.clientX - r.left) / r.width) * m.n), 0, m.n - 1));
  };

  const words = active !== null ? spokenBar(props, active) : '';
  const bar = (b: BarModel) => {
    const pct = `${Number((Math.min(b.ratio, 1) * 100).toFixed(2))}%`;
    const style = { '--h': pct } as CSSProperties;
    if (m.stacked && b.segs) {
      return (
        <span className="lmz-bars__stack" style={style}>
          {b.segs.map((s) => (
            <i key={s.id} className="lmz-bars__seg" data-hue={s.hue} style={{ '--v': s.value } as CSSProperties} />
          ))}
        </span>
      );
    }
    return <i className="lmz-bars__bar" style={style} data-outline={b.outline || undefined} />;
  };

  return (
    <div
      ref={ref}
      className={cx('lmz lmz-bars', className)}
      data-reveal={pending ? 'pending' : undefined}
      data-hue={hue}
      data-variant={variant}
      data-dense={m.n > 10 || undefined}
      data-avg={(finite(average) && !spark) || undefined}
      data-nohl={m.highlight === null || undefined}
      data-stacked={m.stacked || undefined}
      style={{ '--lmz-h': `${height}px` } as CSSProperties}
    >
      <div
        className="lmz-bars__img"
        role="img"
        aria-label={summary}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={onKey}
        onBlur={() => scrub(null)}
      >
        <div className="lmz-bars__plot" aria-hidden="true">
          {m.goalRatio !== null ? <span className="lmz-bars__line" data-kind="goal" style={{ '--r': Math.min(m.goalRatio, 1) } as CSSProperties} /> : null}
          {m.limitRatio !== null ? <span className="lmz-bars__line" data-kind="limit" style={{ '--r': Math.min(m.limitRatio, 1) } as CSSProperties} /> : null}
          {m.avgRatio !== null && !spark ? (
            <>
              <span className="lmz-bars__line" data-kind="avg" style={{ '--r': Math.min(m.avgRatio, 1) } as CSSProperties} />
              <MonoMeta size="sm" className="lmz-bars__avg" style={{ '--r': Math.min(m.avgRatio, 1) } as CSSProperties}>
                avg
              </MonoMeta>
            </>
          ) : null}
          <div
            className="lmz-bars__cols"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') scrub(null);
            }}
          >
            {m.bars.map((b) => (
              <div key={b.i} className="lmz-bars__col" data-i={b.i} data-hl={m.highlight === b.i || undefined} data-active={active === b.i || undefined} data-empty={b.value === null || undefined} style={{ '--i': b.i } as CSSProperties}>
                {b.value === null ? null : bar(b)}
                {active === b.i ? (
                  <span className="lmz-tip" data-edge={b.i < 2 ? 'start' : b.i > m.n - 3 ? 'end' : undefined} style={{ bottom: `${Math.min(b.ratio, 1) * 100}%` }}>
                    {quiet ? (
                      <span className="lmz-tip__v">{b.weekday}</span>
                    ) : (
                      <>
                        <span className="lmz-tip__v">{b.value === null ? 'No reading' : `${fmt(b.value)}${props.unit ? ` ${props.unit}` : ''}`}</span> {b.label}
                      </>
                    )}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        {showAxis ? (
          <div className="lmz-bars__axis" aria-hidden="true">
            {m.bars.map((b) => (
              <MonoMeta key={b.i} size="sm" className="lmz-bars__tick" tone={m.highlight === b.i ? 'ink' : 'muted'}>
                {axisWord(b, m.n, quiet)}
              </MonoMeta>
            ))}
          </div>
        ) : null}
      </div>
      {m.stacked && !spark ? (
        <ul className="lmz-bars__legend" aria-hidden="true">
          {props.stacks!.map((s) => (
            <li key={s.id} data-hue={s.hue}>
              <i className="lmz-bars__sw" />
              <MonoMeta size="sm">{s.label}</MonoMeta>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="lm-sr" aria-live="polite">
        {words}
      </span>
      {twin === true ? quiet ? null : <InlineTwin data={barsTwin(props)} /> : twin === false || twin == null ? null : twin}
    </div>
  );
}
