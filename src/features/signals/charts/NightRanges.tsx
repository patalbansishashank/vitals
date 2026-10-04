/**
 * Blood oxygen and skin temperature per night (ring-pages.md §7.4.7), or per month on the year.
 * - Blood oxygen: per night a range line from the lowest reading to the night's average (recovery hue at 50 %) with
 *   the average as an 8 px dot; the person's normal band behind; y fixed 85–100 % (a narrow absolute scale is the
 *   honest one here), ticks 90, 95, 100. The floor only moves down if a night went lower, so nothing is cut off.
 * - Skin temperature: per night a column from the zero line ("your normal") up or down to the night's change from
 *   normal, recovery hue, 4 px rounded data end, square base on the zero line. No diverging colour: position carries
 *   the sign.
 * A missing night is the dashed stub (temperature: on the zero line); a future night draws nothing.
 */
import { memo, type ReactNode } from 'react';
import { formatNumber, formatSigned } from '@/components/lib/format';
import type { LocalDate } from '@/living';
import type { PeriodWindow } from '../models';
import { HEART_COPY as C } from './copyHeart';
import { SlotChart } from './DailyRange';
import './heart.css';

export interface NightRangeDatum {
  start: LocalDate;
  future: boolean;
  recorded: boolean;
  /** Blood oxygen: the night's (or month's) average and lowest, %. */
  avg?: number | null;
  lowest?: number | null;
  /** Skin temperature: change from the person's normal, in the display unit; null while the normal forms. */
  dev?: number | null;
  readout: string;
}

interface Common {
  window: PeriodWindow;
  data: readonly NightRangeDatum[];
  title: string;
  header?: ReactNode;
  summary: string;
  height: number;
  status?: 'loading' | 'ready' | 'failed';
  stale?: boolean;
  onRetry?: () => void;
  emptyLine?: string | null;
  table?: ReactNode;
  footer?: ReactNode;
  onDrill?: (index: number) => void;
}

export type NightRangesProps =
  | (Common & { kind: 'spo2'; normal?: { lo: number; hi: number } | null })
  | (Common & { kind: 'temp'; unit: '°C' | '°F' });

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A column from y0 (square base) to y1 (data end, corners rounded by r). */
export function columnPath(x: number, w: number, y0: number, y1: number, r = 4): string {
  const h = Math.abs(y1 - y0);
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const up = y1 < y0;
  const s = up ? 1 : -1; // direction from the data end towards the base
  return [
    `M${x},${y0}`,
    `V${y1 + s * rr}`,
    `Q${x},${y1} ${x + rr},${y1}`,
    `H${x + w - rr}`,
    `Q${x + w},${y1} ${x + w},${y1 + s * rr}`,
    `V${y0}`,
    'Z',
  ].join(' ');
}

export const NightRanges = memo(function NightRanges(props: NightRangesProps) {
  const { data, kind, ...rest } = props;
  if (kind === 'spo2') {
    const normal = props.normal ?? null;
    const lows = data.map((d) => d.lowest).filter(finite);
    const floor = Math.min(85, ...(lows.length ? [Math.floor(Math.min(...lows) / 5) * 5] : []));
    const domain: [number, number] = [floor, 100.5];
    const yTicks = [90, 95, 100].concat(floor < 85 ? [85] : []).sort((a, b) => a - b);
    return (
      <SlotChart
        {...rest}
        hue="recovery"
        unit="%"
        slots={data}
        domain={domain}
        yTicks={yTicks}
        under={(g) =>
          normal ? (
            <rect className="hr-normal" data-mark="normal" x={g.padL} y={g.Y(Math.min(100, normal.hi))} width={g.right - g.padL} height={Math.max(1, g.Y(normal.lo) - g.Y(Math.min(100, normal.hi)))} />
          ) : null
        }
        marks={(g) => (
          <>
            {data.map((d, i) =>
              !d.future && finite(d.lowest) && finite(d.avg) ? (
                <line key={`r${i}`} className="hr-range" data-mark="range" x1={g.X(i)} x2={g.X(i)} y1={g.Y(d.lowest)} y2={g.Y(d.avg)} />
              ) : null,
            )}
            {data.map((d, i) => (!d.future && finite(d.avg) ? <circle key={`d${i}`} className="hr-dot" data-mark="dot" cx={g.X(i)} cy={g.Y(d.avg)} r={4} /> : null))}
          </>
        )}
      />
    );
  }
  const unit = (props as Common & { unit: '°C' | '°F' }).unit;
  const devs = data.map((d) => d.dev).filter(finite);
  const minSpan = unit === '°F' ? 0.9 : 0.5;
  const m = Math.max(minSpan, ...devs.map((v) => Math.abs(v) * 1.2));
  const domain: [number, number] = [-m, m];
  const t = m >= 2 ? 1 : m >= 1 ? 0.5 : m >= 0.6 ? 0.5 : 0.2;
  const yTicks = [-t, 0, t].filter((v) => Math.abs(v) <= m);
  return (
    <SlotChart
      {...rest}
      hue="recovery"
      unit={unit}
      slots={data}
      domain={domain}
      yTicks={yTicks}
      yFormat={(v) => (v === 0 ? '0' : formatSigned(v, 1))}
      stubY={(g) => g.Y(0) + 2}
      marks={(g) => {
        const y0 = g.Y(0);
        return (
          <>
            <line className="hr-zero" data-mark="zero" x1={g.padL} x2={g.right} y1={Math.round(y0) + 0.5} y2={Math.round(y0) + 0.5} />
            <text className="hr-zero-label hr-halo" x={g.right - 2} y={y0 - 4} textAnchor="end">
              {C.yourNormal}
            </text>
            {data.map((d, i) =>
              !d.future && finite(d.dev) ? (
                <path key={`c${i}`} className="hr-col" data-mark="column" data-sign={d.dev >= 0 ? 'up' : 'down'} d={columnPath(g.X(i) - g.colW / 2, g.colW, y0, g.Y(d.dev))} />
              ) : null,
            )}
          </>
        );
      }}
    />
  );
});

/** "+0.3" / "−0.2" / "±0.0" in the display unit. */
export const signedTemp = (v: number): string => formatSigned(v, 1);
export const pct = (v: number): string => formatNumber(v, 0);
