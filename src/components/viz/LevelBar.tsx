/* ==========================================================================
   <LevelBar> (DATAVIZ P1 with D19, SPEC A.3.2): where one reading sits in its
   range, beside the reading. Seven 6 × 14 px cells in one row (ten behind
   `columns`), 3 px apart. Unlit cells are the chart axis, cells inside the
   person's usual range a little lighter, the lit cell takes the status mark
   colour. Knots put every band edge on a column edge (integer column units),
   so a band never splits a cell. Stale: the lit cell as an outline and the
   gold stale dot. Calibrating: dashed outlines. Inside a Signals row the bar
   is aria-hidden (the row reads); alone it is a meter.
   ========================================================================== */
import { cx } from '../lib/cx';
import type { Severity } from '../Notice';
import { clamp, interpolate, isNum } from './geometry';
import './viz.css';

/** [value, column unit]: the column unit u runs 0..columns; the cell is floor(u). */
export type Knot = [value: number, columnUnit: number];
export type LevelColumns = 7 | 10;
export type LevelState = 'normal' | 'none' | 'stale' | 'calibrating';

export interface LevelBarProps {
  /** 0-based lit cell, or null for no reading. */
  cell: number | null;
  columns?: LevelColumns;
  /** Cells inside the person's usual range, inclusive, 0-based. */
  usual?: [number, number] | null;
  severity?: Severity | 'neutral';
  state?: LevelState;
  label?: string;
  /** "Normal" */
  wordText?: string;
  /** Standalone: role="meter". Default false (aria-hidden inside a reading row). */
  asMeter?: boolean;
  /** Accepted for the shared module contract; a position is not a number, so quiet changes nothing here. */
  quiet?: boolean;
  className?: string;
}

/** Knots for 7 columns (SPEC A.3.2 table; band edges from ring/model.ts BANDS). */
export const LEVEL_KNOTS: { hr: Knot[]; spo2: Knot[]; stress: Knot[] } = {
  hr: [
    [40, 0],
    [50, 1],
    [90, 4],
    [120, 6],
    [160, 7],
  ],
  spo2: [
    [85, 0],
    [89, 1],
    [93, 3],
    [95, 4],
    [100, 7],
  ],
  stress: [
    [0, 0],
    [26, 1],
    [51, 3],
    [76, 5],
    [100, 7],
  ],
};

/** DATAVIZ P1's knots for 10 columns (`columns: 10`, D19). */
export const LEVEL_KNOTS_10: { hr: Knot[]; spo2: Knot[]; stress: Knot[] } = {
  hr: [
    [40, 0],
    [50, 2],
    [90, 6],
    [120, 8],
    [160, 10],
  ],
  spo2: [
    [85, 0],
    [89, 2],
    [93, 4],
    [95, 5],
    [100, 10],
  ],
  stress: [
    [0, 0],
    [26, 3],
    [51, 5],
    [76, 8],
    [100, 10],
  ],
};

/** The cell of a column unit: min(columns − 1, floor(u)), 0-based. */
export const cellOfUnit = (u: number, columns: LevelColumns): number => clamp(Math.floor(u + 1e-9), 0, columns - 1);

/** The 0-based cell of a reading through its knots. */
export function levelCell(value: number, knots: readonly Knot[], columns: LevelColumns): number {
  return cellOfUnit(interpolate(value, knots), columns);
}

/** Personal metrics (HRV, skin temperature): the column unit of a z-score. 7 columns: u = 3.5 + z, one column per SD. */
export function personalKnot(z: number, columns: LevelColumns): number {
  const u = columns === 7 ? 3.5 + z : 5 + (z * 10) / 6;
  return clamp(u, 0, columns);
}

/** Where the lit cell sits against the usual range: "upper half of your usual range". */
export function usualPhrase(cell: number, usual: [number, number] | null | undefined): string | null {
  if (!usual) return null;
  const [lo, hi] = usual[0] <= usual[1] ? usual : [usual[1], usual[0]];
  if (cell < lo) return 'below your usual range';
  if (cell > hi) return 'above your usual range';
  if (hi === lo) return 'within your usual range';
  const mid = (lo + hi) / 2;
  if (Math.abs(cell - mid) < 0.5 && (hi - lo) % 2 === 0) return 'middle of your usual range';
  return cell > mid ? 'upper half of your usual range' : 'lower half of your usual range';
}

/** "Normal, upper half of your usual range". */
export function spokenLevel(p: Pick<LevelBarProps, 'cell' | 'columns' | 'usual' | 'state' | 'wordText' | 'label'>): string {
  if (p.state === 'none' || !isNum(p.cell)) return [p.label, 'no reading'].filter(Boolean).join(', ');
  if (p.state === 'calibrating') return [p.label, p.wordText ?? 'calibrating'].filter(Boolean).join(', ');
  const columns = p.columns ?? 7;
  const pos = usualPhrase(p.cell, p.usual) ?? `cell ${p.cell + 1} of ${columns}`;
  return [p.wordText, pos, p.state === 'stale' ? 'stale' : null].filter(Boolean).join(', ');
}

export function LevelBar(props: LevelBarProps) {
  const { cell, columns = 7, usual, severity = 'neutral', state = 'normal', label, asMeter = false, className } = props;
  const lit = state === 'none' || state === 'calibrating' || !isNum(cell) ? null : clamp(cell, 0, columns - 1);
  const [ulo, uhi] = usual ? (usual[0] <= usual[1] ? usual : [usual[1], usual[0]]) : [-1, -2];
  const a11y = asMeter
    ? {
        role: 'meter' as const,
        'aria-label': label,
        'aria-valuemin': 1,
        'aria-valuemax': columns,
        'aria-valuenow': lit === null ? undefined : lit + 1,
        'aria-valuetext': spokenLevel(props),
      }
    : { 'aria-hidden': true as const };
  return (
    <span className={cx('lmv lmv-level', className)} data-columns={columns} data-state={state} data-severity={severity} {...a11y}>
      <span className="lmv-level__cells">
        {Array.from({ length: columns }, (_, i) => (
          <span key={i} className="lmv-level__cell" data-lit={i === lit || undefined} data-usual={(i >= ulo && i <= uhi) || undefined} />
        ))}
      </span>
      {state === 'stale' ? <span className="lmv-stale-dot" aria-hidden="true" /> : null}
    </span>
  );
}
