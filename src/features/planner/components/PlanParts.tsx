import { StatusMark, Tooltip, cx, energyInText } from '@/components';
import type { GoalFeasibility, GoalScore, PlanOption, RankedGoal } from '@/engine/planner/domain/types';
import { useEnergyUnit, type EnergyUnit, type UnitSystem } from '@/state/settingsStore';
import { goalMetric, ladderTolerance } from '../catalogue';
import { fmtChange, fmtKcal, fmtMetric, fmtMetricRange, fmtPct, fmtSignedRange } from '../format';
import { phaseBalance, phaseKcal, type PhaseFact } from '../planFacts';

/* ------------------------------------------------------------------------------------- phase timeline */

export interface PhaseTimelineProps {
  phases: readonly PhaseFact[];
  days: number;
  size?: 'card' | 'detail';
  /** Week scale under the strip (detail). */
  scale?: boolean;
}

/**
 * The phase tooltip: the engine's phase name (it carries the planner's %), its weeks, the engine-% balance words only when
 * the name does not state them, and the mean planned balance a day in the Settings energy unit. Never a % of the UI's own.
 */
export function phaseTip(p: PhaseFact, energy: EnergyUnit): string {
  const kcal = phaseKcal(p, energy);
  const parts = [energyInText(p.name, energy), `weeks ${Math.floor(p.startDay / 7) + 1}–${Math.ceil(p.endDay / 7)}`, phaseBalance(p), kcal ? `${kcal} a day` : null];
  const maint = Number.isFinite(p.maintKcal) ? ` (maintenance ${fmtKcal(p.maintKcal, energy)} at this plan’s activity)` : '';
  return `${parts.filter(Boolean).join(' · ')}${maint}`;
}

/** Phase strip (COMPONENTS §8): energy tints, 2 px surface gaps, names inside when they fit (never clipped into another meaning). */
export function PhaseTimeline({ phases, days, size = 'card', scale = false }: PhaseTimelineProps) {
  const energy = useEnergyUnit();
  const weeks = Math.round(days / 7);
  return (
    <div className="lp-phases" data-size={size}>
      <ol
        className="lp-phases__strip"
        aria-label={`Phases: ${phases.map((p) => [energyInText(p.name, energy), `weeks ${Math.floor(p.startDay / 7) + 1} to ${Math.ceil(p.endDay / 7)}`, phaseBalance(p)].filter(Boolean).join(', ')).join('; ')}`}
      >
        {phases.map((p, i) => {
          const w = ((p.endDay - p.startDay) / days) * 100;
          // the engine's balance words, only where the engine's name does not already say them
          const bal = phaseBalance(p);
          return (
            <Tooltip key={`${p.startDay}-${i}`} content={phaseTip(p, energy)}>
              <li className="lp-phases__seg" data-tone={p.tone} style={{ flexBasis: `${w}%` }} tabIndex={size === 'detail' ? 0 : -1}>
                <span className="lp-phases__label">
                  <span className="lp-phases__name">{energyInText(p.name, energy)}</span>
                  {size === 'detail' ? (
                    <span className="lp-phases__sub">
                      {bal ? <span className="lp-phases__bal">{bal} · </span> : null}
                      <span className="lp-phases__wk">wk {Math.floor(p.startDay / 7) + 1}–{Math.ceil(p.endDay / 7)}</span>
                    </span>
                  ) : null}
                </span>
              </li>
            </Tooltip>
          );
        })}
      </ol>
      {scale ? (
        <div className="lp-phases__scale" aria-hidden="true">
          {Array.from({ length: weeks + 1 }, (_, i) => i)
            .filter((i) => i === 0 || i === weeks || i % (weeks > 16 ? 4 : 2) === 0)
            .map((i) => (
              <span key={i} style={{ left: `${(i / weeks) * 100}%` }} data-edge={i === 0 ? 'start' : i === weeks ? 'end' : undefined}>
                {i === 0 ? 'wk 1' : i}
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ scorecard */

export type ScoreStatus = 'reached' | 'partial' | 'missed' | 'unachievable' | 'near' | 'directional';

export interface ScoreView {
  status: ScoreStatus;
  word: string;
  value: string;
  detail: string | null;
}

/** Status glyph: check (reached), half disc (partial), open circle (not reachable). Never colour alone. */
export function StatusGlyph({ status }: { status: ScoreStatus }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false } as const;
  if (status === 'reached' || status === 'near')
    return (
      <svg {...common} className="lp-glyph" data-status={status}>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.2 8.2l1.9 1.9 3.8-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === 'partial' || status === 'directional')
    return (
      <svg {...common} className="lp-glyph" data-status={status}>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...common} className="lp-glyph" data-status={status}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={status === 'unachievable' ? '2 2' : undefined} />
    </svg>
  );
}

/** Must-strength goals carry a tolerance below the ladder (request.ts `toleranceFor`). */
export const isMustGoal = (tolerance: number | undefined, rank: number): boolean => tolerance !== undefined && tolerance < ladderTolerance(rank);

/** A "keep" goal: a change target of zero (Goals "keep"; `goalText` reads "keep"). */
export const isKeepGoal = (goal: Pick<RankedGoal, 'target' | 'targetKind'> | undefined): boolean => goal?.targetKind === 'change' && goal.target === 0;

/** "Near its best" on the number the scorecard prints (the engine's % of what is achievable, engine rounding). */
export const nearBest = (sc: Pick<GoalScore, 'percentOfAchievable'>): boolean => Math.round(sc.percentOfAchievable) >= 90;

export interface Verdict {
  status: ScoreStatus;
  word: string;
}

/**
 * The verdict on one goal, from the planner's own fields only: its `verdict` ('reached' | 'kept' | 'notReached', one
 * word for every place that shows the goal; `met` for results from before the field), the goal's feasibility status and
 * must-strength; goals without a target by the engine's % of what is achievable. The same function words the cards,
 * the text export and the headline.
 */
export function goalVerdict(sc: GoalScore, feas: GoalFeasibility | undefined, must: boolean, keep: boolean): Verdict {
  if (sc.verdict === 'kept') return { status: 'reached', word: 'kept' };
  if (sc.verdict === 'reached') return { status: 'reached', word: 'reached' };
  if (sc.target !== null && sc.met !== null) {
    if (sc.met && sc.verdict !== 'notReached') return { status: 'reached', word: keep ? 'kept' : 'reached' };
    if (must) return { status: 'unachievable', word: keep ? 'not kept' : 'not achievable' };
    if (feas?.status === 'unattainable' || feas?.status === 'attainableAloneNotJointly') return { status: 'missed', word: keep ? 'not kept' : 'not reachable' };
    return { status: 'partial', word: keep ? 'not kept' : 'partial' };
  }
  return nearBest(sc) ? { status: 'near', word: 'near its best' } : { status: 'directional', word: 'partial' };
}

/**
 * A scorecard row with its likely range: the engine's functional band when present, else the option's daily ensemble
 * band at the end of the plan (end-value goals only). Never a catalogue fallback range.
 */
export function withBand(sc: GoalScore, option: Pick<PlanOption, 'bands'>, functional?: 'end' | 'mean' | null): GoalScore {
  if (sc.band || functional === 'mean') return sc;
  const b = option.bands?.series[sc.metric as keyof NonNullable<PlanOption['bands']>['series']];
  const last = b ? b.p10.length - 1 : -1;
  if (!b || last < 0 || !Number.isFinite(b.p10[last]!) || !Number.isFinite(b.p90[last]!)) return sc;
  return { ...sc, band: { p10: b.p10[last]!, p50: b.p50[last] ?? sc.value, p90: b.p90[last]!, pTargetMet: null } };
}

export function scoreView(
  sc: GoalScore,
  feas: GoalFeasibility | undefined,
  units: UnitSystem,
  weeks: number,
  must: boolean,
  goal: Pick<RankedGoal, 'target' | 'targetKind'> | undefined,
  energy: EnergyUnit = 'kcal',
): ScoreView {
  const changeGoal = goal?.targetKind === 'change';
  const changeText = fmtChange(sc.metric, sc.start, sc.value, units, energy);
  const valueText = changeGoal ? changeText : fmtMetric(sc.metric, sc.value, units, { energy });
  let detail: string | null = null;
  if (sc.band) {
    const lo = changeGoal ? sc.band.p10 - sc.start : sc.band.p10;
    const hi = changeGoal ? sc.band.p90 - sc.start : sc.band.p90;
    // "lose" goals read as magnitudes ("−10.4 kg, likely 9.1–11.0"); any other change keeps its sign so a keep/gain goal
    // that ends below its start never shows a positive-looking range next to a negative value.
    const loseGoal = changeGoal && sc.target !== null && sc.target < sc.start;
    const range = loseGoal && lo < 0 && hi < 0 ? fmtMetricRange(sc.metric, -hi, -lo, units, energy) : fmtSignedRange(sc.metric, lo, hi, units, energy);
    const p = sc.band.pTargetMet;
    // a kept goal is held by definition of its tolerance: its ensemble "chance" of an exact zero change (often 0 %)
    // would contradict the verdict, so it reads the planner's % of what is achievable instead (100 for a held goal)
    const kept = sc.verdict === 'kept';
    const tail = kept
      ? ` · ${fmtPct(sc.percentOfAchievable)} of what’s possible`
      : p !== null && Number.isFinite(p)
        ? ` · ${fmtPct(p <= 1 ? p * 100 : p)} chance`
        : '';
    detail = `likely ${range}${tail}`;
  } else if (sc.verdict === 'kept') detail = `${fmtPct(sc.percentOfAchievable)} of what’s possible`;
  const v = goalVerdict(sc, feas, must, isKeepGoal(goal));
  if (sc.target !== null && sc.met !== null) {
    if (v.status === 'reached') return { ...v, value: valueText, detail };
    if (v.status === 'unachievable') return { ...v, value: valueText, detail: feas?.text || detail };
    if (v.status === 'missed') {
      const need = feas?.requiredWeeks ? `about ${Math.ceil(feas.requiredWeeks)} weeks needed` : null;
      return { ...v, value: valueText, detail: [`in ${weeks} weeks`, detail, need].filter(Boolean).join(' · ') || null };
    }
    return { ...v, value: valueText, detail: detail ?? (sc.percentOfTarget !== null ? `${fmtPct(sc.percentOfTarget)} of the target` : null) };
  }
  // the engine's % as it prints it everywhere (option explanation, run view): same rounding, not clamped
  return { ...v, value: `${fmtPct(sc.percentOfAchievable)} of what’s possible`, detail: `${changeText}${detail ? ` · ${detail}` : ''}` };
}

export function ScoreRow({ sc, view, goalLabel }: { sc: GoalScore; view: ScoreView; goalLabel: string }) {
  const m = goalMetric(sc.metric);
  return (
    <li className="lp-score" data-status={view.status}>
      <span className="lp-score__rank lm-num">{sc.goal + 1}</span>
      <span className="lp-score__goal">
        <span className="lp-score__name">{m?.label ?? sc.label}</span>
        <span className="lp-score__what"> {goalLabel}</span>
      </span>
      <span className="lp-score__status">
        <StatusGlyph status={view.status} />
        <span>{view.word}</span>
      </span>
      <span className="lp-score__value lm-num">{view.value}</span>
      {view.detail ? <span className="lp-score__detail">{view.detail}</span> : null}
    </li>
  );
}

/* --------------------------------------------------------------------------------------------- safety */

const GENERIC_RE = /model projections|not medical advice/i;
const RANK = { danger: 0, caution: 1, info: 2 } as const;

export type PlanSafetyItem = NonNullable<PlanOption['safetyItems']>[number];

/**
 * The option's safety items by the engine's own severity (danger, caution, then info; the engine's order within each),
 * without the generic disclaimer (shown elsewhere) and without repeats. Older results without `safetyItems` show their
 * plain notes as information.
 */
export function safetyItemsOf(option: Pick<PlanOption, 'safetyItems' | 'safetyNotes'>): PlanSafetyItem[] {
  const items: PlanSafetyItem[] = option.safetyItems ?? option.safetyNotes.map((text) => ({ text, severity: 'info' as const }));
  const seen = new Set<string>();
  return items
    .filter((i) => !GENERIC_RE.test(i.text) && !seen.has(i.text) && (seen.add(i.text), true))
    .map((i, n) => ({ i, n }))
    .sort((a, b) => RANK[a.i.severity] - RANK[b.i.severity] || a.n - b.n)
    .map((x) => x.i);
}

/** Counts per severity for the card's safety line. */
export function safetyCounts(items: readonly PlanSafetyItem[]): { danger: number; caution: number; info: number } {
  const c = { danger: 0, caution: 0, info: 0 };
  for (const i of items) c[i.severity]++;
  return c;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SafetyLine({ option, onOpen }: { option: Pick<PlanOption, 'safetyItems' | 'safetyNotes'>; onOpen?: () => void }) {
  const c = safetyCounts(safetyItemsOf(option));
  const flagged = c.danger + c.caution;
  const text = flagged
    ? [c.danger ? plural(c.danger, 'danger', 'dangers') : null, c.caution ? plural(c.caution, 'caution', 'cautions') : null].filter(Boolean).join(', ')
    : `within safety limits${c.info ? ` · ${plural(c.info, 'note', 'notes')}` : ''}`;
  const body = (
    <>
      <StatusMark severity={c.danger ? 'danger' : c.caution ? 'caution' : 'ok'} size={16} />
      <span>{text}</span>
    </>
  );
  return onOpen && (flagged || c.info) ? (
    <button type="button" className={cx('lp-safety-line', 'lp-safety-line--btn')} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <p className="lp-safety-line">{body}</p>
  );
}
