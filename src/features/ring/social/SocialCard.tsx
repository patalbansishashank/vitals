/**
 * (social-time) The Social time card (Ring overview, Today): today's minutes against the 30–45 target band as one
 * number and a band scale, in the quiet, non-judging voice. The whole card opens the page. A library card on Today,
 * never a default; nothing while loading or when there is nothing to show. Quiet: the word only.
 *
 * When Usage access is off on Android, a one-line "Turn on Usage access" action opens the system screen. On web or
 * desktop, where there is no phone, it says so instead.
 */
import type { ReactNode } from 'react';
import { Hourglass } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber, Key, RangeScale, formatNumber } from '@/components';
import { useGaugeEngine } from '@/state/gaugeEngine';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import { useSocialTime } from '../data';
import { RING_DOMAIN } from '../domains';
import { calendarDate, shiftDate } from '../model';
import { ringPaths } from '../paths';
import { useNow } from '../useGauge';
import { WhenReady } from '../components/parts';
import { socialInfo } from './info';
import { canOpenUsageAccess, openUsageAccessSettings, socialOf } from './socialEngine';
import { displaySocialDay, socialBands, socialMinutes, socialScaleMax, socialWord } from './socialModel';
import '../views/videos.css';

const BAND_WORDS = { within: C.social.within, nearing: C.social.nearing, over: C.social.over };

export function SocialCard({ date, compact = false, infoFooter }: { date: string; compact?: boolean; infoFooter?: ReactNode }) {
  const quiet = useQuietMode().on;
  const today = calendarDate(useNow());
  const isToday = date === today;
  const q = useSocialTime(shiftDate(date, -6), date);
  const eng = useGaugeEngine();
  const social = socialOf(eng);
  const needsUsageAccess = eng.available && social !== null && social.usageAccess === false;
  const day = displaySocialDay(date, q.data?.days.find((d) => d.date === date) ?? null, social, isToday);
  const min = day?.targetMinMinutes ?? social?.targetMinMinutes ?? 30;
  const max = day?.targetMaxMinutes ?? social?.targetMaxMinutes ?? 45;

  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.videos}
      href={ringPaths.social(date)}
      head={<CardHead as="h2" icon={Hourglass} title={C.social.title} info={socialInfo({ footer: infoFooter, min, max, quiet })} />}
      foot={day ? <CardFoot state={{ word: C.social.title }} right={quiet ? undefined : `${C.social.targetWord} ${min}–${max}`} /> : undefined}
    >
      <WhenReady q={q} lines={2}>
        {() =>
          day ? (
            <div className="rgv-card" data-compact={compact || undefined}>
              {(() => {
                const minutes = socialMinutes(day.totalSeconds);
                const word = socialWord(minutes, min, max, BAND_WORDS);
                return (
                  <>
                    <HeroNumber
                      value={minutes}
                      unit={C.social.unit}
                      size={compact ? 'num' : 'num-l'}
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
                    {needsUsageAccess ? <UsageAccessAction /> : null}
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="rgv-card" data-compact={compact || undefined}>
              <p className="rg-none">{needsUsageAccess ? C.social.turnOnUsage : C.social.notSent(isToday)}</p>
              {needsUsageAccess ? <UsageAccessAction /> : null}
            </div>
          )
        }
      </WhenReady>
    </GradientCard>
  );
}

/** Android: open Usage access; web/desktop: a line that it needs the phone. */
export function UsageAccessAction() {
  if (!canOpenUsageAccess()) return <p className="rg-note">{C.social.needsPhone}</p>;
  return (
    <Key variant="action" size="sm" onClick={() => void openUsageAccessSettings()}>
      {C.social.turnOnUsage}
    </Key>
  );
}
