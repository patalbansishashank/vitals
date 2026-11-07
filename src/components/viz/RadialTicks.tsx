/* ==========================================================================
   <RadialTicks> (r071, AUDIT §5.2 and §5.4, RESEARCH §4.6): one reading in a bounded scale, or progress toward a goal,
   as a ring of short radial ticks that light clockwise from 12 o'clock. Lit ticks are ivory, the unlit remainder is
   the quiet --lm-unlit; the number sits in the middle (`centre`: a HeroNumber and a MonoMeta). Gauges are
   space-hungry, so a screen carries one (AUDIT §5.4); the rest of the page uses the linear pictures.

   Built from DayDisc's lit-count model (a lit count, quiet steps, per-part arcs, the dashed outline of a missing part)
   and ArcRuler's radial tick drawing (`polar`). 72 ticks (60 under 120 px), a longer tick every sixth or at the goal.
   Past the goal the ring is full and a second lap lights an inner ring of short dashes in the domain's ink tint:
   neutral and never rose, and told apart by position, not by colour alone. A `limit` has no second lap.

   Quiet: no numeral anywhere (DOM and aria); the fill is three steps (a third, two thirds, all) unless
   `quietFill="ratio"`, for a ratio picture that may still sweep. Null is "no value yet", never zero.
   ========================================================================== */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { MonoMeta } from '../MonoMeta';
import { DEG, TAU, arcPath, clamp, goalPhrase, isNum, lowerFirst, polar, quietStep, ratioWord, reachedPhrase, speak, tickRing, type GoalKind } from './geometry';
import { InlineTwin, twinFileName, type TwinData } from './twin';
import './viz-base.css';
import './radial.css';

export type RadialGoalKind = GoalKind;
export type RadialState = 'normal' | 'learning' | 'stale' | 'none' | 'loading' | 'provisional' | 'zero' | 'unknown';
/** `xs` 28 px · `sm` 72 · `md` 120 · `lg` 160, or any px size. */
export type RadialSize = 'xs' | 'sm' | 'md' | 'lg' | number;

export interface RadialPart {
  id: string;
  label: string;
  /** 0..`max` (default 100); null is a missing part (a dashed outline, and `needs` says what it needs). */
  value: number | null;
  /** The part's own hue: its lit ticks wear the domain solid, so the arcs tell themselves apart (the legend names them). */
  hue?: Domain;
  /** `low` draws the lit ticks dashed: a pattern, never colour alone. */
  confidence?: 'low' | 'medium' | 'high';
  /** "needs 3 more nights" */
  needs?: string;
}

export interface RadialTicksProps {
  /** The text alternative's name: "Steps". */
  label: string;
  /** The reading; null is unknown ("no value yet"), never zero. In `parts` mode this is the overall score. */
  value: number | null;
  /** The value that fills the ring once. Default the goal, else 100. */
  max?: number;
  /** Fills the ring when `max` is not given; with a `max` the goal is marked by a longer tick. */
  goal?: number | null;
  goalKind?: RadialGoalKind;
  /** Ticks in the ring (per arc in `parts` mode, where it is the total split between the parts). Default 72, 60 under 120 px, 24 at `xs`; any integer from 1 (one tick per discrete item). */
  count?: number;
  /** A longer tick every nth position; 0 for equal-length discrete ticks. Default 6. */
  majorEvery?: number;
  /** A partly lit tick for partial progress, instead of rounding to a whole tick. */
  fractional?: boolean;
  size?: RadialSize;
  /** Overrides the card's domain hue for this picture. */
  hue?: Domain;
  /** Past the ring's scale, light a second lap (an inner ring of dashes, in the ink tint). Default true; never for a `limit`. */
  lap2?: boolean;
  /** The likely range, in value units, as a faint arc under the ticks. */
  band?: [number, number];
  /** An amount not counted yet (Heart Points pending): a dashed arc after the counted part. */
  pending?: number;
  /** A value drawn as a longer ivory tick (the goal, 100 %). Default the goal when `max` differs from it. */
  mark?: number;
  /** The Day score's arcs: the ring splits into arcs with 8° gaps, 24 ticks each for three. */
  parts?: RadialPart[];
  /** Centred over the ring: a HeroNumber and a MonoMeta. Decorative to assistive technology (the sentence says it). */
  centre?: ReactNode;
  state?: RadialState;
  /** First view sweeps the ticks (default true). False renders the final frame at once. `sweep` is its AUDIT name. */
  animate?: boolean;
  sweep?: boolean;
  /** Quiet mode: no numerals; the fill is three steps unless `quietFill="ratio"`. */
  quiet?: boolean;
  quietFill?: 'steps' | 'ratio';
  /** Quiet words for the sentence ("about a third"). Default from the ratio. */
  quietWord?: string;
  /** The sentence, when the caller says it better than the default. */
  spoken?: string;
  /** `true` draws a "Table" key and the table under the ring; a node is drawn as given. The (i) panel usually hosts `radialTwin(props)` instead. */
  twin?: boolean | ReactNode;
  /** Words for the default sentence and twin: the unit after a value ("steps"), the formatted value and goal, decimals. */
  unit?: string;
  valueText?: string;
  goalText?: string;
  decimals?: number;
  /** In `parts` mode, the names under the ring (default true). */
  legend?: boolean;
  className?: string;
}

export const RADIAL_SIZES = { xs: 28, sm: 72, md: 120, lg: 160 } as const;
export const RADIAL_VB = 132;
const C = RADIAL_VB / 2;
const R_OUT = 61;
const LEN = { minor: 8, major: 11, mark: 16 } as const;
/** Under 56 px the geometry would be hair-thin: the ticks are drawn longer (in box units) and carry no second lap. */
const SMALL_PX = 56;
const SMALL_TICK_SCALE = 2.75;
const MAX_TICK_LEN = 34;
const R_BAND = 46.5;
const LAP_R = { from: 38, to: 43 } as const;
const R_MISSING = 56;

export const radialPx = (s: RadialSize = 'md'): number => (typeof s === 'number' ? s : RADIAL_SIZES[s]);
/** 72 ticks, 60 under 120 px, 24 at icon size. */
export const radialCount = (px: number): number => (px >= 120 ? 72 : px >= 56 ? 60 : 24);

export interface RadialTickModel {
  i: number;
  angle: number;
  major: boolean;
  lit: boolean;
  /** 0..1 of a partly lit tick (`fractional`). */
  partial: number;
  /** The last lit tick, while the ring is not full. */
  edge: boolean;
  mark: boolean;
}

export interface RadialArcModel {
  id: string;
  label?: string;
  hue?: Domain;
  ticks: RadialTickModel[];
  count: number;
  lit: number;
  /** Ticks lit in the second lap. */
  lap: number;
  lapOn: boolean;
  ratio: number;
  known: boolean;
  missing: boolean;
  low: boolean;
  needs?: string;
  /** Radians, where the arc starts and ends. */
  start: number;
  end: number;
}

export interface RadialModel {
  /** Ticks per arc (the whole ring when there are no parts). */
  count: number;
  /** The value that fills the ring once. */
  scale: number;
  known: boolean;
  /** value / scale, uncapped; 0 when unknown. */
  ratio: number;
  /** The value is past the goal. */
  over: boolean;
  quiet: boolean;
  arcs: RadialArcModel[];
  markIndex: number | null;
  /** Radians. */
  band: [number, number] | null;
  pending: [number, number] | null;
}

type ModelProps = Pick<RadialTicksProps, 'value' | 'max' | 'goal' | 'goalKind' | 'count' | 'majorEvery' | 'size' | 'fractional' | 'lap2' | 'band' | 'pending' | 'mark' | 'parts' | 'state' | 'quiet' | 'quietFill'>;

/** Pure layout of the ring: which ticks are lit, the second lap, the mark, the arcs of the parts. */
export function radialModel(p: ModelProps): RadialModel {
  const state = p.state ?? 'normal';
  const hidden = state === 'none' || state === 'unknown' || state === 'loading';
  const quiet = !!p.quiet;
  const steps = quiet && (p.quietFill ?? 'steps') === 'steps';
  const goal = isNum(p.goal) && p.goal > 0 ? p.goal : null;
  const scale = isNum(p.max) && p.max > 0 ? p.max : (goal ?? 100);
  const total = clamp(Math.round(p.count ?? radialCount(radialPx(p.size))), 1, 144);
  const kind = p.goalKind ?? 'target';
  const known = isNum(p.value) && !hidden;
  const ratio = known ? Math.max(0, p.value as number) / scale : 0;
  const over = known && goal !== null && (p.value as number) > goal;
  const fill = (r: number, count: number, fractional: boolean): { lit: number; partial: number } => {
    if (steps) return { lit: quietStep(r, count), partial: 0 };
    const raw = clamp(r, 0, 1) * count;
    if (fractional) {
      const lit = Math.floor(raw + 1e-9);
      return { lit, partial: lit < count ? raw - lit : 0 };
    }
    return { lit: Math.round(raw), partial: 0 };
  };

  if (p.parts?.length) {
    const n = p.parts.length;
    const per = Math.max(6, Math.floor(total / n));
    const slot = TAU / n;
    const gap = n > 1 ? 8 * DEG : 0;
    const arcs = p.parts.map<RadialArcModel>((part, k) => {
      const start = n === 1 ? 0 : k * slot - (slot - gap) / 2;
      const pk = isNum(part.value) && !hidden;
      const r = pk ? clamp((part.value as number) / scale, 0, 1) : 0;
      const f = fill(r, per, false);
      const ticks = tickRing({ count: per, startRad: start, sweepRad: slot, gapRad: gap, majorEvery: p.majorEvery }).map<RadialTickModel>((t) => ({ ...t, lit: t.i < f.lit, partial: 0, edge: t.i === f.lit - 1 && f.lit < per, mark: false }));
      return { id: part.id, label: part.label, hue: part.hue, ticks, count: per, lit: f.lit, lap: 0, lapOn: false, ratio: r, known: pk, missing: !isNum(part.value), low: part.confidence === 'low' && isNum(part.value), needs: part.needs, start, end: start + slot - gap };
    });
    return { count: per, scale, known, ratio, over, quiet, arcs, markIndex: null, band: null, pending: null };
  }

  const f = fill(ratio, total, !!p.fractional);
  const lapOn = p.lap2 !== false && kind !== 'limit' && ratio > 1 && !steps;
  const lap = lapOn ? Math.round(clamp(ratio - 1, 0, 1) * total) : 0;
  const markValue = isNum(p.mark) && p.mark > 0 ? p.mark : goal !== null && goal !== scale ? goal : null;
  const markIndex = markValue === null ? null : Math.round(clamp(markValue / scale, 0, 1) * total) % total;
  const ticks = tickRing({ count: total, majorEvery: p.majorEvery }).map<RadialTickModel>((t) => ({
    ...t,
    lit: t.i < f.lit,
    partial: t.i === f.lit && f.partial > 0 ? f.partial : 0,
    edge: t.i === f.lit - 1 && f.lit < total,
    mark: t.i === markIndex,
  }));
  const at = (v: number) => clamp(v / scale, 0, 1) * TAU;
  const band: [number, number] | null = p.band && p.band[1] > p.band[0] ? [at(p.band[0]), at(p.band[1])] : null;
  const pending: [number, number] | null = known && isNum(p.pending) && p.pending > 0 ? [at(p.value as number), at((p.value as number) + p.pending)] : null;
  return {
    count: total,
    scale,
    known,
    ratio,
    over,
    quiet,
    arcs: [{ id: 'ring', ticks, count: total, lit: f.lit, lap, lapOn, ratio, known, missing: false, low: false, start: 0, end: TAU }],
    markIndex,
    band,
    pending,
  };
}

const stepWord = (r: number): string => (r < 0.34 ? 'low' : r < 0.67 ? 'medium' : 'high');

const NUMBER_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** "needs 3 more nights" → "needs three more nights" (quiet mode: no digit survives; past twelve is "several"). */
export const quietNeeds = (text: string): string =>
  text.replace(/\d+(?:[.,]\d+)?/g, (m) => {
    const n = Number(m.replace(',', '.'));
    return Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : 'several';
  });

const valueOf = (p: Pick<RadialTicksProps, 'value' | 'valueText' | 'unit' | 'decimals'>): string => p.valueText ?? `${formatNumber(p.value as number, p.decimals ?? 0)}${p.unit ? ` ${p.unit}` : ''}`;
const goalOf = (p: Pick<RadialTicksProps, 'goal' | 'goalText' | 'unit' | 'decimals'>): string | null =>
  isNum(p.goal) && p.goal > 0 ? (p.goalText ?? `${formatNumber(p.goal, p.decimals ?? 0)}${p.unit ? ` ${p.unit}` : ''}`) : null;

/**
 * "Steps: 7 605 steps, goal 9 000 steps". A goal reached or passed is said plainly ("goal reached", "past the goal",
 * "over the limit" for a limit); a ring with parts reads "Day score 84 of 100: recovery 71, activity 92, sleep 88".
 * Quiet: words only. Null: "no value yet".
 */
export function spokenRadial(p: ModelProps & Pick<RadialTicksProps, 'label' | 'spoken' | 'quietWord' | 'valueText' | 'goalText' | 'unit' | 'decimals'>): string {
  if (p.spoken) return p.spoken;
  const state = p.state ?? 'normal';
  if (state === 'loading') return `${p.label}, loading`;
  const m = radialModel(p);
  const tag = state === 'stale' ? 'stale' : state === 'provisional' ? 'provisional' : state === 'learning' ? 'still learning' : null;
  if (p.parts?.length) {
    const head = m.known ? (p.quiet ? `${p.label}, ${p.quietWord ?? stepWord(m.ratio)}` : `${p.label} ${formatNumber(p.value as number, p.decimals ?? 0)} of ${formatNumber(m.scale)}`) : `${p.label}, no score yet`;
    const list = m.arcs.map((a) => {
      const name = lowerFirst(a.label ?? a.id);
      if (a.missing) return `${name} ${a.needs ? (p.quiet ? quietNeeds(a.needs) : a.needs) : 'not yet'}`;
      return p.quiet ? `${name} ${stepWord(a.ratio)}` : `${name} ${formatNumber(p.parts!.find((x) => x.id === a.id)!.value as number, 0)}`;
    });
    return speak([`${head}: ${list.join(', ')}`, tag].filter(Boolean).join(', '));
  }
  if (!m.known) return `${p.label}, no value yet`;
  if (p.quiet) return speak([`${p.label}, ${p.quietWord ?? ratioWord(m.ratio)}`, tag].filter(Boolean).join(', '));
  const kind = p.goalKind ?? 'target';
  const goal = goalOf(p);
  const goalValue = isNum(p.goal) && p.goal > 0 ? p.goal : null;
  const bits = [valueOf(p as Pick<RadialTicksProps, 'value' | 'valueText' | 'unit' | 'decimals'>)];
  if (goal) bits.push(goalPhrase(kind, goal));
  const reached = goalValue ? reachedPhrase(kind, (p.value as number) / goalValue) : null;
  if (reached) bits.push(reached);
  if (tag) bits.push(tag);
  return speak(`${p.label}: ${bits.join(', ')}`);
}

/** The table twin of the ring: what the picture says, row by row (for the card's (i) panel, or `twin` under the ring). */
export function radialTwin(p: ModelProps & Pick<RadialTicksProps, 'label' | 'spoken' | 'quietWord' | 'valueText' | 'goalText' | 'unit' | 'decimals'>): TwinData {
  const m = radialModel(p);
  const caption = spokenRadial(p);
  const base = { title: `${p.label} table`, caption, fileName: twinFileName(p.label), rowNoun: ['row', 'rows'] as [string, string] };
  if (p.parts?.length) {
    return {
      ...base,
      head: ['Part', 'Score', 'Confidence'],
      rows: p.parts.map((part) => [part.label, isNum(part.value) ? formatNumber(part.value, 0) : '—', part.confidence ? `${part.confidence[0]!.toUpperCase()}${part.confidence.slice(1)}` : (part.needs ?? '—')]),
    };
  }
  const kind = p.goalKind ?? 'target';
  const goal = goalOf(p);
  const rows: Array<[string, string]> = [['Value', m.known ? valueOf(p as Pick<RadialTicksProps, 'value' | 'valueText' | 'unit' | 'decimals'>) : '—']];
  if (goal) rows.push([kind === 'floor' ? 'At least' : kind === 'limit' ? 'Limit' : 'Goal', goal]);
  if (m.known) rows.push([goal ? 'Share of goal' : 'Share of scale', `${formatNumber(Math.round(m.ratio * 100))}\u00a0%`]);
  return { ...base, head: ['Measure', 'Value'], rows };
}

/** How long the ticks of a sweep keep their delays: longer than the longest sweep (144 ticks × 14 ms), then they are dropped. */
const SWEEP_SETTLE_MS = 2400;

/**
 * The lit count each arc had before the latest change, or zero before first view, so the CSS can delay each tick by its
 * distance from where the sweep starts (a change sweeps only the ticks between old and new, never from zero). It is
 * derived during render (one commit carries both the new ticks and their delays) and settles to "no change" after the
 * sweep, so a settled ring's markup is the same whether it animated or not.
 */
function useSweepFrom(lits: number[], pending: boolean): number[] {
  const key = lits.join(',');
  const [s, setS] = useState({ key, cur: lits, from: pending ? lits.map(() => 0) : lits });
  if (s.key !== key) setS({ key, cur: lits, from: s.cur });
  const unsettled = s.from.join(',') !== s.cur.join(',');
  useEffect(() => {
    if (pending || !unsettled) return;
    const t = setTimeout(() => setS((x) => ({ ...x, from: x.cur })), SWEEP_SETTLE_MS);
    return () => clearTimeout(t);
  }, [pending, unsettled, s.cur]);
  return s.from;
}

const num = (n: number): string => n.toFixed(2);

export function RadialTicks(props: RadialTicksProps) {
  const { label, state = 'normal', hue, centre, quiet = false, animate, sweep, size, twin, legend = true, className } = props;
  const enabled = animate ?? sweep ?? true;
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref);
  const pending = enabled && !inView;
  const m = radialModel(props);
  const px = radialPx(size);
  const spoken = spokenRadial(props);
  // the ticks each arc had before this change: a change sweeps only the ticks between old and new (never from zero)
  const from = useSweepFrom(
    m.arcs.map((a) => a.lit),
    pending,
  );

  const loading = state === 'loading';
  const parts = !!props.parts?.length;
  const showValue = !quiet && m.known && !loading;
  const zero = m.known && m.ratio === 0;

  return (
    <div
      ref={ref}
      className={cx('lmz lmz-radial', className)}
      data-reveal={pending ? 'pending' : undefined}
      data-hue={hue}
      data-state={state}
      data-size={typeof size === 'string' ? size : 'md'}
      data-over={m.over || undefined}
      data-kind={props.goalKind ?? 'target'}
      data-parts={parts || undefined}
      style={{ '--lmz-size': `${px}px` } as CSSProperties}
    >
      <div className="lmz-radial__ring">
        <div
          className="lmz-radial__plot"
          role="meter"
          aria-label={label}
          aria-valuemin={showValue ? 0 : undefined}
          aria-valuemax={showValue ? m.scale : undefined}
          aria-valuenow={showValue ? Math.min(props.value as number, m.scale) : undefined}
          aria-valuetext={spoken}
          aria-busy={loading || undefined}
        >
          <svg viewBox={`0 0 ${RADIAL_VB} ${RADIAL_VB}`} aria-hidden="true" focusable="false">
            {m.band ? <path className="lmz-radial__band" d={arcPath(C, C, R_BAND, m.band[0], m.band[1])} /> : null}
            {m.pending ? <path className="lmz-radial__pending" d={arcPath(C, C, R_BAND, m.pending[0], Math.min(TAU - 0.001, m.pending[1]))} /> : null}
            {m.arcs.map((a, k) => {
              const prev = from[k] ?? 0;
              const delay = (i: number): number | undefined => (a.lit > prev ? (i >= prev && i < a.lit ? i - prev : undefined) : a.lit < prev ? (i >= a.lit && i < prev ? prev - 1 - i : undefined) : undefined);
              const lapBase = Math.max(0, a.count - prev);
              return (
                <g key={a.id} data-arc={a.id} data-hue={a.hue} data-missing={a.missing || undefined} data-low={a.low || undefined}>
                  {a.missing ? <path className="lmz-radial__missing" d={arcPath(C, C, R_MISSING, a.start, a.end)} /> : null}
                  {a.missing
                    ? null
                    : a.ticks.map((t) => {
                        const len = Math.min(MAX_TICK_LEN, (t.mark ? LEN.mark : t.major ? LEN.major : LEN.minor) * (px < SMALL_PX ? SMALL_TICK_SCALE : 1));
                        const [x1, y1] = polar(C, C, R_OUT - len, t.angle);
                        const [x2, y2] = polar(C, C, R_OUT, t.angle);
                        const d = delay(t.i);
                        const style = { '--i': t.i, ...(d === undefined ? null : { '--d': d }), ...(t.partial > 0 ? { '--p': Number(t.partial.toFixed(2)) } : null) } as CSSProperties;
                        return (
                          <line
                            key={t.i}
                            className="lmz-radial__t"
                            x1={num(x1)}
                            y1={num(y1)}
                            x2={num(x2)}
                            y2={num(y2)}
                            style={style}
                            data-lit={t.lit || undefined}
                            data-partial={t.partial > 0 || undefined}
                            data-major={t.major || undefined}
                            data-mark={t.mark || undefined}
                            data-edge={t.edge || undefined}
                            data-zero={(zero && t.i === 0 && !parts) || undefined}
                          />
                        );
                      })}
                  {a.lapOn && px >= SMALL_PX
                    ? a.ticks.map((t) => {
                        const [x1, y1] = polar(C, C, LAP_R.from, t.angle);
                        const [x2, y2] = polar(C, C, LAP_R.to, t.angle);
                        return <line key={t.i} className="lmz-radial__lap" x1={num(x1)} y1={num(y1)} x2={num(x2)} y2={num(y2)} style={{ '--d': lapBase + t.i } as CSSProperties} data-lit={t.i < a.lap || undefined} />;
                      })
                    : null}
                </g>
              );
            })}
          </svg>
        </div>
        {centre ? (
          <div className="lmz-radial__centre" aria-hidden="true">
            {centre}
          </div>
        ) : null}
      </div>
      {parts && legend ? (
        <ul className="lmz-radial__legend" aria-hidden="true">
          {m.arcs.map((a) => (
            <li key={a.id} data-hue={a.hue} data-missing={a.missing || undefined}>
              <i className="lmz-radial__dot" />
              <MonoMeta size="sm">{a.label}</MonoMeta>
              {showValue && !a.missing ? <span className="lmz-radial__legendv">{formatNumber(props.parts!.find((x) => x.id === a.id)!.value as number, 0)}</span> : null}
              {a.missing && a.needs ? <MonoMeta size="sm">{quiet ? quietNeeds(a.needs) : a.needs}</MonoMeta> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {twin === true ? quiet ? null : <InlineTwin data={radialTwin(props)} /> : twin === false || twin == null ? null : twin}
    </div>
  );
}
