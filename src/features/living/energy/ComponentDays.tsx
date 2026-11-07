/** A signed stack of the actual ledger per day. Deductions descend below zero; total ticks and mean use net totals. */
import { useId, useRef } from 'react';
import { ChartTwin, MonoMeta, barDate, formatEnergyRange, type EnergyUnitChoice } from '@/components';
import { useGrow, useInView } from '@/app/motion';
import type { EnergyComponent } from '@/living/sensors/energyDay';
import type { Envelope } from '@/living/sensors/types';
import { energyText } from '../activity/model';
import { COMPONENT_HUE, COMPONENT_LABEL, COMPONENT_ORDER } from './model';

export interface ComponentDay {
  date: string;
  total: number | null;
  components: Record<EnergyComponent, number> | null;
  envelope: Envelope | null;
}

export function componentDaysTwin(days: readonly ComponentDay[], unit: EnergyUnitChoice) {
  const value = (n: number | null | undefined) => (n === null || n === undefined ? '—' : energyText(n, unit));
  return {
    title: 'Daily energy components table',
    caption:
      'Actual engine components. Negative contributions reduce the total. Today is burned so far; gaps are unavailable days. Ranges are scenario estimates.',
    head: [
      'Day',
      `Total (${unit})`,
      'Likely range',
      ...COMPONENT_ORDER.map((k) => `${COMPONENT_LABEL[k]} (${unit})`),
    ],
    rows: days.map((d) => [
      d.date,
      value(d.total),
      d.envelope ? formatEnergyRange(d.envelope.lo, d.envelope.hi, unit, { withUnit: false }) : 'Unavailable',
      ...COMPONENT_ORDER.map((k) => value(d.components?.[k])),
    ]),
    fileName: 'vitals-daily-energy-components.csv',
    rowNoun: ['day', 'days'] as [string, string],
  };
}

export function ComponentDays({
  days,
  today,
  average,
  unit,
}: {
  days: readonly ComponentDay[];
  today: string;
  average: number;
  unit: EnergyUnitChoice;
}) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  useGrow(ref, {
    selector: '.en-daily__day',
    start: visible,
    stagger: Math.min(60, 700 / Math.max(1, days.length)),
  });
  const parts = days.map((d) => ({
    positive: d.components ? COMPONENT_ORDER.reduce((s, k) => s + Math.max(0, d.components![k]), 0) : 0,
    negative: d.components ? COMPONENT_ORDER.reduce((s, k) => s + Math.min(0, d.components![k]), 0) : 0,
  }));
  const max = Math.max(1, average, ...parts.map((p) => p.positive));
  const min = Math.min(0, ...parts.map((p) => p.negative));
  const height = 180;
  const y = (v: number) => 10 + ((max - v) / (max - min)) * (height - 20);
  const zero = y(0);
  const step = 1000 / Math.max(1, days.length);
  const width = Math.min(50, step * 0.65);
  const known = days.filter((d) => d.total !== null).length;
  return (
    <div className="en-daily" ref={ref}>
      <MonoMeta>Daily components</MonoMeta>
      <div
        className="en-daily__scroll"
        tabIndex={days.length > 31 ? 0 : undefined}
        role="region"
        aria-label="Daily component chart, scroll horizontally for longer periods"
      >
        <svg
          className="en-daily__plot"
          style={{ minWidth: Math.max(280, days.length * 8) }}
          viewBox={`0 0 1000 ${height + 20}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Energy components by day, ${days.length} days, ${known} with figures. Positive contributions stack above zero; deductions below. White ticks show true daily totals. Average ${energyText(average, unit)} ${unit}.${days.some((d) => d.date === today) ? ' Today is highlighted.' : ''}`}
        >
          <defs>
            <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M0 5L5 0" stroke="var(--lm-ink)" strokeWidth="1" opacity=".5" />
            </pattern>
          </defs>
          <line
            x1="0"
            x2="1000"
            y1={zero}
            y2={zero}
            stroke="var(--lm-line)"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="0"
            x2="1000"
            y1={y(average)}
            y2={y(average)}
            stroke="var(--lm-ink-2)"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          {days.map((d, i) => {
            if (!d.components || d.total === null) return null;
            let positive = 0;
            let negative = 0;
            const x = step * (i + 0.5) - width / 2;
            return (
              <g key={d.date} className="en-daily__day" data-today={d.date === today || undefined}>
                <title>
                  {d.date}, {energyText(d.total, unit)} {unit};{' '}
                  {COMPONENT_ORDER.map(
                    (k) => `${COMPONENT_LABEL[k]} ${energyText(d.components![k], unit)}`,
                  ).join(', ')}
                </title>
                {COMPONENT_ORDER.map((k) => {
                  const v = d.components![k];
                  if (Math.abs(v) < 0.000001) return null;
                  const from = v > 0 ? positive : negative;
                  const to = from + v;
                  if (v > 0) positive = to;
                  else negative = to;
                  return (
                    <g key={k}>
                      <rect
                        x={x}
                        y={y(Math.max(from, to))}
                        width={width}
                        height={Math.abs(y(to) - y(from))}
                        fill={COMPONENT_HUE[k]}
                      />
                      {v < 0 ? (
                        <rect
                          x={x}
                          y={y(from)}
                          width={width}
                          height={Math.abs(y(to) - y(from))}
                          fill={`url(#${id})`}
                        />
                      ) : null}
                    </g>
                  );
                })}
                <line
                  x1={x - 4}
                  x2={x + width + 4}
                  y1={y(d.total)}
                  y2={y(d.total)}
                  stroke="var(--lm-ink)"
                  strokeWidth={d.date === today ? 3 : 1.5}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="en-daily__axis" aria-hidden="true">
        <MonoMeta>{barDate(days[0]?.date ?? '').short}</MonoMeta>
        <MonoMeta>
          Avg {energyText(average, unit)} {unit}
        </MonoMeta>
        <MonoMeta>{barDate(days.at(-1)?.date ?? '').short}</MonoMeta>
      </div>
    </div>
  );
}

export function ComponentDaysTable({
  days,
  unit,
}: {
  days: readonly ComponentDay[];
  unit: EnergyUnitChoice;
}) {
  return <ChartTwin data={componentDaysTwin(days, unit)} />;
}
