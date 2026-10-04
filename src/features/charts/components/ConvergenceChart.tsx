/* ==========================================================================
   <ConvergenceChart> — optimiser convergence (CHART_SPEC §7.6): 120 px, best
   score per plan slot by iteration, plan colours, no bands, direct end labels
   ("A 0.82"). Purely reassurance; the caller hides it for runs under 1 s.
   ========================================================================== */
import { memo, useMemo, useRef, useState } from 'react';
import { useElementWidth } from '../core/hooks';
import { formatNumber } from '../lib/format';
import { relaxLabels } from '../lib/labels';
import { niceTicksInside } from '../lib/ticks';
import type { ConvergenceTrace } from '../types';

export interface ConvergenceChartProps {
  traces: readonly ConvergenceTrace[];
  height?: number;
  /** Engraved legend caption (default "best score per plan · iterations"). */
  caption?: string;
}

export const ConvergenceChart = memo(function ConvergenceChart({ traces, height = 120, caption = 'best score per plan · iterations' }: ConvergenceChartProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef) || 480;
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, ...traces.map((t) => t.scores.length));
  const m = { l: 36, r: 64, t: 8, b: 20 };
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const { lo, hi } = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (const t of traces)
      for (const v of t.scores) {
        a = Math.min(a, v);
        b = Math.max(b, v);
      }
    const pad = (b - a || 0.1) * 0.08;
    return { lo: a - pad, hi: b + pad };
  }, [traces]);
  const X = (i: number) => m.l + (i / Math.max(1, n - 1)) * pw;
  const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * ph;
  const ticks = niceTicksInside(lo, hi, { min: 2, max: 3 });
  const ends = relaxLabels(
    traces.map((t) => ({ id: t.plan, y: Y(t.scores[t.scores.length - 1]!) })),
    14,
    m.t + 4,
    m.t + ph,
  );
  const summary = `Optimiser progress over ${n} iterations: ${traces.map((t) => `plan ${t.plan} best score ${formatNumber(t.scores[t.scores.length - 1]!, 2)}`).join(', ')}.`;
  return (
    <div ref={rootRef} className="lmc-mini">
      <div className="lmc-mini-legend" style={{ padding: '8px 12px 4px' }}>
        <span>{caption}</span>
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }} aria-hidden="true">
          {hover != null ? `iteration ${hover + 1} · ${traces.map((t) => `${t.plan} ${formatNumber(t.scores[Math.min(hover, t.scores.length - 1)]!, 2)}`).join(' · ')}` : ' '}
        </span>
      </div>
      <svg
        className="lmc-svg"
        width={width}
        height={height}
        role="img"
        aria-label={summary}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - m.l) / pw) * (n - 1));
          setHover(i >= 0 && i < n ? i : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + pw} y1={Math.round(Y(t)) + 0.5} y2={Math.round(Y(t)) + 0.5} stroke="var(--lm-chart-grid)" />
            <text className="lmc-tick-t" x={m.l - 6} y={Y(t)} textAnchor="end" dominantBaseline="central">
              {formatNumber(t, 2)}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={m.l + pw} y1={m.t + ph + 0.5} y2={m.t + ph + 0.5} stroke="var(--lm-chart-axis)" />
        {[0, Math.round((n - 1) / 2), n - 1].map((i) => (
          <text key={i} className="lmc-tick-t" x={X(i)} y={height - 5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {i + 1}
          </text>
        ))}
        {traces.map((t) => (
          <path
            key={t.plan}
            d={Array.from(t.scores, (v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')}
            fill="none"
            stroke={`var(--lm-plan-${t.plan.toLowerCase()})`}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hover != null ? <line x1={X(hover)} x2={X(hover)} y1={m.t} y2={m.t + ph} stroke="var(--lm-chart-crosshair)" /> : null}
        {traces.map((t) => {
          const v = t.scores[t.scores.length - 1]!;
          const ly = ends.get(t.plan) ?? Y(v);
          return (
            <g key={`e${t.plan}`}>
              <circle cx={X(t.scores.length - 1)} cy={Y(v)} r={4} fill={`var(--lm-plan-${t.plan.toLowerCase()})`} stroke="var(--lm-face)" strokeWidth={2} />
              <text x={m.l + pw + 10} y={ly} dominantBaseline="central" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                <tspan style={{ fontWeight: 700 }} fill="var(--lm-ink)">
                  {t.plan}
                </tspan>
                <tspan fill="var(--lm-ink-2)"> {formatNumber(v, 2)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
