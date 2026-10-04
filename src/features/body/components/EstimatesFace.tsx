import { useState, type ReactNode } from 'react';
import { Chip, Faceplate, Key, MQ, Readout, ScrollRail, formatNumber, useMediaQuery } from '@/components';
import { DisclaimerLine } from '@/features/onboarding';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { EST } from '../copy';
import type { BodySummary } from '../model';
import { energyIn } from '../units';
import { kgToLb } from '@/lib/units';

export interface EstimatesFaceProps {
  summary: BodySummary;
  /** The figure's muscle, in words relative to the expectation (FigureView.muscle.figureWords). */
  muscleWords: string;
  energyUnit: EnergyUnit;
  /** Body units: fat and lean mass show in kg or lb (QA: they stayed in kg after switching to imperial). */
  units?: UnitSystem;
  /** Committed sentence for the polite live region (updated on release, not per frame). */
  spoken: string;
  /** Gentle mode: body fat and fat mass collapse behind "show numbers"; lean mass and maintenance lead. */
  gentle: boolean;
  /** "based on averages · refine" → jump to Shape. */
  onRefine?: () => void;
  id?: string;
}

const KNOWN_WORD = { dxa: 'DEXA', bia: 'smart-scale', skinfold: 'caliper', navy: 'tape' } as const;

/** Estimates (your-body.md §6): body fat ± SD, fat mass, lean mass, lean mass index, maintenance — each with its 80 % range. */
export function EstimatesFace({ summary: s, muscleWords: words, energyUnit, units = 'metric', spoken, gentle, onRefine, id }: EstimatesFaceProps) {
  const [showNumbers, setShowNumbers] = useState(false);
  const wide = useMediaQuery(MQ.md);
  const needsWeight = s.missing.includes('weight');
  const known = s.profile.body.knownBodyFatSource;
  const eUnit = energyUnit === 'kJ' ? 'kJ/day' : 'kcal/day';
  const m = s.maintenance;
  const unknown = needsWeight ? EST.needsWeight : undefined;
  const val = (x: number) => (needsWeight ? null : x);
  const imperial = units === 'imperial';
  const massUnit = imperial ? 'lb' : 'kg';
  const mass = (kg: number) => (imperial ? kgToLb(kg) : kg);
  const massBand = (b: [number, number]): [number, number] => [mass(b[0]), mass(b[1])];

  const bodyFat = (
    <Readout
      key="bf"
      label={EST.bodyFat}
      value={val(s.bodyFatPct)}
      unit="%"
      range={s.bodyFatBand80}
      caption={needsWeight ? undefined : EST.howBodyFat(formatNumber(s.bodyFatSdPct, 1), s.measured.waist, s.measured.bodyFat && known ? KNOWN_WORD[known] : null)}
      unknownCaption={unknown}
      animate
    />
  );
  const fatMass = (
    <Readout key="fm" label={EST.fatMass} value={val(mass(s.fatMassKg))} unit={massUnit} range={massBand(s.fatMassBand80)} caption={needsWeight ? undefined : EST.howFatMass} unknownCaption={unknown} animate />
  );
  const lean = (
    <Readout key="lm" label={EST.leanMass} value={val(mass(s.leanMassKg))} unit={massUnit} range={massBand(s.leanMassBand80)} caption={needsWeight ? undefined : EST.howLean} unknownCaption={unknown} animate />
  );
  const ffmi = (
    <Readout key="ffmi" label={EST.ffmi} value={val(s.ffmi)} unit="kg/m²" range={s.ffmiBand80} caption={needsWeight ? undefined : EST.howFfmi(words)} unknownCaption={unknown} animate />
  );
  const maintenance = (
    <Readout
      key="maint"
      label={EST.maintenance}
      value={val(energyIn(m.kcal, energyUnit))}
      decimals={0}
      unit={eUnit}
      range={[energyIn(m.band80[0], energyUnit), energyIn(m.band80[1], energyUnit)]}
      caption={needsWeight ? undefined : EST.howMaintenance(EST.rmr[m.rmrMethod], formatNumber(m.steps, 0), m.sessionsPerWeek)}
      unknownCaption={unknown}
      animate
    />
  );

  let items: ReactNode[];
  if (gentle && !showNumbers) items = [maintenance, lean, ffmi];
  else if (gentle) items = [maintenance, lean, ffmi, bodyFat, fatMass];
  else items = [bodyFat, fatMass, lean, ffmi, maintenance];

  const cells = items.map((node, i) => (
    <div key={i} className="lm-body-est__cell">
      {node}
    </div>
  ));

  return (
    <Faceplate
      id={id}
      className="lm-body-est"
      title={EST.title}
      caption={EST.caption}
      actions={
        s.basedOnAverages && onRefine ? (
          <Chip kind="status" severity="info" onClick={onRefine}>
            {EST.averages}
          </Chip>
        ) : undefined
      }
      footer={<DisclaimerLine bare />}
    >
      <p className="lm-sr" aria-live="polite" aria-atomic="true">
        {spoken}
      </p>
      {wide ? (
        <div className="lm-body-est__grid">{cells}</div>
      ) : (
        <ScrollRail
          className="lm-body-est__rail"
          bleed={false}
          padding={16}
          gap={0}
          role="region"
          aria-label="Body estimates"
          tabIndex={0}
        >
          {cells}
        </ScrollRail>
      )}
      {gentle ? (
        <div className="lm-body-row lm-body-est__gentle">
          <span className="text-xs text-ink-2">{EST.gentleNote}</span>
          <Key size="sm" variant="quiet" aria-expanded={showNumbers} onClick={() => setShowNumbers((x) => !x)}>
            {showNumbers ? EST.hideNumbers : EST.showNumbers}
          </Key>
        </div>
      ) : null}
    </Faceplate>
  );
}
