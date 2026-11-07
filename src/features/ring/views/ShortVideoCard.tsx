/**
 * The Short videos card (Ring overview, Today; r071, AUDIT card 5, SPEC Q13): today's count against the person's own limit as
 * ONE number and a track, with neutral words ("Close to your limit"). No mascot and no stage names: the old brain art is gone.
 * The whole card opens the page. It is a library card on Today, never a default. Quiet: the word only, the track by ratio.
 */
import type { ReactNode } from 'react';
import { Film } from 'lucide-react';
import { CardFoot, CardHead, DottedTrack, GradientCard, HeroNumber, formatNumber } from '@/components';
import { engineActive, useGaugeEngine } from '@/state/gaugeEngine';
import { useRingLink } from '../commands';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import { useShortVideo } from '../data';
import { RING_DOMAIN } from '../domains';
import { shortVideosInfo } from '../info/videos';
import { calendarDate, shiftDate } from '../model';
import { ringPaths } from '../paths';
import { useNow } from '../useGauge';
import { WhenReady } from '../components/parts';
import { displayVideoDay, limitWord } from './shortVideoModel';
import './videos.css';

export function ShortVideoCard({ date, compact = false, infoFooter }: { date: string; compact?: boolean; infoFooter?: ReactNode }) {
  const quiet = useQuietMode().on;
  const today = calendarDate(useNow());
  const q = useShortVideo(shiftDate(date, -6), date);
  const eng = useGaugeEngine();
  const link = useRingLink();
  const local = engineActive(eng) && date === today ? eng.state?.shortVideo : null;
  const day = displayVideoDay(date, q.data?.days.find((d) => d.date === date) ?? null, local, date === today ? link.reels?.dailyLimit : undefined);
  const limit = day?.limit ?? null;
  const word = day ? limit === null ? 'Limit off' : limitWord(day.total, limit) : null;
  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.videos}
      href={ringPaths.shortVideos(date)}
      head={<CardHead as="h2" icon={Film} title={C.shortVideos} info={shortVideosInfo({ footer: infoFooter })} />}
      foot={day && word ? <CardFoot state={{ word }} right={quiet || limit === null ? undefined : `Limit ${formatNumber(limit, 0)}`} /> : undefined}
    >
      <WhenReady q={q} lines={2}>
        {(sv) =>
          day ? (
            <div className="rgv-card" data-compact={compact || undefined}>
              <HeroNumber
                value={day.total}
                unit="videos"
                size={compact ? 'num' : 'num-l'}
                label={quiet ? word! : `${formatNumber(day.total, 0)} ${limit === null ? 'videos' : C.videosOf(formatNumber(limit, 0))}`}
                quietWord={quiet ? word! : undefined}
              />
              {limit !== null ? <DottedTrack label="Short videos today" value={day.total} goal={limit} goalKind="limit" valueText={`${formatNumber(day.total, 0)} ${C.videosOf(formatNumber(limit, 0))}`} goalText={`limit ${formatNumber(limit, 0)}`} quiet={quiet} quietWord={word!} /> : null}
            </div>
          ) : (
            <p className="rg-none">{sv.days.length || date === today ? C.shortVideoNotSent(date === today) : C.noShortVideos}</p>
          )
        }
      </WhenReady>
    </GradientCard>
  );
}
