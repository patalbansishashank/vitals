/**
 * Steps by hour (ring-pages.md §7.5.2): 24 columns 00–23 in the performance hue, `min(24, slot × 0.72)` wide with 4 px
 * rounded tops; y from 0 to a nice ceiling with 2 ticks. An hour with no sample is a missing stub, an hour whose samples
 * add up to 0 draws nothing above the baseline, an hour after now draws nothing. Sleep is shaded behind (recovery hue
 * at 10 %) so a quiet night reads as asleep, not missing. Crosshair per CHART_SPEC §5.1; table twin hour, steps.
 */
import { useRef, type ReactNode } from 'react';
import { useElementWidth } from '@/features/charts/core/hooks';
import { CHART_NAV_HELP, ChartShell, MissingStub, TwinTable, useChartSizes, useSlotCrosshair, type ChartStatus } from './kit';
import { columnPath, columnScale, compactTick, type HourSlot } from './activityModels';
import { ACTIVITY_COPY as C, withUnit } from './copyActivity';
import './activity.css';

export interface HourBarsProps {
  hours: readonly HourSlot[];
  /** Sleep inside the day (ms), shaded behind the columns. */
  bands: ReadonlyArray<{ from: number; to: number }>;
  /** Header readouts ("6 420 steps · 4.1 km · 280 kcal active"). */
  header?: ReactNode;
  summary: string;
  status?: ChartStatus;
  stale?: boolean;
  onRetry?: () => void;
  emptyLine?: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function HourBars({
  hours,
  bands,
  header,
  summary,
  status = 'ready',
  stale,
  onRetry,
  emptyLine,
}: HourBarsProps) {
  const sizes = useChartSizes();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const height = sizes.main;
  const padL = sizes.tickCol,
    padR = 4,
    padT = 12,
    padB = 18;
  const plotW = Math.max(48, width - padL - padR);
  const slot = plotW / 24;
  const bw = Math.min(24, slot * 0.72);
  const base = height - padB;
  const known = hours.filter((h) => !h.future && h.steps !== null).map((h) => h.steps!);
  const { max, ticks } = columnScale(Math.max(0, ...known), undefined, 2, 1000);
  const Y = (v: number) => padT + (1 - v / max) * (base - padT);
  const nowIdx = hours.findIndex((h) => !h.future && (hours[h.hour + 1]?.future ?? true));
  const cross = useSlotCrosshair(24, nowIdx >= 0 ? nowIdx : 12);
  const slotAt = (x: number) => Math.floor((x - padL) / slot);
  const xOf = (i: number) => padL + i * slot;
  const labelEvery = slot >= 26 ? 1 : slot >= 10 ? 3 : 6;

  // a band's x from its instants (hour index + fraction of that hour, so a 23 h or 25 h day still maps)
  const posOf = (t: number): number => {
    const i = hours.findIndex((h) => t >= h.start && t < h.end);
    if (i < 0) return t < (hours[0]?.start ?? 0) ? 0 : 24;
    const h = hours[i]!;
    return i + (t - h.start) / Math.max(1, h.end - h.start);
  };

  const sel = cross.slot !== null ? hours[cross.slot] : undefined;
  const readout =
    sel && !sel.future ? C.hourReadout(sel.hour, sel.steps) : sel ? C.hourLabel(sel.hour) : null;

  const table = (
    <TwinTable
      caption={C.stepsByHour}
      head={[C.hourCols.hour, C.hourCols.steps]}
      rows={hours
        .filter((h) => !h.future)
        .map((h) => [`${pad2(h.hour)}:00`, h.steps === null ? C.noData : withUnit(h.steps, 'steps')])}
    />
  );

  return (
    <div ref={ref} className="ac-chart">
      <ChartShell
        title={C.stepsByHour}
        header={header}
        summary={summary}
        readout={readout}
        height={height + 18}
        status={status}
        stale={stale}
        onRetry={onRetry}
        emptyLine={emptyLine}
        table={table}
      >
        <p className="ac-xline" aria-hidden="true">
          {readout ?? '\u00a0'}
        </p>
        <div
          className="ac-plotarea"
          role="img"
          aria-label={summary}
          aria-description={CHART_NAV_HELP}
          tabIndex={0}
          onKeyDown={(e) => cross.onKeyDown(e)}
          onFocus={cross.onFocus}
          onBlur={cross.onBlur}
          onPointerDown={cross.onPointerDown}
          onPointerMove={(e) => cross.onPointerMove(e, slotAt)}
          onPointerUp={(e) => cross.onPointerUp(e, slotAt)}
          onPointerLeave={cross.onPointerLeave}
        >
          <svg
            className="sg-svg"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            focusable="false"
          >
            {bands.map((b, i) => {
              const x0 = xOf(posOf(b.from)),
                x1 = xOf(posOf(b.to));
              return x1 - x0 >= 1 ? (
                <g key={i} className="ac-band" data-band="sleep">
                  <rect x={x0} y={padT - 8} width={x1 - x0} height={base - padT + 8} />
                  {x1 - x0 >= 44 ? (
                    <text className="ac-band__label" x={x0 + 4} y={padT}>
                      {C.asleep}
                    </text>
                  ) : null}
                </g>
              ) : null;
            })}
            {ticks.map((v) => (
              <g key={v}>
                <line
                  className="sg-grid"
                  x1={padL}
                  x2={width - padR}
                  y1={Math.round(Y(v)) + 0.5}
                  y2={Math.round(Y(v)) + 0.5}
                />
                <text className="sg-tick" x={padL - 4} y={Y(v) + 4} textAnchor="end">
                  {compactTick(v)}
                </text>
              </g>
            ))}
            {hours.map((h, i) => {
              if (h.future) return null;
              const x = xOf(i) + (slot - bw) / 2;
              if (h.steps === null)
                return (
                  <MissingStub
                    key={h.hour}
                    x={x}
                    width={bw}
                    baseline={base}
                    label={C.hourReadout(h.hour, null)}
                  />
                );
              if (h.steps <= 0) return null;
              const top = Math.min(base - 1, Y(h.steps));
              return (
                <path key={h.hour} className="ac-col" data-hour={h.hour} d={columnPath(x, top, bw, base)}>
                  <title>{C.hourReadout(h.hour, h.steps)}</title>
                </path>
              );
            })}
            <line className="sg-axis" x1={padL} x2={width - padR} y1={base + 0.5} y2={base + 0.5} />
            {hours.map((h, i) =>
              h.hour % labelEvery === 0 ? (
                <text
                  key={h.hour}
                  className="sg-tick"
                  x={xOf(i) + slot / 2}
                  y={height - 4}
                  textAnchor="middle"
                >
                  {pad2(h.hour)}
                </text>
              ) : null,
            )}
            {cross.slot !== null ? (
              <line
                className="sg-crosshair"
                x1={xOf(cross.slot) + slot / 2}
                x2={xOf(cross.slot) + slot / 2}
                y1={padT - 8}
                y2={base}
              />
            ) : null}
          </svg>
        </div>
      </ChartShell>
    </div>
  );
}
