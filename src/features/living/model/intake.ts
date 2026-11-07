/**
 * What was eaten against the day's targets, as ONE model (r071 AUDIT §1.2 Food entry 1, §6.2 package 0B). Today's "Eaten
 * so far", Food's Targets, the planless Today and the widgets all read this, so the number, the likely range, the kind
 * (a target, or a floor that more is fine for) and what is not known can never disagree between screens.
 *
 * It wraps `intakeFigures` (src/features/living/today/model.ts, left as it is) for energy and protein, applies the same
 * rules to carbs, fat and fibre, and adds what TargetsFace worked out for itself: the likely range, the lag of a macro's
 * coverage behind energy's (the word "partial"), the day's food status and what is left. Pure: no React, no store reads.
 *
 * Unknown is never zero (A.3.3, §1.2): a channel with nothing known says why and has no value. A lower bound ("at least
 * 32 g", when every meal's energy is known but some meal's protein is not) is its own state and is never drawn as exact.
 */
import { toEnergyUnit, type EnergyUnitChoice } from '@/components/lib/energy';
import type { PrescribedDaySnapshot, TodayView } from '@/living';
import type { ChannelCoverage, ChannelCoverageMap, DayIntakeAttestation, ExposureChannel } from '@/lib/bodyContracts';
import { likely } from '../format';
import { intakeFigures, type IntakeFigure } from '../today/model';

export type IntakeId = 'energy' | 'protein' | 'carbs' | 'fat' | 'fibre';
/** A target is a mark to land near; a floor ("at least") is one more is fine for. Neither is styled as good or bad. */
export type IntakeKind = 'target' | 'floor';
/** `value`: a figure · `atLeast`: a lower bound · `partial`: the figure is known but the macro lags energy's coverage · `unknown`: nothing known. */
export type IntakeState = 'value' | 'atLeast' | 'partial' | 'unknown';
export type IntakeWhy = 'nothingLogged' | 'notInFood';

export interface IntakeChannel {
  id: IntakeId;
  /** "Energy", "Protein", "Carbs", "Fat", "Fibre". */
  label: string;
  /** What was eaten, in `unit`; null when nothing is known (never 0 for "unknown"). */
  value: number | null;
  /** The likely range (80 %), only for an estimate (sd > 0), in `unit`. */
  lo?: number;
  hi?: number;
  /** The day's target (a floor's minimum), in `unit`. */
  target: number;
  kind: IntakeKind;
  state: IntakeState;
  /** Why it is unknown. */
  why?: IntakeWhy;
  /** `kcal` or `kJ` for energy, `g` for the rest. */
  unit: string;
  /** value / target, not capped (over 1 is a second lap on a ring, a thumb past the notch on a track); 0 when unknown or no target. */
  ratio: number;
  /** Past the target (a floor: past its minimum). Information, never a fault. */
  over: boolean;
}

export type IntakeStatus = 'Not logged' | 'Partial' | 'Complete' | 'No intake';

export interface IntakeModel {
  /** Energy, protein, carbs, fat, fibre, in that order. */
  channels: IntakeChannel[];
  energy: IntakeChannel;
  protein: IntakeChannel;
  carbs: IntakeChannel;
  fat: IntakeChannel;
  fibre: IntakeChannel;
  /** At least one meal is logged. */
  logged: boolean;
  /** The day's food status (C1/D5-01): the person's own report, else Partial once anything is logged. */
  status: IntakeStatus;
  /** What is left of the energy target, or how far past it; null before anything is known or without a target. */
  left: { amount: number; over: boolean; unit: string } | null;
  /** The plan gives the day an energy target (a zero-energy fast day has none). */
  hasTargets: boolean;
}

export type IntakeView = Pick<TodayView, 'logged' | 'coverage'> & Partial<Pick<TodayView, 'intake'>>;
export type IntakeRx = Pick<PrescribedDaySnapshot, 'energyKcal' | 'macros'>;

const LABEL: Record<IntakeId, string> = { energy: 'Energy', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fibre: 'Fibre' };
const KIND: Record<IntakeId, IntakeKind> = { energy: 'target', protein: 'floor', carbs: 'target', fat: 'target', fibre: 'target' };
const CHANNEL: Record<IntakeId, ExposureChannel> = { energy: 'energy', protein: 'protein', carbs: 'carbohydrate', fat: 'fat', fibre: 'fibre' };

const CONFIRMS = new Set<ChannelCoverage | string>(['complete', 'confirmedZero']);
const COVERAGE_RANK: Readonly<Record<ChannelCoverage, number>> = { unknown: 0, partial: 1, asPlannedEstimate: 2, complete: 3, confirmedZero: 3 };

/**
 * Whether a channel's coverage lags the day's energy coverage (D6-02/D6-03): some logged food has energy but no figure
 * for it, so its total is a known lower amount. Without a coverage map nothing is claimed either way. (The same rule as
 * `macroLags` in food/components/TargetsFace.tsx; a test keeps the two equal.)
 */
export function coverageLags(coverage: ChannelCoverageMap | null | undefined, channel: ExposureChannel): boolean {
  if (!coverage || !coverage.energy) return false;
  return COVERAGE_RANK[coverage[channel] ?? 'unknown'] < COVERAGE_RANK[coverage.energy];
}

/** The day's food status word (C1/D5-01). (Equal to `dayFoodStatus` in TargetsFace; a test keeps them equal.) */
export function intakeStatus(logged: boolean, intake?: DayIntakeAttestation | null): IntakeStatus {
  if (intake === 'none') return logged ? 'Partial' : 'No intake';
  if (intake === 'complete' && logged) return 'Complete';
  return logged ? 'Partial' : 'Not logged';
}

/** The figure rule of `intakeFigures`, for any nutrient: confirmed, a lower bound, an observed amount, or unknown with its reason. */
function figureOf(channel: ExposureChannel, amount: number, energyKcal: number, hasMeal: boolean, coverage: ChannelCoverageMap | undefined): IntakeFigure {
  if (CONFIRMS.has(coverage?.[channel] ?? '')) return { kind: 'value', value: amount };
  if (coverage?.energy === 'complete' && coverage[channel] === 'partial') return amount > 0 ? { kind: 'atLeast', value: amount } : { kind: 'unknown', why: 'notInFood' };
  if (amount > 0) return { kind: 'value', value: amount };
  return { kind: 'unknown', why: energyKcal > 0 || hasMeal ? 'notInFood' : 'nothingLogged' };
}

export interface IntakeOptions {
  /** Energy in the person's unit (Settings › Units › energy). The ratios do not change. Default kcal. */
  energyUnit?: EnergyUnitChoice;
}

/**
 * The model for a day. `rx` null (no plan for the day) gives targets of 0 and `hasTargets` false: the card decides what
 * a day without targets shows.
 */
export function intakeModel(view: IntakeView, rx: IntakeRx | null | undefined, opts: IntakeOptions = {}): IntakeModel {
  const eu = opts.energyUnit ?? 'kcal';
  const cov = view.coverage;
  const totals = view.logged.totals;
  const hasMeal = view.logged.entries.some((e) => e.kind === 'meal');
  const kcalLogged = totals.energyKcal.value;
  const base = intakeFigures(view);
  const m = rx?.macros;
  const spec: Array<{ id: IntakeId; est: { value: number; sd: number }; target: number; figure: IntakeFigure; unit: string; scale: (v: number) => number }> = [
    { id: 'energy', est: totals.energyKcal, target: rx?.energyKcal ?? 0, figure: base.eaten, unit: eu, scale: (v) => toEnergyUnit(v, eu) },
    { id: 'protein', est: totals.proteinG, target: m?.proteinG ?? 0, figure: base.protein, unit: 'g', scale: (v) => v },
    { id: 'carbs', est: totals.carbG, target: m?.carbG ?? 0, figure: figureOf('carbohydrate', totals.carbG.value, kcalLogged, hasMeal, cov), unit: 'g', scale: (v) => v },
    { id: 'fat', est: totals.fatG, target: m?.fatG ?? 0, figure: figureOf('fat', totals.fatG.value, kcalLogged, hasMeal, cov), unit: 'g', scale: (v) => v },
    {
      id: 'fibre',
      est: totals.fibreG ?? { value: 0, sd: 0 },
      target: m?.fibreG ?? 0,
      // fibre only counts foods that carry a fibre value: nothing counted is unknown, not zero
      figure: ((): IntakeFigure => {
        const f = totals.fibreG ?? { value: 0, sd: 0 };
        const counted = hasMeal && (f.value > 0 || f.sd > 0);
        return counted ? figureOf('fibre', f.value, kcalLogged, hasMeal, cov) : { kind: 'unknown', why: hasMeal ? 'notInFood' : 'nothingLogged' };
      })(),
      unit: 'g',
      scale: (v) => v,
    },
  ];
  const channels = spec.map<IntakeChannel>((s) => {
    const target = s.scale(s.target);
    const known = s.figure.kind !== 'unknown';
    const value = s.figure.kind === 'unknown' ? null : s.scale(s.figure.value);
    const state: IntakeState = s.figure.kind === 'unknown' ? 'unknown' : s.figure.kind === 'atLeast' ? 'atLeast' : hasMeal && coverageLags(cov, CHANNEL[s.id]) && s.id !== 'energy' ? 'partial' : 'value';
    const est = known && s.est.sd > 0 ? likely(s.est.value, s.est.sd) : null;
    const ratio = value !== null && target > 0 ? value / target : 0;
    return {
      id: s.id,
      label: LABEL[s.id],
      value,
      ...(est ? { lo: s.scale(est.lo), hi: s.scale(est.hi) } : {}),
      target,
      kind: KIND[s.id],
      state,
      ...(s.figure.kind === 'unknown' ? { why: s.figure.why } : {}),
      unit: s.unit,
      ratio,
      over: value !== null && target > 0 && value > target,
    };
  });
  const [energy, protein, carbs, fat, fibre] = channels as [IntakeChannel, IntakeChannel, IntakeChannel, IntakeChannel, IntakeChannel];
  const hasTargets = (rx?.energyKcal ?? 0) > 0;
  const left = hasTargets && energy.value !== null ? { amount: Math.abs(energy.target - energy.value), over: energy.value > energy.target, unit: energy.unit } : null;
  return { channels, energy, protein, carbs, fat, fibre, logged: hasMeal, status: intakeStatus(hasMeal, view.intake), left, hasTargets };
}

/** The words for a channel that is unknown (Today's INTAKE_UNKNOWN_TEXT, kept in step by a test). */
export const INTAKE_WHY_TEXT: Record<IntakeWhy, string> = { nothingLogged: 'Nothing logged yet', notInFood: 'Not known for what was logged' };
