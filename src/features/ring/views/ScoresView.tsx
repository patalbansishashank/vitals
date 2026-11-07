/** Ring › Scores: a Day score, three source-labelled heroes, and Gauge's separate methods. */
import { Stack } from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { useVitalsIndexHistory } from '../history';
import { useScores } from '../data';
import { useRingDay } from '../day';
import { daysFrom, shiftDate } from '../model';
import { WhenReady } from '../components/parts';
import { DayScoreCard } from './DayScoreCard';
import { GaugeScoreCards, VitalsScoreCards } from './ScoreCards';

export function ScoresView({ date }: { date: string }) {
  const from = shiftDate(date, -55);
  const q = useScores(from, date);
  const day = useRingDay(date);
  const quiet = useQuietMode().on;
  const history = useVitalsIndexHistory(date, { stepGoal: day.goals.steps.value, sleepGoalMin: day.goals.sleepMin.value });
  return <div className="rgs-page"><Stack>
    <DayScoreCard date={date} day={day} link={false} parts="none" trend={history} />
    <VitalsScoreCards scores={day.scores} history={history} quiet={quiet} />
    <WhenReady q={q} lines={6}>{(sc) => <GaugeScoreCards data={sc} dates={daysFrom(from, date)} quiet={quiet} />}</WhenReady>
  </Stack></div>;
}
