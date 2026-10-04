/**
 * Goal meter (ring-pages.md §7.5.1): a printed horizontal scale (the ScaleSlider look without a thumb). Domain
 * 0 → max(goal × 1.25, value × 1.05); minor ticks at 10 % of the goal, majors with numerals at 0, ½ goal and the goal;
 * the goal tick is taller and labelled "goal 8 000"; the value is a 6 px performance-hue bar from 0 with a rounded end
 * and the readout at the right. Over the goal the bar simply runs past the goal tick (no colour change). No goal: no goal
 * tick, the scale runs to value × 1.25 and a line says so. Nothing read: an empty well and "no data yet today".
 * `mini` (the Ring page's today row): 120 px wide, 4 px bar, no numerals, the goal tick only, a text summary for
 * assistive technology.
 */
import { formatNumber, THIN_SPACE } from '@/components/lib/format';
import { ACTIVITY_COPY as C } from './copyActivity';
import { goalMeterMax, goalMeterTicks } from './activityModels';
import './activity.css';

export interface GoalMeterProps {
  /** "steps" / "active minutes" / "active energy". */
  label: string;
  /** null = nothing read (empty well, "no data yet today"). */
  value: number | null;
  /** Absent = no goal set (no goal tick; scale to value × 1.25). */
  goal?: number;
  /** Unit word after the readout ("steps", "min", "kcal"). */
  unit: string;
  /** Ring page row: 120 px wide, 4 px bar, no numerals, goal tick only. */
  mini?: boolean;
  /** What a missing value says (default "no data yet today"; a past day says "no data for this day"). */
  missingText?: string;
}

export function GoalMeter({
  label,
  value,
  goal,
  unit,
  mini = false,
  missingText = C.noDataToday,
}: GoalMeterProps) {
  const g = goal !== undefined && Number.isFinite(goal) && goal > 0 ? goal : undefined;
  const v = value !== null && Number.isFinite(value) ? Math.max(0, value) : null;
  const max = goalMeterMax(v, g);
  const at = (x: number): number => (max > 0 ? Math.min(100, Math.max(0, (x / max) * 100)) : 0);
  const summary = C.meterSummary(label, v, unit, g, missingText);
  // a recorded 0 draws nothing above the well's floor; only a positive value has a bar
  const bar = v !== null && v > 0 ? <span className="ac-meter__bar" style={{ width: `${at(v)}%` }} /> : null;
  const goalTick =
    g !== undefined ? (
      <span className="ac-meter__goal" data-goal="true" style={{ left: `${at(g)}%` }} />
    ) : null;

  if (mini) {
    return (
      <span
        className="ac-meter"
        data-mini="true"
        data-missing={v === null || undefined}
        role="img"
        aria-label={summary}
      >
        <span className="ac-meter__well">
          {bar}
          {goalTick}
        </span>
      </span>
    );
  }

  const ticks = goalMeterTicks(max, g);
  const goalPct = g !== undefined ? at(g) : 0;
  // numerals that would collide with the goal label are left out (the scale still prints their ticks)
  const numerals = ticks.filter((t) => {
    if (!t.numeral) return false;
    if (g === undefined) return true;
    if (t.v === 0) return goalPct >= 15;
    return goalPct >= 40;
  });
  return (
    <div className="ac-meter" data-missing={v === null || undefined}>
      <div className="ac-meter__top">
        <span className="lm-eng">{label}</span>
        <span className="ac-meter__value">
          {v === null ? (
            <span className="ac-meter__none">{missingText}</span>
          ) : (
            <>
              {formatNumber(v)}
              {THIN_SPACE}
              <span className="ac-meter__unit">{unit}</span>
            </>
          )}
        </span>
      </div>
      <div className="ac-meter__well" role="img" aria-label={summary}>
        {ticks.length ? (
          <svg
            className="ac-meter__ticks"
            viewBox="0 0 1000 20"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {ticks
              .filter((t) => !t.goal)
              .map((t) => (
                <line
                  key={t.v}
                  x1={at(t.v) * 10}
                  x2={at(t.v) * 10}
                  y1={0}
                  y2={t.major ? 9 : 5}
                  data-major={t.major || undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          </svg>
        ) : null}
        {bar}
        {goalTick}
      </div>
      {numerals.length || g !== undefined ? (
        <div className="ac-meter__nums" aria-hidden="true">
          {numerals.map((t) => {
            const p = at(t.v);
            return (
              <span
                key={t.v}
                style={{ left: `${p}%` }}
                data-edge={p <= 0.5 ? 'start' : p >= 99.5 ? 'end' : undefined}
              >
                {formatNumber(t.v, Number.isInteger(t.v) ? 0 : 1)}
              </span>
            );
          })}
          {g !== undefined ? (
            <span
              data-goal="true"
              style={{ left: `${goalPct}%` }}
              data-edge={goalPct >= 85 ? 'end' : undefined}
            >
              {C.goalTick(g)}
            </span>
          ) : null}
        </div>
      ) : null}
      {g === undefined ? <p className="ac-meter__note">{C.noGoal}</p> : null}
    </div>
  );
}
