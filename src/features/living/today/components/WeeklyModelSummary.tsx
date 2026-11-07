import { useId } from 'react';
import { formatEnergy, formatNumber, formatSigned } from '@/components';
import { useEnergyUnit, useSettingsStore } from '@/state/settingsStore';
import type { WeeklyModelReview } from '@/living/weeklyModel';
import { fmtDateRange } from '../../format';

const DECISION: Record<WeeklyModelReview['decision'], string> = {
  keep: 'Keep this week’s target',
  provisional: 'Target awaiting calibration',
  changeReady: 'Weekly change ready',
  review: 'Review this week’s target',
};

/** One adopted calorie target and its modeled trade-off. Opening this view never changes a prescription. */
export function WeeklyModelSummary({ model, quiet = false }: { model: WeeklyModelReview; quiet?: boolean }) {
  const title = useId();
  const unit = useEnergyUnit();
  const imperial = useSettingsStore((s) => s.units) === 'imperial';
  const mass = (kg: number) =>
    `${formatSigned(kg * (imperial ? 2.2046226218 : 1), 1)} ${imperial ? 'lb' : 'kg'}`;
  const energy = (v: number | null) =>
    v === null ? 'Unavailable' : formatEnergy(v, unit, { step: unit === 'kJ' ? 50 : 10 });
  const budget = model.muscleBudget;
  return (
    <section className="lv-checkin__part lv-weekly-model" aria-labelledby={title}>
      <h3 id={title} className="lm-h3">
        Next week
      </h3>
      <p className="lv-weekly-model__decision" data-state={model.decision}>
        {DECISION[model.decision]}
      </p>
      <p className="lv-checkin__next">{fmtDateRange(model.from, model.to)}</p>
      {!quiet ? (
        <dl className="lv-weekly-model__facts">
          <div>
            <dt>Daily average target</dt>
            <dd>{energy(model.targetKcal)}</dd>
          </div>
          <div>
            <dt>Estimated burn</dt>
            <dd>{energy(model.expenditureKcal)}</dd>
          </div>
          <div>
            <dt>
              {model.deficitKcal !== null && model.deficitKcal < 0
                ? 'Estimated surplus'
                : 'Estimated deficit'}
            </dt>
            <dd>{energy(model.deficitKcal === null ? null : Math.abs(model.deficitKcal))}</dd>
          </div>
          <div>
            <dt>Modeled fat change</dt>
            <dd>{model.fatChangeKg === null ? 'Unavailable' : mass(model.fatChangeKg)}</dd>
          </div>
        </dl>
      ) : null}
      {!quiet &&
      model.targetRangeKcal &&
      Math.abs(model.targetRangeKcal[1] - model.targetRangeKcal[0]) >= 1 ? (
        <p className="lv-checkin__text">
          Day targets {energy(model.targetRangeKcal[0])}–{energy(model.targetRangeKcal[1])}; follow each day’s
          prescription.
        </p>
      ) : null}
      {budget ? (
        <p className="lv-checkin__text">
          {quiet
            ? 'Whole-plan muscle-loss budget'
            : `${formatNumber(budget.maxLossPct, 1)}% whole-plan muscle-loss budget`}
          {' · '}
          {budget.status === 'unavailable' ? (
            'Forecast incomplete'
          ) : (
            <>
              {budget.status === 'overBudget' ? 'Review needed' : quiet ? 'Within the modeled budget' : null}
              {!quiet ? (
                <>
                  {budget.status === 'overBudget' ? ' · ' : ''}
                  {formatNumber(budget.lowerScenarioLossPct ?? budget.worstLossPct ?? 0, 1)}% loss in the
                  lower scenario
                </>
              ) : null}
            </>
          )}
        </p>
      ) : null}
      {model.decision === 'provisional' && !quiet ? (
        <p className="lv-checkin__text">
          {model.reason === 'missingForecast'
            ? 'An updated forecast is needed for this target.'
            : `${model.evidence.weighIns} recent weigh-ins · complete food days ${model.evidence.foodDays7}/7 this week, ${model.evidence.foodDaysPrevious7}/7 last week`}
        </p>
      ) : null}
      {model.decision === 'changeReady' ? (
        <p className="lv-checkin__text">The target above stays in place until you apply the change below.</p>
      ) : null}
      <p className="lv-weekly-model__basis">
        {budget
          ? 'Budget fixed to starting modeled skeletal muscle across the whole plan.'
          : 'Target from your adopted plan; burn and body changes are modeled.'}
      </p>
    </section>
  );
}
