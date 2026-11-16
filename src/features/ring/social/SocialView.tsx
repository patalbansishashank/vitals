/**
 * (social-time) The Social time page (Ring › Social): the day's total against the 30–45 band with the per-app split, and
 * a week of minutes. Quiet, non-judging: calm at or below the low edge, warming toward the high edge, over past it.
 * Quiet mode shows words only, no numbers.
 */
import {
  CardFoot,
  CardHead,
  Columns,
  GradientCard,
  HeroNumber,
  HighlightBars,
  MonoMeta,
  RangeScale,
  StackBar,
  formatNumber,
} from '@/components';
import { Hourglass } from 'lucide-react';
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { useQuietMode } from '@/state/settingsStore';
import { useGaugeEngine } from '@/state/gaugeEngine';
import { RING_COPY as C } from '../copy';
import { useSocialTime } from '../data';
import { RING_DOMAIN } from '../domains';
import { calendarDate, daysFrom, shiftDate } from '../model';
import { useNow } from '../useGauge';
import { WhenReady } from '../components/parts';
import { quietDays } from '../quiet';
import type { GaugeSocialTime } from '../types';
import { socialInfo } from './info';
import { UsageAccessAction } from './SocialCard';
import { socialOf } from './socialEngine';
import { displaySocialDay, socialAppRows, socialBands, socialMinutes, socialScaleMax, socialWord } from './socialModel';
import '../views/videos.css';

const BAND_WORDS = { within: C.social.within, nearing: C.social.nearing, over: C.social.over };

function SocialWeek({ st, date, today, min, max }: { st: GaugeSocialTime; date: string; today: string; min: number; max: number }) {
  const quiet = useQuietMode().on;
  const dates = daysFrom(shiftDate(date, -6), date);
  const minutesOf = (d: string) => {
    const day = st.days.find((x) => x.date === d);
    return day ? socialMinutes(day.totalSeconds) : null;
  };
  const counted = dates.flatMap((d) => {
    const m = minutesOf(d);
    return m === null ? [] : [m];
  });
  const avg = counted.length ? counted.reduce((a, b) => a + b, 0) / counted.length : null;
  const chart = {
    name: C.last7,
    dates,
    values: dates.map(minutesOf),
    limit: max,
    highlight: dates.includes(today) ? dates.indexOf(today) : null,
    hue: 'videos' as const,
    unit: C.social.unit,
  };
  const within = counted.filter((m) => m <= max).length;
  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.videos}
      head={
        <CardHead
          as="h2"
          icon={Hourglass}
          title={quiet ? 'The past week' : C.last7}
          info={{ ...socialInfo({ min, max, quiet }), title: 'Social time history', range: quiet ? undefined : `Daily target ${min}–${max} minutes. The average uses only days with time.` }}
        />
      }
      foot={<CardFoot right={quiet ? undefined : `${counted.length} days with time`} state={{ word: 'Measured on your phone' }} />}
    >
      <div className="rgv-history">
        {quiet ? (
          <p className="rg-note">
            {counted.length
              ? `Within your budget on ${quietDays(within, counted.length)} your phone counted.`
              : C.social.noneWeek}
          </p>
        ) : (
          <>
            <HeroNumber
              value={avg}
              unit="min a day"
              size="num-l"
              label={avg === null ? 'No average available' : `${formatNumber(avg, 0)} minutes a day`}
            />
            <MonoMeta items={[`Average per day`, `Target ${min}–${max} min`]} />
            <HighlightBars {...chart} className="rgv-bars" twin={false} />
          </>
        )}
      </div>
    </GradientCard>
  );
}

export function SocialView({ date }: { date: string }) {
  const quiet = useQuietMode().on;
  const today = calendarDate(useNow());
  const isToday = date === today;
  const q = useSocialTime(shiftDate(date, -6), date);
  const eng = useGaugeEngine();
  const social = socialOf(eng);
  const needsUsageAccess = eng.available && social !== null && social.usageAccess === false;
  return (
    <WhenReady q={q} lines={6}>
      {(st) => {
        const remote = st.days.find((d) => d.date === date) ?? null;
        const day = displaySocialDay(date, remote, social, isToday);
        const min = day?.targetMinMinutes ?? social?.targetMinMinutes ?? 30;
        const max = day?.targetMaxMinutes ?? social?.targetMaxMinutes ?? 45;
        const rows = day ? socialAppRows(day) : [];
        return (
          <Columns>
            <GradientCard
              as="section"
              domain={RING_DOMAIN.videos}
              head={<CardHead as="h2" icon={Hourglass} title={quiet ? 'This day' : fmtDay(date as LocalDate)} info={socialInfo({ rows, min, max, quiet })} />}
              foot={<CardFoot state={day ? { word: socialWord(socialMinutes(day.totalSeconds), min, max, BAND_WORDS) } : undefined} right={quiet ? undefined : `${C.social.targetWord} ${min}–${max}`} />}
            >
              <div className="rgv-day">
                {day ? (
                  (() => {
                    const minutes = socialMinutes(day.totalSeconds);
                    const word = socialWord(minutes, min, max, BAND_WORDS);
                    return (
                      <>
                        <HeroNumber
                          value={minutes}
                          unit={C.social.unit}
                          size="num-l"
                          label={quiet ? word : C.social.minutesIn(`${formatNumber(minutes, 0)} ${C.social.unit}`)}
                          quietWord={quiet ? word : undefined}
                        />
                        <RangeScale
                          label={C.social.title}
                          value={minutes}
                          min={0}
                          max={socialScaleMax(minutes, max)}
                          bands={socialBands(min, max, BAND_WORDS)}
                          usual={[min, max]}
                          unit={C.social.unit}
                          ticks="bands"
                          hue={RING_DOMAIN.videos}
                          quiet={quiet}
                        />
                        {rows.length ? <StackBar label={C.social.byApp} rows={rows} total={day.totalSeconds} quiet={quiet} legend="inline" /> : null}
                        {needsUsageAccess ? <UsageAccessAction /> : null}
                      </>
                    );
                  })()
                ) : (
                  <>
                    <p className="rg-none">{needsUsageAccess ? C.social.turnOnUsage : C.social.notSent(isToday)}</p>
                    {needsUsageAccess ? <UsageAccessAction /> : null}
                  </>
                )}
              </div>
            </GradientCard>
            <SocialWeek st={st} date={date} today={today} min={min} max={max} />
          </Columns>
        );
      }}
    </WhenReady>
  );
}
