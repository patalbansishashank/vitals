/**
 * What was eaten, drawn (r071 AUDIT §1.2 Food entry 1): the ring for the energy figure and a dotted track for every
 * other target, both over the foundation pictures and both reading the one `intakeModel`. A card with one or two figures
 * (Today's "Eaten so far") draws rings; a card with four or more (Food's Targets) draws the energy ring and one track per
 * other target. A floor says AT LEAST, a target says TARGET; over the goal the ring starts a second lap and the thumb
 * passes the notch (never rose); a lower bound is said as a lower bound and drawn dashed; unknown draws no figure at all.
 */
import type { ReactNode } from 'react';
import { DottedTrack, HeroNumber, MonoMeta, RadialTicks, formatNumber, formatRange, radialPx, type Domain, type RadialSize } from '@/components';
import { quietEaten } from '../format';
import { INTAKE_WHY_TEXT, type IntakeChannel } from '../model/intake';
import './intakeViz.css';

const n = (v: number) => formatNumber(Math.round(v), 0);
const SPOKEN_UNIT: Record<string, string> = { kcal: 'kilocalories', kJ: 'kilojoules', g: 'grams' };
const unitWord = (unit: string): string => SPOKEN_UNIT[unit] ?? unit;

/** "750" (what was eaten, no unit); the dash for an unknown. */
export const intakeValueText = (c: IntakeChannel): string => (c.value === null ? '—' : n(c.value));

/** The goal's words without its kind: "2 050 kcal", "150 g". The pictures put "goal" or "at least" in front themselves, from `kind`. */
export const intakeGoalText = (c: IntakeChannel): string => `${n(c.target)} ${c.unit}`;

/**
 * The one sentence: "Energy: eaten about 750 of 2 050 kcal (range 640–860), 1 300 kcal left". An exact entry reads exactly,
 * an estimate says "about" with its range (never "likely": it is not a probability), a lower bound says "at least", an
 * unknown says why and the target. Quiet: words only, no digit.
 */
export function spokenIntake(c: IntakeChannel, quiet = false): string {
  if (quiet) {
    if (c.value === null) return `${c.label}: ${INTAKE_WHY_TEXT[c.why ?? 'nothingLogged'].toLowerCase()}`;
    return `${c.label}: ${c.id === 'energy' ? quietEaten(c.ratio) : c.ratio >= 1 ? 'reached' : c.ratio >= 0.5 ? 'more than half' : 'less than half'}`;
  }
  if (c.value === null) return `${c.label}: ${INTAKE_WHY_TEXT[c.why ?? 'nothingLogged'].toLowerCase()}, ${c.kind === 'floor' ? 'at least' : 'target'} ${n(c.target)} ${c.unit}`;
  const estimate = c.lo !== undefined && c.hi !== undefined;
  const lead = c.state === 'atLeast' ? 'at least ' : estimate ? 'about ' : '';
  const goal = c.kind === 'floor' ? `at least ${n(c.target)}` : n(c.target);
  const bits = [`eaten ${lead}${n(c.value)} of ${goal} ${c.unit}`];
  if (estimate) bits[0] += ` (range ${formatRange(Math.round(c.lo!), Math.round(c.hi!), 0)})`;
  if (c.state === 'partial') bits.push('partial: some food has no figure for it yet');
  if (c.id === 'energy') {
    const d = c.target - c.value;
    if (c.target > 0) bits.push(d >= 0 ? `${n(d)} ${c.unit} left` : `${n(-d)} ${c.unit} over`);
  } else if (c.over) bits.push('past it');
  return `${c.label}: ${bits.join(', ')}`;
}

export interface IntakeRingProps {
  /** Normally `model.energy`; any channel draws. */
  channel: IntakeChannel;
  /** `md` 120 px (default), `lg` 160, `sm` 72 (no centre number below 100 px: the sentence says it). */
  size?: RadialSize;
  /** Quiet mode: the ring lit to the ratio with no numeral, the centre a word. */
  quiet?: boolean;
  /** The quiet word (default from the ratio: "about a third of today's food" for energy). */
  quietWord?: string;
  animate?: boolean;
  /** Overrides the card's hue for this ring. */
  hue?: Domain;
  /** The centre: the number with its unit (default), or your own node, or nothing. */
  centre?: 'number' | 'none' | ReactNode;
  className?: string;
}

/** The energy ring: ticks lit to what was eaten, the target a longer ivory tick, the likely range a faint arc, a second lap past it. */
export function IntakeRing({ channel: c, size = 'md', quiet = false, quietWord, animate, hue, centre = 'number', className }: IntakeRingProps) {
  const px = radialPx(size);
  const unknown = c.value === null;
  const word = quietWord ?? (c.id === 'energy' ? quietEaten(c.ratio) : undefined);
  const state = unknown ? 'unknown' : c.value === 0 ? 'zero' : c.state === 'atLeast' || c.state === 'partial' ? 'provisional' : 'normal';
  let inside: ReactNode = null;
  if (centre !== 'none' && px >= 100) {
    if (centre !== 'number') inside = centre;
    else if (quiet) inside = word ? <MonoMeta tone="hue">{word}</MonoMeta> : null;
    else if (unknown) inside = <MonoMeta tone="hue">{INTAKE_WHY_TEXT[c.why ?? 'nothingLogged']}</MonoMeta>;
    else {
      const digits = n(c.value!).replace(/\D/g, '').length;
      inside = (
        <>
          <HeroNumber value={Math.round(c.value!)} size={digits <= 3 && px >= 120 ? 'num' : 'time'} numerals="proportional" countUp unit={c.unit} unitPlacement="below" label={`${n(c.value!)} ${unitWord(c.unit)}`} animate={animate} />
          {c.state === 'atLeast' ? <MonoMeta tone="hue">At least</MonoMeta> : null}
        </>
      );
    }
  }
  return (
    <RadialTicks
      className={className}
      label={c.label}
      value={c.value}
      goal={c.target > 0 ? c.target : null}
      goalKind={c.kind}
      unit={c.unit}
      valueText={intakeValueText(c)}
      goalText={intakeGoalText(c)}
      band={!quiet && c.lo !== undefined && c.hi !== undefined ? [c.lo, c.hi] : undefined}
      state={state}
      size={size}
      hue={hue}
      quiet={quiet}
      quietFill="ratio"
      quietWord={word}
      spoken={spokenIntake(c, quiet)}
      animate={animate}
      centre={inside}
    />
  );
}

export interface IntakeTrackProps {
  channel: IntakeChannel;
  /** Quiet mode hides the track, as Today does: a macro in grams is a number. */
  quiet?: boolean;
  animate?: boolean;
  className?: string;
}

/**
 * One target as a dotted track with a thumb: the name left, "32 / 150 g" right in mono meta, 28-odd dots below. A floor
 * says AT LEAST beside its name, a macro that lags energy's coverage says PARTIAL and draws dashed dots, an unknown says
 * why and draws no thumb.
 */
export function IntakeTrack({ channel: c, quiet = false, animate, className }: IntakeTrackProps) {
  if (quiet) return null;
  const unknown = c.value === null;
  const state = unknown ? 'unknown' : c.state === 'atLeast' || c.state === 'partial' ? 'provisional' : 'normal';
  const figure = unknown ? INTAKE_WHY_TEXT[c.why ?? 'nothingLogged'] : `${c.state === 'atLeast' ? 'At least ' : ''}${n(c.value!)} / ${n(c.target)} ${c.unit}`;
  return (
    <div className={['lv-intake', className].filter(Boolean).join(' ')} data-intake={c.id} data-state={c.state} data-kind={c.kind}>
      <div className="lv-intake__head" aria-hidden="true">
        <span className="lv-intake__name">
          {c.label}
          {c.kind === 'floor' ? <MonoMeta size="sm">At least</MonoMeta> : null}
          {c.state === 'partial' ? <MonoMeta size="sm">Partial</MonoMeta> : null}
        </span>
        <MonoMeta tone="hue">{figure}</MonoMeta>
      </div>
      <DottedTrack
        label={c.label}
        value={c.value}
        goal={c.target > 0 ? c.target : null}
        goalKind={c.kind}
        unit={c.unit}
        valueText={unknown ? INTAKE_WHY_TEXT[c.why ?? 'nothingLogged'] : `${c.state === 'atLeast' ? 'at least ' : ''}${n(c.value!)} ${c.unit}`}
        goalText={intakeGoalText(c)}
        band={c.lo !== undefined && c.hi !== undefined ? [c.lo, c.hi] : undefined}
        state={state}
        animate={animate}
      />
    </div>
  );
}
