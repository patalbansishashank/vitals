/** Internal building blocks shared by ScaleSlider and ScaleRange (not exported from the index). */
import { useMemo, type CSSProperties } from 'react';
import { formatNumber } from './lib/format';
import { decimalsOf, pct, scaleTicks } from './lib/scale';

export type ZoneTone =
  | 'deficit-1'
  | 'deficit-2'
  | 'deficit-3'
  | 'deficit-4'
  | 'surplus-1'
  | 'surplus-2'
  | 'surplus-3'
  | 'surplus-4'
  | 'neutral'
  | 'caution'
  | 'danger';

export interface ScaleZone {
  from: number;
  to: number;
  tone: ZoneTone;
  /** Accessible explanation, e.g. "under 800 kcal: medical supervision". Shown as title. */
  label?: string;
}

export type ScaleLabel = number | { value: number; label: string };

const ZONE_BG: Record<ZoneTone, string> = {
  'deficit-1': 'var(--lm-energy-deficit-1)',
  'deficit-2': 'var(--lm-energy-deficit-2)',
  'deficit-3': 'var(--lm-energy-deficit-3)',
  'deficit-4': 'var(--lm-energy-deficit-4)',
  'surplus-1': 'var(--lm-energy-surplus-1)',
  'surplus-2': 'var(--lm-energy-surplus-2)',
  'surplus-3': 'var(--lm-energy-surplus-3)',
  'surplus-4': 'var(--lm-energy-surplus-4)',
  neutral: 'var(--lm-energy-neutral)',
  caution: 'var(--lm-caution-bg)',
  danger: 'var(--lm-danger-bg)',
};
const ZONE_EDGE: Partial<Record<ZoneTone, string>> = {
  caution: 'var(--lm-caution-mark)',
  danger: 'var(--lm-danger-mark)',
};

export interface ScaleGeometry {
  min: number;
  max: number;
  minorStep: number;
  majorStep: number;
}

export function defaultSteps(min: number, max: number, minorStep?: number, majorStep?: number) {
  const span = max - min;
  const major = majorStep ?? span / 8;
  const minor = minorStep ?? major / 5;
  return { minor, major };
}

/** Zones, printed ticks, likely-range underlay and reference tick inside the well. */
export function WellLayers({
  min,
  max,
  minorStep,
  majorStep,
  zones,
  likelyRange,
  reference,
  height,
}: ScaleGeometry & {
  zones?: ReadonlyArray<ScaleZone>;
  likelyRange?: readonly [number, number];
  reference?: { value: number; label?: string };
  height: number;
}) {
  const ticks = useMemo(() => scaleTicks(min, max, minorStep, majorStep), [min, max, minorStep, majorStep]);
  return (
    <>
      {zones && zones.length > 0 ? (
        <div className="lm-scale__zones" aria-hidden="true">
          {zones.map((z, i) => {
            const left = pct(z.from, min, max);
            const width = pct(z.to, min, max) - left;
            const edgeColor = ZONE_EDGE[z.tone];
            const edge = edgeColor ? (z.from <= min ? 'end' : 'start') : undefined;
            return (
              <div
                key={i}
                className="lm-scale__zone"
                data-edge={edge}
                title={z.label}
                style={{ left: `${left}%`, width: `${width}%`, background: ZONE_BG[z.tone], '--zone-edge': edgeColor } as CSSProperties}
              />
            );
          })}
        </div>
      ) : null}
      <div className="lm-scale__ticks" aria-hidden="true">
        <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none">
          {ticks.map((t) => {
            const x = (pct(t.value, min, max) / 100) * 1000;
            return <line key={t.value} x1={x} x2={x} y1={0} y2={t.major ? 10 : 6} data-major={t.major} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
      </div>
      {likelyRange ? (
        <div
          className="lm-scale__range"
          aria-hidden="true"
          style={{ left: `${pct(likelyRange[0], min, max)}%`, width: `${pct(likelyRange[1], min, max) - pct(likelyRange[0], min, max)}%` }}
        />
      ) : null}
      {reference ? <div className="lm-scale__ref" aria-hidden="true" title={reference.label} style={{ left: `${pct(reference.value, min, max)}%` }} /> : null}
    </>
  );
}

/** Lowercase numerals under the major ticks (11 px condensed). */
export function Numerals({
  min,
  max,
  majorStep,
  labels,
  reference,
}: {
  min: number;
  max: number;
  majorStep: number;
  labels?: ReadonlyArray<ScaleLabel>;
  reference?: { value: number; label?: string };
}) {
  const items = useMemo(() => {
    let list: Array<{ value: number; label: string }>;
    if (labels) {
      list = labels.map((l) => (typeof l === 'number' ? { value: l, label: formatNumber(l, decimalsOf(majorStep)) } : l));
    } else {
      const majors = scaleTicks(min, max, majorStep, majorStep).map((t) => t.value);
      const every = majors.length > 9 ? Math.ceil(majors.length / 9) : 1;
      list = majors.filter((_, i) => i % every === 0).map((v) => ({ value: v, label: formatNumber(v, decimalsOf(majorStep)) }));
    }
    return list;
  }, [labels, min, max, majorStep]);
  return (
    <div className="lm-scale__nums" aria-hidden="true">
      {items.map((it) => {
        const p = pct(it.value, min, max);
        return (
          <span key={`${it.value}-${it.label}`} style={{ left: `${p}%` }} data-edge={p <= 0.5 ? 'start' : p >= 99.5 ? 'end' : undefined}>
            {it.label}
          </span>
        );
      })}
      {reference?.label ? (
        <span data-ref="true" style={{ left: `${pct(reference.value, min, max)}%` }}>
          {reference.label}
        </span>
      ) : null}
    </div>
  );
}
