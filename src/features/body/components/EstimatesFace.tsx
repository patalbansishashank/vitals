import { useState } from 'react';
import { Gauge, Hourglass } from 'lucide-react';
import { CardFoot, CardHead, ChartTwin, GradientCard, HeroNumber, Key, MonoMeta, RollingNumber, StackBar, formatNumber, formatRange, type TwinData } from '@/components';
import type { UnitSystem } from '@/state/settingsStore';
import { EST, INFO } from '../copy';
import type { BodySummary } from '../model';
import { kgToLb } from '@/lib/units';
import { IntervalBar } from './IntervalBar';

/** The two parts of the stacked bar: lean mass in the card's tide, fat in its pale ink, so the pair reads by lightness too. */
const FAT_HUE = 'var(--lm-hue-body-ink)';
const LEAN_HUE = 'var(--lm-hue-body)';

export interface EstimatesFaceProps {
  summary: BodySummary;
  /** Body units: fat and lean mass show in kg or lb (QA: they stayed in kg after switching to imperial). */
  units?: UnitSystem;
  /** Committed sentence for the polite live region (updated on release, not per frame). */
  spoken: string;
  /**
   * Quiet mode or gentle mode: words and pictures first, no digit from a reading; "Show numbers" in the foot brings the
   * numbers back for this card (the setting is not touched).
   */
  calm?: boolean;
  /** The hero's word in the calm form ("as expected": the lean mass index against what the body implies). */
  calmWord?: string;
  id?: string;
}

const upperFirst = (t: string): string => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

/**
 * The card's Table twin (r071): every estimate with its value and its 80 % range, read from the same summary the pictures
 * draw. The (i) panel hosts it under "Data table", and the card's `T` key opens the panel there. Pure.
 */
export function estimatesTwin(s: BodySummary, units: UnitSystem = 'metric'): TwinData {
  const imperial = units === 'imperial';
  const mass = (kg: number) => (imperial ? kgToLb(kg) : kg);
  const mu = imperial ? 'lb' : 'kg';
  const row = (label: string, value: number, unit: string, band: readonly [number, number]): Array<string | number> => [
    label,
    `${formatNumber(value, 1)} ${unit}`,
    `${formatRange(band[0], band[1], 1)} ${unit}`,
  ];
  return {
    title: EST.table.title,
    caption: `${EST.title}: body fat ${formatNumber(s.bodyFatPct, 1)} %, fat mass ${formatNumber(mass(s.fatMassKg), 1)} ${mu}, lean mass ${formatNumber(mass(s.leanMassKg), 1)} ${mu}, lean mass index ${formatNumber(s.ffmi, 1)} kg/m²`,
    head: [...EST.table.head],
    rows: [
      row(EST.bodyFat, s.bodyFatPct, '%', s.bodyFatBand80),
      row(EST.fatMass, mass(s.fatMassKg), mu, [mass(s.fatMassBand80[0]), mass(s.fatMassBand80[1])]),
      row(EST.leanMass, mass(s.leanMassKg), mu, [mass(s.leanMassBand80[0]), mass(s.leanMassBand80[1])]),
      row(EST.ffmi, s.ffmi, 'kg/m²', s.ffmiBand80),
    ],
    fileName: EST.table.file,
    rowNoun: ['estimate', 'estimates'],
  };
}

/**
 * Estimates (r071; your-body.md §6): body fat as the hero with its 80 % range as a scale under it, one stacked bar of fat
 * and lean mass, then fat mass, lean mass and lean mass index as three smaller readouts with their own thin scales. The
 * foot says the state (Calibrating while the estimates rest on population averages only, Needs weight without a weight)
 * and what the scales show. Maintenance has its own card.
 *
 * Calm (quiet or gentle): the hero is a word about the lean mass index, the scale and the bar carry no numeral, and the
 * body-fat and fat-mass numbers wait behind "Show numbers".
 */
export function EstimatesFace({ summary: s, units = 'metric', spoken, calm = false, calmWord, id }: EstimatesFaceProps) {
  const [showNumbers, setShowNumbers] = useState(false);
  const needsWeight = s.missing.includes('weight');
  const calibrating = !needsWeight && s.basedOnAverages;
  const quiet = calm && !showNumbers;
  const imperial = units === 'imperial';
  const massUnit = imperial ? 'lb' : 'kg';
  const mass = (kg: number) => (imperial ? kgToLb(kg) : kg);
  const massText = (kg: number) => `${formatNumber(mass(kg), 1)} ${massUnit}`;
  const [fat, lean] = [s.fatMassKg, s.leanMassKg];
  const total = fat + lean;
  const [bfLo, bfHi] = s.bodyFatBand80;

  const stateWord = needsWeight ? EST.state.needsWeight : calibrating ? EST.state.calibrating : EST.state.estimate;
  const foot = (
    <CardFoot state={{ word: stateWord, ...(calibrating ? { icon: Hourglass } : {}) }} right={needsWeight || quiet ? undefined : EST.range}>
      {calm && !needsWeight ? (
        <Key variant="text" size="sm" aria-pressed={showNumbers} onClick={() => setShowNumbers((x) => !x)}>
          {showNumbers ? EST.hideNumbers : EST.showNumbers}
        </Key>
      ) : null}
    </CardFoot>
  );
  // the Table twin is numbers: the quiet form has none, and a missing weight has nothing to tabulate
  const head = <CardHead icon={Gauge} title={EST.title} info={quiet || needsWeight ? INFO.estimates : { ...INFO.estimates, twin: <ChartTwin data={estimatesTwin(s, units)} /> }} />;
  const live = (
    <p className="lm-sr" aria-live="polite" aria-atomic="true">
      {spoken}
    </p>
  );

  if (needsWeight) {
    return (
      <GradientCard id={id} className="lm-body-est" domain="body" head={head} foot={foot}>
        {live}
        <HeroNumber value={null} size="num-l" label={`${EST.heroLabel} ${EST.needsWeight}`} />
        <MonoMeta tone="hue">{EST.heroLabel}</MonoMeta>
      </GradientCard>
    );
  }

  const split = (
    <StackBar
      label={EST.splitLabel}
      size="sm"
      legend={quiet ? 'inline' : 'none'}
      quiet={quiet}
      total={massText(total)}
      rows={[
        { id: 'fat', label: EST.fat, valueText: massText(fat), share: fat / total, hue: FAT_HUE },
        { id: 'lean', label: EST.lean, valueText: massText(lean), share: lean / total, hue: LEAN_HUE },
      ]}
    />
  );

  if (quiet) {
    return (
      <GradientCard id={id} className="lm-body-est" domain="body" data-calm="" head={head} foot={foot}>
        {live}
        <div className="lm-body-est__lead">
          <HeroNumber quietWord={upperFirst(calmWord ?? EST.state.estimate)} size="num-l" label={`${EST.quietLabel}: ${calmWord ?? EST.state.estimate}`} />
          <MonoMeta tone="hue">{EST.quietLabel}</MonoMeta>
        </div>
        <IntervalBar quiet low={s.ffmiBand80[0]} high={s.ffmiBand80[1]} value={s.ffmi} />
        {split}
      </GradientCard>
    );
  }

  const cell = (key: string, label: string, value: number, unit: string, range: readonly [number, number], hue?: string) => (
    <div key={key} className="lm-body-est__cell">
      <MonoMeta className="lm-body-est__name">
        {hue ? <i className="lm-body-est__sw" style={{ background: hue }} aria-hidden="true" /> : null}
        <span>{label}</span>
      </MonoMeta>
      <p className="lm-body-est__v">
        <span className="lm-sr">{`${label} ${formatNumber(value, 1)} ${unit}, likely ${formatRange(range[0], range[1], 1)}`}</span>
        <RollingNumber text={formatNumber(value, 1)} />
        <span className="lm-body-est__u" aria-hidden="true">
          {unit}
        </span>
      </p>
      <IntervalBar size="thin" low={range[0]} high={range[1]} value={value} />
      <MonoMeta tone="hue" className="lm-body-est__range" aria-hidden="true">
        {formatRange(range[0], range[1], 1)}
      </MonoMeta>
    </div>
  );
  const massBand = (b: readonly [number, number]): [number, number] => [mass(b[0]), mass(b[1])];

  return (
    <GradientCard id={id} className="lm-body-est" domain="body" head={head} foot={foot}>
      {live}
      <div className="lm-body-est__lead">
        <HeroNumber
          value={s.bodyFatPct}
          decimals={1}
          unit="%"
          size="num-l"
          label={`${EST.heroLabel} ${formatNumber(s.bodyFatPct, 1)} percent, likely ${formatRange(bfLo, bfHi, 1).replace('–', ' to ')}`}
        />
        <MonoMeta tone="hue">{EST.heroLabel}</MonoMeta>
      </div>
      <IntervalBar low={bfLo} high={bfHi} value={s.bodyFatPct} />
      {split}
      <div className="lm-body-est__grid" role="group" aria-label={EST.regionLabel}>
        {cell('fm', EST.fatMass, mass(fat), massUnit, massBand(s.fatMassBand80), FAT_HUE)}
        {cell('lm', EST.leanMass, mass(lean), massUnit, massBand(s.leanMassBand80), LEAN_HUE)}
        {cell('ffmi', EST.ffmi, s.ffmi, 'kg/m²', s.ffmiBand80)}
      </div>
    </GradientCard>
  );
}
