import { useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Checkbox, Faceplate, Key, KeyBank, ScaleRange, ScaleSlider, Section, Stepper, Switch, formatNumber } from '@/components';
import type { CardioModality } from '@/engine/types/schedule';
import type { Weekday } from '@/engine/planner/domain/types';
import type { ConstraintDraft, HungerTolerance, LongestFast } from '@/state/plannerStore';
import { useEnergyUnit, type EnergyUnit } from '@/state/settingsStore';
import { fmtClock, fmtKcal, fmtKcalValue, fmtSteps } from '../format';
import { LONGEST_FAST_OPTIONS } from '../request';

/** Local value while dragging, committed to the store on release (no localStorage write per frame). */
const same = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => Object.is(x, b[i])) : Object.is(a, b);

function useLive<T>(stored: T): [T, (v: T) => void] {
  const [s, setS] = useState({ stored, live: stored });
  // a changed stored value (commit, reset, import) replaces the local one — React's "adjust state on prop change" pattern
  const changed = !same(s.stored, stored);
  if (changed) setS({ stored, live: stored });
  return [changed ? stored : s.live, (live: T) => setS({ stored, live })];
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const WEEKDAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Levers the user can refuse (registry ids, dossier 13 §4C / 18 §4.4.1 / 21 §4J). */
export const EXCLUDABLE: ReadonlyArray<{ id: string; label: string; help?: string | ((energy: EnergyUnit) => string); group: 'days' | 'phases' | 'extras' }> = [
  { id: 'lowDays', label: 'Low-energy days', help: (e) => `Two days a week at ${fmtKcalValue(500, e)}–${fmtKcal(700, e)}`, group: 'days' },
  { id: 'refeedDay', label: 'Refeed days', help: 'Higher-carbohydrate days at maintenance inside a deficit', group: 'days' },
  { id: 'dietBreak', label: 'Diet breaks', help: 'One or two weeks at maintenance between deficit blocks', group: 'days' },
  { id: 'B2', label: 'Very-low-carbohydrate phases', help: 'Net carbohydrate 20–50 g a day', group: 'phases' },
  { id: 'B6', label: 'Very-low-fat phases', help: 'High carbohydrate, fat kept low', group: 'phases' },
  { id: 'B3', label: 'Short, hard deficits', help: 'A few weeks at a larger deficit with lifting', group: 'phases' },
  { id: 'L7', label: 'Creatine', help: '3–5 g a day with training; adds about 1 kg of water', group: 'extras' },
  { id: 'L8', label: 'Omega-3 capsules', help: '2–3 g EPA + DHA a day', group: 'extras' },
  { id: 'L9', label: 'Fibre supplement', help: 'Psyllium or oat beta-glucan before meals', group: 'extras' },
  { id: 'L2', label: 'Walks after meals', help: '5–15 minutes of light walking', group: 'extras' },
];

const MODALITIES: ReadonlyArray<{ value: CardioModality; label: string }> = [
  { value: 'walk', label: 'Walk' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'run', label: 'Run' },
  { value: 'swim', label: 'Swim' },
  { value: 'row', label: 'Row' },
];

export interface LimitsPanelProps {
  c: ConstraintDraft;
  onChange: (patch: Partial<ConstraintDraft>) => void;
  onReset?: () => void;
  /** Some limits differ from Habits (shows "Reset to my habits"). */
  customised: boolean;
  /** Longest fast the safety screening allows, h (longer options are off). */
  safetyMaxFastH: number;
  /** The fasting and short-window opt-ins (FastingTierControls), under the "Longest fast" bank they unlock. */
  fastingControls?: ReactNode;
  disabled?: boolean;
}

/**
 * Practical limits (planner-goals.md §6, COMPONENTS §8 `<Constraints>`): training, eating, fasting, nutrient floors
 * and what to leave out. Changes apply immediately and re-evaluate the "Before you run" hints.
 */
export function LimitsPanel({ c, onChange, onReset, customised, safetyMaxFastH, fastingControls, disabled }: LimitsPanelProps) {
  const energy = useEnergyUnit();
  const [train, setTrain] = useLive<readonly [number, number]>(c.trainingDays);
  const [cardio, setCardio] = useLive<readonly [number, number]>(c.cardioDays);
  const [eat, setEat] = useLive<readonly [number, number]>([c.earliestH, c.latestH]);
  const [meals, setMeals] = useLive<readonly [number, number]>(c.mealsPerDay);
  const [steps, setSteps] = useLive<readonly [number, number]>(c.steps);
  const [time, setTime] = useLive(c.trainingTimeH);
  const [protein, setProtein] = useLive(c.proteinFloor ?? 1.2);
  const [muscleLoss, setMuscleLoss] = useLive(c.maxMuscleLossPct ?? 5);
  const days = new Set(c.trainingWeekdays);

  const toggleDay = (d: Weekday) => {
    const next = new Set(days);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange({ trainingWeekdays: [...next].sort((a, b) => a - b) as Weekday[] });
  };
  const fastOptions = LONGEST_FAST_OPTIONS.map((h) => ({
    value: String(h) as `${LongestFast}`,
    label: `${h} h`,
    disabled: disabled || h > Math.max(12, safetyMaxFastH),
  }));

  const toggleExcluded = (id: string, on: boolean) => {
    const set = new Set(c.excluded);
    if (on) set.add(id);
    else set.delete(id);
    onChange({ excluded: [...set].sort() });
  };

  return (
    <Faceplate
      title="Practical limits"
      className="lp-limits"
      actions={
        customised && onReset ? (
          <Key size="sm" variant="quiet" icon={RotateCcw} onClick={onReset} disabled={disabled}>
            Reset to my habits
          </Key>
        ) : undefined
      }
    >
      <div className="lp-limits__body">
        <Section label="Training">
          <ScaleRange
            label="Resistance training days a week"
            value={train}
            onChange={setTrain}
            onCommit={(v) => onChange({ trainingDays: [v[0], v[1]] })}
            min={0}
            max={6}
            step={1}
            minGap={0}
            majorStep={1}
            format={(v) => formatNumber(v, 0)}
            valueText={(v, w) => `${w === 'low' ? 'at least' : 'at most'} ${v} days`}
            thumbLabels={['fewest days', 'most days']}
            disabled={disabled}
          />
          <fieldset className="lp-days" disabled={disabled}>
            <legend className="lp-label">Days I can train</legend>
            {/* a 7-segment multi-select in the selector's language: on is the gold tile, off is plain (r068 PG5) */}
            <div className="lp-days__keys">
              {WEEKDAY_LABEL.map((l, d) => (
                <button
                  key={l}
                  type="button"
                  className="lp-days__key"
                  aria-pressed={days.has(d as Weekday)}
                  onClick={() => toggleDay(d as Weekday)}
                  aria-label={WEEKDAY_NAME[d]}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="lp-limits__pair">
            <ScaleSlider
              label="Usual training time"
              size="sm"
              value={time}
              onChange={setTime}
              onCommit={(v) => onChange({ trainingTimeH: v })}
              min={5}
              max={22}
              step={0.5}
              majorStep={3}
              minorStep={1}
              format={fmtClock}
              valueText={(v) => `training at ${fmtClock(v)}`}
              disabled={disabled}
            />
            <div className="lp-field">
              <span className="lp-label" id="lp-session-l">
                Longest session
              </span>
              <Stepper
                name="longest session"
                value={c.maxSessionMin}
                onChange={(v) => onChange({ maxSessionMin: v })}
                min={20}
                max={150}
                step={5}
                unit="min"
                unitText="minutes"
                disabled={disabled}
              />
            </div>
          </div>
          <ScaleRange
            label="Cardio days a week"
            value={cardio}
            onChange={setCardio}
            onCommit={(v) => onChange({ cardioDays: [v[0], v[1]] })}
            min={0}
            max={6}
            step={1}
            minGap={0}
            majorStep={1}
            format={(v) => formatNumber(v, 0)}
            valueText={(v, w) => `${w === 'low' ? 'at least' : 'at most'} ${v} cardio days`}
            disabled={disabled}
          />
          <div className="lp-limits__pair">
          <div className="lp-field">
            <span className="lp-label" id="lp-cardio-l">
              Cardio I’d do
            </span>
            <KeyBank labelledBy="lp-cardio-l" size="sm" value={c.cardioModality} onChange={(v) => onChange({ cardioModality: v })} options={MODALITIES.map((m) => ({ ...m, disabled }))} />
          </div>
          <div className="lp-field">
            <span className="lp-label">Longest cardio session</span>
            <Stepper name="longest cardio session" value={Math.min(c.maxCardioSessionMin ?? 90, c.maxSessionMin)} onChange={(v) => onChange({ maxCardioSessionMin: v })} min={5} max={Math.min(90, c.maxSessionMin)} step={5} unit="min" unitText="minutes" disabled={disabled} />
          </div>
          </div>
          <ScaleRange
            label="Steps outside cardio"
            value={steps}
            onChange={setSteps}
            onCommit={(v) => onChange({ steps: [v[0], v[1]] })}
            min={2000}
            max={20000}
            step={500}
            minGap={1000}
            majorStep={4000}
            minorStep={1000}
            labels={[2000, 6000, 10000, 14000, 18000].map((v) => ({ value: v, label: `${v / 1000}k` }))}
            format={(v) => fmtSteps(v, true)}
            valueText={(v, w) => `${w === 'low' ? 'at least' : 'at most'} ${v} steps outside planned cardio`}
            disabled={disabled}
          />
          <p className="lp-field__hint">Walking or running sessions in the plan add to this step target.</p>
        </Section>

        <Section label="Eating">
          <ScaleRange
              label="Eating between"
              value={eat}
              onChange={setEat}
              onCommit={(v) => onChange({ earliestH: v[0], latestH: v[1] })}
              min={5}
              max={24}
              step={0.5}
              minGap={4}
              majorStep={3}
              minorStep={1}
              labels={[6, 9, 12, 15, 18, 21, 24].map((v) => ({ value: v, label: String(v % 24).padStart(2, '0') }))}
              format={fmtClock}
              valueText={(v, w) => `${w === 'low' ? 'first meal from' : 'last meal by'} ${fmtClock(v)}`}
            thumbLabels={['earliest first meal', 'latest last meal']}
            disabled={disabled}
          />
          <ScaleRange
            label="Meals a day"
            value={meals}
            onChange={setMeals}
            onCommit={(v) => onChange({ mealsPerDay: [v[0], v[1]] })}
            min={2}
            max={6}
            step={1}
            minGap={0}
            majorStep={1}
            format={(v) => formatNumber(v, 0)}
            valueText={(v, w) => `${w === 'low' ? 'at least' : 'at most'} ${v} meals`}
            disabled={disabled}
          />
          <div className="lp-field">
            <span className="lp-label" id="lp-fast-l">
              Longest fast I’d do
            </span>
            <KeyBank
              labelledBy="lp-fast-l"
              size="sm"
              block
              value={String(c.longestFastH) as `${LongestFast}`}
              onChange={(v) => onChange({ longestFastH: Number(v) as LongestFast })}
              options={fastOptions}
            />
            {/* r068 W2-16: a greyed option says why */}
            {fastOptions.some((o) => o.disabled) && !disabled ? (
              <span className="lp-field__hint">
                {LONGEST_FAST_OPTIONS.filter((h) => h > Math.max(12, safetyMaxFastH))
                  .map((h) => `${h} h`)
                  .join(' and ')}{' '}
                {fastingControls ? 'need “Allow fasts over 24 hours” below.' : 'are off under your safety answers.'}
              </span>
            ) : null}
          </div>
          {/* the preference only matters once fasting days are allowed (24 h and longer) */}
          {c.longestFastH >= 24 ? (
            <div className="lm-safety-row lp-switchrow">
              <div className="lm-safety-row__text">
                <span className="lm-safety-row__label" id="lp-prefer-fast-l">
                  I’d like fasting to be part of the plan
                </span>
              </div>
              <Switch
                labelledBy="lp-prefer-fast-l"
                checked={c.prefersFasting}
                onChange={(v) => onChange({ prefersFasting: v })}
                disabled={disabled}
              />
            </div>
          ) : null}
          {fastingControls ? <div className="lp-limits__optins">{fastingControls}</div> : null}
          <div className="lp-field">
            <span className="lp-label" id="lp-hunger-l">
              Hunger I can live with
            </span>
            <KeyBank<HungerTolerance>
              labelledBy="lp-hunger-l"
              size="sm"
              value={c.hungerTolerance}
              onChange={(v) => onChange({ hungerTolerance: v })}
              options={[
                { value: 'low', label: 'Little', disabled },
                { value: 'medium', label: 'Some', disabled },
                { value: 'high', label: 'A lot', disabled },
              ]}
            />
          </div>
        </Section>

        <Section label="Muscle retention">
          <div className="lm-safety-row lp-switchrow">
            <div className="lm-safety-row__words"><span className="lp-label" id="lp-muscle-budget-l">Limit modeled muscle loss</span></div>
            <Switch
              labelledBy="lp-muscle-budget-l"
              checked={c.maxMuscleLossPct !== null && c.maxMuscleLossPct !== undefined}
              onChange={(on) => onChange({ maxMuscleLossPct: on ? 5 : null })}
              disabled={disabled}
            />
          </div>
          {c.maxMuscleLossPct !== null && c.maxMuscleLossPct !== undefined ? (
            <ScaleSlider
              label="Whole-plan loss budget"
              value={muscleLoss}
              onChange={setMuscleLoss}
              onCommit={(v) => onChange({ maxMuscleLossPct: v })}
              min={0}
              max={10}
              step={0.5}
              majorStep={5}
              minorStep={0.5}
              labels={[0, 5, 10]}
              unit="%"
              valueText={(v) => `${formatNumber(v, 1)} percent of starting modeled skeletal muscle over the whole plan`}
              disabled={disabled}
            />
          ) : null}
          <p className="lp-field__hint">Relative to starting modeled skeletal muscle across the whole plan. A scenario limit; actual muscle loss cannot be guaranteed.</p>
        </Section>

        <Section label="Nutrients">
          <ScaleSlider
            label="Protein at least"
            value={protein}
            onChange={setProtein}
            onCommit={(v) => onChange({ proteinFloor: v <= 1.2 ? null : v })}
            min={1.2}
            max={2.4}
            step={0.1}
            majorStep={0.4}
            minorStep={0.1}
            unit="g/kg"
            labels={[1.2, 2.0, 2.4]}
            reference={{ value: 1.6, label: 'typical' }}
            valueText={(v) => `protein at least ${formatNumber(v, 1)} grams per kilogram`}
            disabled={disabled}
          />
          <div className="lp-field">
            <span className="lp-label" id="lp-carb-l">
              Net carbohydrate at least
            </span>
            <KeyBank
              labelledBy="lp-carb-l"
              size="sm"
              value={String(c.carbFloorG)}
              onChange={(v) => onChange({ carbFloorG: Number(v) })}
              options={[0, 50, 100, 150].map((g) => ({ value: String(g), label: g === 0 ? 'No floor' : `${g} g`, disabled }))}
            />
          </div>
        </Section>

        {/* what the plans may not use: a chip per lever, selected = left out (its detail in the title tooltip) */}
        <Section label="Leave out">
          {/* what the plans may not use: a checked box is left out (r068 PG5: a list, not a chip cloud) */}
          <div className="lp-leaveout" role="group" aria-label="Leave out of plans">
            {EXCLUDABLE.map((x) => (
              <span key={x.id} title={typeof x.help === 'function' ? x.help(energy) : x.help}>
                <Checkbox checked={c.excluded.includes(x.id)} onChange={(on) => toggleExcluded(x.id, on)} disabled={disabled} label={cap(x.label)} />
              </span>
            ))}
            <span title="Keep bed and wake times as they are">
              <Checkbox checked={c.sleepFixed} onChange={(on) => onChange({ sleepFixed: on })} disabled={disabled} label="Sleep changes" />
            </span>
          </div>
        </Section>
      </div>
    </Faceplate>
  );
}
