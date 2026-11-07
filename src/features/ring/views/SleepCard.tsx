/**
 * The Sleep card of the Ring overview, and Today's "Sleep" (r071, AUDIT cards 2 and 30): last night as ONE number (the
 * night's `SleepHero`, no ring: the Overview's one ring is the Day score), the night drawn once (the hypnogram in the stage
 * hues, the whole recorded night with its break) and once as shares (one stage bar), the goal in the foot. The whole card
 * opens Ring › Sleep. `compact` is Today's form: the number, a small hypnogram, the goal.
 */
import { useMemo, type ReactNode } from 'react';
import { MoonStar } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, MonoMeta } from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { SleepHero } from '@/features/living/sleep/SleepHero';
import type { NightView } from '@/features/living/sleep/model';
import { RING_COPY as C } from '../copy';
import type { RingDay } from '../day';
import { RING_DOMAIN } from '../domains';
import { sleepInfo } from '../info/overview';
import { calendarDate, minutesText } from '../model';
import { sleepPath } from '../paths';
import { sleepGoalWord } from '../quiet';
import { hypnogramTwin } from '../twins';
import { useNow } from '../useGauge';
import { Hypnogram, sessionStageSpans } from '../components/RingCharts';
import { Loading } from '../components/parts';
import './overview.css';

/**
 * (r064 VIZ) The night as a four-level hypnogram over the recorded window: the same `Hypnogram` as the Sleep tab (its
 * smoothing is display only, its table is the card's (i) panel, a night in two parts keeps its break as the hatched
 * "No stage" band).
 */
export function NightStrip({ v, height = 96 }: { v: NightView; height?: number }) {
  const quiet = useQuietMode().on;
  return <Hypnogram session={v.session} from={v.windowStart} to={v.windowEnd} height={height} quiet={quiet} className="rgo-nightstrip" />;
}

/** The goal in the foot's words: "Goal met", "4 min short", "Goal unclear"; quiet: a word with no figure. */
export function sleepFootWord(v: NightView, goalMin: number, quiet: boolean): string {
  if (quiet) return sleepGoalWord(v.tstLower, goalMin, v.tstUpper);
  return v.joined?.vsGoal.text ?? (v.tstLower >= goalMin ? 'Goal met' : `${Math.round(goalMin - v.tstLower)} min short`);
}

export function SleepCard({ date, day, compact = false, infoFooter }: { date: string; day: RingDay; /** Today's form: the number, a small hypnogram, the goal. */ compact?: boolean; infoFooter?: ReactNode }) {
  const quiet = useQuietMode().on;
  const today = calendarDate(useNow());
  const v = day.night;
  const goalMin = day.goals.sleepMin.value;
  const ready = day.q.status === 'ready';
  const twin = useMemo(() => (v ? hypnogramTwin({ label: 'Sleep stages', from: v.windowStart, to: v.windowEnd, segments: sessionStageSpans(v.session.blocks) }) : null), [v]);
  const open = ready && v ? sleepPath(date === today ? undefined : date) : undefined;
  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.sleep}
      href={open}
      head={<CardHead as="h2" icon={MoonStar} title={C.sleep} info={sleepInfo({ goalMin, goalSource: day.goals.sleepMin.source, quiet, twin, footer: infoFooter })} />}
      foot={ready && v ? <CardFoot state={{ word: sleepFootWord(v, goalMin, quiet) }} right={quiet ? undefined : `Goal ${minutesText(goalMin)}`} /> : undefined}
    >
      {day.q.status === 'loading' ? <Loading lines={3} /> : null}
      {ready ? (
        v ? (
          <div className="rgo-sleep" data-size={compact ? 'compact' : 'md'}>
            <div className="rgo-sleep__grid">
              <SleepHero v={v} goalMin={goalMin} quiet={quiet} size={compact ? 'compact' : 'md'} />
              <div className="rgo-sleep__night">
                <NightStrip v={v} height={compact ? 84 : 96} />
              </div>
              {/* an incomplete night says how much of it the ring named (the number says it is a range) */}
              {!compact && v.incomplete && v.stageNote ? <MonoMeta>Incomplete night</MonoMeta> : null}
            </div>
          </div>
        ) : (
          <p className="rg-none">{C.noSleep}</p>
        )
      ) : null}
    </GradientCard>
  );
}
