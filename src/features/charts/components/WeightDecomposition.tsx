/* ==========================================================================
   <WeightDecomposition> — "why did the scale drop 2 kg in week 1?"
   (CHART_SPEC §7.5): weekly columns diverging around zero — Δ fat, Δ lean
   tissue, Δ glycogen, Δ water — with 2 px surface gaps and the net change as
   an ink dot. Colours validated adjacent (charts.css). Hover / focus a week
   for the values; every value is also in the hidden table.
   ========================================================================== */
import { memo, useMemo, useRef, useState } from 'react';
import { useElementWidth } from '../core/hooks';
import { decimalsForStep, formatNumber, formatSigned, THIN } from '../lib/format';
import { niceTicksInside } from '../lib/ticks';
import type { CompositionTracks, TimeBase } from '../types';

export interface WeightDecompositionProps {
  composition: CompositionTracks;
  time: TimeBase;
  /** Values before day 1 (defaults to day-1 values). */
  baseline?: Partial<Record<keyof CompositionTracks, number>>;
  height?: number;
}

const KEYS: Array<{ k: keyof CompositionTracks; label: string; color: string }> = [
  { k: 'fat', label: 'fat', color: 'var(--lmc-decomp-fat)' },
  { k: 'lean', label: 'lean tissue', color: 'var(--lmc-decomp-lean)' },
  { k: 'glycogen', label: 'glycogen', color: 'var(--lmc-decomp-glycogen)' },
  { k: 'water', label: 'water', color: 'var(--lmc-decomp-water)' },
];

export interface WeekDelta {
  week: number;
  parts: Record<keyof CompositionTracks, number>;
  net: number;
}

/** Weekly change per component (kg): end of week minus end of the previous week. */
export function weeklyDeltas(c: CompositionTracks, days: number, baseline?: WeightDecompositionProps['baseline']): WeekDelta[] {
  const weeks = Math.ceil(days / 7);
  const out: WeekDelta[] = [];
  for (let w = 0; w < weeks; w++) {
    const e = Math.min(days - 1, w * 7 + 6);
    const parts = {} as Record<keyof CompositionTracks, number>;
    let net = 0;
    for (const { k } of KEYS) {
      const start = w === 0 ? (baseline?.[k] ?? c[k][0]!) : c[k][w * 7 - 1]!;
      parts[k] = c[k][e]! - start;
      net += parts[k];
    }
    out.push({ week: w + 1, parts, net });
  }
  return out;
}

export const WeightDecomposition = memo(function WeightDecomposition({ composition, time, baseline, height = 220 }: WeightDecompositionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef) || 720;
  const [hover, setHover] = useState<number | null>(null);
  const weeks = useMemo(() => weeklyDeltas(composition, time.days, baseline), [composition, time.days, baseline]);
  const m = { l: 44, r: 10, t: 10, b: 24 };
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  let lo = 0;
  let hi = 0;
  for (const w of weeks) {
    let pos = 0;
    let neg = 0;
    for (const { k } of KEYS) {
      const v = w.parts[k];
      if (v > 0) pos += v;
      else neg += v;
    }
    hi = Math.max(hi, pos, w.net);
    lo = Math.min(lo, neg, w.net);
  }
  const pad = (hi - lo || 1) * 0.08;
  lo -= pad;
  hi += pad;
  const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * ph;
  const slot = pw / weeks.length;
  const bw = Math.min(24, slot * 0.72);
  const ticks = niceTicksInside(lo, hi, { min: 3, max: 5 });
  const labelEvery = slot < 26 ? Math.ceil(26 / slot) : 1;
  const gap = 2;
  const describe = (w: WeekDelta) =>
    `Week ${w.week}: ${KEYS.map(({ k, label }) => `${label} ${formatSigned(w.parts[k], 2)}`).join(', ')}; net ${formatSigned(w.net, 2)} kg`;
  const hv = hover != null ? weeks[hover] : undefined;
  return (
    <div ref={rootRef} className="lmc-mini">
      <div className="lmc-mini-legend" style={{ padding: '10px 12px 8px' }}>
        {KEYS.map(({ k, label, color }) => (
          <span key={k}>
            <i style={{ background: color }} />Δ {label}
          </span>
        ))}
        <span>
          <i data-shape="dot" style={{ background: 'var(--lm-ink)' }} />
          net change
        </span>
        <span style={{ marginLeft: 'auto' }}>kg per week</span>
      </div>
      <svg className="lmc-svg" width={width} height={height} role="group" aria-label="Weekly weight change split into fat, lean tissue, glycogen and water">
        {ticks.ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + pw} y1={Math.round(Y(t)) + 0.5} y2={Math.round(Y(t)) + 0.5} stroke={t === 0 ? 'var(--lm-chart-axis)' : 'var(--lm-chart-grid)'} />
            <text className="lmc-tick-t" x={m.l - 8} y={Y(t)} textAnchor="end" dominantBaseline="central">
              {t === 0 ? '0' : formatSigned(t, decimalsForStep(ticks.step))}
            </text>
            <line x1={m.l - 4} x2={m.l} y1={Math.round(Y(t)) + 0.5} y2={Math.round(Y(t)) + 0.5} stroke="var(--lm-ink-3)" />
          </g>
        ))}
        <line x1={m.l - 0.5} x2={m.l - 0.5} y1={m.t} y2={m.t + ph} stroke="var(--lm-chart-axis)" />
        <line x1={m.l} x2={m.l + pw} y1={Math.round(Y(0)) + 0.5} y2={Math.round(Y(0)) + 0.5} stroke="var(--lm-edge)" />
        {weeks.map((w, i) => {
          const cx = m.l + (i + 0.5) * slot;
          const x = cx - bw / 2;
          let up = Y(0);
          let down = Y(0);
          const pos = KEYS.filter(({ k }) => w.parts[k] > 0);
          const neg = KEYS.filter(({ k }) => w.parts[k] < 0);
          return (
            <g
              key={w.week}
              className="lmc-col"
              tabIndex={0}
              role="img"
              aria-label={describe(w)}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
            >
              <rect className="lmc-colhit" x={cx - slot / 2} y={m.t} width={slot} height={ph} fill="transparent" />
              {pos.map(({ k, color }, j) => {
                const h = Y(0) - Y(w.parts[k]);
                const top = up - h;
                const base = j === 0 ? up : up - gap;
                up = top;
                if (base - top <= 0.5) return null;
                const r = j === pos.length - 1 ? Math.min(4, bw / 2, base - top) : 0;
                return <path className="lmc-bar" key={k} d={colPath(x, top, bw, base, r, 'up')} fill={color} />;
              })}
              {neg.map(({ k, color }, j) => {
                const h = Y(w.parts[k]) - Y(0);
                const bot = down + h;
                const base = j === 0 ? down : down + gap;
                down = bot;
                if (bot - base <= 0.5) return null;
                const r = j === neg.length - 1 ? Math.min(4, bw / 2, bot - base) : 0;
                return <path className="lmc-bar" key={k} d={colPath(x, base, bw, bot, r, 'down')} fill={color} />;
              })}
              <circle cx={cx} cy={Y(w.net)} r={4} fill="var(--lm-ink)" stroke="var(--lm-face)" strokeWidth={2} />
              {i % labelEvery === 0 ? (
                <text className="lmc-tick-t" x={cx} y={height - 8} textAnchor="middle">
                  wk {w.week}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hv ? (
        <div className="lmc-tip" style={{ left: Math.min(width - 190, m.l + (hover! + 1) * slot + 6), top: 36 }} aria-hidden="true">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>week {hv.week}</div>
          {KEYS.map(({ k, label, color }) => (
            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <i style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
              <b style={{ minWidth: 52 }}>
                {formatSigned(hv.parts[k], 2)}
                {THIN}kg
              </b>
              <span style={{ color: 'var(--lm-ink-2)' }}>{label}</span>
            </div>
          ))}
          <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--lm-line)' }}>
            <b>
              {formatSigned(hv.net, 2)}
              {THIN}kg
            </b>{' '}
            <span style={{ color: 'var(--lm-ink-2)' }}>net</span>
          </div>
        </div>
      ) : null}
      <table className="lmc-sr">
        <caption>Weekly change in kilograms</caption>
        <thead>
          <tr>
            <th>week</th>
            {KEYS.map(({ k, label }) => (
              <th key={k}>{label}</th>
            ))}
            <th>net</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week}>
              <th>{w.week}</th>
              {KEYS.map(({ k }) => (
                <td key={k}>{formatNumber(w.parts[k], 2)}</td>
              ))}
              <td>{formatNumber(w.net, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function colPath(x: number, top: number, w: number, bottom: number, r: number, dir: 'up' | 'down'): string {
  if (dir === 'up')
    return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${bottom} Z`;
  return `M${x},${top} L${x},${bottom - r} Q${x},${bottom} ${x + r},${bottom} L${x + w - r},${bottom} Q${x + w},${bottom} ${x + w},${bottom - r} L${x + w},${top} Z`;
}
