import { formatNumber } from '@/components';
import { fmtClock } from '../format';

export interface WindowDialProps {
  /** Allowed eating span, clock hours. */
  startH: number;
  endH: number;
  size?: number;
  /** Optional second band inside (e.g. sleep), clock hours; end may exceed 24. */
  sleep?: { startH: number; endH: number };
}

const polar = (c: number, r: number, h: number): [number, number] => {
  const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
};

function arc(c: number, r: number, h0: number, h1: number): string {
  const span = ((h1 - h0) % 24 + 24) % 24 || 24;
  const [ax, ay] = polar(c, r, h0);
  const [bx, by] = polar(c, r, h0 + span - (span === 24 ? 0.001 : 0));
  return `M${ax.toFixed(2)},${ay.toFixed(2)} A${r},${r} 0 ${span > 12 ? 1 : 0} 1 ${bx.toFixed(2)},${by.toFixed(2)}`;
}

/**
 * A printed 24 h dial in display mode (COMPONENTS §4 ClockRing, REVIEW_FINDINGS 3): hairline bezel, 24 hour ticks,
 * the allowed eating span as a thin band and the rest as a hairline. Decorative twin of the "eating between" range;
 * the range control carries the value for assistive tech.
 */
export function WindowDial({ startH, endH, size = 88, sleep }: WindowDialProps) {
  const c = size / 2;
  const R = c - 4;
  const track = R - 9;
  const len = endH - startH;
  return (
    <svg className="lp-dial" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <circle cx={c} cy={c} r={R} fill="var(--lm-face)" stroke="var(--lm-line-strong)" strokeWidth={1} />
      {Array.from({ length: 24 }, (_, h) => {
        const major = h % 6 === 0;
        const [ax, ay] = polar(c, R, h);
        const [bx, by] = polar(c, R - (major ? 5 : 2.5), h);
        return <line key={h} x1={ax} y1={ay} x2={bx} y2={by} stroke={major ? 'var(--lm-ink-2)' : 'var(--lm-ink-3)'} strokeWidth={1} />;
      })}
      <circle cx={c} cy={c} r={track} fill="none" stroke="var(--lm-ink-3)" strokeWidth={1} />
      {sleep ? <path d={arc(c, track - 6, sleep.startH, sleep.endH)} fill="none" stroke="var(--lm-cat-recovery)" strokeOpacity={0.6} strokeWidth={2.5} strokeLinecap="round" /> : null}
      <path d={arc(c, track, startH, endH)} fill="none" stroke="var(--lm-ink)" strokeOpacity={0.6} strokeWidth={4} strokeLinecap="round" />
      <text x={c} y={c - 2} textAnchor="middle" className="lp-dial__read">
        {formatNumber(len, len % 1 ? 1 : 0)}
        {'\u2009'}h
      </text>
      <text x={c} y={c + 12} textAnchor="middle" className="lp-dial__sub">
        {fmtClock(startH).replace(':00', '')}–{fmtClock(endH).replace(':00', '')}
      </text>
    </svg>
  );
}
