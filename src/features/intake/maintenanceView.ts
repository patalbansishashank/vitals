/**
 * What the maintenance card shows, from the engine's estimate (pure): rounded headline and band, the driver rows with
 * where each came from, what was assumed, and the "biggest unknown" line. The UI never computes the physiology —
 * every number is `resolveProfile` / `resolveActivity` output (features/body/maintenance.ts).
 */
import { formatNumber } from '@/components/lib/format';
import type { ActivityDriverId, ActivityIntake } from '@/engine/types/profile';
import { maintenanceShown } from '@/features/body/units';
import { explainMaintenance, round10, type MaintenanceEstimate, type MaintenanceExplanation } from '@/features/body/maintenance';
import type { EnergyUnit } from '@/state/settingsStore';
import { DRIVER_LABEL, MAINT } from './copy';

const KJ = 4.184;
export const energyOut = maintenanceShown;
export const fmt = (kcal: number, unit: EnergyUnit): string => formatNumber(energyOut(kcal, unit), 0);
export const unitWord = (unit: EnergyUnit): string => (unit === 'kJ' ? 'kJ' : 'kcal');

export interface DriverRow {
  id: ActivityDriverId;
  label: string;
  kcal: number;
  from: string;
  /** This part rests on a skipped answer. */
  assumed: boolean;
  /** The question that sets it ("change" jumps there); undefined = not an intake answer. */
  question?: string;
  /** "Correct it" path for parts no question sets (resting metabolism → measured). */
  path?: 'measured';
}

/** The question that sets each driver. */
export const DRIVER_QUESTION: Partial<Record<ActivityDriverId, string>> = {
  steps: 'stepsKnown',
  work: 'job',
  home: 'home',
  commute: 'commute',
  recreation: 'sport',
  training: 'trainNow',
};

export function driverRows(m: MaintenanceEstimate, defaulted: readonly ActivityDriverId[] = []): DriverRow[] {
  const act = m.activity;
  if (!act) return [];
  const intake = m.resolved.habits.activity;
  return act.drivers
    .filter((d) => Math.round(d.kcal) !== 0)
    .map((d) => {
      let from = '';
      switch (d.id) {
        case 'rmr':
          from = MAINT.from.rmr[act.base.rmrRoute];
          break;
        case 'dailyLiving':
          from = MAINT.from.dailyLiving;
          break;
        case 'steps':
          from = MAINT.from.steps(formatNumber(Math.round(act.steps / 100) * 100, 0), MAINT.from.stepsSource[act.stepsSource]);
          break;
        case 'work':
          from = act.work === 'notWorking' ? MAINT.from.workNone : MAINT.from.work(act.workDaysPerWeek, act.workHoursPerDay);
          break;
        case 'home':
          from = MAINT.from.home[intake?.onFeetAtHome ?? 'some'];
          break;
        case 'commute':
          from = MAINT.from.commute;
          break;
        case 'recreation':
          from = MAINT.from.recreation;
          break;
        case 'training':
          from = MAINT.from.training(m.sessionsPerWeek);
          break;
        case 'digestion':
          from = MAINT.from.digestion;
          break;
      }
      return {
        id: d.id,
        label: DRIVER_LABEL[d.id],
        kcal: d.kcal,
        from,
        assumed: defaulted.includes(d.id),
        ...(DRIVER_QUESTION[d.id] ? { question: DRIVER_QUESTION[d.id] } : {}),
        ...(d.id === 'rmr' ? { path: 'measured' as const } : {}),
      };
    });
}

export interface MaintenanceView {
  kcal: string;
  lo: string;
  hi: string;
  unit: string;
  headline: string;
  rail: string;
  rows: DriverRow[];
  explanation: MaintenanceExplanation;
  unknownText?: string;
  comparison?: string;
  palNote?: string;
}

export function maintenanceView(m: MaintenanceEstimate, intake: ActivityIntake | undefined, defaulted: readonly ActivityDriverId[], unit: EnergyUnit): MaintenanceView {
  const ex = explainMaintenance(m, intake, defaulted);
  const kcal = fmt(m.kcal, unit);
  const lo = fmt(m.band80[0], unit);
  const hi = fmt(m.band80[1], unit);
  const u = unitWord(unit);
  const b = ex.biggestUnknown;
  const n = b ? formatNumber(round10(unit === 'kJ' ? b.narrowsByKcal * KJ : b.narrowsByKcal), 0) : '';
  const unknownText = b ? (MAINT.unknown[b.driver as keyof typeof MAINT.unknown]?.(n, u) ?? undefined) : undefined;
  return {
    kcal,
    lo,
    hi,
    unit: u,
    headline: MAINT.headline(kcal, lo, hi, u),
    rail: MAINT.rail(kcal, lo, hi),
    rows: driverRows(m, defaulted),
    explanation: ex,
    ...(unknownText ? { unknownText } : {}),
    ...(ex.palBandLabel ? { comparison: MAINT.comparison(MAINT.level[ex.palBandLabel]) } : {}),
    ...(ex.palFlag === 'capped' ? { palNote: MAINT.palCapped } : ex.palFlag === 'high' ? { palNote: MAINT.palHigh } : {}),
  };
}
