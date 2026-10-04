import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Checkbox, Faceplate, Key, KeyBank, ScaleRange, ScaleSlider, Section, Stepper, Switch, formatNumber } from '@/components';
import type { CardioModality } from '@/engine/types/schedule';
import type { Weekday } from '@/engine/planner/domain/types';
import type { ConstraintDraft, HungerTolerance, LongestFast } from '@/state/plannerStore';
import { useEnergyUnit, type EnergyUnit } from '@/state/settingsStore';
import { fmtClock, fmtKcal, fmtKcalValue, fmtSteps } from '../format';
import { LONGEST_FAST_OPTIONS } from '../request';
import { WindowDial } from './WindowDial';

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

const WEEKDAY_LABEL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Levers the user can refuse (registry ids, dossier 13 §4C / 18 §4.4.1 / 21 §4J). */
export const EXCLUDABLE: ReadonlyArray<{ id: string; label: string; help?: string | ((energy: EnergyUnit) => string); group: 'days' | 'phases' | 'extras' }> = [
  { id: 'lowDays', label: 'low-energy days', help: (e) => `Two days a week at ${fmtKcalValue(500, e)}–${fmtKcal(700, e)}`, group: 'days' },
  { id: 'refeedDay', label: 'refeed days', help: 'Higher-carbohydrate days at maintenance inside a deficit', group: 'days' },
  { id: 'dietBreak', label: 'diet breaks', help: 'One or two weeks at maintenance between deficit blocks', group: 'days' },
  { id: 'B2', label: 'very-low-carbohydrate phases', help: 'Net carbohydrate 20–50 g a day', group: 'phases' },
  { id: 'B6', label: 'very-low-fat phases', help: 'High carbohydrate, fat kept low', group: 'phases' },
  { id: 'B3', label: 'short, hard deficits', help: 'A few weeks at a larger deficit with lifting', group: 'phases' },
  { id: 'L7', label: 'creatine', help: '3–5 g a day with training; adds about 1 kg of water', group: 'extras' },
  { id: 'L8', label: 'omega-3 capsules', help: '2–3 g EPA + DHA a day', group: 'extras' },
  { id: 'L9', label: 'fibre supplement', help: 'Psyllium or oat beta-glucan before meals', group: 'extras' },
  { id: 'L2', label: 'walks after meals', help: '5–15 minutes of light walking', group: 'extras' },
];

const MODALITIES: ReadonlyArray<{ value: CardioModality; label: string }> = [
  { value: 'walk', label: 'walk' },
  { value: 'cycle', label: 'cycle' },
  { value: 'run', label: 'run' },
  { value: 'swim', label: 'swim' },
  { value: 'row', label: 'row' },
];

export interface LimitsPanelProps {
  c: ConstraintDraft;
  onChange: (patch: Partial<ConstraintDraft>) => void;
  onReset?: () => void;
  /** Some limits differ from Habits (shows "Reset to my habits"). */
  customised: boolean;
  /** Longest fast the safety screening allows, h, and why longer ones are off. */
  safetyMaxFastH: number;
  fastLockReason: string | null;
  disabled?: boolean;
}

/**
 * Practical limits (planner-goals.md §6, COMPONENTS §8 `<Constraints>`): training, eating, fasting, nutrient floors and
 * the "won't do" list. Changes apply immediately and re-evaluate the "Before you run" hints.
 */
export function LimitsPanel({ c, onChange, onReset, customised, safetyMaxFastH, fastLockReason, disabled }: LimitsPanelProps) {
  const energy = useEnergyUnit();
  const [train, setTrain] = useLive<readonly [number, number]>(c.trainingDays);
  const [cardio, setCardio] = useLive<readonly [number, number]>(c.cardioDays);
  const [eat, setEat] = useLive<readonly [number, number]>([c.earliestH, c.latestH]);
  const [meals, setMeals] = useLive<readonly [number, number]>(c.mealsPerDay);
  const [steps, setSteps] = useLive<readonly [number, number]>(c.steps);
  const [time, setTime] = useLive(c.trainingTimeH);
  const [protein, setProtein] = useLive(c.proteinFloor ?? 1.2);
  const days = new Set(c.trainingWeekdays);

  const toggleDay = (d: Weekday) => {
    const next = new Set(days);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange({ trainingWeekdays: [...next].sort((a, b) => a - b) as Weekday[] });
  };
  const toggleExcluded = (id: string, on: boolean) => {
    const set = new Set(c.excluded);
    if (on) set.add(id);
    else set.delete(id);
    onChange({ excluded: [...set].sort() });
  };

  const fastOptions = LONGEST_FAST_OPTIONS.map((h) => ({
    value: String(h) as `${LongestFast}`,
    label: `${h} h`,
    disabled: disabled || h > Math.max(12, safetyMaxFastH),
  }));

  return (
    <Faceplate
      title="Practical limits"
      caption="what you can and won’t do"
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
            label="resistance training days a week"
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
            <legend className="lm-eng">days I can train</legend>
            <div className="lp-days__keys">
              {WEEKDAY_LABEL.map((l, d) => (
                <Key key={l} size="sm" pressed={days.has(d as Weekday)} onClick={() => toggleDay(d as Weekday)} aria-label={WEEKDAY_NAME[d]}>
                  {l}
                </Key>
              ))}
            </div>
          </fieldset>
          <div className="lp-limits__pair">
            <ScaleSlider
              label="usual training time"
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
              <span className="lm-eng" id="lp-session-l">
                longest session
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
            label="cardio days a week"
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
          <div className="lp-field">
            <span className="lm-eng" id="lp-cardio-l">
              cardio I’d do
            </span>
            <KeyBank labelledBy="lp-cardio-l" size="sm" value={c.cardioModality} onChange={(v) => onChange({ cardioModality: v })} options={MODALITIES.map((m) => ({ ...m, disabled }))} />
          </div>
          <ScaleRange
            label="daily steps"
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
            valueText={(v, w) => `${w === 'low' ? 'at least' : 'at most'} ${v} steps`}
            disabled={disabled}
          />
        </Section>

        <Section label="Eating">
          <div className="lp-eat">
            <ScaleRange
              label="eating between"
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
            <WindowDial startH={eat[0]} endH={eat[1]} />
          </div>
          <ScaleRange
            label="meals a day"
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
            <span className="lm-eng" id="lp-fast-l">
              longest fast I’d do
            </span>
            <KeyBank
              labelledBy="lp-fast-l"
              size="sm"
              block
              value={String(c.longestFastH) as `${LongestFast}`}
              onChange={(v) => onChange({ longestFastH: Number(v) as LongestFast })}
              options={fastOptions}
            />
            <p className="lp-field__note">
              {c.longestFastH < 24
                ? `Up to ${c.longestFastH} h between the last meal and the next: plans use daily eating windows, no fasting days.`
                : `Plans may use fasts up to ${c.longestFastH} h when your goals call for them.`}
              {safetyMaxFastH < 72 && fastLockReason ? ` Longer fasts: ${fastLockReason}` : ''}
            </p>
          </div>
          <Switch
            label="I’d like fasting to be part of the plan"
            labelStyle="sentence"
            checked={c.prefersFasting}
            onChange={(v) => onChange({ prefersFasting: v })}
            disabled={disabled}
          />
          <div className="lp-field">
            <span className="lm-eng" id="lp-hunger-l">
              hunger I can live with
            </span>
            <KeyBank<HungerTolerance>
              labelledBy="lp-hunger-l"
              size="sm"
              value={c.hungerTolerance}
              onChange={(v) => onChange({ hungerTolerance: v })}
              options={[
                { value: 'low', label: 'little', disabled },
                { value: 'medium', label: 'some', disabled },
                { value: 'high', label: 'a lot', disabled },
              ]}
            />
          </div>
        </Section>

        <Section label="Nutrients">
          <ScaleSlider
            label="protein at least"
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
            reference={{ value: 1.6, label: 'typical for lifting' }}
            valueText={(v) => `protein at least ${formatNumber(v, 1)} grams per kilogram`}
            note={protein <= 1.2 ? 'The evidence minimum while losing fat; it can’t go lower.' : 'Grams per kg of reference body weight, every eating day.'}
            disabled={disabled}
          />
          <div className="lp-field">
            <span className="lm-eng" id="lp-carb-l">
              net carbohydrate at least
            </span>
            <KeyBank
              labelledBy="lp-carb-l"
              size="sm"
              value={String(c.carbFloorG)}
              onChange={(v) => onChange({ carbFloorG: Number(v) })}
              options={[0, 50, 100, 150].map((g) => ({ value: String(g), label: g === 0 ? 'no floor' : `${g} g`, disabled }))}
            />
            <p className="lp-field__note">{c.carbFloorG >= 50 ? 'Keeps every day out of the ketogenic range.' : 'Plans may use very-low-carbohydrate days when a goal calls for them.'}</p>
          </div>
        </Section>

        <Section label="Won’t do">
          <div className="lp-wont">
            {EXCLUDABLE.map((x) => (
              <Checkbox key={x.id} label={x.label} help={typeof x.help === 'function' ? x.help(energy) : x.help} checked={c.excluded.includes(x.id)} onChange={(on) => toggleExcluded(x.id, on)} disabled={disabled} />
            ))}
            <Checkbox label="changing my sleep" help="Keep bed and wake times as they are" checked={c.sleepFixed} onChange={(on) => onChange({ sleepFixed: on })} disabled={disabled} />
          </div>
        </Section>
      </div>
    </Faceplate>
  );
}
