import { memo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Faceplate, Field, InlineWarning, Key, KeyBank, MeasureStepper, Select, Stepper } from '@/components';
import type { Ethnicity } from '@/engine/body';
import type { PhysiologySex } from '@/engine/types/profile';
import type { BodyProfileValues } from '@/state/profileStore';
import type { UnitSystem } from '@/state/settingsStore';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/settings'; // registers the commands dispatched here
import { patchProfile } from '../commands';
import { BASICS } from '../copy';
import { wrapOptions } from './fields';
import { TYPICAL_BASICS } from '../model';
import { sameDisplayed } from '../units';

export interface BasicsFaceProps {
  /** The basics slice of the store (object identity changes only when a basic changes). */
  v: Pick<BodyProfileValues, 'sex' | 'ageYears' | 'heightCm' | 'weightKg' | 'ethnicity'>;
  /** BMI of the entered height and weight (plausibility caution). */
  bmi: number;
  units: UnitSystem;
  /** Setup mode: no equation-details disclosure, helper under the title. */
  intro?: string;
  id?: string;
}

/**
 * Basics (your-body.md §6): units, physiology sex, age, height, weight. Nothing about the drawing sits here (its frame
 * lives in Shape › Adjust the drawing, body-figure-v2.md §5.4). Memoised: shape drags skip it.
 */
export const BasicsFace = memo(function BasicsFace({ v, bmi, units, intro, id }: BasicsFaceProps) {
  const [more, setMore] = useState(v.ethnicity !== null);
  const sex = v.sex ?? 'unspecified';
  const typicalHeight = TYPICAL_BASICS.heightCm[sex];
  const typicalWeight = TYPICAL_BASICS.weightKg[sex];
  const bmiOut = v.weightKg !== null && v.heightCm !== null && (bmi < 16 || bmi > 60);

  return (
    <Faceplate
      id={id}
      className="lm-body-basics"
      title={BASICS.title}
      actions={
        <KeyBank<UnitSystem>
          size="sm"
          label={BASICS.units}
          value={units}
          onChange={(units: UnitSystem) => void sendCommand('settings.update', { patch: { units } })}
          options={[
            { value: 'metric', label: 'metric' },
            { value: 'imperial', label: 'imperial' },
          ]}
        />
      }
    >
      <div className="lm-body-form">
        {intro ? <p className="lm-body-lead">{intro}</p> : null}
        <Field label={BASICS.sexLabel} help={v.sex === 'unspecified' ? BASICS.sexUnspecifiedHelp : v.sex === null ? BASICS.sexUnsetHelp : undefined}>
          <KeyBank<PhysiologySex>
            block
            className="lm-body-bank--fit"
            size="lg"
            value={v.sex ?? undefined}
            onChange={(s) => patchProfile({ sex: s })}
            options={wrapOptions(BASICS.sexOptions)}
          />
        </Field>
        <Field label={BASICS.age} help={v.ageYears === null ? BASICS.typical : undefined}>
          <Stepper
            name="age"
            value={v.ageYears ?? TYPICAL_BASICS.ageYears}
            onChange={(a) => patchProfile({ ageYears: a })}
            min={18}
            max={90}
            step={1}
            unit="yrs"
            inputMode="numeric"
          />
        </Field>
        <Field label={BASICS.height} help={v.heightCm === null ? BASICS.typical : undefined}>
          <MeasureStepper
            quantity="height"
            name="height"
            value={v.heightCm ?? typicalHeight}
            onChange={(cm) => {
              if (v.heightCm === null || !sameDisplayed('height', units, v.heightCm, cm)) patchProfile({ heightCm: cm });
            }}
            min={140}
            max={210}
          />
        </Field>
        <Field label={BASICS.weight} help={v.weightKg === null ? BASICS.typical : undefined}>
          <MeasureStepper
            quantity="mass"
            name="weight"
            value={v.weightKg ?? typicalWeight}
            onChange={(kg) => {
              if (v.weightKg === null || !sameDisplayed('mass', units, v.weightKg, kg)) patchProfile({ weightKg: kg });
            }}
            min={35}
            max={250}
          />
        </Field>
        {bmiOut ? <InlineWarning severity="caution">{BASICS.bmiCaution}</InlineWarning> : null}
        {intro === undefined ? (
          <div className="lm-body-more">
            <Key variant="quiet" size="sm" trailingIcon={more ? ChevronUp : ChevronDown} aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {BASICS.more}
            </Key>
            {more ? (
              <Field label={BASICS.ethnicity} help={BASICS.ethnicityHelp}>
                <Select<Ethnicity | 'unset'>
                  value={v.ethnicity ?? 'unset'}
                  onChange={(e) => patchProfile({ ethnicity: e === 'unset' ? null : e })}
                  options={BASICS.ethnicityOptions}
                />
              </Field>
            ) : null}
          </div>
        ) : null}
      </div>
    </Faceplate>
  );
});
