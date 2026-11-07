/* ==========================================================================
   <DotFill> (DATAVIZ P3, SPEC A.3.2): a total that only climbs, against its
   goal. Three rows of 5 px dots; fill runs left to right, a partial column
   fills top down; the head is a solid 6 × 22 gold pill in its own slot just
   after the fill, no halo. Over the goal every dot fills, the head stays at
   the end, the second lap lights that share of the dots again (r068) and
   the fact line says by how much ("+1 014 kcal over").
   Zero: all unfilled, a hollow head at the start. Provisional (a ring
   estimate): dashed dots. No goal: do not use DotFill, show the number.
   ========================================================================== */
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { clamp, isNum, speak, stripOf } from './geometry';
import { useWidth } from './hooks';
import './viz.css';

export type DotFillState = 'normal' | 'zero' | 'provisional' | 'loading';

export interface DotFillProps {
  label: string;
  value: number | null;
  goal: number | null;
  /** "9 664" */
  valueText: string;
  /** "of 10 000 steps" */
  goalText: string;
  /** "+1 014 kcal over"; shown only past the goal. */
  overText?: string;
  state?: DotFillState;
  /** Chip words beside the value, e.g. "Ring estimate". */
  chip?: string;
  quiet?: boolean;
  className?: string;
}

export const DOT_ROWS = 3;
export const DOT_PITCH = 8;
export const DOT_COLS_MIN = 16;
export const DOT_COLS_MAX = 40;

export interface DotModel {
  columns: number;
  total: number;
  filled: number;
  /** The head's slot, 0..columns (columns at or after it shift one slot right). */
  head: number;
  zero: boolean;
  over: boolean;
  /** The multiple of the goal from twice the goal (2.1), else null. */
  multiple: number | null;
  /** value / goal, 0 when there is no value. */
  ratio: number;
}

/** Columns for a strip `width` px wide: one slot is the head's. */
export const dotColumns = (width: number): number => clamp(Math.floor(width / DOT_PITCH) - 1, DOT_COLS_MIN, DOT_COLS_MAX);

export function dotModel(p: { value: number | null; goal: number | null; width?: number; columns?: number }): DotModel {
  const columns = p.columns ?? dotColumns(p.width ?? 288);
  const total = columns * DOT_ROWS;
  const ratio = isNum(p.value) && isNum(p.goal) && p.goal > 0 ? Math.max(0, p.value) / p.goal : 0;
  const filled = Math.round(clamp(ratio, 0, 1) * total);
  const head = Math.ceil(filled / DOT_ROWS);
  return {
    columns,
    total,
    filled,
    head,
    zero: filled === 0,
    over: ratio > 1,
    multiple: ratio >= 2 ? Math.round(ratio * 10) / 10 : null,
    ratio,
  };
}

/** Quiet words for a fill: no digits. A null value is unknown, never "none" (Claude UI P2-15). */
export function dotQuietWord(ratio: number, known = true): string {
  if (!known) return 'no value yet';
  if (ratio <= 0) return 'none yet';
  if (ratio < 0.5) return 'under half of the goal';
  if (ratio < 1) return 'over half of the goal';
  if (ratio < 1.0001) return 'goal reached';
  return 'past the goal';
}

/** "9 664 steps of a 10 000 goal". */
export function spokenDots(p: Pick<DotFillProps, 'label' | 'value' | 'goal' | 'valueText' | 'goalText' | 'overText' | 'state' | 'quiet' | 'chip'>): string {
  if (p.state === 'loading') return `${p.label}, loading`;
  const m = dotModel({ value: p.value, goal: p.goal, columns: DOT_COLS_MIN });
  if (!isNum(p.value)) return `${p.label}, no value yet`;
  if (p.quiet) return `${p.label}, ${dotQuietWord(m.ratio)}`;
  // "of 10 000 steps" → noun "steps", goal "10 000"
  const goal = stripOf(p.goalText);
  const match = /^([\d\s\u00a0.,−-]+)\s*(.*)$/.exec(goal);
  const goalNum = match?.[1]?.trim() ?? goal;
  const noun = match?.[2]?.trim() ?? '';
  const parts = [`${p.valueText}${noun ? ` ${noun}` : ''} of a ${goalNum} goal`];
  if (m.over && p.overText) parts.push(p.overText);
  if (m.multiple !== null) parts.push(`${formatNumber(m.multiple, 1)} times the goal`);
  if (p.state === 'provisional') parts.push(p.chip ? p.chip.toLowerCase() : 'provisional');
  return speak(parts.join(', '));
}

export function DotFill(props: DotFillProps) {
  const { label, value, goal, valueText, goalText, overText, state = 'normal', chip, quiet = false, className } = props;
  const [ref, width] = useWidth<HTMLDivElement>(288);
  const m = dotModel({ value: state === 'loading' ? null : value, goal, width });
  // a null value is unknown: no fill and no head at all, never the hollow zero head (§1.2; Claude UI P2-15)
  const unknown = state !== 'loading' && !isNum(value);
  const zero = !unknown && (state === 'zero' || m.zero);
  // (r068 V22) with no head (unknown, loading) the dots keep no slot for it, so they start at the text's edge
  const headless = unknown || state === 'loading';
  const slots = headless ? m.columns : m.columns + 1;
  const cx0 = (slot: number) => `${((slot + 0.5) / slots) * 100}%`;
  // (r068 V23) past the goal the second lap is drawn: that share of the dots lit again (the overshoot as a picture,
  // never a "×2.6" tag); from twice the goal every dot is lit and the figure says the rest
  const lap2 = m.over && !quiet ? Math.round(clamp(m.ratio - 1, 0, 1) * m.total) : 0;
  const dots = [];
  for (let c = 0; c < m.columns; c++) {
    const slot = !headless && c >= m.head ? c + 1 : c;
    for (let r = 0; r < DOT_ROWS; r++) {
      const i = c * DOT_ROWS + r;
      const filled = i < m.filled;
      dots.push(<circle key={`${c}-${r}`} cx={cx0(slot)} cy={4 + 3.5 + r * DOT_PITCH} r={2.5} data-filled={filled || undefined} data-lap={i < lap2 ? 2 : undefined} />);
    }
  }
  const showOver = m.over && !quiet;
  const extra = showOver ? (overText ?? '') : '';
  return (
    <div
      ref={ref}
      className={cx('lmv lmv-dots', className)}
      role="meter"
      aria-label={label}
      // quiet: words only, to assistive technology too (Claude UI P1-1)
      aria-valuemin={quiet ? undefined : 0}
      aria-valuemax={!quiet && isNum(goal) ? goal : undefined}
      aria-valuenow={!quiet && isNum(value) && state !== 'loading' ? (isNum(goal) ? Math.min(value, goal) : value) : undefined}
      aria-valuetext={spokenDots(props)}
      aria-busy={state === 'loading' || undefined}
      data-state={state}
      data-unknown={unknown || undefined}
      data-over={m.over || undefined}
    >
      <div className="lmv-dots__head" aria-hidden="true">
        {quiet ? (
          <span className="lmv-tick__words">{state === 'loading' ? '' : dotQuietWord(m.ratio, !unknown)}</span>
        ) : (
          <span className="lmv-fact">
            <span className="lmv-fact__value">{state === 'loading' || !isNum(value) ? '—' : valueText}</span>
            <span className="lmv-fact__of">{goalText}</span>
          </span>
        )}
        {extra ? <span className="lmv-dots__over">{extra}</span> : null}
        {chip && state === 'provisional' ? <span className="lm-chip lmv-chip" data-kind="provisional">{chip}</span> : null}
      </div>
      <svg className="lmv-dots__svg" aria-hidden="true" height={30}>
        {dots}
        {state !== 'loading' && !unknown ? (
          <svg x={cx0(m.head)} y={4} overflow="visible">
            <rect className="lmv-dots__pill" data-hollow={zero || undefined} x={zero ? -2.5 : -3} y={zero ? 0.5 : 0} width={zero ? 5 : 6} height={zero ? 21 : 22} rx={zero ? 2.5 : 3} />
          </svg>
        ) : null}
      </svg>
    </div>
  );
}
