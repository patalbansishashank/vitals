/** Ring › Activity over any date-control period uses the same steps and workout cards. */
import { useState } from 'react';
import { Dumbbell } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, Stack } from '@/components';
import type { LocalDate } from '@/living';
import { periodSearch, type Period } from '@/features/living/period';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import { useRingActivities } from '../useActivities';
import { ACTIVITY_ROWS_SHOWN, ActivityRow, EnergyBurnedLink } from './ActivityView';
import { StepsHistoryCard } from './StepsHistoryCard';
import { workoutsInfo } from './activityInfo';
import { spanOf } from './periods';

export function ActivityPeriodView({ period, today }: { period: Period; today: string }) {
  const s = spanOf(period, today);
  return (
    <Stack>
      <StepsHistoryCard from={s.from} end={s.end} />
      <EnergyBurnedLink date={s.end} query={periodSearch(period, today as LocalDate).slice(1)} />
      <PeriodActivities key={`${s.from}:${s.end}`} from={s.from} end={s.end} range={s.range} />
    </Stack>
  );
}

function PeriodActivities({ from, end, range }: { from: string; end: string; range: string }) {
  const acts = useRingActivities(from, end);
  const quiet = useQuietMode().on;
  const [all, setAll] = useState(false);
  const n = acts.approved.length;
  const shown = all ? acts.approved : acts.approved.slice(0, ACTIVITY_ROWS_SHOWN);
  return (
    <GradientCard
      as="section"
      domain="steps"
      head={<CardHead as="h2" icon={Dumbbell} title={C.workouts} info={workoutsInfo} />}
      foot={
        <CardFoot
          state={quiet ? undefined : { word: C.countedCount(n) }}
          right={range}
          link={n > shown.length ? { label: C.showAll(n), onClick: () => setAll(true) } : undefined}
        />
      }
    >
      {n ? (
        <ul className="rg-rows">
          {shown.map((a) => (
            <ActivityRow key={a.id} a={a} tz={acts.tz} />
          ))}
        </ul>
      ) : (
        <p className="rg-none">{quiet ? C.noActivitiesQuiet : C.periodNoActivities}</p>
      )}
    </GradientCard>
  );
}
