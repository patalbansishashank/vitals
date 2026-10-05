/**
 * Blood oxygen and skin temperature per night (ring-pages.md §7.4.7), or per month on the year. Both are tier C
 * signals (D6): once the person's normal has formed they are drawn as change from it, around a 1 px zero line labelled
 * "your normal"; absolute values appear only in the table twin.
 * - Blood oxygen (`relative`): per night a range line from the lowest reading's change to the night's average change
 *   (recovery hue at 50 %) with the average as an 8 px dot; y hugs the data (and 0) with 10 % padding. While the normal
 *   forms (fewer than 14 nights) the chart shows the absolute values instead: y fixed 85–100 %, ticks 90, 95, 100, the
 *   floor only moving down if a night went lower, so nothing is cut off.
 * - Skin temperature: per night a column from the zero line ("your normal") up or down to the night's change from
 *   normal, recovery hue, 4 px rounded data end, square base on the zero line. No diverging colour: position carries
 *   the sign.
 * The "your normal" label takes the first clear spot beside the zero line (right above, right below, left above, left
 * below) so no bar or dot covers it; with none clear it moves into the top margin.
 * A missing night is the dashed stub (on the zero line in change mode); a future night draws nothing.
 */
import { memo, type ReactNode } from 'react';
import { formatNumber, formatSigned } from '@/components/lib/format';
import type { LocalDate } from '@/living';
import type { PeriodWindow } from '../models';
import { HEART_COPY as C } from './copyHeart';
import { SlotChart, type SlotGeometry } from './DailyRange';
import { lineLabelSpot, type MarkBox } from './kit';
import './heart.css';

export interface NightRangeDatum {
  start: LocalDate;
  future: boolean;
  recorded: boolean;
  /** Blood oxygen: the night's (or month's) average and lowest: % (absolute) or % points from the normal (relative). */
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
  | (Common & { kind: 'spo2'; /** `avg` / `lowest` are changes from the person's normal (it has formed). */ relative?: boolean })
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

/** Width of the 11 px "your normal" label plus a little air. */
export const ZERO_LABEL_W = 66;

/**
 * Where the "your normal" label goes: the first spot beside the zero line that no mark covers (right above, right
 * below, left above, left below); with none clear, the top margin at the right, over the plot area.
 */
export function zeroLabelSpot(g: SlotGeometry, boxes: readonly MarkBox[], labelW = ZERO_LABEL_W): { x: number; y: number; anchor: 'start' | 'end' } {
  return lineLabelSpot(g.Y(0), { left: g.padL, right: g.right, top: g.top, bottom: g.bottom }, boxes, labelW);
}

/** The zero line and its "your normal" label, drawn over the marks so nothing hides it. */
function ZeroLine({ g, boxes }: { g: SlotGeometry; boxes: readonly MarkBox[] }) {
  const y0 = g.Y(0);
  const spot = zeroLabelSpot(g, boxes);
  return (
    <>
      <line className="hr-zero" data-mark="zero" x1={g.padL} x2={g.right} y1={Math.round(y0) + 0.5} y2={Math.round(y0) + 0.5} />
      <text className="hr-zero-label hr-halo" data-mark="zero-label" x={spot.x} y={spot.y} textAnchor={spot.anchor}>
        {C.yourNormal}
      </text>
    </>
  );
}

/** 2–3 whole-number ticks (steps of 1, 2, 5, 10 … points) inside [lo, hi]; 0 is always one of them. */
export function changeTicks(lo: number, hi: number): number[] {
  for (const step of [1, 2, 5, 10, 20, 50]) {
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v === 0 ? 0 : v);
    if (out.length <= 3) return out;
  }
  return [0];
}

/** Blood oxygen as change from the person's normal: y hugs the changes and 0, at least 2 points tall, + 10 %. */
export function spo2ChangeDomain(data: readonly NightRangeDatum[]): [number, number] {
  const vals = data.flatMap((d) => (d.future ? [] : [d.avg, d.lowest])).filter(finite);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 2) {
    const c = (lo + hi) / 2;
    lo = Math.min(lo, c - 1);
    hi = Math.max(hi, c + 1);
  }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

export const NightRanges = memo(function NightRanges(props: NightRangesProps) {
  const { data, kind, ...rest } = props;
  if (props.kind === 'spo2' && props.relative) {
    const domain = spo2ChangeDomain(data);
    return (
      <SlotChart
        {...rest}
        hue="recovery"
        unit="%"
        slots={data}
        domain={domain}
        yTicks={changeTicks(domain[0], domain[1])}
        yFormat={(v) => (v === 0 ? '0' : formatSigned(v, 0))}
        stubY={(g) => g.Y(0) + 2}
        marks={(g) => {
          const boxes: MarkBox[] = [];
          data.forEach((d, i) => {
            if (d.future || !finite(d.avg)) return;
            const ya = g.Y(d.avg), yl = finite(d.lowest) ? g.Y(d.lowest) : ya;
            boxes.push({ x0: g.X(i) - 4, x1: g.X(i) + 4, top: Math.min(ya - 4, yl), bottom: Math.max(ya + 4, yl) });
          });
          return (
            <>
              {data.map((d, i) =>
                !d.future && finite(d.lowest) && finite(d.avg) ? (
                  <line key={`r${i}`} className="hr-range" data-mark="range" x1={g.X(i)} x2={g.X(i)} y1={g.Y(d.lowest)} y2={g.Y(d.avg)} />
                ) : null,
              )}
              {data.map((d, i) => (!d.future && finite(d.avg) ? <circle key={`d${i}`} className="hr-dot" data-mark="dot" cx={g.X(i)} cy={g.Y(d.avg)} r={4} /> : null))}
              <ZeroLine g={g} boxes={boxes} />
            </>
          );
        }}
      />
    );
  }
  if (kind === 'spo2') {
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
        const boxes: MarkBox[] = [];
        data.forEach((d, i) => {
          if (d.future || !finite(d.dev)) return;
          const y1 = g.Y(d.dev);
          boxes.push({ x0: g.X(i) - g.colW / 2, x1: g.X(i) + g.colW / 2, top: Math.min(y0, y1), bottom: Math.max(y0, y1) });
        });
        return (
          <>
            {data.map((d, i) =>
              !d.future && finite(d.dev) ? (
                <path key={`c${i}`} className="hr-col" data-mark="column" data-sign={d.dev >= 0 ? 'up' : 'down'} d={columnPath(g.X(i) - g.colW / 2, g.colW, y0, g.Y(d.dev))} />
              ) : null,
            )}
            <ZeroLine g={g} boxes={boxes} />
          </>
        );
      }}
    />
  );
});

/** "+0.3" / "−0.2" / "±0.0" in the display unit. */
export const signedTemp = (v: number): string => formatSigned(v, 1);
export const pct = (v: number): string => formatNumber(v, 0);
