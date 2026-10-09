import { useRef, useState } from 'react';
import { formatNumber } from '@/components';
import { useElementWidth } from '@/features/charts/core/hooks';
import type { ConvergencePoint } from '@/engine/planner/domain/types';

/* Drawn in real pixels: the width is measured, so text and strokes never scale with the card. */
const FALLBACK_W = 560;
const M = { l: 36, r: 92, t: 8, b: 20 };
const heightFor = (w: number) => (w >= 900 ? 240 : w >= 480 ? 180 : 140);

/**
 * The search's convergence (CHART_SPEC §7.6, plan ladder): the goal score of the best plan so far and how much of the
 * effort-result space the ladder covers, against evaluations. Purely reassurance on long searches.
 */
export function LadderConvergence({ points, height }: { points: readonly ConvergencePoint[]; height?: number }) {
  if (points.length < 2) return null;
  return <Convergence points={points} height={height} />;
}

function Convergence({ points, height: fixedHeight }: { points: readonly ConvergencePoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(boxRef, FALLBACK_W) || FALLBACK_W;
  const height = fixedHeight ?? heightFor(W);
  const pw = Math.max(60, W - M.l - M.r);
  const ph = height - M.t - M.b;
  const eu0 = points[0]!.eu;
  const eu1 = points[points.length - 1]!.eu;
  const vals = points.flatMap((p) => [p.G, p.hvLadder]).filter(Number.isFinite);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1e-6, ...vals) * 1.05;
  const X = (eu: number) => M.l + ((eu - eu0) / (eu1 - eu0 || 1)) * pw;
  const Y = (v: number) => M.t + (1 - (v - lo) / (hi - lo || 1)) * ph;
  const path = (f: (p: ConvergencePoint) => number) =>
    points
      .filter((p) => Number.isFinite(f(p)))
      .map((p, i) => `${i ? 'L' : 'M'}${X(p.eu).toFixed(1)},${Y(f(p)).toFixed(1)}`)
      .join('');
  const last = points[points.length - 1]!;
  const h = hover !== null ? points[hover] : null;
  const summary = `Search progress over ${formatNumber(eu1, 0)} evaluations: best plan score ${formatNumber(last.G, 2)}${Number.isFinite(last.hvLadder) ? `, ladder coverage ${formatNumber(last.hvLadder, 2)}` : ''}.`;
  const hasHv = points.some((p) => Number.isFinite(p.hvLadder));
  const ends = [
    { key: 'best', y: Y(last.G), text: `best ${formatNumber(last.G, 2)}` },
    ...(hasHv && Number.isFinite(last.hvLadder) ? [{ key: 'ladder', y: Y(last.hvLadder), text: `ladder ${formatNumber(last.hvLadder, 2)}` }] : []),
  ].sort((a, b) => a.y - b.y);
  if (ends.length > 1 && ends[1]!.y - ends[0]!.y < 13) ends[1]!.y = ends[0]!.y + 13;
  return (
    <div className="lp-conv" ref={boxRef}>
      <p className="lp-conv__legend">
        <span className="lm-eng">best plan’s goal score and the ladder’s coverage · by evaluations</span>
        <span className="lm-num" aria-hidden="true">
          {h ? `${formatNumber(h.eu, 0)} evaluations · best ${formatNumber(h.G, 2)}${Number.isFinite(h.hvLadder) ? ` · ladder ${formatNumber(h.hvLadder, 2)}` : ''}` : ''}
        </span>
      </p>
      <svg
        className="lp-conv__svg"
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={summary}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const eu = eu0 + (((e.clientX - r.left) / (r.width || 1)) * W - M.l) / pw * (eu1 - eu0);
          let best = 0;
          for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.eu - eu) < Math.abs(points[best]!.eu - eu)) best = i;
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line className="lp-curve__axis" x1={M.l} x2={M.l + pw} y1={M.t + ph} y2={M.t + ph} />
        {[lo, (lo + hi) / 2, hi].map((t) => (
          <text key={t} className="lp-curve__tick" x={M.l - 6} y={Y(t)} textAnchor="end" dominantBaseline="central">
            {formatNumber(t, 2)}
          </text>
        ))}
        <path className="lp-conv__best" d={path((p) => p.G)} />
        {points.some((p) => Number.isFinite(p.hvLadder)) ? <path className="lp-conv__ladder" d={path((p) => p.hvLadder)} /> : null}
        {h ? <line className="lp-curve__cross" x1={X(h.eu)} x2={X(h.eu)} y1={M.t} y2={M.t + ph} /> : null}
        {ends.map((e) => (
          <text key={e.key} className="lp-curve__end" x={M.l + pw + 8} y={e.y} dominantBaseline="central">
            {e.text}
          </text>
        ))}
        <text className="lp-curve__tick" x={M.l} y={height - 4}>
          {formatNumber(eu0, 0)}
        </text>
        <text className="lp-curve__tick" x={M.l + pw} y={height - 4} textAnchor="end">
          {`${formatNumber(eu1, 0)} evaluations`}
        </text>
      </svg>
    </div>
  );
}
