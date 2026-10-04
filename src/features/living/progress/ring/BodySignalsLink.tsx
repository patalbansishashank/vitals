/**
 * Progress › the ring's link card (design/screens/ring-pages.md §6.9): one faceplate "Body signals" with three
 * readouts (last night asleep, resting heart rate, steps today) and "Open body signals ›". It replaces the E29 steps
 * and workouts faceplates; the charts live on `/signals`. Values are the resolved days (corrections win); a value
 * that was not recorded says "no data", never 0.
 */
import { useMemo } from 'react';
import { Faceplate, formatNumber, KeyLink } from '@/components';
import { paths } from '@/app/paths';
import { useLivingClock } from '../../clock';
import { useDays } from '@/features/signals/data';
import { SIGNALS_PAGE_COPY } from '@/features/signals/copyPage';
import { dayText, localDateOfMs, referenceDay } from '@/features/signals/models';
import { addDays } from '@/living/dates';
import '@/features/signals/signals.css';

const C = SIGNALS_PAGE_COPY.link;
/** How far back the card looks for last night and a resting heart rate. */
const LOOKBACK_DAYS = 14;

function Cell({ label, value, missing }: { label: string; value: string; missing: boolean }) {
  return (
    <li className="lm-readout" data-size="sm" data-unknown={missing || undefined}>
      <span className="lm-readout__name">
        <span className="lm-eng">{label}</span>
      </span>
      <span className="lm-readout__value lm-num sp-link__value">{value}</span>
    </li>
  );
}

export function BodySignalsLink({ id = 'activity' }: { id?: string }) {
  const today = localDateOfMs(useLivingClock().now().getTime());
  const days = useDays(addDays(today, -(LOOKBACK_DAYS - 1)), today);

  const cells = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.localDate, d] as const));
    // last night: the newest main night that ended today or before (a night belongs to the date it ends)
    const nights = days.filter((d) => d.mainSleep).map((d) => d.localDate);
    const nightDate = nights.length ? referenceDay('sleep', today, nights) : null;
    const asleepS = nightDate ? byDate.get(nightDate)?.mainSleep?.asleep_s : undefined;
    const asleepMin = asleepS !== undefined && Number.isFinite(asleepS) ? Math.round(asleepS / 60) : null;
    // resting heart rate: today's, else the newest recorded day (named)
    const restDay = [...days].reverse().find((d) => d.daily?.resting_hr_bpm !== undefined);
    const rest = restDay?.daily?.resting_hr_bpm;
    const steps = byDate.get(today)?.daily?.steps;
    return [
      {
        key: 'asleep',
        label: nightDate && nightDate !== today ? C.asleepNightTo(dayText(nightDate)) : C.asleepLastNight,
        value: asleepMin !== null ? C.asleep(Math.floor(asleepMin / 60), asleepMin % 60) : C.noData,
        missing: asleepMin === null,
      },
      {
        key: 'resting',
        label: restDay && restDay.localDate !== today ? C.restingOn(dayText(restDay.localDate)) : C.resting,
        value: rest !== undefined ? C.bpm(Math.round(rest)) : C.noData,
        missing: rest === undefined,
      },
      {
        key: 'steps',
        label: C.stepsToday,
        value: steps !== undefined ? formatNumber(Math.round(steps), 0) : C.noDataToday,
        missing: steps === undefined,
      },
    ];
  }, [days, today]);

  return (
    <Faceplate
      id={id}
      className="lv-prog-face"
      title={C.title}
      caption={C.label}
      actions={
        <KeyLink to={paths.signals()} size="sm" variant="quiet" aria-label={C.openName}>
          {C.open}
        </KeyLink>
      }
    >
      <ul className="sp-link__readouts">
        {cells.map((c) => (
          <Cell key={c.key} label={c.label} value={c.value} missing={c.missing} />
        ))}
      </ul>
    </Faceplate>
  );
}
