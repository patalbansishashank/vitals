/** Activity › Movement over a week or longer: the same steps and activity cards as the day, over the period. */
import { Stack } from '@/components';
import type { Period } from '@/features/living/period';
import { ActivitiesCard } from './ActivityView';
import { StepsHistoryCard } from './StepsHistoryCard';
import { spanOf } from './periods';

export function ActivityPeriodView({ period, today }: { period: Period; today: string }) {
  const s = spanOf(period, today);
  return (
    <Stack>
      <StepsHistoryCard from={s.from} end={s.end} />
      <ActivitiesCard key={`${s.from}:${s.end}`} from={s.from} end={s.end} />
    </Stack>
  );
}
