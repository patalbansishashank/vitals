/* ==========================================================================
   <TickStrip> (DATAVIZ P2, SPEC A.3.2): a value against a goal as a strip of
   hairline ticks. Lit ticks stone up to the value, the value tick ivory and
   taller, the goal a gold tick with a ▼ and its words. The domain runs past
   the goal (goal × 1.25 or value × 1.05, tidied), so overshoot shows. Over
   the goal is never rose: neither side is styled as good. `limit` hatches
   the region beyond the goal at 45°. Variant `meter` adds a printed scale
   (the EquivalenceMeter look). Ticks are aria-hidden; the strip is a meter.
   ========================================================================== */
import { useId } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { clamp, isNum, lowerFirst, speak, stripOf, tidyCeil } from './geometry';
import { usePixelGrid, useWidth } from './hooks';
import './viz.css';

export type TickGoalKind = 'target' | 'floor' | 'limit';
export type TickStripState = 'normal' | 'learning' | 'future' | 'loading';

export interface TickStripProps {
  label: string;
  value: number | null;
  goal?: number | null;
  goalKind?: TickGoalKind;
  /** Default [0, tidy(max(goal·1.25, value·1.05))]. */
  domain?: [number, number];
  /** "7 h 56" */
  valueText: string;
  /** "of 7 h" */
  goalText?: string;
  /** "Goal met", "38 min short", "56 min over" */
  statusText?: string;
  /** Default floor(width / 5) in 36..72. Plan day N of M: `{ count: M, majorEvery: 7 }`. */
  ticks?: { count?: number; majorEvery?: number };
  variant?: 'default' | 'meter';
  /** Variant `meter`: the printed numerals (domain units). Default the domain ends and quarters. */
  scale?: number[];
  state?: TickStripState;
  quiet?: boolean;
  /** Quiet mode's words: "on target", "a little short". */
  quietText?: string;
  /** The goal tick's word in place of Goal / At least / Limit, e.g. "Target". */
  goalWord?: string;
  /** r068: the goal tick shows only its word ("Target") when the foot already says "of 1 850 kcal" (no number twice). */
  goalWordOnly?: boolean;
  /** The value as spoken, when it needs its noun: "7 h 56 asleep". Default `valueText`. */
  spokenValue?: string;
  className?: string;
}

export interface TickMark {
  i: number;
  /** 0..1 across the strip. */
  x: number;
  lit: boolean;
  major: boolean;
}

export interface TickModel {
  min: number;
  max: number;
  count: number;
  ticks: TickMark[];
  valueIndex: number | null;
  goalIndex: number | null;
  valueX: number | null;
  goalX: number | null;
  over: boolean;
}

export const TICK_MIN = 36;
export const TICK_MAX = 72;
/** Tick pitch in px (DATAVIZ P2). */
export const TICK_PITCH = 5;

/** Default tick count for a strip `width` px wide. */
export const tickCount = (width: number): number => clamp(Math.floor(width / TICK_PITCH), TICK_MIN, TICK_MAX);

/** The domain: given, else [0, tidy(max(goal × 1.25, value × 1.05))]. */
export function tickDomain(value: number | null, goal: number | null | undefined, domain?: [number, number]): [number, number] {
  if (domain && domain[1] > domain[0]) return domain;
  const g = isNum(goal) && goal > 0 ? goal * 1.25 : 0;
  const v = isNum(value) && value > 0 ? value * 1.05 : 0;
  return [0, tidyCeil(Math.max(g, v, 0) || 1)];
}

/** Pure layout of the strip. */
export function tickModel(p: Pick<TickStripProps, 'value' | 'goal' | 'domain' | 'ticks' | 'state'> & { width?: number }): TickModel {
  const [min, max] = tickDomain(p.value, p.goal, p.domain);
  const count = Math.max(2, Math.round(p.ticks?.count ?? tickCount(p.width ?? 288)));
  const majorEvery = p.ticks?.majorEvery;
  const at = (v: number) => Math.round(clamp((v - min) / (max - min), 0, 1) * (count - 1));
  const shows = p.state !== 'future' && p.state !== 'loading';
  const valueIndex = shows && isNum(p.value) ? at(p.value) : null;
  const goalIndex = isNum(p.goal) ? at(p.goal) : null;
  const ticks: TickMark[] = Array.from({ length: count }, (_, i) => ({
    i,
    x: i / (count - 1),
    lit: valueIndex !== null && i < valueIndex,
    major: majorEvery ? i % majorEvery === 0 : false,
  }));
  return {
    min,
    max,
    count,
    ticks,
    valueIndex,
    goalIndex,
    valueX: valueIndex === null ? null : valueIndex / (count - 1),
    goalX: goalIndex === null ? null : goalIndex / (count - 1),
    over: isNum(p.value) && isNum(p.goal) && p.value > p.goal,
  };
}

const GOAL_WORD: Record<TickGoalKind, string> = { target: 'Goal', floor: 'At least', limit: 'Limit' };

/** The goal tick's words: "Goal 7 h", "At least 120 g", "Limit 2 000 kcal", "Target 70". */
export function goalLabel(kind: TickGoalKind, goalText?: string, word?: string): string {
  const w = word ?? GOAL_WORD[kind];
  if (!goalText) return w;
  const rest = stripOf(goalText).replace(new RegExp(`^${w}\\s+`, 'i'), '');
  return `${w} ${rest}`;
}

/** "7 h 56 asleep, goal 7 h, met". Quiet: the label and the words only. */
export function spokenTick(p: Pick<TickStripProps, 'label' | 'value' | 'goal' | 'goalKind' | 'valueText' | 'goalText' | 'statusText' | 'state' | 'quiet' | 'quietText' | 'spokenValue' | 'goalWord'>): string {
  if (p.state === 'loading') return `${p.label}, loading`;
  if (p.quiet) return [p.label, p.quietText].filter(Boolean).join(', ');
  const parts: string[] = [];
  if (p.state === 'future') parts.push('not started');
  else if (!isNum(p.value)) parts.push('no value yet');
  else parts.push(p.spokenValue ?? p.valueText);
  if (isNum(p.goal) && p.goalText) parts.push(lowerFirst(goalLabel(p.goalKind ?? 'target', p.goalText, p.goalWord)));
  if (p.statusText && p.state !== 'future') parts.push(lowerFirst(p.statusText.replace(/^goal\s+/i, '')));
  if (p.state === 'learning') parts.push('provisional');
  return speak(parts.join(', '));
}

export function TickStrip(props: TickStripProps) {
  const { label, value, goal, goalKind = 'target', valueText, goalText, statusText, variant = 'default', state = 'normal', quiet = false, quietText, className } = props;
  const [ref, width] = useWidth<HTMLDivElement>(288);
  const hatchId = useId();
  const m = tickModel({ ...props, width });
  const hasValue = m.valueIndex !== null;
  const numerals = variant === 'meter' && !quiet ? (props.scale ?? [0, 0.25, 0.5, 0.75, 1].map((f) => m.min + f * (m.max - m.min))) : [];
  const goalRight = (m.goalX ?? 0) > 0.6;
  // Ticks snap to whole device pixels from the strip's real page offset, so every tick has one width (no moiré).
  const { originX, dpr } = usePixelGrid(ref);
  const plotW = Math.max(1, width - 2);
  const devW = (w: number) => (w === 0 ? 0 : Math.max(1, Math.round(w * dpr)) / dpr);
  const at = (x: number, w: number) => `${Math.round((originX + x * plotW - devW(w) / 2) * dpr) / dpr - originX}px`;
  return (
    <div
      ref={ref}
      className={cx('lmv lmv-tick', className)}
      role="meter"
      aria-label={label}
      // quiet: words only, to assistive technology too (no numeric range or value; Claude UI P1-1)
      aria-valuemin={quiet ? undefined : m.min}
      aria-valuemax={quiet ? undefined : m.max}
      aria-valuenow={!quiet && hasValue && isNum(value) ? value : undefined}
      aria-valuetext={spokenTick(props)}
      aria-busy={state === 'loading' || undefined}
      data-state={state}
      data-variant={variant}
      data-over={m.over || undefined}
    >
      <div className="lmv-tick__plot" aria-hidden="true" style={{ ['--lmv-tick-w' as string]: `${devW(1.5)}px` }}>
        {m.goalX !== null && goalKind === 'limit' ? (
          <svg className="lmv-tick__limit" style={{ left: `${m.goalX * 100}%`, width: `${(1 - m.goalX) * 100}%` }}>
            <defs>
              <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" className="lmv-hatch-line" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${hatchId})`} />
          </svg>
        ) : null}
        {m.ticks.map((t) => (
          <span
            key={t.i}
            className="lmv-tick__t"
            data-lit={t.lit || undefined}
            data-major={t.major || undefined}
            data-hidden={t.i === m.valueIndex || t.i === m.goalIndex || undefined}
            style={{ left: at(t.x, 1.5) }}
          />
        ))}
        {m.goalX !== null ? (
          <>
            <span className="lmv-tick__goal" data-kind={goalKind} style={{ left: at(m.goalX, 2) }} />
            <span className="lmv-tick__tri" style={{ left: at(m.goalX, 0) }} />
            <span className="lmv-tick__goalword" data-side={goalRight ? 'left' : 'right'} style={{ left: at(m.goalX, 0) }}>
              {quiet || props.goalWordOnly ? (props.goalWord ?? GOAL_WORD[goalKind]) : goalLabel(goalKind, goalText, props.goalWord)}
            </span>
          </>
        ) : null}
        {m.valueX !== null && m.valueIndex !== m.goalIndex ? <span className="lmv-tick__value" style={{ left: at(m.valueX, 2) }} /> : null}
      </div>
      {numerals.length > 0 ? (
        <div className="lmv-tick__scale" aria-hidden="true">
          {numerals.map((n, i) => (
            <span key={i} style={{ left: `${((n - m.min) / (m.max - m.min)) * 100}%` }} data-edge={i === 0 ? 'start' : i === numerals.length - 1 ? 'end' : undefined}>
              {formatNumber(n, Number.isInteger(n) ? 0 : 1)}
            </span>
          ))}
        </div>
      ) : null}
      <div className="lmv-tick__foot" aria-hidden="true">
        {quiet ? (
          <span className="lmv-tick__words">{quietText}</span>
        ) : (
          <>
            <span className="lmv-fact">
              <span className="lmv-fact__value">{state === 'loading' || state === 'future' || !isNum(value) ? '—' : valueText}</span>
              {goalText && isNum(goal) ? <span className="lmv-fact__of">{goalText}</span> : null}
            </span>
            {statusText && state !== 'loading' && state !== 'future' ? <span className="lmv-tick__status">{statusText}</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
