/** The Overview's Activity card; Today's compact Steps card shares its goal and source controls. */
import type { ReactNode } from 'react';
import { Footprints } from 'lucide-react';
import { CardHead, ChartTwin, GradientCard, formatNumber } from '@/components';
import { useEnergyUnit, useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import type { RingDay } from '../day';
import { calendarDate } from '../model';
import { ringPaths } from '../paths';
import { useNow } from '../useGauge';
import { useStepsDay } from '../stepsDay';
import { Loading, useUnitPrefs } from '../components/parts';
import { MovementBody, stepsUpdatedCaption } from './Movement';
import { movementFacts, movementInfo } from './activityInfo';
import './activity.css';

export function ActivityCard({
  date,
  day,
  title = C.activity,
  compact = false,
  infoFooter,
}: {
  date: string;
  day: RingDay;
  title?: string;
  compact?: boolean;
  infoFooter?: ReactNode;
}) {
  const quiet = useQuietMode().on;
  const prefs = useUnitPrefs();
  const energyUnit = useEnergyUnit();
  const now = useNow();
  const stepsDay = useStepsDay(date);
  const updated = stepsUpdatedCaption(
    date === calendarDate(now) ? stepsDay.updatedAt : null,
    day.daily?.activity?.lastUpdate ?? null,
    quiet,
    now,
  );
  return (
    <GradientCard
      as="section"
      domain="steps"
      href={ringPaths.tab('activity', date)}
      head={
        <CardHead
          as="h2"
          icon={Footprints}
          title={title}
          info={movementInfo(
            quiet,
            infoFooter,
            quiet ? undefined : (
              <ChartTwin
                data={{
                  title: 'Steps table',
                  head: ['Measure', 'Value'],
                  rows: [
                    ['Steps', day.steps ? formatNumber(day.steps.value, 0) : 'No reading'],
                    ['Goal', formatNumber(day.goals.steps.value, 0)],
                    ['Goal source', day.goals.steps.source],
                  ],
                  caption: 'The selected day’s steps and goal.',
                  fileName: 'vitals-steps.csv',
                }}
              />
            ),
            movementFacts(day, prefs.units, energyUnit),
          )}
        />
      }
    >
      {day.q.status === 'loading' ? (
        <Loading />
      ) : day.q.status === 'ready' ? (
        <MovementBody date={date} day={day} compact={compact} radial={compact} updated={updated} />
      ) : null}
    </GradientCard>
  );
}
