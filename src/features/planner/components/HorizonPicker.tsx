import { Faceplate } from '@/components';
import { HorizonField } from '@/features/components/HorizonField';
import { PLANNER_HORIZON_MAX } from '@/state/plannerStore';
import { fmtDate, fmtWeeks } from '../format';
import { addDaysISO } from '../request';

/** Months → weeks (the Simulator's presets: 6 months is 26 weeks). */
const PRESETS = [
  { months: 1, weeks: 4 },
  { months: 2, weeks: 8 },
  { months: 3, weeks: 12 },
  { months: 4, weeks: 16 },
  { months: 6, weeks: 26 },
] as const;

export interface HorizonPickerProps {
  horizonDays: number;
  startDate: string;
  onHorizon: (days: number) => void;
  onStartDate: (iso: string | null) => void;
  disabled?: boolean;
}

/**
 * HorizonPicker (COMPONENTS §4): the Simulator's control (HorizonField: a months bank and one date chip "19 Oct →
 * 7 Feb" that opens the platform date picker for the start) on a card whose caption is the length. Other lengths (a
 * "Before you run" extension) leave the bank unset and show in the caption. Unreachable targets are answered after the
 * run with the horizon they would need.
 */
export function HorizonPicker({ horizonDays, startDate, onHorizon, onStartDate, disabled }: HorizonPickerProps) {
  const preset = PRESETS.find((p) => p.weeks * 7 === horizonDays || (p.weeks === 26 && horizonDays >= 182));
  return (
    <Faceplate title="Horizon" caption={fmtWeeks(horizonDays)} className="lp-horizon">
      <HorizonField
        label="Plan length"
        months={PRESETS.map((p) => p.months)}
        value={preset?.months}
        onMonths={(m) => onHorizon(Math.min(PLANNER_HORIZON_MAX, (PRESETS.find((p) => p.months === m)?.weeks ?? 12) * 7))}
        startDate={startDate}
        endDate={addDaysISO(startDate, horizonDays - 1)}
        formatDate={fmtDate}
        onStartDate={onStartDate}
        disabled={disabled}
      />
    </Faceplate>
  );
}
