import { memo, useState, type ReactNode } from 'react';
import { UserRound } from 'lucide-react';
import { CardFoot, CardHead, Field, GradientCard, InlineWarning, KeyBank, KeyValueList, MeasureStepper, ResponsivePanel, Select, Stepper } from '@/components';
import type { Ethnicity } from '@/engine/body';
import type { PhysiologySex } from '@/engine/types/profile';
import type { BodyProfileValues } from '@/state/profileStore';
import type { UnitSystem } from '@/state/settingsStore';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/settings'; // registers the commands dispatched here
import { patchProfile } from '../commands';
import { BASICS, INFO } from '../copy';
import { DisclosureRow } from './Disclosure';
import { wrapOptions } from './fields';
import { LOW_BODY_GLOW } from './glow';
import { TYPICAL_BASICS } from '../model';
import { formatHeight, formatMass, sameDisplayed } from '../units';

type BasicsValues = Pick<BodyProfileValues, 'sex' | 'ageYears' | 'heightCm' | 'weightKg' | 'ethnicity'>;

export interface BasicsFaceProps {
  /** The basics slice of the store (object identity changes only when a basic changes). */
  v: BasicsValues;
  /** BMI of the entered height and weight (plausibility caution). */
  bmi: number;
  units: UnitSystem;
  /** The "More" disclosure (ancestry). Off in setup, where only the four facts are asked. Default true. */
  more?: boolean;
  id?: string;
  /** The card's foot: the setup step's keys on desktop (r068 V-BS-1). */
  footer?: ReactNode;
  /**
   * Phones in normal mode: the card is five summary rows and its "Edit" opens the same form in a panel, as Habits and Lab
   * values do (the form stays inline on desktop and in first-run setup, where the figure beside it follows the steppers).
   */
  rows?: boolean;
  /** Quiet or gentle mode: the rows say the weight is set and never what it is. The form (an input) is unchanged. */
  calm?: boolean;
}

/** The four facts and the units, as the form asks for them: used inline and inside the panel. */
function BasicsForm({ v, bmi, units, more: withMore }: Pick<BasicsFaceProps, 'v' | 'bmi' | 'units'> & { more: boolean }) {
  const [more, setMore] = useState(v.ethnicity !== null);
  const sex = v.sex ?? 'unspecified';
  const typicalHeight = TYPICAL_BASICS.heightCm[sex];
  const typicalWeight = TYPICAL_BASICS.weightKg[sex];
  const bmiOut = v.weightKg !== null && v.heightCm !== null && (bmi < 16 || bmi > 60);
  return (
    <div className="lm-body-form">
      <Field label={BASICS.units}>
        <KeyBank<UnitSystem>
          size="sm"
          label={BASICS.units}
          value={units}
          onChange={(units: UnitSystem) => void sendCommand('settings.update', { patch: { units } })}
          options={[
            { value: 'metric', label: 'Metric' },
            { value: 'imperial', label: 'Imperial' },
          ]}
        />
      </Field>
      <Field
        label={BASICS.sexLabel}
        help={v.sex === 'unspecified' ? BASICS.sexUnspecifiedHelp : v.sex === null ? BASICS.sexUnsetHelp : undefined}
      >
        <KeyBank<PhysiologySex>
          block
          className="lm-body-bank--fit"
          size="lg"
          value={v.sex ?? undefined}
          onChange={(s) => patchProfile({ sex: s })}
          options={wrapOptions(BASICS.sexOptions)}
        />
      </Field>
      {/* age, height and weight: three across once the card is wide enough, so a 3-digit value never gets a 500 px field */}
      <div className="lm-body-trio">
        <Field label={BASICS.age} help={v.ageYears === null ? BASICS.typical : undefined}>
          <Stepper name="age" value={v.ageYears ?? TYPICAL_BASICS.ageYears} onChange={(a) => patchProfile({ ageYears: a })} min={18} max={90} step={1} unit="yrs" inputMode="numeric" />
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
      </div>
      {bmiOut ? <InlineWarning severity="caution">{BASICS.bmiCaution}</InlineWarning> : null}
      {withMore ? (
        <div className="lm-body-more">
          <DisclosureRow open={more} onToggle={() => setMore((m) => !m)}>
            {BASICS.more}
          </DisclosureRow>
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
  );
}

/** The five summary rows of a phone's Basics card: a fact not given yet shows the typical value and says so. */
export function basicsRows(v: BasicsValues, units: UnitSystem, calm: boolean): Array<{ key: string; value: ReactNode }> {
  const sex = v.sex ?? 'unspecified';
  const typical = <span className="lm-body-typical">{BASICS.typicalRow}</span>;
  const weight = formatMass(v.weightKg ?? TYPICAL_BASICS.weightKg[sex], units, 1);
  return [
    { key: BASICS.sexLabel, value: v.sex === null ? BASICS.notSet : BASICS.sexWords[v.sex] },
    { key: BASICS.age, value: v.ageYears === null ? <>{TYPICAL_BASICS.ageYears} yrs {typical}</> : `${v.ageYears} yrs` },
    { key: BASICS.height, value: v.heightCm === null ? <>{formatHeight(TYPICAL_BASICS.heightCm[sex], units)} {typical}</> : formatHeight(v.heightCm, units) },
    // quiet: the row says the weight is set, never what it is
    { key: BASICS.weight, value: calm ? (v.weightKg === null ? BASICS.notSet : BASICS.setRow) : v.weightKg === null ? <>{`${weight.value} ${weight.unit}`} {typical}</> : `${weight.value} ${weight.unit}` },
    { key: BASICS.unitsRow, value: BASICS.unitWords[units] },
  ];
}

/**
 * Basics (r071; your-body.md §6): sex, age, height, weight and the units. An input card: inline on desktop and in setup
 * (the figure beside it follows the steppers), five summary rows with "Edit" on a phone. Nothing about the drawing sits
 * here (its frame lives in Figure › Adjust the drawing, body-figure-v2.md §5.4). Memoised: shape drags skip it.
 */
export const BasicsFace = memo(function BasicsFace({ v, bmi, units, more: withMore = true, id, footer, rows = false, calm = false }: BasicsFaceProps) {
  const [open, setOpen] = useState(false);
  const head = <CardHead icon={UserRound} title={BASICS.title} info={INFO.basics} />;
  if (rows) {
    return (
      <GradientCard
        id={id}
        className="lm-body-basics"
        domain="body"
        glow={LOW_BODY_GLOW}
        onOpen={() => setOpen(true)}
        openLabel={`${BASICS.edit} ${BASICS.title.toLowerCase()}`}
        head={head}
        foot={<CardFoot link={{ onClick: () => setOpen(true), label: BASICS.edit }} />}
      >
        <KeyValueList className="lm-body-kv" items={basicsRows(v, units, calm).map((r) => ({ key: r.key, value: r.value, id: r.key }))} />
        <ResponsivePanel scrim open={open} onClose={() => setOpen(false)} title={BASICS.editorTitle} defaultDetent="full" detents={['half', 'full']}>
          <div className="lm-body-panel">
            <BasicsForm v={v} bmi={bmi} units={units} more={withMore} />
          </div>
        </ResponsivePanel>
      </GradientCard>
    );
  }
  return (
    <GradientCard id={id} className="lm-body-basics" domain="body" glow={LOW_BODY_GLOW} head={head} foot={footer ? <div className="lm-body-setup-foot">{footer}</div> : undefined}>
      <BasicsForm v={v} bmi={bmi} units={units} more={withMore} />
    </GradientCard>
  );
});
