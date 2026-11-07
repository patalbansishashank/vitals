/**
 * Ring › Sleep over a week, a month, a year or a range (r069 U2, r071): the period's nights as the same card as the four
 * weeks (`SleepHistory`): the average night as the number, a bar a night, the goal across; a year draws the 7-day average
 * as a line. The period's dates are the date control's own words, so the card does not repeat them. Six days before the
 * period feed the line's 7-day average. Quiet: words only.
 */
import { WhenReady } from '@/features/ring/components/parts';
import { useSleep } from '@/features/ring/data';
import { useRingDay } from '@/features/ring/day';
import { BARS_MAX_DAYS, LEAD, spanOf } from '@/features/ring/views/periods';
import { RING_COPY as RC } from '@/features/ring/copy';
import type { Period } from '@/features/living/period';
import { useQuietMode } from '@/state/settingsStore';
import { historySeries } from './model';
import { SleepHistory } from './SleepHistory';

export function SleepPeriodView({ period, today }: { period: Period; today: string }) {
  const s = spanOf(period, today);
  const q = useSleep(s.loadFrom, s.end);
  const goals = useRingDay(s.end).goals;
  const quiet = useQuietMode().on;
  return (
    <WhenReady q={q} lines={6}>
      {(data) => {
        const all = historySeries(data.sessions, s.loadFrom, s.end);
        return (
          <SleepHistory
            title={RC.periodSleep}
            dates={all.dates.slice(LEAD)}
            hours={all.hours.slice(LEAD)}
            outline={all.outline.slice(LEAD)}
            lead={all.hours.slice(0, LEAD)}
            goalMin={goals.sleepMin.value}
            quiet={quiet}
            line={s.days.length > BARS_MAX_DAYS}
          />
        );
      }}
    </WhenReady>
  );
}
