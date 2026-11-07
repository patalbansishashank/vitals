/**
 * The retained Ring chart adapters: the whole-night hypnogram and DayBars, still used by Energy. Every series carries its name; each plot is one
 * `role="img"` with a summary sentence and a table twin of what it plots, missing values included (DATAVIZ §0.7).
 */
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Hypnogram as VizHypnogram, TwinKey, VizTwinTable, toCSV, type RawStageSpan } from '@/components';
import { useSettingsStore } from '@/state/settingsStore';
import { useElementWidth } from '@/features/charts/core/hooks';
import '@/features/charts/living/living-charts.css';
import type { GaugeSleepSession } from '../types';

// ---------------------------------------------------------------------------------------------------------------

/**
 * The table twin of a Ring chart (DATAVIZ §0.7, the `TwinTable` pattern): the chart's head row (r068 G07/G09: what the
 * chart is or its unit at the left, the "Table" key at the right, drawn above the plot by `.rg-chart`'s order) and, open,
 * every plotted value with its time; a missing value reads "—" and a break in a line is a row of its own.
 */
export function ChartTwin({
  title,
  caption,
  columns,
  rows,
  rowNoun,
  fileName,
  lead,
}: {
  title: string;
  caption: string;
  columns: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string>>;
  rowNoun: [string, string];
  fileName: string;
  lead?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!rows.length) return lead ? <div className="rg-chart__head">{lead}</div> : null;
  return (
    <>
      <div className="rg-chart__head">
        {lead ?? <span />}
        <TwinKey open={open} onToggle={() => setOpen((o) => !o)} controls={`${id}-twin`} />
      </div>
      {open ? (
        <VizTwinTable
          id={`${id}-twin`}
          title={`${title} table`}
          caption={caption}
          rows={rows.length}
          rowNoun={rowNoun}
          fileName={fileName}
          csv={() => toCSV([[...columns], ...rows.map((r) => r.map((c) => (c === '—' ? '' : c)))])}
        >
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, k) =>
                  k === 0 ? (
                    <th key={k} scope="row">
                      {c}
                    </th>
                  ) : (
                    <td key={k}>{c}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </VizTwinTable>
      ) : null}
    </>
  );
}

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, fallback) || fallback;
  return [ref, width] as const;
}

// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------

/** Gauge stage ids on the hypnogram's levels (0 Awake on top … 3 Deep); asleep-without-a-stage is "mixed". */
const STAGE_LEVEL: Record<string, number | 'mixed'> = {
  awake: 0,
  rem: 1,
  light: 2,
  deep: 3,
  asleepUnspecified: 'mixed',
};

/** A session's RAW blocks as hypnogram spans: unknown (or anything unnamed) is no stage. Pure. */
export function sessionStageSpans(blocks: GaugeSleepSession['blocks']): RawStageSpan[] {
  return blocks.map((b) => ({
    from: Date.parse(b.start),
    to: Date.parse(b.end),
    state: STAGE_LEVEL[b.stage] ?? null,
  }));
}

/**
 * The night's stages as a four-level hypnogram (`Hypnogram` from the viz modules; smoothing display only), in the stage
 * hues, the whole recorded night: both parts of a night in two and the break between them (the hatched "No stage" band).
 * The spoken sentence and the table read the RAW blocks, Mixed and No stage included; the table is not drawn here but in
 * the card's (i) panel (`hypnogramTwin`). `chartPatterns` (Settings › Appearance) lays a texture on the blocks: never
 * colour alone. The blocks wipe in on first view.
 */
export function Hypnogram({
  session,
  from,
  to,
  height = 128,
  quiet = false,
  legend = false,
  animate = true,
  className,
}: {
  session: GaugeSleepSession;
  from?: number;
  to?: number;
  height?: number;
  quiet?: boolean;
  legend?: boolean;
  animate?: boolean;
  className?: string;
}) {
  const spans = useMemo(() => sessionStageSpans(session.blocks), [session.blocks]);
  const hatch = useSettingsStore((s) => s.chartPatterns);
  return (
    <VizHypnogram
      className={className ?? 'rg-hypno'}
      label="Sleep stages"
      from={from ?? Date.parse(session.start)}
      to={to ?? Date.parse(session.end)}
      segments={spans}
      height={height}
      quiet={quiet}
      twin={false}
      legend={legend}
      hatch={hatch}
      animate={animate}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------

const WD1 = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const dayTick = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const wdOf = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;

/**
 * (r069 U2) A period's days as bars (a week, a month, a short range): one bar per day, no bar where nothing was
 * recorded (never a zero), the period's average as a stone line named "avg", and an optional goal as a dashed line.
 * Days carry a weekday letter over the date on a week, every seventh date otherwise. One `role="img"` with a summary
 * sentence; the table twin lists every day.
 */
export function DayBars({
  dates,
  values,
  format,
  spoken,
  average,
  goal,
  height = 180,
  title,
  name,
  fileName,
  hue,
}: {
  dates: readonly string[];
  /** NaN = nothing recorded that day. */
  values: readonly number[];
  /** A tick or table value ("12k", "7:56"). */
  format: (v: number) => string;
  /** The value for a screen reader ("7 hours 56 minutes"). */
  spoken?: (v: number) => string;
  average?: number;
  goal?: number | null;
  height?: number;
  /** The chart's name in its head row. */
  title?: string;
  /** What a value is, for the summary and the table ("Steps", "Time asleep"). */
  name: string;
  fileName: string;
  /** The series' role colour (default the gold trace), e.g. 'var(--lm-steps)'. */
  hue?: string;
}) {
  const [ref, width] = useWidth(600);
  const say = spoken ?? format;
  const short = dates.length <= 7;
  const left = 38;
  const right = 4;
  const top = 8;
  const bottom = short ? 30 : 18;
  const finite = values.filter((v) => Number.isFinite(v));
  const hi = Math.max(1, ...finite, goal ?? 0, average ?? 0);
  const ticks = scaleTicks(0, hi);
  const yMax = ticks[ticks.length - 1]!;
  const plotW = width - left - right;
  const n = Math.max(1, dates.length);
  const X = (i: number) => left + (i / n) * plotW;
  const Y = (v: number) => top + (1 - v / yMax) * (height - top - bottom);
  const slot = plotW / n;
  const bw = Math.max(2, Math.min(28, slot * 0.62));
  const missing = values.length - finite.length;
  const best = values.reduce<number>(
    (b, v, i) => (Number.isFinite(v) && (b < 0 || v > values[b]!) ? i : b),
    -1,
  );
  const summary = `${name} by day, ${dayTick(dates[0] ?? '')} to ${dayTick(dates[dates.length - 1] ?? '')}${average !== undefined && Number.isFinite(average) ? `: average ${say(average)}` : ''}${best >= 0 ? `, most on ${dayTick(dates[best]!)} (${say(values[best]!)})` : ''}${missing ? `; nothing recorded on ${missing} ${missing === 1 ? 'day' : 'days'}` : ''}.`;
  return (
    <div ref={ref} className="rg-chart">
      <svg className="lmc-lv-svg" width={width} height={height} role="img" aria-label={summary}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="lmc-lv-grid"
              x1={left}
              x2={width - right}
              y1={Math.round(Y(t)) + 0.5}
              y2={Math.round(Y(t)) + 0.5}
            />
            <text className="lmc-lv-tick" x={left - 5} y={Y(t)} textAnchor="end" dominantBaseline="central">
              {format(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) =>
          Number.isFinite(v) && v > 0 ? (
            <rect
              key={dates[i]}
              className="rg-bar"
              style={hue ? { fill: hue } : undefined}
              x={X(i) + (slot - bw) / 2}
              y={Y(v)}
              width={bw}
              height={Math.max(1, Y(0) - Y(v))}
              rx={Math.min(3, bw / 3)}
            />
          ) : null,
        )}
        {goal ? (
          <g data-mark="goal">
            <line className="rg-goal" x1={left} x2={width - right} y1={Y(goal)} y2={Y(goal)} />
          </g>
        ) : null}
        {average !== undefined && Number.isFinite(average) ? (
          <g data-mark="average">
            <line
              className="rg-avg"
              x1={left}
              x2={width - right}
              y1={Math.round(Y(average)) + 0.5}
              y2={Math.round(Y(average)) + 0.5}
            />
            {/* the word sits above its line, or under it when the goal's line (or the plot's top) is just above */}
            <text
              className="lmc-lv-tick rg-avg__label"
              x={width - right - 2}
              y={
                (goal && Y(goal) < Y(average) && Y(average) - Y(goal) < 14) || Y(average) - top < 12
                  ? Y(average) + 11
                  : Y(average) - 4
              }
              textAnchor="end"
            >
              avg
            </text>
          </g>
        ) : null}
        <line
          className="lmc-lv-axis"
          x1={left}
          x2={width - right}
          y1={Math.round(Y(0)) + 0.5}
          y2={Math.round(Y(0)) + 0.5}
        />
        {dates.map((d, i) => {
          const cx = X(i) + slot / 2;
          if (short)
            return (
              <g key={d}>
                <text className="lmc-lv-tick" x={cx} y={height - 17} textAnchor="middle">
                  {WD1[wdOf(d)]}
                </text>
                <text className="lmc-lv-tick" x={cx} y={height - 4} textAnchor="middle">
                  {Number(d.slice(8, 10))}
                </text>
              </g>
            );
          // every Monday on a month (seven-day steps on a range), never crowding the plot's end
          const every = n > 35 ? 14 : 7;
          const tick = n <= 35 ? wdOf(d) === 0 : i % every === 0;
          return tick && cx < width - right - 18 ? (
            <text key={d} className="lmc-lv-tick" x={cx} y={height - 4} textAnchor="middle">
              {dayTick(d)}
            </text>
          ) : null;
        })}
      </svg>
      <ChartTwin
        lead={title ? <h3 className="rg-sub">{title}</h3> : undefined}
        title={`${name} by day`}
        caption={summary}
        columns={['Day', name]}
        rows={dates.map((d, i) => [dayTick(d), Number.isFinite(values[i]!) ? format(values[i]!) : '—'])}
        rowNoun={['day', 'days']}
        fileName={fileName}
      />
    </div>
  );
}

/** "Nice" ticks from 0 to at least `hi`: 4–6 even steps of 1, 2 or 5 × 10ⁿ. */
function scaleTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => (hi - lo) / s <= 5) ?? 10 * p;
  const top = Math.ceil(hi / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(lo + i * step).toFixed(6));
}

// ---------------------------------------------------------------------------------------------------------------
