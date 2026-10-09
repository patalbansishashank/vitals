/* ==========================================================================
   <PreviewStrip> — coarse schedule preview (CHART_SPEC §7.7): 48 px, daily
   fat-mass line (body hue, 1.5 px) + 6 px ketosis ribbon (keto ramp). No axes;
   start and end values as text at the ends. Labelled "preview".
   ========================================================================== */
import { memo, useRef } from 'react';
import { useElementWidth } from '../core/hooks';
import { extent } from '../lib/downsample';
import { formatNumber, THIN } from '../lib/format';

export interface PreviewStripProps {
  /** Daily fat mass (kg). */
  fat: ArrayLike<number>;
  /** Daily ketosis level 0–3. */
  ketosis?: ArrayLike<number>;
  unit?: string;
  height?: number;
}

export const PreviewStrip = memo(function PreviewStrip({ fat, ketosis, unit = 'kg', height = 48 }: PreviewStripProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef) || 600;
  const n = fat.length;
  const m = { l: 44, r: 44, t: 6, b: 12 };
  // a container narrower than the two 44 px margins (mid-layout) must not give the ketosis bars a negative width
  const pw = Math.max(1, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const [lo, hi] = extent(fat);
  const X = (i: number) => m.l + ((i + 0.5) / n) * pw;
  const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * ph;
  let d = '';
  for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(fat[i]!).toFixed(1)}`;
  const runs: Array<{ a: number; b: number; lv: number }> = [];
  if (ketosis)
    for (let i = 0; i < ketosis.length; i++) {
      const lv = ketosis[i]!;
      const last = runs[runs.length - 1];
      if (last && last.lv === lv && last.b === i) last.b = i + 1;
      else runs.push({ a: i, b: i + 1, lv });
    }
  const keto = ['var(--lm-keto-1)', 'var(--lm-keto-2)', 'var(--lm-keto-3)'];
  return (
    <div ref={rootRef} className="lmc-mini">
      <svg className="lmc-svg" width={width} height={height} role="img" aria-label={`Preview: fat mass ${formatNumber(fat[0]!, 1)} to ${formatNumber(fat[n - 1]!, 1)} ${unit}${ketosis ? '; ketosis shown as a band' : ''}.`}>
        {/* the start value sits in the same 44 px margin: put the label at the opposite edge so they never overprint */}
        <text className="lmc-tick-t" x={2} y={Y(fat[0]!) < height / 2 ? height - 2 : 10}>
          preview
        </text>
        <text x={m.l - 6} y={Y(fat[0]!)} textAnchor="end" dominantBaseline="central" style={{ fontSize: 11, fill: 'var(--lm-ink-2)', fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(fat[0]!, 1)}
        </text>
        <path d={d} fill="none" stroke="var(--lm-cat-body)" strokeWidth={1.5} strokeLinejoin="round" />
        <text x={m.l + pw + 6} y={Y(fat[n - 1]!)} dominantBaseline="central" style={{ fontSize: 11, fontWeight: 600, fill: 'var(--lm-ink)', fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(fat[n - 1]!, 1)}
          {THIN}
          <tspan style={{ fontWeight: 400, fill: 'var(--lm-ink-2)' }}>{unit}</tspan>
        </text>
        {runs
          .filter((r) => r.lv > 0)
          .map((r, k) => (
            <rect key={k} x={m.l + (r.a / n) * pw} y={height - 7} width={((r.b - r.a) / n) * pw} height={6} fill={keto[Math.min(2, r.lv - 1)]} />
          ))}
      </svg>
    </div>
  );
});
