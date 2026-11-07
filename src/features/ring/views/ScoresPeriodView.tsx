/** Scores over the selected dates, with each score compared only with its own source's history. */
import { Stack } from '@/components';
import { type Period } from '@/features/living/period';
import { useQuietMode } from '@/state/settingsStore';
import { useScores } from '../data';
import { useRingDay } from '../day';
import { VITALS_PERIOD_MAX_DAYS, useVitalsIndexHistory } from '../history';
import { WhenReady } from '../components/parts';
import { GaugeScoreCards, VitalsScoreCards } from './ScoreCards';
import { spanOf } from './periods';

export function ScoresPeriodView({ period, today }: { period: Period; today: string }) {
  const span = spanOf(period, today);
  const q = useScores(span.from, span.end);
  const quiet = useQuietMode().on;
  const day = useRingDay(span.end);
  const n = Math.min(span.days.length, VITALS_PERIOD_MAX_DAYS);
  const history = useVitalsIndexHistory(span.end, { stepGoal: day.goals.steps.value, sleepGoalMin: day.goals.sleepMin.value }, n);
  return <div className="rgs-page"><Stack>
    <VitalsScoreCards scores={day.scores} history={history} quiet={quiet} period />
    <WhenReady q={q} lines={6}>{(sc) => <GaugeScoreCards data={sc} dates={span.days} quiet={quiet} period />}</WhenReady>
  </Stack></div>;
}
