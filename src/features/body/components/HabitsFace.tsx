import { memo, type ReactNode } from 'react';
import { Faceplate, Key, KeyValueList, ResponsivePanel, formatNumber } from '@/components';
import { DEFAULTS } from '@/engine/core/defaults';
import { HABITS } from '../copy';
import { trainingHistoryOf } from '../model';
import { HabitsForm, clock, type HabitDefaults, type HabitInputs } from './HabitsForm';

const HISTORY_WORD = { none: 'none', lt1y: 'under 1 year', '1to3y': '1–3 years', gt3y: '3+ years' } as const;

function yearsText(y: number): string {
  return `${formatNumber(y, y % 1 ? 1 : 0)} yr${y === 1 ? '' : 's'}`;
}

/**
 * Summary rows for the Habits faceplate (resolved values; defaults where the user gave none). `resolvedSteps` = the
 * engine's weekly-mean steps when "a normal day" was answered (it then wins over the old typical-steps tick).
 */
export function habitRows(v: HabitInputs, defaults: HabitDefaults, resolvedSteps?: number) {
  const h = v.habits;
  const history = trainingHistoryOf(v.training.years);
  const sessions = h.sessionsPerWeek ?? 0;
  const lift = Math.round((1 - (h.lifingCardioMix ?? 0.5)) * 100);
  const carbs = h.habitualCarbPctEnergy ?? defaults.carbPct;
  const start = h.habitualWindowStartH ?? DEFAULTS.windowStartH;
  const len = h.habitualWindowLengthH ?? DEFAULTS.windowLengthH;
  const rows: Array<{ key: string; value: string }> = [
    {
      key: HABITS.summary.history,
      value:
        history === undefined
          ? HABITS.notSet
          : `${history === 'none' || v.training.years === null ? HISTORY_WORD[history] : yearsText(v.training.years)} · ${sessions}/week`,
    },
    { key: HABITS.summary.type, value: sessions > 0 ? `lifting ${lift} % · cardio ${100 - lift} %` : 'no sessions' },
    { key: HABITS.summary.steps, value: `${formatNumber(resolvedSteps !== undefined ? Math.round(resolvedSteps / 100) * 100 : (h.typicalSteps ?? DEFAULTS.steps), 0)} / day` },
    {
      key: HABITS.summary.sleep,
      value: `${clock(h.bedTimeH ?? DEFAULTS.bedTimeH)} → ${clock(h.wakeTimeH ?? DEFAULTS.wakeTimeH)} · ${h.sleepQuality ?? DEFAULTS.sleepQuality}`,
    },
    { key: HABITS.summary.stress, value: h.stress ?? DEFAULTS.stress },
    {
      key: HABITS.summary.eating,
      value: `carbs ${Math.round(carbs)} % · ${h.habitualMealsPerDay ?? DEFAULTS.mealsPerDay} meals · ${clock(start)}–${clock(start + len)}`,
    },
  ];
  if (v.sex === 'female') {
    rows.push({
      key: HABITS.summary.cycle,
      value: v.menopause === 'post' ? 'after menopause' : v.cycle.tracking ? `tracked · ${v.cycle.cycleLengthD ?? 28} days` : 'not tracked',
    });
  }
  return rows;
}

export interface HabitsFaceProps {
  v: HabitInputs;
  defaults: HabitDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id?: string;
  /** "A normal day" (intake) summary with its edit link, shown first. */
  normalDay?: ReactNode;
  /** Reminder chip for questions asked later. */
  chip?: ReactNode;
  /** Engine weekly-mean steps when the intake set them. */
  resolvedSteps?: number;
}

/** Habits summary; "Edit" opens the editor (Sheet below 1024 px, side panel from 1024 px). Memoised: shape drags skip it. */
export const HabitsFace = memo(function HabitsFace({ v, defaults, open, onOpenChange, id, normalDay, chip, resolvedSteps }: HabitsFaceProps) {
  return (
    <Faceplate
      id={id}
      className="lm-body-habits-face"
      title={HABITS.title}
      actions={
        <>
          {chip}
          <Key variant="quiet" size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(true)}>
            {HABITS.edit}
          </Key>
        </>
      }
    >
      {normalDay}
      <KeyValueList items={habitRows(v, defaults, resolvedSteps).map((r) => ({ key: r.key, value: r.value, id: r.key }))} />
      <ResponsivePanel open={open} onClose={() => onOpenChange(false)} title={HABITS.editorTitle} defaultDetent="full" detents={['half', 'full']}
        footer={
          <Key variant="solid" onClick={() => onOpenChange(false)}>
            {HABITS.done}
          </Key>
        }
      >
        <div className="lm-body-panel">
          <HabitsForm v={v} defaults={defaults} />
        </div>
      </ResponsivePanel>
    </Faceplate>
  );
});
