import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { PlannerResultV2, RankedGoal } from '@/engine/planner/domain/types';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { KeyBank, formatNumber } from '@/components';
import { IDEAL_NOT_HARDER, RUNG_TITLE, isLoseGoal, ladderGraphData, type PlanKind, type RungId } from '../ladder';

export interface LadderScaleProps {
  v2: PlannerResultV2;
  goal1: RankedGoal | undefined;
  units: UnitSystem;
  energy: EnergyUnit;
  selected: PlanKind;
  onSelect: (kind: PlanKind) => void;
  /** Gentle mode with a weight-type goal 1: the scale shows effort only (values behind "show numbers"). */
  hideValues?: boolean;
}

export const LADDER_HOW = 'How it’s built: Hard is the best result your limits allow · Easy the least change that still gets at least half of it · Medium where more effort stops paying as much · Ideal drops your practical limits (safety still applies).';

/** Round tick values for the "plans searched" axis: 0 and up to three steps of 1/2/5 × 10ⁿ. */
function euTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw) ?? raw;
  const out: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) out.push(t);
  return out;
}

/**
 * LadderScale (COMPONENTS §13.5, plan-ladder.md §12.4): with two or more rung markers, effort 0-100 across (worded) and
 * goal 1's change up, a marker per rung on the frontier of the search and the Ideal as a dashed ceiling line; with fewer,
 * the search's convergence (the best Hard found so far against plans searched) so a lone Hard still reads as a curve.
 * Markers are the same toggles as the card titles; ←/→ move between them.
 */
export function LadderScale({ v2, goal1, units, energy, selected, onSelect, hideValues = false }: LadderScaleProps) {
  const [view, setView] = useState<'ladder' | 'search'>('search');
  const graph = ladderGraphData(v2, goal1, units, energy, view);
  const s = graph.scale;
  const search = graph.search;
  const refs = useRef(new Map<RungId, HTMLButtonElement>());
  const dir = goal1 && isLoseGoal(goal1) ? -1 : 1;
  const ys = search
    ? [0, ...search.points.map((p) => p.y * dir), ...(s.ceiling ? [s.ceiling.y * dir] : [])]
    : [0, ...s.points.map((p) => p.y * dir), ...s.frontier.map((p) => p.y * dir), ...(s.ceiling ? [s.ceiling.y * dir] : [])];
  const euMax = search ? search.final.eu || 1 : 1;
  const ex = (eu: number) => Math.min(100, Math.max(0, (eu / euMax) * 100));
  const markX = (p: { kind: RungId; x: number }) => (search ? 100 : left(p.x));
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = (hi - lo || 1) * 0.12;
  const top = (y: number) => (1 - (y * dir - (lo - pad * 0.25)) / (hi + pad - (lo - pad * 0.25) || 1)) * 100;
  const left = (x: number) => Math.min(100, Math.max(0, x));
  const order = [...s.points].sort((a, b) => a.x - b.x);
  // a label runs right of its dot (left of it near the right edge): when the neighbour on that side is close, the label
  // drops below its dot so it never covers the neighbour's dot or label (Q6: "Medium +22" hid "Hard +27" at 390 px)
  const crowd = (p: { kind: RungId; x: number }): 'close' | 'tight' | undefined => {
    const i = order.findIndex((q) => q.kind === p.kind);
    const nb = markX(p) > 70 ? order[i - 1] : order[i + 1];
    if (!nb) return undefined;
    const gap = Math.abs(markX(p) - markX(nb));
    return gap < 12 ? 'close' : gap < 30 ? 'tight' : undefined;
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: RungId) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = order.findIndex((p) => p.kind === k);
    const next = order[(i + d + order.length) % order.length];
    if (!next) return;
    onSelect(next.kind);
    refs.current.get(next.kind)?.focus();
  };
  return (
    <figure className="lp-scale" data-mode={graph.mode}>
      <p className="lp-scale__title">
        <span className="lm-eng">{graph.yLabel}</span>
        {s.ceiling && !hideValues ? <span className="lp-scale__ceil-text lm-num">{s.ceiling.label}</span> : null}
      </p>
      {graph.switchable ? (
        <KeyBank<'ladder' | 'search'>
          size="sm"
          label="Show the graph as"
          className="lp-scale__view"
          value={graph.mode}
          onChange={setView}
          options={[
            { value: 'ladder', label: 'ladder' },
            { value: 'search', label: 'search' },
          ]}
        />
      ) : null}
      <div className="lp-scale__plot" role="group" aria-label={search ? 'The search: best result found against plans searched' : 'The ladder: effort against goal 1'}>
        <svg className="lp-scale__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line className="lp-scale__base" x1={0} x2={100} y1={top(0)} y2={top(0)} />
          {s.ceiling ? <line className="lp-scale__ceiling" x1={0} x2={100} y1={top(s.ceiling.y)} y2={top(s.ceiling.y)} /> : null}
          {search ? (
            <polyline
              className="lp-scale__search"
              points={search.points.flatMap((p, i) => [...(i ? [`${ex(p.eu).toFixed(2)},${top(search.points[i - 1]!.y).toFixed(2)}`] : []), `${ex(p.eu).toFixed(2)},${top(p.y).toFixed(2)}`]).join(' ')}
            />
          ) : s.frontier.length > 1 ? (
            <polyline className="lp-scale__frontier" points={s.frontier.map((p) => `${left(p.x).toFixed(2)},${top(p.y).toFixed(2)}`).join(' ')} />
          ) : null}
        </svg>
        {s.points.map((p) => (
          <button
            key={p.kind}
            ref={(el) => {
              if (el) refs.current.set(p.kind, el);
              else refs.current.delete(p.kind);
            }}
            type="button"
            className="lp-scale__mark"
            data-rung={p.kind}
            data-edge={markX(p) > 70 ? 'end' : undefined}
            data-crowd={search ? undefined : crowd(p)}
            style={{ left: `${markX(p)}%`, top: `${top(p.y)}%` } as CSSProperties}
            aria-pressed={selected === p.kind}
            aria-label={`Select ${RUNG_TITLE[p.kind]} plan, effort ${Math.round(p.x)} of 100`}
            tabIndex={selected === p.kind || (selected === 'ideal' && p.kind === order[0]?.kind) ? 0 : -1}
            onClick={() => onSelect(p.kind)}
            onKeyDown={(e) => onKey(e, p.kind)}
          >
            <i aria-hidden="true" />
            <span className="lp-scale__label lm-num">{hideValues ? RUNG_TITLE[p.kind] : p.label}</span>
          </button>
        ))}
      </div>
      <div className="lp-scale__axis" aria-hidden="true">
        {search
          ? euTicks(euMax).map((t) => (
              <span key={t} style={{ left: `${ex(t)}%` }} data-edge={t === 0 ? 'start' : ex(t) > 92 ? 'end' : undefined}>
                {formatNumber(t, 0)}
              </span>
            ))
          : [0, 20, 40, 60, 80, 100].map((t) => (
              <span key={t} style={{ left: `${t}%` }} data-edge={t === 0 ? 'start' : t === 100 ? 'end' : undefined}>
                {t}
              </span>
            ))}
      </div>
      <p className="lp-scale__xlabel lm-eng" aria-hidden="true">
        {search ? 'plans searched' : graph.xLabel}
      </p>
      <p className="lm-sr">{hideValues ? s.points.map((p) => `${RUNG_TITLE[p.kind]} at effort ${Math.round(p.x)}`).join('; ') : graph.summary}</p>
      <figcaption className="lp-scale__how">
        {LADDER_HOW}
        {v2.ideal ? ` ${IDEAL_NOT_HARDER}` : null}
      </figcaption>
    </figure>
  );
}
