import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { paths } from '@/app/paths';
import { Field, Key, KeyBank, KJ_PER_KCAL, ScaleRange, ScaleSlider, Section, Select, Stepper, Switch, TextInput, formatNumber } from '@/components';
import type { TrainingQuality } from '@/engine/body';
import { DEFAULTS } from '@/engine/core/defaults';
import type { ContraceptionKind, DietAnimalLevel, SleepQuality, StressLevel, TrainingHistory } from '@/engine/types/profile';
import { BODY_RANGES, type BodyProfileValues } from '@/state/profileStore';
import { patchProfile, type ProfileUpdate } from '../commands';
import { HABITS } from '../copy';
import { TRAINING_KEY_YEARS, trainingHistoryOf } from '../model';
import { OptionalNumber, wrapOptions } from './fields';
import { energyIn, energyToKcal } from '../units';
import { useSettingsStore } from '@/state/settingsStore';

type Habits = BodyProfileValues['habits'];

/** 23.5 → "23:30"; hours past midnight wrap (25 → "01:00"). */
export function clock(h: number): string {
  const t = ((h % 24) + 24) % 24;
  const hh = Math.floor(t);
  const mm = Math.round((t - hh) * 60);
  return `${String(mm === 60 ? hh + 1 : hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
}

/** Local date, YYYY-MM-DD (latest allowed period start). */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Sleep scale runs 18:00 → 12:00 next day (hours 18…36) so a night never splits across midnight. */
const toNight = (h: number) => (h < 12 ? h + 24 : h);

function DefaultKey({ shown, onReset }: { shown: boolean; onReset: () => void }) {
  if (!shown) return null;
  return (
    <Key variant="quiet" size="sm" onClick={onReset}>
      {HABITS.resetDefault}
    </Key>
  );
}

/** The slice of the store the Habits editor reads (sub-objects keep their identity across shape drags). */
export type HabitInputs = Pick<BodyProfileValues, 'habits' | 'training' | 'cycle' | 'menopause' | 'sex'>;

/** Engine defaults shown while a habit is unset (resolved for this body). */
export interface HabitDefaults {
  /** Habitual protein at the engine's weight-stable intake, g/kg/day (06 §2.4: 15.6 %E). */
  proteinGPerKg: number;
  /** Habitual carbohydrate, % of energy (06 §2.4 NHANES, by the equation sex). */
  carbPct: number;
}

export interface HabitsFormProps {
  v: HabitInputs;
  defaults: HabitDefaults;
  /** Heading level for section labels (h3 on the page, h3 in the panel). */
  headingAs?: 'h3' | 'h4';
}

/** The Habits editor (your-body.md §6 Habits + the engine's HabitProfile / CycleProfile inputs). */
export function HabitsForm({ v, defaults, headingAs = 'h3' }: HabitsFormProps) {
  const h = v.habits;
  const setH = (patch: Partial<Habits>) => patchProfile({ habits: patch });
  const patchTraining = (training: NonNullable<ProfileUpdate['training']>) => patchProfile({ training });
  const patchCycle = (cycle: NonNullable<ProfileUpdate['cycle']>) => patchProfile({ cycle });
  const years = v.training.years;
  const history = trainingHistoryOf(years);
  const sessions = h.sessionsPerWeek ?? 0;
  const mix = h.lifingCardioMix ?? 0.5;
  const proteinDefault = defaults.proteinGPerKg;
  const carbDefault = defaults.carbPct;
  const bed = h.bedTimeH ?? DEFAULTS.bedTimeH;
  const wake = h.wakeTimeH ?? DEFAULTS.wakeTimeH;
  const winStart = h.habitualWindowStartH ?? DEFAULTS.windowStartH;
  const winLen = h.habitualWindowLengthH ?? DEFAULTS.windowLengthH;
  const [advanced, setAdvanced] = useState(
    [h.habitualFibreGPer1000Kcal, h.habitualSodiumG, h.habitualCaffeineMg, h.habitualAlcoholDrinksPerWeek, h.upfShare, h.foodQuality, h.multivitamin, h.smoker, h.habitualLiquidKcal].some((x) => x !== undefined),
  );
  const female = v.sex === 'female';
  const energyUnit = useSettingsStore((st) => st.energyUnit);

  const advancedRow = (field: keyof Habits, control: ReactNode) => (
    <div className="lm-body-adv">
      {control}
      <DefaultKey shown={h[field] !== undefined} onReset={() => setH({ [field]: undefined })} />
    </div>
  );

  return (
    <div className="lm-body-habits">
      <Section label={HABITS.trainingTitle} labelAs={headingAs}>
        <Field label={HABITS.history}>
          <KeyBank<TrainingHistory>
            block
            value={history}
            onChange={(k) => patchTraining({ years: TRAINING_KEY_YEARS[k], quality: k === 'none' ? null : (v.training.quality ?? 'regular') })}
            options={wrapOptions(HABITS.historyOptions)}
          />
        </Field>
        {years !== null && years > 0 ? (
          <div className="lm-body-pair">
            <Field label={HABITS.years} help={HABITS.yearsHelp}>
              <Stepper name="years of training" value={years} onChange={(y) => patchTraining({ years: y })} min={0} max={BODY_RANGES.trainingYears[1]} step={0.5} unit="yrs" />
            </Field>
            <Field label={HABITS.quality} help={HABITS.qualityHelp}>
              <KeyBank<TrainingQuality> block value={v.training.quality ?? 'regular'} onChange={(q) => patchTraining({ quality: q })} options={HABITS.qualityOptions} />
            </Field>
          </div>
        ) : null}
        <Field label={HABITS.sessions}>
          <Stepper name="sessions a week" value={sessions} onChange={(n) => setH({ sessionsPerWeek: n })} min={0} max={14} step={1} unit={HABITS.sessionsUnit} inputMode="numeric" />
        </Field>
        {sessions > 0 ? (
          <ScaleSlider
            label={HABITS.mix}
            value={mix}
            min={0}
            max={1}
            step={0.05}
            minorStep={0.05}
            majorStep={0.25}
            labels={HABITS.mixLabels}
            format={(x) => HABITS.mixValue(Math.round((1 - x) * 100))}
            valueText={(x) => HABITS.mixValue(Math.round((1 - x) * 100)).replace(/%/g, 'percent')}
            editable={false}
            onChange={(x) => setH({ lifingCardioMix: x })}
          />
        ) : null}
      </Section>

      <Section label={HABITS.activityTitle} labelAs={headingAs}>
        <ScaleSlider
          label={HABITS.steps}
          value={h.typicalSteps ?? DEFAULTS.steps}
          min={1000}
          max={25000}
          step={100}
          minorStep={1000}
          majorStep={5000}
          labels={[
            { value: 1000, label: '1k' },
            { value: 5000, label: '5k' },
            { value: 10000, label: '10k' },
            { value: 15000, label: '15k' },
            { value: 20000, label: '20k' },
            { value: 25000, label: '25k' },
          ]}
          reference={{ value: DEFAULTS.steps }}
          format={(x) => formatNumber(x, 0)}
          unit={HABITS.stepsUnit}
          valueText={(x) => `${formatNumber(x, 0, { grouping: 'none' })} steps a day`}
          note={HABITS.stepsRef}
          onChange={(x) => setH({ typicalSteps: x })}
        />
      </Section>

      <Section label={HABITS.sleepTitle} labelAs={headingAs}>
        <ScaleRange
          label={HABITS.sleep}
          value={[toNight(bed), toNight(wake) <= toNight(bed) ? toNight(wake) + 24 : toNight(wake)]}
          min={18}
          max={36}
          step={0.25}
          minGap={3}
          minorStep={1}
          majorStep={3}
          labels={[18, 21, 24, 27, 30, 33, 36].map((x) => ({ value: x, label: clock(x) }))}
          format={clock}
          thumbLabels={HABITS.sleepThumbs}
          valueText={(x, which) => `${which === 'low' ? 'bedtime' : 'wake time'} ${clock(x)}`}
          onChange={([b, w]) => setH({ bedTimeH: b % 24, wakeTimeH: w % 24 })}
        />
        <div className="lm-body-pair">
          <Field label={HABITS.sleepQuality}>
            <KeyBank<SleepQuality> block value={h.sleepQuality ?? DEFAULTS.sleepQuality} onChange={(q) => setH({ sleepQuality: q })} options={HABITS.qualityWords} />
          </Field>
          <Field label={HABITS.stress}>
            <KeyBank<StressLevel> block value={h.stress ?? DEFAULTS.stress} onChange={(x) => setH({ stress: x })} options={HABITS.stressWords} />
          </Field>
        </div>
      </Section>

      <Section label={HABITS.eatingTitle} labelAs={headingAs}>
        <p className="lm-body-hint">{HABITS.eatingLead}</p>
        <ScaleSlider
          label={HABITS.carbs}
          value={h.habitualCarbPctEnergy ?? carbDefault}
          min={0}
          max={75}
          step={1}
          minorStep={5}
          majorStep={25}
          reference={{ value: carbDefault }}
          unit={HABITS.carbsUnit}
          valueText={(x) => `carbohydrate ${x} percent of energy`}
          note={
            <span className="lm-body-row">
              {HABITS.carbsRef}
              <DefaultKey shown={h.habitualCarbPctEnergy !== undefined} onReset={() => setH({ habitualCarbPctEnergy: undefined })} />
            </span>
          }
          onChange={(x) => setH({ habitualCarbPctEnergy: x })}
        />
        <ScaleSlider
          label={HABITS.protein}
          value={h.habitualProteinGPerKg ?? Math.round(proteinDefault * 20) / 20}
          min={0.4}
          max={3}
          step={0.05}
          minorStep={0.1}
          majorStep={0.5}
          reference={{ value: Math.round(proteinDefault * 20) / 20 }}
          unit={HABITS.proteinUnit}
          format={(x) => formatNumber(x, 2)}
          valueText={(x) => `protein ${formatNumber(x, 2)} grams per kilogram a day`}
          note={
            <span className="lm-body-row">
              {`typical ${formatNumber(Math.round(proteinDefault * 20) / 20, 2)}`}
              <DefaultKey shown={h.habitualProteinGPerKg !== undefined} onReset={() => setH({ habitualProteinGPerKg: undefined })} />
            </span>
          }
          onChange={(x) => setH({ habitualProteinGPerKg: x })}
        />
        <Field label={HABITS.meals}>
          <KeyBank<string>
            block
            value={String(Math.min(5, h.habitualMealsPerDay ?? DEFAULTS.mealsPerDay))}
            onChange={(m) => setH({ habitualMealsPerDay: Number(m) })}
            options={HABITS.mealsOptions}
          />
        </Field>
        <ScaleRange
          label={HABITS.window}
          value={[winStart, Math.min(24, winStart + winLen)]}
          min={0}
          max={24}
          step={0.5}
          minGap={1}
          minorStep={1}
          majorStep={6}
          labels={[0, 6, 12, 18, 24].map((x) => ({ value: x, label: x === 24 ? '24:00' : clock(x) }))}
          format={clock}
          thumbLabels={HABITS.windowThumbs}
          valueText={(x, which) => `${which === 'low' ? 'first bite' : 'last bite'} ${clock(x)}`}
          onChange={([a, b]) => setH({ habitualWindowStartH: a, habitualWindowLengthH: b - a })}
        />
        <Field label={HABITS.animal} help={HABITS.animalHelp}>
          <KeyBank<DietAnimalLevel> block value={h.dietAnimalLevel ?? 'omnivore'} onChange={(x) => setH({ dietAnimalLevel: x })} options={wrapOptions(HABITS.animalOptions)} />
        </Field>

        <div className="lm-body-more">
          <Key variant="quiet" size="sm" trailingIcon={advanced ? ChevronUp : ChevronDown} aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
            {HABITS.advanced}
          </Key>
          {advanced ? (
            <div className="lm-body-form">
              <p className="lm-body-hint">
                {HABITS.advancedLead}{' '}
                <Link className="lm-link" to={paths.evidenceTopic('fibre-hydration-substances')}>
                  {HABITS.advancedEvidence}
                </Link>
              </p>
              <Field label={HABITS.fibre}>
                {advancedRow(
                  'habitualFibreGPer1000Kcal',
                  energyUnit === 'kJ' ? (
                    // stored per 1 000 kcal; shown and entered per 1 000 kJ when Settings › energy is kJ
                    <Stepper
                      name="fibre"
                      value={Math.round(((h.habitualFibreGPer1000Kcal ?? DEFAULTS.fibreGPer1000Kcal) / KJ_PER_KCAL) * 10) / 10}
                      onChange={(x) => setH({ habitualFibreGPer1000Kcal: x * KJ_PER_KCAL })}
                      min={0}
                      max={Math.floor((40 / KJ_PER_KCAL) * 10) / 10}
                      step={0.1}
                      unit={HABITS.fibreUnitKJ}
                    />
                  ) : (
                    <Stepper name="fibre" value={h.habitualFibreGPer1000Kcal ?? DEFAULTS.fibreGPer1000Kcal} onChange={(x) => setH({ habitualFibreGPer1000Kcal: x })} min={0} max={40} step={1} unit={HABITS.fibreUnit} />
                  ),
                )}
              </Field>
              <Field label={HABITS.sodium}>
                {advancedRow(
                  'habitualSodiumG',
                  <Stepper name="sodium" value={h.habitualSodiumG ?? DEFAULTS.sodiumG} onChange={(x) => setH({ habitualSodiumG: x })} min={0.5} max={10} step={0.1} unit={HABITS.sodiumUnit} />,
                )}
              </Field>
              <Field label={HABITS.caffeine} help={HABITS.caffeineHint}>
                {advancedRow(
                  'habitualCaffeineMg',
                  <Stepper name="caffeine" value={h.habitualCaffeineMg ?? DEFAULTS.caffeineMg} onChange={(x) => setH({ habitualCaffeineMg: x })} min={0} max={1000} step={25} unit={HABITS.caffeineUnit} inputMode="numeric" />,
                )}
              </Field>
              <Field label={HABITS.alcohol} help={HABITS.alcoholHint}>
                {advancedRow(
                  'habitualAlcoholDrinksPerWeek',
                  <Stepper name="alcohol" value={h.habitualAlcoholDrinksPerWeek ?? DEFAULTS.habitualAlcoholDrinksPerWeek} onChange={(x) => setH({ habitualAlcoholDrinksPerWeek: x })} min={0} max={60} step={1} unit={HABITS.alcoholUnit} inputMode="numeric" />,
                )}
              </Field>
              <ScaleSlider
                label={HABITS.upf}
                value={Math.round((h.upfShare ?? DEFAULTS.upfShare) * 100)}
                min={0}
                max={100}
                step={5}
                minorStep={5}
                majorStep={25}
                reference={{ value: DEFAULTS.upfShare * 100 }}
                unit={HABITS.upfUnit}
                valueText={(x) => `ready-made food ${x} percent of energy`}
                note={<DefaultKey shown={h.upfShare !== undefined} onReset={() => setH({ upfShare: undefined })} />}
                onChange={(x) => setH({ upfShare: x / 100 })}
              />
              <Field label={HABITS.variety}>
                <KeyBank<string> block value={String(h.foodQuality ?? DEFAULTS.foodQuality)} onChange={(x) => setH({ foodQuality: Number(x) as 1 | 2 | 3 })} options={HABITS.varietyOptions} />
              </Field>
              <Field label={HABITS.drinks} help={HABITS.drinksHelp}>
                <OptionalNumber
                  name="energy from drinks"
                  value={h.habitualLiquidKcal ?? null}
                  onChange={(x) => setH({ habitualLiquidKcal: x ?? undefined })}
                  min={0}
                  max={3000}
                  step={10}
                  decimals={0}
                  unit={energyUnit === 'kJ' ? 'kJ/day' : 'kcal/day'}
                  toDisplay={(x) => energyIn(x, energyUnit)}
                  toEngine={(x) => energyToKcal(x, energyUnit)}
                />
              </Field>
              <Switch label={HABITS.multivitamin} checked={h.multivitamin ?? false} onChange={(x) => setH({ multivitamin: x })} />
              <Switch label={HABITS.smoker} checked={h.smoker ?? false} onChange={(x) => setH({ smoker: x })} describedBy="lm-body-smoker-help" />
              <p id="lm-body-smoker-help" className="lm-body-hint">
                {HABITS.smokerHelp}
              </p>
            </div>
          ) : null}
        </div>
      </Section>

      {female ? (
        <Section label={HABITS.cycleTitle} labelAs={headingAs}>
          <Field label={HABITS.menopause} help={HABITS.menopauseHelp}>
            <KeyBank<'pre' | 'peri' | 'post'> block value={v.menopause ?? undefined} onChange={(m) => patchProfile({ menopause: m })} options={HABITS.menopauseOptions} />
          </Field>
          {v.menopause !== 'post' ? (
            <>
              <Switch label={HABITS.cycleTrack} checked={v.cycle.tracking} onChange={(on) => patchCycle({ tracking: on })} describedBy="lm-body-cycle-help" />
              <p id="lm-body-cycle-help" className="lm-body-hint">
                {HABITS.cycleHelp}
              </p>
              {v.cycle.tracking ? (
                <div className="lm-body-form">
                  <Field label={HABITS.cycleLength}>
                    <Stepper name="cycle length" value={v.cycle.cycleLengthD ?? 28} onChange={(d) => patchCycle({ cycleLengthD: d })} min={21} max={40} step={1} unit={HABITS.cycleUnit} inputMode="numeric" />
                  </Field>
                  <Field label={HABITS.lastPeriod}>
                    <TextInput type="date" value={v.cycle.lastPeriodStart ?? ''} max={today()} onChange={(e) => patchCycle({ lastPeriodStart: e.target.value || undefined })} />
                  </Field>
                  <Field label={HABITS.contraception}>
                    <Select<ContraceptionKind> value={v.cycle.contraception ?? 'none'} onChange={(c) => patchCycle({ contraception: c })} options={HABITS.contraceptionOptions} />
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
