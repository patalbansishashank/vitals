/**
 * The sleep page (SPEC A.3.4 item 3, r071): one set of cards, rendered by Ring › Sleep and by `/sleep[/:date]` (a redirect).
 * Last night first: the night in the page's one ring and the hypnogram, the whole night with its break. Then WHEN
 * (`TimingCard`), what the night did to the signals (`OvernightCard`), the night's heart rate (`SleepHrCard`) and the
 * four weeks (`SleepHistory`). The Indices card is gone: the Sleep index is one link under the night, the Recovery index
 * lives on Scores. Cards sit in one column on a phone and in a row-aligned grid on a wide page: the night full width,
 * Timing beside Overnight, the heart rate and the history full width. No "unsupported" chips: tosses and turns and
 * breathing rate are absent (A.0).
 */
import { Faceplate } from '@/components';
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { useQuietMode } from '@/state/settingsStore';
import { Loading } from '@/features/ring/components/parts';
import { useBaselines, useDaily, useSleep } from '@/features/ring/data';
import { useGoals } from '@/features/ring/goals';
import { ringScores } from '@/features/ring/indices';
import { mainSession, shiftDate } from '@/features/ring/model';
import { ringPaths } from '@/features/ring/paths';
import { SLEEP_COPY as C } from './copy';
import { useSleepEntry } from './entry';
import { nightView, historySeries, nightFact, avgReadings } from './model';
import { NightCard } from './NightCard';
import { OvernightCard } from './OvernightCard';
import { SleepHistory } from './SleepHistory';
import { SleepHrCard } from './SleepHrCard';
import { TimingCard } from './TimingCard';
import './sleep.css';

export { nightFact, avgReadings };

export function SleepSections({ date, today }: { date: string; today: string }) {
  const from = shiftDate(date, -27);
  const q = useSleep(from, date);
  const b = useBaselines(date);
  const daily = useDaily(date);
  const goals = useGoals(date, daily.data?.activity?.ringStepGoal ?? null);
  const quiet = useQuietMode().on;
  const night = q.data ? mainSession(q.data.sessions, date) : null;
  const baselines = b.status === 'ready' ? b.data : null;
  const entry = useSleepEntry(date);
  if (q.status === 'loading') return <Loading lines={6} />;
  if (q.status === 'unavailable') return null;
  const title = date === today ? C.lastNight : C.nightOf(fmtDay(shiftDate(date, -1) as LocalDate));
  const series = historySeries(q.data!.sessions, from, date);
  const history = <SleepHistory title={C.history} dates={series.dates} hours={series.hours} outline={series.outline} goalMin={goals.sleepMin.value} quiet={quiet} />;
  if (!night)
    return (
      <div className="sl-page">
        <div className="sl-grid">
          <div className="sl-cell" data-area="night">
            <Faceplate title={title} className="rg-card">
              <p className="rg-none">{C.noSleep}</p>
            </Faceplate>
          </div>
          <div className="sl-cell" data-area="history">
            {history}
          </div>
        </div>
      </div>
    );
  const v = nightView({ session: night, baselines, plan: goals.sleepPlan, entry });
  const extra = q.data!.sessions.filter((s) => s.wakingDate === date && s !== night);
  // the Sleep index of the night: its home is Scores, one link under the night leads there
  const scores = ringScores({ night, baselines, steps: null, stepGoal: goals.steps.value, sleepGoalMin: goals.sleepMin.value, legacy: daily.data?.scores ?? null });
  return (
    <div className="sl-page">
      <div className="sl-grid">
        <div className="sl-cell" data-area="night">
          <NightCard
            v={v}
            title={title}
            goalMin={goals.sleepMin.value}
            goalSource={goals.sleepMin.source}
            extra={extra}
            quiet={quiet}
            index={{ value: scores.sleep.value, legacy: scores.source === 'legacy' }}
            scoresHref={ringPaths.tab('scores', date === today ? undefined : date)}
          />
        </div>
        <div className="sl-cell" data-area="timing">
          <TimingCard v={v} baselines={baselines} date={date} quiet={quiet} />
        </div>
        <div className="sl-cell" data-area="overnight">
          <OvernightCard v={v} baselines={baselines} date={date} quiet={quiet} />
        </div>
        <div className="sl-cell" data-area="hr">
          <SleepHrCard v={v} baselines={baselines} quiet={quiet} />
        </div>
        <div className="sl-cell" data-area="history">
          {history}
        </div>
      </div>
    </div>
  );
}
