import { useMemo, useRef, useState } from 'react';
import { formatNumber, formatSigned, niceStep } from '@/components';
import type { ChartSeries } from '@/features/charts';
import { useElementWidth } from '@/features/charts/core/hooks';
import type { PlannerRequest, PlannerResultV2 } from '@/engine/planner/domain/types';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { goalMetric } from '../catalogue';
import { toDisplay } from '../format';
import { RUNG_TITLE, goalStatusOf, isWeightMetric, planOf, presentKinds, type PlanKind } from '../ladder';
import { goalText, seriesFor } from '../planFacts';

/* Drawn in real pixels: the width is measured, so text and strokes never scale with the card. */
const FALLBACK_W = 560;
/* r068 PR14: the plot runs the card's width; the end values are a legend row under it, never labels squeezed at the end */
const M = { l: 40, r: 12, t: 10, b: 20 };
const heightFor = (w: number) => (w >= 900 ? 200 : 160);

interface Line {
  kind: PlanKind;
  s: ChartSeries;
}

interface Multiple {
  key: string;
  metricId: string;
  title: string;
  target: { value: number; label: string } | null;
  lines: Line[];
}

/** Each day's value replaced by its week's mean: the trend of a series that swings day to day (hunger on fast days). */
const weeklyMean = (vals: ArrayLike<number>): Float64Array => {
  const out = new Float64Array(vals.length);
  for (let w = 0; w * 7 < vals.length; w++) {
    let sum = 0;
    let k = 0;
    for (let i = w * 7; i < Math.min(vals.length, w * 7 + 7); i++)
      if (Number.isFinite(vals[i]!)) {
        sum += vals[i]!;
        k++;
      }
    for (let i = w * 7; i < Math.min(vals.length, w * 7 + 7); i++) out[i] = k ? sum / k : NaN;
  }
  return out;
};

const pathOf = (vals: ArrayLike<number>, X: (i: number) => number, Y: (v: number) => number) => {
  let d = '';
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]!;
    if (!Number.isFinite(v)) continue;
    d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
  }
  return d;
};

const bandOf = (
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  X: (i: number) => number,
  Y: (v: number) => number,
) => {
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i < lo.length; i++) {
    if (!Number.isFinite(lo[i]!) || !Number.isFinite(hi[i]!)) continue;
    top.push(`${X(i).toFixed(1)},${Y(hi[i]!).toFixed(1)}`);
    bot.push(`${X(i).toFixed(1)},${Y(lo[i]!).toFixed(1)}`);
  }
  return top.length ? `M${top.join('L')}L${bot.reverse().join('L')}Z` : '';
};

function Small({
  m,
  selected,
  day,
  onDay,
  hidden,
}: {
  m: Multiple;
  selected: PlanKind;
  day: number | null;
  onDay: (d: number | null) => void;
  hidden: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(boxRef, FALLBACK_W) || FALLBACK_W;
  const H = heightFor(W);
  const PW = Math.max(60, W - M.l - M.r);
  const PH = H - M.t - M.b;
  const n = Math.max(1, ...m.lines.map((l) => l.s.daily.values.length));
  const decimals = m.lines[0]?.s.format.decimals ?? 1;
  const unit = m.lines[0]?.s.unit ?? '';
  const { lo, hi } = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (const l of m.lines.filter((l) => !l.s.display?.wordOnly)) {
      const band = l.kind !== 'ideal' ? l.s.daily.band : undefined;
      for (let i = 0; i < l.s.daily.values.length; i++) {
        for (const v of [l.s.daily.values[i]!, band?.lo[i], band?.hi[i]]) {
          if (v === undefined || !Number.isFinite(v)) continue;
          a = Math.min(a, v);
          b = Math.max(b, v);
        }
      }
    }
    if (m.target) {
      a = Math.min(a, m.target.value);
      b = Math.max(b, m.target.value);
    }
    if (!Number.isFinite(a)) return { lo: 0, hi: 1 };
    const pad = (b - a || Math.abs(a) * 0.05 || 1) * 0.08;
    return { lo: a - pad, hi: b + pad };
  }, [m]);
  const X = (i: number) => M.l + (i / Math.max(1, n - 1)) * PW;
  const Y = (v: number) => M.t + (1 - (v - lo) / (hi - lo || 1)) * PH;
  const step = niceStep(hi - lo, 3);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9 && ticks.length < 6; t += step)
    ticks.push(Number(t.toFixed(6)));
  // direct end labels ("Hard −8.1"): change from the start, pushed apart so they never overlap
  // a series that swings day to day (hunger) draws its weekly mean, the daily values a faint trace behind it
  const smooth = m.metricId === 'hunger';
  const ends = m.lines
    .map((l) => {
      const v = l.s.daily.values;
      const last = v[v.length - 1]!;
      return {
        kind: l.kind,
        y: l.s.display?.wordOnly ? M.t + 14 : Y(last),
        text: hidden
          ? RUNG_TITLE[l.kind]
          : l.s.display?.wordOnly
            ? `${RUNG_TITLE[l.kind]} ${l.s.display.wordOnly}`
            : `${RUNG_TITLE[l.kind]} ${formatSigned(last - (l.s.baseline ?? v[0] ?? last), decimals)}${unit ? ` ${unit}` : ''}${l.s.display?.qualifier ? ` · ${l.s.display.qualifier}` : ''}`,
      };
    })
    .sort((a, b) => a.y - b.y);
  const readout =
    day !== null && !hidden
      ? `day ${day + 1} · ${m.lines.map((l) => (l.s.display?.wordOnly ? `${RUNG_TITLE[l.kind]} ${l.s.display.wordOnly}` : `${RUNG_TITLE[l.kind]} ${formatNumber(l.s.daily.values[day] ?? NaN, decimals)}${unit ? ` ${unit}` : ''}${l.s.display?.qualifier ? ` · ${l.s.display.qualifier}` : ''}`)).join(' · ')}`
      : '';
  const summary = hidden
    ? `${m.title}: values hidden in gentle mode.`
    : `${m.title}: ${ends.map((e) => e.text).join(', ')}${m.target && m.lines.some((l) => !l.s.display?.wordOnly) ? `; ${m.target.label}` : ''}.`;
  return (
    <div className="lp-curve" ref={boxRef}>
      <h3 className="lp-curve__title">
        <span>{m.title}</span>
        <span className="lp-curve__read lm-num" aria-hidden="true">
          {readout}
        </span>
      </h3>
      <svg
        className="lp-curve__svg"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / (r.width || 1)) * W;
          const i = Math.round(((x - M.l) / PW) * (n - 1));
          onDay(i >= 0 && i < n ? i : null);
        }}
        onPointerLeave={() => onDay(null)}
      >
        {hidden
          ? null
          : m.lines.some((l) => !l.s.display?.wordOnly) &&
            ticks.map((t) => (
              <g key={t}>
                <line className="lp-curve__grid" x1={M.l} x2={M.l + PW} y1={Y(t)} y2={Y(t)} />
                <text
                  className="lp-curve__tick"
                  x={M.l - 6}
                  y={Y(t)}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {formatNumber(t, decimals)}
                </text>
              </g>
            ))}
        <line className="lp-curve__axis" x1={M.l} x2={M.l + PW} y1={M.t + PH} y2={M.t + PH} />
        {m.lines
          .filter((l) => !hidden && !l.s.display?.wordOnly && l.kind !== 'ideal' && l.s.daily.band)
          .map((l) => (
            <path
              key={`b-${l.kind}`}
              className="lp-curve__band"
              data-rung={l.kind}
              d={bandOf(l.s.daily.band!.lo, l.s.daily.band!.hi, X, Y)}
            />
          ))}
        {m.target && !hidden && m.lines.some((l) => !l.s.display?.wordOnly) ? (
          <g>
            <line
              className="lp-curve__target"
              x1={M.l}
              x2={M.l + PW}
              y1={Y(m.target.value)}
              y2={Y(m.target.value)}
            />
            <text className="lp-curve__target-t" x={M.l + 4} y={Y(m.target.value) - 4}>
              {m.target.label}
            </text>
          </g>
        ) : null}
        {smooth
          ? m.lines
              .filter((l) => !hidden && !l.s.display?.wordOnly)
              .map((l) => (
                <path key={`raw-${l.kind}`} className="lp-curve__raw" data-rung={l.kind} d={pathOf(l.s.daily.values, X, Y)} />
              ))
          : null}
        {m.lines
          .filter((l) => !hidden && !l.s.display?.wordOnly)
          .map((l) => (
            <path
              key={l.kind}
              className="lp-curve__line"
              data-rung={l.kind}
              data-selected={l.kind === selected || undefined}
              d={pathOf(smooth ? weeklyMean(l.s.daily.values) : l.s.daily.values, X, Y)}
            />
          ))}
        {day !== null ? (
          <line className="lp-curve__cross" x1={X(day)} x2={X(day)} y1={M.t} y2={M.t + PH} />
        ) : null}
        <text className="lp-curve__tick" x={M.l} y={H - 4}>
          wk 1
        </text>
        <text className="lp-curve__tick" x={M.l + PW} y={H - 4} textAnchor="end">
          {`wk ${Math.max(1, Math.round(n / 7))}`}
        </text>
      </svg>
      <ul className="lp-curve__legend" aria-hidden="true">
        {ends
          .slice()
          .sort((a, b) => kindsOrder.indexOf(a.kind) - kindsOrder.indexOf(b.kind))
          .map((e) => (
            <li key={e.kind} data-rung={e.kind} data-selected={e.kind === selected || undefined}>
              <i />
              <span className="lp-curve__end lm-num">{e.text}</span>
            </li>
          ))}
        {smooth ? <li className="lp-curve__legend-note">weekly mean · daily values faint</li> : null}
      </ul>
    </div>
  );
}

const kindsOrder: PlanKind[] = ['hard', 'medium', 'easy', 'ideal'];

export interface LadderCurvesProps {
  v2: PlannerResultV2;
  request: PlannerRequest;
  units: UnitSystem;
  energy: EnergyUnit;
  selected: PlanKind;
  gentle?: boolean;
  showNumbers?: boolean;
}

/**
 * Curves tab (CHART_SPEC §7.1 v0.2): one small multiple per ranked goal, then scale weight and hunger for context. Hard,
 * Medium and Easy as lines in their colours with half-alpha ranges (10th–90th percentile of the check runs, a sensitivity
 * range); the Ideal as a dashed ink line without a band (the best found without your limits, a search result, D4-08); the
 * target as a 1 px ink line; direct end labels "Hard −8.1"; the selected plan drawn heavier.
 * Collapsed rungs are absent. One crosshair across every multiple.
 */
export function LadderCurves({
  v2,
  request,
  units,
  energy,
  selected,
  gentle = false,
  showNumbers = false,
}: LadderCurvesProps) {
  const [day, setDay] = useState<number | null>(null);
  const kinds = presentKinds(v2);
  const multiples = useMemo<Multiple[]>(() => {
    const goalIds = request.goals.map((g) => g.metric as string);
    const context = ['scaleWeight', 'hunger'].filter((id) => !goalIds.includes(id));
    const hard = v2.rungs.hard ?? v2.rungs.medium ?? v2.rungs.easy;
    const make = (metricId: string, i: number | null): Multiple | null => {
      const lines = kinds.flatMap((k) => {
        const plan = planOf(v2, k)!;
        const s = seriesFor(plan, metricId, units, energy, i !== null ? goalStatusOf(plan, i) : undefined);
        return s ? [{ kind: k, s }] : [];
      });
      if (!lines.length) return null;
      const g = i !== null ? request.goals[i] : undefined;
      const name = (
        metricId === 'bodyFatPct' ? 'Body fat · tissue' : (goalMetric(metricId)?.label ?? lines[0]!.s.label)
      ).toLowerCase();
      const tAbs = i !== null ? hard?.summary.outcomes.find((o) => o.goal === i)?.target : null;
      const shown = tAbs !== null && tAbs !== undefined ? toDisplay(metricId, tAbs, units, energy) : null;
      return {
        key: i !== null ? `g${i}` : `c-${metricId}`,
        metricId,
        title: i !== null && g ? `${i + 1} · ${name} · ${goalText(g, units)}` : name,
        target: shown
          ? {
              value: shown.value,
              label: `target ${formatNumber(shown.value, shown.decimals)}${shown.unit ? `\u2009${shown.unit}` : ''}`,
            }
          : null,
        lines,
      };
    };
    return [...goalIds.map((id, i) => make(id, i)), ...context.map((id) => make(id, null))].filter(
      (x): x is Multiple => x !== null,
    );
  }, [v2, request.goals, kinds, units, energy]);
  const draws = kinds.map((k) => planOf(v2, k)?.bands?.draws ?? 0).filter((d) => d > 0);
  return (
    <div className="lp-curves">
      <p className="lp-curves__lead">
        Your goals in rank order, then scale weight and hunger.{' '}
        {/* r068 W2-18: name the dashed Ideal only when it is drawn (it is not when the Ideal is Hard's own plan) */}
        {kinds.includes('ideal') ? 'The Ideal is the dashed line: the best found without your practical limits. ' : ''}
        {draws.length
          ? `Shaded bands show the middle 80 % of ${formatNumber(Math.min(...draws), 0)} runs with the body model’s uncertain numbers varied; the cards give the middle of those, so their numbers can differ a little from these lines’ ends.`
          : 'Shaded bands are fixed display ranges: the check runs did not run for these plans.'}
      </p>
      <div className="lp-curves__grid">
        {multiples.map((m) => (
          <Small
            key={m.key}
            m={m}
            selected={selected}
            day={day}
            onDay={setDay}
            hidden={gentle && !showNumbers && isWeightMetric(m.metricId)}
          />
        ))}
      </div>
    </div>
  );
}
