import { memo } from 'react';
import { Faceplate, Field, Key, KeyValueList, ResponsivePanel, Section, formatNumber } from '@/components';
import type { LabBaselines } from '@/engine/types/profile';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore, type EnergyUnit, type GlucoseUnit } from '@/state/settingsStore';
import { LABS } from '../copy';
import { labFromDisplay, labToDisplay, labUnit, type LabConversion } from '../units';
import { OptionalNumber } from './fields';
import { patchProfile } from '../commands';

type LabKey = keyof LabBaselines;
type Group = keyof typeof LABS.groups;

interface LabField {
  key: LabKey;
  label: string;
  group: Group;
  /** Engine unit (what is stored). */
  unit: string;
  conv: LabConversion;
  /** Plausible range in engine units. */
  min: number;
  max: number;
  /** Decimals in the engine unit and in mg/dL / kJ. */
  decimals: number;
  altDecimals?: number;
  help?: string;
}

/** Optional measured baselines (src/engine/types/profile.ts `LabBaselines`), engine units. */
export const LAB_FIELDS: readonly LabField[] = [
  { key: 'measuredRmrKcal', label: 'resting energy, measured', group: 'metabolism', unit: 'kcal/day', conv: 'energy', min: 800, max: 4000, decimals: 0, altDecimals: 0, help: 'From indirect calorimetry. Replaces the equation and narrows the maintenance range.' },
  { key: 'vo2maxMlKgMin', label: 'VO₂max', group: 'metabolism', unit: 'mL/kg/min', conv: 'none', min: 10, max: 90, decimals: 1, help: 'From a lab or field test, not a watch estimate.' },
  { key: 'ldlMmolL', label: 'LDL cholesterol', group: 'lipids', unit: 'mmol/L', conv: 'cholesterol', min: 0.5, max: 10, decimals: 2, altDecimals: 0 },
  { key: 'hdlMmolL', label: 'HDL cholesterol', group: 'lipids', unit: 'mmol/L', conv: 'cholesterol', min: 0.3, max: 4, decimals: 2, altDecimals: 0 },
  { key: 'tgMmolL', label: 'triglycerides', group: 'lipids', unit: 'mmol/L', conv: 'triglyceride', min: 0.2, max: 15, decimals: 2, altDecimals: 0 },
  { key: 'apoBgL', label: 'apolipoprotein B', group: 'lipids', unit: 'g/L', conv: 'apoB', min: 0.2, max: 3, decimals: 2, altDecimals: 0 },
  { key: 'fastingGlucoseMmolL', label: 'fasting glucose', group: 'glucose', unit: 'mmol/L', conv: 'glucose', min: 2.5, max: 20, decimals: 1, altDecimals: 0 },
  { key: 'fastingInsulinUuMl', label: 'fasting insulin', group: 'glucose', unit: 'µU/mL', conv: 'none', min: 1, max: 100, decimals: 1 },
  { key: 'hba1cPct', label: 'HbA1c', group: 'glucose', unit: '%', conv: 'none', min: 3.5, max: 15, decimals: 1 },
  { key: 'sbpMmHg', label: 'systolic', group: 'pressure', unit: 'mmHg', conv: 'none', min: 70, max: 230, decimals: 0 },
  { key: 'dbpMmHg', label: 'diastolic', group: 'pressure', unit: 'mmHg', conv: 'none', min: 40, max: 140, decimals: 0 },
  { key: 'liverFatPct', label: 'liver fat', group: 'other', unit: '%', conv: 'none', min: 0, max: 60, decimals: 1, help: 'From an MRI (PDFF) scan.' },
  { key: 'crpMgL', label: 'hs-CRP', group: 'other', unit: 'mg/L', conv: 'none', min: 0.05, max: 100, decimals: 1 },
  { key: 'urateMgDl', label: 'uric acid', group: 'other', unit: 'mg/dL', conv: 'none', min: 1, max: 15, decimals: 1 },
  { key: 'leptinNgMl', label: 'leptin', group: 'other', unit: 'ng/mL', conv: 'none', min: 0.5, max: 150, decimals: 1 },
  { key: 'testosteroneNmolL', label: 'testosterone', group: 'other', unit: 'nmol/L', conv: 'none', min: 0.1, max: 60, decimals: 1 },
  { key: 'igf1NgMl', label: 'IGF-1', group: 'other', unit: 'ng/mL', conv: 'none', min: 20, max: 1000, decimals: 0 },
];

function decimalsFor(f: LabField, glucose: GlucoseUnit, energy: EnergyUnit): number {
  const alt = f.conv === 'energy' ? energy === 'kJ' : glucose === 'mgdl' && f.conv !== 'none';
  return alt ? (f.altDecimals ?? f.decimals) : f.decimals;
}

export function LabsForm() {
  const labs = useProfileStore((s) => s.labs);
  const glucose = useSettingsStore((s) => s.glucoseUnit);
  const energy = useSettingsStore((s) => s.energyUnit);
  const groups = Object.keys(LABS.groups) as Group[];
  return (
    <div className="lm-body-labs">
      <p className="lm-body-hint">{LABS.editorLead}</p>
      {groups.map((g) => (
        <Section key={g} label={LABS.groups[g]}>
          <div className="lm-body-labs__grid">
            {LAB_FIELDS.filter((f) => f.group === g).map((f) => {
              const d = decimalsFor(f, glucose, energy);
              return (
                <Field key={f.key} label={f.label} help={f.help}>
                  <OptionalNumber
                    name={f.label}
                    value={labs[f.key] ?? null}
                    onChange={(x) => patchProfile({ labs: { [f.key]: x ?? undefined } })}
                    min={f.min}
                    max={f.max}
                    step={10 ** -d}
                    decimals={d}
                    unit={labUnit(f.conv, f.unit, glucose, energy)}
                    toDisplay={(x) => labToDisplay(f.conv, x, glucose, energy)}
                    toEngine={(x) => labFromDisplay(f.conv, x, glucose, energy)}
                  />
                </Field>
              );
            })}
          </div>
        </Section>
      ))}
      <p className="lm-body-hint">{LABS.unitsNote}</p>
    </div>
  );
}

export interface LabsFaceProps {
  labs: LabBaselines;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id?: string;
}

/** Optional lab values: a clearly skippable summary; the editor opens in a sheet / side panel. */
export const LabsFace = memo(function LabsFace({ labs, open, onOpenChange, id }: LabsFaceProps) {
  const glucose = useSettingsStore((s) => s.glucoseUnit);
  const energy = useSettingsStore((s) => s.energyUnit);
  const entered = LAB_FIELDS.filter((f) => labs[f.key] !== undefined);
  return (
    <Faceplate
      id={id}
      className="lm-body-labs-face"
      title={LABS.title}
      caption={LABS.caption}
      actions={
        <Key variant="quiet" size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(true)}>
          {entered.length ? LABS.edit : LABS.add}
        </Key>
      }
    >
      {entered.length ? (
        <KeyValueList
          items={entered.map((f) => {
            const d = decimalsFor(f, glucose, energy);
            return { id: f.key, key: f.label, value: `${formatNumber(labToDisplay(f.conv, labs[f.key] as number, glucose, energy), d)} ${labUnit(f.conv, f.unit, glucose, energy)}` };
          })}
        />
      ) : (
        <p className="lm-body-hint">
          {LABS.lead} {LABS.empty}
        </p>
      )}
      <ResponsivePanel
        open={open}
        onClose={() => onOpenChange(false)}
        title={LABS.editorTitle}
        defaultDetent="full"
        footer={
          <>
            {entered.length ? (
              <Key variant="quiet" onClick={() => patchProfile({ labs: null })}>
                {LABS.clearAll}
              </Key>
            ) : null}
            <Key variant="solid" onClick={() => onOpenChange(false)}>
              Done
            </Key>
          </>
        }
      >
        <div className="lm-body-panel">
          <LabsForm />
        </div>
      </ResponsivePanel>
    </Faceplate>
  );
});
