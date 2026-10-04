import { Faceplate, KeyBank, Stepper, TextInput } from '@/components';
import { PLANNER_HORIZON_MAX, PLANNER_HORIZON_MIN } from '@/state/plannerStore';
import { fmtDateWd } from '../format';
import { addDaysISO } from '../request';

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
 * HorizonPicker (COMPONENTS §4): months bank (28–183 days) + exact weeks + start date, with the computed end date.
 * Unreachable targets are answered after the run with the horizon they would need (time-to-target), so there is no
 * open-ended "as long as it takes" option here.
 */
export function HorizonPicker({ horizonDays, startDate, onHorizon, onStartDate, disabled }: HorizonPickerProps) {
  const weeks = Math.round(horizonDays / 7);
  const preset = PRESETS.find((p) => p.weeks * 7 === horizonDays || (p.weeks === 26 && horizonDays >= 182));
  const end = addDaysISO(startDate, horizonDays - 1);
  return (
    <Faceplate title="Horizon" caption={`${fmtDateWd(startDate)} → ${fmtDateWd(end)}`} className="lp-horizon">
      <div className="lp-horizon__row">
        <KeyBank
          label="Plan length"
          value={preset ? String(preset.weeks) : undefined}
          onChange={(w) => onHorizon(Math.min(PLANNER_HORIZON_MAX, Number(w) * 7))}
          options={PRESETS.map((p) => ({ value: String(p.weeks), label: `${p.months} mo`, disabled }))}
        />
        <div className="lp-horizon__weeks">
          <Stepper
            name="plan length"
            value={weeks}
            onChange={(w) => onHorizon(Math.min(PLANNER_HORIZON_MAX, Math.max(PLANNER_HORIZON_MIN, w * 7)))}
            min={4}
            max={26}
            step={1}
            unit="weeks"
            unitText="weeks"
            disabled={disabled}
          />
        </div>
        <label className="lp-horizon__start">
          <span className="lm-eng">starts</span>
          <TextInput
            type="date"
            value={startDate}
            onChange={(e) => onStartDate(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : null)}
            disabled={disabled}
          />
        </label>
      </div>
    </Faceplate>
  );
}
