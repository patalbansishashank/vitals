import { memo } from 'react';
import { Utensils } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, KeyValueList, ResponsivePanel, formatNumber } from '@/components';
import { DEFAULTS } from '@/engine/core/defaults';
import { HABITS, INFO } from '../copy';
import { LOW_FOOD_GLOW } from './glow';
import { trainingHistoryOf } from '../model';
import { HabitsForm, clock, type HabitDefaults, type HabitInputs } from './HabitsForm';

const HISTORY_WORD = { none: 'none', lt1y: 'under 1 year', '1to3y': '1–3 years', gt3y: '3+ years' } as const;

function yearsText(y: number): string {
  return `${formatNumber(y, y % 1 ? 1 : 0)} yr${y === 1 ? '' : 's'}`;
}

/**
 * Summary rows for the Habits card: only what its editor sets (resolved values; defaults where the person gave none).
 * Steps, training sessions and sleep come from "a normal day" (the intake) and show in the maintenance card.
 */
export function habitRows(v: HabitInputs, defaults: HabitDefaults) {
  const h = v.habits;
  const history = trainingHistoryOf(v.training.years);
  const carbs = h.habitualCarbPctEnergy ?? defaults.carbPct;
  const start = h.habitualWindowStartH ?? DEFAULTS.windowStartH;
  const len = h.habitualWindowLengthH ?? DEFAULTS.windowLengthH;
  const rows: Array<{ key: string; value: string }> = [
    {
      key: HABITS.summary.history,
      value: history === undefined ? HABITS.notSet : history === 'none' || v.training.years === null ? HISTORY_WORD[history] : yearsText(v.training.years),
    },
    { key: HABITS.summary.stress, value: h.stress ?? DEFAULTS.stress },
    // usual eating as three short rows (one long "carbs · meals · window" line wrapped inside its time range on phones)
    { key: HABITS.summary.carbs, value: `${Math.round(carbs)} % of energy` },
    { key: HABITS.summary.meals, value: String(h.habitualMealsPerDay ?? DEFAULTS.mealsPerDay) },
    { key: HABITS.summary.window, value: `${clock(start)}–${clock(start + len)}` },
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
}

/**
 * Habits (r071): usual eating, so the food hue. An input card: hairline summary rows with the values at the right, the
 * whole card the tap target and "Edit" its foot link; the editor opens in a Sheet below 1024 px and a side panel from
 * 1024 px, and saves as you change it (its × closes it). Memoised: shape drags skip it.
 */
export const HabitsFace = memo(function HabitsFace({ v, defaults, open, onOpenChange, id }: HabitsFaceProps) {
  return (
    <GradientCard
      id={id}
      className="lm-body-habits-face"
      domain="food"
      glow={LOW_FOOD_GLOW}
      onOpen={() => onOpenChange(true)}
      openLabel={`${HABITS.edit} ${HABITS.title.toLowerCase()}`}
      head={<CardHead icon={Utensils} title={HABITS.title} info={INFO.habits} />}
      foot={<CardFoot link={{ onClick: () => onOpenChange(true), label: HABITS.footEdit }} />}
    >
      <KeyValueList className="lm-body-kv" items={habitRows(v, defaults).map((r) => ({ key: r.key, value: r.value, id: r.key }))} />
      <ResponsivePanel scrim open={open} onClose={() => onOpenChange(false)} title={HABITS.editorTitle} defaultDetent="full" detents={['half', 'full']}>
        <div className="lm-body-panel">
          <HabitsForm v={v} defaults={defaults} />
        </div>
      </ResponsivePanel>
    </GradientCard>
  );
});
